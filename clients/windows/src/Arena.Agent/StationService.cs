using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using Arena.Agent.Core;
using Arena.Agent.Core.Games;
using Arena.Agent.Core.Stations;
using Arena.Agent.Shell;
using Arena.Agent.Windows;
using Microsoft.Extensions.Hosting.WindowsServices;

namespace Arena.Agent;

/// <summary>The live WebSocket to the server, shared by the agent's services (null Send while offline).</summary>
public sealed class ServerLink
{
    public volatile Func<string, Task>? Send;

    public async Task<bool> TrySendAsync(string json)
    {
        var send = Send;
        if (send is null) return false;
        try { await send(json); return true; }
        catch (Exception) { return false; }
    }
}

/// <summary>
/// Phase 5 station features: the signed game library, launching games and
/// apps for the signed-in customer, watching what is played, closing games at
/// session end, game scans and launcher-driven updates, peripherals,
/// connectivity, boot mode, "call staff" and self-service repairs.
/// </summary>
public sealed class StationService(
    AgentPaths paths,
    SessionManager sessions,
    ShellHub shell,
    ServerLink server,
    GameScanner games,
    PeripheralScanner peripheralScanner,
    NetworkProber prober,
    RepairRunner repairs,
    ILogger<StationService> log) : BackgroundService
{
    /// <summary>Launcher/client processes closed with the games at session end (they hold the customer's logins).</summary>
    private static readonly string[] LauncherProcesses = ["steam", "steamwebhelper", "EpicGamesLauncher", "EpicWebHelper", "RiotClientServices", "RiotClientUx", "Battle.net", "EADesktop", "UbisoftConnect"];
    private static readonly HashSet<string> Protected = new(StringComparer.OrdinalIgnoreCase) { "explorer", "winlogon", "csrss", "lsass", "services", "svchost", "dwm", "smss", "wininit", "ArenaAgent", "ArenaShell", "msedgewebview2" };

    private StationConfig? _config;
    private bool _safeMode = true;
    private List<DetectedGame> _inventory = [];
    private List<DetectedPeripheral> _peripherals = [];
    private string _peripheralsKey = "";
    private DateTimeOffset _peripheralsSentAt;
    private NetworkProbe? _network;
    private (string Id, string Title)? _playing;
    private CancellationTokenSource? _watch;
    private readonly ConcurrentDictionary<string, bool> _pendingHelp = new();
    private readonly SemaphoreSlim _scanGate = new(1, 1);
    private readonly List<FileSystemWatcher> _watchers = [];
    private int _rescanQueued;
    private string _sentInventory = "";
    private DateTimeOffset _sentInventoryAt;

    public StationConfig? Config => _config;

    public void Configure(bool safeMode)
    {
        _safeMode = safeMode;
        try
        {
            if (File.Exists(paths.Config)) _config = JsonSerializer.Deserialize<StationConfig>(File.ReadAllText(paths.Config), Json.Options);
        }
        catch (JsonException) { _config = null; }
    }

    // ── config (signed by the branch; verified by AgentWorker before it gets here) ──

    public void ApplyConfig(StationConfig config)
    {
        var first = _config is null;
        _config = config;
        try
        {
            var tmp = paths.Config + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(config, Json.Options));
            File.Move(tmp, paths.Config, overwrite: true);
        }
        catch (IOException e) { log.LogWarning("Could not cache station config: {Message}", e.Message); }
        shell.Broadcast(ShellProtocol.Library(config, sessions.Current));
        if (first) _ = Task.Run(() => ScanGamesAsync(CancellationToken.None)); // PATH games can only be checked once we know them
    }

    /// <summary>After (re)connecting: bring the server up to date.</summary>
    public async Task OnServerConnectedAsync(CancellationToken ct)
    {
        var boot = BootDetector.Detect();
        await server.TrySendAsync(Outgoing.Boot(boot.Mode, boot.Provider, boot.BootServer));
        await ScanGamesAsync(ct);
        _peripheralsKey = ""; // force a fresh peripherals report
    }

    /// <param name="force">Send even if nothing changed (explicit scans, reconnects). Watcher/progress rescans only send changes.</param>
    public async Task<int> ScanGamesAsync(CancellationToken ct, bool force = true)
    {
        await _scanGate.WaitAsync(ct);
        try
        {
            (_inventory, var apps) = await Task.Run(() => (games.Scan(_config), games.ScanApps()), ct);
            var msg = Outgoing.Inventory(_inventory, apps);
            if (!force && msg == _sentInventory && DateTimeOffset.UtcNow - _sentInventoryAt < TimeSpan.FromMinutes(5)) return _inventory.Count;
            if (await server.TrySendAsync(msg)) (_sentInventory, _sentInventoryAt) = (msg, DateTimeOffset.UtcNow);
            return _inventory.Count;
        }
        finally { _scanGate.Release(); }
    }

    /// <summary>
    /// Launchers rewrite their manifests when an update is found, progresses or
    /// finishes, and when games are installed or removed: rescan shortly after.
    /// </summary>
    private void WatchLaunchers()
    {
        foreach (var dir in games.WatchFolders())
        {
            try
            {
                var w = new FileSystemWatcher(dir) { NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size };
                w.Filters.Add("*.acf");
                w.Filters.Add("*.item");
                w.Changed += (_, _) => QueueRescan();
                w.Created += (_, _) => QueueRescan();
                w.Deleted += (_, _) => QueueRescan();
                w.Renamed += (_, _) => QueueRescan();
                w.EnableRaisingEvents = true;
                _watchers.Add(w);
            }
            catch (Exception e) when (e is ArgumentException or IOException or UnauthorizedAccessException) { log.LogWarning("Can't watch {Dir}: {Message}", dir, e.Message); }
        }
    }

    /// <summary>Coalesces a burst of manifest writes into one rescan ~2 s later.</summary>
    private void QueueRescan()
    {
        if (Interlocked.Exchange(ref _rescanQueued, 1) == 1) return;
        _ = Task.Run(async () =>
        {
            await Task.Delay(TimeSpan.FromSeconds(2));
            Interlocked.Exchange(ref _rescanQueued, 0);
            try { await ScanGamesAsync(CancellationToken.None, force: false); }
            catch (Exception e) { log.LogWarning("Rescan failed: {Message}", e.Message); }
        });
    }

    public override void Dispose()
    {
        foreach (var w in _watchers) w.Dispose();
        base.Dispose();
    }

    // ── background loops ───────────────────────────────────────────────────

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        shell.RequestReceived += OnShellRequest;
        shell.ClientReady += SendShellSnapshot;
        sessions.Changed += OnSessionChanged;

        WatchLaunchers();
        // While a launcher is downloading, report progress every few seconds (manifests aren't rewritten that often).
        _ = Task.Run(async () =>
        {
            using var fast = new PeriodicTimer(TimeSpan.FromSeconds(5));
            while (await fast.WaitForNextTickAsync(stop).ConfigureAwait(false))
                if (_inventory.Any(g => g.Updating))
                    try { await ScanGamesAsync(stop, force: false); }
                    catch (Exception e) when (e is not OperationCanceledException) { log.LogWarning("Progress scan: {Message}", e.Message); }
        }, stop);

        var nextNetwork = DateTimeOffset.MinValue;
        var nextScan = DateTimeOffset.UtcNow.AddMinutes(30);
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(20));
        do
        {
            try
            {
                await ReportPeripheralsAsync();
                var now = DateTimeOffset.UtcNow;
                if (now >= nextNetwork)
                {
                    nextNetwork = now.AddSeconds(60);
                    _network = await prober.ProbeAsync(_config?.ConnectivityTargets is { Length: > 0 } t ? t : [new("Router", "gateway"), new("Cloudflare", "1.1.1.1"), new("Google DNS", "8.8.8.8")], stop);
                    await server.TrySendAsync(Outgoing.Network(_network));
                    shell.Broadcast(ShellProtocol.Network(_network));
                }
                if (now >= nextScan)
                {
                    nextScan = now.AddMinutes(30);
                    await ScanGamesAsync(stop);
                }
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
            catch (Exception e) { log.LogWarning("Station loop: {Message}", e.Message); }
        } while (await timer.WaitForNextTickAsync(stop).ConfigureAwait(false) is true);
    }

    private async Task ReportPeripheralsAsync()
    {
        var items = await Task.Run(peripheralScanner.Scan);
        var key = string.Join("|", items.Select(i => i.HardwareId));
        if (key == _peripheralsKey && DateTimeOffset.UtcNow - _peripheralsSentAt < TimeSpan.FromMinutes(5)) return;
        if (await server.TrySendAsync(Outgoing.Peripherals(items)))
        {
            _peripheralsKey = key;
            _peripheralsSentAt = DateTimeOffset.UtcNow;
        }
        if (_peripherals.Count != items.Count || string.Join("|", _peripherals.Select(p => p.HardwareId)) != key) shell.Broadcast(ShellProtocol.Peripherals(items));
        _peripherals = items;
    }

    private void SendShellSnapshot()
    {
        shell.Broadcast(ShellProtocol.Library(_config, sessions.Current));
        shell.Broadcast(ShellProtocol.Peripherals(_peripherals));
        if (_network is not null) shell.Broadcast(ShellProtocol.Network(_network));
        shell.Broadcast(ShellProtocol.Playing(_playing?.Id, _playing?.Title));
    }

    private void OnSessionChanged(SessionEvent e, SessionState? s)
    {
        shell.Broadcast(ShellProtocol.Library(_config, sessions.Current)); // age locks follow the customer
        if (e is SessionEvent.Ended or SessionEvent.ExpiredLocally)
        {
            _watch?.Cancel();
            SetPlaying(null, s?.SessionId);
            var closed = CloseGames();
            log.LogInformation("Session ended: {Closed} game/launcher process(es) closed{Safe}", closed, _safeMode ? " (simulated, safe mode)" : "");
        }
    }

    // ── Shell requests (untrusted: validated by ShellProtocol.Parse, then policy) ──

    private async Task OnShellRequest(ShellRequest request)
    {
        switch (request)
        {
            case ShellRequest.Launch l:
            {
                var (denial, plan) = LaunchPolicy.ForGame(_config, sessions.Current, l.GameId, games.SteamExe());
                if (denial != LaunchDenial.None) { shell.Broadcast(ShellProtocol.Result("launch_result", l.RequestId, false, denial.ToString(), LaunchPolicy.Message(denial))); return; }
                var game = _config!.Games.First(g => g.Id == l.GameId);
                var ok = Start(plan!, out var error);
                shell.Broadcast(ShellProtocol.Result("launch_result", l.RequestId, ok, ok ? null : "START_FAILED", ok ? null : error));
                if (ok) Watch(game);
                return;
            }
            case ShellRequest.LaunchApp a:
            {
                var (denial, plan) = LaunchPolicy.ForApp(_config, sessions.Current, a.AppId);
                if (denial != LaunchDenial.None) { shell.Broadcast(ShellProtocol.Result("launch_result", a.RequestId, false, denial.ToString(), LaunchPolicy.Message(denial))); return; }
                var ok = Start(plan!, out var error);
                shell.Broadcast(ShellProtocol.Result("launch_result", a.RequestId, ok, ok ? null : "START_FAILED", ok ? null : error));
                return;
            }
            case ShellRequest.Help h:
                _pendingHelp[h.RequestId] = true;
                if (!await server.TrySendAsync(Outgoing.HelpRequest(h.RequestId, h.Topic, h.Note)))
                {
                    _pendingHelp.TryRemove(h.RequestId, out _);
                    shell.Broadcast(ShellProtocol.Result("help_result", h.RequestId, false, "offline", "The venue is offline. Please wave to a member of staff."));
                }
                return;
            case ShellRequest.MenuRequest m:
                if (!await server.TrySendAsync(Outgoing.MenuRequest(m.RequestId)))
                    shell.Broadcast(JsonSerializer.Serialize(new { type = "menu", requestId = m.RequestId, menu = (object?)null, error = "offline" }, Json.Options));
                return;
            case ShellRequest.PlaceOrder o:
                if (sessions.Current is null) { shell.Broadcast(ShellProtocol.Result("order_result", o.RequestId, false, "no_session", "Sign in to order.")); return; }
                if (!await server.TrySendAsync(Outgoing.PlaceOrder(o.RequestId, o.Lines, o.Notes, o.PayWith)))
                    shell.Broadcast(ShellProtocol.Result("order_result", o.RequestId, false, "offline", "The venue is offline — please order at the counter."));
                return;
            case ShellRequest.PrintConfirm pc:
                if (!await server.TrySendAsync(Outgoing.PrintConfirm(pc.JobKey, pc.PayWith)))
                    shell.Broadcast(JsonSerializer.Serialize(new { type = "print_status", jobKey = pc.JobKey, status = "CANCELLED", message = "The venue is offline — your print is on hold. Please ask staff." }, Json.Options));
                return;
            case ShellRequest.PrintCancel px:
                await server.TrySendAsync(Outgoing.PrintCancel(px.JobKey));
                return;
            case ShellRequest.Repair r:
            {
                var result = await repairs.RunAsync(r.Action, _safeMode, CloseGames, ReloadShell, CancellationToken.None);
                shell.Broadcast(ShellProtocol.Result("repair_result", r.RequestId, result.Ok, result.ErrorCode, result.Ok ? "Done." : result.ErrorMessage));
                await server.TrySendAsync(Outgoing.SelfRepair(r.Action, result.Ok, result.ErrorMessage));
                return;
            }
        }
    }

    /// <summary>Menu, order results and order progress from the server go straight to the Shell (display data only).</summary>
    public void ForwardToShell(JsonElement message) => shell.Broadcast(message.GetRawText().ReplaceLineEndings(""));

    /// <summary>Server answered a help request.</summary>
    public void OnHelpResult(JsonElement r)
    {
        var id = r.TryGetProperty("requestId", out var v) ? v.GetString() : null;
        if (id is null || !_pendingHelp.TryRemove(id, out _)) return;
        var ok = r.TryGetProperty("ok", out var o) && o.ValueKind == JsonValueKind.True;
        shell.Broadcast(ShellProtocol.Result("help_result", id, ok, ok ? null : "failed", ok ? "Staff have been notified." : "Couldn't reach staff. Please wave to a member of staff."));
    }

    // ── staff commands ─────────────────────────────────────────────────────

    public Task<ExecResult> RepairAsync(string action, CancellationToken ct) => repairs.RunAsync(action, _safeMode, CloseGames, ReloadShell, ct);

    public ExecResult UpdateGame(JsonElement payload, CancellationToken ct)
    {
        LaunchSpec? spec;
        try { spec = payload.GetProperty("launch").Deserialize<LaunchSpec>(Json.Options); }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException) { return ExecResult.Fail("BAD_PAYLOAD", "launch missing"); }
        if (sessions.Current is not null) return ExecResult.Fail("IN_SESSION", "A customer is using this PC");
        var plan = LaunchPolicy.UpdatePlanFor(spec, games.SteamExe());
        if (plan is null) return ExecResult.Fail("NO_LAUNCHER", "The game's launcher isn't installed on this PC");
        if (_safeMode)
        {
            log.LogInformation("SAFE MODE: simulated game update via {Launcher}", spec?.Kind);
            return ExecResult.Success(new { simulated = true });
        }
        if (!Start(plan, out var error)) return ExecResult.Fail("START_FAILED", error ?? "could not start the launcher");
        // The launcher downloads in the background; rescan every minute for two hours so the job sees progress.
        _ = Task.Run(async () =>
        {
            for (var i = 0; i < 120 && !ct.IsCancellationRequested; i++)
            {
                await Task.Delay(TimeSpan.FromMinutes(1));
                await ScanGamesAsync(CancellationToken.None);
                var key = spec!.Kind == "STEAM" ? spec.AppId : spec.AppName;
                if (_inventory.FirstOrDefault(g => g.Key == key) is { UpdateRequired: false }) break;
            }
        });
        return ExecResult.Success(new { started = plan.FileName });
    }

    // ── processes ──────────────────────────────────────────────────────────

    private static bool IsService => WindowsServiceHelpers.IsWindowsService();

    private bool Start(LaunchPlan plan, out string? error)
    {
        error = null;
        try
        {
            if (IsService) Native.StartInUserSession(plan.FileName, plan.Arguments, plan.WorkingDirectory);
            else Process.Start(new ProcessStartInfo(plan.FileName, plan.Arguments) { UseShellExecute = false, WorkingDirectory = plan.WorkingDirectory ?? "" })?.Dispose();
            log.LogInformation("Started {File} {Args}", plan.FileName, plan.Arguments);
            return true;
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException or FileNotFoundException)
        {
            log.LogWarning("Could not start {File}: {Message}", plan.FileName, e.Message);
            error = "Couldn't start it on this PC. Please ask staff.";
            return false;
        }
    }

    /// <summary>Waits for the game's process to appear, then reports "playing" until it's gone.</summary>
    private void Watch(LibraryGame game)
    {
        _watch?.Cancel();
        var cts = _watch = new CancellationTokenSource();
        var names = game.ProcessNames.Select(n => Path.GetFileNameWithoutExtension(n)).Where(n => n.Length > 0).ToArray();
        if (names.Length == 0) return;
        _ = Task.Run(async () =>
        {
            try
            {
                var deadline = DateTimeOffset.UtcNow.AddMinutes(5); // launchers may update first
                while (!Running(names))
                {
                    if (DateTimeOffset.UtcNow > deadline) return;
                    await Task.Delay(3000, cts.Token);
                }
                SetPlaying(game, sessions.Current?.SessionId);
                while (Running(names)) await Task.Delay(5000, cts.Token);
                SetPlaying(null, sessions.Current?.SessionId);
            }
            catch (OperationCanceledException) { }
        });
    }

    private void SetPlaying(LibraryGame? game, string? sessionId)
    {
        var before = _playing;
        _playing = game is null ? null : (game.Id, game.Title);
        if (before?.Id == _playing?.Id) return;
        shell.Broadcast(ShellProtocol.Playing(_playing?.Id, _playing?.Title));
        var id = _playing?.Id ?? before?.Id;
        if (id is not null) _ = server.TrySendAsync(Outgoing.GameEvent(game is null ? "exited" : "started", id, sessionId));
    }

    private static bool Running(string[] names) => names.Any(n => Process.GetProcessesByName(n).Any(p => { using (p) return p.SessionId != 0; }));

    /// <summary>Closes the library's games and the launchers (their logins belong to the customer who just left).</summary>
    private int CloseGames()
    {
        var names = (_config?.Games ?? []).SelectMany(g => g.ProcessNames).Select(n => Path.GetFileNameWithoutExtension(n)).Concat(LauncherProcesses)
            .Where(n => n.Length > 0 && !Protected.Contains(n)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var closed = 0;
        foreach (var name in names)
        {
            foreach (var p in Process.GetProcessesByName(name))
            {
                using (p)
                {
                    if (p.SessionId == 0) continue; // never touch services
                    if (_safeMode) { closed++; continue; } // counted, not killed
                    try { p.Kill(entireProcessTree: true); closed++; } catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { }
                }
            }
        }
        return closed;
    }

    private void ReloadShell() => shell.Broadcast(ShellProtocol.Reload);
}
