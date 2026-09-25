<#
  Installs the ArenaOS agent as a Windows service (LocalSystem, auto-start,
  restarts on failure). Run as Administrator from the agent folder:

    .\ArenaAgent.exe enroll --api https://api.yourvenue.com --code ARENA-XXXXX-XXXXX-XXXXX-XXXXX --safe-mode off
    .\install-agent.ps1
#>
#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$name = "ArenaAgent"
$target = Join-Path $env:ProgramFiles "ArenaOS\Agent"
$data = Join-Path $env:ProgramData "ArenaOS\Agent"

if (-not (Test-Path (Join-Path $data "agent.json"))) {
    throw "This PC is not enrolled yet. Run: .\ArenaAgent.exe enroll --api <url> --code <code>"
}

if (Get-Service $name -ErrorAction SilentlyContinue) {
    Stop-Service $name -Force -ErrorAction SilentlyContinue
    sc.exe delete $name | Out-Null
    Start-Sleep -Seconds 2
}

New-Item -ItemType Directory -Force $target | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot "*") -Destination $target -Recurse -Force

# Only SYSTEM and Administrators may modify the agent binaries.
icacls $target /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" "Users:(OI)(CI)RX" | Out-Null
icacls $data /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null

sc.exe create $name binPath= "`"$target\ArenaAgent.exe`"" start= auto obj= LocalSystem DisplayName= "ArenaOS Station Agent" | Out-Null
sc.exe description $name "Connects this gaming station to ArenaOS: health, remote commands, sessions." | Out-Null
sc.exe failure $name reset= 86400 actions= restart/5000/restart/5000/restart/30000 | Out-Null
Start-Service $name

Write-Host "ArenaAgent installed and running. It should appear online on the Live Floor within seconds." -ForegroundColor Green
