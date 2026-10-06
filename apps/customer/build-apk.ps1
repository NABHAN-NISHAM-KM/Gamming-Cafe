<#
  Builds the Android APK of the customer app.

  Demo (the live demo venue runs inside the app, offline; nothing to host):
    .\apps\customer\build-apk.ps1
  Output: apps\customer\android\app\build\outputs\apk\debug\app-debug.apk
          -> apps\website\downloads\ArenaOS-Customer.apk

  Real venues, talking to a hosted API (it must allow https://localhost in CORS_ORIGINS):
    .\apps\customer\build-apk.ps1 -Api https://arena-prod.duckdns.org
      one app for every venue: customers enter their venue code once
    .\apps\customer\build-apk.ps1 -Api https://arena-prod.duckdns.org -Venue exe-gamming-cafe
      locked to one venue (a venue's own branded app)
  Output: apps\customer\Arena.apk

  Needs Node 22+, JDK 17+ and the Android SDK (ANDROID_HOME or ANDROID_SDK_ROOT).
  The APK is debug-signed: fine for trying the demo (Android asks to allow the
  install). A Play Store release needs your own signing key.
#>
param([string]$Api, [string]$Venue)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$app = $PSScriptRoot
$repo = Resolve-Path (Join-Path $app "..\..")
$downloads = Join-Path $repo "apps\website\downloads"

function New-LauncherPng([string]$path, [int]$size, [bool]$round) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = "AntiAlias"; $g.TextRenderingHint = "AntiAliasGridFit"
    $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    if ($round) { $gp.AddEllipse($rect) } else {
        $r = [int]($size * 0.28)
        $gp.AddArc(0, 0, $r, $r, 180, 90); $gp.AddArc($size - $r - 1, 0, $r, $r, 270, 90)
        $gp.AddArc($size - $r - 1, $size - $r - 1, $r, $r, 0, 90); $gp.AddArc(0, $size - $r - 1, $r, $r, 90, 90); $gp.CloseFigure()
    }
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 124, 77, 255)), ([System.Drawing.Color]::FromArgb(255, 46, 230, 246)), 35
    $blend = New-Object System.Drawing.Drawing2D.ColorBlend 3
    $blend.Colors = @([System.Drawing.Color]::FromArgb(255, 124, 77, 255), [System.Drawing.Color]::FromArgb(255, 160, 124, 255), [System.Drawing.Color]::FromArgb(255, 46, 230, 246))
    $blend.Positions = @(0.0, 0.45, 1.0)
    $brush.InterpolationColors = $blend
    $g.FillPath($brush, $gp)
    $font = New-Object System.Drawing.Font "Segoe UI", ([float]($size * 0.58)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = "Center"; $fmt.LineAlignment = "Center"
    $g.DrawString("A", $font, (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 11, 7, 23))), (New-Object System.Drawing.RectangleF 0, ([float]($size * 0.03)), $size, $size), $fmt)
    $g.Dispose()
    New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}

Push-Location $app
try {
    if ($Api) {
        Write-Host "Building the customer app for $Api (venue: $(if ($Venue) { $Venue } else { 'customer picks' }))..." -ForegroundColor Cyan
        $env:VITE_ARENA_API = $Api.TrimEnd("/"); if ($Venue) { $env:VITE_ARENA_VENUE = $Venue }
    } else {
        Write-Host "Building the customer app (demo mode)..." -ForegroundColor Cyan
        $env:VITE_ARENA_DEMO = "1"
    }
    npx vite build --base / --outDir www --emptyOutDir
    if ($LASTEXITCODE) { throw "Web build failed" }
    Remove-Item Env:VITE_ARENA_DEMO, Env:VITE_ARENA_API, Env:VITE_ARENA_VENUE -ErrorAction SilentlyContinue

    if (-not (Test-Path "android")) {
        Write-Host "Creating the Android project..." -ForegroundColor Cyan
        npx cap add android
        if ($LASTEXITCODE) { throw "cap add android failed" }
    }
    npx cap sync android
    if ($LASTEXITCODE) { throw "cap sync failed" }

    # ArenaOS launcher icons (plain PNGs; the adaptive default would show the Capacitor logo).
    $res = Join-Path $app "android\app\src\main\res" # absolute: .NET doesn't follow PowerShell's current folder
    Remove-Item -Recurse -Force (Join-Path $res "mipmap-anydpi-v26") -ErrorAction SilentlyContinue
    foreach ($d in @(@{ n = "mdpi"; s = 48 }, @{ n = "hdpi"; s = 72 }, @{ n = "xhdpi"; s = 96 }, @{ n = "xxhdpi"; s = 144 }, @{ n = "xxxhdpi"; s = 192 })) {
        New-LauncherPng (Join-Path $res "mipmap-$($d.n)\ic_launcher.png") $d.s $false
        New-LauncherPng (Join-Path $res "mipmap-$($d.n)\ic_launcher_round.png") $d.s $true
        Remove-Item (Join-Path $res "mipmap-$($d.n)\ic_launcher_foreground.png") -ErrorAction SilentlyContinue
    }

    Write-Host "Building the APK (the first run downloads Gradle; takes a few minutes)..." -ForegroundColor Cyan
    Push-Location android
    # Gradle prints warnings (e.g. "SDK XML version 4") on stderr; Windows PowerShell turns
    # redirected stderr into errors, which "Stop" would treat as fatal. The exit code decides.
    $ErrorActionPreference = "Continue"
    try {
        .\gradlew.bat assembleDebug --no-daemon -q
        if ($LASTEXITCODE) { throw "Gradle build failed" }
    } finally { Pop-Location; $ErrorActionPreference = "Stop" }

    $apk = "android\app\build\outputs\apk\debug\app-debug.apk"
    if ($Api) {
        Copy-Item $apk (Join-Path $app "Arena.apk") -Force
        Write-Host ("Arena.apk  {0:N1} MB -> {1}" -f ((Get-Item $apk).Length / 1MB), $app) -ForegroundColor Green
    } else {
        New-Item -ItemType Directory -Force $downloads | Out-Null
        Copy-Item $apk (Join-Path $downloads "ArenaOS-Customer.apk") -Force
        Write-Host ("ArenaOS-Customer.apk  {0:N1} MB -> {1}" -f ((Get-Item $apk).Length / 1MB), $downloads) -ForegroundColor Green
    }
} finally {
    Pop-Location
}
