using System.Diagnostics;
using System.Management;
using System.Net.NetworkInformation;
using Arena.Agent.Core;

namespace Arena.Agent.Windows;

/// <summary>
/// Cheap, dependency-free health sampling every heartbeat. Anything a PC can't
/// report (e.g. CPU temperature without vendor sensors) is sent as null.
/// </summary>
public sealed class MetricsCollector(ILogger<MetricsCollector> log)
{
    private Native.FILETIME _lastIdle, _lastKernel, _lastUser;
    private bool _primed;
    private readonly Dictionary<string, PerformanceCounter> _gpu = new();
    private readonly string? _nvidiaSmi = new[]
    {
        Path.Combine(Environment.SystemDirectory, "nvidia-smi.exe"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe"),
    }.FirstOrDefault(File.Exists);
    private bool _thermalZoneWorks = true;

    public async Task<DeviceMetrics> SampleAsync(string? pingTarget, CancellationToken ct)
    {
        var (gpuTemp, gpuUtil) = NvidiaSample();
        return new DeviceMetrics
        {
            CpuPct = Cpu(),
            GpuPct = gpuUtil ?? Gpu3dUtilization(),
            RamPct = Ram(),
            DiskPct = SystemDisk(),
            CpuTempC = CpuTemp(),
            GpuTempC = gpuTemp,
            PingMs = await PingAsync(pingTarget, ct),
            UptimeSec = Environment.TickCount64 / 1000,
        };
    }

    private double? Cpu()
    {
        if (!Native.GetSystemTimes(out var idle, out var kernel, out var user)) return null;
        double? pct = null;
        if (_primed)
        {
            var idleD = idle.Value - _lastIdle.Value;
            var total = (kernel.Value - _lastKernel.Value) + (user.Value - _lastUser.Value); // kernel includes idle
            if (total > 0) pct = Math.Round(100.0 * (total - idleD) / total, 1);
        }
        (_lastIdle, _lastKernel, _lastUser, _primed) = (idle, kernel, user, true);
        return pct;
    }

    private static double? Ram()
    {
        var m = new Native.MEMORYSTATUSEX { Length = (uint)System.Runtime.InteropServices.Marshal.SizeOf<Native.MEMORYSTATUSEX>() };
        return Native.GlobalMemoryStatusEx(ref m) ? m.MemoryLoad : null;
    }

    private static double? SystemDisk()
    {
        try
        {
            var d = new DriveInfo(Path.GetPathRoot(Environment.SystemDirectory)!);
            return Math.Round(100.0 * (d.TotalSize - d.AvailableFreeSpace) / d.TotalSize, 1);
        }
        catch (IOException) { return null; }
    }

    /// <summary>Sum of 3D-engine utilisation across processes (Task Manager's "GPU" column).</summary>
    private double? Gpu3dUtilization()
    {
        try
        {
            var cat = new PerformanceCounterCategory("GPU Engine");
            var names = cat.GetInstanceNames().Where(n => n.EndsWith("engtype_3D", StringComparison.OrdinalIgnoreCase)).ToHashSet();
            foreach (var gone in _gpu.Keys.Except(names).ToList()) { _gpu[gone].Dispose(); _gpu.Remove(gone); }
            double sum = 0;
            foreach (var n in names)
            {
                if (!_gpu.TryGetValue(n, out var pc)) _gpu[n] = pc = new PerformanceCounter("GPU Engine", "Utilization Percentage", n, readOnly: true);
                try { sum += pc.NextValue(); } catch (InvalidOperationException) { /* process exited */ }
            }
            return Math.Round(Math.Min(100, sum), 1);
        }
        catch (Exception e) when (e is InvalidOperationException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>NVIDIA cards (most gaming cafés): temperature + utilisation from nvidia-smi.</summary>
    private (double? Temp, double? Util) NvidiaSample()
    {
        if (_nvidiaSmi is null) return (null, null);
        try
        {
            using var p = Process.Start(new ProcessStartInfo(_nvidiaSmi, "--query-gpu=temperature.gpu,utilization.gpu --format=csv,noheader,nounits")
            {
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            })!;
            var line = p.StandardOutput.ReadLine();
            p.WaitForExit(2000);
            var parts = line?.Split(',', StringSplitOptions.TrimEntries);
            if (parts is { Length: >= 2 } && double.TryParse(parts[0], out var t) && double.TryParse(parts[1], out var u)) return (t, u);
        }
        catch (Exception e)
        {
            log.LogDebug("nvidia-smi unavailable: {Message}", e.Message);
        }
        return (null, null);
    }

    /// <summary>ACPI thermal zone (needs admin; many boards don't expose it — then null).</summary>
    private double? CpuTemp()
    {
        if (!_thermalZoneWorks) return null;
        try
        {
            using var s = new ManagementObjectSearcher(@"root\WMI", "SELECT CurrentTemperature FROM MSAcpi_ThermalZoneTemperature");
            double? max = null;
            foreach (var o in s.Get())
            {
                var c = Convert.ToDouble(o["CurrentTemperature"]) / 10.0 - 273.15;
                if (c is > 0 and < 150) max = Math.Max(max ?? 0, c);
            }
            return max is null ? null : Math.Round(max.Value, 1);
        }
        catch (ManagementException)
        {
            _thermalZoneWorks = false;
            return null;
        }
    }

    private static async Task<double?> PingAsync(string? target, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(target)) return null;
        try
        {
            using var p = new Ping();
            var r = await p.SendPingAsync(target, TimeSpan.FromSeconds(1), cancellationToken: ct);
            return r.Status == IPStatus.Success ? r.RoundtripTime : null;
        }
        catch (PingException) { return null; }
    }
}
