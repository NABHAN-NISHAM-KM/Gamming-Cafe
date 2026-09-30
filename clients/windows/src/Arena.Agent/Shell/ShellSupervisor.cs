using System.Diagnostics;
using Arena.Agent.Core;
using Arena.Agent.Windows;
using Microsoft.Extensions.Hosting.WindowsServices;

namespace Arena.Agent.Shell;

/// <summary>
/// Keeps the Gaming Shell running full-screen on the customer's desktop. When
/// a standard Windows user signs in, the agent (LocalSystem) starts
/// <c>ArenaShell.exe --kiosk</c> in their session; if the Shell is closed or
/// killed (Task Manager), it is back within a few seconds. The rules are in
/// <see cref="ShellAutostartPolicy"/>: never in safe mode, never for
/// administrators, and a back-off if the Shell keeps crashing.
///
/// Also the kiosk lock for that user (<see cref="Kiosk"/>) and the staff exit:
/// Shift+F12 plus the staff exit login chosen at install (<see cref="StaffExitLogin"/>),
/// or else any Windows administrator account on this PC, closes the Shell and opens
/// the normal Windows desktop in the same (customer) account, until that user signs
/// out or the PC restarts. No server needed.
///
/// Only runs as the Windows service: in a console (`ArenaAgent run`) the agent
/// isn't SYSTEM and can't start programs on another user's desktop.
/// </summary>
public sealed class ShellSupervisor(AgentPaths paths, ShellHub hub, ILogger<ShellSupervisor> log) : BackgroundService
{
    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(3);
    private readonly StaffExitGuard _guard = new();
    private readonly SemaphoreSlim _exitGate = new(1, 1);
    private long _desktopSession = -1; // staff unlocked the desktop in this Windows session
    private long _lockedSession = -1;  // kiosk lock applied for this Windows session

    /// <summary>ARENA_SHELL_EXE, else the installed layout: %ProgramFiles%\ArenaOS\{Agent,Shell}.</summary>
    public static string ShellExe =>
        Environment.GetEnvironmentVariable("ARENA_SHELL_EXE")
        ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "Shell", "ArenaShell.exe"));

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        if (!WindowsServiceHelpers.IsWindowsService() || !File.Exists(paths.Identity)) return;
        hub.StaffExitRequested += OnStaffExit;
        var exe = ShellExe;
        var policy = new ShellAutostartPolicy(AgentIdentity.Load(paths.Identity).SafeMode, File.Exists(exe));
        if (!policy.Enabled)
        {
            log.LogInformation(File.Exists(exe)
                ? "Shell autostart is off in safe mode."
                : "Shell autostart is off: {Exe} not found. Install the Shell next to the agent (install-agent.ps1).", exe);
            return;
        }
        log.LogInformation("Shell autostart on: {Exe} --kiosk for standard Windows users.", exe);

        var wasBackingOff = false;
        using var timer = new PeriodicTimer(Tick);
        do
        {
            try
            {
                var now = DateTimeOffset.UtcNow;
                var user = Native.ConsoleUser();
                if (user is null) // signed out: the next sign-in is locked again, even if Windows reuses the session number
                {
                    Interlocked.Exchange(ref _desktopSession, -1);
                    Interlocked.Exchange(ref _lockedSession, -1);
                }
                var onDesktop = user is { } du && du.SessionId == Interlocked.Read(ref _desktopSession);
                if (user is { IsAdmin: false } lu && !onDesktop && lu.SessionId != Interlocked.Read(ref _lockedSession))
                {
                    Kiosk.SetLockdown(lu.Sid, true);
                    Interlocked.Exchange(ref _lockedSession, lu.SessionId);
                }
                // Staff are on the desktop: report it as "no user" so the Shell stays closed.
                var state = new ConsoleState(user is not null && !onDesktop, user?.IsAdmin ?? false, user is { } u && ShellRunningIn(u.SessionId));
                if (policy.ShouldLaunch(state, now))
                {
                    var pid = Native.StartInUserSession(exe, "--kiosk", Path.GetDirectoryName(exe));
                    log.LogInformation("Started the Gaming Shell (pid {Pid}) in session {Session}.", pid, user!.Value.SessionId);
                }
                var backingOff = policy.BackingOff(now);
                if (backingOff && !wasBackingOff)
                    log.LogError("The Gaming Shell exited {Count} times in {Minutes} min; pausing autostart for {Backoff} min.",
                        ShellAutostartPolicy.MaxLaunches, ShellAutostartPolicy.Window.TotalMinutes, ShellAutostartPolicy.Backoff.TotalMinutes);
                wasBackingOff = backingOff;
            }
            catch (Exception ex)
            {
                // Typically a user signing in or out between the checks; try again next tick.
                log.LogDebug("Shell autostart: {Message}", ex.Message);
            }
        } while (await timer.WaitForNextTickAsync(stop).ConfigureAwait(false));
    }

    private async Task OnStaffExit(ShellRequest.StaffExit request)
    {
        void Reply(bool ok, string? error = null, string? message = null) =>
            hub.Broadcast(ShellProtocol.Result("staff_exit_result", request.RequestId, ok, error, message));

        if (!await _exitGate.WaitAsync(0)) return; // one at a time
        try
        {
            var now = DateTimeOffset.UtcNow;
            if (_guard.IsLocked(now)) { Reply(false, "locked", "Too many wrong tries. Try again in 5 minutes."); return; }
            var saved = File.Exists(paths.StaffExit) ? StaffExitLogin.Parse(await File.ReadAllTextAsync(paths.StaffExit)) : null;
            var ok = await Task.Run(() => saved?.Matches(request.Username, request.Password) == true
                                          || Native.IsWindowsAdmin(request.Username, request.Password));
            _guard.Record(ok, now);
            if (!ok)
            {
                log.LogWarning("Staff exit refused for {User}: wrong username or password.", request.Username);
                Reply(false, "denied", "Wrong username or password.");
                return;
            }
            if (Native.ConsoleUser() is not { } user) { Reply(false, "no_user", "Nobody is signed in to Windows."); return; }

            log.LogWarning("Staff exit by {User}: leaving the Gaming Shell for the desktop (session {Session}).", request.Username, user.SessionId);
            Reply(true);
            Interlocked.Exchange(ref _desktopSession, user.SessionId);
            Kiosk.SetLockdown(user.Sid, false);
            Interlocked.Exchange(ref _lockedSession, -1);
            await Task.Delay(500); // let the Shell show "Opening Windows…"
            await Kiosk.OpenDesktopAsync(user.Sid, () => CloseShellIn(user.SessionId));
        }
        catch (Exception e)
        {
            log.LogError(e, "Staff exit failed");
            Reply(false, "failed", "Couldn't open the Windows desktop. Try again or restart the PC.");
        }
        finally
        {
            _exitGate.Release();
        }
    }

    private static void CloseShellIn(uint sessionId)
    {
        foreach (var p in Process.GetProcessesByName("ArenaShell"))
        {
            using (p)
            {
                if (p.SessionId == sessionId) p.Kill(entireProcessTree: true);
            }
        }
    }

    private static bool ShellRunningIn(uint sessionId)
    {
        var running = false;
        foreach (var p in Process.GetProcessesByName("ArenaShell"))
        {
            using (p) running |= p.SessionId == sessionId;
        }
        return running;
    }
}
