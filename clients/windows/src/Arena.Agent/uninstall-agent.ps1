<#  Removes the ArenaOS agent service. Add -Purge to also delete the station identity and key. #>
#Requires -RunAsAdministrator
param([switch]$Purge)
$name = "ArenaAgent"
if (Get-Service $name -ErrorAction SilentlyContinue) {
    Stop-Service $name -Force -ErrorAction SilentlyContinue
    sc.exe delete $name | Out-Null
}
Remove-Item -Recurse -Force (Join-Path $env:ProgramFiles "ArenaOS\Agent") -ErrorAction SilentlyContinue
if ($Purge) { Remove-Item -Recurse -Force (Join-Path $env:ProgramData "ArenaOS\Agent") -ErrorAction SilentlyContinue }
Write-Host "ArenaAgent removed." -ForegroundColor Green
