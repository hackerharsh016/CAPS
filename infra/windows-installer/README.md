# CAPS Windows Agent Installer & Packaging Architecture

Authoritative documentation for building, code-signing, installing, upgrading, and cleanly uninstalling the CAPS Desktop Print Agent on Windows 10/11 x64 systems.

---

## 1. Prerequisites
- **Python**: 3.11+ 64-bit with `pyinstaller` installed.
- **Inno Setup**: Version 6.x (`ISCC.exe` in `PATH` or standard Program Files / LocalAppData locations).
- **Windows OS**: Windows 10 or 11 (64-bit).

---

## 2. Directory Structure

```text
infra/windows-installer/
├── build-installer.ps1          # Automated Inno Setup packaging pipeline
├── config/
│   └── signing-policy.json     # Authenticode signature rules & verification
└── README.md                   # Packaging, deployment & troubleshooting guide

apps/print-agent/packaging/
├── agent.spec                  # PyInstaller build specification
├── version_info.txt            # Windows PE version resource metadata
└── installer.iss               # Inno Setup wizard configuration script
```

---

## 3. Building the Installer

From repository root or `infra/windows-installer/`:

```powershell
powershell -ExecutionPolicy Bypass -File infra/windows-installer/build-installer.ps1 -Clean
```

This pipeline automatically:
1. Validates `agent.spec` and runs unit test gates.
2. Compiles the standalone PyInstaller distribution into `apps/print-agent/dist/caps-agent/`.
3. Invokes `ISCC.exe` to produce `CAPS-Print-Agent-Setup-0.1.0.exe` in `apps/print-agent/dist/installer/`.
4. Computes SHA-256 cryptographic hashes and writes `installer_manifest.json`.

---

## 4. Unattended / Silent Installation Switches

The installer supports command-line switches for automated enterprise or unattended rollouts:

```cmd
CAPS-Print-Agent-Setup-0.1.0.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS="autostart" /SHOPID="11111111-1111-4111-8111-111111111111" /PAIRINGCODE="948201"
```

### Available Command-Line Parameters:
- `/VERYSILENT`: Runs the installation with no wizard UI.
- `/SUPPRESSMSGBOXES`: Suppresses modal message prompts.
- `/NORESTART`: Prevents any system reboot requests.
- `/TASKS="autostart"`: Registers the agent in `HKA\Software\Microsoft\Windows\CurrentVersion\Run` for auto-launch on user logon.
- `/TASKS="desktopicon"`: Creates a desktop shortcut.
- `/DIR="C:\Path"`: Overrides default installation destination.
- `/PAIRINGCODE=123456`: Pre-provisions a short-lived shop pairing code into `agent_pairing.ini`.
- `/SHOPID=UUID`: Pre-provisions tenant shop UUID into `agent_pairing.ini`.

---

## 5. Upgrade and Mutex Policy

- **AppMutex (`CAPS_Desktop_Print_Agent_Mutex`)**: Prevents installing while a previous instance of the daemon is actively spooling jobs.
- **CloseApplications (`yes`)**: Prompts or cleanly shuts down running agent instances before updating binaries.
- **In-place Upgrade**: Installing a newer version over an existing version preserves shop pairing credentials in `%LOCALAPPDATA%\CAPS` and updates registry version keys.

---

## 6. Uninstall & Privacy Cleanup Policy

When the agent is uninstalled via Windows Add/Remove Programs:
- Binary executable and DLLs in `{app}` are removed.
- Autostart registry keys under `Software\Microsoft\Windows\CurrentVersion\Run\CAPSPrintAgent` are deleted.
- Installation tracking keys under `Software\CAPS\PrintAgent` are deleted.
- Spooler temporary directories and logs are securely purged:
  - `{localappdata}\CAPS\spool` (all temporary PDF slices and render buffers deleted)
  - `{localappdata}\CAPS\logs` (all agent execution logs deleted)
  - `{localappdata}\CAPS\cache` (cached metadata purged)

---

## 7. Authenticode Code Signing

Per `infra/windows-installer/config/signing-policy.json`, both the internal executable (`caps-agent.exe`) and the setup wrapper (`CAPS-Print-Agent-Setup-*.exe`) must be digitally signed before customer release:

```cmd
signtool.exe sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a /d "CAPS Desktop Print Agent" dist\caps-agent\caps-agent.exe
signtool.exe sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a /d "CAPS Desktop Print Agent Installer" dist\installer\CAPS-Print-Agent-Setup-0.1.0.exe
```
