<#
.SYNOPSIS
    Builds the CAPS Desktop Print Agent into a reproducible, signed-ready Windows executable.

.DESCRIPTION
    Executes PyInstaller with pinned dependencies, embeds Windows PE version metadata,
    computes SHA-256 integrity checksums, generates build_manifest.json, and executes
    runner smoke tests to guarantee Authenticode signing readiness and execution stability.

.PARAMETER Clean
    Removes previous build/ and dist/ artifacts before compiling.

.PARAMETER OutputDir
    Custom output directory for compiled distribution (defaults to apps/print-agent/dist).

.PARAMETER SkipTests
    Skips pre-build unit test gate.

.PARAMETER SkipSmoke
    Skips post-build binary execution smoke test.

.EXAMPLE
    .\build.ps1 -Clean
#>

[CmdletBinding()]
param (
    [switch]$Clean = $false,
    [string]$OutputDir = "",
    [switch]$SkipTests = $false,
    [switch]$SkipSmoke = $false
)

$ErrorActionPreference = "Stop"

# Determine base paths
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentRoot = Split-Path -Parent $ScriptDir
$PackagingDir = Join-Path $AgentRoot "packaging"
$SpecFile = Join-Path $PackagingDir "agent.spec"
$VersionFile = Join-Path $PackagingDir "version_info.txt"

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $AgentRoot "dist"
}
$WorkDir = Join-Path $AgentRoot "build"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " CAPS Print Agent - Windows Reproducible Build Pipeline   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Agent Root:   $AgentRoot"
Write-Host "Spec File:    $SpecFile"
Write-Host "Output Dir:   $OutputDir"

# 1. Locate Python & PyInstaller
$VenvPython = Join-Path $AgentRoot ".venv\Scripts\python.exe"
$VenvPyInstaller = Join-Path $AgentRoot ".venv\Scripts\pyinstaller.exe"

if (Test-Path $VenvPython) {
    $PythonExe = $VenvPython
} else {
    $PythonExe = "python"
}

if (Test-Path $VenvPyInstaller) {
    $PyInstallerExe = $VenvPyInstaller
} else {
    $PyInstallerExe = "pyinstaller"
}

Write-Host "Using Python:      $PythonExe"
Write-Host "Using PyInstaller: $PyInstallerExe"

# 2. Pre-build quality gate
if (-not $SkipTests) {
    Write-Host "`n--- [Step 1/5] Running pre-build quality gates (pytest & ruff) ---" -ForegroundColor Yellow
    & $PythonExe -m pytest $AgentRoot -q
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Pre-build test gate failed. Aborting build."
        exit 1
    }

    & $PythonExe -m ruff check $AgentRoot
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Pre-build ruff lint gate failed. Aborting build."
        exit 1
    }
    Write-Host "Pre-build quality checks passed." -ForegroundColor Green
} else {
    Write-Host "`n--- [Step 1/5] Pre-build tests skipped (-SkipTests specified) ---" -ForegroundColor DarkGray
}

# 3. Clean prior artifacts if requested
if ($Clean) {
    Write-Host "`n--- [Step 2/5] Cleaning prior build and dist artifacts ---" -ForegroundColor Yellow
    if (Test-Path $OutputDir) {
        Remove-Item -Recurse -Force $OutputDir
        Write-Host "Removed $OutputDir"
    }
    if (Test-Path $WorkDir) {
        Remove-Item -Recurse -Force $WorkDir
        Write-Host "Removed $WorkDir"
    }
}

# Ensure Output and Work directories exist
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

# 4. Run PyInstaller build
Write-Host "`n--- [Step 3/5] Compiling binary with PyInstaller ---" -ForegroundColor Yellow
$PyInstallerArgs = @(
    $SpecFile,
    "--distpath", $OutputDir,
    "--workpath", $WorkDir,
    "--noconfirm"
)

Write-Host "Executing: $PyInstallerExe $($PyInstallerArgs -join ' ')"
& $PyInstallerExe @PyInstallerArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "PyInstaller build failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}
Write-Host "PyInstaller compilation completed successfully." -ForegroundColor Green

# 5. Verify generated artifacts
Write-Host "`n--- [Step 4/5] Verifying binary artifacts and generating manifest ---" -ForegroundColor Yellow
$TargetExe = Join-Path $OutputDir "caps-agent\caps-agent.exe"
if (-not (Test-Path $TargetExe)) {
    # Check alternate single-file path
    $TargetExe = Join-Path $OutputDir "caps-agent.exe"
}

if (-not (Test-Path $TargetExe)) {
    Write-Error "Expected executable not found in $OutputDir"
    exit 1
}

$ExeItem = Get-Item $TargetExe
$ExeHash = (Get-FileHash -Path $TargetExe -Algorithm SHA256).Hash

Write-Host "Found executable: $($ExeItem.FullName)"
Write-Host "Executable Size:  $($ExeItem.Length) bytes"
Write-Host "Executable SHA256: $ExeHash"

# Generate build manifest
$BundleDir = Split-Path -Parent $TargetExe
$AllFiles = Get-ChildItem -Path $BundleDir -Recurse -File
$FileManifest = @()
$TotalBytes = 0

foreach ($f in $AllFiles) {
    $relPath = $f.FullName.Substring($BundleDir.Length).TrimStart('\', '/')
    $hash = (Get-FileHash -Path $f.FullName -Algorithm SHA256).Hash
    $TotalBytes += $f.Length
    $FileManifest += @{
        path = $relPath
        size_bytes = $f.Length
        sha256 = $hash
    }
}

$ManifestObject = @{
    product_name = "Cloud Automated Printing Solution (CAPS) Desktop Agent"
    package_name = "caps-agent"
    version = "0.1.0"
    build_timestamp_utc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    executable = Split-Path -Leaf $TargetExe
    executable_sha256 = $ExeHash
    signing_ready = $true
    target_platform = "win32-x64"
    total_files = $AllFiles.Count
    total_size_bytes = $TotalBytes
    files = $FileManifest
}

$ManifestPath = Join-Path $OutputDir "build_manifest.json"
$ManifestJson = $ManifestObject | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($ManifestPath, $ManifestJson, [System.Text.Encoding]::UTF8)
Write-Host "Generated build manifest: $ManifestPath" -ForegroundColor Green

# 6. Post-build smoke check
if (-not $SkipSmoke) {
    Write-Host "`n--- [Step 5/5] Executing post-build binary smoke check ---" -ForegroundColor Yellow
    $SmokeOutput = & $TargetExe --smoke
    Write-Host "Output: $SmokeOutput"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Post-build binary smoke check failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }

    $VersionOutput = & $TargetExe --version
    Write-Host "Output: $VersionOutput"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Post-build binary version check failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
    Write-Host "Binary runner smoke check passed." -ForegroundColor Green
} else {
    Write-Host "`n--- [Step 5/5] Smoke check skipped (-SkipSmoke specified) ---" -ForegroundColor DarkGray
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " [SUCCESS] CAPS Windows Agent build complete!             " -ForegroundColor Green
Write-Host " Artifact: $TargetExe" -ForegroundColor Green
Write-Host " Manifest: $ManifestPath" -ForegroundColor Green
Write-Host " Signing status: Ready for Authenticode signtool.exe      " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan

exit 0
