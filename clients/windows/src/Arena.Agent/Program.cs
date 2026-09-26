using Arena.Agent;
using Arena.Agent.Core;
using Arena.Agent.Shell;
using Arena.Agent.Windows;
using Microsoft.Extensions.Hosting.WindowsServices;

// ArenaAgent.exe
//   enroll --api <url> --code <ARENA-…> [--name PC-17] [--safe-mode on|off] [--data-dir <dir>]
//   run [--data-dir <dir>]           run in this console (development / troubleshooting)
//   status [--data-dir <dir>]
//   safe-mode on|off [--data-dir <dir>]
//   (no verb when started by the Windows Service Control Manager)

var paths = AgentPaths.Resolve(args);
string? Opt(string name) { var i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
var verb = args.FirstOrDefault(a => !a.StartsWith("--") && Array.IndexOf(args, a) is var i && (i == 0 || !args[i - 1].StartsWith("--")));

switch (verb)
{
    case "enroll":
        var api = Opt("--api");
        var code = Opt("--code");
        if (api is null || code is null)
        {
            Console.Error.WriteLine("Usage: ArenaAgent enroll --api https://api.example.com --code ARENA-XXXXX-XXXXX-XXXXX-XXXXX [--name PC-17] [--safe-mode on|off]");
            return 1;
        }
        return await Enrollment.RunAsync(paths, api, code, Opt("--name"), Opt("--safe-mode") is not "off");

    case "status":
        if (!File.Exists(paths.Identity)) { Console.WriteLine($"Not enrolled (data dir: {paths.DataDir})"); return 1; }
        var id = AgentIdentity.Load(paths.Identity);
        Console.WriteLine($"Station:   {id.Name}\nDevice id: {id.DeviceId}\nAPI:       {id.ApiUrl}\nSafe mode: {(id.SafeMode ? "ON" : "off")}\nEnrolled:  {id.EnrolledAt:u}\nData dir:  {paths.DataDir}");
        return 0;

    case "safe-mode":
        var value = args.SkipWhile(a => a != "safe-mode").Skip(1).FirstOrDefault();
        if (value is not ("on" or "off")) { Console.Error.WriteLine("Usage: ArenaAgent safe-mode on|off"); return 1; }
        AgentIdentity.Load(paths.Identity).Let(i => (i with { SafeMode = value == "on" }).Save(paths.Identity));
        Console.WriteLine($"Safe mode {value}. Restart the ArenaAgent service to apply.");
        return 0;

    case null when WindowsServiceHelpers.IsWindowsService():
    case "run":
        var builder = Host.CreateApplicationBuilder(args);
        builder.Services.AddWindowsService(o => o.ServiceName = "ArenaAgent");
        builder.Services.AddSingleton(paths);
        builder.Services.AddSingleton<MetricsCollector>();
        builder.Services.AddSingleton<CommandExecutor>();
        builder.Services.AddSingleton(_ => new SessionManager(paths.Session));
        builder.Services.AddSingleton<ShellHub>();
        builder.Services.AddSingleton<ServerLink>();
        builder.Services.AddSingleton<GameScanner>();
        builder.Services.AddSingleton<PeripheralScanner>();
        builder.Services.AddSingleton<NetworkProber>();
        builder.Services.AddSingleton<RepairRunner>();
        builder.Services.AddSingleton<StationService>();
        builder.Services.AddSingleton<PrintMonitor>();
        builder.Services.AddSingleton<PowerBridge>();
        builder.Services.AddHostedService(sp => sp.GetRequiredService<PrintMonitor>());
        builder.Services.AddHostedService(sp => sp.GetRequiredService<StationService>());
        builder.Services.AddHostedService(sp => sp.GetRequiredService<ShellHub>());
        builder.Services.AddHostedService<SessionWatchdog>();
        builder.Services.AddHostedService<AgentWorker>();
        await builder.Build().RunAsync();
        return 0;

    default:
        Console.WriteLine("ArenaOS station agent\n\n  ArenaAgent enroll --api <url> --code <code> [--name PC-17] [--safe-mode on|off]\n  ArenaAgent run        (console mode)\n  ArenaAgent status\n  ArenaAgent safe-mode on|off\n\nInstall as a Windows service with install-agent.ps1 (as Administrator).");
        return verb is null ? 0 : 1;
}

internal static class Ext
{
    public static void Let<T>(this T value, Action<T> fn) => fn(value);
}
