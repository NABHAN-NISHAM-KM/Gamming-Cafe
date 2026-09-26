using System.Management;
using Arena.Agent.Core.Printing;

namespace Arena.Agent.Windows;

/// <summary>
/// The Windows print queue through WMI (Win32_PrintJob): list jobs on every
/// printer, and pause / resume / delete one. Runs as LocalSystem, so it sees
/// the customer's jobs.
/// </summary>
public static class PrintSpooler
{
    // Win32_PrintJob.StatusMask bits
    private const uint Paused = 0x1, Error = 0x2, Deleting = 0x4, Spooling = 0x8, Offline = 0x20, PaperOut = 0x40, Blocked = 0x200, UserIntervention = 0x400;

    public static IReadOnlyList<SpoolJob> List()
    {
        var jobs = new List<SpoolJob>();
        using var searcher = new ManagementObjectSearcher("SELECT Name, JobId, Document, TotalPages, StatusMask, TimeSubmitted, Color FROM Win32_PrintJob");
        foreach (ManagementObject o in searcher.Get())
        {
            using (o)
            {
                var name = o["Name"] as string ?? ""; // "Printer name, 12"
                var comma = name.LastIndexOf(',');
                var printer = comma > 0 ? name[..comma] : name;
                var mask = Convert.ToUInt32(o["StatusMask"] ?? 0u);
                if ((mask & Deleting) != 0) continue;
                var submitted = o["TimeSubmitted"] is string ts ? new DateTimeOffset(ManagementDateTimeConverter.ToDateTime(ts)) : DateTimeOffset.UtcNow;
                jobs.Add(new SpoolJob(
                    printer,
                    Convert.ToInt32(o["JobId"] ?? 0),
                    submitted,
                    o["Document"] as string,
                    Convert.ToInt32(o["TotalPages"] ?? 0),
                    string.Equals(o["Color"] as string, "Color", StringComparison.OrdinalIgnoreCase),
                    (mask & Spooling) != 0,
                    (mask & Paused) != 0,
                    (mask & (Error | Offline | PaperOut | Blocked | UserIntervention)) != 0));
            }
        }
        return jobs;
    }

    public static bool Pause(SpoolJob j) => Invoke(j, o => o.InvokeMethod("Pause", null));
    public static bool Resume(SpoolJob j) => Invoke(j, o => o.InvokeMethod("Resume", null));
    public static bool Delete(SpoolJob j) => Invoke(j, o => o.Delete());

    private static bool Invoke(SpoolJob j, Action<ManagementObject> act)
    {
        // WQL string literal: escape backslashes and quotes (network printer names contain \\server\name).
        var name = $"{j.Printer}, {j.JobId}".Replace("\\", "\\\\").Replace("'", "\\'");
        using var searcher = new ManagementObjectSearcher($"SELECT * FROM Win32_PrintJob WHERE Name = '{name}'");
        foreach (ManagementObject o in searcher.Get())
        {
            using (o)
            {
                act(o);
                return true;
            }
        }
        return false;
    }
}
