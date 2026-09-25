using System.Text.Json;
using Arena.Agent.Core;
using Xunit;

namespace Arena.Agent.Tests;

public class ShellProtocolTests
{
    [Fact]
    public void Parses_the_three_allowed_requests()
    {
        Assert.IsType<ShellRequest.Ready>(ShellProtocol.Parse("""{"type":"ready"}"""));
        Assert.IsType<ShellRequest.Logout>(ShellProtocol.Parse("""{"type":"logout"}"""));
        var login = Assert.IsType<ShellRequest.Login>(ShellProtocol.Parse("""{"type":"login","requestId":"2b1f0a4e-9c1d-4f5e-8a7b-1234567890ab","username":"  ahmed ","secret":"1234"}"""));
        Assert.Equal("ahmed", login.Username);
        Assert.Equal("1234", login.Secret);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("""{"type":"state","session":{"id":"free-time"}}""")] // the Shell can never assert session state
    [InlineData("""{"type":"login","requestId":"x","username":"a","secret":"b"}""")] // requestId too short
    [InlineData("""{"type":"login","requestId":"abc/../12345","username":"a","secret":"b"}""")]
    [InlineData("""{"type":"login","requestId":"2b1f0a4e-9c1d-4f5e","username":"   ","secret":"b"}""")]
    [InlineData("""{"type":"login","requestId":"2b1f0a4e-9c1d-4f5e","username":"a"}""")]
    [InlineData("""{"type":7}""")]
    public void Rejects_malformed_or_unknown(string line) => Assert.Null(ShellProtocol.Parse(line));

    [Fact]
    public void Rejects_oversized_lines()
    {
        var secret = new string('x', ShellProtocol.MaxLineBytes);
        Assert.Null(ShellProtocol.Parse($$"""{"type":"login","requestId":"2b1f0a4e-9c1d-4f5e","username":"a","secret":"{{secret}}"}"""));
    }

    [Fact]
    public void State_includes_explicit_nulls_and_server_offset()
    {
        using var locked = JsonDocument.Parse(ShellProtocol.State(false, "PC-07", VenueInfo.Unknown, null, TimeSpan.FromSeconds(-2), true));
        var r = locked.RootElement;
        Assert.Equal("state", r.GetProperty("type").GetString());
        Assert.Equal(JsonValueKind.Null, r.GetProperty("session").ValueKind);
        Assert.Equal(JsonValueKind.Null, r.GetProperty("venue").GetProperty("logoUrl").ValueKind);
        Assert.Equal(-2000, r.GetProperty("serverOffsetMs").GetInt64());
        Assert.Equal("PC-07", r.GetProperty("station").GetProperty("name").GetString());

        var s = new SessionState("s1", "Ahmed", "Gold", DateTimeOffset.Parse("2026-09-25T12:00:00Z"), null, [30, 5, 1], "LOCK", false);
        using var open = JsonDocument.Parse(ShellProtocol.State(true, "PC-07", new VenueInfo("Demo Arena", "Marina", null), s, TimeSpan.Zero, false));
        var session = open.RootElement.GetProperty("session");
        Assert.Equal("Ahmed", session.GetProperty("customerName").GetString());
        Assert.Equal(JsonValueKind.Null, session.GetProperty("expiresAt").ValueKind); // open session: pay at the end
        Assert.Equal(3, session.GetProperty("warningMinutes").GetArrayLength());
    }
}
