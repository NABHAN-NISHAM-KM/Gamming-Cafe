using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Arena.Agent.Core;
using Xunit;

namespace Arena.Agent.Tests;

/// <summary>
/// Cross-language contract: commands signed by the real Node.js server code
/// (apps/api/scripts/gen-agent-fixtures.ts) must verify here exactly as they
/// do in packages/contracts — and every tampered/misaddressed one must fail.
/// </summary>
public class CommandVerifierTests
{
    private sealed record Case(string Name, string Expect, SignedCommand Command);
    private sealed record Self(string OrganizationId, string BranchId, string DeviceId);
    private sealed record Fixture(DateTimeOffset Now, Self Self, Dictionary<string, string> PublicKeys, List<Case> Cases);

    private static readonly Fixture F = JsonSerializer.Deserialize<Fixture>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fixtures", "commands.json")), Json.Options)!;

    private static AgentIdentity Identity(Dictionary<string, string>? keys = null) => new()
    {
        ApiUrl = "http://localhost:4000",
        DeviceId = F.Self.DeviceId,
        OrganizationId = F.Self.OrganizationId,
        BranchId = F.Self.BranchId,
        Name = "PC-01",
        SigningKeys = keys ?? F.PublicKeys,
    };

    public static IEnumerable<object[]> Cases() => F.Cases.Select(c => new object[] { c.Name });

    [Theory]
    [MemberData(nameof(Cases))]
    public void Server_signed_fixture_verifies_as_expected(string name)
    {
        var c = F.Cases.Single(x => x.Name == name);
        var (result, envelope) = new CommandVerifier(Identity()).Verify(c.Command, F.Now, _ => false);
        Assert.Equal(Enum.Parse<VerifyResult>(c.Expect), result);
        if (result == VerifyResult.Ok) Assert.NotNull(envelope);
    }

    [Fact]
    public void Valid_command_payload_round_trips_including_unicode()
    {
        var valid = F.Cases.Single(x => x.Name == "valid").Command;
        var (result, e) = new CommandVerifier(Identity()).Verify(valid, F.Now, _ => false);
        Assert.Equal(VerifyResult.Ok, result);
        Assert.Equal("SEND_MESSAGE", e!.Type);
        Assert.Equal("Your burger is on its way! 🍔 — ñ", e.Payload.GetProperty("message").GetString());
    }

    [Fact]
    public void Replayed_command_is_refused()
    {
        var valid = F.Cases.Single(x => x.Name == "valid").Command;
        var (result, _) = new CommandVerifier(Identity()).Verify(valid, F.Now, _ => true);
        Assert.Equal(VerifyResult.Replayed, result);
    }

    [Fact]
    public void Commands_from_the_future_are_refused()
    {
        var valid = F.Cases.Single(x => x.Name == "valid").Command;
        var (result, _) = new CommandVerifier(Identity()).Verify(valid, F.Now.AddMinutes(-10), _ => false);
        Assert.Equal(VerifyResult.NotYetValid, result);
    }

    [Fact]
    public void Garbage_signature_is_refused_not_thrown()
    {
        var valid = F.Cases.Single(x => x.Name == "valid").Command;
        var (result, _) = new CommandVerifier(Identity()).Verify(valid with { Signature = "not base64!!" }, F.Now, _ => false);
        Assert.Equal(VerifyResult.BadSignature, result);
    }

    [Fact]
    public void Non_P256_pinned_key_is_rejected_at_startup()
    {
        using var rsa = RSA.Create(2048);
        Assert.ThrowsAny<Exception>(() => new CommandVerifier(Identity(new() { ["bk_rsa"] = rsa.ExportSubjectPublicKeyInfoPem() })));
    }
}

public class ReplayStoreTests
{
    [Fact]
    public void Persists_across_restarts_and_forgets_old_entries()
    {
        var path = Path.Combine(Path.GetTempPath(), $"arena-replay-{Guid.NewGuid():N}.json");
        try
        {
            var now = DateTimeOffset.UtcNow;
            var a = new ReplayStore(path, keep: TimeSpan.FromHours(1));
            a.Add("cmd-1", now.AddHours(-2));
            a.Add("cmd-2", now);
            var b = new ReplayStore(path, keep: TimeSpan.FromHours(1));
            Assert.True(b.Seen("cmd-2"));
            Assert.False(b.Seen("cmd-1"));
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void Is_bounded()
    {
        var s = new ReplayStore(null, max: 10);
        var now = DateTimeOffset.UtcNow;
        for (var i = 0; i < 25; i++) s.Add($"c{i}", now.AddSeconds(i));
        Assert.False(s.Seen("c0"));
        Assert.True(s.Seen("c24"));
    }
}

public class DeviceAssertionTests
{
    [Fact]
    public void Produces_a_verifiable_ES256_jwt_with_required_claims()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var now = DateTimeOffset.UtcNow;
        var jwt = DeviceAssertion.Create(key, "dev-1", "org-1", now);
        var parts = jwt.Split('.');
        Assert.Equal(3, parts.Length);

        var sig = FromB64Url(parts[2]);
        Assert.Equal(64, sig.Length);
        Assert.True(key.VerifyData(Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}"), sig, HashAlgorithmName.SHA256));

        using var payload = JsonDocument.Parse(FromB64Url(parts[1]));
        var p = payload.RootElement;
        Assert.Equal("dev-1", p.GetProperty("sub").GetString());
        Assert.Equal("dev-1", p.GetProperty("iss").GetString());
        Assert.Equal("arena:device", p.GetProperty("aud").GetString());
        Assert.True(p.GetProperty("exp").GetInt64() - p.GetProperty("iat").GetInt64() <= 120);
        Assert.True(p.GetProperty("jti").GetString()!.Length >= 16);
    }

    [Fact]
    public void Each_assertion_is_unique()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var now = DateTimeOffset.UtcNow;
        Assert.NotEqual(DeviceAssertion.Create(key, "d", "o", now), DeviceAssertion.Create(key, "d", "o", now));
    }

    private static byte[] FromB64Url(string s)
    {
        s = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(s.PadRight(s.Length + (4 - s.Length % 4) % 4, '='));
    }
}
