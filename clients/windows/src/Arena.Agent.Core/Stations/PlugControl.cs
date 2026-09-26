using System.Net;
using System.Text.RegularExpressions;

namespace Arena.Agent.Core.Stations;

/// <summary>
/// Smart plugs the branch bridge switches for agentless stations (consoles,
/// VR, sim rigs). Only LAN addresses are ever called — even a validly signed
/// command can't make the bridge reach the internet.
/// </summary>
public static partial class PlugControl
{
    public static readonly string[] Kinds = ["SHELLY", "SHELLY_GEN1", "TASMOTA"];

    [GeneratedRegex("^[a-z0-9-]{1,63}\\.(local|lan)$", RegexOptions.IgnoreCase)]
    private static partial Regex LanName();

    /// <summary>Private IPv4 (10/8, 172.16/12, 192.168/16, link-local) or a .local/.lan name.</summary>
    public static bool IsLanHost(string? host)
    {
        if (string.IsNullOrWhiteSpace(host)) return false;
        if (LanName().IsMatch(host)) return true;
        if (!IPAddress.TryParse(host, out var ip) || ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) return false;
        if (host.Count(c => c == '.') != 3) return false; // "10" or "10.1" parse as IPs too — require the dotted form
        var b = ip.GetAddressBytes();
        return b[0] == 10 || (b[0] == 172 && b[1] is >= 16 and <= 31) || (b[0] == 192 && b[1] == 168) || (b[0] == 169 && b[1] == 254);
    }

    /// <summary>The plug's local HTTP API call to switch it, or null if the plug isn't allowed.</summary>
    public static Uri? SwitchUri(string kind, string host, int channel, bool on)
    {
        if (!IsLanHost(host) || channel is < 0 or > 7) return null;
        return kind switch
        {
            "SHELLY" => new Uri($"http://{host}/rpc/Switch.Set?id={channel}&on={(on ? "true" : "false")}"),
            "SHELLY_GEN1" => new Uri($"http://{host}/relay/{channel}?turn={(on ? "on" : "off")}"),
            "TASMOTA" => new Uri($"http://{host}/cm?cmnd=Power{channel + 1}%20{(on ? "On" : "Off")}"),
            _ => null,
        };
    }

    /// <summary>Several consoles can share one plug channel only if they're the same device; the key identifies a switch.</summary>
    public static string KeyOf(string host, int channel) => $"{host.ToLowerInvariant()}#{channel}";
}
