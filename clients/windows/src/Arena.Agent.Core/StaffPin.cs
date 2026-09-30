using System.Security.Cryptography;

namespace Arena.Agent.Core;

/// <summary>
/// The staff PIN that unlocks Shift+F12 (leave the Gaming Shell for the Windows
/// desktop). Stored only as a salted PBKDF2 hash in the agent's data folder,
/// which only SYSTEM and Administrators can read; set with <c>ArenaAgent staff-pin</c>.
/// </summary>
public static class StaffPin
{
    private const int Iterations = 200_000;

    public static bool IsValidFormat(string? pin) => pin is { Length: >= 4 and <= 12 } && pin.All(char.IsAsciiDigit);

    /// <summary>"pbkdf2-sha256$iterations$salt$hash" (base64 parts).</summary>
    public static string Hash(string pin)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(pin, salt, Iterations, HashAlgorithmName.SHA256, 32);
        return $"pbkdf2-sha256${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string stored, string pin)
    {
        var parts = stored.Trim().Split('$');
        if (parts is not ["pbkdf2-sha256", var iter, var salt, var hash] || !int.TryParse(iter, out var n) || n < 10_000) return false;
        try
        {
            var expected = Convert.FromBase64String(hash);
            var actual = Rfc2898DeriveBytes.Pbkdf2(pin, Convert.FromBase64String(salt), n, HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException) { return false; }
    }
}

/// <summary>Stops PIN guessing at the Shell: <see cref="MaxFailures"/> wrong PINs lock it for <see cref="Lockout"/>.</summary>
public sealed class StaffPinGuard
{
    public const int MaxFailures = 5;
    public static readonly TimeSpan Lockout = TimeSpan.FromMinutes(5);

    private int _failures;
    private DateTimeOffset? _lockedUntil;

    public bool IsLocked(DateTimeOffset now)
    {
        if (_lockedUntil is { } until && now >= until) { _lockedUntil = null; _failures = 0; }
        return _lockedUntil is not null;
    }

    public void Record(bool ok, DateTimeOffset now)
    {
        if (ok) { _failures = 0; return; }
        if (++_failures >= MaxFailures) _lockedUntil = now + Lockout;
    }
}
