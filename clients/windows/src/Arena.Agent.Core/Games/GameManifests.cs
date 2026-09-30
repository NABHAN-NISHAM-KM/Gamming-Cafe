using System.Text;
using System.Text.Json;

namespace Arena.Agent.Core.Games;

/// <summary>What the agent found on disk (mirrors DetectedGame in the contracts).</summary>
/// <param name="Updating">The launcher is downloading/applying the update right now.</param>
/// <param name="ProgressPct">0–100 while updating, from the launcher's own byte counters.</param>
public sealed record DetectedGame(string Source, string Key, string Name, string? InstallPath, string? BuildId, long? SizeBytes, bool UpdateRequired, bool Updating = false, double? ProgressPct = null);

/// <summary>
/// Minimal reader for Valve's KeyValues text format (libraryfolders.vdf,
/// appmanifest_*.acf): quoted keys, quoted values, nested { } blocks,
/// backslash escapes and // comments.
/// </summary>
public static class Vdf
{
    public sealed class Node : Dictionary<string, object>
    {
        public Node() : base(StringComparer.OrdinalIgnoreCase) { }
        public string? Str(string key) => TryGetValue(key, out var v) ? v as string : null;
        public Node? Obj(string key) => TryGetValue(key, out var v) ? v as Node : null;
    }

    public static Node Parse(string text)
    {
        var tokens = Tokenize(text).GetEnumerator();
        var root = new Node();
        ParseInto(root, tokens, topLevel: true);
        return root;
    }

    private static void ParseInto(Node node, IEnumerator<string> t, bool topLevel)
    {
        while (t.MoveNext())
        {
            var key = t.Current;
            if (key == "}") { if (topLevel) continue; return; }
            if (key == "{") continue; // malformed; skip
            if (!t.MoveNext()) return;
            if (t.Current == "{")
            {
                var child = new Node();
                ParseInto(child, t, topLevel: false);
                node[key] = child;
            }
            else node[key] = t.Current;
        }
    }

    private static IEnumerable<string> Tokenize(string s)
    {
        var i = 0;
        while (i < s.Length)
        {
            var c = s[i];
            if (char.IsWhiteSpace(c)) { i++; continue; }
            if (c == '/' && i + 1 < s.Length && s[i + 1] == '/') { while (i < s.Length && s[i] != '\n') i++; continue; }
            if (c is '{' or '}') { i++; yield return c.ToString(); continue; }
            if (c == '"')
            {
                var sb = new StringBuilder();
                i++;
                while (i < s.Length && s[i] != '"')
                {
                    if (s[i] == '\\' && i + 1 < s.Length)
                    {
                        var n = s[i + 1];
                        sb.Append(n switch { 'n' => '\n', 't' => '\t', _ => n });
                        i += 2;
                        continue;
                    }
                    sb.Append(s[i++]);
                }
                i++; // closing quote
                yield return sb.ToString();
                continue;
            }
            // unquoted token (rare)
            var start = i;
            while (i < s.Length && !char.IsWhiteSpace(s[i]) && s[i] is not ('{' or '}' or '"')) i++;
            yield return s[start..i];
        }
    }
}

public static class SteamManifests
{
    /// <summary>"Steamworks Common Redistributables": a Steam tool every PC has, not a game.</summary>
    private const string SteamworksRedist = "228980";
    // EAppState flags (appmanifest "StateFlags").
    private const int FullyInstalled = 4, UpdateRequired = 2, UpdateRunning = 1024, UpdatePaused = 512, UpdateStarted = 256;

    /// <summary>Library folders from steamapps/libraryfolders.vdf (always includes the Steam folder itself).</summary>
    public static IReadOnlyList<string> LibraryFolders(string steamRoot, string? libraryFoldersVdf)
    {
        var list = new List<string> { steamRoot };
        if (libraryFoldersVdf is null) return list;
        var root = Vdf.Parse(libraryFoldersVdf);
        var folders = root.Obj("libraryfolders") ?? root.Obj("LibraryFolders");
        if (folders is null) return list;
        foreach (var (key, value) in folders)
        {
            // Newer format: "0" { "path" "D:\\SteamLibrary" ... } — older: "1" "D:\\SteamLibrary"
            var path = value is Vdf.Node n ? n.Str("path") : int.TryParse(key, out _) ? value as string : null;
            if (!string.IsNullOrWhiteSpace(path) && !list.Contains(path, StringComparer.OrdinalIgnoreCase)) list.Add(path);
        }
        return list;
    }

    /// <summary>One appmanifest_*.acf → a detected game, or null if it isn't an installed app.</summary>
    public static DetectedGame? FromAppManifest(string acf, string libraryFolder)
    {
        var app = Vdf.Parse(acf).Obj("AppState");
        if (app is null) return null;
        var appId = app.Str("appid");
        if (appId is null || !appId.All(char.IsAsciiDigit) || appId == SteamworksRedist) return null;
        _ = int.TryParse(app.Str("StateFlags"), out var flags);
        var build = app.Str("buildid");
        var target = app.Str("TargetBuildID");
        // Steam sets TargetBuildID to the build it's moving to; "0" or equal to buildid means nothing pending.
        var newBuildPending = target is not null && target != "0" && target != build;
        var running = (flags & (UpdateRunning | UpdateStarted)) != 0;
        var required = newBuildPending || running || (flags & (UpdateRequired | UpdatePaused)) != 0;
        if ((flags & FullyInstalled) == 0 && !required) return null; // downloading for the first time, or uninstalled
        _ = long.TryParse(app.Str("SizeOnDisk"), out var size);
        var dir = app.Str("installdir");
        return new DetectedGame("STEAM", appId, app.Str("name") ?? $"Steam app {appId}",
            dir is null ? null : Path.Combine(libraryFolder, "steamapps", "common", dir), build, size > 0 ? size : null, required,
            running, required ? Progress(app) : null);
    }

    /// <summary>
    /// Update progress from Steam's counters: download then stage (write to disk), weighted by bytes.
    /// Null when Steam hasn't started counting yet.
    /// </summary>
    public static double? Progress(Vdf.Node app)
    {
        long L(string k) => long.TryParse(app.Str(k), out var v) && v > 0 ? v : 0;
        var total = L("BytesToDownload") + L("BytesToStage");
        if (total == 0) return null;
        var done = Math.Min(L("BytesDownloaded"), L("BytesToDownload")) + Math.Min(L("BytesStaged"), L("BytesToStage"));
        return Math.Round(done * 100.0 / total, 1);
    }
}

public static class EpicManifests
{
    /// <summary>One Epic launcher .item manifest (JSON) → a detected game, or null if incomplete/invalid.</summary>
    public static DetectedGame? FromItem(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var r = doc.RootElement;
            string? S(string n) => r.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            if (r.TryGetProperty("bIsIncompleteInstall", out var inc) && inc.ValueKind == JsonValueKind.True) return null;
            var appName = S("AppName");
            if (string.IsNullOrEmpty(appName)) return null;
            long? size = r.TryGetProperty("InstallSize", out var sz) && sz.TryGetInt64(out var l) ? l : null;
            // Epic manifests don't record "update available"; the launcher updates on start.
            return new DetectedGame("EPIC", appName, S("DisplayName") ?? appName, S("InstallLocation"), S("AppVersionString"), size, false);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>AppName and the game's own .exe (InstallLocation + LaunchExecutable), for its icon.</summary>
    public static (string AppName, string Exe)? LaunchExe(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var r = doc.RootElement;
            string? S(string n) => r.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            if (S("AppName") is not { Length: > 0 } app || S("InstallLocation") is not { Length: > 0 } dir || S("LaunchExecutable") is not { Length: > 0 } exe) return null;
            return exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? (app, Path.Combine(dir, exe)) : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>A program from Windows' installed-apps list (mirrors DetectedApp in the contracts).</summary>
public sealed record DetectedApp(string Key, string Name, string? Version, string? Publisher, string? InstallPath, string? ExecutablePath, long? SizeBytes);

public static class InstalledApps
{
    /// <summary>
    /// One registry Uninstall subkey → an app, or null for updates, system
    /// components, Steam games (reported by the Steam scan) and nameless entries.
    /// <paramref name="get"/> reads a value of that subkey.
    /// </summary>
    public static DetectedApp? FromUninstallKey(string keyName, Func<string, object?> get)
    {
        string? S(string n) => get(n) is string s && !string.IsNullOrWhiteSpace(s) ? s.Trim() : null;
        var name = S("DisplayName");
        if (name is null || keyName.StartsWith("Steam App ", StringComparison.OrdinalIgnoreCase)) return null;
        if (get("SystemComponent") is int sys && sys == 1) return null;
        if (S("ParentKeyName") is not null || S("ReleaseType") is "Update" or "Hotfix" or "Security Update") return null;
        long? size = get("EstimatedSize") is int kb && kb > 0 ? kb * 1024L : null;
        return new DetectedApp(keyName, name, S("DisplayVersion"), S("Publisher"), S("InstallLocation")?.TrimEnd('\\'), ExeFromIcon(S("DisplayIcon")), size);
    }

    /// <summary>DisplayIcon is often the main exe: <c>"C:\App\app.exe",0</c> → <c>C:\App\app.exe</c>. Uninstallers aren't.</summary>
    public static string? ExeFromIcon(string? icon)
    {
        if (icon is null) return null;
        var p = icon.Split(',')[0].Trim().Trim('"');
        if (!p.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || !Path.IsPathFullyQualified(p)) return null;
        var file = Path.GetFileName(p);
        string[] notTheApp = ["unins", "uninstall", "setup", "install", "update"];
        if (notTheApp.Any(w => file.Contains(w, StringComparison.OrdinalIgnoreCase))) return null;
        // Cached/staged installers, not the program itself.
        return p.Contains(@"\Package Cache\", StringComparison.OrdinalIgnoreCase) || p.Contains(@"\Installer\", StringComparison.OrdinalIgnoreCase)
            || p.Contains("InstallShield", StringComparison.OrdinalIgnoreCase) ? null : p;
    }
}
