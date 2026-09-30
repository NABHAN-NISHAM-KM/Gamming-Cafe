using Arena.Agent.Core;
using Xunit;

namespace Arena.Agent.Tests;

public class StaffExitTests
{
    [Fact]
    public void Locks_after_repeated_wrong_sign_ins_then_unlocks()
    {
        var g = new StaffExitGuard();
        var t0 = DateTimeOffset.UnixEpoch;
        for (var i = 0; i < StaffExitGuard.MaxFailures; i++)
        {
            Assert.False(g.IsLocked(t0));
            g.Record(false, t0);
        }
        Assert.True(g.IsLocked(t0 + StaffExitGuard.Lockout - TimeSpan.FromSeconds(1)));
        Assert.False(g.IsLocked(t0 + StaffExitGuard.Lockout));
    }

    [Fact]
    public void A_right_sign_in_resets_the_count()
    {
        var g = new StaffExitGuard();
        var t0 = DateTimeOffset.UnixEpoch;
        for (var i = 0; i < StaffExitGuard.MaxFailures - 1; i++) g.Record(false, t0);
        g.Record(true, t0);
        g.Record(false, t0);
        Assert.False(g.IsLocked(t0));
    }

    [Fact]
    public void Stored_login_matches_its_username_any_case_and_exact_password_only()
    {
        var saved = StaffExitLogin.Parse(StaffExitLogin.Create("staff", "Exit#2026").Serialize())!;
        Assert.True(saved.Matches("staff", "Exit#2026"));
        Assert.True(saved.Matches(" STAFF ", "Exit#2026"));
        Assert.False(saved.Matches("staff", "exit#2026"));
        Assert.False(saved.Matches("other", "Exit#2026"));
        Assert.Null(StaffExitLogin.Parse("just-one-line"));
    }

    [Theory]
    [InlineData("staff", "Exit#2026", true)]
    [InlineData("", "Exit#2026", false)]
    [InlineData("two words", "Exit#2026", false)]
    [InlineData("staff", "abc", false)]
    public void Only_sensible_logins_can_be_saved(string user, string password, bool valid) =>
        Assert.Equal(valid, StaffExitLogin.IsValid(user, password));

    [Theory]
    [InlineData("""{"type":"staff_exit","requestId":"abcd1234","username":"nabha","password":"s3cret!"}""", true)]
    [InlineData("""{"type":"staff_exit","requestId":"abcd1234","username":"  ","password":"s3cret!"}""", false)]
    [InlineData("""{"type":"staff_exit","requestId":"abcd1234","username":"nabha","password":""}""", false)]
    [InlineData("""{"type":"staff_exit","username":"nabha","password":"s3cret!"}""", false)]
    public void Parses_staff_exit_only_with_a_username_and_password(string line, bool valid)
    {
        var r = ShellProtocol.Parse(line);
        if (valid) Assert.Equal("nabha", Assert.IsType<ShellRequest.StaffExit>(r).Username);
        else Assert.Null(r);
    }
}
