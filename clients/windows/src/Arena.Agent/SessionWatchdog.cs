using Arena.Agent.Core;

namespace Arena.Agent;

/// <summary>
/// Fail-safe session expiry. The server ends sessions (and its END normally
/// arrives first); this ticks every second so a PC that lost the network — or
/// was rebooted mid-session — still locks when time is up.
/// </summary>
public sealed class SessionWatchdog(SessionManager sessions, ILogger<SessionWatchdog> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        while (await timer.WaitForNextTickAsync(stop).ConfigureAwait(false) is true)
        {
            var s = sessions.Current;
            if (sessions.Tick(DateTimeOffset.UtcNow))
                log.LogWarning("Session {SessionId} expired without word from the server; locked locally (fail-safe).", s?.SessionId);
        }
    }
}
