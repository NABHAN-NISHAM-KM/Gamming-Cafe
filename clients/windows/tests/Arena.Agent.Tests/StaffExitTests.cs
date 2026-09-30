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
