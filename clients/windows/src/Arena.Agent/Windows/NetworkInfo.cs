using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace Arena.Agent.Windows;

/// <summary>The PC's primary LAN adapter (the one with a default gateway).</summary>
public sealed record PrimaryNic(string Name, string? Ipv4, string? Mac, string? Gateway, long SpeedMbps, IPAddress? Broadcast)
{
    public static PrimaryNic? Detect()
    {
        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != OperationalStatus.Up || nic.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
            var props = nic.GetIPProperties();
            var gw = props.GatewayAddresses.Select(g => g.Address).FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork && !a.Equals(IPAddress.Any));
            if (gw is null) continue;
            var uni = props.UnicastAddresses.FirstOrDefault(u => u.Address.AddressFamily == AddressFamily.InterNetwork);
            var mac = string.Join(":", nic.GetPhysicalAddress().GetAddressBytes().Select(b => b.ToString("X2")));
            IPAddress? bcast = null;
            if (uni?.IPv4Mask is { } mask)
            {
                var ip = uni.Address.GetAddressBytes();
                var m = mask.GetAddressBytes();
                bcast = new IPAddress(ip.Select((b, i) => (byte)(b | ~m[i])).ToArray());
            }
            return new PrimaryNic(nic.Name, uni?.Address.ToString(), mac.Length == 17 ? mac : null, gw.ToString(), nic.Speed / 1_000_000, bcast);
        }
        return null;
    }
}
