using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using Arena.Agent.Core;

namespace Arena.Shell;

/// <summary>
/// Connection to the ArenaAgent service over \\.\pipe\ArenaOS.Shell, with
/// automatic reconnect. Before trusting the pipe it checks that the server end
/// is a Session 0 process (a Windows service) — otherwise a program started by
/// the customer could create the pipe first and feed the Shell a fake
/// "session running" state. In --dev mode that check is skipped so the agent
/// can run in a console.
/// </summary>
public sealed class AgentPipe(bool requireServiceServer) : IDisposable
{
    private readonly CancellationTokenSource _stop = new();
    private readonly object _writeGate = new();
    private NamedPipeClientStream? _pipe;

    public event Action<string>? LineReceived;
    public event Action<bool>? ConnectionChanged;

    public void Start() => _ = Task.Run(RunAsync);

    public bool TrySend(string json)
    {
        var pipe = _pipe;
        if (pipe is not { IsConnected: true }) return false;
        try
        {
            var bytes = Encoding.UTF8.GetBytes(json.ReplaceLineEndings("") + "\n");
            lock (_writeGate) { pipe.Write(bytes); pipe.Flush(); }
            return true;
        }
        catch (IOException) { return false; }
        catch (ObjectDisposedException) { return false; }
    }

    private async Task RunAsync()
    {
        var ct = _stop.Token;
        while (!ct.IsCancellationRequested)
        {
            var pipe = new NamedPipeClientStream(".", ShellProtocol.PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            try
            {
                await pipe.ConnectAsync(2000, ct);
                if (requireServiceServer && !ServerIsService(pipe))
                {
                    Trace.WriteLine("ArenaShell: refusing a pipe that is not served by a Windows service");
                    await pipe.DisposeAsync();
                    await Task.Delay(3000, ct);
                    continue;
                }
                _pipe = pipe;
                ConnectionChanged?.Invoke(true);
                using var reader = new StreamReader(pipe, new UTF8Encoding(false), false, 4096, leaveOpen: true);
                while (!ct.IsCancellationRequested)
                {
                    var line = await reader.ReadLineAsync(ct);
                    if (line is null) break;
                    if (line.Length > 0 && line.Length <= 256 * 1024) LineReceived?.Invoke(line);
                }
            }
            catch (TimeoutException) { }
            catch (IOException) { }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            finally
            {
                if (ReferenceEquals(_pipe, pipe))
                {
                    _pipe = null;
                    ConnectionChanged?.Invoke(false);
                }
                await pipe.DisposeAsync();
            }
            try { await Task.Delay(1000, ct); } catch (OperationCanceledException) { break; }
        }
    }

    private static bool ServerIsService(NamedPipeClientStream pipe)
    {
        if (!GetNamedPipeServerProcessId(pipe.SafePipeHandle, out var pid)) return false;
        if (!ProcessIdToSessionId(pid, out var session)) return false;
        return session == 0;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetNamedPipeServerProcessId(Microsoft.Win32.SafeHandles.SafePipeHandle pipe, out uint serverProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ProcessIdToSessionId(uint processId, out uint sessionId);

    public void Dispose()
    {
        _stop.Cancel();
        _pipe?.Dispose();
    }
}
