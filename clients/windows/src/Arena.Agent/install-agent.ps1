<#
  Installs the ArenaOS agent as a Windows service (LocalSystem, auto-start,
  restarts on failure) and the Gaming Shell next to it. Run as Administrator
  from the agent folder of the station package (see clients/windows/package.ps1):

    ArenaOS-Station\
      Agent\   ArenaAgent.exe, install-agent.ps1 ...   <- run from here
      Shell\   ArenaShell.exe, wwwroot\ ...

    .\ArenaAgent.exe enroll --api https://api.yourvenue.com --code ARENA-XXXXX-XXXXX-XXXXX-XXXXX --safe-mode off
    .\install-agent.ps1

  The Shell is found in ..\Shell (or pass -ShellPath). Once installed, the agent
  starts it full-screen whenever a standard (non-admin) Windows user signs in,
  and restarts it if it's closed. Administrators get the normal desktop, and
  nothing starts in safe mode.
#>
#Requires -RunAsAdministrator
param([string]$ShellPath)
$ErrorActionPreference = "Stop"
$name = "ArenaAgent"
$root = Join-Path $env:ProgramFiles "ArenaOS"
$target = Join-Path $root "Agent"
$shellTarget = Join-Path $root "Shell"
$data = Join-Path $env:ProgramData "ArenaOS\Agent"

if (-not (Test-Path (Join-Path $data "agent.json"))) {
    throw "This PC is not enrolled yet. Run: .\ArenaAgent.exe enroll --api <url> --code <code>"
}

if (-not $ShellPath) { $ShellPath = Join-Path $PSScriptRoot "..\Shell" }
$hasShell = Test-Path (Join-Path $ShellPath "ArenaShell.exe")

if (Get-Service $name -ErrorAction SilentlyContinue) {
    Stop-Service $name -Force -ErrorAction SilentlyContinue
    sc.exe delete $name | Out-Null
    Start-Sleep -Seconds 2
}
# A running Shell locks its files; the agent starts it again once installed.
Get-Process ArenaShell -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

function Install-Folder($from, $to) {
    New-Item -ItemType Directory -Force $to | Out-Null
    Copy-Item -Path (Join-Path $from "*") -Destination $to -Recurse -Force
    # Only SYSTEM and Administrators may modify the binaries.
    icacls $to /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" "Users:(OI)(CI)RX" | Out-Null
}

Install-Folder $PSScriptRoot $target
icacls $data /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null

if ($hasShell) {
    Install-Folder (Resolve-Path $ShellPath) $shellTarget
    # Older setups started the Shell from a logon task; the agent does it now.
    if (Get-ScheduledTask -TaskName "ArenaShell" -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName "ArenaShell" -Confirm:$false
    }
    $webView2 = "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    $hasWebView2 = @("HKLM:\$webView2", "HKCU:\$webView2") | Where-Object { (Get-ItemProperty $_ -ErrorAction SilentlyContinue).pv -notin @($null, "", "0.0.0.0") }
    if (-not $hasWebView2) {
        Write-Warning "Microsoft Edge WebView2 Runtime not found. The Shell needs it: https://developer.microsoft.com/microsoft-edge/webview2/ (Evergreen)."
    }
}

sc.exe create $name binPath= "`"$target\ArenaAgent.exe`"" start= auto obj= LocalSystem DisplayName= "ArenaOS Station Agent" | Out-Null
sc.exe description $name "Connects this gaming station to ArenaOS: health, remote commands, sessions, Gaming Shell." | Out-Null
sc.exe failure $name reset= 86400 actions= restart/5000/restart/5000/restart/30000 | Out-Null
Start-Service $name

Write-Host "ArenaAgent installed and running. It should appear online on the Live Floor within seconds." -ForegroundColor Green
$safeMode = (Get-Content (Join-Path $data "agent.json") -Raw | ConvertFrom-Json).safeMode
if (-not $hasShell) {
    Write-Warning "No Gaming Shell found at $ShellPath, so none was installed. Use the station package from clients/windows/package.ps1, or pass -ShellPath."
} elseif ($safeMode) {
    Write-Host "Gaming Shell installed. Safe mode is ON, so it won't start automatically. For a gaming PC: .\ArenaAgent.exe safe-mode off; Restart-Service $name" -ForegroundColor Yellow
} else {
    Write-Host "Gaming Shell installed. It starts full-screen when a standard (non-admin) Windows user signs in." -ForegroundColor Green
}
