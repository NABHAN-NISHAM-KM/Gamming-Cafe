using System.Text.Json;
using System.Text.Json.Serialization;

namespace Arena.Agent.Core;

// Mirrors packages/contracts/src/device-protocol.ts. Field names are camelCase on the wire.

public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
    };
}

/// <summary>What arrives from the server. <see cref="Envelope"/> is the exact signed JSON text.</summary>
public sealed record SignedCommand(string Kid, string Envelope, string Signature);

public sealed record RequestedBy(string Type, string? Id);

public sealed record CommandEnvelope(
    int V,
    string CommandId,
    string OrganizationId,
    string BranchId,
    string DeviceId,
    string Type,
    JsonElement Payload,
    RequestedBy RequestedBy,
    DateTimeOffset IssuedAt,
    DateTimeOffset ExpiresAt,
    string Nonce);

public sealed record DeviceMetrics
{
    public double? CpuPct { get; init; }
    public double? GpuPct { get; init; }
    public double? RamPct { get; init; }
    public double? DiskPct { get; init; }
    public double? CpuTempC { get; init; }
    public double? GpuTempC { get; init; }
    public double? PingMs { get; init; }
    public double? PacketLossPct { get; init; }
    public double? Fps { get; init; }
    public long? UptimeSec { get; init; }
    public string? ForegroundApp { get; init; }
    public string? ShellState { get; init; }
}

public sealed record DiskInfo(string? Model, string? Serial, double? SizeGb, double? FreeGb);
public sealed record NicInfo(string? Name, string? Mac, double? SpeedMbps, string? Ip);

public sealed record HardwareSnapshot
{
    public string? Cpu { get; init; }
    public int? CpuCores { get; init; }
    public string? Gpu { get; init; }
    public double? GpuVramMb { get; init; }
    public double? RamMb { get; init; }
    public string? Motherboard { get; init; }
    public string? BiosVersion { get; init; }
    public string? OsVersion { get; init; }
    public List<DiskInfo> Disks { get; init; } = [];
    public List<NicInfo> Nics { get; init; } = [];
}

/// <summary>Outgoing messages (device → server).</summary>
public static class Outgoing
{
    /// <param name="activeSessionId">The session this PC believes it is running, so the server can resync it after a restart.</param>
    public static string Hello(string agentVersion, string? ip, string? hostname, string? mac, string? activeSessionId = null, string? shellVersion = null) =>
        JsonSerializer.Serialize(new { type = "hello", agentVersion, shellVersion, ipAddress = ip, hostname, macAddress = mac, activeSessionId }, Json.Options);

    public static string ShellLogin(string requestId, string username, string secret) =>
        JsonSerializer.Serialize(new { type = "shell_login", requestId, username, secret }, Json.Options);

    public static string ShellLogout(string requestId, string sessionId) =>
        JsonSerializer.Serialize(new { type = "shell_logout", requestId, sessionId }, Json.Options);

    // ── Phase 5: station reports ────────────────────────────────────────────

    public static string Inventory(IEnumerable<Games.DetectedGame> games, IEnumerable<Games.DetectedApp>? apps = null) =>
        JsonSerializer.Serialize(new
        {
            type = "inventory",
            games = games.Select(g => new { source = g.Source, key = g.Key, name = g.Name, installPath = g.InstallPath, buildId = g.BuildId, sizeBytes = g.SizeBytes, updateRequired = g.UpdateRequired, updating = g.Updating ? true : (bool?)null, progressPct = g.ProgressPct }),
            apps = apps?.Select(a => new { key = a.Key, name = a.Name, version = a.Version, publisher = a.Publisher, installPath = a.InstallPath, executablePath = a.ExecutablePath, sizeBytes = a.SizeBytes }),
        }, Json.Options);

    public static string Peripherals(IEnumerable<Stations.DetectedPeripheral> items) =>
        JsonSerializer.Serialize(new { type = "peripherals", items = items.Select(p => new { hardwareId = p.HardwareId, type = p.Type, name = p.Name, vendor = p.Vendor }) }, Json.Options);

    public static string Network(Stations.NetworkProbe probe) => JsonSerializer.Serialize(new { type = "network", probe }, Json.Options);

    public static string Boot(string mode, string? provider, string? bootServer) =>
        JsonSerializer.Serialize(new { type = "boot", report = new { mode, provider, bootServer } }, Json.Options);

    public static string GameEvent(string evt, string gameId, string? sessionId) =>
        JsonSerializer.Serialize(new { type = "game_event", @event = evt, gameId, sessionId }, Json.Options);

    public static string HelpRequest(string requestId, string topic, string? note) =>
        JsonSerializer.Serialize(new { type = "help_request", requestId, topic, note }, Json.Options);

    public static string SessionFeedback(int rating, string? comment) =>
        JsonSerializer.Serialize(new { type = "session_feedback", rating, comment }, Json.Options);

    public static string MenuRequest(string requestId) => JsonSerializer.Serialize(new { type = "menu_request", requestId }, Json.Options);

    public static string ScreenshotBegin(string id, int sizeBytes, int width, int height, byte[] thumb) =>
        JsonSerializer.Serialize(new { type = "screenshot_begin", id, sizeBytes, width, height, thumb = Convert.ToBase64String(thumb) }, Json.Options);

    public static string ScreenshotChunk(string id, int seq, ReadOnlySpan<byte> data) =>
        JsonSerializer.Serialize(new { type = "screenshot_chunk", id, seq, data = Convert.ToBase64String(data) }, Json.Options);

    public static string ScreenshotEnd(string id) => JsonSerializer.Serialize(new { type = "screenshot_end", id }, Json.Options);

    public static string TimeOffers(string requestId) => JsonSerializer.Serialize(new { type = "time_offers", requestId }, Json.Options);

    public static string QrLogin(string requestId) => JsonSerializer.Serialize(new { type = "qr_login", requestId }, Json.Options);

    public static string Player(string requestId, string action, string argsJson)
    {
        using var args = JsonDocument.Parse(argsJson);
        return JsonSerializer.Serialize(new { type = "player_request", requestId, action, args = args.RootElement }, Json.Options);
    }

    public static string BuyTime(string requestId, string? packageId, int? savedMinutes) =>
        JsonSerializer.Serialize(new { type = "buy_time", requestId, packageId, savedMinutes }, Json.Options);

    public static string PlaceOrder(string requestId, IEnumerable<OrderLine> lines, string? notes, string payWith) =>
        JsonSerializer.Serialize(new { type = "place_order", requestId, lines = lines.Select(l => new { productId = l.ProductId, quantity = l.Quantity, modifierIds = l.ModifierIds }), notes, payWith }, Json.Options);

    // ── Phase 9: printing ───────────────────────────────────────────────────

    public static string PrintJob(Printing.PrintJobReport job) =>
        JsonSerializer.Serialize(new { type = "print_job", job = new { jobKey = job.JobKey, printerName = job.PrinterName, document = job.Document, pages = job.Pages, copies = job.Copies, color = job.Color } }, Json.Options);

    public static string PrintConfirm(string jobKey, string payWith) => JsonSerializer.Serialize(new { type = "print_confirm", jobKey, payWith }, Json.Options);

    public static string PrintCancel(string jobKey) => JsonSerializer.Serialize(new { type = "print_cancel", jobKey }, Json.Options);

    public static string PrintDone(string jobKey, bool ok, string? detail) => JsonSerializer.Serialize(new { type = "print_done", jobKey, ok, detail }, Json.Options);

    public static string SelfRepair(string action, bool ok, string? detail) =>
        JsonSerializer.Serialize(new { type = "self_repair", action, ok, detail }, Json.Options);

    public static string Heartbeat(DeviceMetrics metrics) =>
        JsonSerializer.Serialize(new { type = "heartbeat", metrics }, Json.Options);

    public static string Hardware(HardwareSnapshot snapshot) =>
        JsonSerializer.Serialize(new { type = "hardware", snapshot }, Json.Options);

    /// <param name="status">RECEIVED | EXECUTING | SUCCESS | FAILED</param>
    public static string Ack(string commandId, string status, string? errorCode = null, string? errorMessage = null, object? result = null) =>
        JsonSerializer.Serialize(new { type = "ack", commandId, status, errorCode, errorMessage, result }, Json.Options);
}

/// <summary>Enrolment response from POST /v1/device/enroll.</summary>
public sealed record EnrollResponse(
    string DeviceId,
    string OrganizationId,
    string BranchId,
    string ZoneId,
    string Name,
    Dictionary<string, string> SigningKeys,
    int HeartbeatSeconds,
    string WebsocketPath);
