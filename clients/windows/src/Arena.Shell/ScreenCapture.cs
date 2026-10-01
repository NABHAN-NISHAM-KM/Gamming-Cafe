using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Arena.Shell;

/// <summary>
/// Print Screen on the Shell: the whole screen as a JPEG (at most 1920 px wide,
/// under 2 MB) plus a small preview, saved under
/// %LOCALAPPDATA%\ArenaOS\Shell\Screenshots\&lt;id&gt;.jpg for the agent to upload
/// to the customer's account (the agent deletes them afterwards).
/// Games in exclusive fullscreen may come out black: Windows doesn't let other
/// programs copy their picture; borderless/windowed games are fine.
/// </summary>
internal static class ScreenCapture
{
    public static string Folder => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ArenaOS", "Shell", "Screenshots");

    /// <summary>Grabs the screen now (fast); encoding happens in the returned task, off the UI thread.</summary>
    public static Task<(string Id, string Path, int Width, int Height)?> CaptureAsync()
    {
        var shot = Grab();
        if (shot is null) return Task.FromResult<(string, string, int, int)?>(null);
        return Task.Run<(string, string, int, int)?>(() =>
        {
            BitmapSource full = shot.PixelWidth > 1920 ? new TransformedBitmap(shot, new ScaleTransform(1920.0 / shot.PixelWidth, 1920.0 / shot.PixelWidth)) : shot;
            var jpeg = Encode(full, 85);
            if (jpeg.Length > 1_900_000) jpeg = Encode(full, 70);
            if (jpeg.Length > 1_900_000) return null;
            var thumb = Encode(new TransformedBitmap(full, new ScaleTransform(360.0 / full.PixelWidth, 360.0 / full.PixelWidth)), 75);

            Directory.CreateDirectory(Folder);
            var id = Guid.NewGuid().ToString("d");
            var path = Path.Combine(Folder, id + ".jpg");
            File.WriteAllBytes(path, jpeg);
            File.WriteAllBytes(Path.Combine(Folder, id + ".thumb.jpg"), thumb);
            return (id, path, full.PixelWidth, full.PixelHeight);
        });
    }

    private static BitmapSource? Grab()
    {
        int w = GetSystemMetrics(SM_CXSCREEN), h = GetSystemMetrics(SM_CYSCREEN);
        var screen = GetDC(IntPtr.Zero);
        if (screen == IntPtr.Zero) return null;
        var mem = CreateCompatibleDC(screen);
        var bmp = CreateCompatibleBitmap(screen, w, h);
        var old = SelectObject(mem, bmp);
        try
        {
            if (!BitBlt(mem, 0, 0, w, h, screen, 0, 0, SRCCOPY | CAPTUREBLT)) return null;
            var src = Imaging.CreateBitmapSourceFromHBitmap(bmp, IntPtr.Zero, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
            src.Freeze(); // used on a worker thread for encoding
            return src;
        }
        finally
        {
            SelectObject(mem, old);
            DeleteObject(bmp);
            DeleteDC(mem);
            ReleaseDC(IntPtr.Zero, screen);
        }
    }

    private static byte[] Encode(BitmapSource src, int quality)
    {
        var enc = new JpegBitmapEncoder { QualityLevel = quality };
        enc.Frames.Add(BitmapFrame.Create(src));
        using var ms = new MemoryStream();
        enc.Save(ms);
        return ms.ToArray();
    }

    private const int SM_CXSCREEN = 0, SM_CYSCREEN = 1;
    private const uint SRCCOPY = 0x00CC0020, CAPTUREBLT = 0x40000000;
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int w, int h);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
}
