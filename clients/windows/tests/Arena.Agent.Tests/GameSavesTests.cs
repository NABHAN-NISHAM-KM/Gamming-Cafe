using System.IO.Compression;
using System.Text.Json;
using Arena.Agent.Core;
using Arena.Agent.Core.Games;
using Xunit;

namespace Arena.Agent.Tests;

public class GameSavesTests : IDisposable
{
    private readonly string _profile = Path.Combine(Path.GetTempPath(), "arena-saves-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_profile)) Directory.Delete(_profile, recursive: true);
    }

    [Fact]
    public void Resolves_placeholders_inside_the_profile_only()
    {
        Assert.Equal(Path.Combine(_profile, "AppData", "Roaming", "Game", "Saves"), GameSaves.Resolve(@"%APPDATA%\Game\Saves", _profile));
        Assert.Equal(Path.Combine(_profile, "Saved Games", "X"), GameSaves.Resolve(@"%SAVEDGAMES%\X", _profile));
        Assert.Null(GameSaves.Resolve(@"%APPDATA%\..\..\Windows", _profile));
        Assert.Null(GameSaves.Resolve(@"C:\Windows", _profile));
        Assert.Null(GameSaves.Resolve(@"%TEMP%\x", _profile));
        Assert.Null(GameSaves.Resolve("%APPDATA%", _profile));
    }

    [Fact]
    public void Packs_and_restores_each_folder_to_its_own_place()
    {
        var a = GameSaves.Resolve(@"%APPDATA%\Game\Saves", _profile)!;
        var b = GameSaves.Resolve(@"%DOCUMENTS%\Game\Config", _profile)!;
        Directory.CreateDirectory(Path.Combine(a, "slot"));
        File.WriteAllText(Path.Combine(a, "slot", "1.sav"), "level 9");
        Directory.CreateDirectory(b);
        File.WriteAllText(Path.Combine(b, "keys.cfg"), "jump=space");
        var zip = GameSaves.Pack([a, b])!;

        Directory.Delete(_profile, recursive: true);
        Assert.Equal(2, GameSaves.Unpack(zip, [a, b]));
        Assert.Equal("level 9", File.ReadAllText(Path.Combine(a, "slot", "1.sav")));
        Assert.Equal("jump=space", File.ReadAllText(Path.Combine(b, "keys.cfg")));
        Assert.Null(GameSaves.Pack([Path.Combine(_profile, "missing")])); // nothing to save
    }

    [Fact]
    public void Never_writes_outside_the_folders_whatever_the_zip_says()
    {
        var folder = Path.Combine(_profile, "saves");
        using var ms = new MemoryStream();
        using (var z = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var name in new[] { "0/../../evil.txt", "7/out-of-range.txt", "nonumber/x.txt", "0/ok.txt" })
                using (var w = new StreamWriter(z.CreateEntry(name).Open())) w.Write("x");
        }
        Assert.Equal(1, GameSaves.Unpack(ms.ToArray(), [folder]));
        Assert.True(File.Exists(Path.Combine(folder, "ok.txt")));
        Assert.False(File.Exists(Path.Combine(_profile, "evil.txt")));
        Assert.False(File.Exists(Path.Combine(Path.GetDirectoryName(_profile)!, "evil.txt")));
    }

    [Fact]
    public void The_shell_may_ask_about_its_player_but_not_move_saves()
    {
        var p = Assert.IsType<ShellRequest.Player>(ShellProtocol.Parse("""{"type":"player_request","requestId":"req-12345678","action":"overview"}"""));
        Assert.Equal(("overview", "{}"), (p.Action, p.ArgsJson));
        var f = Assert.IsType<ShellRequest.Player>(ShellProtocol.Parse("""{"type":"player_request","requestId":"req-12345678","action":"favorite","args":{"gameId":"g","on":true}}"""));
        Assert.Contains("\"on\":true", f.ArgsJson);
        Assert.Null(ShellProtocol.Parse("""{"type":"player_request","requestId":"req-12345678","action":"save_get","args":{}}"""));
        Assert.Null(ShellProtocol.Parse("""{"type":"player_request","requestId":"req-12345678","action":"overview","args":[1]}"""));
        Assert.Contains("\"type\":\"player_request\"", Outgoing.Player("req-12345678", "overview", "{}"));
    }

    [Fact]
    public void Library_says_why_a_game_is_locked()
    {
        var game = new LibraryGame("g1", "CS", [], null, 18, false, 0, null, null, [], true, false, [@"%APPDATA%\CS"]);
        var other = game with { Id = "g2", MinAge = null, SavePaths = null };
        var cfg = new StationConfig("r", [game, other], [], [], []);
        var teen = new SessionState("s", "Sara", null, DateTimeOffset.UtcNow, null, [5], "LOCK", false, 13, ["g2"]);
        using var doc = JsonDocument.Parse(ShellProtocol.Library(cfg, teen));
        var games = doc.RootElement.GetProperty("games");
        Assert.Equal("age", games[0].GetProperty("lockReason").GetString());
        Assert.True(games[0].GetProperty("saves").GetBoolean());
        Assert.Equal("blocked", games[1].GetProperty("lockReason").GetString());
    }
}
