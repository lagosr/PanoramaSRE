use crate::db::SreDatabase;
use crate::job_manager::{JobManager, JobStatus, ResourceLock};
use crate::scrubber::scrub_secrets;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
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

    channel.send(ProcessOutputChunk {
        job_id: job_id.clone(),
        stream: "system".to_string(),
        line: format!("[RUNNER] Starting: {} {}", request.command, request.args.join(" ")),
        timestamp: chrono::Utc::now().to_rfc3339(),
    }).ok();

    // Prepare async child process with CREATE_NO_WINDOW
    let mut cmd = Command::new(&request.command);
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

    // Wait for streams and process completion
    let _ = tokio::join!(stdout_handle, stderr_handle);
    let status = child.wait().await.map_err(|e| e.to_string())?;
    let exit_code = status.code().unwrap_or(-1);

    job_manager.update_completion(&job_id, Some(exit_code), false).await;

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
