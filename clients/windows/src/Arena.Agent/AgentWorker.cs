using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Arena.Agent.Core;
using Arena.Agent.Shell;
using Arena.Agent.Windows;

namespace Arena.Agent;

/// <summary>
/// Keeps the station connected: authenticate (proof-of-possession), say hello,
/// send hardware + heartbeats, and run verified commands. Reconnects forever
/// with jittered exponential backoff; the PC keeps working while offline.
/// Also the go-between for the Gaming Shell: logins typed on the Shell are
/// relayed to the server, and the session state that comes back as signed
/// commands is what the Shell displays.
/// </summary>
public sealed class AgentWorker(
    AgentPaths paths,
    MetricsCollector metrics,
    CommandExecutor executor,
    SessionManager sessions,
    ShellHub shell,
    ILogger<AgentWorker> log) : BackgroundService
{
    public static readonly string Version = typeof(AgentWorker).Assembly.GetName().Version?.ToString(3) ?? "0.1.0";

    /// <summary>Sends on the live WebSocket; null while offline.</summary>
    private volatile Func<string, Task>? _send;
    private readonly ConcurrentDictionary<string, DateTimeOffset> _pendingLogins = new();
    private bool _safeMode;

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        if (!File.Exists(paths.Identity) || !File.Exists(paths.Key))
        {
            log.LogCritical("Not enrolled. Run: ArenaAgent enroll --api <url> --code <code>  (data dir: {Dir})", paths.DataDir);
            return;
        }
        var identity = AgentIdentity.Load(paths.Identity);
        using var key = KeyStore.Load(paths.Key);
        var verifier = new CommandVerifier(identity);
        var replay = new ReplayStore(paths.Replay);
        log.LogInformation("ArenaOS agent {Version} for {Name} ({DeviceId}) → {Api}{Safe}", Version, identity.Name, identity.DeviceId, identity.ApiUrl,
            identity.SafeMode ? " [SAFE MODE: disruptive commands are simulated]" : "");
        _safeMode = identity.SafeMode;
        shell.Configure(identity.Name, identity.SafeMode, LoadVenue());
        shell.LoginRequested += OnShellLogin;
        shell.LogoutRequested += OnShellLogout;
        if (sessions.Current is { } resumed)
            log.LogInformation("Resuming session {SessionId} for {Customer} (expires {Expires:u})", resumed.SessionId, resumed.CustomerName, resumed.ExpiresAt);

        var attempt = 0;
        while (!stop.IsCancellationRequested)
        {
            try
            {
                await RunConnectionAsync(identity, key, verifier, replay, stop);
                attempt = 0;
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested)
            {
                break;
            }
            catch (WebSocketException e) when (e.Message.Contains("401"))
            {
                log.LogError("The server rejected this station (retired or re-enrolled elsewhere). Re-enrol with a new code. Retrying in 5 minutes.");
                await Delay(TimeSpan.FromMinutes(5), stop);
                continue;
            }
            catch (Exception e)
            {
                log.LogWarning("Connection lost: {Message}", e.Message);
            }
            attempt++;
            var backoff = TimeSpan.FromSeconds(Math.Min(60, Math.Pow(2, Math.Min(attempt, 6))) * (0.5 + Random.Shared.NextDouble()));
            log.LogInformation("Reconnecting in {Seconds:0}s", backoff.TotalSeconds);
            await Delay(backoff, stop);
        }
    }

    private async Task RunConnectionAsync(AgentIdentity identity, ECDsa key, CommandVerifier verifier, ReplayStore replay, CancellationToken stop)
    {
        using var ws = new ClientWebSocket();
        ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
        ws.Options.SetRequestHeader("Authorization", "Bearer " + DeviceAssertion.Create(key, identity.DeviceId, identity.OrganizationId, DateTimeOffset.UtcNow));
        await ws.ConnectAsync(identity.WebSocketUri(), stop);

        var nic = PrimaryNic.Detect();
        var sendLock = new SemaphoreSlim(1, 1);
        async Task Send(string json)
        {
            await sendLock.WaitAsync(stop);
            try { await ws.SendAsync(Encoding.UTF8.GetBytes(json), WebSocketMessageType.Text, true, stop); }
            finally { sendLock.Release(); }
        }

        // Expect "welcome" first.
        var welcome = await ReceiveAsync(ws, stop) ?? throw new WebSocketException("closed before welcome");
        using (var w = JsonDocument.Parse(welcome))
        {
            var root = w.RootElement;
            if (root.GetProperty("type").GetString() != "welcome") throw new WebSocketException("expected welcome");
            var heartbeat = root.TryGetProperty("heartbeatSeconds", out var hb) ? hb.GetInt32() : identity.HeartbeatSeconds;
            log.LogInformation("Connected as {Name}; heartbeat every {Seconds}s", root.GetProperty("deviceName").GetString(), heartbeat);
            if (root.TryGetProperty("serverTime", out var st) && st.TryGetDateTimeOffset(out var serverTime)) sessions.SyncClock(serverTime, DateTimeOffset.UtcNow);
            if (root.TryGetProperty("venue", out var v) && v.ValueKind == JsonValueKind.Object)
            {
                var venue = new VenueInfo(v.GetProperty("name").GetString() ?? "ArenaOS", v.GetProperty("branchName").GetString() ?? "",
                    v.TryGetProperty("logoUrl", out var logo) && logo.ValueKind == JsonValueKind.String ? logo.GetString() : null);
                shell.SetVenue(venue);
                SaveVenue(venue);
            }

            // activeSessionId lets the server correct us: END a session that finished while we were away, or re-START one we lost.
            await Send(Outgoing.Hello(Version, nic?.Ipv4, Environment.MachineName, nic?.Mac, sessions.Current?.SessionId));
            await Send(Outgoing.Hardware(HardwareCollector.Collect(nic)));
            _send = Send;
            shell.SetConnected(true);

            using var linked = CancellationTokenSource.CreateLinkedTokenSource(stop);
            var beats = Task.Run(async () =>
            {
                while (!linked.IsCancellationRequested)
                {
                    var m = await metrics.SampleAsync(nic?.Gateway, linked.Token);
                    var shellState = shell.ClientCount == 0 ? "NO_SHELL" : sessions.Current is null ? "LOCKED" : "IN_SESSION";
                    await Send(Outgoing.Heartbeat(m with { ShellState = shellState }));
                    await Task.Delay(TimeSpan.FromSeconds(heartbeat), linked.Token);
                }
            }, linked.Token);

            try
            {
                while (ws.State == WebSocketState.Open)
                {
                    var text = await ReceiveAsync(ws, stop);
                    if (text is null) break;
                    await HandleAsync(text, identity, verifier, replay, Send, stop);
                }
            }
            finally
            {
                _send = null;
                shell.SetConnected(false);
                FailPendingLogins();
                linked.Cancel();
                try { await beats; } catch (OperationCanceledException) { }
            }
        }
    }

    private async Task HandleAsync(string text, AgentIdentity identity, CommandVerifier verifier, ReplayStore replay, Func<string, Task> send, CancellationToken ct)
    {
        using var doc = JsonDocument.Parse(text);
        var type = doc.RootElement.GetProperty("type").GetString();
        if (type == "error") { log.LogWarning("Server says: {Error}", doc.RootElement.GetProperty("error").GetString()); return; }
        if (type == "shell_result") { OnShellResult(doc.RootElement); return; }
        if (type != "command") return;

        var cmd = doc.RootElement.GetProperty("command").Deserialize<SignedCommand>(Json.Options)!;
        var (result, e) = verifier.Verify(cmd, DateTimeOffset.UtcNow, replay.Seen);
        if (result != VerifyResult.Ok || e is null)
        {
            // Never execute — and never ack — something we could not verify.
            log.LogWarning("REJECTED command ({Result})", result);
            return;
        }
        replay.Add(e.CommandId, DateTimeOffset.UtcNow);
        await send(Outgoing.Ack(e.CommandId, "RECEIVED"));
        await send(Outgoing.Ack(e.CommandId, "EXECUTING"));
        log.LogInformation("Executing {Type} ({CommandId}) requested by {By}", e.Type, e.CommandId, e.RequestedBy.Type);
        var r = await ExecuteAsync(e, identity.SafeMode, ct);
        await send(r.Ok ? Outgoing.Ack(e.CommandId, "SUCCESS", result: r.Result) : Outgoing.Ack(e.CommandId, "FAILED", r.ErrorCode, r.ErrorMessage));
    }

    private async Task<ExecResult> ExecuteAsync(CommandEnvelope e, bool safeMode, CancellationToken ct)
    {
        switch (e.Type)
        {
            case "START_SESSION":
            case "EXTEND_SESSION":
            case "END_SESSION":
                var action = sessions.Apply(e.Type, e.Payload, DateTimeOffset.UtcNow);
                if (action is not null) RunPostSessionLater(action);
                var s = sessions.Current;
                return ExecResult.Success(new { sessionId = s?.SessionId, expiresAt = s?.ExpiresAt, shell = shell.ClientCount > 0 });

            case "SEND_MESSAGE" when shell.ClientCount > 0:
                shell.SendMessage(PayloadString(e.Payload, "title") ?? "Message from staff", PayloadString(e.Payload, "message") ?? "");
                return ExecResult.Success(new { shown = true, via = "shell" });

            default:
                return await executor.ExecuteAsync(e, safeMode, ct);
        }
    }

    /// <summary>Gives the customer a few seconds of "Time's up" before Windows-level actions (restart, log off).</summary>
    private void RunPostSessionLater(string action)
    {
        if (action is "LOCK" or "RESTART_SHELL") return;
        _ = Task.Run(async () =>
        {
            await Task.Delay(TimeSpan.FromSeconds(10));
            if (sessions.Current is not null) return; // a new session started meanwhile — don't restart under it
            var r = executor.PostSession(action, _safeMode);
            log.LogInformation("Post-session {Action}: {Result}", action, r.Ok ? "done" : r.ErrorMessage);
        });
    }

    // ── Gaming Shell relay ─────────────────────────────────────────────────

    private async Task OnShellLogin(ShellRequest.Login login)
    {
        var send = _send;
        if (send is null)
        {
            shell.SendLoginResult(login.RequestId, false, "offline", "The venue is offline right now. Please ask staff.");
            return;
        }
        if (sessions.Current is not null)
        {
            shell.SendLoginResult(login.RequestId, false, "station_in_use", "This station already has a session running.");
            return;
        }
        _pendingLogins[login.RequestId] = DateTimeOffset.UtcNow;
        try { await send(Outgoing.ShellLogin(login.RequestId, login.Username, login.Secret)); }
        catch (Exception e)
        {
            _pendingLogins.TryRemove(login.RequestId, out _);
            shell.SendLoginResult(login.RequestId, false, "offline", "Couldn't reach the venue. Please try again.");
            log.LogWarning("Shell login relay failed: {Message}", e.Message);
        }
    }

    private async Task OnShellLogout()
    {
        var s = sessions.Current;
        if (s is null) return;
        var send = _send;
        if (send is null)
        {
            // The server owns billing; ending locally would only stop the clock on this PC.
            shell.SendMessage("Can't log out right now", "The venue is offline. Please ask a member of staff to end your session.");
            return;
        }
        try { await send(Outgoing.ShellLogout(Guid.NewGuid().ToString(), s.SessionId)); }
        catch (Exception e) { log.LogWarning("Shell logout relay failed: {Message}", e.Message); }
    }

    private void OnShellResult(JsonElement r)
    {
        var requestId = PayloadString(r, "requestId");
        if (requestId is null || !_pendingLogins.TryRemove(requestId, out _)) return; // logout results and strays
        var ok = r.TryGetProperty("ok", out var o) && o.ValueKind == JsonValueKind.True;
        shell.SendLoginResult(requestId, ok, PayloadString(r, "error"), PayloadString(r, "message"));
        // On success the signed START_SESSION command follows and unlocks the Shell — never this reply.
    }

    private void FailPendingLogins()
    {
        foreach (var id in _pendingLogins.Keys)
            if (_pendingLogins.TryRemove(id, out _)) shell.SendLoginResult(id, false, "offline", "Lost connection to the venue. Please try again.");
    }

    private VenueInfo? LoadVenue()
    {
        try { return File.Exists(paths.Venue) ? JsonSerializer.Deserialize<VenueInfo>(File.ReadAllText(paths.Venue), Json.Options) : null; }
        catch (Exception) { return null; }
    }

    private void SaveVenue(VenueInfo venue)
    {
        try { File.WriteAllText(paths.Venue, JsonSerializer.Serialize(venue, Json.Options)); } catch (IOException) { }
    }

    private static string? PayloadString(JsonElement p, string name) =>
        p.ValueKind == JsonValueKind.Object && p.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static async Task<string?> ReceiveAsync(ClientWebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[16 * 1024];
        using var ms = new MemoryStream();
        while (true)
        {
            var r = await ws.ReceiveAsync(buffer, ct);
            if (r.MessageType == WebSocketMessageType.Close) return null;
            ms.Write(buffer, 0, r.Count);
            if (ms.Length > 512 * 1024) throw new WebSocketException("message too large");
            if (r.EndOfMessage) return Encoding.UTF8.GetString(ms.ToArray());
        }
    }

    private static async Task Delay(TimeSpan t, CancellationToken ct)
    {
        try { await Task.Delay(t, ct); } catch (OperationCanceledException) { }
    }
}
