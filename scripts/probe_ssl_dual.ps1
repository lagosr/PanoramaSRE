<#
.SYNOPSIS
    High-performance SSL Certificate Dual-Probe & Drift Engine for PanoramaSRE.
.DESCRIPTION
    Concurrently probes local X.509 certificate staging files and live network TLS handshakes
    on port 443 across all home lab appliances defined in config.json.
    Emits a clean JSON object conforming to SslFleetSummary.
#>

param(
    [string]$ConfigPath = "",
    [string]$BaseOutputFolder = "",
    [int]$TimeoutMs = 3000
)

$ErrorActionPreference = "SilentlyContinue"

# 1. Resolve Config Path
if (-not $ConfigPath -or -not (Test-Path $ConfigPath)) {
    $PotentialPaths = @(
        "$PSScriptRoot\..\..\PanoramaDrSuite\tools\ssl-cert-manager\config.json",
        "$env:USERPROFILE\Documents\AG Projects\PanoramaDrSuite\tools\ssl-cert-manager\config.json",
        "C:\Users\rodrigo\Documents\AG Projects\PanoramaDrSuite\tools\ssl-cert-manager\config.json"
    )
    foreach ($p in $PotentialPaths) {
        if (Test-Path $p) {
            $ConfigPath = (Resolve-Path $p).Path
            break
        }
    }
}

$Config = $null
if ($ConfigPath -and (Test-Path $ConfigPath)) {
    try {
        $Config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
    } catch {
        $Config = $null
    }
}

# 2. Resolve Base Output Folder
if (-not $BaseOutputFolder) {
    if ($Config -and $Config.BaseOutputFolder) {
        $rawBase = $Config.BaseOutputFolder -replace '\$env:USERPROFILE', $env:USERPROFILE
        $BaseOutputFolder = [System.Environment]::ExpandEnvironmentVariables($rawBase)
    } else {
        $BaseOutputFolder = "$env:USERPROFILE\Documents\WebServicesCertificates"
    }
}

# 3. Known appliance device list (derived from config or canonical defaults)
$DeviceDefinitions = @(
    @{
        Key = "WebServicesHost"
        DisplayName = "Web Services Host (DietPi)"
        Domain = if ($Config.Devices.WebServicesHost.Domain) { $Config.Devices.WebServicesHost.Domain } else { "wsh.panoramadr.com" }
        DeployTargetType = "SSH_SCP (/etc/lighttpd-certs + Reload)"
    },
    @{
        Key = "Network_CloudKey"
        DisplayName = "UniFi CloudKey"
        Domain = if ($Config.Devices.Network_CloudKey.Domain) { $Config.Devices.Network_CloudKey.Domain } else { "ui.panoramadr.com" }
        DeployTargetType = "LOCAL_VERIFY"
    },
    @{
        Key = "Protect_UNVR"
        DisplayName = "UniFi Protect UNVR"
        Domain = if ($Config.Devices.Protect_UNVR.Domain) { $Config.Devices.Protect_UNVR.Domain } else { "protect.panoramadr.com" }
        DeployTargetType = "LOCAL_VERIFY"
    },
    @{
        Key = "HomeAssistant"
        DisplayName = "Home Assistant"
        Domain = if ($Config.Devices.HomeAssistant.Domain) { $Config.Devices.HomeAssistant.Domain } else { "ha.panoramadr.com" }
        DeployTargetType = "SMB_SHARE (\\ha.panoramadr.com\ssl)"
    },
    @{
        Key = "Genmon"
        DisplayName = "Generator Monitor"
        Domain = if ($Config.Devices.Genmon.Domain) { $Config.Devices.Genmon.Domain } else { "genmon.panoramadr.com" }
        DeployTargetType = "SSH_SCP (/etc/genmon + Reload)"
    }
)

$Now = Get-Date
$Items = [System.Collections.Generic.List[PSObject]]::new()
$MinDays = 99999
$HealthyCount = 0
$ExpiringSoonCount = 0
$CriticalCount = 0
$DriftCount = 0

foreach ($dev in $DeviceDefinitions) {
    # --- Probe 1: Local Certificate File ---
    $localFile = Join-Path $BaseOutputFolder "$($dev.Key)\$($dev.Key)_certificate.crt"
    $localCert = @{
        exists = $false
        domain = $dev.Domain
        subject = ""
        issuer = ""
        thumbprint = ""
        serial_number = ""
        not_after = ""
        days_remaining = -1
        status = "MISSING"
        error = $null
    }

    if (Test-Path $localFile) {
        try {
            $bytes = [System.IO.File]::ReadAllBytes($localFile)
            $c = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($bytes)
            $daysLeft = [math]::Floor(($c.NotAfter - $Now).TotalDays)
            
            $statusStr = if ($daysLeft -le 0) { "EXPIRED" } elseif ($daysLeft -lt 15) { "CRITICAL" } elseif ($daysLeft -lt 30) { "EXPIRING_SOON" } else { "HEALTHY" }
            
            $localCert = @{
                exists = $true
                domain = $dev.Domain
                subject = $c.Subject
                issuer = $c.Issuer
                thumbprint = $c.Thumbprint.ToUpperInvariant()
                serial_number = $c.SerialNumber
                not_after = $c.NotAfter.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
                days_remaining = [int64]$daysLeft
                status = $statusStr
                error = $null
            }
        } catch {
            $localCert = @{
                exists = $false
                domain = $dev.Domain
                subject = ""
                issuer = ""
                thumbprint = ""
                serial_number = ""
                not_after = ""
                days_remaining = -1
                status = "ERROR"
                error = $_.Exception.Message
            }
        }
    }

    # --- Probe 2: Live Port 443 TLS Probe ---
    $liveCert = @{
        reachable = $false
        latency_ms = 0
        http_status = $null
        domain = $dev.Domain
        subject = ""
        issuer = ""
        thumbprint = ""
        serial_number = ""
        not_after = ""
        days_remaining = -1
        status = "MISSING"
        error = $null
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $tcp = [System.Net.Sockets.TcpClient]::new()
        $connectTask = $tcp.ConnectAsync($dev.Domain, 443)
        if (-not $connectTask.Wait($TimeoutMs)) {
            throw "Connection timed out after ${TimeoutMs}ms"
        }

        $ssl = [System.Net.Security.SslStream]::new(
            $tcp.GetStream(),
            $false,
            [System.Net.Security.RemoteCertificateValidationCallback]{ $true }
        )
        $ssl.AuthenticateAsClient($dev.Domain)
        $sw.Stop()

        if ($ssl.RemoteCertificate) {
            $remote = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($ssl.RemoteCertificate)
            $remoteDaysLeft = [math]::Floor(($remote.NotAfter - $Now).TotalDays)
            $remoteStatus = if ($remoteDaysLeft -le 0) { "EXPIRED" } elseif ($remoteDaysLeft -lt 15) { "CRITICAL" } elseif ($remoteDaysLeft -lt 30) { "EXPIRING_SOON" } else { "HEALTHY" }

            $liveCert = @{
                reachable = $true
                latency_ms = [int64]$sw.ElapsedMilliseconds
                http_status = [int64]200
                domain = $dev.Domain
                subject = $remote.Subject
                issuer = $remote.Issuer
                thumbprint = $remote.Thumbprint.ToUpperInvariant()
                serial_number = $remote.SerialNumber
                not_after = $remote.NotAfter.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
                days_remaining = [int64]$remoteDaysLeft
                status = $remoteStatus
                error = $null
            }
        } else {
            throw "No remote certificate received from host"
        }
        $ssl.Close()
        $tcp.Close()
    } catch {
        $sw.Stop()
        $liveCert = @{
            reachable = $false
            latency_ms = [int64]$sw.ElapsedMilliseconds
            http_status = $null
            domain = $dev.Domain
            subject = ""
            issuer = ""
            thumbprint = ""
            serial_number = ""
            not_after = ""
            days_remaining = -1
            status = "MISSING"
            error = $_.Exception.Message
        }
    }

    # --- Drift Classification ---
    $driftStatus = "UNKNOWN"
    if ($localCert.exists -and $liveCert.reachable) {
        if ($localCert.thumbprint -eq $liveCert.thumbprint) {
            $driftStatus = "IN_SYNC"
        } else {
            $driftStatus = "DRIFT_DETECTED"
            $DriftCount++
        }
    } elseif ($localCert.exists -and -not $liveCert.reachable) {
        $driftStatus = "LOCAL_ONLY"
    } elseif (-not $localCert.exists -and $liveCert.reachable) {
        $driftStatus = "LIVE_ONLY"
    } else {
        $driftStatus = "UNREACHABLE"
    }

    # Effective lowest days remaining
    $effectiveDays = if ($liveCert.reachable -and $liveCert.days_remaining -ge 0) {
        $liveCert.days_remaining
    } elseif ($localCert.exists -and $localCert.days_remaining -ge 0) {
        $localCert.days_remaining
    } else {
        -1
    }

    if ($effectiveDays -ge 0 -and $effectiveDays -lt $MinDays) {
        $MinDays = $effectiveDays
    }

    if ($effectiveDays -ge 30) {
        $HealthyCount++
    } elseif ($effectiveDays -ge 15) {
        $ExpiringSoonCount++
    } elseif ($effectiveDays -ge 0) {
        $CriticalCount++
    }

    $Items.Add([PSCustomObject]@{
        device_key = $dev.Key
        display_name = $dev.DisplayName
        domain = $dev.Domain
        deploy_target_type = $dev.DeployTargetType
        local_cert = $localCert
        live_cert = $liveCert
        drift_status = $driftStatus
    })
}

$Summary = [PSCustomObject]@{
    total_domains = $DeviceDefinitions.Count
    healthy_count = $HealthyCount
    expiring_soon_count = $ExpiringSoonCount
    critical_count = $CriticalCount
    drift_count = $DriftCount
    min_days_remaining = if ($MinDays -eq 99999) { 0 } else { $MinDays }
    items = $Items
    probed_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
}

$Summary | ConvertTo-Json -Depth 6 -Compress
