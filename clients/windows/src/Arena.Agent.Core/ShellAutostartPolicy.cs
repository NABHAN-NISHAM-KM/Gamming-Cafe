namespace Arena.Agent.Core;

/// <summary>What the console session looks like right now (gathered by the agent).</summary>
public readonly record struct ConsoleState(bool UserSignedIn, bool UserIsAdmin, bool ShellRunning);

/// <summary>
/// Decides when the agent (re)starts the Gaming Shell on the customer's
/// desktop. Pure, so it is unit-tested; the Windows side lives in
/// ShellSupervisor.
///
/// - Only when the station is a real gaming PC: not in safe mode (an office PC
///   trying the agent keeps its normal desktop) and the Shell is installed.
/// - Only for standard (non-admin) Windows users, so staff can still sign in
///   with an administrator account for maintenance.
/// - A killed or crashed Shell comes back within one tick. If it keeps dying
///   (<see cref="MaxLaunches"/> launches inside <see cref="Window"/>), it backs
///   off for <see cref="Backoff"/> rather than spinning.
/// </summary>
public sealed class ShellAutostartPolicy(bool safeMode, bool shellInstalled)
{
    public const int MaxLaunches = 5;
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(2);
    public static readonly TimeSpan Backoff = TimeSpan.FromMinutes(5);

    private readonly Queue<DateTimeOffset> _launches = new();
    private DateTimeOffset? _backoffUntil;

    public bool Enabled => !safeMode && shellInstalled;

    /// <summary>True when the agent should start the Shell now. Records the launch.</summary>
    public bool ShouldLaunch(ConsoleState s, DateTimeOffset now)
    {
        if (!Enabled || !s.UserSignedIn || s.UserIsAdmin || s.ShellRunning) return false;
        if (_backoffUntil is { } until)
        {
            if (now < until) return false;
            _backoffUntil = null;
            _launches.Clear();
        }
        while (_launches.Count > 0 && now - _launches.Peek() > Window) _launches.Dequeue();
        if (_launches.Count >= MaxLaunches)
        {
            _backoffUntil = now + Backoff;
            return false;
        }
        _launches.Enqueue(now);
        return true;
    }

    /// <summary>True while launches are paused because the Shell kept exiting.</summary>
    public bool BackingOff(DateTimeOffset now) => _backoffUntil is { } until && now < until;
}
