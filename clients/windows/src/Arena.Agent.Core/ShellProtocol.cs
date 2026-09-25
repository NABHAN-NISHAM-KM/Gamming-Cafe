using System.Text.Json;
using System.Text.RegularExpressions;

namespace Arena.Agent.Core;

// Agent ↔ Gaming Shell messages over the local named pipe (one JSON object per
// line). Mirrors apps/shell/src/bridge.ts. The Shell is UNTRUSTED input: it can
// only ask for ready / login / logout — it never tells the agent what the
// session is. Session state flows one way, from verified server commands.

public sealed record VenueInfo(string Name, string BranchName, string? LogoUrl)
{
    public static readonly VenueInfo Unknown = new("ArenaOS", "", null);
}

public abstract record ShellRequest
{
    public sealed record Ready : ShellRequest;
    public sealed record Login(string RequestId, string Username, string Secret) : ShellRequest;
    public sealed record Logout : ShellRequest;
}

public static partial class ShellProtocol
{
    public const string PipeName = "ArenaOS.Shell";
    public const int MaxLineBytes = 8 * 1024;

    [GeneratedRegex("^[A-Za-z0-9-]{8,64}$")]
    private static partial Regex RequestIdPattern();

    /// <summary>Parses one line from the Shell. Returns null for anything malformed, oversized or unknown.</summary>
    public static ShellRequest? Parse(string line)
    {
        if (string.IsNullOrWhiteSpace(line) || line.Length > MaxLineBytes) return null;
        try
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String) return null;
            switch (type.GetString())
            {
                case "ready":
                    return new ShellRequest.Ready();
                case "logout":
                    return new ShellRequest.Logout();
                case "login":
                    var requestId = Str(root, "requestId");
                    var username = Str(root, "username")?.Trim();
                    var secret = Str(root, "secret");
                    if (requestId is null || !RequestIdPattern().IsMatch(requestId)) return null;
                    if (string.IsNullOrEmpty(username) || username.Length > 120) return null;
                    if (string.IsNullOrEmpty(secret) || secret.Length > 128) return null;
                    return new ShellRequest.Login(requestId, username, secret);
                default:
                    return null;
            }
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static string State(bool connected, string stationName, VenueInfo venue, SessionState? session, TimeSpan clockOffset, bool safeMode) =>
        JsonSerializer.Serialize(new
        {
            type = "state",
            connected,
            station = new { name = stationName },
            venue = new { name = venue.Name, branchName = venue.BranchName, logoUrl = venue.LogoUrl },
            session = session is null ? null : new
            {
                id = session.SessionId,
                customerName = session.CustomerName,
                tier = session.MembershipTier,
                startedAt = session.StartedAt,
                expiresAt = session.ExpiresAt,
                warningMinutes = session.WarningMinutes,
            },
            serverOffsetMs = (long)clockOffset.TotalMilliseconds,
            safeMode,
        }, StateOptions);

    public static string LoginResult(string requestId, bool ok, string? error = null, string? message = null) =>
        JsonSerializer.Serialize(new { type = "login_result", requestId, ok, error, message }, Json.Options);

    public static string Message(string title, string text) =>
        JsonSerializer.Serialize(new { type = "message", title, text }, Json.Options);

    // session:null and logoUrl:null must be sent explicitly — the Shell treats a missing session as unknown.
    private static readonly JsonSerializerOptions StateOptions = new(JsonSerializerDefaults.Web);

    private static string? Str(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
