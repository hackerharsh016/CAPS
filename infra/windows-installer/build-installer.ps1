<#
.SYNOPSIS
    Builds the Inno Setup Windows installer for CAPS Desktop Print Agent.

.DESCRIPTION
    Compiles apps/print-agent/packaging/installer.iss with ISCC.exe, verifies the output
    executable, computes SHA-256 integrity checksums, and produces an installer_manifest.json.

.PARAMETER Clean
    Forces clean PyInstaller compilation prior to building installer.

.PARAMETER OutputDir
    Output directory for the final installer (defaults to apps/print-agent/dist/installer).

.PARAMETER DryRun
    Validates ISS file and parameters without running ISCC.exe.

.EXAMPLE
    .\build-installer.ps1 -Clean
#>

[CmdletBinding()]
param (
    [switch]$Clean = $false,
    [string]$OutputDir = "",
    [switch]$DryRun = $false
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$PrintAgentRoot = Join-Path $RepoRoot "apps\print-agent"
$IssFile = Join-Path $PrintAgentRoot "packaging\installer.iss"
$AppExe = Join-Path $PrintAgentRoot "dist\caps-agent\caps-agent.exe"

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $PrintAgentRoot "dist\installer"
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " CAPS Print Agent - Inno Setup Installer Build Pipeline    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Repo Root:        $RepoRoot"
Write-Host "Print Agent Root: $PrintAgentRoot"
Write-Host "Inno Script:      $IssFile"
Write-Host "Output Dir:       $OutputDir"

# 1. Verify ISS Script Exists
if (-not (Test-Path $IssFile)) {
    Write-Error "Inno Setup script not found at $IssFile"
    exit 1
}

# 2. Check if PyInstaller binary exists; compile if missing or if -Clean requested
if ($Clean -or (-not (Test-Path $AppExe))) {
    Write-Host "`n--- [Step 1/3] Compiling PyInstaller binary distribution ---" -ForegroundColor Yellow
    $BuildScript = Join-Path $PrintAgentRoot "scripts\build.ps1"
    & powershell -ExecutionPolicy Bypass -File $BuildScript $(if ($Clean) { "-Clean" })
    if ($LASTEXITCODE -ne 0) {
        Write-Error "PyInstaller build failed. Cannot assemble installer."
        exit 1
    }
} else {
    Write-Host "`n--- [Step 1/3] Using existing PyInstaller binary: $AppExe ---" -ForegroundColor Green
}

# 3. Locate ISCC.exe (Inno Setup Compiler)
$IsccCandidatePaths = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    (Get-Command ISCC.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
)

$IsccPath = $null
foreach ($path in $IsccCandidatePaths) {
    if ($path -and (Test-Path $path)) {
        $IsccPath = $path
        break
    }
}

if (-not $IsccPath) {
    if ($DryRun) {
        Write-Host "ISCC.exe not found on system, but -DryRun specified. Validation succeeded." -ForegroundColor Yellow
        exit 0
    }
    Write-Error "Inno Setup compiler (ISCC.exe) not found. Install Inno Setup 6 or run with -DryRun."
    exit 1
}

Write-Host "Using Inno Setup Compiler: $IsccPath"

if ($DryRun) {
    Write-Host "`n-DryRun enabled: Skipping compilation." -ForegroundColor Yellow
    exit 0
}

# 4. Compile Inno Setup Installer
Write-Host "`n--- [Step 2/3] Compiling Windows Installer with ISCC.exe ---" -ForegroundColor Yellow
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$IsccArgs = @(
    "/O$OutputDir",
    "/Qp",
    $IssFile
)

Write-Host "Executing: & `"$IsccPath`" $($IsccArgs -join ' ')"
& $IsccPath @IsccArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Inno Setup compilation failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}
Write-Host "Inno Setup compilation succeeded." -ForegroundColor Green

# 5. Verify Installer and Generate Manifest
Write-Host "`n--- [Step 3/3] Verifying generated installer and generating manifest ---" -ForegroundColor Yellow
$Installers = Get-ChildItem -Path $OutputDir -Filter "CAPS-Print-Agent-Setup-*.exe" | Sort-Object LastWriteTime -Descending
if ($Installers.Count -eq 0) {
    Write-Error "No installer executable found in $OutputDir matching CAPS-Print-Agent-Setup-*.exe"
    exit 1
}

$InstallerExe = $Installers[0]
$InstallerHash = (Get-FileHash -Path $InstallerExe.FullName -Algorithm SHA256).Hash

Write-Host "Found Installer:  $($InstallerExe.FullName)"
Write-Host "Installer Size:   $($InstallerExe.Length) bytes"
Write-Host "Installer SHA256: $InstallerHash"

$ManifestObject = @{
    product_name = "Cloud Automated Printing Solution (CAPS) Desktop Agent Installer"
    package_name = "caps-agent-installer"
    version = "0.1.0"
    build_timestamp_utc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    installer_file = $InstallerExe.Name
    installer_sha256 = $InstallerHash
    size_bytes = $InstallerExe.Length
    target_platform = "win32-x64"
    signing_ready = $true
}

$ManifestPath = Join-Path $OutputDir "installer_manifest.json"
$ManifestJson = $ManifestObject | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($ManifestPath, $ManifestJson, [System.Text.Encoding]::UTF8)
Write-Host "Generated installer manifest: $ManifestPath" -ForegroundColor Green

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " [SUCCESS] CAPS Windows Installer build complete!         " -ForegroundColor Green
Write-Host " Installer: $($InstallerExe.FullName)" -ForegroundColor Green
Write-Host " Manifest:  $ManifestPath" -ForegroundColor Green
Write-Host " Signing:   Ready for Authenticode signing                " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan

exit 0
