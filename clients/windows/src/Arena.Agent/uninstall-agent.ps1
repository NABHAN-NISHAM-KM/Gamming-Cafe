<#  Removes the ArenaOS agent service and the Gaming Shell. Add -Purge to also delete the station identity and key. #>
#Requires -RunAsAdministrator
param([switch]$Purge)
$name = "ArenaAgent"
if (Get-Service $name -ErrorAction SilentlyContinue) {
    Stop-Service $name -Force -ErrorAction SilentlyContinue
    sc.exe delete $name | Out-Null
}
Get-Process ArenaShell -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if (Get-ScheduledTask -TaskName "ArenaShell" -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName "ArenaShell" -Confirm:$false }
Remove-Item -Recurse -Force (Join-Path $env:ProgramFiles "ArenaOS\Agent") -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $env:ProgramFiles "ArenaOS\Shell") -ErrorAction SilentlyContinue
if ($Purge) { Remove-Item -Recurse -Force (Join-Path $env:ProgramData "ArenaOS\Agent") -ErrorAction SilentlyContinue }
Write-Host "ArenaAgent and Gaming Shell removed." -ForegroundColor Green
