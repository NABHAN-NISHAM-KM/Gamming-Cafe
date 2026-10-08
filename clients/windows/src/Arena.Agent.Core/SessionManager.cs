using System.Text.Json;

namespace Arena.Agent.Core;

/// <summary>A session as the PC knows it. Times are server times.</summary>
public sealed record SessionState(
    string SessionId,
    string CustomerName,
    string? MembershipTier,
    DateTimeOffset StartedAt,
    DateTimeOffset? ExpiresAt,
    int[] WarningMinutes,
    string PostSessionAction,
    bool AllowSelfExtend,
    int? CustomerAge = null,
    string[]? BlockedGameIds = null); // games staff blocked for this customer

public enum SessionEvent { Started, Extended, Ended, ExpiredLocally }

/// <summary>
/// The station's view of its session. The SERVER is authoritative: START /
/// EXTEND / END arrive as signed commands. The agent persists the state so a
/// reboot or shell crash never unlocks a PC for free, and it enforces expiry
/// LOCALLY as a fail-safe when the server can't be reached (grace period
/// covers normal clock/latency drift — the server's END normally wins).
/// </summary>
public sealed class SessionManager
{
    private readonly string? _path;
    private readonly TimeSpan _failSafeGrace;
    private readonly object _gate = new();
    private SessionState? _current;

    /// <summary>serverNow − localNow, learned from each command's serverTime.</summary>
    public TimeSpan ClockOffset { get; private set; }

    public event Action<SessionEvent, SessionState?>? Changed;

    public SessionManager(string? persistPath, TimeSpan? failSafeGrace = null)
    {
        _path = persistPath;
        _failSafeGrace = failSafeGrace ?? TimeSpan.FromSeconds(20);
        if (_path is not null && File.Exists(_path))
        {
            try { _current = JsonSerializer.Deserialize<SessionState>(File.ReadAllText(_path), Json.Options); }
            catch (JsonException) { _current = null; }
        }
    }

    public SessionState? Current { get { lock (_gate) return _current; } }

    public DateTimeOffset ServerNow(DateTimeOffset localNow) => localNow + ClockOffset;

    public TimeSpan? Remaining(DateTimeOffset localNow)
    {
        var s = Current;
        return s?.ExpiresAt is { } exp ? (exp - ServerNow(localNow)) is var r && r > TimeSpan.Zero ? r : TimeSpan.Zero : null;
    }

    /// <summary>Learns the server clock from the WebSocket welcome (every reconnect).</summary>
    public void SyncClock(DateTimeOffset serverTime, DateTimeOffset localNow) => ClockOffset = serverTime - localNow;

    private void LearnClock(JsonElement payload, DateTimeOffset localNow)
    {
        if (payload.TryGetProperty("serverTime", out var st) && st.TryGetDateTimeOffset(out var server)) ClockOffset = server - localNow;
    }

    /// <summary>Applies a VERIFIED session command. Returns the post-session action for END, else null.</summary>
    public string? Apply(string type, JsonElement payload, DateTimeOffset localNow)
    {
        LearnClock(payload, localNow);
        lock (_gate)
        {
            switch (type)
            {
                case "START_SESSION":
                {
                    var s = new SessionState(
                        payload.GetProperty("sessionId").GetString()!,
                        payload.GetProperty("customer").GetProperty("displayName").GetString() ?? "Guest",
                        payload.GetProperty("customer").TryGetProperty("membershipTier", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null,
                        payload.GetProperty("startedAt").GetDateTimeOffset(),
                        payload.TryGetProperty("expiresAt", out var e) && e.ValueKind == JsonValueKind.String ? e.GetDateTimeOffset() : null,
                        payload.TryGetProperty("warningMinutes", out var w) ? w.EnumerateArray().Select(x => x.GetInt32()).ToArray() : [30, 15, 10, 5, 1],
                        payload.TryGetProperty("postSessionAction", out var p) ? p.GetString() ?? "LOCK" : "LOCK",
                        payload.TryGetProperty("allowSelfExtend", out var a) && a.GetBoolean(),
                        payload.GetProperty("customer").TryGetProperty("age", out var age) && age.ValueKind == JsonValueKind.Number && age.TryGetInt32(out var years) ? years : null,
                        payload.GetProperty("customer").TryGetProperty("blockedGameIds", out var bg) && bg.ValueKind == JsonValueKind.Array ? bg.EnumerateArray().Select(x => x.GetString()!).ToArray() : null);
                    _current = s; // idempotent: a re-sent START for the same session just refreshes it
                    Persist();
                    Raise(SessionEvent.Started, s);
                    return null;
                }
                case "EXTEND_SESSION":
                {
                    var id = payload.GetProperty("sessionId").GetString();
                    if (_current is null || _current.SessionId != id) return null;
                    _current = _current with { ExpiresAt = payload.GetProperty("expiresAt").GetDateTimeOffset() };
                    Persist();
                    Raise(SessionEvent.Extended, _current);
                    return null;
                }
                case "END_SESSION":
                {
                    var id = payload.TryGetProperty("sessionId", out var sid) && sid.ValueKind == JsonValueKind.String ? sid.GetString() : null;
                    // END for another (older) session must not end the current one.
                    if (_current is not null && id is not null && _current.SessionId != id) return null;
                    var action = payload.TryGetProperty("postSessionAction", out var p) ? p.GetString() ?? "LOCK" : "LOCK";
                    var ended = _current;
                    _current = null;
                    Persist();
                    Raise(SessionEvent.Ended, ended);
                    return action;
                }
            }
        }
        return null;
    }

    /// <summary>
    /// Fail-safe: if the server's END hasn't arrived by expiry + grace (server
    /// offline, network cut), lock locally. Call every second.
    /// </summary>
    public bool Tick(DateTimeOffset localNow)
    {
        lock (_gate)
        {
            if (_current?.ExpiresAt is not { } exp) return false;
            if (ServerNow(localNow) < exp + _failSafeGrace) return false;
            var ended = _current;
            _current = null;
            Persist();
            Raise(SessionEvent.ExpiredLocally, ended);
            return true;
        }
    }

    private void Persist()
    {
        if (_path is null) return;
        if (_current is null) { if (File.Exists(_path)) File.Delete(_path); return; }
        var tmp = _path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(_current, Json.Options));
        File.Move(tmp, _path, overwrite: true);
    }

    private void Raise(SessionEvent e, SessionState? s)
    {
        try { Changed?.Invoke(e, s); } catch { /* listeners must not break state handling */ }
    }
}
