; Script generated for CAPS Desktop Print Agent
; Inno Setup 6.x Configuration Script for Windows Installer

#define MyAppName "CAPS Desktop Print Agent"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "CAPS Engineering Team"
#define MyAppURL "https://caps.internal"
#define MyAppExeName "caps-agent.exe"
#define MyAppMutex "CAPS_Desktop_Print_Agent_Mutex"
#define MyAppId "{{A1F9B3C2-7D4E-4958-8C1B-9E3F5A6B7C8D}"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\CAPS Print Agent
DefaultGroupName=CAPS Print Agent
AllowNoIcons=yes
OutputDir=..\dist\installer
OutputBaseFilename=CAPS-Print-Agent-Setup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline dialog
CloseApplications=yes
CloseApplicationsFilter=*.exe
RestartApplications=no
AppMutex={#MyAppMutex}
UninstallDisplayIcon={app}\{#MyAppExeName}
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "autostart"; Description: "Start CAPS Print Agent automatically on Windows logon"; GroupDescription: "Startup options:"
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "..\dist\caps-agent\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
; Autostart on Windows user logon
Root: HKA; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "CAPSPrintAgent"; ValueData: """{app}\{#MyAppExeName}"""; Tasks: autostart; Flags: uninsdeletevalue
; Installation and version tracking
Root: HKA; Subkey: "Software\CAPS\PrintAgent"; ValueType: string; ValueName: "InstallPath"; ValueData: "{app}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\CAPS\PrintAgent"; ValueType: string; ValueName: "Version"; ValueData: "{#MyAppVersion}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\CAPS\PrintAgent"; ValueType: string; ValueName: "AppId"; ValueData: "{#MyAppId}"; Flags: uninsdeletekey

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Clean up runtime generated logs, spooler temp files, local cache on uninstall
Type: filesandordirs; Name: "{localappdata}\CAPS\spool"
Type: filesandordirs; Name: "{localappdata}\CAPS\logs"
Type: filesandordirs; Name: "{localappdata}\CAPS\cache"
Type: files; Name: "{app}\*.log"

[Code]
// Helper function to read command line parameters e.g. /PAIRINGCODE=123456 /SHOPID=uuid
function GetParam(ParamName: string): string;
var
  I: Integer;
  Param: string;
begin
  Result := '';
  for I := 1 to ParamCount do
  begin
    Param := ParamStr(I);
    if Pos('/' + Uppercase(ParamName) + '=', Uppercase(Param)) = 1 then
    begin
      Result := Copy(Param, Length(ParamName) + 3, Length(Param));
      Exit;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  PairingCode: string;
  ShopId: string;
  ConfigFile: string;
  ConfigContent: string;
begin
  if CurStep = ssPostInstall then
  begin
    PairingCode := GetParam('PAIRINGCODE');
    ShopId := GetParam('SHOPID');
    if (PairingCode <> '') or (ShopId <> '') then
    begin
      ConfigFile := ExpandConstant('{app}\agent_pairing.ini');
      ConfigContent := '[Pairing]' + #13#10 +
                       'ShopId=' + ShopId + #13#10 +
                       'PairingCode=' + PairingCode + #13#10 +
                       'ProvisionedAt=' + GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':');
      SaveStringToFile(ConfigFile, ConfigContent, False);
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    // Post-uninstall hooks: file cleanup handled via [UninstallDelete]
  end;
end;
