using System.ComponentModel;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Arena.Shell;

/// <summary>
/// Hosts the Shell UI. The page is served from the local wwwroot under the
/// virtual origin https://shell.arena and may not navigate anywhere else; its
/// CSP forbids network access. Every message from the page is re-validated
/// here before it reaches the agent.
/// </summary>
public sealed class MainWindow : Window
{
    private const string Origin = "https://shell.arena/";
    /// <summary>Forwarded to the agent (which validates again).</summary>
    private static readonly HashSet<string> AllowedFromPage = ["ready", "login", "logout", "launch", "launch_app", "help", "repair", "menu_request", "place_order", "print_confirm", "print_cancel", "staff_exit"];
    /// <summary>Handled here, in the customer's desktop session.</summary>
    private static readonly HashSet<string> HandledByHost = ["pointer_get", "pointer_apply"];
    /// <summary>The venue's pointer settings, restored when a session ends or the Shell closes.</summary>
    private readonly Pointer.Settings _venuePointer = Pointer.Read();
    private bool _inSession;

    private readonly bool _dev;
    private readonly bool _kiosk;
    private readonly WebView2 _web = new() { DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 7, 6, 13) };
    private readonly AgentPipe _pipe;
    private string? _lastState;
    private bool _pageReady;

    public MainWindow(bool dev, bool kiosk)
    {
        _dev = dev;
        _kiosk = kiosk;
        Title = "ArenaOS";
        Background = new SolidColorBrush(Color.FromRgb(7, 6, 13));
        Content = _web;
        if (kiosk)
        {
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            WindowState = WindowState.Maximized;
            Topmost = true;
            ShowInTaskbar = false;
        }
        else
        {
            Width = 1440;
            Height = 900;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
        }

        _pipe = new AgentPipe(requireServiceServer: !dev);
        _pipe.LineReceived += line => Dispatcher.InvokeAsync(() => FromAgent(line));
        _pipe.ConnectionChanged += connected => Dispatcher.InvokeAsync(() => AgentConnectionChanged(connected));

        Loaded += async (_, _) => await InitAsync();
    }

    private async Task InitAsync()
    {
        var dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ArenaOS", "Shell", "WebView2");
        var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
        await _web.EnsureCoreWebView2Async(env);
        var core = _web.CoreWebView2;

        var s = core.Settings;
        s.AreDevToolsEnabled = _dev;
        s.AreDefaultContextMenusEnabled = _dev;
        s.AreBrowserAcceleratorKeysEnabled = _dev;
        s.IsZoomControlEnabled = false;
        s.IsPinchZoomEnabled = false;
        s.IsStatusBarEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsSwipeNavigationEnabled = false;
        s.AreHostObjectsAllowed = false;

        var root = Path.Combine(AppContext.BaseDirectory, "wwwroot");
        core.SetVirtualHostNameToFolderMapping("shell.arena", root, CoreWebView2HostResourceAccessKind.Deny);
        core.NavigationStarting += (_, e) =>
        {
            if (!e.Uri.StartsWith(Origin, StringComparison.OrdinalIgnoreCase)) e.Cancel = true;
            else _pageReady = false; // a (re)load says "ready" again once it is listening
        };
        core.NewWindowRequested += (_, e) => e.Handled = true; // no pop-ups, ever
        core.DownloadStarting += (_, e) => e.Cancel = true;
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        core.WebMessageReceived += (_, e) => FromPage(e);

        if (!File.Exists(Path.Combine(root, "index.html")))
        {
            core.NavigateToString("<body style='background:#07060d;color:#ecebf7;font:20px Segoe UI;display:grid;place-items:center;height:100vh'>" +
                                  "Shell UI not built. Run: npm run build -w @arena/shell</body>");
            return;
        }
        core.Navigate(Origin + "index.html");
        _pipe.Start();
    }

    // ── page → agent ───────────────────────────────────────────────────────

    private void FromPage(CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!e.Source.StartsWith(Origin, StringComparison.OrdinalIgnoreCase)) return;
        string json;
        try { json = e.WebMessageAsJson; } catch (ArgumentException) { return; }
        if (json.Length > 8 * 1024) return;
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object
                || !doc.RootElement.TryGetProperty("type", out var t)
                || t.GetString() is not { } type) return;
            if (HandledByHost.Contains(type)) { PointerRequest(type, doc.RootElement); return; }
            if (!AllowedFromPage.Contains(type)) return;

            if (type == "ready")
            {
                _pageReady = true;
                // Answer at once with what we know, even before the agent replies.
                Post(_lastState ?? OfflineState());
            }
            if (!_pipe.TrySend(json) && type == "login" && doc.RootElement.TryGetProperty("requestId", out var id))
                Post(JsonSerializer.Serialize(new { type = "login_result", requestId = id.GetString(), ok = false, error = "agent_unavailable", message = "This station isn't ready yet. Please ask staff." }));
        }
        catch (JsonException) { }
    }

    // ── agent → page ───────────────────────────────────────────────────────

    private void FromAgent(string line)
    {
        try
        {
            using var doc = JsonDocument.Parse(line);
            var type = doc.RootElement.TryGetProperty("type", out var t) ? t.GetString() : null;
            if (type == "reload") { _web.CoreWebView2?.Reload(); return; } // RESTART_SHELL repair
            if (type == "state")
            {
                _lastState = line;
                var inSession = doc.RootElement.TryGetProperty("session", out var s) && s.ValueKind == JsonValueKind.Object;
                if (_inSession && !inSession) Pointer.Apply(_venuePointer.MouseSpeed, _venuePointer.EnhancePointerPrecision); // next customer starts clean
                _inSession = inSession;
            }
        }
        catch (JsonException) { return; }
        Post(line);
    }

    private void PointerRequest(string type, JsonElement msg)
    {
        Pointer.Settings now;
        if (type == "pointer_apply" && _inSession)
        {
            int? speed = msg.TryGetProperty("mouseSpeed", out var sp) && sp.TryGetInt32(out var v) ? v : null;
            bool? precision = msg.TryGetProperty("enhancePointerPrecision", out var pr) && pr.ValueKind is JsonValueKind.True or JsonValueKind.False ? pr.GetBoolean() : null;
            now = Pointer.Apply(speed, precision);
        }
        else now = Pointer.Read();
        Post(JsonSerializer.Serialize(new { type = "pointer", mouseSpeed = now.MouseSpeed, enhancePointerPrecision = now.EnhancePointerPrecision }));
    }

    private void AgentConnectionChanged(bool connected)
    {
        if (connected) { _pipe.TrySend("""{"type":"ready"}"""); return; }
        // Agent gone (restarting/updating). Keep showing the session we knew about, marked offline;
        // the agent enforces expiry on its own and will resync when it's back.
        _lastState = _lastState is null ? null : MarkOffline(_lastState);
        Post(_lastState ?? OfflineState());
    }

    private void Post(string json)
    {
        if (_web.CoreWebView2 is null) return;
        if (!_pageReady) return; // nobody listening yet; state is re-sent on "ready"
        _web.CoreWebView2.PostWebMessageAsJson(json);
    }

    private static string OfflineState() => JsonSerializer.Serialize(new
    {
        type = "state",
        connected = false,
        station = new { name = Environment.MachineName },
        venue = new { name = "ArenaOS", branchName = "", logoUrl = (string?)null },
        session = (object?)null,
        serverOffsetMs = 0,
        safeMode = true,
    });

    private static string MarkOffline(string state)
    {
        var node = System.Text.Json.Nodes.JsonNode.Parse(state)!.AsObject();
        node["connected"] = false;
        return node.ToJsonString();
    }

    // ── kiosk behaviour ────────────────────────────────────────────────────

    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (_dev && e.Key == Key.F5) _web.CoreWebView2?.Reload();
        base.OnKeyDown(e);
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        // Alt+F4 and friends. Staff leave with Shift+F12 + PIN; the agent closes the Shell.
        if (_kiosk) e.Cancel = true;
        base.OnClosing(e);
    }

    protected override void OnClosed(EventArgs e)
    {
        Pointer.Apply(_venuePointer.MouseSpeed, _venuePointer.EnhancePointerPrecision);
        _pipe.Dispose();
        base.OnClosed(e);
    }
}
