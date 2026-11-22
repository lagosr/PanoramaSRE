use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;

const SMOKE_TIMEOUT_SECS: u64 = 180;

fn terminate_process_tree(pid: Option<u32>) {
    #[cfg(windows)]
    if let Some(target_pid) = pid {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &target_pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
    #[cfg(not(windows))]
    let _ = pid;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmokeCheckResult {
    pub name: String,
    pub category: String,
    pub passed: bool,
    pub duration_ms: u64,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmokeTestRun {
    pub id: String,
    pub timestamp: String,
    pub target_url: String,
    pub triggered_by: String,
    pub env_only: bool,
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
    pub results: Vec<SmokeCheckResult>,
}

fn smoke_tester_dir(workspace_root: &str) -> PathBuf {
    PathBuf::from(workspace_root)
        .join("PanoramaDrSuite")
        .join("tools")
        .join("smoke-tester")
}

/// Validates and normalizes an IPC `triggeredBy` label for smoke runs.
pub fn sanitize_smoke_trigger(raw: Option<&str>) -> String {
    let trimmed = raw.unwrap_or("").trim();
    if trimmed.is_empty() || trimmed.len() > 96 {
        return "mcp-agent".to_string();
    }
    if trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == ':' || c == '_' || c == '-' || c == ',')
    {
        trimmed.to_string()
    } else {
        "mcp-agent".to_string()
    }
}

/// Validates an optional IPC `targetUrl` override for smoke runs.
pub fn sanitize_smoke_target_url(raw: Option<&str>) -> Option<String> {
    let trimmed = raw.unwrap_or("").trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return None;
    }
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return None;
    }
    if trimmed.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }
    Some(trimmed.to_string())
}

#[tauri::command]
pub async fn get_smoke_test_history(
    workspace_root: String,
    limit: Option<usize>,
) -> Result<Vec<SmokeTestRun>, String> {
    let history_path = smoke_tester_dir(&workspace_root)
        .join("logs")
        .join("smoke-history.jsonl");

    if !history_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&history_path)
        .map_err(|e| format!("Failed to read smoke-history.jsonl: {}", e))?;

    let mut runs: Vec<SmokeTestRun> = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<SmokeTestRun>(line).ok())
        .collect();

    runs.reverse();
    let max_items = limit.unwrap_or(500);
    if runs.len() > max_items {
        runs.truncate(max_items);
    }

    Ok(runs)
}

#[tauri::command]
pub async fn run_smoke_tests_now(
    workspace_root: String,
    target_url: Option<String>,
    triggered_by: Option<String>,
) -> Result<SmokeTestRun, String> {
    let dir = smoke_tester_dir(&workspace_root);
    let script_path = dir.join("smoke-tests.ts");
    if !script_path.exists() {
        return Err(format!(
            "Smoke test script not found at {}",
            script_path.display()
        ));
    }

    let target = target_url.unwrap_or_else(|| "https://wsh.panoramadr.com".to_string());
    let trigger = triggered_by.unwrap_or_else(|| "sre-manual".to_string());

    let mut cmd = Command::new("node");
    cmd.arg("--experimental-strip-types")
        .arg(&script_path)
        .arg("--target")
        .arg(&target)
        .arg("--triggered-by")
        .arg(&trigger)
        .arg("--json")
        .current_dir(&dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn node smoke-tests.ts: {}", e))?;
    let child_pid = child.id();

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let stdout_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(mut s) = stdout_pipe {
            let _ = s.read_to_end(&mut buf).await;
        }
        String::from_utf8_lossy(&buf).trim().to_string()
    });
    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(mut s) = stderr_pipe {
            let _ = s.read_to_end(&mut buf).await;
        }
        String::from_utf8_lossy(&buf).trim().to_string()
    });

    let wait_res = tokio::time::timeout(Duration::from_secs(SMOKE_TIMEOUT_SECS), child.wait()).await;
    let status = match wait_res {
        Ok(res) => res.map_err(|e| format!("Failed waiting for smoke-tests.ts: {}", e))?,
        Err(_) => {
            terminate_process_tree(child_pid);
            let _ = child.kill().await;
            return Err(format!(
                "Smoke test run timed out after {}s",
                SMOKE_TIMEOUT_SECS
            ));
        }
    };

    let stdout = stdout_task.await.unwrap_or_default();
    let stderr = stderr_task.await.unwrap_or_default();

    if stdout.is_empty() {
        return Err(format!(
            "Smoke tests produced no JSON output (exit={:?}): {}",
            status.code(),
            stderr
        ));
    }

    serde_json::from_str::<SmokeTestRun>(&stdout).map_err(|e| {
        format!(
            "Failed to parse smoke test JSON output ({}): {}",
            e, stdout
        )
    })
}

/// Runs the production smoke test suite while streaming live stdout/stderr lines
/// to the PanoramaSRE UI (`sre://smoke-run-start`, `sre://smoke-run-line`, `sre://smoke-run-complete`)
/// and returns the resulting `SmokeTestRun` record from `logs/smoke-history.jsonl`.
pub async fn run_smoke_tests_streaming(
    app_handle: &Option<AppHandle>,
    workspace_root: String,
    target_url: Option<String>,
    triggered_by: Option<String>,
    force_sms: bool,
) -> Result<SmokeTestRun, String> {
    let dir = smoke_tester_dir(&workspace_root);
    let script_path = dir.join("smoke-tests.ts");
    if !script_path.exists() {
        return Err(format!(
            "Smoke test script not found at {}",
            script_path.display()
        ));
    }

    let target = target_url.unwrap_or_else(|| "https://wsh.panoramadr.com".to_string());
    let trigger = triggered_by.unwrap_or_else(|| "mcp-agent".to_string());
    let job_id = format!("smoke-{}-{}", trigger, chrono::Utc::now().timestamp_millis());

    if let Some(app) = app_handle {
        let _ = app.emit(
            "sre://smoke-run-start",
            json!({
                "jobId": job_id,
                "triggeredBy": trigger,
                "targetUrl": target,
            }),
        );
    }

    let mut cmd = Command::new("node");
    cmd.arg("--experimental-strip-types")
        .arg(&script_path)
        .arg("--target")
        .arg(&target)
        .arg("--triggered-by")
        .arg(&trigger);
    if force_sms {
        cmd.arg("--force-sms");
    }
    cmd.current_dir(&dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn node smoke-tests.ts: {}", e))?;
    let child_pid = child.id();

    let stdout_handle = child.stdout.take().map(|stdout| {
        let app_clone = app_handle.clone();
        let job_id_clone = job_id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(ref app) = app_clone {
                    let _ = app.emit(
                        "sre://smoke-run-line",
                        json!({
                            "jobId": job_id_clone,
                            "line": line,
                        }),
                    );
                }
            }
        })
    });

    let stderr_handle = child.stderr.take().map(|stderr| {
        let app_clone = app_handle.clone();
        let job_id_clone = job_id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(ref app) = app_clone {
                    let _ = app.emit(
                        "sre://smoke-run-line",
                        json!({
                            "jobId": job_id_clone,
                            "line": line,
                        }),
                    );
                }
            }
        })
    });

    let status = match tokio::time::timeout(Duration::from_secs(SMOKE_TIMEOUT_SECS), child.wait())
        .await
    {
        Ok(res) => res.map_err(|e| format!("Failed waiting for smoke-tests.ts: {}", e))?,
        Err(_) => {
            terminate_process_tree(child_pid);
            let _ = child.kill().await;
            let err_msg = format!("Smoke test run timed out after {}s", SMOKE_TIMEOUT_SECS);
            if let Some(app) = app_handle {
                let _ = app.emit(
                    "sre://smoke-run-line",
                    json!({
                        "jobId": job_id,
                        "line": format!("[SMOKE] ERROR: {}", err_msg),
                    }),
                );
                let _ = app.emit(
                    "sre://smoke-run-complete",
                    json!({
                        "jobId": job_id,
                        "exitCode": 124,
                    }),
                );
            }
            return Err(err_msg);
        }
    };

    let _ = tokio::time::timeout(Duration::from_secs(3), async {
        if let Some(h) = stdout_handle {
            let _ = h.await;
        }
        if let Some(h) = stderr_handle {
            let _ = h.await;
        }
    })
    .await;

    let exit_code = status.code().unwrap_or(-1);

    let history = get_smoke_test_history(workspace_root, Some(1)).await?;
    let latest_run = history
        .into_iter()
        .next()
        .ok_or_else(|| format!("Smoke test finished (exit={}) without recording a run in smoke-history.jsonl", exit_code))?;

    if let Some(app) = app_handle {
        let _ = app.emit(
            "sre://smoke-run-complete",
            json!({
                "jobId": job_id,
                "exitCode": exit_code,
                "run": latest_run,
            }),
        );
    }

    Ok(latest_run)
}
