using Arena.Agent.Core;
using Arena.Agent.Core.Printing;
using Arena.Agent.Core.Stations;
using Xunit;

namespace Arena.Agent.Tests;

public class PrintTrackerTests
{
    private static readonly DateTimeOffset T0 = new(2026, 9, 26, 10, 0, 0, TimeSpan.Zero);

    private static SpoolJob Job(int id = 7, int pages = 3, bool spooling = false, bool paused = false, bool error = false, bool color = false) =>
        new("Front desk laser", id, T0, "ticket.pdf", pages, color, spooling, paused, error);

    [Fact]
    public void New_job_is_paused_at_once_and_reported_once_spooled()
    {
        var t = new PrintTracker();
        var first = t.Observe([Job(spooling: true, pages: 0)], T0);
        Assert.Single(first);
        Assert.IsType<PrintAction.Pause>(first[0]); // not reported while the page count is unknown

        var second = t.Observe([Job(paused: true, pages: 3)], T0.AddSeconds(1));
        var report = Assert.IsType<PrintAction.Report>(Assert.Single(second));
        Assert.Equal(new PrintJobReport(PrintTracker.KeyOf(Job()), "Front desk laser", "ticket.pdf", 3, 1, false), report.Job);

        Assert.Empty(t.Observe([Job(paused: true)], T0.AddSeconds(2))); // reported only once
    }

    [Fact]
    public void A_job_that_keeps_spooling_is_reported_after_the_grace_period()
    {
        var t = new PrintTracker();
        t.Observe([Job(spooling: true, pages: 0)], T0);
        var late = t.Observe([Job(spooling: true, paused: true, pages: 0)], T0 + PrintTracker.SpoolGrace);
        Assert.Equal(1, Assert.IsType<PrintAction.Report>(Assert.Single(late)).Job.Pages);
    }

    [Fact]
    public void A_held_job_unpaused_by_hand_is_paused_again()
    {
        var t = new PrintTracker();
        t.Observe([Job()], T0);
        var again = t.Observe([Job(paused: false)], T0.AddSeconds(1));
        Assert.Contains(again, a => a is PrintAction.Pause);
    }

    [Fact]
    public void Release_resumes_and_leaving_the_queue_means_printed()
    {
        var t = new PrintTracker();
        t.Observe([Job()], T0);
        var key = PrintTracker.KeyOf(Job());
        Assert.IsType<PrintAction.Resume>(t.Release(key));
        Assert.Null(t.Release(key)); // only once
        Assert.Empty(t.Observe([Job(paused: false)], T0.AddSeconds(2))); // printing: not re-paused
        var done = Assert.IsType<PrintAction.Done>(Assert.Single(t.Observe([], T0.AddSeconds(5))));
        Assert.True(done.Ok);
        Assert.Equal(0, t.Count);
    }

    [Fact]
    public void A_printer_error_on_a_released_job_is_reported_as_failed()
    {
        var t = new PrintTracker();
        t.Observe([Job()], T0);
        t.Release(PrintTracker.KeyOf(Job()));
        var done = Assert.IsType<PrintAction.Done>(Assert.Single(t.Observe([Job(error: true)], T0.AddSeconds(3))));
        Assert.False(done.Ok);
    }

    [Fact]
    public void Cancel_deletes_and_keeps_deleting_until_gone()
    {
        var t = new PrintTracker();
        t.Observe([Job()], T0);
        var key = PrintTracker.KeyOf(Job());
        Assert.IsType<PrintAction.Delete>(t.Cancel(key));
        Assert.IsType<PrintAction.Delete>(Assert.Single(t.Observe([Job(paused: true)], T0.AddSeconds(1))));
        Assert.Empty(t.Observe([], T0.AddSeconds(2)));
        Assert.Null(t.Release(key)); // gone: a late release does nothing
    }

    [Fact]
    public void A_held_job_the_customer_deletes_is_reported_as_vanished()
    {
        var t = new PrintTracker();
        t.Observe([Job()], T0); // paused + reported
        Assert.IsType<PrintAction.Vanished>(Assert.Single(t.Observe([], T0.AddSeconds(1))));
    }

    [Fact]
    public void An_unsent_report_is_retried()
    {
        var t = new PrintTracker();
        var key = PrintTracker.KeyOf(Job());
        t.Observe([Job()], T0);
        t.Unreport(key);
        Assert.IsType<PrintAction.Report>(Assert.Single(t.Observe([Job(paused: true)], T0.AddSeconds(1))));
    }

    [Fact]
    public void Same_spooler_id_after_a_restart_is_a_different_job()
    {
        var a = Job(id: 3);
        var b = a with { Submitted = T0.AddHours(1) };
        Assert.NotEqual(PrintTracker.KeyOf(a), PrintTracker.KeyOf(b));
    }
}

public class PlugControlTests
{
    [Theory]
    [InlineData("192.168.1.50", true)]
    [InlineData("10.0.0.7", true)]
    [InlineData("172.20.3.4", true)]
    [InlineData("169.254.1.1", true)]
    [InlineData("ps5-plug.local", true)]
    [InlineData("172.32.0.1", false)]
    [InlineData("8.8.8.8", false)]
    [InlineData("10", false)]
    [InlineData("evil.example.com", false)]
    [InlineData("192.168.1.50/../../x", false)]
    [InlineData("", false)]
    public void Only_lan_hosts_are_allowed(string host, bool allowed) => Assert.Equal(allowed, PlugControl.IsLanHost(host));

    [Fact]
    public void Builds_each_vendors_local_switch_call()
    {
        Assert.Equal("http://192.168.1.61/rpc/Switch.Set?id=0&on=true", PlugControl.SwitchUri("SHELLY", "192.168.1.61", 0, true)!.ToString());
        Assert.Equal("http://192.168.1.61/relay/1?turn=off", PlugControl.SwitchUri("SHELLY_GEN1", "192.168.1.61", 1, false)!.ToString());
        Assert.Equal("http://192.168.1.70/cm?cmnd=Power1%20Off", PlugControl.SwitchUri("TASMOTA", "192.168.1.70", 0, false)!.AbsoluteUri);
    }

    [Fact]
    public void Refuses_public_hosts_unknown_kinds_and_bad_channels()
    {
        Assert.Null(PlugControl.SwitchUri("SHELLY", "1.1.1.1", 0, true));
        Assert.Null(PlugControl.SwitchUri("SONOFF", "192.168.1.5", 0, true));
        Assert.Null(PlugControl.SwitchUri("SHELLY", "192.168.1.5", 9, true));
    }
}

public class ShellPrintMessageTests
{
    [Fact]
    public void Print_confirm_and_cancel_carry_only_a_job_key_and_a_pay_choice()
    {
        var ok = Assert.IsType<ShellRequest.PrintConfirm>(ShellProtocol.Parse("""{"type":"print_confirm","jobKey":"12:1790000000","payWith":"WALLET"}"""));
        Assert.Equal(("12:1790000000", "WALLET"), (ok.JobKey, ok.PayWith));
        Assert.IsType<ShellRequest.PrintCancel>(ShellProtocol.Parse("""{"type":"print_cancel","jobKey":"12:1790000000"}"""));
        Assert.Null(ShellProtocol.Parse("""{"type":"print_confirm","jobKey":"12:1790000000","payWith":"FREE"}"""));
        Assert.Null(ShellProtocol.Parse("""{"type":"print_confirm","jobKey":"x","payWith":"BILL"}"""));
        Assert.Null(ShellProtocol.Parse("""{"type":"print_cancel","jobKey":"../../etc"}"""));
    }
}
