use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ResourceLock {
    WshRemoteMutation, // Serializes all deploy, restore, remote restart tasks FIFO
    LocalBackupIo,     // Serializes local backup extraction / compression
    PortainerApi,      // Serializes Portainer API calls
    PesterRunner,      // Serializes Pester test execution
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobStatus {
    pub id: String,
    pub label: String,
    pub lock_type: ResourceLock,
    pub status: String, // "queued", "running", "completed", "failed", "aborted"
    pub pid: Option<u32>,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub exit_code: Option<i32>,
}

pub struct JobManager {
    // Queues and active locks
    locks: Mutex<HashMap<ResourceLock, Arc<tokio::sync::Mutex<()>>>>,
    active_jobs: Mutex<HashMap<String, JobStatus>>,
    running_pids: Mutex<HashMap<String, u32>>,
}

impl JobManager {
    pub fn new() -> Self {
        let mut map = HashMap::new();
        map.insert(ResourceLock::WshRemoteMutation, Arc::new(tokio::sync::Mutex::new(())));
        map.insert(ResourceLock::LocalBackupIo, Arc::new(tokio::sync::Mutex::new(())));
        map.insert(ResourceLock::PortainerApi, Arc::new(tokio::sync::Mutex::new(())));
        map.insert(ResourceLock::PesterRunner, Arc::new(tokio::sync::Mutex::new(())));

        JobManager {
            locks: Mutex::new(map),
            active_jobs: Mutex::new(HashMap::new()),
            running_pids: Mutex::new(HashMap::new()),
        }
    }

    pub async fn get_lock(&self, lock_type: ResourceLock) -> Option<Arc<tokio::sync::Mutex<()>>> {
        let locks = self.locks.lock().await;
        locks.get(&lock_type).cloned()
    }

    pub async fn register_job(&self, status: JobStatus) {
        let mut jobs = self.active_jobs.lock().await;
        jobs.insert(status.id.clone(), status);
    }

    pub async fn attach_pid(&self, job_id: &str, pid: u32) {
        let mut pids = self.running_pids.lock().await;
        pids.insert(job_id.to_string(), pid);

        let mut jobs = self.active_jobs.lock().await;
        if let Some(j) = jobs.get_mut(job_id) {
            j.pid = Some(pid);
            j.status = "running".to_string();
        }
    }

    pub async fn update_completion(&self, job_id: &str, exit_code: Option<i32>, aborted: bool) {
        let mut pids = self.running_pids.lock().await;
        pids.remove(job_id);

        let mut jobs = self.active_jobs.lock().await;
        if let Some(j) = jobs.get_mut(job_id) {
            j.completed_at = Some(chrono::Utc::now().to_rfc3339());
            j.exit_code = exit_code;
            j.status = if aborted {
                "aborted".to_string()
            } else if exit_code == Some(0) {
                "completed".to_string()
            } else {
                "failed".to_string()
            };
        }
    }

    pub async fn abort_job(&self, job_id: &str) -> Result<(), String> {
        let pid = {
            let pids = self.running_pids.lock().await;
            pids.get(job_id).copied()
        };

        if let Some(pid) = pid {
            // Terminate whole process tree cleanly on Windows
            #[cfg(target_os = "windows")]
            {
                let output = Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .output()
                    .map_err(|e| format!("Failed to execute taskkill: {}", e))?;

                if !output.status.success() {
                    let err = String::from_utf8_lossy(&output.stderr);
                    return Err(format!("taskkill failed: {}", err));
                }
            }

            self.update_completion(job_id, None, true).await;
            Ok(())
        } else {
            Err(format!("Job {} is not currently running a tracked process", job_id))
        }
    }

    pub async fn abort_all(&self) {
        let pids: Vec<(String, u32)> = {
            let map = self.running_pids.lock().await;
            map.iter().map(|(k, v)| (k.clone(), *v)).collect()
        };

        for (job_id, pid) in pids {
            #[cfg(target_os = "windows")]
            {
                let _ = Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .output();
            }
            self.update_completion(&job_id, None, true).await;
        }
    }

    pub async fn list_jobs(&self) -> Vec<JobStatus> {
        let jobs = self.active_jobs.lock().await;
        jobs.values().cloned().collect()
    }
}
