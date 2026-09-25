using System.Text.Json;
using Arena.Agent.Core;
using Xunit;

namespace Arena.Agent.Tests;

public class SessionManagerTests
{
    private static readonly DateTimeOffset T0 = DateTimeOffset.Parse("2026-09-25T12:00:00Z");

    private static JsonElement J(object o) => JsonSerializer.SerializeToElement(o, Json.Options);

    private static JsonElement Start(string id, DateTimeOffset expires, DateTimeOffset serverTime) => J(new
    {
        sessionId = id,
        customer = new { id = (string?)null, displayName = "Ahmed", membershipTier = "Gold" },
        startedAt = serverTime,
        expiresAt = expires,
        serverTime,
        warningMinutes = new[] { 30, 15, 10, 5, 1 },
        postSessionAction = "LOCK",
        allowSelfExtend = false,
    });

    [Fact]
    public void Start_extend_end_lifecycle()
    {
        var m = new SessionManager(null);
        m.Apply("START_SESSION", Start("s1", T0.AddHours(2), T0), T0);
        Assert.Equal("s1", m.Current!.SessionId);
        Assert.Equal(TimeSpan.FromHours(2), m.Remaining(T0));

        m.Apply("EXTEND_SESSION", J(new { sessionId = "s1", expiresAt = T0.AddHours(3), serverTime = T0 }), T0);
        Assert.Equal(TimeSpan.FromHours(3), m.Remaining(T0));

        Assert.Equal("LOCK", m.Apply("END_SESSION", J(new { sessionId = "s1", postSessionAction = "LOCK", serverTime = T0 }), T0));
        Assert.Null(m.Current);
    }

    [Fact]
    public void Countdown_uses_server_time_not_the_PC_clock()
    {
        // PC clock is 10 minutes behind the server.
        var local = T0.AddMinutes(-10);
        var m = new SessionManager(null);
        m.Apply("START_SESSION", Start("s1", T0.AddHours(1), T0), local);
        Assert.Equal(TimeSpan.FromHours(1), m.Remaining(local));
    }

    [Fact]
    public void State_survives_an_agent_restart()
    {
        var path = Path.Combine(Path.GetTempPath(), $"arena-session-{Guid.NewGuid():N}.json");
        try
        {
            new SessionManager(path).Apply("START_SESSION", Start("s1", T0.AddHours(1), T0), T0);
            var reborn = new SessionManager(path);
            Assert.Equal("s1", reborn.Current?.SessionId);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void Fail_safe_locks_locally_when_the_server_never_sends_END()
    {
        var m = new SessionManager(null, TimeSpan.FromSeconds(20));
        SessionEvent? seen = null;
        m.Changed += (e, _) => seen = e;
        m.Apply("START_SESSION", Start("s1", T0.AddMinutes(60), T0), T0);
        Assert.False(m.Tick(T0.AddMinutes(60).AddSeconds(10))); // server gets its grace period
        Assert.True(m.Tick(T0.AddMinutes(60).AddSeconds(21)));
        Assert.Null(m.Current);
        Assert.Equal(SessionEvent.ExpiredLocally, seen);
    }

    [Fact]
    public void An_END_for_an_older_session_does_not_end_the_current_one()
    {
        var m = new SessionManager(null);
        m.Apply("START_SESSION", Start("s2", T0.AddHours(1), T0), T0);
        Assert.Null(m.Apply("END_SESSION", J(new { sessionId = "s1", postSessionAction = "LOCK" }), T0));
        Assert.Equal("s2", m.Current!.SessionId);
    }

    [Fact]
    public void Open_postpaid_sessions_have_no_countdown_and_never_fail_safe()
    {
        var m = new SessionManager(null);
        var p = J(new { sessionId = "s1", customer = new { displayName = "Guest" }, startedAt = T0, expiresAt = (DateTimeOffset?)null, serverTime = T0 });
        m.Apply("START_SESSION", p, T0);
        Assert.Null(m.Remaining(T0));
        Assert.False(m.Tick(T0.AddDays(1)));
    }
}
