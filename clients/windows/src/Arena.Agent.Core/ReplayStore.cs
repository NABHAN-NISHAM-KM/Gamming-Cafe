using System.Text.Json;

namespace Arena.Agent.Core;

/// <summary>
/// Remembers executed command ids (persisted, so a replayed command is refused
/// even after a reboot). Entries are kept for longer than any command lifetime.
/// </summary>
public sealed class ReplayStore
{
    private readonly string? _path;
    private readonly TimeSpan _keep;
    private readonly int _max;
    private readonly Dictionary<string, DateTimeOffset> _seen = new(StringComparer.OrdinalIgnoreCase);
    private readonly object _gate = new();

    public ReplayStore(string? path, TimeSpan? keep = null, int max = 5000)
    {
        _path = path;
        _keep = keep ?? TimeSpan.FromHours(24);
        _max = max;
        if (_path is not null && File.Exists(_path))
        {
            try
            {
                var saved = JsonSerializer.Deserialize<Dictionary<string, DateTimeOffset>>(File.ReadAllText(_path));
                if (saved is not null) foreach (var (k, v) in saved) _seen[k] = v;
            }
            catch (JsonException) { /* corrupt file: start empty; commands still expire server-side */ }
        }
    }

    public bool Seen(string commandId)
    {
        lock (_gate) return _seen.ContainsKey(commandId);
    }

    public void Add(string commandId, DateTimeOffset now)
    {
        lock (_gate)
        {
            _seen[commandId] = now;
            foreach (var old in _seen.Where(kv => now - kv.Value > _keep).Select(kv => kv.Key).ToList()) _seen.Remove(old);
            if (_seen.Count > _max)
                foreach (var old in _seen.OrderBy(kv => kv.Value).Take(_seen.Count - _max).Select(kv => kv.Key).ToList()) _seen.Remove(old);
            if (_path is not null)
            {
                var tmp = _path + ".tmp";
                File.WriteAllText(tmp, JsonSerializer.Serialize(_seen));
                File.Move(tmp, _path, overwrite: true);
            }
        }
    }
}
