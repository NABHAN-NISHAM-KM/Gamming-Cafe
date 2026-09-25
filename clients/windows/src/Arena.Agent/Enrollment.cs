using System.Net.Http.Json;
using Arena.Agent.Core;
using Arena.Agent.Windows;

namespace Arena.Agent;

/// <summary>
/// One-time registration: generate the device key on this PC, send only the
/// PUBLIC key with the enrolment code, pin the branch signing keys returned.
/// </summary>
public static class Enrollment
{
    public static async Task<int> RunAsync(AgentPaths paths, string apiUrl, string code, string? name, bool safeMode)
    {
        if (File.Exists(paths.Identity))
        {
            var existing = AgentIdentity.Load(paths.Identity);
            Console.WriteLine($"This PC is already enrolled as {existing.Name}. Re-enrolling replaces its key (the station keeps its history).");
        }

        using var key = KeyStore.CreateAndSave(paths.Key);
        var nic = PrimaryNic.Detect();
        using var http = new HttpClient { BaseAddress = new Uri(apiUrl.TrimEnd('/') + "/"), Timeout = TimeSpan.FromSeconds(20) };
        var res = await http.PostAsJsonAsync("v1/device/enroll", new
        {
            enrollmentCode = code.Trim(),
            publicKeyPem = key.ExportSubjectPublicKeyInfoPem(),
            hostname = Environment.MachineName,
            macAddress = nic?.Mac,
            requestedName = name,
            agentVersion = AgentWorker.Version,
        }, Json.Options);

        if (!res.IsSuccessStatusCode)
        {
            File.Delete(paths.Key);
            var body = await res.Content.ReadAsStringAsync();
            Console.Error.WriteLine((int)res.StatusCode switch
            {
                401 => "Enrolment code is invalid, expired, revoked or used up. Create a new one in Admin → Computers → Add stations.",
                402 => "Your plan's station limit is reached. Upgrade the plan or retire an old station.",
                409 => $"Conflict: {body}",
                _ => $"Enrolment failed ({(int)res.StatusCode}): {body}",
            });
            return 2;
        }

        var r = (await res.Content.ReadFromJsonAsync<EnrollResponse>(Json.Options))!;
        new AgentIdentity
        {
            ApiUrl = apiUrl.TrimEnd('/'),
            DeviceId = r.DeviceId,
            OrganizationId = r.OrganizationId,
            BranchId = r.BranchId,
            Name = r.Name,
            SigningKeys = r.SigningKeys,
            HeartbeatSeconds = r.HeartbeatSeconds,
            WebsocketPath = r.WebsocketPath,
            SafeMode = safeMode,
        }.Save(paths.Identity);

        Console.WriteLine($"Enrolled as {r.Name}. Identity saved to {paths.DataDir}");
        Console.WriteLine(safeMode
            ? "SAFE MODE is ON: restart/shutdown/lock/logout/app launches will be simulated. Turn off for real stations: ArenaAgent safe-mode off"
            : "Safe mode is OFF: this station will obey restart/shutdown/lock commands.");
        return 0;
    }
}
