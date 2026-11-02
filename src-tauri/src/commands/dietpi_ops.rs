use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WshSnapshot {
    pub mode: String,
    pub hostname: String,
    pub kernel: String,
    pub uptime_secs: f64,
    pub dietpi_version: String,
    pub dietpi_update_available: String,
    pub reboot_required: bool,
    pub rpi_throttled: String,
    pub services: serde_json::Value,
    pub listening_ports: Vec<u16>,
    pub lighttpd_routes_raw: String,
    pub containers: Vec<serde_json::Value>,
    pub container_stats: Vec<serde_json::Value>,
    pub images: Vec<serde_json::Value>,
    pub cloudflared: serde_json::Value,
    pub apt_upgradable_raw: String,
    pub data_volumes_raw: String,
    pub docker_df: Vec<serde_json::Value>,
    pub release_ledgers: serde_json::Value,
}

#[tauri::command]
pub async fn fetch_wsh_snapshot(
    ssh_key_path: Option<String>,
    mode: Option<String>,
) -> Result<WshSnapshot, String> {
    tokio::task::spawn_blocking(move || {
        let key = ssh_key_path.unwrap_or_else(|| {
            "D:\\Google\\My Drive\\RSA\\rsa-key-deployment.ppk".to_string()
        });
        let run_mode = mode.unwrap_or_else(|| "--fast".to_string());
        let script_path = "C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaSRE\\scripts\\wsh_snapshot.sh";

        #[cfg(windows)]
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let raw_script = std::fs::read_to_string(script_path)
            .map_err(|e| format!("Failed to read wsh_snapshot.sh: {}", e))?;
        
        // Strictly sanitize CRLF to LF so remote bash doesn't choke on Windows line endings
        let sanitized_script = raw_script.replace("\r\n", "\n").replace('\r', "\n");

        let mut child = Command::new("plink.exe")
            .args([
                "-batch",
                "-ssh",
                "-i",
                &key,
                "root@wsh.panoramadr.com",
                &format!("bash -s -- {}", run_mode),
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to spawn plink.exe: {}. Ensure PuTTY is installed.", e))?;

        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(sanitized_script.as_bytes());
        }

        let output = child
            .wait_with_output()
            .map_err(|e| format!("SSH snapshot execution failed: {}", e))?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("SSH error: {}", err));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let trimmed = stdout.trim();

        // Extract first '{' to last '}' to strip any banner noise
        let start = trimmed.find('{').ok_or("No JSON output returned from snapshot")?;
        let end = trimmed.rfind('}').ok_or("Malformed JSON output from snapshot")?;
        let json_str = &trimmed[start..=end];

        serde_json::from_str::<WshSnapshot>(json_str)
            .map_err(|e| format!("Failed to parse snapshot JSON: {}. Raw snippet: {}", e, &json_str[..json_str.len().min(200)]))
    })
    .await
    .map_err(|e| format!("Join error: {}", e))?
}
