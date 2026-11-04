use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::TcpStream;
use std::path::Path;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DevServerStatus {
    #[serde(rename = "STOPPED")]
    Stopped,
    #[serde(rename = "RUNNING_MANAGED")]
    RunningManaged,
    #[serde(rename = "RUNNING_EXTERNAL")]
    RunningExternal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevServerInfo {
    pub app_id: String,
    pub status: DevServerStatus,
    pub pid: Option<u32>,
    pub port: u16,
    pub base_path: String,
    pub local_url: String,
    pub sqlite_path: Option<String>,
    pub sqlite_size_bytes: Option<u64>,
    pub sqlite_user_version: Option<u32>,
}

pub struct DevSupervisor {
    // Maps app_id -> managed Child process
    managed_processes: Arc<Mutex<HashMap<String, Child>>>,
}

impl DevSupervisor {
    pub fn new() -> Self {
        Self {
            managed_processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Check if a local port is accepting TCP connections (150ms timeout)
    pub fn is_port_listening(port: u16) -> bool {
        let addr_str = format!("127.0.0.1:{}", port);
        if let Ok(addr) = addr_str.parse::<std::net::SocketAddr>() {
            TcpStream::connect_timeout(&addr, Duration::from_millis(150)).is_ok()
        } else {
            false
        }
    }

    /// Inspect local SQLite file for size and PRAGMA user_version
    pub fn inspect_sqlite(db_path: &Path) -> (Option<u64>, Option<u32>) {
        if !db_path.exists() {
            return (None, None);
        }
        let size = std::fs::metadata(db_path).map(|m| m.len()).ok();
        let user_version = match rusqlite::Connection::open_with_flags(
            db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ) {
            Ok(conn) => {
                conn.query_row("PRAGMA user_version;", [], |row| row.get::<_, u32>(0))
                    .ok()
            }
            Err(_) => None,
        };
        (size, user_version)
    }

    /// Kill a process tree cleanly on Windows using taskkill /PID <pid> /T /F
    pub fn kill_process_tree(pid: u32) {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
    }

    /// Kill any process listening on a specific TCP port using netstat + taskkill
    pub fn kill_by_port(port: u16) {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            // Strategy 1: Find listening PIDs directly via netstat and kill them forcefully with taskkill
            if let Ok(output) = Command::new("netstat")
                .args(["-ano"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
            {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let target_port_pattern = format!(":{}", port);
                for line in stdout.lines() {
                    if line.contains("LISTENING") && line.contains(&target_port_pattern) {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if let Some(pid_str) = parts.last() {
                            if let Ok(pid) = pid_str.parse::<u32>() {
                                if pid > 0 {
                                    Self::kill_process_tree(pid);
                                }
                            }
                        }
                    }
                }
            }

            // Strategy 2: Backup PowerShell Get-NetTCPConnection cleanup
            let ps_cmd = format!(
                "Get-NetTCPConnection -LocalPort {} -State Listen -ErrorAction SilentlyContinue | ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }}",
                port
            );
            let _ = Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &ps_cmd])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
    }

    /// Stop all managed dev processes (called on Quit)
    pub fn stop_all(&self) {
        let mut map = self.managed_processes.lock().unwrap();
        for (_, mut child) in map.drain() {
            let pid = child.id();
            Self::kill_process_tree(pid);
            let _ = child.kill();
        }
    }
}

#[tauri::command]
pub async fn get_dev_servers_status(
    supervisor: tauri::State<'_, Arc<DevSupervisor>>,
    apps: Vec<serde_json::Value>,
) -> Result<Vec<DevServerInfo>, String> {
    let mut results = Vec::new();

    let mut managed_map = supervisor.managed_processes.lock().unwrap();

    // 1. Prune terminated child processes from managed_map so dead processes do not linger
    managed_map.retain(|_app_id, child| {
        match child.try_wait() {
            Ok(None) => true,       // Still running
            Ok(Some(_)) => false,   // Exited cleanly or with code
            Err(_) => false,        // Failed to check or terminated
        }
    });

    for app in apps {
        let app_id = app["appId"].as_str().unwrap_or("").to_string();
        let port = app["port"].as_u64().unwrap_or(3000) as u16;
        let base_path = app["basePath"].as_str().unwrap_or("").to_string();
        let workspace_path = app["workspacePath"].as_str().unwrap_or("");
        let local_sqlite_rel = app["localSqlitePath"].as_str().unwrap_or("");

        let local_url = format!("http://localhost:{}{}", port, base_path);

        // Check managed map
        let managed_pid = managed_map.get(&app_id).map(|c| c.id());

        // Check if port is open
        let is_open = DevSupervisor::is_port_listening(port);

        // Dev server is running managed only if process handle exists in managed_map
        // AND either the port is actively listening or the process was just spawned
        let status = if managed_pid.is_some() {
            if is_open {
                DevServerStatus::RunningManaged
            } else {
                // If child is alive in managed_map but port is not listening, it could be starting up or hung.
                // However, if the process actually exited, retain() above already pruned it.
                // We mark it as RunningManaged if process is still alive.
                DevServerStatus::RunningManaged
            }
        } else if is_open {
            DevServerStatus::RunningExternal
        } else {
            DevServerStatus::Stopped
        };

        // SQLite inspection
        let (sqlite_size, sqlite_version) = if !local_sqlite_rel.is_empty() && !workspace_path.is_empty() {
            let db_path = Path::new(workspace_path).join(local_sqlite_rel);
            DevSupervisor::inspect_sqlite(&db_path)
        } else {
            (None, None)
        };

        results.push(DevServerInfo {
            app_id,
            status,
            pid: managed_pid,
            port,
            base_path,
            local_url,
            sqlite_path: if local_sqlite_rel.is_empty() { None } else { Some(local_sqlite_rel.to_string()) },
            sqlite_size_bytes: sqlite_size,
            sqlite_user_version: sqlite_version,
        });
    }

    Ok(results)
}

#[tauri::command]
pub async fn start_dev_server(
    supervisor: tauri::State<'_, Arc<DevSupervisor>>,
    db: tauri::State<'_, Arc<Mutex<crate::db::SreDatabase>>>,
    app_id: String,
    workspace_path: String,
    dev_command: Option<String>,
    port: Option<u16>,
) -> Result<u32, String> {
    let mut map = supervisor.managed_processes.lock().unwrap();

    // Check if already managed and still alive
    if let Some(child) = map.get_mut(&app_id) {
        if let Ok(None) = child.try_wait() {
            let pid = child.id();
            if let Ok(guard) = db.lock() {
                let _ = guard.log_action("DEV_SUPERVISOR", "INFO", &format!("Dev server {} already running", app_id), Some(&format!("pid={}", pid)));
            }
            return Ok(pid);
        }
    }

    let raw_cmd = dev_command.unwrap_or_else(|| "npm run dev".to_string());
    if raw_cmd.trim().is_empty() {
        return Err("Empty dev command".into());
    }

    // Ensure specific port is passed to npm/next if port is provided and command is npm run dev
    let mut cmd_str = raw_cmd.clone();
    if let Some(p) = port {
        if cmd_str == "npm run dev" || cmd_str == "npm run dev --" {
            cmd_str = format!("npm run dev -- -p {}", p);
        }
    }

    #[cfg(windows)]
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    // Use cmd /c with npm.cmd if invoking npm directly
    let mut cmd = Command::new("cmd");
    cmd.current_dir(&workspace_path)
        .args(["/c", &cmd_str]);

    // Explicitly set PORT environment variable for Next.js and Node servers
    if let Some(p) = port {
        cmd.env("PORT", p.to_string());
    }

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let child = cmd.spawn().map_err(|e| format!("Failed to spawn {}: {}", cmd_str, e))?;
    let pid = child.id();
    map.insert(app_id.clone(), child);

    if let Ok(guard) = db.lock() {
        let _ = guard.log_action("DEV_SUPERVISOR", "INFO", &format!("Started dev server for {}", app_id), Some(&format!("pid={}, cmd={}, port={:?}, path={}", pid, cmd_str, port, workspace_path)));
    }

    Ok(pid)
}

#[tauri::command]
pub async fn stop_dev_server(
    supervisor: tauri::State<'_, Arc<DevSupervisor>>,
    db: tauri::State<'_, Arc<Mutex<crate::db::SreDatabase>>>,
    app_id: String,
    port: Option<u16>,
) -> Result<bool, String> {
    let mut map = supervisor.managed_processes.lock().unwrap();
    let mut stopped = false;

    if let Some(mut child) = map.remove(&app_id) {
        let pid = child.id();
        DevSupervisor::kill_process_tree(pid);
        let _ = child.kill();
        stopped = true;
    }

    // Always check and terminate listening process on that port as well (covers prior runs & orphaned trees)
    if let Some(p) = port {
        DevSupervisor::kill_by_port(p);
        stopped = true;
    }

    if let Ok(guard) = db.lock() {
        let _ = guard.log_action("DEV_SUPERVISOR", "INFO", &format!("Stopped dev server for {}", app_id), Some(&format!("port={:?}", port)));
    }

    Ok(stopped)
}
