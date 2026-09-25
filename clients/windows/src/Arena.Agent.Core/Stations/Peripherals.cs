using System.Text.RegularExpressions;

namespace Arena.Agent.Core.Stations;

public sealed record DetectedPeripheral(string HardwareId, string Type, string Name, string? Vendor);

/// <summary>
/// Turns Windows Plug-and-Play entries into customer-meaningful peripherals
/// (mouse, keyboard, headset, controller, wheel…). Composite USB devices show
/// up many times; one entry per physical device (vendor+product) is kept.
/// </summary>
public static partial class PeripheralClassifier
{
    // USB vendor ids of common gaming-peripheral brands.
    private static readonly Dictionary<string, string> Vendors = new(StringComparer.OrdinalIgnoreCase)
    {
        ["1532"] = "Razer", ["046D"] = "Logitech", ["1038"] = "SteelSeries", ["1B1C"] = "Corsair", ["0951"] = "HyperX", ["03F0"] = "HyperX",
        ["0B05"] = "ASUS", ["1462"] = "MSI", ["045E"] = "Microsoft", ["054C"] = "Sony", ["057E"] = "Nintendo", ["044F"] = "Thrustmaster",
        ["0EB7"] = "Fanatec", ["28DE"] = "Valve", ["1E7D"] = "ROCCAT", ["258A"] = "Glorious", ["3434"] = "Keychron", ["2516"] = "Cooler Master",
        ["0738"] = "Mad Catz", ["1689"] = "Razer", ["0E6F"] = "PDP", ["20D6"] = "PowerA", ["2DC8"] = "8BitDo", ["1BCF"] = "Sunplus", ["0C45"] = "Microdia",
    };

    [GeneratedRegex(@"VID_([0-9A-F]{4})&PID_([0-9A-F]{4})", RegexOptions.IgnoreCase)]
    private static partial Regex VidPid();

    public static string? VendorOf(string deviceId) => VidPid().Match(deviceId) is { Success: true } m && Vendors.TryGetValue(m.Groups[1].Value, out var v) ? v : null;

    /// <summary>Classifies one PnP entry. Returns null for things customers don't care about (hubs, system devices…).</summary>
    public static DetectedPeripheral? Classify(string? pnpClass, string? name, string deviceId)
    {
        if (string.IsNullOrWhiteSpace(deviceId) || string.IsNullOrWhiteSpace(name)) return null;
        var external = deviceId.StartsWith("USB", StringComparison.OrdinalIgnoreCase) || deviceId.StartsWith("HID", StringComparison.OrdinalIgnoreCase)
                       || deviceId.StartsWith("BTH", StringComparison.OrdinalIgnoreCase) || deviceId.StartsWith(@"SWD\MMDEVAPI", StringComparison.OrdinalIgnoreCase);
        if (!external) return null;
        var n = name.ToLowerInvariant();
        // Audio endpoints of the motherboard/laptop itself are not customer gear.
        if (string.Equals(pnpClass, "AudioEndpoint", StringComparison.OrdinalIgnoreCase)
            && (n.Contains("realtek") || n.Contains("microphone array") || n.Contains("high definition audio") || n.Contains("intel") || n.Contains("amd ")))
            return null;
        string? type = (pnpClass ?? "").ToLowerInvariant() switch
        {
            "mouse" => "MOUSE",
            "keyboard" => "KEYBOARD",
            "camera" or "image" => "WEBCAM",
            "xnacomposite" or "xboxcomposite" => "CONTROLLER",
            "audioendpoint" when n.Contains("microphone") && !n.Contains("headset") => "MICROPHONE",
            "audioendpoint" when n.Contains("headset") || n.Contains("headphone") || n.Contains("earphone") => "HEADSET",
            "hidclass" when n.Contains("wheel") || n.Contains("racing") => "STEERING_WHEEL",
            "hidclass" when n.Contains("joystick") || n.Contains("flight") || n.Contains("hotas") => "JOYSTICK",
            "hidclass" when n.Contains("game controller") || n.Contains("gamepad") || n.Contains("controller") => "CONTROLLER",
            _ => null,
        };
        if (type is null) return null;
        // Generic driver names say nothing useful; prefer the vendor where we know it.
        var vendor = VendorOf(deviceId);
        var label = name is "HID-compliant mouse" or "HID Keyboard Device" or "USB Input Device" && vendor is not null ? $"{vendor} {type.ToLowerInvariant()}" : name;
        return new DetectedPeripheral(deviceId, type, label, vendor);
    }

    /// <summary>One entry per physical device (same VID/PID and type), keeping the most descriptive name.</summary>
    public static List<DetectedPeripheral> Dedupe(IEnumerable<DetectedPeripheral> items)
    {
        string KeyOf(DetectedPeripheral p) => (VidPid().Match(p.HardwareId) is { Success: true } m ? m.Value.ToUpperInvariant() : p.HardwareId) + "|" + p.Type;
        return items
            .GroupBy(KeyOf)
            .Select(g => g.OrderByDescending(p => p.Vendor is not null && !p.Name.StartsWith(p.Vendor, StringComparison.Ordinal) ? 1 : 0).ThenBy(p => p.HardwareId, StringComparer.Ordinal).First())
            .OrderBy(p => p.Type, StringComparer.Ordinal).ThenBy(p => p.Name, StringComparer.Ordinal)
            .ToList();
    }
}
