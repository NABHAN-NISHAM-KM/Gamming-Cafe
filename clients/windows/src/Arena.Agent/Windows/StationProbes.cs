using System.Diagnostics;
using System.Management;
using System.Net;
using System.Net.NetworkInformation;
using Arena.Agent.Core.Games;
using Arena.Agent.Core.Stations;
using Microsoft.Win32;

namespace Arena.Agent.Windows;

/// <summary>Finds installed games: Steam and Epic manifests, plus the catalog's own executables.</summary>
public sealed class GameScanner(ILogger<GameScanner> log)
{
    private const string EpicManifestDir = @"C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests";

    public string? SteamRoot()
    {
        foreach (var key in new[] { @"SOFTWARE\WOW6432Node\Valve\Steam", @"SOFTWARE\Valve\Steam" })
        {
            try
            {
                if (Registry.LocalMachine.OpenSubKey(key)?.GetValue("InstallPath") is string p && Directory.Exists(p)) return p;
            }
            catch (Exception e) when (e is System.Security.SecurityException or UnauthorizedAccessException) { }
        }
        const string fallback = @"C:\Program Files (x86)\Steam";
        return Directory.Exists(fallback) ? fallback : null;
    }

    public string? SteamExe() => SteamRoot() is { } root && File.Exists(Path.Combine(root, "steam.exe")) ? Path.Combine(root, "steam.exe") : null;

    public List<DetectedGame> Scan(StationConfig? config)
    {
        var found = new List<DetectedGame>();
        try
        {
            if (SteamRoot() is { } root)
            {
                var vdfPath = Path.Combine(root, "steamapps", "libraryfolders.vdf");
                var vdf = File.Exists(vdfPath) ? File.ReadAllText(vdfPath) : null;
                foreach (var lib in SteamManifests.LibraryFolders(root, vdf))
                {
                    var apps = Path.Combine(lib, "steamapps");
                    if (!Directory.Exists(apps)) continue;
                    foreach (var acf in Directory.EnumerateFiles(apps, "appmanifest_*.acf"))
                        if (SteamManifests.FromAppManifest(ReadShared(acf), lib) is { } g) found.Add(g);
                }
            }
        }
        catch (Exception e) { log.LogWarning("Steam scan failed: {Message}", e.Message); }

        try
        {
            if (Directory.Exists(EpicManifestDir))
                foreach (var item in Directory.EnumerateFiles(EpicManifestDir, "*.item"))
                    if (EpicManifests.FromItem(ReadShared(item)) is { } g) found.Add(g);
        }
        catch (Exception e) { log.LogWarning("Epic scan failed: {Message}", e.Message); }

        // Catalog games started from an executable (Riot, Battle.net, standalone…): installed if the file exists.
        foreach (var g in config?.Games ?? [])
            if (g.Launch is { Kind: "PATH", ExecutablePath: { } exe } && LaunchPolicy.IsSafeExecutable(exe) && File.Exists(exe))
                found.Add(new DetectedGame("PATH", g.Id, g.Title, Path.GetDirectoryName(exe), null, null, false));
        return found;
    }

    private static string ReadShared(string path)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var r = new StreamReader(fs);
        return r.ReadToEnd();
    }
}

/// <summary>Connected mice, keyboards, headsets, controllers, wheels… via Plug and Play.</summary>
public sealed class PeripheralScanner(ILogger<PeripheralScanner> log)
{
    private static readonly string[] Classes = ["Mouse", "Keyboard", "AudioEndpoint", "Camera", "Image", "HIDClass", "XnaComposite", "XboxComposite"];

    public List<DetectedPeripheral> Scan()
    {
        var items = new List<DetectedPeripheral>();
        try
        {
            var where = string.Join(" OR ", Classes.Select(c => $"PNPClass = '{c}'"));
            using var q = new ManagementObjectSearcher($"SELECT Name, PNPClass, DeviceID, Present FROM Win32_PnPEntity WHERE ({where})");
            foreach (var o in q.Get().Cast<ManagementObject>())
            {
                using (o)
                {
                    if (o["Present"] is false) continue;
                    if (PeripheralClassifier.Classify(o["PNPClass"] as string, o["Name"] as string, o["DeviceID"] as string ?? "") is { } p) items.Add(p);
                }
            }
        }
        catch (Exception e) { log.LogWarning("Peripheral scan failed: {Message}", e.Message); }
        return PeripheralClassifier.Dedupe(items);
    }
}

/// <summary>Pings the branch's connectivity targets (router, DNS, game regions).</summary>
public sealed class NetworkProber
{
    public async Task<NetworkProbe> ProbeAsync(IReadOnlyList<ConnectivityTarget> targets, CancellationToken ct)
    {
        var nic = PrimaryNic.Detect();
        var results = await Task.WhenAll(targets.Take(8).Select(async t =>
        {
            var host = t.Host == "gateway" ? nic?.Gateway : t.Host;
            if (host is null) return new ProbeTarget(t.Name, t.Host, null, 100);
            var rtts = new List<long?>();
            using var ping = new Ping();
            for (var i = 0; i < 4 && !ct.IsCancellationRequested; i++)
            {
                try
                {
                    var r = await ping.SendPingAsync(host, TimeSpan.FromSeconds(1), cancellationToken: ct);
                    rtts.Add(r.Status == IPStatus.Success ? r.RoundtripTime : null);
                }
                catch (PingException) { rtts.Add(null); }
            }
            var (ms, loss) = ProbeMath.Summarize(rtts);
            return new ProbeTarget(t.Name, t.Host, ms, loss);
        }));

        double? dnsMs = null;
        try
        {
            var sw = Stopwatch.StartNew();
            await Dns.GetHostAddressesAsync("www.google.com", ct);
            dnsMs = Math.Round(sw.Elapsed.TotalMilliseconds, 1);
        }
        catch (Exception) { /* DNS down: reported as null */ }

        return new NetworkProbe(results, nic is null ? null : nic.Wireless ? "WIFI" : "ETHERNET", nic?.SpeedMbps, dnsMs);
    }
}

/// <summary>
/// Local disk or network (diskless) boot. iSCSI sessions mean the system disk
/// comes from a boot server; well-known diskless client services name the provider.
/// </summary>
public static class BootDetector
{
    private static readonly (string Service, string Provider)[] Providers = [("ccboot", "CCBoot"), ("ggrock", "ggRock"), ("icafe", "iCafe"), ("netboot", "NetBoot")];

    public static (string Mode, string? Provider, string? BootServer) Detect()
    {
        string? provider = null;
        try
        {
            foreach (var s in System.ServiceProcess.ServiceController.GetServices())
            {
                using (s)
                {
                    var name = (s.ServiceName + " " + s.DisplayName).ToLowerInvariant();
                    var hit = Providers.FirstOrDefault(p => name.Contains(p.Service));
                    if (hit.Provider is not null) { provider = hit.Provider; break; }
                }
            }
        }
        catch (Exception) { }

        string? target = null;
        try
        {
            using var q = new ManagementObjectSearcher(@"root\wmi", "SELECT TargetName FROM MSiSCSIInitiator_SessionClass");
            foreach (var o in q.Get().Cast<ManagementObject>()) using (o) { target ??= o["TargetName"] as string; }
        }
        catch (ManagementException) { }
        catch (UnauthorizedAccessException) { }

        if (target is not null) return ("ISCSI", provider, target);
        return provider is not null ? ("UNKNOWN", provider, null) : ("LOCAL_DISK", null, null);
    }
}
