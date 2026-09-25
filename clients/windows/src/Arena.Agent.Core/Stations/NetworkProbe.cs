namespace Arena.Agent.Core.Stations;

public sealed record ProbeTarget(string Name, string Host, double? PingMs, double LossPct);

/// <summary>One connectivity sample (mirrors NetworkProbe in the contracts).</summary>
public sealed record NetworkProbe(ProbeTarget[] Targets, string? LinkType, double? LinkSpeedMbps, double? DnsMs);

public static class ProbeMath
{
    /// <summary>Median round-trip of the replies, and the share that got none.</summary>
    public static (double? PingMs, double LossPct) Summarize(IReadOnlyList<long?> roundTripsMs)
    {
        if (roundTripsMs.Count == 0) return (null, 100);
        var ok = roundTripsMs.Where(r => r.HasValue).Select(r => (double)r!.Value).OrderBy(x => x).ToList();
        var loss = Math.Round(100.0 * (roundTripsMs.Count - ok.Count) / roundTripsMs.Count, 1);
        if (ok.Count == 0) return (null, 100);
        var median = ok.Count % 2 == 1 ? ok[ok.Count / 2] : (ok[ok.Count / 2 - 1] + ok[ok.Count / 2]) / 2;
        return (Math.Round(median, 1), loss);
    }
}

/// <summary>Allow-listed repairs (mirrors REPAIR_ACTIONS). Anything else is refused before it reaches Windows.</summary>
public static class RepairActions
{
    public static readonly string[] All = ["FLUSH_DNS", "RENEW_IP", "RESTART_AUDIO", "CLEAR_TEMP", "SYNC_TIME", "RESTART_SHELL", "CLOSE_GAMES"];
    /// <summary>What a customer may run from the Shell's Support screen.</summary>
    public static readonly string[] SelfService = ["FLUSH_DNS", "RESTART_AUDIO", "RESTART_SHELL"];
    /// <summary>Harmless enough to really run even in safe mode (an office PC trying the agent).</summary>
    public static readonly string[] SafeInSafeMode = ["FLUSH_DNS", "RESTART_SHELL"];

    public static bool IsKnown(string? a) => a is not null && All.Contains(a);
}
