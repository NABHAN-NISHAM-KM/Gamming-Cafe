using System.Text.Json;

namespace Arena.Agent.Core;

/// <summary>
/// What the agent learned at enrolment. Stored in agent.json (no secrets). The
/// private key lives separately, protected by DPAPI (see KeyStore).
/// </summary>
public sealed record AgentIdentity
{
    public required string ApiUrl { get; init; }
    public required string DeviceId { get; init; }
    public required string OrganizationId { get; init; }
    public required string BranchId { get; init; }
    public required string Name { get; init; }
    /// <summary>Branch command-signing public keys, pinned at enrolment (kid → PEM).</summary>
    public required Dictionary<string, string> SigningKeys { get; init; }
    public int HeartbeatSeconds { get; init; } = 10;
    public string WebsocketPath { get; init; } = "/v1/device/ws";
    /// <summary>
    /// Safe mode simulates disruptive commands (restart, shutdown, logout, lock,
    /// launch/close apps) instead of running them. On by default so the agent
    /// can be tried on an office PC; turn off for real gaming stations.
    /// </summary>
    public bool SafeMode { get; init; } = true;
    public DateTimeOffset EnrolledAt { get; init; } = DateTimeOffset.UtcNow;

    public Uri WebSocketUri()
    {
        var b = new UriBuilder(ApiUrl) { Path = WebsocketPath };
        b.Scheme = b.Scheme == "https" ? "wss" : "ws";
        return b.Uri;
    }

    public static AgentIdentity Load(string path) =>
        JsonSerializer.Deserialize<AgentIdentity>(File.ReadAllText(path), Json.Options)
        ?? throw new InvalidDataException($"Invalid identity file {path}");

    public void Save(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(this, new JsonSerializerOptions(Json.Options) { WriteIndented = true }));
    }
}
