using Arena.Agent.Core;
using Xunit;

namespace Arena.Agent.Tests;

public class ShellAutostartTests
{
    private static readonly DateTimeOffset T0 = new(2026, 9, 26, 12, 0, 0, TimeSpan.Zero);
    private static readonly ConsoleState Player = new(UserSignedIn: true, UserIsAdmin: false, ShellRunning: false);

    [Fact]
    public void Starts_the_shell_for_a_signed_in_standard_user()
    {
        var p = new ShellAutostartPolicy(safeMode: false, shellInstalled: true);
        Assert.True(p.Enabled);
        Assert.True(p.ShouldLaunch(Player, T0));
    }

    [Theory]
    [InlineData(true, true)]   // safe mode: an office PC keeps its desktop
    [InlineData(false, false)] // Shell not installed
    public void Never_starts_when_disabled(bool safeMode, bool installed)
    {
        var p = new ShellAutostartPolicy(safeMode, installed);
        Assert.False(p.Enabled);
        Assert.False(p.ShouldLaunch(Player, T0));
    }

    [Fact]
    public void Leaves_admins_and_empty_consoles_alone_and_never_starts_a_second_shell()
    {
        var p = new ShellAutostartPolicy(false, true);
        Assert.False(p.ShouldLaunch(Player with { UserIsAdmin = true }, T0));
        Assert.False(p.ShouldLaunch(Player with { UserSignedIn = false }, T0));
        Assert.False(p.ShouldLaunch(Player with { ShellRunning = true }, T0));
    }

    [Fact]
    public void Restarts_a_killed_shell_then_backs_off_when_it_keeps_dying()
    {
        var p = new ShellAutostartPolicy(false, true);
        var now = T0;
        for (var i = 0; i < ShellAutostartPolicy.MaxLaunches; i++, now += TimeSpan.FromSeconds(3))
            Assert.True(p.ShouldLaunch(Player, now));

        Assert.False(p.ShouldLaunch(Player, now));
        Assert.True(p.BackingOff(now));
        Assert.False(p.ShouldLaunch(Player, now + ShellAutostartPolicy.Backoff - TimeSpan.FromSeconds(1)));

        var after = now + ShellAutostartPolicy.Backoff;
        Assert.True(p.ShouldLaunch(Player, after));
        Assert.False(p.BackingOff(after));
    }

    [Fact]
    public void Occasional_restarts_spread_over_time_never_trigger_the_back_off()
    {
        var p = new ShellAutostartPolicy(false, true);
        for (var i = 0; i < 20; i++)
            Assert.True(p.ShouldLaunch(Player, T0 + TimeSpan.FromMinutes(i)));
    }
}
