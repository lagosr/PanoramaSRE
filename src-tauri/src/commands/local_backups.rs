use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalBackupArchive {
    pub file_name: String,
    pub full_path: String,
    pub size_bytes: u64,
    pub schema_version: u32,
    pub date_str: String,
    pub timestamp_str: String,
    pub is_auto_gfs: bool,
    pub health_snapshot: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupScanResult {
    pub backup_dir: String,
    pub archives: Vec<LocalBackupArchive>,
}

fn parse_archive_metadata(path: &Path) -> (u32, String, String, bool) {
    let stem = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .replace(".tar.gz", "");

    // Format: db-backup_v{schema}_{date}_{time}
    // e.g. db-backup_v4_2026-11-01_15-45-16
    let is_auto_gfs = stem.contains("gfs") || stem.contains("auto") || stem.contains("02-00");
    let mut schema_version = 1u32;
    let mut date_str = String::new();
    let mut timestamp_str = String::new();

    let parts: Vec<&str> = stem.split('_').collect();
    for part in &parts {
        if let Some(v_str) = part.strip_prefix('v') {
            if let Ok(num) = v_str.parse::<u32>() {
                schema_version = num;
            }
        } else if part.contains('-') && part.len() == 10 {
            // YYYY-MM-DD
            date_str = part.to_string();
        }
    }

    if parts.len() >= 4 && parts[2].contains('-') {
        date_str = parts[2].to_string();
        timestamp_str = format!("{} {}", parts[2], parts[3].replace('-', ":"));
    } else if !date_str.is_empty() {
        timestamp_str = date_str.clone();
    } else if let Ok(meta) = fs::metadata(path) {
        if let Ok(mod_time) = meta.modified() {
            let datetime: chrono::DateTime<chrono::Local> = mod_time.into();
            date_str = datetime.format("%Y-%m-%d").to_string();
            timestamp_str = datetime.format("%Y-%m-%d %H:%M:%S").to_string();
        }
    }

    if timestamp_str.is_empty() {
        timestamp_str = stem.clone();
    }
    if date_str.is_empty() {
        date_str = timestamp_str.chars().take(10).collect();
    }

    (schema_version, date_str, timestamp_str, is_auto_gfs)
}

fn peek_health_json_from_tar(tar_path: &Path) -> Option<serde_json::Value> {
    #[cfg(windows)]
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut cmd = Command::new("tar");
    cmd.args(["-xOzf", &tar_path.to_string_lossy(), "health.json"]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    if let Ok(output) = cmd.output() {
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout);
            let json_slice = if let Some(idx) = s.find('{') {
                &s[idx..]
            } else {
                &s
            };
            return serde_json::from_str(json_slice).ok();
        }
    }
    None
}

/// Helper to read LOCAL_BACKUP_DIR from .env.deploy if present
fn resolve_backup_dir(ws: &Path) -> PathBuf {
    let env_deploy = ws.join(".env.deploy");
    if env_deploy.exists() {
        if let Ok(content) = fs::read_to_string(&env_deploy) {
            for line in content.lines() {
                let trimmed = line.trim();
                if let Some(rest) = trimmed.strip_prefix("LOCAL_BACKUP_DIR=") {
                    let path_str = rest.trim().trim_matches('"').trim_matches('\'');
                    if !path_str.is_empty() {
                        let candidate = PathBuf::from(path_str);
                        if candidate.exists() {
                            return candidate;
                        }
                    }
                }
            }
        }
    }

    // Default to workspace/backups
    let default_dir = ws.join("backups");
    if !default_dir.exists() {
        let _ = fs::create_dir_all(&default_dir);
    }
    default_dir
}

#[tauri::command]
pub async fn scan_local_backups(workspace_path: String) -> Result<BackupScanResult, String> {
    tokio::task::spawn_blocking(move || {
        let ws = Path::new(&workspace_path);
        let backups_dir = resolve_backup_dir(ws);

        let mut archives = Vec::new();
        if let Ok(entries) = fs::read_dir(&backups_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let name = path.file_name().unwrap_or_default().to_string_lossy();
                    if name.ends_with(".tar.gz") {
                        if let Ok(meta) = fs::metadata(&path) {
                            let file_name = name.to_string();
                            let (schema_version, date_str, timestamp_str, is_auto_gfs) = parse_archive_metadata(&path);

                            archives.push(LocalBackupArchive {
                                file_name,
                                full_path: path.to_string_lossy().to_string(),
                                size_bytes: meta.len(),
                                schema_version,
                                date_str,
                                timestamp_str,
                                is_auto_gfs,
                                health_snapshot: None, // Fast scan initially
                            });
                        }
                    }
                }
            }
        }

        // Sort newest first by file name / timestamp
        archives.sort_by(|a, b| b.file_name.cmp(&a.file_name));

        // Peek health.json only for top 5 most recent archives to prevent disk thrashing
        for a in archives.iter_mut().take(5) {
            a.health_snapshot = peek_health_json_from_tar(Path::new(&a.full_path));
        }

        Ok(BackupScanResult {
            backup_dir: backups_dir.to_string_lossy().to_string(),
            archives,
        })
    })
    .await
    .map_err(|e| format!("Join error: {}", e))?
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageantStatus {
    pub is_running: bool,
    pub has_key_loaded: bool,
    pub key_path: String,
    pub pageant_executable: String,
    pub message: String,
}

#[tauri::command]
pub async fn check_pageant_status(custom_key_path: Option<String>) -> Result<PageantStatus, String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(windows)]
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let key_path = custom_key_path.unwrap_or_else(|| {
            crate::commands::dietpi_ops::default_ssh_key_path()
        });

        let pageant_executable = {
            let default_exe = "C:\\Program Files\\PuTTY\\pageant.exe";
            if Path::new(default_exe).exists() {
                default_exe.to_string()
            } else {
                "pageant.exe".to_string()
            }
        };

        // 1. Check if pageant.exe process is currently running
        let mut cmd = Command::new("tasklist");
        cmd.args(["/FI", "IMAGENAME eq pageant.exe", "/NH"]);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let tasklist_out = cmd.output().map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
        let is_running = tasklist_out.to_lowercase().contains("pageant.exe");

        if !is_running {
            return Ok(PageantStatus {
                is_running: false,
                has_key_loaded: false,
                key_path,
                pageant_executable,
                message: "PuTTY Pageant is NOT running. SSH batch operations will fail with interactive passphrase prompts.".to_string(),
            });
        }

        // 2. Check if Pageant has the deployment key loaded and unlocked
        // Using plink -v in batch mode against localhost or remote to test agent query
        let mut plink_cmd = Command::new("plink.exe");
        plink_cmd.args([
            "-v",
            "-batch",
            "-ssh",
            "-i",
            &key_path,
            "root@wsh.panoramadr.com",
            "exit",
        ]);
        #[cfg(windows)]
        plink_cmd.creation_flags(CREATE_NO_WINDOW);

        let plink_out = plink_cmd.output();
        let mut has_key_loaded = false;
        let mut msg = "Pageant is running and holding the decrypted deployment identity.".to_string();

        if let Ok(out) = plink_out {
            let stderr = String::from_utf8_lossy(&out.stderr);
            if stderr.contains("Pageant has 1 SSH-2 keys") || stderr.contains("Trying Pageant key") || stderr.contains("Authenticating with public key \"rsa-key-deployment\" from agent") {
                has_key_loaded = true;
            } else if out.status.success() {
                has_key_loaded = true;
            } else if stderr.contains("Cannot answer interactive prompts in batch mode") {
                has_key_loaded = false;
                msg = "Pageant is running, but the deployment key is NOT loaded or locked with a passphrase.".to_string();
            }
        }

        Ok(PageantStatus {
            is_running: true,
            has_key_loaded,
            key_path,
            pageant_executable,
            message: msg,
        })
    })
    .await
    .map_err(|e| format!("Join error: {}", e))?
}

#[tauri::command]
pub async fn launch_pageant_with_key(custom_key_path: Option<String>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let key_path = custom_key_path.unwrap_or_else(|| {
            crate::commands::dietpi_ops::default_ssh_key_path()
        });

        let pageant_executable = {
            let default_exe = "C:\\Program Files\\PuTTY\\pageant.exe";
            if Path::new(default_exe).exists() {
                default_exe.to_string()
            } else {
                "pageant.exe".to_string()
            }
        };

        if !Path::new(&key_path).exists() {
            return Err(format!("Deployment key not found at: {}", key_path));
        }

        // Launch Pageant with the key path using PowerShell Start-Process
        // This opens Pageant and prompts the user once for the passphrase GUI in their user desktop session
        let mut cmd = Command::new("pwsh.exe");
        cmd.args([
            "-NoProfile",
            "-Command",
            &format!("Start-Process -FilePath '{}' -ArgumentList '\"{}\"'", pageant_executable, key_path),
        ]);

        let out = cmd.output().map_err(|e| format!("Failed to spawn Pageant: {}", e))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("Pageant launch failed: {}", err));
        }

        Ok("Pageant launched. If prompted, please enter your private key passphrase in the PuTTY dialog.".to_string())
    })
    .await
    .map_err(|e| format!("Join error: {}", e))?
}
