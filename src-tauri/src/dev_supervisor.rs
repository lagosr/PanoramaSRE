use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::net::TcpStream;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

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
            let _ = Command::new("pwsh.exe")
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

    /// Return currently active managed app IDs (pruning any exited children first)
    pub fn managed_app_ids(&self) -> Vec<String> {
        let mut map = match self.managed_processes.lock() {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        map.retain(|_, child| matches!(child.try_wait(), Ok(None)));
        let mut ids: Vec<String> = map.keys().cloned().collect();
        ids.sort();
        ids
    }

    /// Query dev server status for discovered suite apps directly (used by IPC Control Server)
    pub fn query_status_for_discovered(
        &self,
        apps: &[crate::commands::workspace::DiscoveredAppDto],
    ) -> Vec<DevServerInfo> {
        let mut results = Vec::new();
        let mut managed_map = self.managed_processes.lock().unwrap();

        managed_map.retain(|_app_id, child| matches!(child.try_wait(), Ok(None)));

        for app in apps {
            let app_id = app
                .manifest
                .app_id
                .clone()
                .unwrap_or_else(|| app.manifest.slug.clone());
            let port = app.manifest.port;
            let base_path = app.manifest.base_path.clone();
            let workspace_path = &app.workspace_path;
            let local_sqlite_rel = app
                .manifest
                .local_sqlite_path
                .as_deref()
                .unwrap_or("");

            let local_url = format!("http://localhost:{}{}", port, base_path);
            let managed_pid = managed_map.get(&app_id).map(|c| c.id());
            let is_open = DevSupervisor::is_port_listening(port);

            let status = if managed_pid.is_some() {
                DevServerStatus::RunningManaged
            } else if is_open {
                DevServerStatus::RunningExternal
            } else {
                DevServerStatus::Stopped
            };

            let (sqlite_size, sqlite_version) =
                if !local_sqlite_rel.is_empty() && !workspace_path.is_empty() {
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
                sqlite_path: if local_sqlite_rel.is_empty() {
                    None
                } else {
                    Some(local_sqlite_rel.to_string())
                },
                sqlite_size_bytes: sqlite_size,
                sqlite_user_version: sqlite_version,
            });
        }

        results
    }

    /// Return count of actively running managed processes
    pub fn get_managed_app_count(&self) -> usize {
        let mut managed_map = self.managed_processes.lock().unwrap();
        managed_map.retain(|_app_id, child| {
            matches!(child.try_wait(), Ok(None))
        });
        managed_map.len()
    }
}

const BOOT_CAPTURE_MAX_LINES: usize = 400;

/// Strip basic ANSI CSI escape sequences so dev server readiness detection matches colored banners cleanly.
fn strip_ansi_basic(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if let Some(&next) = chars.peek() {
                if next == '[' {
                    chars.next();
                    while let Some(seq_c) = chars.next() {
                        if ('@'..='~').contains(&seq_c) {
                            break;
                        }
                    }
                    continue;
                }
            }
        }
        if c != '\r' {
            out.push(c);
        }
    }
    out
}

/// Detect whether a startup stdout/stderr line indicates the dev server has started listening.
pub fn is_dev_server_ready_line(raw_line: &str) -> bool {
    let clean = strip_ansi_basic(raw_line).to_ascii_lowercase();
    clean.contains("ready in ")
        || clean.contains("started server")
        || clean.contains("listening on")
        || (clean.contains("local:") && clean.contains("http"))
}

fn emit_dev_stream_start(
    app_handle: &Option<tauri::AppHandle>,
    id: &str,
    title: &str,
    app_id: &str,
    port: Option<u16>,
    source: &str,
) {
    if let Some(app) = app_handle {
        let _ = app.emit(
            "sre://dev-stream-start",
            json!({
                "id": id,
                "title": title,
                "appId": app_id,
                "port": port,
                "source": source,
            }),
        );
    }
}

fn emit_dev_stream_line(
    app_handle: &Option<tauri::AppHandle>,
    id: &str,
    app_id: &str,
    line: &str,
) {
    if let Some(app) = app_handle {
        let _ = app.emit(
            "sre://dev-stream-line",
            json!({
                "id": id,
                "appId": app_id,
                "line": line,
            }),
        );
    }
}

fn emit_dev_stream_end(
    app_handle: &Option<tauri::AppHandle>,
    id: &str,
    app_id: &str,
    exit_code: i32,
) {
    if let Some(app) = app_handle {
        let _ = app.emit(
            "sre://dev-stream-end",
            json!({
                "id": id,
                "appId": app_id,
                "exitCode": exit_code,
            }),
        );
    }
}

fn complete_dev_boot_stream(
    app_handle: &Option<tauri::AppHandle>,
    db: &Arc<Mutex<crate::db::SreDatabase>>,
    boot_completed: &Arc<AtomicBool>,
    boot_lines: &Arc<Mutex<Vec<String>>>,
    session_id: &str,
    title: &str,
    app_id: &str,
    source: &str,
    completion_line: Option<String>,
    exit_code: i32,
) {
    if boot_completed
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }

    let final_lines = {
        let mut lines_guard = boot_lines.lock().unwrap();
        if let Some(line) = completion_line {
            emit_dev_stream_line(app_handle, session_id, app_id, &line);
            if lines_guard.len() < BOOT_CAPTURE_MAX_LINES {
                lines_guard.push(line);
            }
        }
        lines_guard.clone()
    };

    if let Ok(db_guard) = db.lock() {
        let _ = db_guard.save_console_session(
            session_id,
            title,
            &final_lines,
            false,
            Some(exit_code),
            Some("local-dev"),
            Some(source),
        );
    }

    emit_dev_stream_end(app_handle, session_id, app_id, exit_code);
}

#[allow(clippy::too_many_arguments)]
fn spawn_boot_pipe_reader<R: Read + Send + 'static>(
    reader: R,
    app_handle: Option<tauri::AppHandle>,
    db: Arc<Mutex<crate::db::SreDatabase>>,
    boot_completed: Arc<AtomicBool>,
    boot_lines: Arc<Mutex<Vec<String>>>,
    session_id: String,
    title: String,
    app_id: String,
    source: String,
    port: Option<u16>,
) {
    std::thread::spawn(move || {
        let buf = BufReader::new(reader);
        for line_res in buf.lines() {
            let Ok(raw_line) = line_res else {
                break;
            };
            // Fast-path: drain OS pipe in Rust with zero allocations/IPC once startup completes
            if boot_completed.load(Ordering::Acquire) {
                continue;
            }
            let scrubbed = crate::scrubber::scrub_secrets(&raw_line);
            if scrubbed.trim().is_empty() {
                continue;
            }
            {
                let mut lines_guard = boot_lines.lock().unwrap();
                if lines_guard.len() < BOOT_CAPTURE_MAX_LINES {
                    lines_guard.push(scrubbed.clone());
                }
            }
            emit_dev_stream_line(&app_handle, &session_id, &app_id, &scrubbed);

            if is_dev_server_ready_line(&scrubbed) {
                let port_label = port
                    .map(|p| format!("http://localhost:{}", p))
                    .unwrap_or_else(|| "local dev port".to_string());
                complete_dev_boot_stream(
                    &app_handle,
                    &db,
                    &boot_completed,
                    &boot_lines,
                    &session_id,
                    &title,
                    &app_id,
                    &source,
                    Some(format!(
                        "[DEV:{}] [PASS] Server started and listening on {} (steady-state output discarded)",
                        app_id, port_label
                    )),
                    0,
                );
            }
        }
    });
}

impl DevSupervisor {
    /// Start a dev server and register it in `managed_processes`, streaming boot output until ready.
    #[allow(clippy::too_many_arguments)]
    pub fn start_app_internal(
        &self,
        app_handle: Option<&tauri::AppHandle>,
        db: &Arc<Mutex<crate::db::SreDatabase>>,
        app_id: &str,
        workspace_path: &str,
        dev_command: Option<&str>,
        port: Option<u16>,
        source: &str,
    ) -> Result<u32, String> {
        let session_id = format!(
            "dev-boot-{}-{}",
            app_id.to_lowercase(),
            chrono::Utc::now().timestamp_millis()
        );
        let port_suffix = port.map(|p| format!(" (:{})", p)).unwrap_or_default();
        let title = format!("Dev Server Boot: {}{}", app_id, port_suffix);
        let app_handle_owned = app_handle.cloned();

        {
            let mut map = self.managed_processes.lock().unwrap();
            if let Some(child) = map.get_mut(app_id) {
                if let Ok(None) = child.try_wait() {
                    let pid = child.id();
                    let msg = format!(
                        "[DEV:{}] [PASS] Dev server already running and listening (PID {})",
                        app_id, pid
                    );
                    emit_dev_stream_start(&app_handle_owned, &session_id, &title, app_id, port, source);
                    emit_dev_stream_line(&app_handle_owned, &session_id, app_id, &msg);
                    if let Ok(guard) = db.lock() {
                        let _ = guard.log_action(
                            "DEV_SUPERVISOR",
                            "INFO",
                            &format!("Dev server {} already running", app_id),
                            Some(&format!("pid={}", pid)),
                        );
                        let _ = guard.save_console_session(
                            &session_id,
                            &title,
                            &[msg],
                            false,
                            Some(0),
                            Some("local-dev"),
                            Some(source),
                        );
                    }
                    emit_dev_stream_end(&app_handle_owned, &session_id, app_id, 0);
                    return Ok(pid);
                }
            }
        }

        let raw_cmd = dev_command.unwrap_or("npm run dev").to_string();
        if raw_cmd.trim().is_empty() {
            return Err("Empty dev command".into());
        }

        let mut cmd_str = raw_cmd.clone();
        if let Some(p) = port {
            if cmd_str == "npm run dev" || cmd_str == "npm run dev --" {
                cmd_str = format!("npm run dev -- -p {}", p);
            }
        }

        #[cfg(windows)]
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let mut cmd = Command::new("cmd");
        cmd.current_dir(workspace_path)
            .args(["/c", &cmd_str])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(p) = port {
            cmd.env("PORT", p.to_string());
        }

        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn {}: {}", cmd_str, e))?;
        let pid = child.id();
        let stdout_pipe = child.stdout.take();
        let stderr_pipe = child.stderr.take();

        {
            let mut map = self.managed_processes.lock().unwrap();
            map.insert(app_id.to_string(), child);
        }

        let initial_line = format!(
            "[DEV:{}] Spawning '{}' (PID {}, port {:?}) in {}...",
            app_id, cmd_str, pid, port, workspace_path
        );
        emit_dev_stream_start(&app_handle_owned, &session_id, &title, app_id, port, source);
        emit_dev_stream_line(&app_handle_owned, &session_id, app_id, &initial_line);

        let boot_completed = Arc::new(AtomicBool::new(false));
        let boot_lines = Arc::new(Mutex::new(vec![initial_line]));

        if let Ok(guard) = db.lock() {
            let _ = guard.log_action(
                "DEV_SUPERVISOR",
                "INFO",
                &format!("Started dev server for {}", app_id),
                Some(&format!(
                    "pid={}, cmd={}, port={:?}, path={}",
                    pid, cmd_str, port, workspace_path
                )),
            );
            let lines_snapshot = boot_lines.lock().unwrap().clone();
            let _ = guard.save_console_session(
                &session_id,
                &title,
                &lines_snapshot,
                true,
                None,
                Some("local-dev"),
                Some(source),
            );
        }

        if let Some(stdout) = stdout_pipe {
            spawn_boot_pipe_reader(
                stdout,
                app_handle_owned.clone(),
                Arc::clone(db),
                Arc::clone(&boot_completed),
                Arc::clone(&boot_lines),
                session_id.clone(),
                title.clone(),
                app_id.to_string(),
                source.to_string(),
                port,
            );
        }

        if let Some(stderr) = stderr_pipe {
            spawn_boot_pipe_reader(
                stderr,
                app_handle_owned.clone(),
                Arc::clone(db),
                Arc::clone(&boot_completed),
                Arc::clone(&boot_lines),
                session_id.clone(),
                title.clone(),
                app_id.to_string(),
                source.to_string(),
                port,
            );
        }

        // Lightweight watcher thread: finalizes boot stream via TCP port open or startup exit/timeout
        let managed_ref = Arc::clone(&self.managed_processes);
        let db_watch = Arc::clone(db);
        let boot_completed_watch = Arc::clone(&boot_completed);
        let boot_lines_watch = Arc::clone(&boot_lines);
        let app_id_watch = app_id.to_string();
        let source_watch = source.to_string();
        std::thread::spawn(move || {
            for _ in 0..240 {
                std::thread::sleep(Duration::from_millis(250));
                if boot_completed_watch.load(Ordering::Acquire) {
                    return;
                }

                // 1. Check whether process exited prematurely or was stopped
                let process_outcome = {
                    let mut map = managed_ref.lock().unwrap();
                    match map.get_mut(&app_id_watch) {
                        None => Some(None), // Stopped externally via stop_app_internal
                        Some(child) => match child.try_wait() {
                            Ok(Some(status)) => Some(Some(status.code().unwrap_or(1))),
                            Ok(None) => None,
                            Err(_) => Some(Some(1)),
                        },
                    }
                };

                if let Some(outcome) = process_outcome {
                    std::thread::sleep(Duration::from_millis(150));
                    match outcome {
                        None => {
                            complete_dev_boot_stream(
                                &app_handle_owned,
                                &db_watch,
                                &boot_completed_watch,
                                &boot_lines_watch,
                                &session_id,
                                &title,
                                &app_id_watch,
                                &source_watch,
                                Some(format!(
                                    "[DEV:{}] [INFO] Boot stream ended (server stopped during startup)",
                                    app_id_watch
                                )),
                                0,
                            );
                        }
                        Some(code) => {
                            complete_dev_boot_stream(
                                &app_handle_owned,
                                &db_watch,
                                &boot_completed_watch,
                                &boot_lines_watch,
                                &session_id,
                                &title,
                                &app_id_watch,
                                &source_watch,
                                Some(format!(
                                    "[DEV:{}] [FAIL] Dev server exited during startup (exit code: {})",
                                    app_id_watch, code
                                )),
                                code,
                            );
                        }
                    }
                    return;
                }

                // 2. Check if port started listening (covers servers that don't print a Next.js banner)
                if let Some(p) = port {
                    if DevSupervisor::is_port_listening(p) {
                        std::thread::sleep(Duration::from_millis(200));
                        complete_dev_boot_stream(
                            &app_handle_owned,
                            &db_watch,
                            &boot_completed_watch,
                            &boot_lines_watch,
                            &session_id,
                            &title,
                            &app_id_watch,
                            &source_watch,
                            Some(format!(
                                "[DEV:{}] [PASS] Server started and listening on http://localhost:{} (steady-state output discarded)",
                                app_id_watch, p
                            )),
                            0,
                        );
                        return;
                    }
                }
            }

            complete_dev_boot_stream(
                &app_handle_owned,
                &db_watch,
                &boot_completed_watch,
                &boot_lines_watch,
                &session_id,
                &title,
                &app_id_watch,
                &source_watch,
                Some(format!(
                    "[DEV:{}] [WARN] Startup stream window elapsed (60s); steady-state output detached",
                    app_id_watch
                )),
                0,
            );
        });

        Ok(pid)
    }

    /// Stop a dev server by app_id and port, emitting concise stop confirmation to the Dev stream
    pub fn stop_app_internal(
        &self,
        app_handle: Option<&tauri::AppHandle>,
        db: &Arc<Mutex<crate::db::SreDatabase>>,
        app_id: &str,
        port: Option<u16>,
        source: &str,
    ) -> Result<bool, String> {
        let session_id = format!(
            "dev-stop-{}-{}",
            app_id.to_lowercase(),
            chrono::Utc::now().timestamp_millis()
        );
        let port_suffix = port.map(|p| format!(" (:{})", p)).unwrap_or_default();
        let title = format!("Dev Server Stop: {}{}", app_id, port_suffix);
        let app_handle_owned = app_handle.cloned();

        let line1 = format!("[DEV:{}] Stopping dev server{}...", app_id, port_suffix);
        emit_dev_stream_start(&app_handle_owned, &session_id, &title, app_id, port, source);
        emit_dev_stream_line(&app_handle_owned, &session_id, app_id, &line1);

        let mut stopped = false;
        {
            let mut map = self.managed_processes.lock().unwrap();
            if let Some(mut child) = map.remove(app_id) {
                let pid = child.id();
                DevSupervisor::kill_process_tree(pid);
                let _ = child.kill();
                stopped = true;
            }
        }

        if let Some(p) = port {
            DevSupervisor::kill_by_port(p);
            stopped = true;
        }

        let line2 = format!("[DEV:{}] [PASS] Dev server stopped cleanly", app_id);
        emit_dev_stream_line(&app_handle_owned, &session_id, app_id, &line2);

        if let Ok(guard) = db.lock() {
            let _ = guard.log_action(
                "DEV_SUPERVISOR",
                "INFO",
                &format!("Stopped dev server for {}", app_id),
                Some(&format!("port={:?}", port)),
            );
            let _ = guard.save_console_session(
                &session_id,
                &title,
                &[line1, line2],
                false,
                Some(0),
                Some("local-dev"),
                Some(source),
            );
        }

        emit_dev_stream_end(&app_handle_owned, &session_id, app_id, 0);

        Ok(stopped)
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
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, Arc<DevSupervisor>>,
    db: tauri::State<'_, Arc<Mutex<crate::db::SreDatabase>>>,
    app_id: String,
    workspace_path: String,
    dev_command: Option<String>,
    port: Option<u16>,
) -> Result<u32, String> {
    supervisor.start_app_internal(
        Some(&app),
        &db,
        &app_id,
        &workspace_path,
        dev_command.as_deref(),
        port,
        "ui",
    )
}

#[tauri::command]
pub async fn stop_dev_server(
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, Arc<DevSupervisor>>,
    db: tauri::State<'_, Arc<Mutex<crate::db::SreDatabase>>>,
    app_id: String,
    port: Option<u16>,
) -> Result<bool, String> {
    supervisor.stop_app_internal(Some(&app), &db, &app_id, port, "ui")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_dev_server_ready_line_handles_ansi_and_banners() {
        assert!(is_dev_server_ready_line(
            "\x1b[32m✓\x1b[39m Ready in 1420ms"
        ));
        assert!(is_dev_server_ready_line(
            "  - Local:        \x1b[36mhttp://localhost:3002/biomed\x1b[39m"
        ));
        assert!(is_dev_server_ready_line("started server on 0.0.0.0:3000"));
        assert!(!is_dev_server_ready_line(" ○ Compiling /page ..."));
        assert!(!is_dev_server_ready_line("GET /biomed/api/health 200 in 18ms"));
    }
}
