using System.Text.Json;
using System.Text.RegularExpressions;

namespace Arena.Agent.Core.Games;

// Mirrors StationConfig in packages/contracts. It arrives as the payload of a
// SIGNED REFRESH_CONFIG envelope and is only accepted after verification.

public sealed record LaunchSpec(string Kind, string? ExecutablePath, string? Arguments, string? WorkingDirectory, string? AppId, string? AppName);

public sealed record LibraryGame(
    string Id, string Title, string[] Categories, string? CoverUrl, int? MinAge, bool Featured, int SortOrder,
    string? LauncherKey, LaunchSpec? Launch, string[] ProcessNames, bool Installed, bool UpdateRequired);

public sealed record LibraryApp(string Id, string Name, string Kind, string ExecutablePath, string? Arguments);

public sealed record ConnectivityTarget(string Name, string Host);

public sealed record PointerSettings(int? MouseSpeed, bool? EnhancePointerPrecision);

public sealed record PeripheralPreset(string Id, string Name, PointerSettings Settings);

public sealed record StationConfig(
    string Revision, LibraryGame[] Games, LibraryApp[] Apps, ConnectivityTarget[] ConnectivityTargets, PeripheralPreset[] PeripheralPresets)
{
    public static StationConfig? FromPayload(JsonElement payload)
    {
        try { return payload.Deserialize<StationConfig>(Json.Options); }
        catch (JsonException) { return null; }
    }
}

/// <summary>What to actually start: a program and its arguments (never a shell command line).</summary>
public sealed record LaunchPlan(string FileName, string Arguments, string? WorkingDirectory);

public enum LaunchDenial { None, NoSession, NotInLibrary, NotInstalled, AgeRestricted, NotLaunchable, Forbidden }

/// <summary>
/// Decides whether the customer at the PC may start something, and how. The
/// server signed the library; this adds the local rules: a session must be
/// running, the item must be in the library, the customer must be old enough,
/// and interpreters/system tools never run — whatever the catalog says.
/// </summary>
public static partial class LaunchPolicy
{
    private static readonly HashSet<string> DeniedExecutables = new(StringComparer.OrdinalIgnoreCase)
    {
        "cmd.exe", "powershell.exe", "pwsh.exe", "powershell_ise.exe", "wscript.exe", "cscript.exe", "mshta.exe", "rundll32.exe",
        "regsvr32.exe", "reg.exe", "regedit.exe", "certutil.exe", "bitsadmin.exe", "wmic.exe", "msiexec.exe", "schtasks.exe", "sc.exe",
        "net.exe", "taskmgr.exe", "mmc.exe",
    };

    [GeneratedRegex(@"^\d{1,10}$")] private static partial Regex SteamAppId();
    [GeneratedRegex(@"^[\w.-]{1,128}$")] private static partial Regex EpicAppName();

    public static bool IsSafeExecutable(string? path) =>
        !string.IsNullOrWhiteSpace(path) && Path.IsPathFullyQualified(path) && path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
        && !DeniedExecutables.Contains(Path.GetFileName(path));

    public static (LaunchDenial Denial, LaunchPlan? Plan) ForGame(StationConfig? config, SessionState? session, string gameId, string? steamExe)
    {
        if (session is null) return (LaunchDenial.NoSession, null);
        var game = config?.Games.FirstOrDefault(g => g.Id == gameId);
        if (game is null) return (LaunchDenial.NotInLibrary, null);
        if (game.MinAge is { } min && session.CustomerAge is { } age && age < min) return (LaunchDenial.AgeRestricted, null);
        if (!game.Installed) return (LaunchDenial.NotInstalled, null);
        var plan = PlanFor(game.Launch, steamExe);
        return plan is null ? (LaunchDenial.NotLaunchable, null) : (LaunchDenial.None, plan);
    }

    public static (LaunchDenial Denial, LaunchPlan? Plan) ForApp(StationConfig? config, SessionState? session, string appId)
    {
        if (session is null) return (LaunchDenial.NoSession, null);
        var app = config?.Apps.FirstOrDefault(a => a.Id == appId);
        if (app is null) return (LaunchDenial.NotInLibrary, null);
        if (!IsSafeExecutable(app.ExecutablePath)) return (LaunchDenial.Forbidden, null);
        return (LaunchDenial.None, new LaunchPlan(app.ExecutablePath, app.Arguments ?? "", Path.GetDirectoryName(app.ExecutablePath)));
    }

    /// <summary>
    /// Steam: steam.exe -applaunch &lt;appid&gt;. Epic: its launcher URI, opened via
    /// explorer.exe. Otherwise the signed executable path. Ids are re-validated here.
    /// </summary>
    public static LaunchPlan? PlanFor(LaunchSpec? spec, string? steamExe)
    {
        switch (spec?.Kind)
        {
            case "STEAM" when spec.AppId is { } id && SteamAppId().IsMatch(id):
                return steamExe is null ? null : new LaunchPlan(steamExe, $"-applaunch {id}", Path.GetDirectoryName(steamExe));
            case "EPIC" when spec.AppName is { } name && EpicAppName().IsMatch(name):
                return new LaunchPlan(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"),
                    $"\"com.epicgames.launcher://apps/{name}?action=launch&silent=true\"", null);
            case "PATH" when IsSafeExecutable(spec.ExecutablePath):
                return new LaunchPlan(spec.ExecutablePath!, spec.Arguments ?? "", spec.WorkingDirectory ?? Path.GetDirectoryName(spec.ExecutablePath));
            default:
                return null;
        }
    }

    /// <summary>How a launcher is asked to bring a game up to date (UPDATE_GAME).</summary>
    public static LaunchPlan? UpdatePlanFor(LaunchSpec? spec, string? steamExe) => spec?.Kind switch
    {
        "STEAM" when spec.AppId is { } id && SteamAppId().IsMatch(id) && steamExe is not null =>
            new LaunchPlan(steamExe, $"-silent steam://validate/{id}", Path.GetDirectoryName(steamExe)),
        "EPIC" when spec.AppName is { } name && EpicAppName().IsMatch(name) =>
            // Epic updates games when its launcher runs; open it quietly on the library page.
            new LaunchPlan(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"), "\"com.epicgames.launcher://store/library\"", null),
        _ => null,
    };

    public static string Message(LaunchDenial d) => d switch
    {
        LaunchDenial.NoSession => "Sign in first to start playing.",
        LaunchDenial.NotInLibrary => "That isn't available on this PC.",
        LaunchDenial.NotInstalled => "That game isn't installed on this PC. Please ask staff.",
        LaunchDenial.AgeRestricted => "This game has an age rating above your age.",
        LaunchDenial.NotLaunchable => "This game can't be started from here. Please ask staff.",
        LaunchDenial.Forbidden => "That program isn't allowed.",
        _ => "",
    };
}
