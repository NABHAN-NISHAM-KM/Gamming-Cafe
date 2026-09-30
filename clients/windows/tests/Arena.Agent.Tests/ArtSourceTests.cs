using Arena.Agent.Core;
using Arena.Agent.Core.Games;
using Xunit;

namespace Arena.Agent.Tests;

public class ArtSourceTests
{
    [Fact]
    public void Epic_manifest_gives_the_games_own_exe_for_its_icon()
    {
        var e = EpicManifests.LaunchExe("""{"AppName":"Fortnite","InstallLocation":"C:\\Games\\Fortnite","LaunchExecutable":"FortniteGame/Binaries/Win64/FortniteLauncher.exe"}""");
        Assert.Equal("Fortnite", e!.Value.AppName);
        Assert.EndsWith("FortniteLauncher.exe", e.Value.Exe);
        Assert.StartsWith(@"C:\Games\Fortnite", e.Value.Exe);
        Assert.Null(EpicManifests.LaunchExe("""{"AppName":"X","InstallLocation":"C:\\X","LaunchExecutable":"run.bat"}"""));
        Assert.Null(EpicManifests.LaunchExe("not json"));
    }

    [Fact]
    public void Art_sources_carry_ids_and_where_the_art_is()
    {
        var json = ShellProtocol.ArtSources(@"C:\Steam\appcache\librarycache", [("g1", null, "730"), ("a1", @"C:\Apps\chrome.exe", null)]);
        Assert.Contains("\"type\":\"art_sources\"", json);
        Assert.Contains("\"steamAppId\":\"730\"", json);
        Assert.Contains("chrome.exe", json);
    }
}

public class BuyTimeProtocolTests
{
    [Theory]
    [InlineData("""{"type":"buy_time","requestId":"abcd1234","packageId":"0190a3b2-1c2d-7e8f-9a0b-1c2d3e4f5a6b"}""", true)]
    [InlineData("""{"type":"buy_time","requestId":"abcd1234","savedMinutes":60}""", true)]
    [InlineData("""{"type":"buy_time","requestId":"abcd1234"}""", false)]
    [InlineData("""{"type":"buy_time","requestId":"abcd1234","savedMinutes":45}""", false)]
    [InlineData("""{"type":"buy_time","requestId":"abcd1234","savedMinutes":60,"packageId":"0190a3b2-1c2d-7e8f-9a0b-1c2d3e4f5a6b"}""", false)]
    [InlineData("""{"type":"buy_time","requestId":"abcd1234","packageId":"not-a-uuid"}""", false)]
    public void Buy_time_needs_exactly_one_way_to_pay(string line, bool valid)
    {
        var r = ShellProtocol.Parse(line);
        if (valid) Assert.IsType<ShellRequest.BuyTime>(r);
        else Assert.Null(r);
    }
}
