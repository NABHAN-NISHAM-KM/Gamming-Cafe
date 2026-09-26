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
/// Only runs as the Windows service: in a console (`ArenaAgent run`) the agent
/// isn't SYSTEM and can't start programs on another user's desktop.
/// </summary>
public sealed class ShellSupervisor(AgentPaths paths, ILogger<ShellSupervisor> log) : BackgroundService
{
    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(3);

    /// <summary>ARENA_SHELL_EXE, else the installed layout: %ProgramFiles%\ArenaOS\{Agent,Shell}.</summary>
    public static string ShellExe =>
        Environment.GetEnvironmentVariable("ARENA_SHELL_EXE")
        ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "Shell", "ArenaShell.exe"));

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        if (!WindowsServiceHelpers.IsWindowsService() || !File.Exists(paths.Identity)) return;
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
                var state = new ConsoleState(user is not null, user?.IsAdmin ?? false, user is { } u && ShellRunningIn(u.SessionId));
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
