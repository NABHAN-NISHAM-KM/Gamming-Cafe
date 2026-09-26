namespace Arena.Agent.Core.Printing;

/// <summary>A job in the Windows print queue, as the spooler reports it.</summary>
public sealed record SpoolJob(
    string Printer,
    int JobId,
    DateTimeOffset Submitted,
    string? Document,
    int TotalPages,
    bool Color,
    bool Spooling,
    bool Paused,
    bool Error);

/// <summary>What the agent tells the server about a paused job (mirrors PrintJobReport in contracts).</summary>
public sealed record PrintJobReport(string JobKey, string PrinterName, string? Document, int Pages, int Copies, bool Color);

/// <summary>What the monitor must do next. The tracker decides; the Windows adapter acts.</summary>
public abstract record PrintAction
{
    public sealed record Pause(SpoolJob Job) : PrintAction;
    public sealed record Report(PrintJobReport Job) : PrintAction;
    public sealed record Resume(SpoolJob Job) : PrintAction;
    public sealed record Delete(SpoolJob Job) : PrintAction;
    /// <summary>A released job left the queue (printed) or errored.</summary>
    public sealed record Done(string JobKey, bool Ok, string? Detail) : PrintAction;
    /// <summary>A job we were holding disappeared before the server decided (the customer deleted it).</summary>
    public sealed record Vanished(string JobKey) : PrintAction;
}

/// <summary>
/// Internet-café print control, as a pure state machine: every new spooler job
/// is paused at once and reported when it has finished spooling (page count
/// known); it prints only after the server's signed PRINT_RELEASE, and is
/// deleted on PRINT_CANCEL. A held job that someone un-pauses locally is
/// paused again. Released jobs that leave the queue are reported done.
/// </summary>
public sealed class PrintTracker
{
    private enum State { Held, Released, Cancelled, Finished }

    private sealed class Entry
    {
        public required SpoolJob Last;
        public State State = State.Held;
        public bool Reported;
        public DateTimeOffset FirstSeen;
    }

    /// <summary>A job still spooling after this long is reported with what's known so far.</summary>
    public static readonly TimeSpan SpoolGrace = TimeSpan.FromSeconds(20);

    private readonly Dictionary<string, Entry> _jobs = new();
    private readonly object _gate = new();

    public static string KeyOf(SpoolJob j) => $"{j.JobId}:{j.Submitted.ToUnixTimeSeconds()}";

    public int Count { get { lock (_gate) return _jobs.Count; } }

    /// <summary>Feed the current queue; get the actions to take.</summary>
    public List<PrintAction> Observe(IReadOnlyList<SpoolJob> queue, DateTimeOffset now)
    {
        var actions = new List<PrintAction>();
        lock (_gate)
        {
            var present = new HashSet<string>();
            foreach (var job in queue)
            {
                var key = KeyOf(job);
                present.Add(key);
                if (!_jobs.TryGetValue(key, out var e))
                {
                    e = new Entry { Last = job, FirstSeen = now };
                    _jobs[key] = e;
                }
                e.Last = job;
                switch (e.State)
                {
                    case State.Held:
                        if (!job.Paused) actions.Add(new PrintAction.Pause(job)); // new, or un-paused by hand
                        if (!e.Reported && ((!job.Spooling && job.TotalPages > 0) || now - e.FirstSeen >= SpoolGrace))
                        {
                            e.Reported = true;
                            actions.Add(new PrintAction.Report(new PrintJobReport(key, job.Printer, job.Document, Math.Max(1, job.TotalPages), 1, job.Color)));
                        }
                        break;
                    case State.Released when job.Error:
                        e.State = State.Finished;
                        actions.Add(new PrintAction.Done(key, false, "The printer reported an error."));
                        break;
                    case State.Cancelled:
                        actions.Add(new PrintAction.Delete(job)); // still there: try again
                        break;
                }
            }
            foreach (var (key, e) in _jobs.Where(kv => !present.Contains(kv.Key)).ToList())
            {
                if (e.State == State.Released) actions.Add(new PrintAction.Done(key, true, null));
                else if (e.State == State.Held && e.Reported) actions.Add(new PrintAction.Vanished(key));
                _jobs.Remove(key);
            }
        }
        return actions;
    }

    /// <summary>A report couldn't be sent (offline): try again on the next pass.</summary>
    public void Unreport(string jobKey)
    {
        lock (_gate) if (_jobs.TryGetValue(jobKey, out var e) && e.State == State.Held) e.Reported = false;
    }

    /// <summary>Signed PRINT_RELEASE from the server.</summary>
    public PrintAction? Release(string jobKey)
    {
        lock (_gate)
        {
            if (!_jobs.TryGetValue(jobKey, out var e) || e.State != State.Held) return null;
            e.State = State.Released;
            return new PrintAction.Resume(e.Last);
        }
    }

    /// <summary>Signed PRINT_CANCEL from the server.</summary>
    public PrintAction? Cancel(string jobKey)
    {
        lock (_gate)
        {
            if (!_jobs.TryGetValue(jobKey, out var e) || e.State is State.Released or State.Finished) return null;
            e.State = State.Cancelled;
            return new PrintAction.Delete(e.Last);
        }
    }

    public bool Knows(string jobKey)
    {
        lock (_gate) return _jobs.ContainsKey(jobKey);
    }
}
