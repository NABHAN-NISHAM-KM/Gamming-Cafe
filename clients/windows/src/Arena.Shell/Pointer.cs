using System.Runtime.InteropServices;

namespace Arena.Shell;

/// <summary>
/// Mouse speed (1–20) and "Enhance pointer precision" for the customer's
/// session. Applied without SPIF_UPDATEINIFILE, so nothing is written to the
/// Windows profile; the host restores the venue's values when a session ends.
/// Runs in the host (the desktop user's session), where these settings live.
/// </summary>
public static class Pointer
{
    public sealed record Settings(int MouseSpeed, bool EnhancePointerPrecision);

    private const uint SPI_GETMOUSE = 0x0003, SPI_SETMOUSE = 0x0004, SPI_GETMOUSESPEED = 0x0070, SPI_SETMOUSESPEED = 0x0071, SPIF_SENDCHANGE = 0x02;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SystemParametersInfo(uint action, uint param, ref int value, uint winIni);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SystemParametersInfo(uint action, uint param, int[] value, uint winIni);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SystemParametersInfo(uint action, uint param, IntPtr value, uint winIni);

    public static Settings Read()
    {
        var speed = 10;
        SystemParametersInfo(SPI_GETMOUSESPEED, 0, ref speed, 0);
        var mouse = new int[3];
        SystemParametersInfo(SPI_GETMOUSE, 0, mouse, 0);
        return new Settings(speed, mouse[2] != 0);
    }

    public static Settings Apply(int? speed, bool? precision)
    {
        if (speed is { } s) SystemParametersInfo(SPI_SETMOUSESPEED, 0, (IntPtr)Math.Clamp(s, 1, 20), SPIF_SENDCHANGE);
        if (precision is { } p)
        {
            var mouse = new int[3];
            SystemParametersInfo(SPI_GETMOUSE, 0, mouse, 0);
            // Windows defaults when turning acceleration on: thresholds 6 / 10.
            mouse = p ? [mouse[0] == 0 ? 6 : mouse[0], mouse[1] == 0 ? 10 : mouse[1], 1] : [0, 0, 0];
            SystemParametersInfo(SPI_SETMOUSE, 0, mouse, SPIF_SENDCHANGE);
        }
        return Read();
    }
}
