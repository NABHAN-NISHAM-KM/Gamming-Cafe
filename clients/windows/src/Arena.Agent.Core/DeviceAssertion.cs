using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Arena.Agent.Core;

/// <summary>
/// Short-lived, single-use ES256 JWT proving possession of the device key
/// (what the server's DeviceGateway verifies on every WebSocket connection).
/// </summary>
public static class DeviceAssertion
{
    public const string Audience = "arena:device";

    public static string Create(ECDsa key, string deviceId, string organizationId, DateTimeOffset now, TimeSpan? lifetime = null)
    {
        var header = new { alg = "ES256", typ = "JWT" };
        var iat = now.ToUnixTimeSeconds();
        var payload = new
        {
            iss = deviceId,
            sub = deviceId,
            aud = Audience,
            org = organizationId,
            iat,
            exp = iat + (long)(lifetime ?? TimeSpan.FromSeconds(60)).TotalSeconds,
            jti = Guid.NewGuid().ToString("N") + Convert.ToHexString(RandomNumberGenerator.GetBytes(8)),
        };
        var signingInput = $"{B64Url(JsonSerializer.SerializeToUtf8Bytes(header))}.{B64Url(JsonSerializer.SerializeToUtf8Bytes(payload))}";
        var sig = key.SignData(Encoding.ASCII.GetBytes(signingInput), HashAlgorithmName.SHA256); // IEEE-P1363 = JWS format
        return $"{signingInput}.{B64Url(sig)}";
    }

    public static string B64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
