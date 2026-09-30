; ArenaOS Station installer (Inno Setup 6).
;
; Builds ArenaOS-Station-Setup.exe: one file you run on every gaming PC. It asks
; for your ArenaOS server address and an enrolment code (Admin → Computers →
; Add stations), connects the PC to your venue, installs the agent service and
; the Gaming Shell. Re-running it on an enrolled PC updates it in place.
;
; Build it with clients\windows\package.ps1 -Installer [-ApiUrl https://api.yourvenue.com]
; (the URL is pre-filled in the wizard so staff only type the code).
;
; Unattended install (e.g. from a deployment tool), as Administrator:
;   ArenaOS-Station-Setup.exe /VERYSILENT /API=https://api.yourvenue.com /CODE=ARENA-XXXXX-XXXXX-XXXXX-XXXXX [/NAME=PC-17] [/SAFEMODE=on]
;     [/EXITUSER=staff /EXITPASS=...]   the Shift+F12 staff exit login (kept as-is on an update when left out)

#ifndef DefaultApi
  #define DefaultApi ""
#endif
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define Package "..\dist\ArenaOS-Station"

[Setup]
AppId={{6F3C2B8E-4A1D-4E7B-9C55-2D8A1E0F7B31}
AppName=ArenaOS Station
AppVersion={#AppVersion}
AppVerName=ArenaOS Station {#AppVersion}
AppPublisher=ArenaOS
DefaultDirName={autopf}\ArenaOS
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir=..\dist\installer
OutputBaseFilename=ArenaOS-Station-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
CloseApplications=no
UninstallDisplayName=ArenaOS Station
UninstallDisplayIcon={app}\Shell\ArenaShell.exe

[Messages]
WelcomeLabel2=This installs the ArenaOS station agent and the Gaming Shell on this PC and connects it to your venue.%n%nYou need your ArenaOS server address and an enrolment code from Admin → Computers → Add stations.

[Files]
; Staged in {tmp}; install-agent.ps1 copies them into Program Files\ArenaOS with locked-down ACLs.
Source: "{#Package}\Agent\*"; DestDir: "{tmp}\stage\Agent"; Flags: recursesubdirs ignoreversion
Source: "{#Package}\Shell\*"; DestDir: "{tmp}\stage\Shell"; Flags: recursesubdirs ignoreversion

[Code]
const
  IdentityFile = '{commonappdata}\ArenaOS\Agent\agent.json';
  WebView2Key = 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

var
  ModePage: TInputOptionWizardPage;
  ServerPage: TInputQueryWizardPage;
  ExitPage: TInputQueryWizardPage;
  SafeModeBox: TNewCheckBox;
  Connected: Boolean;
  ResultText: String;

function AlreadyEnrolled: Boolean;
begin
  Result := FileExists(ExpandConstant(IdentityFile));
end;

function WantsEnrol: Boolean;
begin
  Result := (not AlreadyEnrolled) or (ModePage.SelectedValueIndex = 1) or (ExpandConstant('{param:CODE|}') <> '');
end;

function TrimSlash(S: String): String;
begin
  Result := Trim(S);
  while (Length(Result) > 0) and (Result[Length(Result)] = '/') do
    Delete(Result, Length(Result), 1);
end;

function ApiUrl: String;
begin
  Result := TrimSlash(ServerPage.Values[0]);
end;

function EnrolCode: String;
begin
  Result := Uppercase(Trim(ServerPage.Values[1]));
end;

function ServerReachable(Url: String): Boolean;
var
  Http: Variant;
begin
  Result := False;
  try
    Http := CreateOleObject('WinHttp.WinHttpRequest.5.1');
    Http.SetTimeouts(5000, 5000, 8000, 8000);
    Http.Open('GET', Url + '/health', False);
    Http.Send('');
    Result := (Http.Status >= 200) and (Http.Status < 300);
  except
    Result := False;
  end;
end;

function ValidateInputs: String;
begin
  Result := '';
  if (Pos('http://', Lowercase(ApiUrl)) <> 1) and (Pos('https://', Lowercase(ApiUrl)) <> 1) then
    Result := 'The server address must start with https:// (or http:// on a local network), e.g. https://api.yourvenue.com'
  else if (Pos('ARENA-', EnrolCode) <> 1) or (Length(EnrolCode) < 20) then
    Result := 'The enrolment code looks wrong. It starts with ARENA- and is shown once in Admin → Computers → Add stations.'
  else if not ServerReachable(ApiUrl) then
    Result := 'Can''t reach ' + ApiUrl + '/health from this PC. Check the address, the internet/LAN connection and the server''s firewall.';
end;

procedure InitializeWizard;
begin
  ModePage := CreateInputOptionPage(wpWelcome,
    'This PC is already connected', 'It is enrolled with ArenaOS. What would you like to do?',
    'Updating keeps the station''s name, history and connection.', True, False);
  ModePage.Add('Update the software only (recommended)');
  ModePage.Add('Connect it again with a new enrolment code');
  ModePage.SelectedValueIndex := 0;

  ServerPage := CreateInputQueryPage(ModePage.ID,
    'Connect to your venue', 'Enter your ArenaOS server and an enrolment code.',
    'Create a code in the admin: Computers → Add stations. One code can enrol several PCs.');
  ServerPage.Add('Server address:', False);
  ServerPage.Add('Enrolment code:', False);
  ServerPage.Add('Station name (optional, e.g. PC-17 — leave empty to number automatically):', False);
  ServerPage.Values[0] := ExpandConstant('{param:API|}');
  if ServerPage.Values[0] = '' then
    ServerPage.Values[0] := '{#DefaultApi}';
  ServerPage.Values[1] := ExpandConstant('{param:CODE|}');
  ServerPage.Values[2] := ExpandConstant('{param:NAME|}');

  SafeModeBox := TNewCheckBox.Create(ServerPage);
  SafeModeBox.Parent := ServerPage.Surface;
  SafeModeBox.Top := ServerPage.Edits[2].Top + ServerPage.Edits[2].Height + ScaleY(16);
  SafeModeBox.Width := ServerPage.SurfaceWidth;
  SafeModeBox.Height := ScaleY(20);
  SafeModeBox.Caption := 'Test mode: only simulate restart, shutdown and lock';
  SafeModeBox.Checked := Lowercase(ExpandConstant('{param:SAFEMODE|off}')) = 'on';

  ExitPage := CreateInputQueryPage(ServerPage.ID,
    'Staff exit (Shift+F12)', 'The login staff use to leave the Gaming Shell for Windows.',
    'On the Gaming Shell, staff press Shift+F12 and type this username and password to close the Shell and open the Windows desktop. ' +
    'A Windows administrator account on this PC also works. On an update, leave these empty to keep the current login.');
  ExitPage.Add('Username:', False);
  ExitPage.Add('Password (at least 4 characters):', True);
  ExitPage.Add('Password again:', True);
  ExitPage.Values[0] := ExpandConstant('{param:EXITUSER|}');
  ExitPage.Values[1] := ExpandConstant('{param:EXITPASS|}');
  ExitPage.Values[2] := ExpandConstant('{param:EXITPASS|}');
end;

function ExitUser: String;
begin
  Result := Trim(ExitPage.Values[0]);
end;

function ValidateExitLogin: String;
begin
  Result := '';
  if ExitUser = '' then
  begin
    if not AlreadyEnrolled then
      Result := 'Choose a staff exit username and password. Staff need it to leave the Gaming Shell (Shift+F12).';
  end
  else if (Pos(' ', ExitUser) > 0) or (Length(ExitUser) > 64) then
    Result := 'The staff exit username can''t contain spaces.'
  else if Length(ExitPage.Values[1]) < 4 then
    Result := 'The staff exit password needs at least 4 characters.'
  else if ExitPage.Values[1] <> ExitPage.Values[2] then
    Result := 'The two staff exit passwords don''t match.';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if PageID = ModePage.ID then
    Result := not AlreadyEnrolled
  else if PageID = ServerPage.ID then
    Result := not WantsEnrol;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Err: String;
begin
  Result := True;
  if CurPageID = ServerPage.ID then
  begin
    WizardForm.NextButton.Enabled := False;
    try
      Err := ValidateInputs;
    finally
      WizardForm.NextButton.Enabled := True;
    end;
    if Err <> '' then
    begin
      MsgBox(Err, mbError, MB_OK);
      Result := False;
    end;
  end
  else if CurPageID = ExitPage.ID then
  begin
    Err := ValidateExitLogin;
    if Err <> '' then
    begin
      MsgBox(Err, mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  // Wizard pages are skipped in /SILENT and /VERYSILENT, so validate here too.
  if WizardSilent and WantsEnrol then
    Result := ValidateInputs;
  if (Result = '') and WizardSilent then
    Result := ValidateExitLogin;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  if WantsEnrol then
  begin
    Result := 'Connect to:' + NewLine + Space + ApiUrl + NewLine + NewLine + 'Enrolment code:' + NewLine + Space + EnrolCode;
    if Trim(ServerPage.Values[2]) <> '' then
      Result := Result + NewLine + NewLine + 'Station name:' + NewLine + Space + Trim(ServerPage.Values[2]);
    if SafeModeBox.Checked then
      Result := Result + NewLine + NewLine + 'Test mode (safe mode): ON';
  end
  else
    Result := 'Update the ArenaOS station software. The connection to your venue is kept.';
  if ExitUser <> '' then
    Result := Result + NewLine + NewLine + 'Staff exit (Shift+F12) username:' + NewLine + Space + ExitUser
  else
    Result := Result + NewLine + NewLine + 'Staff exit (Shift+F12): keep the current login';
end;

function RunLogged(Exe, Params, LogName: String; var Output: String): Integer;
var
  LogPath: String;
  Lines: AnsiString;
begin
  LogPath := ExpandConstant('{tmp}\' + LogName);
  if not Exec(ExpandConstant('{cmd}'), '/S /C ""' + Exe + '" ' + Params + ' > "' + LogPath + '" 2>&1"', '', SW_HIDE, ewWaitUntilTerminated, Result) then
    Result := -1;
  Output := '';
  if LoadStringFromFile(LogPath, Lines) then
    Output := Trim(String(Lines));
  Log(LogName + ' (exit ' + IntToStr(Result) + '):' + #13#10 + Output);
end;

function Enrol(var Output: String): Boolean;
var
  Params: String;
begin
  Params := 'enroll --api "' + ApiUrl + '" --code "' + EnrolCode + '"';
  if Trim(ServerPage.Values[2]) <> '' then
    Params := Params + ' --name "' + Trim(ServerPage.Values[2]) + '"';
  if SafeModeBox.Checked then
    Params := Params + ' --safe-mode on'
  else
    Params := Params + ' --safe-mode off';
  WizardForm.StatusLabel.Caption := 'Connecting this PC to ' + ApiUrl + '...';
  Result := RunLogged(ExpandConstant('{tmp}\stage\Agent\ArenaAgent.exe'), Params, 'enroll.log', Output) = 0;
end;

// Lets staff fix a mistyped or expired code without restarting the installer.
function AskForNewCode(Reason: String): Boolean;
var
  Form: TSetupForm;
  Info: TNewStaticText;
  UrlEdit, CodeEdit: TNewEdit;
  Ok, Cancel: TNewButton;
begin
  Form := CreateCustomForm(ScaleX(460), ScaleY(260), False, True);
  try
    Form.Caption := 'Couldn''t connect this PC';
    Info := TNewStaticText.Create(Form);
    Info.Parent := Form;
    Info.Left := ScaleX(16); Info.Top := ScaleY(14); Info.Width := Form.ClientWidth - ScaleX(32);
    Info.AutoSize := False; Info.WordWrap := True; Info.Height := ScaleY(90);
    Info.Caption := Reason + #13#10#13#10 + 'Check the server address, or create a new code in Admin → Computers → Add stations.';
    UrlEdit := TNewEdit.Create(Form);
    UrlEdit.Parent := Form; UrlEdit.Left := ScaleX(16); UrlEdit.Top := ScaleY(112); UrlEdit.Width := Form.ClientWidth - ScaleX(32);
    UrlEdit.Text := ApiUrl;
    CodeEdit := TNewEdit.Create(Form);
    CodeEdit.Parent := Form; CodeEdit.Left := ScaleX(16); CodeEdit.Top := ScaleY(146); CodeEdit.Width := Form.ClientWidth - ScaleX(32);
    CodeEdit.Text := EnrolCode;
    Ok := TNewButton.Create(Form);
    Ok.Parent := Form; Ok.Caption := 'Try again'; Ok.ModalResult := mrOk; Ok.Default := True;
    Ok.Width := ScaleX(100); Ok.Height := ScaleY(26); Ok.Top := Form.ClientHeight - ScaleY(40); Ok.Left := Form.ClientWidth - ScaleX(224);
    Cancel := TNewButton.Create(Form);
    Cancel.Parent := Form; Cancel.Caption := 'Skip'; Cancel.ModalResult := mrCancel; Cancel.Cancel := True;
    Cancel.Width := ScaleX(100); Cancel.Height := ScaleY(26); Cancel.Top := Ok.Top; Cancel.Left := Form.ClientWidth - ScaleX(116);
    Form.ActiveControl := CodeEdit;
    Result := Form.ShowModal = mrOk;
    if Result then
    begin
      ServerPage.Values[0] := UrlEdit.Text;
      ServerPage.Values[1] := CodeEdit.Text;
    end;
  finally
    Form.Free;
  end;
end;

// Username and password go to the agent on stdin from a temp file (never on a command line), then the file is deleted.
function SaveExitLogin(var Output: String): Boolean;
var
  F: String;
begin
  Result := True;
  if ExitUser = '' then Exit;
  F := ExpandConstant('{tmp}\exit-login.txt');
  SaveStringToFile(F, ExitUser + #13#10 + ExitPage.Values[1] + #13#10, False);
  try
    Result := RunLogged(ExpandConstant('{app}\Agent\ArenaAgent.exe'), 'staff-exit < "' + F + '"', 'staff-exit.log', Output) = 0;
  finally
    DeleteFile(F);
  end;
end;

function HasWebView2: Boolean;
var
  V: String;
begin
  Result := (RegQueryStringValue(HKLM, WebView2Key, 'pv', V) and (V <> '') and (V <> '0.0.0.0'))
    or (RegQueryStringValue(HKCU, WebView2Key, 'pv', V) and (V <> '') and (V <> '0.0.0.0'));
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Output, InstallOut: String;
  Code: Integer;
begin
  if CurStep <> ssPostInstall then Exit;

  Connected := not WantsEnrol;
  if WantsEnrol then
  begin
    Connected := Enrol(Output);
    while (not Connected) and (not WizardSilent) and AskForNewCode(Output) do
      Connected := Enrol(Output);
  end;

  if not Connected then
  begin
    ResultText := 'The software was copied but this PC is NOT connected to ArenaOS:' + #13#10 + Output + #13#10#13#10 + 'Run the installer again with a valid enrolment code.';
    Exit;
  end;

  WizardForm.StatusLabel.Caption := 'Installing the station service and Gaming Shell...';
  Code := RunLogged('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\stage\Agent\install-agent.ps1') + '"', 'install.log', InstallOut);
  if Code <> 0 then
  begin
    Connected := False;
    ResultText := 'This PC enrolled, but installing the service failed:' + #13#10 + InstallOut;
    Exit;
  end;

  if not SaveExitLogin(InstallOut) then
    ResultText := 'WARNING: the staff exit login was not saved: ' + InstallOut + #13#10#13#10;

  ResultText := ResultText + Output;
  if Output = '' then ResultText := ResultText + 'This PC is connected.';
  ResultText := ResultText + #13#10#13#10 + 'It should appear on the Live Floor within a few seconds. The Gaming Shell starts full-screen when a standard (non-administrator) Windows user signs in.';
  if not HasWebView2 then
    ResultText := ResultText + #13#10#13#10 + 'WARNING: Microsoft Edge WebView2 Runtime is missing. Install it (Evergreen) or the Gaming Shell won''t open: https://developer.microsoft.com/microsoft-edge/webview2/';
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
  begin
    if Connected then
      WizardForm.FinishedHeadingLabel.Caption := 'This PC is ready'
    else
      WizardForm.FinishedHeadingLabel.Caption := 'Not connected yet';
    WizardForm.FinishedLabel.Caption := ResultText;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Params: String;
  Code: Integer;
begin
  if CurUninstallStep <> usUninstall then Exit;
  Params := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\Agent\uninstall-agent.ps1') + '"';
  if (not UninstallSilent) and (MsgBox('Also forget this PC''s connection to ArenaOS (its identity and key)?' + #13#10 +
      'Choose No if you''ll reinstall and want to keep the same station.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES) then
    Params := Params + ' -Purge';
  Exec('powershell.exe', Params, '', SW_HIDE, ewWaitUntilTerminated, Code);
end;
