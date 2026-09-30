<#
  Turns this PC into a kiosk: Windows signs in to a standard "Player" account
  automatically, and Player gets the Gaming Shell INSTEAD of Explorer (no Start
  menu, no taskbar, the Windows key does nothing). Administrator accounts are
  untouched and keep the normal desktop, which is how staff do maintenance:
  Ctrl+Alt+Del -> Sign out, then sign in with an admin account.

  Run as Administrator, after install-agent.ps1:
    .\setup-player.ps1               # asks for the Player password
    .\setup-player.ps1 -Password <player password>
    .\setup-player.ps1 -Off          # stop signing in automatically, give Player Explorer back

  Hold Shift while Windows starts to skip the automatic sign-in once.
#>
#Requires -RunAsAdministrator
param([string]$User = "Player", [string]$Password, [switch]$Off)
$ErrorActionPreference = "Stop"
$winlogon = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
$shellExe = Join-Path $env:ProgramFiles "ArenaOS\Shell\ArenaShell.exe"

# Runs $action against the user's registry hive (HKU\<sid> or a temporarily loaded NTUSER.DAT).
function With-UserHive($sid, [scriptblock]$action) {
    if (Test-Path "Registry::HKEY_USERS\$sid") { & $action "Registry::HKEY_USERS\$sid"; return }
    $profilePath = (Get-CimInstance Win32_UserProfile -Filter "SID='$sid'").LocalPath
    reg.exe load "HKU\ArenaKiosk" (Join-Path $profilePath "NTUSER.DAT") | Out-Null
    try { & $action "Registry::HKEY_USERS\ArenaKiosk" }
    finally { [GC]::Collect(); [GC]::WaitForPendingFinalizers(); reg.exe unload "HKU\ArenaKiosk" | Out-Null }
}

$account = Get-LocalUser $User -ErrorAction SilentlyContinue

if ($Off) {
    Set-ItemProperty $winlogon AutoAdminLogon "0"
    Remove-ItemProperty $winlogon DefaultPassword -ErrorAction SilentlyContinue
    if ($account -and (Get-CimInstance Win32_UserProfile -Filter "SID='$($account.SID)'")) {
        With-UserHive $account.SID { param($hive) Remove-ItemProperty "$hive\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" Shell -ErrorAction SilentlyContinue }
    }
    Write-Host "Automatic sign-in off; $User gets the normal desktop again at next sign-in." -ForegroundColor Green
    return
}

if (-not $Password) {
    $Password = [Net.NetworkCredential]::new("", (Read-Host "Password for the $User account" -AsSecureString)).Password
    if (-not $Password) { throw "A password is required for the $User account." }
}
if (-not (Test-Path $shellExe)) { throw "Gaming Shell not found at $shellExe. Run install-agent.ps1 first." }
$secure = ConvertTo-SecureString $Password -AsPlainText -Force

if ($account) {
    if (Get-LocalGroupMember -SID "S-1-5-32-544" | Where-Object SID -eq $account.SID) {
        throw "$User is an administrator. The kiosk account must be a standard user."
    }
    Set-LocalUser $User -Password $secure -PasswordNeverExpires $true
} else {
    $account = New-LocalUser $User -Password $secure -PasswordNeverExpires -UserMayNotChangePassword -Description "ArenaOS gaming station"
    Add-LocalGroupMember -SID "S-1-5-32-545" -Member $User   # Users
}

# The per-user shell lives in Player's own hive, which only exists after a first sign-in.
if (-not (Get-CimInstance Win32_UserProfile -Filter "SID='$($account.SID)'")) {
    $cred = New-Object PSCredential(".\$User", $secure)
    Start-Process cmd.exe "/c exit" -Credential $cred -LoadUserProfile -WindowStyle Hidden -Wait
}
With-UserHive $account.SID {
    param($hive)
    $key = "$hive\Software\Microsoft\Windows NT\CurrentVersion\Winlogon"
    New-Item $key -Force | Out-Null
    Set-ItemProperty $key Shell "`"$shellExe`" --kiosk"
}

# ponytail: DefaultPassword is plain text in HKLM (readable by local users). It's only Player's own
# password, so nothing is gained by reading it; switch to an LSA secret (Sysinternals Autologon) if that changes.
Set-ItemProperty $winlogon AutoAdminLogon "1"
Set-ItemProperty $winlogon DefaultUserName $User
Set-ItemProperty $winlogon DefaultDomainName $env:COMPUTERNAME
Set-ItemProperty $winlogon DefaultPassword $Password
Remove-ItemProperty $winlogon AutoLogonCount -ErrorAction SilentlyContinue
# Windows 11 ignores automatic sign-in while "Windows Hello sign-in only" is on.
$pwless = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\PasswordLess\Device"
if (Test-Path $pwless) { Set-ItemProperty $pwless DevicePasswordLessBuildVersion 0 }

Write-Host "Done. After a restart Windows signs in to $User and shows only the Gaming Shell." -ForegroundColor Green
Write-Host "Staff: Ctrl+Alt+Del -> Sign out, then sign in as an administrator for the normal desktop." -ForegroundColor Green
