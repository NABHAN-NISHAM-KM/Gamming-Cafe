using Microsoft.Win32;

namespace Arena.Agent.Windows;

/// <summary>
/// Per-user lockdown for the customer's Windows account, written into their
/// HKEY_USERS hive by the agent (SYSTEM). Windows never lets a program swallow
/// Ctrl+Alt+Del, so instead the screen it opens is emptied: no Lock, Switch
/// user, Sign out, Change password, Task Manager or power options, only Cancel.
/// Lifted while staff use the desktop (Shift+F12) and re-applied at the next sign-in.
/// </summary>
public static class Kiosk
{
    private const string SystemPolicies = @"Software\Microsoft\Windows\CurrentVersion\Policies\System";
    private const string ExplorerPolicies = @"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer";
    private const string Winlogon = @"Software\Microsoft\Windows NT\CurrentVersion\Winlogon";

    private static readonly (string Key, string Name)[] Locks =
    [
        (SystemPolicies, "DisableTaskMgr"),
        (SystemPolicies, "DisableLockWorkstation"),
        (SystemPolicies, "DisableChangePassword"),
        (ExplorerPolicies, "NoLogoff"),
        (ExplorerPolicies, "NoClose"),
    ];

    public static void SetLockdown(string sid, bool on)
    {
        foreach (var (key, name) in Locks)
        {
            using var k = Registry.Users.CreateSubKey($@"{sid}\{key}");
            if (on) k.SetValue(name, 1, RegistryValueKind.DWord);
            else k.DeleteValue(name, throwOnMissingValue: false);
        }
    }

    /// <summary>
    /// Starts Explorer as the session's desktop (taskbar, Start). Explorer only
    /// becomes the desktop when it is the registered shell, so the user's
    /// per-user shell (the Gaming Shell, set by setup-player.ps1) is swapped
    /// for explorer.exe while it starts, then put back for the next sign-in.
    /// <paramref name="closeShell"/> runs after the swap, so Windows can't bring the Gaming Shell back.
    /// </summary>
    public static async Task OpenDesktopAsync(string sid, Action closeShell)
    {
        using var k = Registry.Users.CreateSubKey($@"{sid}\{Winlogon}");
        var shell = k.GetValue("Shell") as string;
        k.SetValue("Shell", "explorer.exe");
        try
        {
            closeShell();
            Native.StartInUserSession(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"), null, null);
            await Task.Delay(TimeSpan.FromSeconds(8));
        }
        finally
        {
            if (shell is null) k.DeleteValue("Shell", throwOnMissingValue: false);
            else k.SetValue("Shell", shell);
        }
    }
}
