using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Arena.Agent.Core;

public enum VerifyResult
{
    Ok,
    UnknownKey,
    BadSignature,
    Malformed,
    UnsupportedVersion,
    WrongTenant,
    WrongDevice,
    NotYetValid,
    Expired,
    Replayed,
}

/// <summary>
/// Verifies server commands exactly like packages/contracts verifyCommand():
/// signature over the raw envelope bytes FIRST (ES256, IEEE-P1363), then parse,
/// then identity (bound at enrolment — never taken from the message), time
/// window and single use. Nothing is executed unless this returns Ok.
/// </summary>
public sealed class CommandVerifier
{
    private readonly AgentIdentity _self;
    private readonly Dictionary<string, ECDsa> _keys = new();
    private readonly TimeSpan _skew;

    public CommandVerifier(AgentIdentity self, TimeSpan? maxClockSkew = null)
    {
        _self = self;
        _skew = maxClockSkew ?? TimeSpan.FromSeconds(30);
        foreach (var (kid, pem) in self.SigningKeys)
        {
            var ec = ECDsa.Create();
            ec.ImportFromPem(pem);
            if (ec.KeySize != 256) throw new CryptographicException($"Signing key {kid} is not P-256");
            _keys[kid] = ec;
        }
    }

    public (VerifyResult Result, CommandEnvelope? Envelope) Verify(SignedCommand cmd, DateTimeOffset now, Func<string, bool> seen)
    {
        if (!_keys.TryGetValue(cmd.Kid, out var key)) return (VerifyResult.UnknownKey, null);

        byte[] signature;
        try { signature = Convert.FromBase64String(cmd.Signature); }
        catch (FormatException) { return (VerifyResult.BadSignature, null); }

        // .NET's default ECDSA signature format is IEEE P1363 (r||s) — same as the server.
        if (signature.Length != 64 || !key.VerifyData(Encoding.UTF8.GetBytes(cmd.Envelope), signature, HashAlgorithmName.SHA256))
            return (VerifyResult.BadSignature, null);

        CommandEnvelope? e;
        try { e = JsonSerializer.Deserialize<CommandEnvelope>(cmd.Envelope, Json.Options); }
        catch (JsonException) { return (VerifyResult.Malformed, null); }
        if (e is null) return (VerifyResult.Malformed, null);

        if (e.V != 1) return (VerifyResult.UnsupportedVersion, null);
        if (!Same(e.OrganizationId, _self.OrganizationId) || !Same(e.BranchId, _self.BranchId)) return (VerifyResult.WrongTenant, null);
        if (!Same(e.DeviceId, _self.DeviceId)) return (VerifyResult.WrongDevice, null);
        if (e.IssuedAt - _skew > now) return (VerifyResult.NotYetValid, null);
        if (e.ExpiresAt + _skew < now) return (VerifyResult.Expired, null);
        if (seen(e.CommandId)) return (VerifyResult.Replayed, null);
        return (VerifyResult.Ok, e);
    }

    private static bool Same(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
}
