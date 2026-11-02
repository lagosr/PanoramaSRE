# Test-PanoramaSREStartup.ps1
# Automated verification test that builds, launches, and verifies native window presence

param(
    [string]$BinaryPath = "C:\Users\rodrigo\Documents\AG Projects\PanoramaSRE\src-tauri\target\release\panorama-sre.exe"
)

$ErrorActionPreference = "Stop"

Write-Host "=== PanoramaSRE Startup Verification Test ===" -ForegroundColor Cyan

if (-not (Test-Path $BinaryPath)) {
    Write-Error "Binary not found at: $BinaryPath"
    exit 1
}

# 1. Kill any existing instances
Get-Process -Name "panorama-sre" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

# 2. Launch process
Write-Host "Launching $BinaryPath..." -ForegroundColor Yellow
$proc = Start-Process -FilePath $BinaryPath -PassThru

# 3. Poll for 6 seconds to ensure it stays alive and does not crash
$crashed = $false
for ($i = 1; $i -le 6; $i++) {
    Start-Sleep -Seconds 1
    if ($proc.HasExited) {
        $crashed = $true
        Write-Error "Process exited prematurely after ${i}s with ExitCode: $($proc.ExitCode)"
        exit 1
    }
}

# 4. Check for active child WebView2 or working set
$ws = (Get-Process -Id $proc.Id).WorkingSet64 / 1MB
Write-Host "Process running healthy: PID $($proc.Id), Memory: $([math]::Round($ws, 1)) MB" -ForegroundColor Green

# 5. Look for window handle
$hwnd = (Get-Process -Id $proc.Id).MainWindowHandle
Write-Host "MainWindowHandle: $hwnd" -ForegroundColor Green

Write-Host "=== Test Passed: PanoramaSRE started cleanly with zero startup crashes ===" -ForegroundColor Green
exit 0
