use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SslHealthStatus {
    #[serde(rename = "HEALTHY")]
    Healthy,
    #[serde(rename = "EXPIRING_SOON")]
    ExpiringSoon,
    #[serde(rename = "CRITICAL")]
    Critical,
    #[serde(rename = "EXPIRED")]
    Expired,
    #[serde(rename = "MISSING")]
    Missing,
    #[serde(rename = "SELF_SIGNED")]
    SelfSigned,
    #[serde(rename = "ERROR")]
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SslCertificateDetails {
    pub exists: bool,
    pub domain: String,
    pub subject: String,
    pub issuer: String,
    pub thumbprint: String,
    pub serial_number: String,
    pub not_after: String,
    pub days_remaining: i64,
    pub status: SslHealthStatus,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveTlsProbeDetails {
    pub reachable: bool,
    pub latency_ms: u64,
    pub http_status: Option<u16>,
    pub domain: String,
    pub subject: String,
    pub issuer: String,
    pub thumbprint: String,
    pub serial_number: String,
    pub not_after: String,
    pub days_remaining: i64,
    pub status: SslHealthStatus,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CertificateDriftStatus {
    #[serde(rename = "IN_SYNC")]
    InSync,
    #[serde(rename = "DRIFT_DETECTED")]
    DriftDetected,
    #[serde(rename = "LOCAL_ONLY")]
    LocalOnly,
    #[serde(rename = "LIVE_ONLY")]
    LiveOnly,
    #[serde(rename = "SELF_SIGNED")]
    SelfSigned,
    #[serde(rename = "UNREACHABLE")]
    Unreachable,
    #[serde(rename = "UNKNOWN")]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainSslDualProbe {
    pub device_key: String,
    pub display_name: String,
    pub domain: String,
    pub local_target_folder: Option<String>,
    pub deploy_target_type: String,
    pub local_cert: SslCertificateDetails,
    pub live_cert: LiveTlsProbeDetails,
    pub drift_status: CertificateDriftStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SslFleetSummary {
    pub total_domains: usize,
    pub healthy_count: usize,
    pub expiring_soon_count: usize,
    pub critical_count: usize,
    pub drift_count: usize,
    pub min_days_remaining: i64,
    pub base_output_folder: Option<String>,
    pub items: Vec<DomainSslDualProbe>,
    pub probed_at: String,
}

/// Discovers domains from config.json, executes dual-probe inspection
/// (local X.509 file check + live port 443 TLS handshake), and computes cryptographic drift.
#[tauri::command]
pub async fn get_ssl_fleet_status(
    suite_tools_dir: Option<String>,
) -> Result<SslFleetSummary, String> {
    tokio::task::spawn_blocking(move || {
        let default_script_path = PathBuf::from(
            "C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaSRE\\scripts\\probe_ssl_dual.ps1",
        );

        let script_path = if default_script_path.exists() {
            default_script_path
        } else {
            Path::new("./scripts/probe_ssl_dual.ps1").to_path_buf()
        };

        if !script_path.exists() {
            return Err(format!(
                "SSL probe script not found at {}",
                script_path.display()
            ));
        }

        let mut cmd = Command::new("pwsh.exe");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&script_path);

        if let Some(dir) = suite_tools_dir {
            let config_path = Path::new(&dir).join("ssl-cert-manager").join("config.json");
            if config_path.exists() {
                cmd.args(["-ConfigPath", config_path.to_str().unwrap_or("")]);
            }
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let output = match cmd.output() {
            Ok(out) => out,
            Err(_) => {
                // Fallback to Windows PowerShell 5.1 if pwsh is not in PATH
                let mut fallback = Command::new("powershell.exe");
                fallback.args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                ])
                .arg(&script_path);

                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x08000000;
                    fallback.creation_flags(CREATE_NO_WINDOW);
                }

                fallback.stdout(std::process::Stdio::piped());
                fallback.stderr(std::process::Stdio::piped());

                fallback
                    .output()
                    .map_err(|e| format!("Failed to spawn PowerShell for SSL probe: {}", e))?
            }
        };

        if !output.status.success() {
            let err_msg = String::from_utf8_lossy(&output.stderr);
            return Err(format!("SSL probe script failed: {}", err_msg));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let trimmed = stdout.trim();

        serde_json::from_str::<SslFleetSummary>(trimmed)
            .map_err(|e| format!("Failed to parse SSL probe JSON: {}. Raw: {}", e, trimmed))
    })
    .await
    .map_err(|e| format!("Tokio task failed: {}", e))?
}
