using System.ComponentModel;
using System.Runtime.InteropServices;

namespace Arena.Agent.Windows;

/// <summary>Win32 / WTS interop used by the agent.</summary>
internal static partial class Native
{
    public static readonly IntPtr WTS_CURRENT_SERVER_HANDLE = IntPtr.Zero;
    public const uint INVALID_SESSION = 0xFFFFFFFF;

    [StructLayout(LayoutKind.Sequential)]
    public struct FILETIME
    {
        public uint Low;
        public uint High;
        public readonly ulong Value => ((ulong)High << 32) | Low;
    }

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool GetSystemTimes(out FILETIME idle, out FILETIME kernel, out FILETIME user);

    [StructLayout(LayoutKind.Sequential)]
    public struct MEMORYSTATUSEX
    {
        public uint Length;
        public uint MemoryLoad;
        public ulong TotalPhys;
        public ulong AvailPhys;
        public ulong TotalPageFile;
        public ulong AvailPageFile;
        public ulong TotalVirtual;
        public ulong AvailVirtual;
        public ulong AvailExtendedVirtual;
    }

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX buffer);

    [LibraryImport("kernel32.dll")]
    public static partial uint WTSGetActiveConsoleSessionId();

    [DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool WTSSendMessageW(IntPtr server, uint sessionId, string title, uint titleLength, string message, uint messageLength, uint style, uint timeoutSeconds, out uint response, bool wait);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    public static extern bool WTSLogoffSession(IntPtr server, uint sessionId, bool wait);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    public static extern bool WTSQueryUserToken(uint sessionId, out IntPtr token);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool LockWorkStation();

    [DllImport("userenv.dll", SetLastError = true)]
    public static extern bool CreateEnvironmentBlock(out IntPtr env, IntPtr token, bool inherit);

    [DllImport("userenv.dll", SetLastError = true)]
    public static extern bool DestroyEnvironmentBlock(IntPtr env);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO
    {
        public int cb;
        public string? lpReserved;
        public string? lpDesktop;
        public string? lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcessAsUserW(IntPtr token, string? application, System.Text.StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes,
        bool inheritHandles, uint creationFlags, IntPtr environment, string? currentDirectory, ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);

    public const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    public const uint MB_OK = 0x0, MB_ICONINFORMATION = 0x40, MB_SETFOREGROUND = 0x10000, MB_TOPMOST = 0x40000;

    /// <summary>
    /// Starts a process on the interactive user's desktop from the LocalSystem
    /// service (session 0 cannot show UI). Requires the SYSTEM account.
    /// </summary>
    public static int StartInUserSession(string exe, string? args, string? workingDirectory)
    {
        var session = WTSGetActiveConsoleSessionId();
        if (session == INVALID_SESSION) throw new InvalidOperationException("No user is signed in at the console");
        if (!WTSQueryUserToken(session, out var token)) throw new Win32Exception(Marshal.GetLastWin32Error(), "WTSQueryUserToken failed (agent must run as LocalSystem)");
        IntPtr env = IntPtr.Zero;
        try
        {
            CreateEnvironmentBlock(out env, token, false);
            var si = new STARTUPINFO { cb = Marshal.SizeOf<STARTUPINFO>(), lpDesktop = @"winsta0\default" };
            var cmd = new System.Text.StringBuilder($"\"{exe}\"{(string.IsNullOrWhiteSpace(args) ? "" : " " + args)}");
            if (!CreateProcessAsUserW(token, null, cmd, IntPtr.Zero, IntPtr.Zero, false, CREATE_UNICODE_ENVIRONMENT, env, workingDirectory, ref si, out var pi))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessAsUser failed");
            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
            return pi.dwProcessId;
        }
        finally
        {
            if (env != IntPtr.Zero) DestroyEnvironmentBlock(env);
            CloseHandle(token);
        }
    }
}
