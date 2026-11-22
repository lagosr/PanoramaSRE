use crate::db::SreDatabase;
use crate::job_manager::{JobManager, JobStatus, ResourceLock};
use crate::scrubber::scrub_secrets;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::State;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessOutputChunk {
    pub job_id: String,
    pub stream: String, // "stdout", "stderr", "system"
    pub line: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunCommandRequest {
    pub job_id: String,
    pub label: String,
    pub command: String,
    pub args: Vec<String>,
    pub working_dir: Option<String>,
    pub lock_type: ResourceLock,
    pub elevated: bool,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

#[tauri::command]
pub async fn run_process_stream(
    request: RunCommandRequest,
    channel: Channel<ProcessOutputChunk>,
    job_manager: State<'_, Arc<JobManager>>,
    db: State<'_, Arc<Mutex<SreDatabase>>>,
) -> Result<i32, String> {
    let job_id = request.job_id.clone();
    let lock_type = request.lock_type;

    if let Ok(guard) = db.lock() {
        let _ = guard.log_action(
            "RUNNER",
            "INFO",
            &format!("Job registered: {}", request.label),
            Some(&format!("job_id={}, cmd={} {}", job_id, request.command, request.args.join(" "))),
        );
    }

    // Register job status as queued
    job_manager.register_job(JobStatus {
        id: job_id.clone(),
        label: request.label.clone(),
        lock_type,
        status: "queued".to_string(),
        pid: None,
        started_at: chrono::Utc::now().to_rfc3339(),
        completed_at: None,
        exit_code: None,
    }).await;

    // Acquire FIFO lock if required
    let maybe_lock_arc = job_manager.get_lock(lock_type).await;
    let _lock_guard = match &maybe_lock_arc {
        Some(lock_arc) => {
            channel.send(ProcessOutputChunk {
                job_id: job_id.clone(),
                stream: "system".to_string(),
                line: format!("[RESOURCE_LOCK] Waiting for {:?} lock...", lock_type),
                timestamp: chrono::Utc::now().to_rfc3339(),
            }).ok();
            Some(lock_arc.lock().await)
        }
        None => None,
    };

    let resolved_command = if request.command.eq_ignore_ascii_case("powershell.exe")
        || request.command.eq_ignore_ascii_case("powershell")
    {
        "pwsh.exe".to_string()
    } else {
        request.command.clone()
    };

    channel.send(ProcessOutputChunk {
        job_id: job_id.clone(),
        stream: "system".to_string(),
        line: format!("[RUNNER] Starting: {} {}", resolved_command, request.args.join(" ")),
        timestamp: chrono::Utc::now().to_rfc3339(),
    }).ok();

    // Prepare async child process with CREATE_NO_WINDOW
    let mut cmd = Command::new(&resolved_command);
    cmd.args(&request.args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(wd) = request.working_dir {
        cmd.current_dir(wd);
    }

    #[cfg(target_os = "windows")]
    {
        // CREATE_NO_WINDOW = 0x08000000
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn process: {}", e))?;

    if let Some(pid) = child.id() {
        job_manager.attach_pid(&job_id, pid).await;
        if let Ok(guard) = db.lock() {
            let _ = guard.log_action("RUNNER", "INFO", &format!("Process spawned: PID {}", pid), Some(&format!("job_id={}", job_id)));
        }
        channel.send(ProcessOutputChunk {
            job_id: job_id.clone(),
            stream: "system".to_string(),
            line: format!("[RUNNER] Attached to PID: {}", pid),
            timestamp: chrono::Utc::now().to_rfc3339(),
        }).ok();
    }

    // Stream stdout & stderr concurrently with real-time secret scrubbing and DB persistence
    let stdout = child.stdout.take().expect("Failed to open stdout");
    let stderr = child.stderr.take().expect("Failed to open stderr");

    let channel_stdout = channel.clone();
    let job_id_stdout = job_id.clone();
    let db_stdout = Arc::clone(&db);
    let stdout_handle = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let scrubbed = scrub_secrets(&line);
            if let Ok(guard) = db_stdout.lock() {
                let _ = guard.log_action("STREAM", "INFO", &scrubbed, Some(&format!("job_id={}", job_id_stdout)));
            }
            let _ = channel_stdout.send(ProcessOutputChunk {
                job_id: job_id_stdout.clone(),
                stream: "stdout".to_string(),
                line: scrubbed,
                timestamp: chrono::Utc::now().to_rfc3339(),
            });
        }
    });

    let channel_stderr = channel.clone();
    let job_id_stderr = job_id.clone();
    let db_stderr = Arc::clone(&db);
    let stderr_handle = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let scrubbed = scrub_secrets(&line);
            if let Ok(guard) = db_stderr.lock() {
                let _ = guard.log_action("STREAM", "WARN", &scrubbed, Some(&format!("job_id={}", job_id_stderr)));
            }
            let _ = channel_stderr.send(ProcessOutputChunk {
                job_id: job_id_stderr.clone(),
                stream: "stderr".to_string(),
                line: scrubbed,
                timestamp: chrono::Utc::now().to_rfc3339(),
            });
        }
    });

    // Wait for process completion with optional watchdog timeout (defaults to 1800s)
    let effective_timeout_secs = request.timeout_secs.unwrap_or(1800);
    let mut timed_out = false;
    let exit_code: i32 = if effective_timeout_secs > 0 {
        match tokio::time::timeout(Duration::from_secs(effective_timeout_secs), child.wait()).await {
            Ok(wait_res) => {
                let status = wait_res.map_err(|e| e.to_string())?;
                status.code().unwrap_or(-1)
            }
            Err(_) => {
                timed_out = true;
                let timeout_msg = format!(
                    "[RUNNER] ERROR: Job timed out after {}s; terminating process tree",
                    effective_timeout_secs
                );
                if let Ok(guard) = db.lock() {
                    let _ = guard.log_action(
                        "RUNNER",
                        "ERROR",
                        &timeout_msg,
                        Some(&format!("job_id={}", job_id)),
                    );
                }
                let _ = channel.send(ProcessOutputChunk {
                    job_id: job_id.clone(),
                    stream: "stderr".to_string(),
                    line: timeout_msg,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                });
                if job_manager.abort_job(&job_id).await.is_err() {
                    let _ = child.kill().await;
                }
                124
            }
        }
    } else {
        let status = child.wait().await.map_err(|e| e.to_string())?;
        status.code().unwrap_or(-1)
    };

    // Allow stdout/stderr reader tasks to drain briefly after process exit/termination
    let _ = tokio::time::timeout(Duration::from_secs(3), async {
        let _ = tokio::join!(stdout_handle, stderr_handle);
    })
    .await;

    job_manager.update_completion(&job_id, Some(exit_code), timed_out).await;

    if let Ok(guard) = db.lock() {
        let _ = guard.log_action(
            "RUNNER",
            if exit_code == 0 { "INFO" } else { "ERROR" },
            &format!("Job completed with exit code {}", exit_code),
            Some(&format!("job_id={}, code={}", job_id, exit_code)),
        );
    }

    channel.send(ProcessOutputChunk {
        job_id: job_id.clone(),
        stream: "system".to_string(),
        line: format!("[RUNNER] Process exited with code: {}", exit_code),
        timestamp: chrono::Utc::now().to_rfc3339(),
    }).ok();

    Ok(exit_code)
}

#[tauri::command]
pub async fn abort_process(job_id: String, job_manager: State<'_, Arc<JobManager>>) -> Result<(), String> {
    job_manager.abort_job(&job_id).await
}

#[tauri::command]
pub async fn list_active_jobs(job_manager: State<'_, Arc<JobManager>>) -> Result<Vec<JobStatus>, String> {
    Ok(job_manager.list_jobs().await)
}
