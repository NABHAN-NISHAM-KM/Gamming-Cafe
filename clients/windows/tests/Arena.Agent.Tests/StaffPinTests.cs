using Arena.Agent.Core;
using Xunit;

namespace Arena.Agent.Tests;

public class StaffPinTests
{
    [Fact]
    public void Verifies_only_the_pin_that_was_hashed()
    {
        var stored = StaffPin.Hash("4821");
        Assert.True(StaffPin.Verify(stored, "4821"));
        Assert.False(StaffPin.Verify(stored, "4822"));
        Assert.False(StaffPin.Verify("garbage", "4821"));
        Assert.NotEqual(stored, StaffPin.Hash("4821")); // salted
    }

    [Fact]
    public void Locks_after_repeated_wrong_pins_then_unlocks()
    {
        var g = new StaffPinGuard();
        var t0 = DateTimeOffset.UnixEpoch;
        for (var i = 0; i < StaffPinGuard.MaxFailures; i++)
        {
            Assert.False(g.IsLocked(t0));
            g.Record(false, t0);
        }
        Assert.True(g.IsLocked(t0 + StaffPinGuard.Lockout - TimeSpan.FromSeconds(1)));
        Assert.False(g.IsLocked(t0 + StaffPinGuard.Lockout));
    }

    [Theory]
    [InlineData("""{"type":"staff_exit","requestId":"abcd1234","pin":"4821"}""", true)]
    [InlineData("""{"type":"staff_exit","requestId":"abcd1234","pin":"12"}""", false)]
    [InlineData("""{"type":"staff_exit","requestId":"abcd1234","pin":"12ab"}""", false)]
    [InlineData("""{"type":"staff_exit","pin":"4821"}""", false)]
    public void Parses_staff_exit_only_with_a_digit_pin(string line, bool valid)
    {
        var r = ShellProtocol.Parse(line);
        if (valid) Assert.Equal("4821", Assert.IsType<ShellRequest.StaffExit>(r).Pin);
        else Assert.Null(r);
    }
}
