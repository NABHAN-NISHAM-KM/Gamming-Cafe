using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Arena.DemoHost;

/// <summary>
/// Serves the bundled demo build from https://demo.arena/ (every request is
/// answered from files extracted out of this EXE — no network, no server).
/// All ArenaOS demo EXEs share one WebView2 profile and origin, so when the
/// Console and the Shell demo run together they share the same demo venue.
/// </summary>
public sealed partial class MainWindow : Window
{
    private const string Host = "demo.arena";
    private const string Origin = "https://demo.arena/";
#if DEMO_SHELL
    private const string AppName = "Shell";
    private const string StartPath = "live/shell/index.html?station=PC-01";
#else
    private const string AppName = "Console";
    private const string StartPath = "start.html";
#endif

    private readonly WebView2 _web = new() { DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 7, 7, 12) };
    private readonly string[] _args;
    private string _siteDir = "";
    private WindowState _beforeFullScreen = WindowState.Normal;

    [GeneratedRegex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", RegexOptions.IgnoreCase)]
    private static partial Regex Uuid();

    public MainWindow(string[] args)
    {
        _args = args;
        Title = AppName == "Shell" ? "ArenaOS Gaming Shell — demo" : "ArenaOS Console";
        Background = new SolidColorBrush(Color.FromRgb(7, 7, 12));
        Width = 1440;
        Height = 900;
        MinWidth = 960;
        MinHeight = 600;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Content = _web;
        Loaded += async (_, _) => await InitAsync();
        PreviewKeyDown += OnKey;
    }

    private async Task InitAsync()
    {
        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ArenaOS", "Demo");
        _siteDir = ExtractSite(root);

        CoreWebView2Environment env;
        try
        {
            env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(root, "WebView2"));
        }
        catch (WebView2RuntimeNotFoundException)
        {
            if (MessageBox.Show("ArenaOS needs the Microsoft Edge WebView2 Runtime (built into Windows 11).\n\nOpen the download page now?", "ArenaOS", MessageBoxButton.YesNo, MessageBoxImage.Information) == MessageBoxResult.Yes)
                Process.Start(new ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/") { UseShellExecute = true });
            Close();
            return;
        }
        await _web.EnsureCoreWebView2Async(env);
        var core = _web.CoreWebView2;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.AreDevToolsEnabled = _args.Contains("--dev");
        core.Settings.AreDefaultContextMenusEnabled = _args.Contains("--dev");

        core.AddWebResourceRequestedFilter($"{Origin}*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += (_, e) => e.Response = Serve(core.Environment, new Uri(e.Request.Uri));

        // Links that leave ArenaOS open in the normal browser.
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            if (e.Uri.StartsWith(Origin, StringComparison.OrdinalIgnoreCase)) core.Navigate(e.Uri);
            else Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true });
        };
#if DEMO_SHELL
        core.NavigationStarting += (_, e) =>
        {
            if (!e.Uri.StartsWith(Origin, StringComparison.OrdinalIgnoreCase)) e.Cancel = true;
        };
#endif
        core.DocumentTitleChanged += (_, _) =>
        {
            if (!string.IsNullOrWhiteSpace(core.DocumentTitle) && !core.DocumentTitle.StartsWith("demo.arena")) Title = $"{core.DocumentTitle} — ArenaOS";
        };
        core.Navigate(Origin + StartPath);
    }

    private void OnKey(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.F11)
        {
            if (WindowStyle == WindowStyle.None)
            {
                WindowStyle = WindowStyle.SingleBorderWindow;
                WindowState = _beforeFullScreen;
            }
            else
            {
                _beforeFullScreen = WindowState;
                WindowStyle = WindowStyle.None;
                WindowState = WindowState.Maximized;
            }
            e.Handled = true;
        }
#if !DEMO_SHELL
        if (e.Key == Key.H && Keyboard.Modifiers == (ModifierKeys.Control | ModifierKeys.Shift))
        {
            _web.CoreWebView2?.Navigate(Origin + "start.html?stay=1");
            e.Handled = true;
        }
#endif
    }

    // ── bundled site ────────────────────────────────────────────────────────

    /// <summary>Unpacks the embedded build once per version into LocalAppData.</summary>
    private static string ExtractSite(string root)
    {
        var asm = Assembly.GetExecutingAssembly();
        using var zip = asm.GetManifestResourceStream("site.zip") ?? throw new InvalidOperationException("This build has no demo site inside. Run package-demos.ps1.");
        var dir = Path.Combine(root, "site", $"{AppName}-{asm.GetName().Version}-{zip.Length}");
        if (!File.Exists(Path.Combine(dir, ".complete")))
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, true);
            ZipFile.ExtractToDirectory(zip, dir);
            File.WriteAllText(Path.Combine(dir, ".complete"), DateTime.UtcNow.ToString("O"));
            // Old versions of this app's files are no longer needed.
            foreach (var old in Directory.GetDirectories(Path.Combine(root, "site"), $"{AppName}-*"))
                if (!old.Equals(dir, StringComparison.OrdinalIgnoreCase)) try { Directory.Delete(old, true); } catch { /* in use: next time */ }
        }
        return dir;
    }

    private CoreWebView2WebResourceResponse Serve(CoreWebView2Environment env, Uri uri)
    {
        var path = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/');
        if (path == "start.html")
        {
            var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("start.html")!;
            return env.CreateWebResourceResponse(s, 200, "OK", "Content-Type: text/html; charset=utf-8");
        }
        var file = Resolve(path);
        // Records created in the demo have no pre-rendered page: serve the "_" page, which reads the id from the URL.
        if (file is null && path.StartsWith("live/admin/") && Uuid().IsMatch(path)) file = Resolve(Uuid().Replace(path, "_", 1));
        if (file is null)
            foreach (var spa in new[] { "live/shell", "live/app" })
                if (path.StartsWith(spa)) file = Resolve($"{spa}/index.html");
        if (file is null) return env.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
        var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.SequentialScan);
        return env.CreateWebResourceResponse(stream, 200, "OK", $"Content-Type: {Mime(file)}\nCache-Control: no-cache");
    }

    private string? Resolve(string path)
    {
        if (path.Contains("..")) return null;
        var full = Path.GetFullPath(Path.Combine(_siteDir, path.Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(_siteDir, StringComparison.OrdinalIgnoreCase)) return null;
        if (Directory.Exists(full)) full = Path.Combine(full, "index.html");
        if (File.Exists(full)) return full;
        return File.Exists(full + ".html") ? full + ".html" : null;
    }

    private static string Mime(string file) => Path.GetExtension(file).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".js" or ".mjs" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".json" => "application/json",
        ".txt" => "text/plain; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".ico" => "image/x-icon",
        ".woff" => "font/woff",
        ".woff2" => "font/woff2",
        ".webmanifest" => "application/manifest+json",
        _ => "application/octet-stream",
    };
}
