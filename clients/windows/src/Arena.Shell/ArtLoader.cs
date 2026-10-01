using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;

namespace Arena.Shell;

/// <summary>
/// Real icons and covers for the library, like Windows shows them. The agent
/// says where the art is (art_sources: a program's .exe, or a Steam app id);
/// this turns it into images for the page and posts {type:"art"}:
///  - Steam games: cover and icon straight from Steam's library cache, served
///    at https://steamart.arena/ (no copying, the browser caches them).
///  - Everything else: the .exe's own icon at 128 px, as a PNG data: URL.
/// The page never sees a path.
/// </summary>
internal sealed partial class ArtLoader(Action<string> post)
{
    private const string SteamHost = "steamart.arena";
    private readonly Dictionary<string, string?> _exeIcons = new(StringComparer.OrdinalIgnoreCase);
    private string? _mappedCache;

    [GeneratedRegex("^[0-9]{1,10}$")] private static partial Regex SteamAppId();
    [GeneratedRegex("^[0-9a-f]{40}\\.jpg$")] private static partial Regex SteamIconFile();
    [GeneratedRegex("^[0-9a-f]{40}$")] private static partial Regex SteamHash();

    /// <summary>True when the Steam cache was newly mapped: the page must reload to see it.</summary>
    public bool Load(CoreWebView2 web, JsonElement msg)
    {
        var remapped = false;
        var cache = msg.TryGetProperty("steamLibraryCache", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : null;
        if (cache is not null && Directory.Exists(cache) && cache != _mappedCache)
        {
            web.SetVirtualHostNameToFolderMapping(SteamHost, cache, CoreWebView2HostResourceAccessKind.Allow);
            _mappedCache = cache;
            // WebView2 applies a new mapping only to pages loaded after it (documented limitation).
            remapped = true;
        }
        if (!msg.TryGetProperty("items", out var list) || list.ValueKind != JsonValueKind.Array) return remapped;
        var items = list.EnumerateArray()
            .Select(i => (Id: Str(i, "id"), Exe: Str(i, "exe"), Steam: Str(i, "steamAppId")))
            .Where(i => i.Id is not null)
            .ToList();
        var steamCache = _mappedCache;

        // Icon extraction touches the disk: off the UI thread, then posted back in one message.
        _ = Task.Run(() =>
        {
            var art = new List<object>();
            foreach (var (id, exe, steam) in items)
            {
                string? icon = null, cover = null;
                if (steam is not null && SteamAppId().IsMatch(steam) && steamCache is not null && Directory.Exists(Path.Combine(steamCache, steam)))
                {
                    var dir = Path.Combine(steamCache, steam);
                    string Url(string file) => $"https://{SteamHost}/{steam}/{file}";
                    // Newer Steam keeps some art one folder down: <appid>\<hash>\library_600x900.jpg.
                    var subs = Directory.EnumerateDirectories(dir).Select(Path.GetFileName).Where(d => d is not null && SteamHash().IsMatch(d)).ToList();
                    cover = new[] { "library_600x900.jpg", "library_header.jpg", "header.jpg" }
                        .SelectMany(f => new[] { f }.Concat(subs.Select(d => $"{d}/{f}")))
                        .FirstOrDefault(f => File.Exists(Path.Combine(dir, f))) is { } cf ? Url(cf) : null;
                    icon = Directory.EnumerateFiles(dir).Select(Path.GetFileName).FirstOrDefault(f => f is not null && SteamIconFile().IsMatch(f)) is { } icf ? Url(icf) : null;
                }
                if (icon is null && exe is not null) icon = ExeIcon(exe);
                if (icon is not null || cover is not null) art.Add(new { id, icon, cover });
            }
            var json = JsonSerializer.Serialize(new { type = "art", items = art });
            Application.Current?.Dispatcher.BeginInvoke(() => post(json));
        });
        return remapped;
    }

    private string? ExeIcon(string exe)
    {
        lock (_exeIcons)
        {
            if (_exeIcons.TryGetValue(exe, out var cached)) return cached;
        }
        string? url = null;
        try
        {
            if (exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && File.Exists(exe))
            {
                var icons = new IntPtr[1];
                if (PrivateExtractIcons(exe, 0, 128, 128, icons, null, 1, 0) > 0 && icons[0] != IntPtr.Zero)
                {
                    try
                    {
                        var src = Imaging.CreateBitmapSourceFromHIcon(icons[0], Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
                        var png = new PngBitmapEncoder();
                        png.Frames.Add(BitmapFrame.Create(src));
                        using var ms = new MemoryStream();
                        png.Save(ms);
                        url = "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
                    }
                    finally { DestroyIcon(icons[0]); }
                }
            }
        }
        catch (Exception e) { Trace.WriteLine($"ArenaShell: icon for {exe}: {e.Message}"); }
        lock (_exeIcons) _exeIcons[exe] = url;
        return url;
    }

    private static string? Str(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, int[]? ids, uint count, uint flags);

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr icon);
}
