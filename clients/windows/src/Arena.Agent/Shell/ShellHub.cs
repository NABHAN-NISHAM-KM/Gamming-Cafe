using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Arena.Agent.Core;
using Microsoft.Extensions.Hosting.WindowsServices;

namespace Arena.Agent.Shell;

/// <summary>
/// Local named pipe <c>ArenaOS.Shell</c> between this agent (LocalSystem) and
/// the Gaming Shell running on the customer's desktop. The agent owns the
/// truth: it pushes state, and accepts only ready / login / logout from the
/// Shell (<see cref="ShellProtocol.Parse"/>). Created with FirstPipeInstance so
/// no user process can squat the name before the service starts.
/// </summary>
public sealed class ShellHub(SessionManager sessions, ILogger<ShellHub> log) : BackgroundService
{
    private const int MaxClients = 4;
    private readonly ConcurrentDictionary<int, ShellClient> _clients = new();
    private int _nextId;
    private readonly object _gate = new();
    private bool _connected;
    private string _station = Environment.MachineName;
    private bool _safeMode;
    private VenueInfo _venue = VenueInfo.Unknown;

    /// <summary>A login typed on the Shell. The agent relays it to the server.</summary>
    public event Func<ShellRequest.Login, Task>? LoginRequested;
    /// <summary>The customer pressed "Log out".</summary>
    public event Func<Task>? LogoutRequested;
    /// <summary>Launch / help / self-repair requests (already validated by ShellProtocol.Parse).</summary>
    public event Func<ShellRequest, Task>? RequestReceived;
    /// <summary>Shift+F12 with a staff PIN: leave the Shell for the Windows desktop.</summary>
    public event Func<ShellRequest.StaffExit, Task>? StaffExitRequested;
    /// <summary>A Shell (re)loaded and wants everything it shows.</summary>
    public event Action? ClientReady;

    public int ClientCount => _clients.Count;

    public void Configure(string station, bool safeMode, VenueInfo? cachedVenue)
    {
        lock (_gate) { _station = station; _safeMode = safeMode; _venue = cachedVenue ?? _venue; }
        PushState();
    }

    public void SetConnected(bool connected)
    {
        lock (_gate) { if (_connected == connected) return; _connected = connected; }
        PushState();
    }

    public void SetVenue(VenueInfo venue)
    {
        lock (_gate) _venue = venue;
        PushState();
    }

    public void PushState() => Broadcast(StateLine());

    public void SendLoginResult(string requestId, bool ok, string? error = null, string? message = null) =>
        Broadcast(ShellProtocol.LoginResult(requestId, ok, error, message));

    public void SendMessage(string title, string text) => Broadcast(ShellProtocol.Message(title, text));

    private string StateLine()
    {
        lock (_gate) return ShellProtocol.State(_connected, _station, _venue, sessions.Current, sessions.ClockOffset, _safeMode);
    }

    public void Broadcast(string line)
    {
        foreach (var c in _clients.Values) c.Enqueue(line);
    }

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        sessions.Changed += (_, _) => PushState();
        var first = true;
        while (!stop.IsCancellationRequested)
        {
            NamedPipeServerStream pipe;
            try
            {
                pipe = NamedPipeServerStreamAcl.Create(ShellProtocol.PipeName, PipeDirection.InOut, NamedPipeServerStream.MaxAllowedServerInstances,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous | (first ? PipeOptions.FirstPipeInstance : 0), 0, 0, Security());
                first = false;
            }
            catch (UnauthorizedAccessException) when (first)
            {
                log.LogCritical("Another process already owns the \\\\.\\pipe\\{Pipe} name — refusing to serve the Shell. Is a second agent running?", ShellProtocol.PipeName);
                return;
            }
            catch (IOException e)
            {
                log.LogWarning("Shell pipe unavailable: {Message}", e.Message);
                await Task.Delay(1000, stop);
                continue;
            }

            try { await pipe.WaitForConnectionAsync(stop); }
            catch (OperationCanceledException) { await pipe.DisposeAsync(); break; }

            if (_clients.Count >= MaxClients) { await pipe.DisposeAsync(); continue; }
            var id = Interlocked.Increment(ref _nextId);
            var client = new ShellClient(pipe);
            _clients[id] = client;
            log.LogInformation("Gaming Shell connected (#{Id})", id);
            _ = Task.Run(async () =>
            {
                try { await ServeAsync(client, stop); }
                catch (Exception e) when (e is IOException or OperationCanceledException or ObjectDisposedException) { }
                catch (Exception e) { log.LogWarning(e, "Shell client #{Id} failed", id); }
                finally
                {
                    _clients.TryRemove(id, out _);
                    client.Dispose();
                    log.LogInformation("Gaming Shell disconnected (#{Id})", id);
                }
            }, stop);
        }
    }

    private async Task ServeAsync(ShellClient client, CancellationToken stop)
    {
        var writer = client.RunWriterAsync(stop);
        using var reader = new StreamReader(client.Pipe, new UTF8Encoding(false), false, 4096, leaveOpen: true);
        var loginBucket = new Queue<DateTimeOffset>();
        while (!stop.IsCancellationRequested)
        {
            var line = await ReadBoundedLineAsync(reader, stop);
            if (line is null) break;
            var request = ShellProtocol.Parse(line);
            switch (request)
            {
                case ShellRequest.Ready:
                    client.Enqueue(StateLine());
                    ClientReady?.Invoke();
                    break;
                case ShellRequest.Login login:
                    // Local flood guard; the server applies the real per-device/per-account throttles.
                    var now = DateTimeOffset.UtcNow;
                    while (loginBucket.Count > 0 && now - loginBucket.Peek() > TimeSpan.FromMinutes(1)) loginBucket.Dequeue();
                    if (loginBucket.Count >= 10) { client.Enqueue(ShellProtocol.LoginResult(login.RequestId, false, "too_many_attempts", "Too many attempts. Please wait a minute.")); break; }
                    loginBucket.Enqueue(now);
                    if (LoginRequested is { } onLogin) await onLogin(login);
                    break;
                case ShellRequest.Logout:
                    if (LogoutRequested is { } onLogout) await onLogout();
                    break;
                case ShellRequest.StaffExit exit:
                    if (StaffExitRequested is { } onExit) await onExit(exit);
                    break;
                case ShellRequest.Launch or ShellRequest.LaunchApp or ShellRequest.Help or ShellRequest.Feedback or ShellRequest.Repair or ShellRequest.MenuRequest or ShellRequest.PlaceOrder or ShellRequest.TimeOffers or ShellRequest.BuyTime or ShellRequest.Screenshot:
                    if (RequestReceived is { } onRequest) await onRequest(request!);
                    break;
                default:
                    log.LogDebug("Ignored a malformed message from the Shell");
                    break;
            }
        }
        client.Complete();
        await writer;
    }

    /// <summary>Reads one line, refusing to buffer more than <see cref="ShellProtocol.MaxLineBytes"/>.</summary>
    private static async Task<string?> ReadBoundedLineAsync(StreamReader reader, CancellationToken ct)
    {
        var sb = new StringBuilder();
        var buf = new char[1];
        while (true)
        {
            var n = await reader.ReadAsync(buf.AsMemory(), ct);
            if (n == 0) return sb.Length > 0 ? sb.ToString() : null;
            if (buf[0] == '\n') return sb.ToString();
            if (buf[0] == '\r') continue;
            if (sb.Length >= ShellProtocol.MaxLineBytes) throw new IOException("line too long");
            sb.Append(buf[0]);
        }
    }

    /// <summary>SYSTEM + Administrators full control; the interactive desktop user may read/write, nothing else.</summary>
    private static PipeSecurity Security()
    {
        var s = new PipeSecurity();
        s.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        s.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        s.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.InteractiveSid, null), PipeAccessRights.ReadWrite, AccessControlType.Allow));
        if (!WindowsServiceHelpers.IsWindowsService())
        {
            // Console/dev mode: the agent runs as the developer, who must be able to create further instances.
            s.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User!, PipeAccessRights.FullControl, AccessControlType.Allow));
        }
        return s;
    }

    private sealed class ShellClient(NamedPipeServerStream pipe) : IDisposable
    {
        private readonly System.Threading.Channels.Channel<string> _out = System.Threading.Channels.Channel.CreateBounded<string>(
            new System.Threading.Channels.BoundedChannelOptions(64) { FullMode = System.Threading.Channels.BoundedChannelFullMode.DropOldest });

        public NamedPipeServerStream Pipe => pipe;
        public void Enqueue(string line) => _out.Writer.TryWrite(line);
        public void Complete() => _out.Writer.TryComplete();

        public async Task RunWriterAsync(CancellationToken ct)
        {
            await foreach (var line in _out.Reader.ReadAllAsync(ct))
            {
                var bytes = Encoding.UTF8.GetBytes(line + "\n");
                await pipe.WriteAsync(bytes, ct);
                await pipe.FlushAsync(ct);
            }
        }

        public void Dispose()
        {
            _out.Writer.TryComplete();
            pipe.Dispose();
        }
    }
}
