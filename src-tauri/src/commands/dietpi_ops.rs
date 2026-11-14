use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

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
    #[serde(default)]
    pub docker_networks: Vec<serde_json::Value>,
    #[serde(default)]
    pub network_interfaces: Vec<serde_json::Value>,
    #[serde(default)]
    pub network_routes: Vec<serde_json::Value>,
    #[serde(default)]
    pub listening_sockets_raw: String,
    #[serde(default)]
    pub firewall_rules_raw: String,
    #[serde(default)]
    pub docker_daemon_raw: String,
}

pub fn default_ssh_key_path() -> String {
    #[cfg(windows)]
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        let ssh_key = Path::new(&userprofile).join(".ssh").join("rsa-key-deployment");
        if ssh_key.exists() {
            return ssh_key.to_string_lossy().to_string();
        }
    }
    "C:\\Users\\rodrigo\\.ssh\\rsa-key-deployment".to_string()
}

struct SnapshotCacheState {
    last_snapshot: Option<(Instant, WshSnapshot)>,
}

fn snapshot_gate() -> &'static Mutex<SnapshotCacheState> {
    static GATE: OnceLock<Mutex<SnapshotCacheState>> = OnceLock::new();
    GATE.get_or_init(|| Mutex::new(SnapshotCacheState { last_snapshot: None }))
}

const SNAPSHOT_COOLDOWN: Duration = Duration::from_secs(30);

/// Returns the cached `cloudflared.version_raw` from the most recent WSH snapshot without
/// spawning an SSH process or blocking on an in-flight snapshot probe.
pub fn get_cached_cloudflared_version_raw() -> Option<String> {
    let guard = snapshot_gate().try_lock().ok()?;
    let (_, ref snap) = guard.last_snapshot.as_ref()?;
    snap.cloudflared
        .get("version_raw")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[tauri::command]
pub async fn fetch_wsh_snapshot(
    ssh_key_path: Option<String>,
    mode: Option<String>,
    force: Option<bool>,
) -> Result<WshSnapshot, String> {
    let force_refresh = force.unwrap_or(false);

    tokio::task::spawn_blocking(move || {
        // Hold the mutex across check + execution so concurrent callers serialize and reuse fresh snapshots
        // rather than spawning parallel ssh.exe processes that trip UniFi Suricata rule 2003068 (5 SYNs / 120s).
        let mut guard = snapshot_gate()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        if !force_refresh {
            if let Some((captured_at, ref cached)) = guard.last_snapshot {
                if captured_at.elapsed() < SNAPSHOT_COOLDOWN {
                    return Ok(cached.clone());
                }
            }
        }

        let key = ssh_key_path.unwrap_or_else(default_ssh_key_path);
        let run_mode = mode.unwrap_or_else(|| "--fast".to_string());
        
        // Embed the bash script directly into the binary so it runs in installed MSI/NSIS without filesystem dependencies
        let embedded_script = include_str!("../../../scripts/wsh_snapshot.sh");
        
        // Also check if local filesystem script exists (e.g. for development overrides)
        let raw_script = if let Ok(custom) = std::fs::read_to_string("C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaSRE\\scripts\\wsh_snapshot.sh") {
            custom
        } else {
            embedded_script.to_string()
        };
        
        // Strictly sanitize CRLF to LF so remote bash doesn't choke on Windows line endings
        let sanitized_script = raw_script.replace("\r\n", "\n").replace('\r', "\n");

        // Prefer OpenSSH (ssh.exe) when using standard OpenSSH private keys
        let use_ssh_exe = !key.to_lowercase().ends_with(".ppk");

        let mut child = if use_ssh_exe {
            let mut cmd = Command::new("ssh.exe");
            cmd.args([
                "-o", "BatchMode=yes",
                "-o", "StrictHostKeyChecking=accept-new",
                "-i", &key,
                "root@wsh.panoramadr.com",
                &format!("bash -s -- {}", run_mode),
            ]);
            cmd
        } else {
            let mut cmd = Command::new("plink.exe");
            cmd.args([
                "-batch",
                "-ssh",
                "-i", &key,
                "root@wsh.panoramadr.com",
                &format!("bash -s -- {}", run_mode),
            ]);
            cmd
        };

        let mut child_proc = child
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        #[cfg(windows)]
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        #[cfg(windows)]
        use std::os::windows::process::CommandExt;

        #[cfg(windows)]
        {
            child_proc = child_proc.creation_flags(CREATE_NO_WINDOW);
        }

        let mut spawned = child_proc
            .spawn()
            .map_err(|e| format!("Failed to spawn SSH process: {}. Ensure ssh.exe or plink.exe is available in PATH.", e))?;

        if let Some(mut stdin) = spawned.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(sanitized_script.as_bytes());
        }

        let output = spawned
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

        let parsed = serde_json::from_str::<WshSnapshot>(json_str)
            .map_err(|e| format!("Failed to parse snapshot JSON: {}. Raw snippet: {}", e, &json_str[..json_str.len().min(200)]))?;

        guard.last_snapshot = Some((Instant::now(), parsed.clone()));
        Ok(parsed)
    })
    .await
    .map_err(|e| format!("Join error: {}", e))?
}
