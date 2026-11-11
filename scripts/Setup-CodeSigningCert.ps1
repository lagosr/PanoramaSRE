param(
    [switch]$Force,
    [switch]$SkipRootPrompt,
    [string]$Subject = "CN=PanoramaDrSuite, O=PanoramaDrSuite"
)

$ErrorActionPreference = "Stop"

Write-Host "[Setup-CodeSigningCert] Checking Cert:\CurrentUser\My for valid code signing certificate..." -ForegroundColor Cyan

$existingCerts = Get-ChildItem -Path "Cert:\CurrentUser\My" -CodeSigningCert -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -like "*CN=PanoramaDrSuite*" -and $_.NotAfter -gt (Get-Date).AddDays(30) } |
    Sort-Object NotAfter -Descending

$cert = $null
if ($existingCerts -and -not $Force) {
    $cert = $existingCerts[0]
    Write-Host "[Setup-CodeSigningCert] Found existing valid certificate: $($cert.Thumbprint) (Expires: $($cert.NotAfter.ToString('yyyy-MM-dd')))" -ForegroundColor Green
} else {
    Write-Host "[Setup-CodeSigningCert] Generating new 4096-bit RSA SHA256 self-signed CodeSigningCert..." -ForegroundColor Yellow
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $Subject `
        -FriendlyName "PanoramaDrSuite Internal Code Signing" `
        -KeyAlgorithm RSA `
        -KeyLength 4096 `
        -HashAlgorithm SHA256 `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -NotAfter (Get-Date).AddYears(5) `
        -KeyUsage DigitalSignature `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")

    Write-Host "[Setup-CodeSigningCert] Created certificate: $($cert.Thumbprint)" -ForegroundColor Green
}

$certsDir = Join-Path (Resolve-Path "$PSScriptRoot\..").Path "certs"
if (-not (Test-Path $certsDir)) {
    New-Item -ItemType Directory -Path $certsDir -Force | Out-Null
}

$cerPath = Join-Path $certsDir "PanoramaDrSuite-CodeSigning.cer"
Export-Certificate -Cert $cert -FilePath $cerPath -Force | Out-Null
Write-Host "[Setup-CodeSigningCert] Exported public certificate (.cer) to: $cerPath" -ForegroundColor Cyan

# Ensure presence in CurrentUser\TrustedPublisher (never prompts UI)
$inTrustedPublisher = Get-ChildItem -Path "Cert:\CurrentUser\TrustedPublisher" -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $cert.Thumbprint }

if (-not $inTrustedPublisher) {
    Write-Host "[Setup-CodeSigningCert] Importing certificate into Cert:\CurrentUser\TrustedPublisher..." -ForegroundColor Yellow
    Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\CurrentUser\TrustedPublisher" | Out-Null
} else {
    Write-Host "[Setup-CodeSigningCert] Certificate already present in Cert:\CurrentUser\TrustedPublisher" -ForegroundColor Green
}

# Check presence in CurrentUser\Root
$inRoot = Get-ChildItem -Path "Cert:\CurrentUser\Root" -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $cert.Thumbprint }

if ($inRoot) {
    Write-Host "[Setup-CodeSigningCert] Certificate already present in Cert:\CurrentUser\Root" -ForegroundColor Green
} elseif ($SkipRootPrompt) {
    Write-Host "[Setup-CodeSigningCert] Skipping interactive Cert:\CurrentUser\Root prompt (-SkipRootPrompt specified)." -ForegroundColor Yellow
    Write-Host "[Setup-CodeSigningCert] NOTE: To trust this self-signed Root CA in Windows, run:" -ForegroundColor Yellow
    Write-Host "  certutil -user -addstore Root `"$cerPath`"" -ForegroundColor Cyan
    Write-Host "  (and click 'Yes' on the Windows Security dialog)" -ForegroundColor Yellow
} else {
    Write-Host "[Setup-CodeSigningCert] Importing certificate into Cert:\CurrentUser\Root (Accept the Windows Security prompt if shown)..." -ForegroundColor Yellow
    Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\CurrentUser\Root" | Out-Null
}

Write-Host "[Setup-CodeSigningCert] Summary:" -ForegroundColor Cyan
Write-Host "  Subject    : $($cert.Subject)"
Write-Host "  Thumbprint : $($cert.Thumbprint)"
Write-Host "  NotBefore  : $($cert.NotBefore.ToString('yyyy-MM-dd HH:mm:ss'))"
Write-Host "  NotAfter   : $($cert.NotAfter.ToString('yyyy-MM-dd HH:mm:ss'))"
Write-Host "  CER File   : $cerPath"

return $cert.Thumbprint
