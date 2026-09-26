using Arena.Agent.Core;
using Arena.Agent.Core.Printing;
using Arena.Agent.Windows;

namespace Arena.Agent;

/// <summary>
/// Holds every print job until the venue says it's paid for. Polls the
/// spooler, pauses new jobs, reports them to the server (which asks the
/// customer on the Shell), and resumes or deletes them on the server's signed
/// PRINT_RELEASE / PRINT_CANCEL. Disabled in safe mode — an office PC trying
/// the agent keeps printing normally.
/// </summary>
public sealed class PrintMonitor(ServerLink server, ILogger<PrintMonitor> log) : BackgroundService
{
    private readonly PrintTracker _tracker = new();
    private volatile bool _enabled;

    public void Configure(bool safeMode)
    {
        _enabled = !safeMode;
        if (safeMode) log.LogInformation("Print control is off in safe mode (jobs print without approval).");
    }

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            if (_enabled)
            {
                try { await PassAsync(); }
                catch (Exception e) { log.LogWarning("Print monitor: {Message}", e.Message); }
            }
            try { await Task.Delay(TimeSpan.FromMilliseconds(700), stop); } catch (OperationCanceledException) { }
        }
    }

    private async Task PassAsync()
    {
        var queue = PrintSpooler.List();
        if (queue.Count == 0 && _tracker.Count == 0) return;
        foreach (var action in _tracker.Observe(queue, DateTimeOffset.UtcNow))
        {
            switch (action)
            {
                case PrintAction.Pause p:
                    if (!PrintSpooler.Pause(p.Job)) log.LogWarning("Could not pause job {Id} on {Printer}", p.Job.JobId, p.Job.Printer);
                    break;
                case PrintAction.Report r:
                    if (!await server.TrySendAsync(Outgoing.PrintJob(r.Job))) _tracker.Unreport(r.Job.JobKey); // offline: stays paused, reported later
                    else log.LogInformation("Holding print {Key}: {Pages} page(s) on {Printer}", r.Job.JobKey, r.Job.Pages, r.Job.PrinterName);
                    break;
                case PrintAction.Delete d:
                    PrintSpooler.Delete(d.Job);
                    break;
                case PrintAction.Resume res:
                    PrintSpooler.Resume(res.Job);
                    break;
                case PrintAction.Done done:
                    await server.TrySendAsync(Outgoing.PrintDone(done.JobKey, done.Ok, done.Detail));
                    break;
                case PrintAction.Vanished v:
                    await server.TrySendAsync(Outgoing.PrintCancel(v.JobKey));
                    break;
            }
        }
    }

    /// <summary>Signed PRINT_RELEASE: the customer paid (or staff approved).</summary>
    public ExecResult Release(string jobKey)
    {
        if (!_enabled) return ExecResult.Success(new { skipped = "print control off" });
        var a = _tracker.Release(jobKey);
        if (a is not PrintAction.Resume r) return _tracker.Knows(jobKey) ? ExecResult.Success(new { alreadyReleased = true }) : ExecResult.Fail("JOB_UNKNOWN", "That print job isn't held on this PC");
        return PrintSpooler.Resume(r.Job) ? ExecResult.Success(new { released = jobKey }) : ExecResult.Fail("JOB_GONE", "The job is no longer in the print queue");
    }

    /// <summary>Signed PRINT_CANCEL: not paid, timed out, or cancelled by the customer or staff.</summary>
    public ExecResult Cancel(string jobKey)
    {
        if (!_enabled) return ExecResult.Success(new { skipped = "print control off" });
        var a = _tracker.Cancel(jobKey);
        if (a is PrintAction.Delete d) PrintSpooler.Delete(d.Job);
        return ExecResult.Success(new { cancelled = jobKey });
    }
}
