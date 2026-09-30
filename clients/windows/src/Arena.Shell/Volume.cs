using System.Runtime.InteropServices;

namespace Arena.Shell;

/// <summary>
/// The default speakers' master volume and mute (Windows Core Audio), for the
/// taskbar's volume control: with no Explorer there is no Windows volume icon.
/// </summary>
internal static class Volume
{
    public static (int Level, bool Muted)? Get()
    {
        var ep = Endpoint();
        if (ep is null) return null;
        try
        {
            ep.GetMasterVolumeLevelScalar(out var level);
            ep.GetMute(out var muted);
            return ((int)Math.Round(level * 100), muted);
        }
        finally { Marshal.ReleaseComObject(ep); }
    }

    public static void Set(int? level, bool? muted)
    {
        var ep = Endpoint();
        if (ep is null) return;
        try
        {
            var ctx = Guid.Empty;
            if (level is { } l) ep.SetMasterVolumeLevelScalar(Math.Clamp(l, 0, 100) / 100f, ref ctx);
            if (muted is { } m) ep.SetMute(m, ref ctx);
        }
        finally { Marshal.ReleaseComObject(ep); }
    }

    private static IAudioEndpointVolume? Endpoint()
    {
        try
        {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            try
            {
                if (enumerator.GetDefaultAudioEndpoint(0 /* eRender */, 1 /* eMultimedia */, out var device) != 0) return null;
                try
                {
                    var iid = typeof(IAudioEndpointVolume).GUID;
                    return device.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out var o) == 0 ? (IAudioEndpointVolume)o : null;
                }
                finally { Marshal.ReleaseComObject(device); }
            }
            finally { Marshal.ReleaseComObject(enumerator); }
        }
        catch (COMException) { return null; }
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumerator;

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float db, ref Guid context);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
        [PreserveSig] int GetMasterVolumeLevel(out float db);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float db, ref Guid context);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float db);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }
}
