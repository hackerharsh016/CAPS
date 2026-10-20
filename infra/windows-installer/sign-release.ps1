<#
.SYNOPSIS
    Automates Windows Authenticode digital code-signing and timestamping for CAPS Print Agent releases.

.DESCRIPTION
    Signs caps-agent.exe and CAPS-Print-Agent-Setup-*.exe using signtool.exe or Set-AuthenticodeSignature.
    Applies SHA-256 digests and RFC 3161 timestamps to ensure long-term validity even after certificate expiry.
    Validates output signatures and reports detailed verification status.

.PARAMETER Path
    Path to file or folder containing target binaries to sign.

.PARAMETER CertThumbprint
    SHA-1/SHA-256 thumbprint of code signing certificate installed in Windows Certificate Store.

.PARAMETER PfxPath
    Path to .pfx certificate file (if not using certificate store or HSM).

.PARAMETER PfxPassword
    Password for .pfx file. If omitted, reads from $env:SIGNING_CERT_PASSWORD.

.PARAMETER TimestampUrl
    RFC 3161 timestamping authority URL (defaults to http://timestamp.digicert.com).

.PARAMETER Verify
    Verifies Authenticode signature immediately after signing.

.PARAMETER DryRun
    Validates signing configuration and targets without applying digital signatures.

.EXAMPLE
    .\sign-release.ps1 -Path "apps\print-agent\dist\installer\CAPS-Print-Agent-Setup-0.1.0.exe" -CertThumbprint "ABCD1234..." -Verify
#>

[CmdletBinding()]
param (
    [string]$Path = "",
    [string]$CertThumbprint = "",
    [string]$PfxPath = "",
    [string]$PfxPassword = "",
    [string]$TimestampUrl = "http://timestamp.digicert.com",
    [switch]$Verify = $true,
    [switch]$DryRun = $false
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$DefaultDist = Join-Path $RepoRoot "apps\print-agent\dist"

if ([string]::IsNullOrWhiteSpace($Path)) {
    $Path = $DefaultDist
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " CAPS Windows Agent - Authenticode Code-Signing Pipeline   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Target Path:    $Path"
Write-Host "Timestamp URL:  $TimestampUrl"

# Resolve targets
$TargetFiles = @()
if (Test-Path $Path) {
    if ((Get-Item $Path) -is [System.IO.DirectoryInfo]) {
        $TargetFiles = Get-ChildItem -Path $Path -Recurse -Include "*.exe", "*.dll"
    } else {
        $TargetFiles = @(Get-Item $Path)
    }
} else {
    Write-Error "Target path not found: $Path"
    exit 1
}

if ($TargetFiles.Count -eq 0) {
    Write-Warning "No .exe or .dll targets found in $Path"
    exit 0
}

Write-Host "Found $($TargetFiles.Count) target binary/binaries to sign:"
foreach ($t in $TargetFiles) {
    Write-Host "  - $($t.FullName)"
}

if ($DryRun) {
    Write-Host "`n[DryRun] Verification mode enabled: Skipping cryptographic signing." -ForegroundColor Yellow
    exit 0
}

# Check certificate source
if ([string]::IsNullOrWhiteSpace($PfxPassword) -and -not [string]::IsNullOrWhiteSpace($env:SIGNING_CERT_PASSWORD)) {
    $PfxPassword = $env:SIGNING_CERT_PASSWORD
}

# Locate signtool.exe from Windows SDK if available
$SigntoolPaths = @(
    "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe",
    "C:\Program Files\Windows Kits\10\bin\*\x64\signtool.exe"
)
$Signtool = $null
foreach ($p in $SigntoolPaths) {
    $found = Get-Item -Path $p -ErrorAction SilentlyContinue | Sort-Object FullName -Descending
    if ($found -and $found.Count -gt 0) {
        $Signtool = $found[0].FullName
        break
    }
}

# Perform signing
$SignedCount = 0
foreach ($file in $TargetFiles) {
    Write-Host "`nSigning: $($file.Name)..." -ForegroundColor Yellow

    if ($Signtool -and (Test-Path $Signtool)) {
        $SignArgs = @("sign", "/fd", "SHA256", "/tr", $TimestampUrl, "/td", "SHA256", "/d", "CAPS Desktop Print Agent")

        if (-not [string]::IsNullOrWhiteSpace($CertThumbprint)) {
            $SignArgs += @("/sha1", $CertThumbprint)
        } elseif (-not [string]::IsNullOrWhiteSpace($PfxPath) -and (Test-Path $PfxPath)) {
            $SignArgs += @("/f", $PfxPath)
            if (-not [string]::IsNullOrWhiteSpace($PfxPassword)) {
                $SignArgs += @("/p", $PfxPassword)
            }
        } else {
            Write-Warning "No certificate thumbprint or PFX provided. Skipping signtool invocation (unsigned test build)."
            continue
        }

        $SignArgs += $file.FullName
        & $Signtool @SignArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Error "signtool.exe failed on $($file.FullName) with exit code $LASTEXITCODE"
            exit $LASTEXITCODE
        }
        $SignedCount++
    } else {
        # Fallback to Set-AuthenticodeSignature if certificate object available in store
        if (-not [string]::IsNullOrWhiteSpace($CertThumbprint)) {
            $Cert = Get-Item -Path "Cert:\CurrentUser\My\$CertThumbprint" -ErrorAction SilentlyContinue
            if (-not $Cert) {
                $Cert = Get-Item -Path "Cert:\LocalMachine\My\$CertThumbprint" -ErrorAction SilentlyContinue
            }

            if ($Cert) {
                Set-AuthenticodeSignature -FilePath $file.FullName -Certificate $Cert -TimestampServer $TimestampUrl -HashAlgorithm "SHA256" | Out-Null
                $SignedCount++
            } else {
                Write-Warning "Certificate with thumbprint '$CertThumbprint' not found in store."
            }
        } else {
            Write-Warning "No signing certificate supplied or signtool.exe unavailable. Build remains UNTRUSTED/UNSIGNED."
        }
    }

    # Verify signature if requested
    if ($Verify) {
        $sig = Get-AuthenticodeSignature -LiteralPath $file.FullName
        Write-Host "  Signature Status: $($sig.Status)" -ForegroundColor $(if ($sig.Status -eq 'Valid') { 'Green' } else { 'DarkYellow' })
        Write-Host "  Signer Subject:   $(if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { 'None' })"
        Write-Host "  Has Timestamp:    $([bool]$sig.TimeStamperCertificate)"
        if ($sig.Status -ne 'Valid') {
            Write-Warning "Binary '$($file.Name)' is NOT trusted (Status: $($sig.Status)). Test builds are labeled UNTRUSTED."
        }
    }
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " Code signing procedure complete. ($SignedCount signed)" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
exit 0
