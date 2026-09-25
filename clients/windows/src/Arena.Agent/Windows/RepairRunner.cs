using System.Diagnostics;
using System.ServiceProcess;
using Arena.Agent.Core.Stations;

namespace Arena.Agent.Windows;

/// <summary>
/// The allow-listed repairs. Each action maps to fixed steps written here —
/// the server (or the customer) only picks the action name; no command line
/// ever comes from outside.
/// </summary>
public sealed class RepairRunner(ILogger<RepairRunner> log)
{
    public async Task<ExecResult> RunAsync(string action, bool safeMode, Func<int> closeGames, Action reloadShell, CancellationToken ct)
    {
        if (!RepairActions.IsKnown(action)) return ExecResult.Fail("UNKNOWN_ACTION", action);
        if (safeMode && !RepairActions.SafeInSafeMode.Contains(action))
        {
            log.LogInformation("SAFE MODE: simulated repair {Action}", action);
            return ExecResult.Success(new { simulated = true, action });
        }
        try
        {
            switch (action)
            {
                case "FLUSH_DNS":
                    return await Tool("ipconfig.exe", "/flushdns", ct);
                case "RENEW_IP":
                    return await Tool("ipconfig.exe", "/renew", ct, TimeSpan.FromSeconds(60));
                case "SYNC_TIME":
                    return await Tool("w32tm.exe", "/resync /force", ct);
                case "RESTART_AUDIO":
                    await Task.Run(() => RestartService("Audiosrv"), ct);
                    return ExecResult.Success(new { action, restarted = "Audiosrv" });
                case "CLEAR_TEMP":
                    return ExecResult.Success(new { action, deleted = await Task.Run(ClearTemp, ct) });
                case "RESTART_SHELL":
                    reloadShell();
                    return ExecResult.Success(new { action });
                case "CLOSE_GAMES":
                    return ExecResult.Success(new { action, closed = closeGames() });
            }
        }
        catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception or System.ServiceProcess.TimeoutException or UnauthorizedAccessException)
        {
            log.LogWarning("Repair {Action} failed: {Message}", action, e.Message);
            return ExecResult.Fail("REPAIR_FAILED", e.Message);
        }
        return ExecResult.Fail("UNKNOWN_ACTION", action);
    }

    private static async Task<ExecResult> Tool(string exe, string args, CancellationToken ct, TimeSpan? timeout = null)
    {
        using var p = Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, exe), args)
        {
            CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true,
        })!;
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(timeout ?? TimeSpan.FromSeconds(30));
        try { await p.WaitForExitAsync(cts.Token); }
        catch (OperationCanceledException) { try { p.Kill(); } catch (InvalidOperationException) { } return ExecResult.Fail("TIMEOUT", $"{exe} took too long"); }
        return p.ExitCode == 0 ? ExecResult.Success(new { tool = exe }) : ExecResult.Fail("TOOL_FAILED", $"{exe} exited with {p.ExitCode} (needs to run as the ArenaAgent service)");
    }

    private static void RestartService(string name)
    {
        using var sc = new ServiceController(name);
        if (sc.Status != ServiceControllerStatus.Stopped)
        {
            sc.Stop(stopDependentServices: true);
            sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(20));
        }
        sc.Start();
        sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(20));
    }

    /// <summary>Old files in the Windows temp folder (in use or recent files are left alone).</summary>
    private static int ClearTemp()
    {
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Temp");
        var cutoff = DateTime.UtcNow.AddDays(-1);
        var n = 0;
        foreach (var f in Directory.EnumerateFiles(dir, "*", new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true }))
        {
            try
            {
                if (File.GetLastWriteTimeUtc(f) > cutoff) continue;
                File.Delete(f);
                n++;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        }
        return n;
    }
}
