use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

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
    let max_items = limit.unwrap_or(50);
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
        .current_dir(&dir);

    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute node smoke-tests.ts: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if stdout.is_empty() {
        return Err(format!(
            "Smoke tests produced no JSON output (exit={:?}): {}",
            output.status.code(),
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
        .arg(&trigger)
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

    if let Some(stdout) = child.stdout.take() {
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
        });
    }

    if let Some(stderr) = child.stderr.take() {
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
        });
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed waiting for smoke-tests.ts: {}", e))?;
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
