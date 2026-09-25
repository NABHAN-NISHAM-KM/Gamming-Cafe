using System.Text.Json;
using Arena.Agent.Core;
using Arena.Agent.Core.Games;
using Arena.Agent.Core.Stations;
using Xunit;

namespace Arena.Agent.Tests;

public class SteamManifestTests
{
    private const string LibraryFolders = """
        "libraryfolders"
        {
        	"0"
        	{
        		"path"		"C:\\Program Files (x86)\\Steam"
        		"apps"		{ "228980"		"436543216" }
        	}
        	"1"
        	{
        		"path"		"D:\\SteamLibrary"
        		"label"		""
        		"apps"		{ "730"		"36212345678" }
        	}
        }
        """;

    private static string Acf(string appId, string name, int flags, string buildId = "1234567") => $$"""
        "AppState"
        {
        	"appid"		"{{appId}}"
        	"Universe"		"1"
        	"name"		"{{name}}"
        	"StateFlags"		"{{flags}}"
        	"installdir"		"{{name}}"
        	"SizeOnDisk"		"36212345678"
        	"buildid"		"{{buildId}}"
        	// comments are allowed
        	"UserConfig" { "language" "english" }
        }
        """;

    [Fact]
    public void Reads_library_folders_new_and_old_formats()
    {
        var libs = SteamManifests.LibraryFolders(@"C:\Program Files (x86)\Steam", LibraryFolders);
        Assert.Equal([@"C:\Program Files (x86)\Steam", @"D:\SteamLibrary"], libs);
        var old = SteamManifests.LibraryFolders(@"C:\Steam", "\"LibraryFolders\" { \"TimeNextStatsReport\" \"123\" \"1\" \"E:\\\\Games\" }");
        Assert.Equal([@"C:\Steam", @"E:\Games"], old);
        Assert.Equal([@"C:\Steam"], SteamManifests.LibraryFolders(@"C:\Steam", null));
    }

    [Fact]
    public void Installed_up_to_date_and_update_required()
    {
        var ok = SteamManifests.FromAppManifest(Acf("730", "Counter-Strike Global Offensive", 4), @"D:\SteamLibrary")!;
        Assert.Equal(("STEAM", "730", false, 36212345678L), (ok.Source, ok.Key, ok.UpdateRequired, ok.SizeBytes!.Value));
        Assert.Equal(@"D:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive", ok.InstallPath);
        Assert.Equal("1234567", ok.BuildId);
        Assert.True(SteamManifests.FromAppManifest(Acf("730", "CS", 6), "D:\\L")!.UpdateRequired);      // installed + update required
        Assert.True(SteamManifests.FromAppManifest(Acf("730", "CS", 1026), "D:\\L")!.UpdateRequired);   // update running
    }

    [Fact]
    public void Skips_first_time_downloads_and_garbage()
    {
        Assert.Null(SteamManifests.FromAppManifest(Acf("730", "CS", 0), "D:\\L"));
        Assert.Null(SteamManifests.FromAppManifest(Acf("73x0", "CS", 4), "D:\\L"));
        Assert.Null(SteamManifests.FromAppManifest("not a manifest", "D:\\L"));
    }
}

public class EpicManifestTests
{
    [Fact]
    public void Reads_item_files_and_skips_incomplete_installs()
    {
        var g = EpicManifests.FromItem("""{"AppName":"Fortnite","DisplayName":"Fortnite","InstallLocation":"C:\\Program Files\\Epic Games\\Fortnite","InstallSize":98765432100,"AppVersionString":"++Fortnite+Release-31.10","bIsIncompleteInstall":false}""")!;
        Assert.Equal(("EPIC", "Fortnite", "Fortnite", 98765432100L), (g.Source, g.Key, g.Name, g.SizeBytes!.Value));
        Assert.Null(EpicManifests.FromItem("""{"AppName":"Sugar","bIsIncompleteInstall":true}"""));
        Assert.Null(EpicManifests.FromItem("""{"DisplayName":"no app name"}"""));
        Assert.Null(EpicManifests.FromItem("{broken"));
    }
}

public class PeripheralClassifierTests
{
    [Fact]
    public void Classifies_gaming_peripherals_and_names_the_vendor()
    {
        var mouse = PeripheralClassifier.Classify("Mouse", "HID-compliant mouse", @"HID\VID_1532&PID_00B2&MI_00\7&1A2B")!;
        Assert.Equal(("MOUSE", "Razer", "Razer mouse"), (mouse.Type, mouse.Vendor, mouse.Name));
        Assert.Equal("HEADSET", PeripheralClassifier.Classify("AudioEndpoint", "Headset (HyperX Cloud II)", @"SWD\MMDEVAPI\{0.0.0.00000000}.{abc}")!.Type);
        Assert.Equal("CONTROLLER", PeripheralClassifier.Classify("XnaComposite", "Xbox Wireless Controller", @"USB\VID_045E&PID_0B12\3032")!.Type);
        Assert.Equal("STEERING_WHEEL", PeripheralClassifier.Classify("HIDClass", "Logitech G29 Driving Force Racing Wheel", @"HID\VID_046D&PID_C24F\8")!.Type);
    }

    [Fact]
    public void Ignores_internal_and_irrelevant_devices()
    {
        Assert.Null(PeripheralClassifier.Classify("Keyboard", "Standard PS/2 Keyboard", @"ACPI\PNP0303\4&1"));
        Assert.Null(PeripheralClassifier.Classify("HIDClass", "HID-compliant vendor-defined device", @"HID\VID_1532&PID_00B2&MI_02\7"));
        Assert.Null(PeripheralClassifier.Classify("AudioEndpoint", "Speakers (Realtek(R) Audio)", @"SWD\MMDEVAPI\{0.0.0.00000000}.{def}"));
        Assert.Null(PeripheralClassifier.Classify("AudioEndpoint", "Microphone Array (Realtek(R) Audio)", @"SWD\MMDEVAPI\{0.0.1.00000000}.{abc}")); // the laptop's own mic
        Assert.Equal("MICROPHONE", PeripheralClassifier.Classify("AudioEndpoint", "Microphone (HyperX QuadCast)", @"SWD\MMDEVAPI\{0.0.1.00000000}.{def}")!.Type);
    }

    [Fact]
    public void One_entry_per_physical_device()
    {
        var items = new[]
        {
            PeripheralClassifier.Classify("Mouse", "HID-compliant mouse", @"HID\VID_1532&PID_00B2&MI_00\7&1")!,
            PeripheralClassifier.Classify("Mouse", "HID-compliant mouse", @"HID\VID_1532&PID_00B2&MI_01&COL01\7&2")!,
            PeripheralClassifier.Classify("Keyboard", "HID Keyboard Device", @"HID\VID_1532&PID_00B2&MI_01&COL02\7&3")!,
        };
        var d = PeripheralClassifier.Dedupe(items);
        Assert.Equal(["KEYBOARD", "MOUSE"], d.Select(x => x.Type));
    }
}

public class LaunchPolicyTests
{
    private static readonly SessionState Adult = new("s1", "Ahmed", null, DateTimeOffset.UtcNow, null, [5], "LOCK", false, 27);
    private static readonly SessionState Teen = Adult with { CustomerAge = 13 };

    private static StationConfig Config(params LibraryGame[] games) => new("r1", games,
        [new LibraryApp("a0000000-0000-0000-0000-000000000001", "Notepad", "UTILITY", @"C:\Windows\System32\notepad.exe", null),
         new LibraryApp("a0000000-0000-0000-0000-000000000002", "Evil", "UTILITY", @"C:\Windows\System32\cmd.exe", "/c whoami")], [], []);

    private static LibraryGame Game(string id, LaunchSpec? launch, int? minAge = null, bool installed = true) =>
        new(id, "G", [], null, minAge, false, 0, null, launch, ["g.exe"], installed, false);

    private const string Steam = @"C:\Program Files (x86)\Steam\steam.exe";

    [Fact]
    public void Launches_steam_games_through_steam_with_the_appid()
    {
        var cfg = Config(Game("g1", new LaunchSpec("STEAM", null, null, null, "730", null)));
        var (d, plan) = LaunchPolicy.ForGame(cfg, Adult, "g1", Steam);
        Assert.Equal(LaunchDenial.None, d);
        Assert.Equal((Steam, "-applaunch 730"), (plan!.FileName, plan.Arguments));
    }

    [Fact]
    public void Refuses_without_session_unknown_games_age_and_not_installed()
    {
        var cfg = Config(Game("g1", new LaunchSpec("STEAM", null, null, null, "730", null), minAge: 18), Game("g2", new LaunchSpec("STEAM", null, null, null, "570", null), installed: false));
        Assert.Equal(LaunchDenial.NoSession, LaunchPolicy.ForGame(cfg, null, "g1", Steam).Denial);
        Assert.Equal(LaunchDenial.NotInLibrary, LaunchPolicy.ForGame(cfg, Adult, "nope", Steam).Denial);
        Assert.Equal(LaunchDenial.AgeRestricted, LaunchPolicy.ForGame(cfg, Teen, "g1", Steam).Denial);
        Assert.Equal(LaunchDenial.NotInstalled, LaunchPolicy.ForGame(cfg, Adult, "g2", Steam).Denial);
        Assert.Equal(LaunchDenial.NotLaunchable, LaunchPolicy.ForGame(cfg, Adult, "g1", steamExe: null).Denial); // Steam not installed
    }

    [Fact]
    public void Never_runs_interpreters_or_malformed_ids_even_if_signed()
    {
        Assert.Null(LaunchPolicy.PlanFor(new LaunchSpec("PATH", @"C:\Windows\System32\cmd.exe", "/c calc", null, null, null), Steam));
        Assert.Null(LaunchPolicy.PlanFor(new LaunchSpec("PATH", @"relative\game.exe", null, null, null, null), Steam));
        Assert.Null(LaunchPolicy.PlanFor(new LaunchSpec("STEAM", null, null, null, "730 -console", null), Steam));
        Assert.Null(LaunchPolicy.PlanFor(new LaunchSpec("EPIC", null, null, null, null, "x&action=uninstall"), Steam));
        Assert.Equal(LaunchDenial.Forbidden, LaunchPolicy.ForApp(Config(), Adult, "a0000000-0000-0000-0000-000000000002").Denial);
        Assert.Equal(LaunchDenial.None, LaunchPolicy.ForApp(Config(), Adult, "a0000000-0000-0000-0000-000000000001").Denial);
    }

    [Fact]
    public void Epic_uses_its_launcher_uri()
    {
        var plan = LaunchPolicy.PlanFor(new LaunchSpec("EPIC", null, null, null, null, "Fortnite"), null)!;
        Assert.EndsWith("explorer.exe", plan.FileName);
        Assert.Equal("\"com.epicgames.launcher://apps/Fortnite?action=launch&silent=true\"", plan.Arguments);
    }

    [Fact]
    public void Config_payload_round_trips_from_the_server_shape()
    {
        var json = """
            {"revision":"abc","games":[{"id":"g1","title":"CS2","categories":["FPS"],"coverUrl":null,"minAge":18,"featured":true,"sortOrder":0,"launcherKey":"STEAM",
              "launch":{"kind":"STEAM","appId":"730"},"processNames":["cs2.exe"],"installed":true,"updateRequired":false}],
             "apps":[],"connectivityTargets":[{"name":"Router","host":"gateway"}],"peripheralPresets":[{"id":"p1","name":"FPS","settings":{"mouseSpeed":6,"enhancePointerPrecision":false}}]}
            """;
        var cfg = StationConfig.FromPayload(JsonDocument.Parse(json).RootElement)!;
        Assert.Equal("730", cfg.Games[0].Launch!.AppId);
        Assert.Equal(6, cfg.PeripheralPresets[0].Settings.MouseSpeed);
        Assert.Equal("gateway", cfg.ConnectivityTargets[0].Host);
    }
}

public class StationProtocolTests
{
    [Fact]
    public void Shell_may_request_launch_help_and_only_self_service_repairs()
    {
        const string rid = "2b1f0a4e-9c1d-4f5e-8a7b-1234567890ab";
        Assert.IsType<ShellRequest.Launch>(ShellProtocol.Parse($$"""{"type":"launch","requestId":"{{rid}}","gameId":"{{rid}}"}"""));
        Assert.IsType<ShellRequest.Help>(ShellProtocol.Parse($$"""{"type":"help","requestId":"{{rid}}","topic":"peripheral","note":"mouse broken"}"""));
        Assert.IsType<ShellRequest.Repair>(ShellProtocol.Parse($$"""{"type":"repair","requestId":"{{rid}}","action":"RESTART_AUDIO"}"""));
        Assert.Null(ShellProtocol.Parse($$"""{"type":"repair","requestId":"{{rid}}","action":"CLEAR_TEMP"}""")); // staff only
        Assert.Null(ShellProtocol.Parse($$"""{"type":"launch","requestId":"{{rid}}","gameId":"C:\\Windows\\System32\\cmd.exe"}"""));
        Assert.Null(ShellProtocol.Parse($$"""{"type":"help","requestId":"{{rid}}","topic":"hacking"}"""));
    }

    [Fact]
    public void Seat_orders_carry_only_ids_and_counts()
    {
        const string rid = "2b1f0a4e-9c1d-4f5e-8a7b-1234567890ab";
        const string pid = "01a0d9d3-df92-7347-a7b7-8cd940baf971";
        var ok = Assert.IsType<ShellRequest.PlaceOrder>(ShellProtocol.Parse($$"""{"type":"place_order","requestId":"{{rid}}","payWith":"BILL","notes":" no ice ","lines":[{"productId":"{{pid}}","quantity":2,"modifierIds":["{{pid}}"],"price":"0.01"}]}"""));
        Assert.Equal((2, "no ice"), (ok.Lines[0].Quantity, ok.Notes));
        Assert.Contains(pid, Outgoing.PlaceOrder(ok.RequestId, ok.Lines, ok.Notes, ok.PayWith));
        Assert.DoesNotContain("price", Outgoing.PlaceOrder(ok.RequestId, ok.Lines, ok.Notes, ok.PayWith)); // whatever the page sent, only ids travel on
        Assert.Null(ShellProtocol.Parse($$"""{"type":"place_order","requestId":"{{rid}}","payWith":"FREE","lines":[{"productId":"{{pid}}","quantity":1}]}"""));
        Assert.Null(ShellProtocol.Parse($$"""{"type":"place_order","requestId":"{{rid}}","payWith":"BILL","lines":[{"productId":"{{pid}}","quantity":99}]}"""));
        Assert.Null(ShellProtocol.Parse($$"""{"type":"place_order","requestId":"{{rid}}","payWith":"BILL","lines":[]}"""));
        Assert.IsType<ShellRequest.MenuRequest>(ShellProtocol.Parse($$"""{"type":"menu_request","requestId":"{{rid}}"}"""));
    }

    [Fact]
    public void Library_for_the_shell_hides_paths_and_locks_by_age()
    {
        var cfg = new StationConfig("r", [new LibraryGame("g1", "CS2", ["FPS"], null, 18, true, 0, "STEAM", new LaunchSpec("PATH", @"C:\Games\cs2.exe", "-secret", null, null, null), ["cs2.exe"], true, false)], [], [], []);
        var teen = new SessionState("s", "Sara", null, DateTimeOffset.UtcNow, null, [], "LOCK", false, 13);
        var json = ShellProtocol.Library(cfg, teen);
        Assert.DoesNotContain("cs2.exe", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("-secret", json);
        Assert.True(JsonDocument.Parse(json).RootElement.GetProperty("games")[0].GetProperty("locked").GetBoolean());
    }

    [Fact]
    public void Probe_summary_is_median_and_loss()
    {
        Assert.Equal((12.0, 25.0), ProbeMath.Summarize([10, 12, null, 40]) is var (p, l) ? (p!.Value, l) : default);
        Assert.Equal((null, 100.0), ProbeMath.Summarize([null, null]));
    }

    [Fact]
    public void Session_start_carries_the_customer_age()
    {
        var m = new SessionManager(null);
        var payload = JsonSerializer.SerializeToElement(new
        {
            sessionId = "s1", customer = new { id = "c", displayName = "Sara", age = 13 }, startedAt = DateTimeOffset.UtcNow, expiresAt = DateTimeOffset.UtcNow.AddHours(1),
            serverTime = DateTimeOffset.UtcNow, warningMinutes = new[] { 5 }, postSessionAction = "LOCK", allowSelfExtend = false,
        });
        m.Apply("START_SESSION", payload, DateTimeOffset.UtcNow);
        Assert.Equal(13, m.Current!.CustomerAge);
    }
}
