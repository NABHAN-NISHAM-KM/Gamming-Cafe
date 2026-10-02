using System.IO.Compression;
using System.Text.RegularExpressions;

namespace Arena.Agent.Core.Games;

/// <summary>
/// Save folders that follow the player between PCs. The venue lists a game's
/// folders with placeholders ("%APPDATA%\Game\Saves"); they always resolve
/// inside the player's own Windows profile. The folders travel as one zip whose
/// entries start with the folder's index ("0/slot1.sav"), so restoring writes
/// each file back under the same folder — and nowhere else.
/// </summary>
public static partial class GameSaves
{
    public const long MaxBytes = 20 * 1024 * 1024;

    [GeneratedRegex(@"^%(APPDATA|LOCALAPPDATA|USERPROFILE|DOCUMENTS|SAVEDGAMES)%((\\[^\\/:*?""<>|]+)+)$")]
    private static partial Regex Pattern();

    /// <summary>The real folder for a placeholder path in this profile, or null if it isn't a valid save path.</summary>
    public static string? Resolve(string pattern, string profileDir)
    {
        var m = Pattern().Match(pattern);
        if (!m.Success) return null;
        var rest = m.Groups[2].Value.Trim('\\');
        if (rest.Split('\\').Any(p => p is "." or "..")) return null;
        var root = m.Groups[1].Value switch
        {
            "APPDATA" => Path.Combine(profileDir, "AppData", "Roaming"),
            "LOCALAPPDATA" => Path.Combine(profileDir, "AppData", "Local"),
            "DOCUMENTS" => Path.Combine(profileDir, "Documents"),
            "SAVEDGAMES" => Path.Combine(profileDir, "Saved Games"),
            _ => profileDir,
        };
        var full = Path.GetFullPath(Path.Combine(root, rest.Replace('\\', Path.DirectorySeparatorChar)));
        return IsInside(full, profileDir) ? full : null;
    }

    /// <summary>Zips the folders that exist; null when there's nothing to save or it's over the limit.</summary>
    public static byte[]? Pack(IReadOnlyList<string> folders)
    {
        using var ms = new MemoryStream();
        var any = false;
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            long total = 0;
            for (var i = 0; i < folders.Count; i++)
            {
                if (!Directory.Exists(folders[i])) continue;
                foreach (var file in Directory.EnumerateFiles(folders[i], "*", SearchOption.AllDirectories))
                {
                    var info = new FileInfo(file);
                    if ((info.Attributes & FileAttributes.ReparsePoint) != 0) continue; // never follow links out of the folder
                    total += info.Length;
                    if (total > MaxBytes) return null;
                    var rel = Path.GetRelativePath(folders[i], file).Replace(Path.DirectorySeparatorChar, '/');
                    zip.CreateEntryFromFile(file, $"{i}/{rel}", CompressionLevel.Optimal);
                    any = true;
                }
            }
        }
        return any && ms.Length <= MaxBytes ? ms.ToArray() : null;
    }

    /// <summary>Writes the zip back into the folders. Entries that would land outside their folder are skipped. Returns files written.</summary>
    public static int Unpack(byte[] zipBytes, IReadOnlyList<string> folders)
    {
        using var zip = new ZipArchive(new MemoryStream(zipBytes), ZipArchiveMode.Read);
        var written = 0;
        long total = 0;
        foreach (var e in zip.Entries)
        {
            if (e.FullName.EndsWith('/')) continue;
            var slash = e.FullName.IndexOf('/');
            if (slash < 1 || !int.TryParse(e.FullName[..slash], out var i) || i < 0 || i >= folders.Count) continue;
            total += e.Length;
            if (total > MaxBytes * 4) break; // zip bomb guard
            var target = Path.GetFullPath(Path.Combine(folders[i], e.FullName[(slash + 1)..].Replace('/', Path.DirectorySeparatorChar)));
            if (!IsInside(target, folders[i])) continue;
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            e.ExtractToFile(target, overwrite: true);
            written++;
        }
        return written;
    }

    private static bool IsInside(string path, string dir)
    {
        var d = Path.GetFullPath(dir).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        return Path.GetFullPath(path).StartsWith(d, StringComparison.OrdinalIgnoreCase);
    }
}
