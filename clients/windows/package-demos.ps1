<#
  Builds the downloadable desktop demos:
    ArenaOS-Shell-Demo.exe   the Gaming Shell in a normal window (not locked down)
    ArenaOS-Console.exe      venue admin + Super Admin (built-in demo, or connect to a real server)

  Each is one self-contained EXE (no .NET install needed; uses the WebView2
  runtime that Windows 11 already has) with its demo site inside.

    .\clients\windows\package-demos.ps1            # builds the demo sites first
    .\clients\windows\package-demos.ps1 -SkipWeb   # reuse apps\website\live\

  Output: clients\windows\dist\demos\ and apps\website\downloads\ (served by the website).
#>
param([switch]$SkipWeb)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem, System.Drawing

$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$project = Join-Path $PSScriptRoot "src\Arena.DemoHost"
$live = Join-Path $repo "apps\website\live"
$downloads = Join-Path $repo "apps\website\downloads"
$dist = Join-Path $PSScriptRoot "dist\demos"

function New-ArenaIcon([string]$path) {
    # 256 px PNG wrapped in an .ico (Windows Vista+ reads PNG icons).
    $size = 256
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = "AntiAlias"; $g.TextRenderingHint = "AntiAliasGridFit"
    $rect = New-Object System.Drawing.Rectangle 8, 8, 240, 240
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = 64
    $gp.AddArc($rect.X, $rect.Y, $r, $r, 180, 90); $gp.AddArc($rect.Right - $r, $rect.Y, $r, $r, 270, 90)
    $gp.AddArc($rect.Right - $r, $rect.Bottom - $r, $r, $r, 0, 90); $gp.AddArc($rect.X, $rect.Bottom - $r, $r, $r, 90, 90); $gp.CloseFigure()
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 124, 77, 255)), ([System.Drawing.Color]::FromArgb(255, 46, 230, 246)), 35
    $blend = New-Object System.Drawing.Drawing2D.ColorBlend 3
    $blend.Colors = @([System.Drawing.Color]::FromArgb(255, 124, 77, 255), [System.Drawing.Color]::FromArgb(255, 160, 124, 255), [System.Drawing.Color]::FromArgb(255, 46, 230, 246))
    $blend.Positions = @(0.0, 0.45, 1.0)
    $brush.InterpolationColors = $blend
    $g.FillPath($brush, $gp)
    $font = New-Object System.Drawing.Font "Segoe UI", 150, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = "Center"; $fmt.LineAlignment = "Center"
    $g.DrawString("A", $font, (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 11, 7, 23))), (New-Object System.Drawing.RectangleF 8, 14, 240, 240), $fmt)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    $png = $ms.ToArray()
    $fs = [System.IO.File]::Create($path); $w = New-Object System.IO.BinaryWriter $fs
    $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)                       # ICONDIR
    $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0)           # 256x256, no palette
    $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$png.Length); $w.Write([uint32]22)
    $w.Write($png); $w.Close()
}

function New-SiteZip([string]$app, [string]$sub) {
    $src = Join-Path $live $sub
    if (-not (Test-Path (Join-Path $src "index.html")) -and -not (Test-Path (Join-Path $src "login\index.html"))) { throw "Missing $src - run npm run build:demos" }
    $zipPath = Join-Path $project "obj\site-$app.zip"
    New-Item -ItemType Directory -Force (Split-Path $zipPath) | Out-Null
    if (Test-Path $zipPath) { Remove-Item $zipPath }
    $zip = [System.IO.Compression.ZipFile]::Open($zipPath, "Create")
    try {
        Get-ChildItem $src -Recurse -File | ForEach-Object {
            $rel = $_.FullName.Substring($src.Length).TrimStart('\').Replace('\', '/')
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, "live/$sub/$rel", "Optimal")
        }
    } finally { $zip.Dispose() }
    Write-Host ("  site-{0}.zip  {1:N1} MB" -f $app, ((Get-Item $zipPath).Length / 1MB))
}

Push-Location $repo
try {
    if (-not $SkipWeb) {
        Write-Host "Building the live demo sites..." -ForegroundColor Cyan
        node scripts/build-demos.mjs admin shell
        if ($LASTEXITCODE) { throw "Demo site build failed" }
    }
    $ico = Join-Path $project "arena.ico"
    if (-not (Test-Path $ico)) { New-ArenaIcon $ico; Write-Host "  created arena.ico" }

    New-Item -ItemType Directory -Force $dist, $downloads | Out-Null
    foreach ($a in @(@{ App = "Shell"; Sub = "shell"; Exe = "ArenaOS-Shell-Demo.exe" }, @{ App = "Console"; Sub = "admin"; Exe = "ArenaOS-Console.exe" })) {
        Write-Host "Packing $($a.Exe)..." -ForegroundColor Cyan
        New-SiteZip $a.App $a.Sub
        $out = Join-Path $dist $a.App
        dotnet publish $project -c Release "-p:DemoApp=$($a.App)" -o $out --nologo
        if ($LASTEXITCODE) { throw "$($a.Exe) publish failed" }
        Copy-Item (Join-Path $out $a.Exe) (Join-Path $downloads $a.Exe) -Force
        Write-Host ("  {0}  {1:N0} MB" -f $a.Exe, ((Get-Item (Join-Path $downloads $a.Exe)).Length / 1MB)) -ForegroundColor Green
    }
} finally {
    Pop-Location
}
Write-Host "Desktop demos ready in $downloads" -ForegroundColor Green
