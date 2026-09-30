namespace Arena.Agent;

/// <summary>Where the agent keeps its identity, key and replay log.</summary>
public sealed class AgentPaths(string dataDir)
{
    public string DataDir { get; } = dataDir;
    public string Identity => Path.Combine(DataDir, "agent.json");
    public string Key => Path.Combine(DataDir, "device.key");
    public string Replay => Path.Combine(DataDir, "replay.json");
    public string Session => Path.Combine(DataDir, "session.json");
    public string Venue => Path.Combine(DataDir, "venue.json");
    public string Config => Path.Combine(DataDir, "station-config.json");
    public string StaffPin => Path.Combine(DataDir, "staff-pin.txt");

    /// <summary>--data-dir, then ARENA_AGENT_DATA, then %ProgramData%\ArenaOS\Agent.</summary>
    public static AgentPaths Resolve(string[] args)
    {
        var i = Array.IndexOf(args, "--data-dir");
        var dir = i >= 0 && i + 1 < args.Length ? args[i + 1]
            : Environment.GetEnvironmentVariable("ARENA_AGENT_DATA")
              ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ArenaOS", "Agent");
        return new AgentPaths(Path.GetFullPath(dir));
    }
}
