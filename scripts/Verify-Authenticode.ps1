$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$targets = @()

$mainExe = Join-Path $repoRoot "src-tauri\target\release\panorama-sre.exe"
if (Test-Path -LiteralPath $mainExe) {
    $mainSig = Get-AuthenticodeSignature -LiteralPath $mainExe
    if ($mainSig.Status -eq "NotSigned") {
        Write-Host "[Verify-Authenticode] Signing restored standalone binary '$mainExe'..." -ForegroundColor Yellow
        & "$PSScriptRoot\sign-binary.ps1" $mainExe
    }
    $targets += $mainExe
}

$nsisDir = Join-Path $repoRoot "src-tauri\target\release\bundle\nsis"
if (Test-Path -LiteralPath $nsisDir) {
    $installers = Get-ChildItem -Path $nsisDir -Filter "PanoramaSRE_*_x64-setup.exe" | Sort-Object LastWriteTime -Descending
    if ($installers -and $installers.Count -gt 0) {
        $targets += $installers[0].FullName
    }
}

if ($targets.Count -eq 0) {
    Write-Error "[Verify-Authenticode] No built artifacts found under src-tauri\target\release."
    exit 1
}

$allValid = $true
foreach ($file in $targets) {
    $sig = Get-AuthenticodeSignature -LiteralPath $file
    $thumbprint = if ($sig.SignerCertificate) { $sig.SignerCertificate.Thumbprint } else { "NONE" }
    $subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { "NONE" }

    $inTrustedPublisher = $false
    $inRoot = $false
    if ($thumbprint -ne "NONE") {
        $inTrustedPublisher = [bool](Get-ChildItem -Path "Cert:\CurrentUser\TrustedPublisher" -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $thumbprint })
        $inRoot = [bool](Get-ChildItem -Path "Cert:\CurrentUser\Root" -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $thumbprint })
    }

    $isSignedBySuite = ($sig.Status -eq "Valid") -or (
        ($sig.Status -eq "UnknownError" -or $sig.Status -eq "UntrustedRoot") -and
        ($subject -like "*CN=PanoramaDrSuite*") -and
        $inTrustedPublisher
    )

    Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "Artifact         : $(Split-Path $file -Leaf)" -ForegroundColor Cyan
    Write-Host "Path             : $file"
    Write-Host "Status           : $($sig.Status)" -ForegroundColor $(if ($sig.Status -eq "Valid") { "Green" } elseif ($isSignedBySuite) { "Yellow" } else { "Red" })
    Write-Host "StatusMessage    : $($sig.StatusMessage)"
    Write-Host "Thumbprint       : $thumbprint"
    Write-Host "Subject          : $subject"
    Write-Host "TrustedPublisher : $inTrustedPublisher"
    Write-Host "RootCA Installed : $inRoot"

    if (-not $isSignedBySuite) {
        $allValid = $false
    }
}
Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray

if (-not $allValid) {
    Write-Error "[Verify-Authenticode] One or more artifacts failed Authenticode signature verification."
    exit 1
}

Write-Host "[Verify-Authenticode] All built artifacts carry verified PanoramaDrSuite Authenticode signatures." -ForegroundColor Green
exit 0
