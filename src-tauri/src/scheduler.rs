use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub struct TelemetryScheduler {
    is_running: Arc<AtomicBool>,
}

impl TelemetryScheduler {
    pub fn new() -> Self {
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn start(&self, app_handle: AppHandle) {
        if self.is_running.swap(true, Ordering::SeqCst) {
            return; // Already running
        }

        let running_flag = Arc::clone(&self.is_running);

        tauri::async_runtime::spawn(async move {
            let mut tier1_interval = tokio::time::interval(Duration::from_secs(15));
            let mut tier2_counter = 0u32;
            let mut tier3_counter = 0u32;

            while running_flag.load(Ordering::Relaxed) {
                tier1_interval.tick().await;

                // Emit Tier 1 event
                let _ = app_handle.emit("sre://telemetry-tick", serde_json::json!({
                    "tier": 1,
                    "timestamp": chrono::Utc::now().to_rfc3339()
                }));

                tier2_counter += 15;
                if tier2_counter >= 60 {
                    tier2_counter = 0;
                    // Emit Tier 2 event
                    let _ = app_handle.emit("sre://telemetry-tick", serde_json::json!({
                        "tier": 2,
                        "timestamp": chrono::Utc::now().to_rfc3339()
                    }));
                }

                tier3_counter += 15;
                if tier3_counter >= 300 {
                    tier3_counter = 0;
                    // Emit Tier 3 event
                    let _ = app_handle.emit("sre://telemetry-tick", serde_json::json!({
                        "tier": 3,
                        "timestamp": chrono::Utc::now().to_rfc3339()
                    }));
                }
            }
        });
    }

    pub fn stop(&self) {
        self.is_running.store(false, Ordering::SeqCst);
    }
}
