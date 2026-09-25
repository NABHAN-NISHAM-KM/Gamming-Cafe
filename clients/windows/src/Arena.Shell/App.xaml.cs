using System.Windows;

namespace Arena.Shell;

/// <summary>
/// ArenaShell.exe [--dev] [--kiosk]
///   --dev    normal window, DevTools (F12), and accepts an agent running in the
///            developer's own session (console mode) instead of the service.
///   --kiosk  full-screen, topmost, and cannot be closed from the keyboard.
///            Deeper lockdown (Explorer replacement, key filtering) is phase 13.
/// </summary>
public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var dev = e.Args.Contains("--dev");
        var kiosk = e.Args.Contains("--kiosk") && !dev;
        new MainWindow(dev, kiosk).Show();
    }
}
