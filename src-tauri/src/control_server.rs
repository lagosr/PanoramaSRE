use crate::commands::git_ops::compute_app_composition;
use crate::commands::ledger::read_backup_ledger;
use crate::commands::monitor::detect_network_posture;
use crate::commands::ssl_ops::get_ssl_fleet_status;
use crate::commands::workspace::{discover_suite_apps_internal, resolve_suite_workspace_root};
use crate::db::SreDatabase;
use crate::dev_supervisor::DevSupervisor;
use crate::ipc_security::{
    self, CallerAttestation, ReplayGuard, validate_dev_command, validate_slug,
};
use crate::scrubber::scrub_secrets;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static ACTIVE_LEASE_PATH: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
static BRIDGE_TELEMETRY: OnceLock<Arc<Mutex<McpBridgeTelemetry>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActionSummary {
    pub action: String,
    pub slug: Option<String>,
    pub timestamp: String,
    pub success: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct McpBridgeTelemetry {
    pub total_requests: u64,
    pub active_connections: u32,
    pub security_alerts: u32,
    pub last_action: Option<AgentActionSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpBridgeStatus {
    pub is_online: bool,
    pub instance_id: String,
    pub pid: u32,
    pub channel: String,
    pub pipe_name: String,
    pub total_requests: u64,
    pub active_connections: u32,
    pub security_alerts: u32,
    pub last_action: Option<AgentActionSummary>,
    pub sibling_instances: usize,
    pub is_primary_elected: bool,
}

pub fn get_bridge_telemetry() -> Arc<Mutex<McpBridgeTelemetry>> {
    BRIDGE_TELEMETRY
        .get_or_init(|| Arc::new(Mutex::new(McpBridgeTelemetry::default())))
        .clone()
}

pub fn record_telemetry_request() {
    let t = get_bridge_telemetry();
    let mut g = match t.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    g.total_requests = g.total_requests.saturating_add(1);
}

pub fn record_telemetry_alert() {
    let t = get_bridge_telemetry();
    let mut g = match t.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    g.security_alerts = g.security_alerts.saturating_add(1);
}

pub fn record_telemetry_action(action: &str, slug: Option<&str>, success: bool, message: Option<&str>) {
    let t = get_bridge_telemetry();
    let mut g = match t.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    g.last_action = Some(AgentActionSummary {
        action: action.to_string(),
        slug: slug.map(|s| s.to_string()),
        timestamp: chrono::Utc::now().to_rfc3339(),
        success,
        message: message.map(|m| m.to_string()),
    });
}

/// Reads all valid, currently-live lease files in the IPC lease directory.
pub fn list_live_leases(lease_dir: &Path) -> Vec<SreInstanceLease> {
    let mut leases = Vec::new();
    let Ok(entries) = fs::read_dir(lease_dir) else {
        return leases;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(fname) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !fname.starts_with("lease-") || !fname.ends_with(".json") {
            continue;
        }
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(lease) = serde_json::from_str::<SreInstanceLease>(&raw) {
                if ipc_security::is_pid_alive(lease.pid) {
                    leases.push(lease);
                }
            }
        }
    }
    leases
}

#[tauri::command]
pub async fn get_mcp_bridge_status(
    dev_supervisor: tauri::State<'_, Arc<DevSupervisor>>,
) -> Result<McpBridgeStatus, String> {
    let current_pid = std::process::id();
    let lease_dir = resolve_ipc_lease_dir();
    let active_leases = list_live_leases(&lease_dir);
    let sibling_instances = active_leases.len();

    let exe_path = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let channel = classify_exe_channel(&exe_path);

    // Current instance info
    let current_lease = active_leases.iter().find(|l| l.pid == current_pid);
    let instance_id = current_lease
        .map(|l| l.instance_id.clone())
        .unwrap_or_else(|| format!("sre-{}-{}", channel, current_pid));
    let pipe_name = current_lease
        .map(|l| l.pipe_name.clone())
        .unwrap_or_default();

    let telemetry = get_bridge_telemetry();
    let (total_requests, active_connections, security_alerts, last_action) = {
        if let Ok(g) = telemetry.lock() {
            (
                g.total_requests,
                g.active_connections,
                g.security_alerts,
                g.last_action.clone(),
            )
        } else {
            (0, 0, 0, None)
        }
    };

    // Determine if this instance is primary elected
    let managed_count = dev_supervisor.get_managed_app_count();
    let is_primary_elected = if active_leases.is_empty() {
        true
    } else {
        if managed_count > 0 {
            true
        } else {
            channel == "installed"
                || !active_leases.iter().any(|l| l.channel == "installed" && l.pid != current_pid)
        }
    };

    Ok(McpBridgeStatus {
        is_online: true,
        instance_id,
        pid: current_pid,
        channel,
        pipe_name,
        total_requests,
        active_connections,
        security_alerts,
        last_action,
        sibling_instances,
        is_primary_elected,
    })
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SreInstanceLease {
    pub instance_id: String,
    pub pid: u32,
    pub pipe_name: String,
    pub version: String,
    pub channel: String, // "installed" | "dev" | "portable"
    pub exe_path: String,
    pub workspace_root: String,
    pub started_at: String,
    pub hmac_secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcRequest {
    pub id: String,
    pub ts: i64,
    pub nonce: String,
    pub action: String,
    #[serde(default)]
    pub params: Value,
    pub sig: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcErrorPayload {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcResponse {
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<IpcErrorPayload>,
}

impl IpcResponse {
    pub fn success(id: impl Into<String>, data: Value) -> Self {
        Self {
            id: id.into(),
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(id: impl Into<String>, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            ok: false,
            data: None,
            error: Some(IpcErrorPayload {
                code: code.into(),
                message: message.into(),
            }),
        }
    }
}

/// Classifies the running executable into `"installed"`, `"dev"`, or `"portable"`.
pub fn classify_exe_channel(exe_path: &str) -> String {
    let norm = exe_path.replace('/', "\\").to_ascii_lowercase();
    if norm.contains("\\target\\debug\\")
        || norm.contains("\\target\\release\\")
        || norm.contains("\\src-tauri\\target\\")
    {
        return "dev".to_string();
    }
    if norm.contains("\\appdata\\local\\panoramasre\\")
        || norm.contains("\\program files\\panoramasre\\")
        || norm.contains("\\program files (x86)\\panoramasre\\")
        || norm.contains("\\appdata\\local\\programs\\panoramasre\\")
    {
        return "installed".to_string();
    }
    if cfg!(debug_assertions) {
        "dev".to_string()
    } else {
        "portable".to_string()
    }
}

/// Resolves `%LOCALAPPDATA%\com.panoramadr.sre\ipc`, creates it if missing, and locks its ACL to the current user.
pub fn resolve_ipc_lease_dir() -> PathBuf {
    #[cfg(windows)]
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let dir = Path::new(&local_app_data)
            .join("com.panoramadr.sre")
            .join("ipc");
        let _ = fs::create_dir_all(&dir);
        ipc_security::lock_directory_to_current_user(&dir);
        return dir;
    }

    let fallback = PathBuf::from("data/ipc");
    let _ = fs::create_dir_all(&fallback);
    fallback
}

/// Prunes any `lease-*.json` files whose process PID is no longer alive.
pub fn prune_stale_leases(lease_dir: &Path) {
    let Ok(entries) = fs::read_dir(lease_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(fname) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !fname.starts_with("lease-") || !fname.ends_with(".json") {
            continue;
        }
        let should_remove = match fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str::<SreInstanceLease>(&raw) {
                Ok(lease) => !ipc_security::is_pid_alive(lease.pid),
                Err(_) => true,
            },
            Err(_) => true,
        };
        if should_remove {
            let _ = fs::remove_file(&path);
        }
    }
}

/// Removes the current process's IPC lease file on graceful shutdown.
pub fn cleanup_current_lease() {
    if let Some(lock) = ACTIVE_LEASE_PATH.get() {
        if let Ok(mut guard) = lock.lock() {
            if let Some(path) = guard.take() {
                let _ = fs::remove_file(path);
            }
        }
    }
}

/// Emits UI feedback + security alert events to the Tauri webview if available.
fn emit_ui_event(app_handle: &Option<AppHandle>, event_name: &str, payload: Value) {
    if let Some(app) = app_handle {
        let _ = app.emit(event_name, payload);
    }
}

/// Starts the Named Pipe Control Server for the running PanoramaSRE instance.
pub fn start_control_server(
    app_handle: AppHandle,
    dev_supervisor: Arc<DevSupervisor>,
    sre_db: Arc<Mutex<SreDatabase>>,
) {
    let pid = std::process::id();
    let exe_path = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "panorama-sre.exe".to_string());
    let channel = classify_exe_channel(&exe_path);

    let configured_ws = sre_db
        .lock()
        .ok()
        .and_then(|g| g.get_setting("workspace_root").ok().flatten());
    let workspace_root = resolve_suite_workspace_root(configured_ws.as_deref())
        .to_string_lossy()
        .to_string();

    let pipe_suffix = ipc_security::generate_pipe_suffix_hex();
    let pipe_name = format!(r"\\.\pipe\panoramasre-ctl-{}-{}", pid, pipe_suffix);
    let hmac_secret = ipc_security::generate_256bit_secret_hex();
    let started_at = chrono::Utc::now().to_rfc3339();
    let instance_id = format!("sre-{}-{}", channel, pid);

    let lease = SreInstanceLease {
        instance_id,
        pid,
        pipe_name: pipe_name.clone(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        channel: channel.clone(),
        exe_path,
        workspace_root,
        started_at,
        hmac_secret,
    };

    let lease_dir = resolve_ipc_lease_dir();
    prune_stale_leases(&lease_dir);

    let lease_file_path = lease_dir.join(format!("lease-{}.json", pid));
    if let Ok(serialized) = serde_json::to_string_pretty(&lease) {
        let _ = fs::write(&lease_file_path, serialized);
    }

    let lock = ACTIVE_LEASE_PATH.get_or_init(|| Mutex::new(None));
    if let Ok(mut guard) = lock.lock() {
        *guard = Some(lease_file_path);
    }

    if let Ok(guard) = sre_db.lock() {
        let _ = guard.log_action(
            "AGENT_IPC",
            "INFO",
            &format!(
                "Zero-trust IPC Control Server listening on {} (channel={})",
                pipe_name, channel
            ),
            None,
        );
    }

    let replay_guard = Arc::new(ReplayGuard::new());

    tauri::async_runtime::spawn(async move {
        run_pipe_accept_loop(
            Some(app_handle),
            lease,
            dev_supervisor,
            sre_db,
            replay_guard,
        )
        .await;
    });
}

#[cfg(windows)]
pub async fn run_pipe_accept_loop(
    app_handle: Option<AppHandle>,
    lease: SreInstanceLease,
    dev_supervisor: Arc<DevSupervisor>,
    sre_db: Arc<Mutex<SreDatabase>>,
    replay_guard: Arc<ReplayGuard>,
) {
    use tokio::net::windows::named_pipe::{PipeMode, ServerOptions};

    let mut is_first = true;
    let mut server = match ServerOptions::new()
        .first_pipe_instance(is_first)
        .reject_remote_clients(true)
        .pipe_mode(PipeMode::Byte)
        .in_buffer_size(16384)
        .out_buffer_size(65536)
        .create(&lease.pipe_name)
    {
        Ok(s) => {
            is_first = false;
            s
        }
        Err(e) => {
            if let Ok(guard) = sre_db.lock() {
                let _ = guard.log_action(
                    "AGENT_IPC",
                    "ERROR",
                    &format!("Failed to create Named Pipe {}: {}", lease.pipe_name, e),
                    None,
                );
            }
            return;
        }
    };

    loop {
        if server.connect().await.is_err() {
            tokio::time::sleep(Duration::from_millis(50)).await;
            continue;
        }

        let connected_client = server;

        // Immediately create next server instance before handling current connection so concurrent callers never get ERROR_PIPE_BUSY
        server = match ServerOptions::new()
            .first_pipe_instance(is_first)
            .reject_remote_clients(true)
            .pipe_mode(PipeMode::Byte)
            .in_buffer_size(16384)
            .out_buffer_size(65536)
            .create(&lease.pipe_name)
        {
            Ok(s) => s,
            Err(e) => {
                if let Ok(guard) = sre_db.lock() {
                    let _ = guard.log_action(
                        "AGENT_IPC",
                        "ERROR",
                        &format!("Failed to re-arm Named Pipe {}: {}", lease.pipe_name, e),
                        None,
                    );
                }
                break;
            }
        };

        let app_clone = app_handle.clone();
        let lease_clone = lease.clone();
        let ds_clone = Arc::clone(&dev_supervisor);
        let db_clone = Arc::clone(&sre_db);
        let rg_clone = Arc::clone(&replay_guard);

        tokio::spawn(async move {
            handle_pipe_connection(
                connected_client,
                app_clone,
                lease_clone,
                ds_clone,
                db_clone,
                rg_clone,
            )
            .await;
        });
    }
}

#[cfg(windows)]
async fn handle_pipe_connection(
    pipe: tokio::net::windows::named_pipe::NamedPipeServer,
    app_handle: Option<AppHandle>,
    lease: SreInstanceLease,
    dev_supervisor: Arc<DevSupervisor>,
    sre_db: Arc<Mutex<SreDatabase>>,
    replay_guard: Arc<ReplayGuard>,
) {
    use std::os::windows::io::AsRawHandle;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

    // Gate 1 & 2: Verify OS-level Client PID and Process Lineage Attestation
    let raw_handle = pipe.as_raw_handle();
    let attestation = match ipc_security::verify_pipe_client_lineage(raw_handle) {
        Ok(att) => att,
        Err(violation) => {
            if let Ok(guard) = sre_db.lock() {
                let _ = guard.log_action(
                    "SECURITY_ALERT",
                    "ERROR",
                    &format!("Blocked unauthorized IPC caller: {}", violation.reason),
                    Some(&format!(
                        "pid={}, exe={}",
                        violation.pid, violation.exe_path
                    )),
                );
            }
            record_telemetry_alert();
            emit_ui_event(
                &app_handle,
                "sre://security-alert",
                json!({
                    "pid": violation.pid,
                    "exePath": violation.exe_path,
                    "reason": violation.reason,
                }),
            );
            return;
        }
    };

    let (reader, mut writer) = tokio::io::split(pipe);
    let mut limited_reader = BufReader::new(reader.take(16384));
    let mut line = String::new();

    let read_res =
        tokio::time::timeout(Duration::from_secs(5), limited_reader.read_line(&mut line)).await;

    let Ok(Ok(bytes_read)) = read_res else {
        return;
    };
    if bytes_read == 0 || line.trim().is_empty() {
        return;
    }

    record_telemetry_request();

    let response = process_ipc_message(
        line.trim(),
        &attestation,
        &app_handle,
        &lease,
        &dev_supervisor,
        &sre_db,
        &replay_guard,
    )
    .await;

    if let Ok(mut resp_json) = serde_json::to_string(&response) {
        resp_json.push('\n');
        let _ = writer.write_all(resp_json.as_bytes()).await;
        let _ = writer.flush().await;
    }
}

pub async fn process_ipc_message(
    raw_line: &str,
    attestation: &CallerAttestation,
    app_handle: &Option<AppHandle>,
    lease: &SreInstanceLease,
    dev_supervisor: &Arc<DevSupervisor>,
    sre_db: &Arc<Mutex<SreDatabase>>,
    replay_guard: &Arc<ReplayGuard>,
) -> IpcResponse {
    let req: IpcRequest = match serde_json::from_str(raw_line) {
        Ok(r) => r,
        Err(e) => {
            return IpcResponse::err(
                "unknown",
                "INVALID_JSON",
                format!("Malformed IPC request envelope: {}", e),
            );
        }
    };

    let now_epoch = chrono::Utc::now().timestamp();

    // Check circuit breaker lockout
    if let Some(remaining_secs) = replay_guard.is_locked_out(now_epoch) {
        return IpcResponse::err(
            &req.id,
            "AUTH_LOCKED_OUT",
            format!(
                "IPC control plane temporarily locked due to repeated authentication failures ({}s remaining)",
                remaining_secs
            ),
        );
    }

    // Gate 3a: Constant-time HMAC-SHA256 verification
    if !ipc_security::verify_request_hmac(
        &lease.hmac_secret,
        req.ts,
        &req.nonce,
        &req.action,
        &req.params,
        &req.sig,
    ) {
        let locked = replay_guard.record_auth_failure(now_epoch);
        if let Ok(guard) = sre_db.lock() {
            let _ = guard.log_action(
                "SECURITY_ALERT",
                "WARN",
                &format!(
                    "IPC HMAC signature verification failed for action '{}' (locked={})",
                    req.action, locked
                ),
                Some(&format!(
                    "caller_pid={}, exe={}",
                    attestation.pid, attestation.exe_name
                )),
            );
        }
        emit_ui_event(
            app_handle,
            "sre://security-alert",
            json!({
                "pid": attestation.pid,
                "exePath": attestation.exe_path,
                "reason": format!("Invalid HMAC signature on action '{}'", req.action),
            }),
        );
        return IpcResponse::err(
            &req.id,
            "AUTH_HMAC_INVALID",
            "Cryptographic HMAC-SHA256 signature verification failed",
        );
    }

    // Gate 3b: Clock skew & nonce replay check
    if let Err(replay_err) =
        replay_guard.validate_and_record_nonce(req.ts, &req.nonce, now_epoch)
    {
        let _ = replay_guard.record_auth_failure(now_epoch);
        if let Ok(guard) = sre_db.lock() {
            let _ = guard.log_action(
                "SECURITY_ALERT",
                "WARN",
                &format!("IPC replay/skew guard rejected request: {}", replay_err),
                Some(&format!("caller_pid={}", attestation.pid)),
            );
        }
        return IpcResponse::err(&req.id, "AUTH_REPLAY_OR_SKEW", replay_err);
    }

    // Gate 4 & 5: Dispatch strictly validated action
    match req.action.as_str() {
        "instances.ping" => {
            let managed_apps = dev_supervisor.managed_app_ids();
            let managed_count = managed_apps.len();
            IpcResponse::success(
                &req.id,
                json!({
                    "instanceId": lease.instance_id,
                    "pid": lease.pid,
                    "version": lease.version,
                    "channel": lease.channel,
                    "exePath": lease.exe_path,
                    "workspaceRoot": lease.workspace_root,
                    "startedAt": lease.started_at,
                    "managedApps": managed_apps,
                    "managedCount": managed_count,
                }),
            )
        }

        "dev.status" => {
            let apps = match discover_suite_apps_internal(sre_db, None) {
                Ok(a) => a,
                Err(e) => return IpcResponse::err(&req.id, "DISCOVERY_ERROR", e),
            };
            let statuses = dev_supervisor.query_status_for_discovered(&apps);
            let enriched: Vec<Value> = apps
                .iter()
                .map(|app| {
                    let app_id = app
                        .manifest
                        .app_id
                        .clone()
                        .unwrap_or_else(|| app.manifest.slug.clone());
                    let dev_info = statuses.iter().find(|s| s.app_id == app_id);
                    json!({
                        "slug": app.manifest.slug,
                        "appId": app_id,
                        "displayName": app.manifest.display_name,
                        "port": app.manifest.port,
                        "basePath": app.manifest.base_path,
                        "workspacePath": app.workspace_path,
                        "requiresAuthInDev": app.manifest.requires_auth_in_dev,
                        "status": dev_info.map(|d| &d.status),
                        "pid": dev_info.and_then(|d| d.pid),
                        "localUrl": dev_info.map(|d| &d.local_url),
                        "sqlitePath": dev_info.and_then(|d| d.sqlite_path.as_ref()),
                        "sqliteSizeBytes": dev_info.and_then(|d| d.sqlite_size_bytes),
                        "sqliteUserVersion": dev_info.and_then(|d| d.sqlite_user_version),
                    })
                })
                .collect();

            IpcResponse::success(
                &req.id,
                json!({
                    "instanceId": lease.instance_id,
                    "channel": lease.channel,
                    "apps": enriched,
                }),
            )
        }

        "dev.start" => {
            let raw_slug = req.params["slug"].as_str().unwrap_or("");
            let slug = match validate_slug(raw_slug, true) {
                Ok(s) => s,
                Err(e) => return IpcResponse::err(&req.id, "INVALID_SLUG", e),
            };
            let with_auth_param = req.params.get("withAuth").and_then(|v| v.as_bool());

            let apps = match discover_suite_apps_internal(sre_db, None) {
                Ok(a) => a,
                Err(e) => return IpcResponse::err(&req.id, "DISCOVERY_ERROR", e),
            };

            let mut started_results = Vec::new();

            if slug == "all" {
                // Start PanoramaAuth first if discovered
                if let Some(auth_app) = apps.iter().find(|a| a.manifest.slug == "auth") {
                    let app_id = auth_app
                        .manifest
                        .app_id
                        .clone()
                        .unwrap_or_else(|| auth_app.manifest.slug.clone());
                    let cmd = auth_app
                        .manifest
                        .dev_command
                        .as_deref()
                        .unwrap_or("npm run dev");
                    let clean_cmd = match validate_dev_command(cmd) {
                        Ok(c) => c,
                        Err(e) => return IpcResponse::err(&req.id, "UNSAFE_DEV_COMMAND", e),
                    };
                    if let Ok(pid) = dev_supervisor.start_app_internal(
                        sre_db,
                        &app_id,
                        &auth_app.workspace_path,
                        Some(&clean_cmd),
                        Some(auth_app.manifest.port),
                    ) {
                        started_results.push(json!({
                            "slug": auth_app.manifest.slug,
                            "appId": app_id,
                            "pid": pid,
                            "port": auth_app.manifest.port,
                        }));
                    }
                }

                for app in apps.iter().filter(|a| a.manifest.slug != "auth") {
                    let app_id = app
                        .manifest
                        .app_id
                        .clone()
                        .unwrap_or_else(|| app.manifest.slug.clone());
                    let cmd = app
                        .manifest
                        .dev_command
                        .as_deref()
                        .unwrap_or("npm run dev");
                    let clean_cmd = match validate_dev_command(cmd) {
                        Ok(c) => c,
                        Err(e) => return IpcResponse::err(&req.id, "UNSAFE_DEV_COMMAND", e),
                    };
                    if let Ok(pid) = dev_supervisor.start_app_internal(
                        sre_db,
                        &app_id,
                        &app.workspace_path,
                        Some(&clean_cmd),
                        Some(app.manifest.port),
                    ) {
                        started_results.push(json!({
                            "slug": app.manifest.slug,
                            "appId": app_id,
                            "pid": pid,
                            "port": app.manifest.port,
                        }));
                    }
                }
            } else {
                let Some(target_app) = apps.iter().find(|a| {
                    a.manifest.slug.eq_ignore_ascii_case(&slug)
                        || a.manifest
                            .app_id
                            .as_deref()
                            .map(|id| id.eq_ignore_ascii_case(&slug))
                            .unwrap_or(false)
                }) else {
                    return IpcResponse::err(
                        &req.id,
                        "APP_NOT_FOUND",
                        format!("No discovered suite application matches slug '{}'", slug),
                    );
                };

                let should_start_auth =
                    with_auth_param.unwrap_or(target_app.manifest.requires_auth_in_dev);

                if should_start_auth && target_app.manifest.slug != "auth" {
                    if let Some(auth_app) = apps.iter().find(|a| a.manifest.slug == "auth") {
                        let auth_id = auth_app
                            .manifest
                            .app_id
                            .clone()
                            .unwrap_or_else(|| auth_app.manifest.slug.clone());
                        let auth_cmd = auth_app
                            .manifest
                            .dev_command
                            .as_deref()
                            .unwrap_or("npm run dev");
                        let clean_auth_cmd = match validate_dev_command(auth_cmd) {
                            Ok(c) => c,
                            Err(e) => return IpcResponse::err(&req.id, "UNSAFE_DEV_COMMAND", e),
                        };
                        if let Ok(auth_pid) = dev_supervisor.start_app_internal(
                            sre_db,
                            &auth_id,
                            &auth_app.workspace_path,
                            Some(&clean_auth_cmd),
                            Some(auth_app.manifest.port),
                        ) {
                            started_results.push(json!({
                                "slug": auth_app.manifest.slug,
                                "appId": auth_id,
                                "pid": auth_pid,
                                "port": auth_app.manifest.port,
                            }));
                        }
                    }
                }

                let app_id = target_app
                    .manifest
                    .app_id
                    .clone()
                    .unwrap_or_else(|| target_app.manifest.slug.clone());
                let raw_cmd = target_app
                    .manifest
                    .dev_command
                    .as_deref()
                    .unwrap_or("npm run dev");
                let clean_cmd = match validate_dev_command(raw_cmd) {
                    Ok(c) => c,
                    Err(e) => return IpcResponse::err(&req.id, "UNSAFE_DEV_COMMAND", e),
                };

                match dev_supervisor.start_app_internal(
                    sre_db,
                    &app_id,
                    &target_app.workspace_path,
                    Some(&clean_cmd),
                    Some(target_app.manifest.port),
                ) {
                    Ok(pid) => {
                        started_results.push(json!({
                            "slug": target_app.manifest.slug,
                            "appId": app_id,
                            "pid": pid,
                            "port": target_app.manifest.port,
                        }));
                    }
                    Err(e) => return IpcResponse::err(&req.id, "START_FAILED", e),
                }
            }

            if let Ok(guard) = sre_db.lock() {
                let _ = guard.log_action(
                    "AGENT_IPC",
                    "INFO",
                    &format!("Agent started dev server '{}' via IPC", slug),
                    Some(&format!(
                        "caller_pid={}, exe={}",
                        attestation.pid, attestation.exe_name
                    )),
                );
            }

            record_telemetry_action("dev.start", Some(&slug), true, Some(&format!("Started {}", slug)));

            emit_ui_event(
                app_handle,
                "sre://agent-action",
                json!({
                    "action": "start",
                    "slug": slug,
                    "message": format!("AI Agent started dev server ({})", slug),
                }),
            );

            IpcResponse::success(
                &req.id,
                json!({
                    "started": started_results,
                    "managedApps": dev_supervisor.managed_app_ids(),
                }),
            )
        }

        "dev.stop" => {
            let raw_slug = req.params["slug"].as_str().unwrap_or("");
            let slug = match validate_slug(raw_slug, true) {
                Ok(s) => s,
                Err(e) => return IpcResponse::err(&req.id, "INVALID_SLUG", e),
            };

            let apps = match discover_suite_apps_internal(sre_db, None) {
                Ok(a) => a,
                Err(e) => return IpcResponse::err(&req.id, "DISCOVERY_ERROR", e),
            };

            let mut stopped_slugs = Vec::new();
            if slug == "all" {
                for app in &apps {
                    let app_id = app
                        .manifest
                        .app_id
                        .clone()
                        .unwrap_or_else(|| app.manifest.slug.clone());
                    let _ = dev_supervisor.stop_app_internal(
                        sre_db,
                        &app_id,
                        Some(app.manifest.port),
                    );
                    stopped_slugs.push(app.manifest.slug.clone());
                }
            } else {
                let Some(target_app) = apps.iter().find(|a| {
                    a.manifest.slug.eq_ignore_ascii_case(&slug)
                        || a.manifest
                            .app_id
                            .as_deref()
                            .map(|id| id.eq_ignore_ascii_case(&slug))
                            .unwrap_or(false)
                }) else {
                    return IpcResponse::err(
                        &req.id,
                        "APP_NOT_FOUND",
                        format!("No discovered suite application matches slug '{}'", slug),
                    );
                };

                let app_id = target_app
                    .manifest
                    .app_id
                    .clone()
                    .unwrap_or_else(|| target_app.manifest.slug.clone());
                if let Err(e) = dev_supervisor.stop_app_internal(
                    sre_db,
                    &app_id,
                    Some(target_app.manifest.port),
                ) {
                    return IpcResponse::err(&req.id, "STOP_FAILED", e);
                }
                stopped_slugs.push(target_app.manifest.slug.clone());
            }

            if let Ok(guard) = sre_db.lock() {
                let _ = guard.log_action(
                    "AGENT_IPC",
                    "INFO",
                    &format!("Agent stopped dev server '{}' via IPC", slug),
                    Some(&format!(
                        "caller_pid={}, exe={}",
                        attestation.pid, attestation.exe_name
                    )),
                );
            }

            record_telemetry_action("dev.stop", Some(&slug), true, Some(&format!("Stopped {}", slug)));

            emit_ui_event(
                app_handle,
                "sre://agent-action",
                json!({
                    "action": "stop",
                    "slug": slug,
                    "message": format!("AI Agent stopped dev server ({})", slug),
                }),
            );

            IpcResponse::success(
                &req.id,
                json!({
                    "stopped": stopped_slugs,
                    "managedApps": dev_supervisor.managed_app_ids(),
                }),
            )
        }

        "dev.restart" => {
            let raw_slug = req.params["slug"].as_str().unwrap_or("");
            let slug = match validate_slug(raw_slug, false) {
                Ok(s) => s,
                Err(e) => return IpcResponse::err(&req.id, "INVALID_SLUG", e),
            };

            let apps = match discover_suite_apps_internal(sre_db, None) {
                Ok(a) => a,
                Err(e) => return IpcResponse::err(&req.id, "DISCOVERY_ERROR", e),
            };

            let Some(target_app) = apps.iter().find(|a| {
                a.manifest.slug.eq_ignore_ascii_case(&slug)
                    || a.manifest
                        .app_id
                        .as_deref()
                        .map(|id| id.eq_ignore_ascii_case(&slug))
                        .unwrap_or(false)
            }) else {
                return IpcResponse::err(
                    &req.id,
                    "APP_NOT_FOUND",
                    format!("No discovered suite application matches slug '{}'", slug),
                );
            };

            let app_id = target_app
                .manifest
                .app_id
                .clone()
                .unwrap_or_else(|| target_app.manifest.slug.clone());
            let raw_cmd = target_app
                .manifest
                .dev_command
                .as_deref()
                .unwrap_or("npm run dev");
            let clean_cmd = match validate_dev_command(raw_cmd) {
                Ok(c) => c,
                Err(e) => return IpcResponse::err(&req.id, "UNSAFE_DEV_COMMAND", e),
            };

            let _ = dev_supervisor.stop_app_internal(
                sre_db,
                &app_id,
                Some(target_app.manifest.port),
            );
            tokio::time::sleep(Duration::from_millis(600)).await;

            match dev_supervisor.start_app_internal(
                sre_db,
                &app_id,
                &target_app.workspace_path,
                Some(&clean_cmd),
                Some(target_app.manifest.port),
            ) {
                Ok(pid) => {
                    if let Ok(guard) = sre_db.lock() {
                        let _ = guard.log_action(
                            "AGENT_IPC",
                            "INFO",
                            &format!("Agent restarted dev server '{}' (pid={})", slug, pid),
                            Some(&format!("caller_pid={}", attestation.pid)),
                        );
                    }
                    record_telemetry_action("dev.restart", Some(&slug), true, Some(&format!("Restarted {}", slug)));

                    emit_ui_event(
                        app_handle,
                        "sre://agent-action",
                        json!({
                            "action": "restart",
                            "slug": slug,
                            "message": format!("AI Agent restarted dev server ({})", slug),
                        }),
                    );
                    IpcResponse::success(
                        &req.id,
                        json!({
                            "slug": target_app.manifest.slug,
                            "appId": app_id,
                            "pid": pid,
                            "port": target_app.manifest.port,
                            "managedApps": dev_supervisor.managed_app_ids(),
                        }),
                    )
                }
                Err(e) => IpcResponse::err(&req.id, "RESTART_FAILED", e),
            }
        }

        "git.composition" => {
            let filter_slug = match req.params.get("slug").and_then(|v| v.as_str()) {
                Some(s) if !s.trim().is_empty() => match validate_slug(s, true) {
                    Ok(clean) => Some(clean),
                    Err(e) => return IpcResponse::err(&req.id, "INVALID_SLUG", e),
                },
                _ => None,
            };

            let apps = match discover_suite_apps_internal(sre_db, None) {
                Ok(a) => a,
                Err(e) => return IpcResponse::err(&req.id, "DISCOVERY_ERROR", e),
            };

            let mut reports = Vec::new();
            for app in apps {
                if let Some(ref f) = filter_slug {
                    if f != "all" && !app.manifest.slug.eq_ignore_ascii_case(f) {
                        continue;
                    }
                }
                let app_id = app
                    .manifest
                    .app_id
                    .clone()
                    .unwrap_or_else(|| app.manifest.slug.clone());
                if let Ok(rep) =
                    compute_app_composition(app_id, app.workspace_path.clone(), None, None, false)
                        .await
                {
                    reports.push(rep);
                }
            }

            IpcResponse::success(&req.id, json!({ "reports": reports }))
        }

        "ops.telemetry" => {
            let domain = req.params["domain"].as_str().unwrap_or("logs");
            match domain {
                "logs" => {
                    let limit = req.params["limit"].as_u64().unwrap_or(50).min(500) as usize;
                    let category = req.params["category"].as_str();
                    let res = {
                        let Ok(guard) = sre_db.lock() else {
                            return IpcResponse::err(&req.id, "DB_LOCK_ERROR", "Mutex poisoned");
                        };
                        guard.get_logs(limit, category)
                    };
                    match res {
                        Ok(entries) => {
                            let scrubbed: Vec<Value> = entries
                                .into_iter()
                                .map(|e| {
                                    json!({
                                        "id": e.id,
                                        "category": e.category,
                                        "level": e.level,
                                        "message": scrub_secrets(&e.message),
                                        "metadata": e.metadata.map(|m| scrub_secrets(&m)),
                                        "created_at": e.created_at,
                                    })
                                })
                                .collect();
                            IpcResponse::success(&req.id, json!({ "logs": scrubbed }))
                        }
                        Err(e) => IpcResponse::err(&req.id, "DB_QUERY_ERROR", e.to_string()),
                    }
                }
                "posture" => {
                    let posture = detect_network_posture(None).await;
                    IpcResponse::success(&req.id, json!({ "networkPosture": posture }))
                }
                "backups" => match read_backup_ledger(None).await {
                    Ok(summary) => IpcResponse::success(&req.id, json!(summary)),
                    Err(e) => IpcResponse::err(&req.id, "BACKUP_LEDGER_ERROR", e),
                },
                "ssl" => match get_ssl_fleet_status(None).await {
                    Ok(summary) => IpcResponse::success(&req.id, json!(summary)),
                    Err(e) => IpcResponse::err(&req.id, "SSL_FLEET_ERROR", e),
                },
                other => IpcResponse::err(
                    &req.id,
                    "UNKNOWN_TELEMETRY_DOMAIN",
                    format!("Unsupported telemetry domain '{}'", other),
                ),
            }
        }

        other => IpcResponse::err(
            &req.id,
            "UNKNOWN_ACTION",
            format!("Unsupported IPC action '{}'", other),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_exe_channel() {
        assert_eq!(
            classify_exe_channel(
                r"C:\Users\rodrigo\Documents\AG Projects\PanoramaSRE\src-tauri\target\debug\panorama-sre.exe"
            ),
            "dev"
        );
        assert_eq!(
            classify_exe_channel(
                r"C:\Users\rodrigo\AppData\Local\PanoramaSRE\panorama-sre.exe"
            ),
            "installed"
        );
        assert_eq!(
            classify_exe_channel(r"C:\Program Files\PanoramaSRE\panorama-sre.exe"),
            "installed"
        );
    }

    #[tokio::test]
    async fn test_process_ipc_message_hmac_and_ping_roundtrip() {
        let secret = ipc_security::generate_256bit_secret_hex();
        let lease = SreInstanceLease {
            instance_id: "sre-test-1".to_string(),
            pid: std::process::id(),
            pipe_name: r"\\.\pipe\panoramasre-ctl-test".to_string(),
            version: "1.3.1".to_string(),
            channel: "dev".to_string(),
            exe_path: "panorama-sre.exe".to_string(),
            workspace_root: ".".to_string(),
            started_at: "2026-11-11T00:00:00Z".to_string(),
            hmac_secret: secret.clone(),
        };

        let ds = Arc::new(DevSupervisor::new());
        let db = Arc::new(Mutex::new(SreDatabase::new(":memory:").unwrap()));
        let rg = Arc::new(ReplayGuard::new());
        let attestation = CallerAttestation {
            pid: std::process::id(),
            exe_path: "node.exe".to_string(),
            exe_name: "node.exe".to_string(),
            lineage_chain: vec!["node.exe:1".to_string()],
        };

        let now = chrono::Utc::now().timestamp();
        let nonce = "test-nonce-abcdef12";
        let action = "instances.ping";
        let params = json!({});
        let sig = ipc_security::compute_request_hmac(&secret, now, nonce, action, &params);

        let req_str = serde_json::to_string(&IpcRequest {
            id: "req-1".to_string(),
            ts: now,
            nonce: nonce.to_string(),
            action: action.to_string(),
            params: params.clone(),
            sig: sig.clone(),
        })
        .unwrap();

        let resp =
            process_ipc_message(&req_str, &attestation, &None, &lease, &ds, &db, &rg).await;
        assert!(resp.ok);
        assert_eq!(resp.data.unwrap()["instanceId"], "sre-test-1");

        // Replaying the exact same request must be rejected by ReplayGuard
        let replay_resp =
            process_ipc_message(&req_str, &attestation, &None, &lease, &ds, &db, &rg).await;
        assert!(!replay_resp.ok);
        assert_eq!(replay_resp.error.unwrap().code, "AUTH_REPLAY_OR_SKEW");
    }
}
