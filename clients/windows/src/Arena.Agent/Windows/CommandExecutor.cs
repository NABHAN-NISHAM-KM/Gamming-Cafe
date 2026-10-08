using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Arena.Agent.Core;
using Microsoft.Extensions.Hosting.WindowsServices;

namespace Arena.Agent.Windows;

public sealed record ExecResult(bool Ok, object? Result = null, string? ErrorCode = null, string? ErrorMessage = null)
{
    public static ExecResult Success(object? result = null) => new(true, result);
    public static ExecResult Fail(string code, string message) => new(false, null, code, message);
}

/// <summary>
/// Executes VERIFIED commands only (CommandVerifier ran first). In safe mode,
/// disruptive commands are simulated so the agent can be tried on an office PC.
/// </summary>
public sealed class CommandExecutor(ILogger<CommandExecutor> log)
{
    private static readonly HashSet<string> Disruptive = ["RESTART", "SHUTDOWN", "LOGOUT", "LOCK", "LAUNCH_APP", "OPEN_GAME", "CLOSE_GAME"];

    /// <summary>Interpreters/LOLBins never launched remotely, even with a valid signature.</summary>
    private static readonly HashSet<string> DeniedExecutables = new(StringComparer.OrdinalIgnoreCase)
    {
        "cmd.exe", "powershell.exe", "pwsh.exe", "powershell_ise.exe", "wscript.exe", "cscript.exe", "mshta.exe", "rundll32.exe",
        "regsvr32.exe", "reg.exe", "regedit.exe", "certutil.exe", "bitsadmin.exe", "wmic.exe", "msiexec.exe", "schtasks.exe", "sc.exe", "net.exe",
    };

    private static readonly HashSet<string> ProtectedProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "explorer", "winlogon", "csrss", "lsass", "services", "svchost", "dwm", "smss", "wininit", "ArenaAgent", "ArenaShell",
    };

    private static bool IsService => WindowsServiceHelpers.IsWindowsService();

    public async Task<ExecResult> ExecuteAsync(CommandEnvelope e, bool safeMode, CancellationToken ct)
    {
        var p = e.Payload;
        try
        {
            if (safeMode && Disruptive.Contains(e.Type))
            {
                log.LogInformation("SAFE MODE: simulated {Type}", e.Type);
                return ExecResult.Success(new { simulated = true, safeMode = true, wouldRun = e.Type });
            }

            switch (e.Type)
            {
                case "SEND_MESSAGE":
                    return SendMessage(Str(p, "title") ?? "Message from staff", Str(p, "message") ?? "", (uint)(Int(p, "timeoutSeconds") ?? 30));

                case "WAKE_ON_LAN":
                    return await WakeOnLanAsync(Str(p, "macAddress"), ct);

                case "LOCK":
                    // The Shell's sign-in screen is the lock: with nobody playing it's already showing, and a
                    // Windows lock screen on top would need the Windows password. Only lock Windows without a Shell.
                    if (System.Diagnostics.Process.GetProcessesByName("ArenaShell").Length > 0) return ExecResult.Success(new { lockedBy = "shell" });
                    if (IsService) Native.StartInUserSession(Path.Combine(Environment.SystemDirectory, "rundll32.exe"), "user32.dll,LockWorkStation", null);
                    else if (!Native.LockWorkStation()) return ExecResult.Fail("LOCK_FAILED", "LockWorkStation failed");
                    return ExecResult.Success();

                case "RESTART":
                    return Shutdown("/r /t 5 /c \"Restarting (ArenaOS)\"");

                case "SHUTDOWN":
                    return Shutdown("/s /t 5 /c \"Shutting down (ArenaOS)\"");

                case "LOGOUT":
                    var session = Native.WTSGetActiveConsoleSessionId();
                    return session != Native.INVALID_SESSION && Native.WTSLogoffSession(Native.WTS_CURRENT_SERVER_HANDLE, session, false)
                        ? ExecResult.Success() : ExecResult.Fail("LOGOFF_FAILED", "No active user session or logoff failed");

                case "LAUNCH_APP":
                case "OPEN_GAME":
                    return Launch(Str(p, "executablePath"), Str(p, "arguments"), Str(p, "workingDirectory"));

                case "CLOSE_GAME":
                    return Close(p.TryGetProperty("processNames", out var names) ? names.EnumerateArray().Select(x => x.GetString() ?? "").ToList() : []);

                case "REFRESH_CONFIG":
                    return ExecResult.Success(new { refreshed = true });

                default:
                    // Session commands are handled by AgentWorker + SessionManager before reaching here.
                    // UNLOCK / maintenance / repair / screenshot arrive in later phases.
                    return ExecResult.Fail("NOT_SUPPORTED", $"{e.Type} is not supported by this agent version");
            }
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Command {Type} failed", e.Type);
            return ExecResult.Fail("EXCEPTION", ex.Message);
        }
    }

    /// <summary>
    /// What happens to the PC after a session ends. LOCK / RESTART_SHELL are the
    /// Shell's own lock screen (nothing to do here); the rest act on Windows and
    /// are simulated in safe mode.
    /// </summary>
    public ExecResult PostSession(string action, bool safeMode)
    {
        if (action is "LOCK" or "RESTART_SHELL") return ExecResult.Success(new { action });
        if (safeMode)
        {
            log.LogInformation("SAFE MODE: simulated post-session {Action}", action);
            return ExecResult.Success(new { simulated = true, action });
        }
        try
        {
            switch (action)
            {
                case "LOGOUT_WINDOWS":
                    var session = Native.WTSGetActiveConsoleSessionId();
                    return session != Native.INVALID_SESSION && Native.WTSLogoffSession(Native.WTS_CURRENT_SERVER_HANDLE, session, false)
                        ? ExecResult.Success() : ExecResult.Fail("LOGOFF_FAILED", "No active user session or logoff failed");
                case "RESTART_PC":
                case "RESTORE_REBOOT": // the restore itself is done by the disk-protection layer on boot (phase 13)
                    return Shutdown("/r /t 15 /c \"Session ended - restarting (ArenaOS)\"");
                case "SHUTDOWN_PC":
                    return Shutdown("/s /t 15 /c \"Session ended - shutting down (ArenaOS)\"");
                default:
                    return ExecResult.Fail("UNKNOWN_ACTION", action);
            }
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Post-session {Action} failed", action);
            return ExecResult.Fail("EXCEPTION", ex.Message);
        }
    }

    private static ExecResult SendMessage(string title, string message, uint timeout)
    {
        var session = Native.WTSGetActiveConsoleSessionId();
        if (session == Native.INVALID_SESSION) return ExecResult.Fail("NO_SESSION", "Nobody is signed in to show the message to");
        var ok = Native.WTSSendMessageW(Native.WTS_CURRENT_SERVER_HANDLE, session, title, (uint)title.Length * 2, message, (uint)message.Length * 2,
            Native.MB_OK | Native.MB_ICONINFORMATION | Native.MB_SETFOREGROUND | Native.MB_TOPMOST, timeout, out _, wait: false);
        return ok ? ExecResult.Success(new { shown = true }) : ExecResult.Fail("MESSAGE_FAILED", $"WTSSendMessage error {System.Runtime.InteropServices.Marshal.GetLastWin32Error()}");
    }

    /// <summary>Relays a Wake-on-LAN magic packet on this LAN for a sleeping station.</summary>
    private static async Task<ExecResult> WakeOnLanAsync(string? mac, CancellationToken ct)
    {
        if (mac is null) return ExecResult.Fail("NO_MAC", "macAddress missing");
        var bytes = mac.Split(':', '-').Select(h => Convert.ToByte(h, 16)).ToArray();
        if (bytes.Length != 6) return ExecResult.Fail("BAD_MAC", "Invalid MAC address");
        var packet = Enumerable.Repeat((byte)0xFF, 6).Concat(Enumerable.Repeat(bytes, 16).SelectMany(b => b)).ToArray();
        using var udp = new UdpClient { EnableBroadcast = true };
        var targets = new List<IPAddress> { IPAddress.Broadcast };
        if (PrimaryNic.Detect()?.Broadcast is { } subnet) targets.Add(subnet);
        foreach (var t in targets)
            foreach (var port in new[] { 9, 7 })
                await udp.SendAsync(packet, new IPEndPoint(t, port), ct);
        return ExecResult.Success(new { relayed = true, mac });
    }

    private static ExecResult Shutdown(string args)
    {
        using var p = Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "shutdown.exe"), args) { CreateNoWindow = true, UseShellExecute = false });
        p!.WaitForExit(5000);
        return p.ExitCode == 0 ? ExecResult.Success() : ExecResult.Fail("SHUTDOWN_FAILED", $"shutdown.exe exit code {p.ExitCode}");
    }

    private static ExecResult Launch(string? exe, string? args, string? workingDirectory)
    {
        if (string.IsNullOrWhiteSpace(exe) || !Path.IsPathFullyQualified(exe)) return ExecResult.Fail("BAD_PATH", "An absolute executable path is required");
        if (DeniedExecutables.Contains(Path.GetFileName(exe))) return ExecResult.Fail("DENIED", $"{Path.GetFileName(exe)} cannot be launched remotely");
        if (!File.Exists(exe)) return ExecResult.Fail("NOT_FOUND", $"{exe} is not installed on this PC");
        var pid = IsService
            ? Native.StartInUserSession(exe, args, workingDirectory ?? Path.GetDirectoryName(exe))
            : Process.Start(new ProcessStartInfo(exe, args ?? "") { WorkingDirectory = workingDirectory ?? Path.GetDirectoryName(exe)!, UseShellExecute = true })!.Id;
        return ExecResult.Success(new { pid });
    }

    private static ExecResult Close(List<string> names)
    {
        var killed = 0;
        foreach (var raw in names)
        {
            var name = Path.GetFileNameWithoutExtension(raw);
            if (string.IsNullOrEmpty(name) || ProtectedProcesses.Contains(name)) continue;
            foreach (var proc in Process.GetProcessesByName(name))
            {
                using (proc)
                {
                    if (proc.SessionId == 0) continue; // never touch services
                    try { proc.Kill(entireProcessTree: true); killed++; } catch (InvalidOperationException) { }
                }
            }
        }
        return ExecResult.Success(new { killed });
    }

    private static string? Str(JsonElement p, string name) => p.ValueKind == JsonValueKind.Object && p.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    private static int? Int(JsonElement p, string name) => p.ValueKind == JsonValueKind.Object && p.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i) ? i : null;
}
