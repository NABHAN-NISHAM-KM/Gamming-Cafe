using System.Security.Cryptography;

namespace Arena.Agent.Core;

/// <summary>
/// The staff exit login chosen when the station is installed (installer or
/// setup-player.ps1): Shift+F12 on the Shell + this username and password open
/// the Windows desktop. Stored in the agent's data folder (SYSTEM and
/// Administrators only) as "username" then a salted PBKDF2 hash of the password.
/// </summary>
public sealed record StaffExitLogin(string Username, string PasswordHash)
{
    private const int Iterations = 200_000;

    public static bool IsValid(string? username, string? password) =>
        username is { Length: >= 1 and <= 64 } && !username.Any(char.IsWhiteSpace) && password is { Length: >= 4 and <= 256 };

    public static StaffExitLogin Create(string username, string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, 32);
        return new(username, $"pbkdf2-sha256${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}");
    }

    public string Serialize() => Username + "\n" + PasswordHash + "\n";

    public static StaffExitLogin? Parse(string text) =>
        text.Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries) is [var user, var hash] ? new(user, hash) : null;

    /// <summary>Username ignores case; the password must match exactly.</summary>
    public bool Matches(string username, string password)
    {
        if (!string.Equals(username.Trim(), Username, StringComparison.OrdinalIgnoreCase)) return false;
        var parts = PasswordHash.Split('$');
        if (parts is not ["pbkdf2-sha256", var iter, var salt, var hash] || !int.TryParse(iter, out var n) || n < 10_000) return false;
        try
        {
            var expected = Convert.FromBase64String(hash);
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, Convert.FromBase64String(salt), n, HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException) { return false; }
    }
}

/// <summary>
/// Stops password guessing at the Shell's Shift+F12 staff exit: <see cref="MaxFailures"/>
/// wrong sign-ins lock it for <see cref="Lockout"/>. (Windows' own account lockout still applies too.)
/// </summary>
public sealed class StaffExitGuard
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
