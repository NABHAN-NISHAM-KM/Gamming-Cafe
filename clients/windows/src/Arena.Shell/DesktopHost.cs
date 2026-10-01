using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace Arena.Shell;

/// <summary>
/// The Shell as a small desktop OS while a customer is signed in. With no
/// Explorer on the kiosk account, this is the taskbar and window manager:
///
///  - Two modes. "desktop": the Shell is in front (its own desktop, windows
///    and taskbar). "bar": a game or app is in front, and the Shell stays
///    full-screen BEHIND every window, like the Windows desktop: its wallpaper,
///    icons and taskbar show around restored windows, and clicking the taskbar
///    doesn't raise it over them. The work area stops above the taskbar, so
///    maximized apps leave it visible; a fullscreen game simply covers it.
///  - Lists the customer's game/app windows for the taskbar, and focuses,
///    minimizes, maximizes, restores or closes them on request. Only windows
///    it listed itself can be touched.
///  - A window that appears shortly after a launch is brought to the front.
///  - The Windows key brings the Shell desktop back (like Start).
/// Locked (no session): none of this; the Shell is full-screen and topmost.
/// </summary>
internal sealed class DesktopHost(Window window, Action<string> post, Action<bool> lowMemory) : IDisposable
{
    private readonly int _pid = Environment.ProcessId;
    private readonly Dictionary<IntPtr, string?> _icons = [];
    private HashSet<IntPtr> _listed = [];
    private string _lastPosted = "";
    private DispatcherTimer? _poll;
    private DateTime _launchUntil;
    private bool _active;
    private string _mode = "";
    private IntPtr _hwnd;
    private WinEventProc? _fgProc;
    private IntPtr _fgHook;
    private LowLevelKeyboardProc? _kbProc;
    private IntPtr _kbHook;
    private bool _keepBottom; // "bar": pinned behind every other window
    private bool _hooked;

    public bool Active => _active;

    /// <summary>Print Screen during a session (caught by the keyboard hook, so it works in games too).</summary>
    public event Action? PrintScreen;

    /// <summary>Called on every agent state: a session started or ended.</summary>
    public void SetSession(bool inSession)
    {
        _hwnd = new WindowInteropHelper(window).Handle;
        if (inSession == _active) return;
        _active = inSession;
        if (!_hooked && HwndSource.FromHwnd(_hwnd) is { } source)
        {
            source.AddHook(WndProc);
            _hooked = true;
        }
        if (inSession)
        {
            _fgProc = OnForegroundChanged;
            _fgHook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, _fgProc, 0, 0, WINEVENT_OUTOFCONTEXT);
            _kbProc = OnKey;
            _kbHook = SetWindowsHookEx(WH_KEYBOARD_LL, _kbProc, GetModuleHandle(null), 0);
            _poll = new DispatcherTimer(TimeSpan.FromSeconds(1), DispatcherPriority.Background, (_, _) => Refresh(), window.Dispatcher);
            _poll.Start();
            SetWorkArea(reserveBar: true);
            HideMinimized();
            EnterDesktop();
        }
        else
        {
            Stop();
            SetWorkArea(reserveBar: false);
            _mode = "";
            _keepBottom = false;
            Place(fullScreen: true);
            window.Topmost = true;
            window.Activate();
            lowMemory(false);
            post("""{"type":"shell_mode","mode":"desktop"}""");
            post("""{"type":"windows","items":[]}""");
            _lastPosted = "";
        }
    }

    /// <summary>The page asked to launch something: let its window take the front when it appears.</summary>
    public void OnLaunch()
    {
        AllowSetForegroundWindow(ASFW_ANY);
        _launchUntil = DateTime.UtcNow.AddSeconds(60);
    }

    /// <summary>Something the customer must see (a staff message, a print to approve): show the desktop.</summary>
    public void Attention()
    {
        if (_active && _mode == "bar") EnterDesktop();
    }

    /// <summary>window_action / desktop_show / show_desktop from the page. True when handled here.</summary>
    public bool FromPage(string type, JsonElement msg)
    {
        if (!_active) return type is "window_action" or "desktop_show" or "show_desktop";
        if (type == "desktop_show") { EnterDesktop(); return true; }
        if (type == "show_desktop")
        {
            foreach (var w in _listed) ShowWindow(w, SW_MINIMIZE); // Windows' "show desktop": everything down
            EnterDesktop();
            window.Dispatcher.BeginInvoke(Refresh, DispatcherPriority.Background);
            return true;
        }
        if (type != "window_action") return false;
        if (!msg.TryGetProperty("id", out var idEl) || !long.TryParse(idEl.GetString(), out var raw)) return true;
        var h = new IntPtr(raw);
        if (!_listed.Contains(h) || !IsWindow(h)) return true; // only windows we listed ourselves
        switch (msg.TryGetProperty("action", out var a) ? a.GetString() : null)
        {
            case "focus": Focus(h); break;
            case "minimize": ShowWindow(h, SW_MINIMIZE); break;
            case "maximize": ShowWindow(h, SW_MAXIMIZE); Focus(h); break;
            case "restore": ShowWindow(h, SW_RESTORE); Focus(h); break;
            case "close": PostMessage(h, WM_CLOSE, IntPtr.Zero, IntPtr.Zero); break;
            case "snap_left": Snap(h, left: true); break;
            case "snap_right": Snap(h, left: false); break;
        }
        window.Dispatcher.BeginInvoke(Refresh, DispatcherPriority.Background);
        return true;
    }

    // ── modes ──────────────────────────────────────────────────────────────

    private void EnterDesktop()
    {
        _keepBottom = false;
        Place(fullScreen: true);
        // Raise it over the app even when Windows won't hand it the focus (a staff message mid-game),
        // or when it's already "active" from a taskbar click, where Activate() alone leaves it underneath.
        // Topmost on then off puts it on top of the normal windows.
        window.Topmost = true;
        window.Topmost = false;
        window.Activate();
        SetMode("desktop");
    }

    /// <summary>A game/app is in front: the Shell becomes the desktop behind it.</summary>
    private void EnterBar()
    {
        _keepBottom = true;
        window.Topmost = false;
        Place(fullScreen: true);
        SetWindowPos(_hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        SetMode("bar");
    }

    /// <summary>While pinned behind, every z-order change (e.g. a click on the taskbar) keeps it at the bottom.</summary>
    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WM_WINDOWPOSCHANGING && _keepBottom)
        {
            var pos = Marshal.PtrToStructure<WINDOWPOS>(lParam);
            if ((pos.flags & SWP_NOZORDER) == 0)
            {
                pos.hwndInsertAfter = HWND_BOTTOM;
                Marshal.StructureToPtr(pos, lParam, false);
            }
        }
        return IntPtr.Zero;
    }

    private void SetMode(string mode)
    {
        if (mode == _mode) return;
        _mode = mode;
        lowMemory(mode == "bar");
        post($$"""{"type":"shell_mode","mode":"{{mode}}"}""");
    }

    /// <summary>Taskbar strip height: 5% of the screen, at least 44 px (the page uses the same rule).</summary>
    private static double BarHeightDips => Math.Max(44, Math.Round(SystemParameters.PrimaryScreenHeight * 0.05));

    private void Place(bool fullScreen)
    {
        window.WindowState = WindowState.Normal;
        var w = SystemParameters.PrimaryScreenWidth;
        var h = SystemParameters.PrimaryScreenHeight;
        var bar = BarHeightDips;
        window.Left = 0;
        window.Width = w;
        window.Top = fullScreen ? 0 : h - bar;
        window.Height = fullScreen ? h : bar;
    }

    /// <summary>Maximized apps stop above the taskbar (Explorer normally does this; it isn't running).</summary>
    private void SetWorkArea(bool reserveBar)
    {
        var scale = VisualTreeHelper.GetDpi(window).DpiScaleY;
        var r = new RECT { Left = 0, Top = 0, Right = GetSystemMetrics(SM_CXSCREEN), Bottom = GetSystemMetrics(SM_CYSCREEN) };
        if (reserveBar) r.Bottom -= (int)Math.Round(BarHeightDips * scale);
        SystemParametersInfo(SPI_SETWORKAREA, 0, ref r, SPIF_SENDCHANGE);
    }

    /// <summary>
    /// Without Explorer, Windows parks minimized windows as small title bars at the bottom-left
    /// of the screen. Explorer hides them (ARW_HIDE); so do we, the taskbar lists them.
    /// </summary>
    private static void HideMinimized()
    {
        var m = new MINIMIZEDMETRICS { cbSize = (uint)Marshal.SizeOf<MINIMIZEDMETRICS>() };
        if (!SystemParametersInfo(SPI_GETMINIMIZEDMETRICS, m.cbSize, ref m, 0)) return;
        m.iArrange |= ARW_HIDE;
        SystemParametersInfo(SPI_SETMINIMIZEDMETRICS, m.cbSize, ref m, SPIF_SENDCHANGE);
    }

    // ── events ─────────────────────────────────────────────────────────────

    private void OnForegroundChanged(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
    {
        if (!_active || hwnd == IntPtr.Zero || hwnd == _hwnd) return;
        if (IsTaskWindow(hwnd)) EnterBar();
    }

    private IntPtr OnKey(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            var vk = Marshal.ReadInt32(lParam);
            if (vk == VK_SNAPSHOT)
            {
                if ((int)wParam is WM_KEYUP or WM_SYSKEYUP) window.Dispatcher.BeginInvoke(() => PrintScreen?.Invoke());
                return 1;
            }
            if (vk is VK_LWIN or VK_RWIN)
            {
                if ((int)wParam is WM_KEYUP or WM_SYSKEYUP) window.Dispatcher.BeginInvoke(EnterDesktop);
                return 1; // swallowed: no Windows-key shortcuts on a kiosk
            }
        }
        return CallNextHookEx(_kbHook, code, wParam, lParam);
    }

    /// <summary>Every second: the window list for the taskbar, launch auto-focus, and the mode.</summary>
    private void Refresh()
    {
        if (!_active) return;
        var fg = GetForegroundWindow();
        var items = new List<object>();
        var seen = new HashSet<IntPtr>();
        IntPtr? fresh = null;
        EnumWindows((h, _) =>
        {
            if (!IsTaskWindow(h)) return true;
            seen.Add(h);
            if (!_listed.Contains(h) && fresh is null) fresh = h;
            items.Add(new
            {
                id = h.ToInt64().ToString(),
                title = Title(h),
                icon = Icon(h),
                minimized = IsIconic(h),
                maximized = IsZoomed(h),
                active = h == fg,
            });
            return true;
        }, IntPtr.Zero);
        foreach (var gone in _icons.Keys.Where(k => !seen.Contains(k)).ToList()) _icons.Remove(gone);
        _listed = seen;

        // A game/app window that turned up right after a launch comes to the front, even if it
        // didn't get the focus itself (launchers often don't).
        if (fresh is { } f && DateTime.UtcNow < _launchUntil)
        {
            _launchUntil = DateTime.MinValue;
            Focus(f);
        }

        // In bar mode with nothing left on screen above the taskbar, show the desktop again.
        if (_mode == "bar" && !seen.Any(h => !IsIconic(h))) EnterDesktop();

        var json = JsonSerializer.Serialize(new { type = "windows", items });
        if (json != _lastPosted)
        {
            _lastPosted = json;
            post(json);
        }
    }

    /// <summary>Left or right half of the work area (above the taskbar), like Windows' snap.</summary>
    private static void Snap(IntPtr h, bool left)
    {
        var area = new RECT();
        SystemParametersInfo(SPI_GETWORKAREA, 0, ref area, 0);
        var half = (area.Right - area.Left) / 2;
        ShowWindow(h, SW_RESTORE);
        SetWindowPos(h, IntPtr.Zero, left ? area.Left : area.Left + half, area.Top, half, area.Bottom - area.Top, SWP_NOZORDER);
        Focus(h);
    }

    private static void Focus(IntPtr h)
    {
        if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
        SetForegroundWindow(h);
    }

    // ── which windows count ────────────────────────────────────────────────

    private bool IsTaskWindow(IntPtr h)
    {
        if (!IsWindowVisible(h) || GetWindow(h, GW_OWNER) != IntPtr.Zero) return false;
        var ex = GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64();
        if ((ex & WS_EX_TOOLWINDOW) != 0 && (ex & WS_EX_APPWINDOW) == 0) return false;
        if (GetWindowTextLength(h) == 0) return false;
        if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out var cloaked, sizeof(int)) == 0 && cloaked != 0) return false;
        GetWindowThreadProcessId(h, out var pid);
        return pid != _pid;
    }

    private static string Title(IntPtr h)
    {
        var sb = new StringBuilder(Math.Min(GetWindowTextLength(h) + 1, 256));
        GetWindowText(h, sb, sb.Capacity);
        return sb.ToString();
    }

    /// <summary>The window's small icon as a PNG data: URL (cached per window).</summary>
    private string? Icon(IntPtr h)
    {
        if (_icons.TryGetValue(h, out var cached)) return cached;
        string? url = null;
        try
        {
            SendMessageTimeout(h, WM_GETICON, new IntPtr(ICON_SMALL2), IntPtr.Zero, SMTO_ABORTIFHUNG, 100, out var icon);
            if (icon == IntPtr.Zero) SendMessageTimeout(h, WM_GETICON, new IntPtr(ICON_BIG), IntPtr.Zero, SMTO_ABORTIFHUNG, 100, out icon);
            if (icon == IntPtr.Zero) icon = GetClassLongPtr(h, GCLP_HICONSM);
            if (icon == IntPtr.Zero) icon = GetClassLongPtr(h, GCLP_HICON);
            if (icon != IntPtr.Zero)
            {
                var src = Imaging.CreateBitmapSourceFromHIcon(icon, Int32Rect.Empty, BitmapSizeOptions.FromWidthAndHeight(32, 32));
                var png = new PngBitmapEncoder();
                png.Frames.Add(BitmapFrame.Create(src));
                using var ms = new MemoryStream();
                png.Save(ms);
                url = "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
            }
        }
        catch (Exception e) { Trace.WriteLine($"ArenaShell: icon for {h}: {e.Message}"); }
        return _icons[h] = url;
    }

    private void Stop()
    {
        _poll?.Stop();
        _poll = null;
        if (_fgHook != IntPtr.Zero) { UnhookWinEvent(_fgHook); _fgHook = IntPtr.Zero; }
        if (_kbHook != IntPtr.Zero) { UnhookWindowsHookEx(_kbHook); _kbHook = IntPtr.Zero; }
    }

    public void Dispose()
    {
        Stop();
        if (_active) SetWorkArea(reserveBar: false);
    }

    // ── Win32 ──────────────────────────────────────────────────────────────

    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    private delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
    private delegate IntPtr LowLevelKeyboardProc(int code, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MINIMIZEDMETRICS { public uint cbSize; public int iWidth, iHorzGap, iVertGap, iArrange; }
    [StructLayout(LayoutKind.Sequential)] private struct WINDOWPOS { public IntPtr hwnd, hwndInsertAfter; public int x, y, cx, cy; public uint flags; }

    private const int ASFW_ANY = -1, GW_OWNER = 4, GWL_EXSTYLE = -20, DWMWA_CLOAKED = 14;
    private const long WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000;
    private const int SW_MAXIMIZE = 3, SW_MINIMIZE = 6, SW_RESTORE = 9;
    private const uint WM_CLOSE = 0x10, WM_GETICON = 0x7F, SMTO_ABORTIFHUNG = 2;
    private const int ICON_BIG = 1, ICON_SMALL2 = 2, GCLP_HICON = -14, GCLP_HICONSM = -34;
    private const uint EVENT_SYSTEM_FOREGROUND = 3, WINEVENT_OUTOFCONTEXT = 0;
    private const int WH_KEYBOARD_LL = 13, WM_KEYUP = 0x101, WM_SYSKEYUP = 0x105, VK_LWIN = 0x5B, VK_RWIN = 0x5C, VK_SNAPSHOT = 0x2C;
    private const uint SPI_SETWORKAREA = 0x2F, SPI_GETWORKAREA = 0x30, SPI_GETMINIMIZEDMETRICS = 0x2B, SPI_SETMINIMIZEDMETRICS = 0x2C, SPIF_SENDCHANGE = 2;
    private const int ARW_HIDE = 0x8;
    private const int SM_CXSCREEN = 0, SM_CYSCREEN = 1;
    private static readonly IntPtr HWND_BOTTOM = new(1);
    private const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10;
    private const int WM_WINDOWPOSCHANGING = 0x46;

    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] private static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
    [DllImport("user32.dll")] private static extern IntPtr GetClassLongPtr(IntPtr h, int index);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
    [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] private static extern bool AllowSetForegroundWindow(int pid);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] private static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] private static extern bool SystemParametersInfo(uint action, uint param, ref RECT r, uint flags);
    [DllImport("user32.dll")] private static extern bool SystemParametersInfo(uint action, uint param, ref MINIMIZEDMETRICS m, uint flags);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventProc proc, uint pid, uint thread, uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(int id, LowLevelKeyboardProc proc, IntPtr module, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr w, IntPtr l);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? name);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
}
