namespace Arena.Agent.Core;

/// <summary>
/// Stops password guessing at the Shell's Shift+F12 staff exit: <see cref="MaxFailures"/>
/// wrong sign-ins lock it for <see cref="Lockout"/>. (Windows' own account lockout still applies too.)
/// </summary>
public sealed class StaffExitGuard
{
    public const int MaxFailures = 5;
    public static readonly TimeSpan Lockout = TimeSpan.FromMinutes(5);

    private int _failures;
    private DateTimeOffset? _lockedUntil;

    public bool IsLocked(DateTimeOffset now)
    {
        if (_lockedUntil is { } until && now >= until) { _lockedUntil = null; _failures = 0; }
        return _lockedUntil is not null;
    }

    public void Record(bool ok, DateTimeOffset now)
    {
        if (ok) { _failures = 0; return; }
        if (++_failures >= MaxFailures) _lockedUntil = now + Lockout;
    }
}
