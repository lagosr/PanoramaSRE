param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$FilePath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $FilePath)) {
    Write-Error "[sign-binary] Target file not found: $FilePath"
    exit 1
}

$resolvedFile = (Resolve-Path -LiteralPath $FilePath).Path

# 1. Locate signtool.exe
$signtool = $env:SIGNTOOL_PATH
if (-not $signtool -or -not (Test-Path -LiteralPath $signtool)) {
    $sdkPaths = Get-ChildItem -Path "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending
    if ($sdkPaths -and $sdkPaths.Count -gt 0) {
        $signtool = $sdkPaths[0].FullName
    }
}

if (-not $signtool -or -not (Test-Path -LiteralPath $signtool)) {
    Write-Error "[sign-binary] Could not locate signtool.exe in Windows Kits or SIGNTOOL_PATH."
    exit 1
}

# 2. Locate Code Signing Certificate in Cert:\CurrentUser\My
$cert = $null
if ($env:PANORAMA_SIGN_THUMBPRINT) {
    $cert = Get-ChildItem -Path "Cert:\CurrentUser\My" -CodeSigningCert -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $env:PANORAMA_SIGN_THUMBPRINT } |
        Select-Object -First 1
}

if (-not $cert) {
    $cert = Get-ChildItem -Path "Cert:\CurrentUser\My" -CodeSigningCert -ErrorAction SilentlyContinue |
        Where-Object { $_.Subject -like "*PanoramaDrSuite*" -and $_.NotAfter -gt (Get-Date) } |
        Sort-Object NotAfter -Descending |
        Select-Object -First 1
}

if (-not $cert) {
    Write-Host "[sign-binary] No active PanoramaDrSuite CodeSigningCert found. Invoking Setup-CodeSigningCert.ps1..." -ForegroundColor Yellow
    $setupScript = Join-Path $PSScriptRoot "Setup-CodeSigningCert.ps1"
    & $setupScript -SkipRootPrompt | Out-Null
    $cert = Get-ChildItem -Path "Cert:\CurrentUser\My" -CodeSigningCert -ErrorAction SilentlyContinue |
        Where-Object { $_.Subject -like "*PanoramaDrSuite*" -and $_.NotAfter -gt (Get-Date) } |
        Sort-Object NotAfter -Descending |
        Select-Object -First 1
}

if (-not $cert) {
    Write-Error "[sign-binary] Failed to locate or provision a valid CodeSigningCert in Cert:\CurrentUser\My."
    exit 1
}

# 3. Sign with signtool.exe (RFC 3161 Timestamp with offline fallback)
Write-Host "[sign-binary] Signing '$resolvedFile' with thumbprint $($cert.Thumbprint)..." -ForegroundColor Cyan

$timestampUrl = "http://timestamp.digicert.com"
& $signtool sign /sha1 $cert.Thumbprint /fd sha256 /tr $timestampUrl /td sha256 /d "PanoramaSRE Control Plane" $resolvedFile 2>&1 | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "[sign-binary] Timestamp server unreachable or failed (exit $LASTEXITCODE). Retrying without timestamp..." -ForegroundColor Yellow
    & $signtool sign /sha1 $cert.Thumbprint /fd sha256 /d "PanoramaSRE Control Plane" $resolvedFile
    if ($LASTEXITCODE -ne 0) {
        Write-Error "[sign-binary] signtool.exe failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
}

# 4. Verify Authenticode signature
$sig = Get-AuthenticodeSignature -LiteralPath $resolvedFile
if ($sig.Status -eq "NotSigned") {
    Write-Error "[sign-binary] Verification failed: File remains NotSigned ($resolvedFile)"
    exit 1
}

Write-Host "[sign-binary] Signed: $resolvedFile (Status: $($sig.Status), Thumbprint: $($sig.SignerCertificate.Thumbprint))" -ForegroundColor Green
exit 0
