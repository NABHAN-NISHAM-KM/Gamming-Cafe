<#
  Builds the station package to copy to every gaming PC:

    clients\windows\dist\ArenaOS-Station\
      Agent\   ArenaAgent.exe, install-agent.ps1, uninstall-agent.ps1
      Shell\   ArenaShell.exe, wwwroot\ (the Gaming Shell UI)

  Self-contained by default, so gaming PCs don't need the .NET runtime (only
  the WebView2 runtime, which Windows 11 already has). Needs Node 22+ and the
  .NET 8 SDK on the build machine.

    .\clients\windows\package.ps1                     # self-contained win-x64
    .\clients\windows\package.ps1 -FrameworkDependent # smaller; PCs need the .NET 8 Desktop Runtime

  Then on each gaming PC, as Administrator, from ArenaOS-Station\Agent:
    .\ArenaAgent.exe enroll --api http://SERVER:4000 --code ARENA-... --safe-mode off
    .\install-agent.ps1
#>
param([switch]$FrameworkDependent, [string]$Runtime = "win-x64")
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$out = Join-Path $PSScriptRoot "dist\ArenaOS-Station"
$selfContained = if ($FrameworkDependent) { "false" } else { "true" }

Push-Location $repo
try {
    Write-Host "Building the Gaming Shell UI..." -ForegroundColor Cyan
    npm run build -w @arena/shell
    if ($LASTEXITCODE) { throw "Shell UI build failed" }

    if (Test-Path $out) { Remove-Item -Recurse -Force $out }
    foreach ($p in @(@{ Project = "Arena.Agent"; Dir = "Agent" }, @{ Project = "Arena.Shell"; Dir = "Shell" })) {
        Write-Host "Publishing $($p.Project)..." -ForegroundColor Cyan
        dotnet publish (Join-Path $PSScriptRoot "src\$($p.Project)") -c Release -r $Runtime --self-contained $selfContained -o (Join-Path $out $p.Dir)
        if ($LASTEXITCODE) { throw "$($p.Project) publish failed" }
    }
    foreach ($f in @("Agent\ArenaAgent.exe", "Agent\install-agent.ps1", "Shell\ArenaShell.exe", "Shell\wwwroot\index.html")) {
        if (-not (Test-Path (Join-Path $out $f))) { throw "Package is missing $f" }
    }
} finally {
    Pop-Location
}
Write-Host "Station package ready: $out" -ForegroundColor Green
