using System.Collections.Concurrent;
using System.Text.Json;
using Arena.Agent.Core.Stations;
using Arena.Agent.Windows;

namespace Arena.Agent;

/// <summary>
/// The branch bridge's job for agentless stations: switch their smart plugs on
/// the LAN (signed POWER commands). "Off in 60 s" waits so the TV can show
/// "time's up"; any later command for the same plug supersedes a pending one,
/// so a new session starting in that minute keeps the console on.
/// </summary>
public sealed class PowerBridge(ILogger<PowerBridge> log)
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(5) };
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _pending = new();

    public async Task<ExecResult> ExecuteAsync(JsonElement p, bool safeMode, CancellationToken ct)
    {
        if (!p.TryGetProperty("plug", out var plug) || plug.ValueKind != JsonValueKind.Object) return ExecResult.Fail("BAD_PAYLOAD", "plug missing");
        var kind = plug.TryGetProperty("kind", out var k) ? k.GetString() ?? "" : "";
        var host = plug.TryGetProperty("host", out var h) ? h.GetString() ?? "" : "";
        var channel = plug.TryGetProperty("channel", out var c) && c.TryGetInt32(out var ch) ? ch : 0;
        var on = p.TryGetProperty("on", out var o) && o.ValueKind == JsonValueKind.True;
        var delay = p.TryGetProperty("delaySeconds", out var d) && d.TryGetInt32(out var ds) ? Math.Clamp(ds, 0, 600) : 0;
        var target = p.TryGetProperty("targetName", out var tn) ? tn.GetString() : null;

        var uri = PlugControl.SwitchUri(kind, host, channel, on);
        if (uri is null) return ExecResult.Fail("PLUG_NOT_ALLOWED", "Smart plugs must be on the local network");

        var key = PlugControl.KeyOf(host, channel);
        if (_pending.TryRemove(key, out var older)) { older.Cancel(); older.Dispose(); } // superseded
        if (safeMode)
        {
            log.LogInformation("SAFE MODE: simulated {Target} power {State} ({Uri})", target, on ? "on" : "off", uri);
            return ExecResult.Success(new { simulated = true, on, delaySeconds = delay });
        }
        if (delay == 0) return await SwitchAsync(uri, target, on, ct);

        var cts = new CancellationTokenSource();
        _pending[key] = cts;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(delay), cts.Token);
                var r = await SwitchAsync(uri, target, on, CancellationToken.None);
                if (!r.Ok) log.LogWarning("Delayed power {State} for {Target} failed: {Error}", on ? "on" : "off", target, r.ErrorMessage);
            }
            catch (OperationCanceledException) { log.LogInformation("Power {State} for {Target} superseded", on ? "on" : "off", target); }
            finally { _pending.TryRemove(new KeyValuePair<string, CancellationTokenSource>(key, cts)); }
        });
        return ExecResult.Success(new { scheduled = true, on, delaySeconds = delay });
    }

    private async Task<ExecResult> SwitchAsync(Uri uri, string? target, bool on, CancellationToken ct)
    {
        try
        {
            using var res = await Http.GetAsync(uri, ct);
            log.LogInformation("{Target} power {State}: HTTP {Status}", target, on ? "on" : "off", (int)res.StatusCode);
            return res.IsSuccessStatusCode ? ExecResult.Success(new { on }) : ExecResult.Fail("PLUG_HTTP", $"The plug answered {(int)res.StatusCode}");
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return ExecResult.Fail("PLUG_UNREACHABLE", $"Couldn't reach the plug at {uri.Host}: {e.Message}");
        }
    }
}
