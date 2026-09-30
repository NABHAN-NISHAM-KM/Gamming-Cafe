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
    public sealed record Launch(string RequestId, string GameId) : ShellRequest;
    public sealed record LaunchApp(string RequestId, string AppId) : ShellRequest;
    public sealed record Help(string RequestId, string Topic, string? Note) : ShellRequest;
    public sealed record Repair(string RequestId, string Action) : ShellRequest;
    public sealed record MenuRequest(string RequestId) : ShellRequest;
    public sealed record PlaceOrder(string RequestId, OrderLine[] Lines, string? Notes, string PayWith) : ShellRequest;
    public sealed record PrintConfirm(string JobKey, string PayWith) : ShellRequest;
    public sealed record PrintCancel(string JobKey) : ShellRequest;
    /// <summary>Shift+F12 on the Shell: staff leave for the Windows desktop. The agent checks the
    /// Windows account (must be an administrator on this PC).</summary>
    public sealed record StaffExit(string RequestId, string Username, string Password) : ShellRequest;
}

public sealed record OrderLine(string ProductId, int Quantity, string[] ModifierIds);

public static partial class ShellProtocol
{
    public const string PipeName = "ArenaOS.Shell";
    public const int MaxLineBytes = 8 * 1024;

    [GeneratedRegex("^[A-Za-z0-9-]{8,64}$")]
    private static partial Regex RequestIdPattern();

    [GeneratedRegex("^[0-9a-fA-F-]{36}$")]
    private static partial Regex UuidPattern();

    [GeneratedRegex("^[A-Za-z0-9_:.-]{3,80}$")]
    private static partial Regex JobKeyPattern();

    private static readonly string[] HelpTopics = ["general", "game", "peripheral", "network", "payment"];

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
                case "launch" or "launch_app":
                {
                    var rid = Str(root, "requestId");
                    var id = Str(root, type.GetString() == "launch" ? "gameId" : "appId");
                    if (rid is null || !RequestIdPattern().IsMatch(rid) || id is null || !UuidPattern().IsMatch(id)) return null;
                    return type.GetString() == "launch" ? new ShellRequest.Launch(rid, id) : new ShellRequest.LaunchApp(rid, id);
                }
                case "help":
                {
                    var rid = Str(root, "requestId");
                    var topic = Str(root, "topic") ?? "general";
                    var note = Str(root, "note");
                    if (rid is null || !RequestIdPattern().IsMatch(rid) || !HelpTopics.Contains(topic) || note is { Length: > 300 }) return null;
                    return new ShellRequest.Help(rid, topic, string.IsNullOrWhiteSpace(note) ? null : note.Trim());
                }
                case "repair":
                {
                    // Customers get only the self-service subset; the rest is for staff (signed RUN_REPAIR).
                    var rid = Str(root, "requestId");
                    var action = Str(root, "action");
                    if (rid is null || !RequestIdPattern().IsMatch(rid) || action is null || !Stations.RepairActions.SelfService.Contains(action)) return null;
                    return new ShellRequest.Repair(rid, action);
                }
                case "menu_request":
                {
                    var rid = Str(root, "requestId");
                    return rid is not null && RequestIdPattern().IsMatch(rid) ? new ShellRequest.MenuRequest(rid) : null;
                }
                case "place_order":
                {
                    // Only ids and counts leave the Shell; the server prices everything.
                    var rid = Str(root, "requestId");
                    var payWith = Str(root, "payWith");
                    var notes = Str(root, "notes");
                    if (rid is null || !RequestIdPattern().IsMatch(rid) || payWith is not ("BILL" or "WALLET") || notes is { Length: > 300 }) return null;
                    if (!root.TryGetProperty("lines", out var ls) || ls.ValueKind != JsonValueKind.Array || ls.GetArrayLength() is < 1 or > 30) return null;
                    var lines = new List<OrderLine>();
                    foreach (var l in ls.EnumerateArray())
                    {
                        var pid = l.ValueKind == JsonValueKind.Object ? Str(l, "productId") : null;
                        if (pid is null || !UuidPattern().IsMatch(pid) || !l.TryGetProperty("quantity", out var q) || !q.TryGetInt32(out var qty) || qty is < 1 or > 20) return null;
                        var mods = new List<string>();
                        if (l.TryGetProperty("modifierIds", out var ms))
                        {
                            if (ms.ValueKind != JsonValueKind.Array || ms.GetArrayLength() > 20) return null;
                            foreach (var m in ms.EnumerateArray())
                            {
                                if (m.ValueKind != JsonValueKind.String || !UuidPattern().IsMatch(m.GetString()!)) return null;
                                mods.Add(m.GetString()!);
                            }
                        }
                        lines.Add(new OrderLine(pid, qty, mods.ToArray()));
                    }
                    return new ShellRequest.PlaceOrder(rid, lines.ToArray(), string.IsNullOrWhiteSpace(notes) ? null : notes.Trim(), payWith);
                }
                case "print_confirm":
                {
                    var key = Str(root, "jobKey");
                    var payWith = Str(root, "payWith");
                    if (key is null || !JobKeyPattern().IsMatch(key) || payWith is not ("BILL" or "WALLET")) return null;
                    return new ShellRequest.PrintConfirm(key, payWith);
                }
                case "print_cancel":
                {
                    var key = Str(root, "jobKey");
                    return key is not null && JobKeyPattern().IsMatch(key) ? new ShellRequest.PrintCancel(key) : null;
                }
                case "staff_exit":
                {
                    var rid = Str(root, "requestId");
                    var user = Str(root, "username")?.Trim();
                    var password = Str(root, "password");
                    if (rid is null || !RequestIdPattern().IsMatch(rid)) return null;
                    if (string.IsNullOrEmpty(user) || user.Length > 120 || string.IsNullOrEmpty(password) || password.Length > 256) return null;
                    return new ShellRequest.StaffExit(rid, user, password);
                }
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

    /// <summary>
    /// The library as the Shell may see it: no executable paths or arguments.
    /// "locked" marks games above the signed-in customer's age.
    /// </summary>
    public static string Library(Games.StationConfig? config, SessionState? session)
    {
        var age = session?.CustomerAge;
        return JsonSerializer.Serialize(new
        {
            type = "library",
            games = (config?.Games ?? []).Select(g => new
            {
                id = g.Id, title = g.Title, categories = g.Categories, coverUrl = g.CoverUrl, minAge = g.MinAge, featured = g.Featured,
                launcher = g.LauncherKey, installed = g.Installed, updateRequired = g.UpdateRequired,
                locked = g.MinAge is { } min && age is { } a && a < min,
            }),
            apps = (config?.Apps ?? []).Select(a => new { id = a.Id, name = a.Name, kind = a.Kind }),
            presets = (config?.PeripheralPresets ?? []).Select(p => new { id = p.Id, name = p.Name, mouseSpeed = p.Settings.MouseSpeed, enhancePointerPrecision = p.Settings.EnhancePointerPrecision }),
        }, StateOptions);
    }

    /// <summary>
    /// Where each library item's art lives on this PC: its .exe (icon) or its Steam app id (cover
    /// and icon from Steam's library cache). For the Shell's host process, which turns them into
    /// images for the page; it is not forwarded, so the page still never sees a path.
    /// </summary>
    public static string ArtSources(string? steamLibraryCache, IEnumerable<(string Id, string? Exe, string? SteamAppId)> items) =>
        JsonSerializer.Serialize(new
        {
            type = "art_sources",
            steamLibraryCache,
            items = items.Select(i => new { id = i.Id, exe = i.Exe, steamAppId = i.SteamAppId }),
        }, StateOptions);

    public static string Result(string type, string requestId, bool ok, string? error = null, string? message = null) =>
        JsonSerializer.Serialize(new { type, requestId, ok, error, message }, Json.Options);

    public static string Playing(string? gameId, string? title) => JsonSerializer.Serialize(new { type = "playing", gameId, title }, StateOptions);

    public static string Network(Stations.NetworkProbe probe) => JsonSerializer.Serialize(new { type = "network", probe }, Json.Options);

    public static string Peripherals(IEnumerable<Stations.DetectedPeripheral> items) =>
        JsonSerializer.Serialize(new { type = "peripherals", items = items.Select(p => new { type = p.Type, name = p.Name, vendor = p.Vendor }) }, Json.Options);

    /// <summary>Tells the host to reload the Shell page (RESTART_SHELL repair).</summary>
    public const string Reload = """{"type":"reload"}""";

    // session:null and logoUrl:null must be sent explicitly — the Shell treats a missing session as unknown.
    private static readonly JsonSerializerOptions StateOptions = new(JsonSerializerDefaults.Web);

    private static string? Str(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
