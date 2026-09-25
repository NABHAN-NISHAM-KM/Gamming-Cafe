using System.Management;
using Arena.Agent.Core;

namespace Arena.Agent.Windows;

/// <summary>Hardware inventory via WMI, sent on connect. The server hashes it to detect swaps.</summary>
public static class HardwareCollector
{
    public static HardwareSnapshot Collect(PrimaryNic? nic)
    {
        string? First(string cls, string prop, string? where = null)
        {
            try
            {
                using var s = new ManagementObjectSearcher($"SELECT {prop} FROM {cls}{(where is null ? "" : " WHERE " + where)}");
                foreach (var o in s.Get()) return o[prop]?.ToString()?.Trim();
            }
            catch (ManagementException) { }
            return null;
        }

        var cpuCores = int.TryParse(First("Win32_Processor", "NumberOfCores"), out var cores) ? cores : (int?)null;
        double? ramMb = null, vramMb = null;
        try
        {
            using var s = new ManagementObjectSearcher("SELECT Capacity FROM Win32_PhysicalMemory");
            ramMb = s.Get().Cast<ManagementObject>().Sum(o => Convert.ToDouble(o["Capacity"])) / 1024 / 1024;
        }
        catch (ManagementException) { }

        string? gpu = null;
        try
        {
            // Prefer a discrete GPU over the integrated one / virtual adapters.
            using var s = new ManagementObjectSearcher("SELECT Name, AdapterRAM FROM Win32_VideoController");
            var all = s.Get().Cast<ManagementObject>().Select(o => (Name: o["Name"]?.ToString(), Ram: o["AdapterRAM"])).ToList();
            var pick = all.FirstOrDefault(g => g.Name is not null && (g.Name.Contains("NVIDIA") || g.Name.Contains("Radeon") || g.Name.Contains("Arc"))) is { Name: not null } d ? d : all.FirstOrDefault();
            gpu = pick.Name;
            if (pick.Ram is not null) vramMb = Convert.ToDouble(pick.Ram) / 1024 / 1024; // WMI caps at 4 GB for >4 GB cards
        }
        catch (ManagementException) { }

        var disks = new List<DiskInfo>();
        try
        {
            using var s = new ManagementObjectSearcher("SELECT Model, SerialNumber, Size FROM Win32_DiskDrive");
            foreach (var o in s.Get())
                disks.Add(new DiskInfo(o["Model"]?.ToString()?.Trim(), o["SerialNumber"]?.ToString()?.Trim(), o["Size"] is null ? null : Math.Round(Convert.ToDouble(o["Size"]) / 1e9), null));
        }
        catch (ManagementException) { }

        var board = string.Join(" ", new[] { First("Win32_BaseBoard", "Manufacturer"), First("Win32_BaseBoard", "Product") }.Where(x => !string.IsNullOrEmpty(x)));
        var os = First("Win32_OperatingSystem", "Caption");
        var build = First("Win32_OperatingSystem", "BuildNumber");

        return new HardwareSnapshot
        {
            Cpu = First("Win32_Processor", "Name"),
            CpuCores = cpuCores,
            Gpu = gpu,
            GpuVramMb = vramMb is null ? null : Math.Round(vramMb.Value),
            RamMb = ramMb is null ? null : Math.Round(ramMb.Value),
            Motherboard = string.IsNullOrWhiteSpace(board) ? null : board,
            BiosVersion = First("Win32_BIOS", "SMBIOSBIOSVersion"),
            OsVersion = os is null ? null : $"{os} ({build})",
            Disks = disks,
            Nics = nic is null ? [] : [new NicInfo(nic.Name, nic.Mac, nic.SpeedMbps, nic.Ipv4)],
        };
    }
}
