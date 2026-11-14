use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const DEFAULT_TIER1_SECS: u32 = 15;
pub const TIER2_SECS: u32 = 60;
pub const DEFAULT_TIER3_SECS: u32 = 300;
pub const TIER4_SECS: u32 = 3600;

/// Evaluates which scheduler tiers are due on a tick given the elapsed counters and step duration.
/// Always includes Tier 1, and coalesces Tier 2 (60s), Tier 3 (configurable, default 300s),
/// and Tier 4 (3600s / 1 hour) when their respective thresholds are reached.
pub fn evaluate_due_tiers(
    elapsed_tier2: &mut u32,
    elapsed_tier3: &mut u32,
    elapsed_tier4: &mut u32,
    step_secs: u32,
    tier3_target_secs: u32,
) -> Vec<u8> {
    let mut due = vec![1u8];
    let t3_target = tier3_target_secs.max(TIER2_SECS);

    *elapsed_tier2 = elapsed_tier2.saturating_add(step_secs);
    if *elapsed_tier2 >= TIER2_SECS {
        *elapsed_tier2 = 0;
        due.push(2);
    }

    *elapsed_tier3 = elapsed_tier3.saturating_add(step_secs);
    if *elapsed_tier3 >= t3_target {
        *elapsed_tier3 = 0;
        due.push(3);
    }

    *elapsed_tier4 = elapsed_tier4.saturating_add(step_secs);
    if *elapsed_tier4 >= TIER4_SECS {
        *elapsed_tier4 = 0;
        due.push(4);
    }

    due
}

pub struct TelemetryScheduler {
    is_running: Arc<AtomicBool>,
    tier1_secs: Arc<AtomicU32>,
    tier3_secs: Arc<AtomicU32>,
}

impl TelemetryScheduler {
    pub fn new() -> Self {
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
            tier1_secs: Arc::new(AtomicU32::new(DEFAULT_TIER1_SECS)),
            tier3_secs: Arc::new(AtomicU32::new(DEFAULT_TIER3_SECS)),
        }
    }

    pub fn set_intervals(&self, tier1_secs: Option<u32>, tier3_secs: Option<u32>) {
        if let Some(t1) = tier1_secs {
            self.tier1_secs.store(t1.max(5), Ordering::SeqCst);
        }
        if let Some(t3) = tier3_secs {
            self.tier3_secs.store(t3.max(TIER2_SECS), Ordering::SeqCst);
        }
    }

    pub fn get_intervals(&self) -> (u32, u32) {
        (
            self.tier1_secs.load(Ordering::Relaxed).max(5),
            self.tier3_secs.load(Ordering::Relaxed).max(TIER2_SECS),
        )
    }

    pub fn start(&self, app_handle: AppHandle) {
        if self.is_running.swap(true, Ordering::SeqCst) {
            return; // Already running
        }

        let running_flag = Arc::clone(&self.is_running);
        let tier1_ref = Arc::clone(&self.tier1_secs);
        let tier3_ref = Arc::clone(&self.tier3_secs);

        tauri::async_runtime::spawn(async move {
            let mut tier2_counter = 0u32;
            let mut tier3_counter = 0u32;
            let mut tier4_counter = 0u32;

            while running_flag.load(Ordering::Relaxed) {
                let step_secs = tier1_ref.load(Ordering::Relaxed).max(5);
                tokio::time::sleep(Duration::from_secs(step_secs as u64)).await;

                if !running_flag.load(Ordering::Relaxed) {
                    break;
                }

                let t3_target = tier3_ref.load(Ordering::Relaxed).max(TIER2_SECS);
                let due_tiers = evaluate_due_tiers(
                    &mut tier2_counter,
                    &mut tier3_counter,
                    &mut tier4_counter,
                    step_secs,
                    t3_target,
                );
                let highest_tier = *due_tiers.iter().max().unwrap_or(&1);

                let _ = app_handle.emit(
                    "sre://telemetry-tick",
                    serde_json::json!({
                        "tier": highest_tier,
                        "tiers": due_tiers,
                        "timestamp": chrono::Utc::now().to_rfc3339()
                    }),
                );
            }
        });
    }

    pub fn stop(&self) {
        self.is_running.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
pub fn update_scheduler_intervals(
    scheduler: tauri::State<'_, Arc<TelemetryScheduler>>,
    tier1_secs: Option<u32>,
    tier3_secs: Option<u32>,
) -> Result<(u32, u32), String> {
    scheduler.set_intervals(tier1_secs, tier3_secs);
    Ok(scheduler.get_intervals())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evaluates_four_tier_boundaries_and_coalesces_ticks() {
        let mut t2 = 0u32;
        let mut t3 = 0u32;
        let mut t4 = 0u32;

        // Tick 1..3 (15s, 30s, 45s): only Tier 1
        for _ in 0..3 {
            assert_eq!(evaluate_due_tiers(&mut t2, &mut t3, &mut t4, 15, 300), vec![1]);
        }

        // Tick 4 (60s): Tier 1 + Tier 2
        assert_eq!(evaluate_due_tiers(&mut t2, &mut t3, &mut t4, 15, 300), vec![1, 2]);
        assert_eq!(t2, 0);

        // Advance to 300s (16 more ticks = 20 total ticks * 15s = 300s)
        let mut last = Vec::new();
        for _ in 0..16 {
            last = evaluate_due_tiers(&mut t2, &mut t3, &mut t4, 15, 300);
        }
        assert_eq!(last, vec![1, 2, 3]);
        assert_eq!(t3, 0);

        // Advance remaining 220 ticks to reach 3600s (240 * 15s = 3600s)
        for _ in 0..220 {
            last = evaluate_due_tiers(&mut t2, &mut t3, &mut t4, 15, 300);
        }
        assert_eq!(last, vec![1, 2, 3, 4]);
        assert_eq!(t4, 0);
    }

    #[test]
    fn respects_configurable_tier1_and_tier3_intervals() {
        let mut t2 = 0u32;
        let mut t3 = 0u32;
        let mut t4 = 0u32;

        // 30s step, 180s (3m) Tier 3
        assert_eq!(evaluate_due_tiers(&mut t2, &mut t3, &mut t4, 30, 180), vec![1]);
        assert_eq!(evaluate_due_tiers(&mut t2, &mut t3, &mut t4, 30, 180), vec![1, 2]); // 60s
        assert_eq!(evaluate_due_tiers(&mut t2, &mut t3, &mut t4, 30, 180), vec![1]);    // 90s
        assert_eq!(evaluate_due_tiers(&mut t2, &mut t3, &mut t4, 30, 180), vec![1, 2]); // 120s
        assert_eq!(evaluate_due_tiers(&mut t2, &mut t3, &mut t4, 30, 180), vec![1]);    // 150s
        assert_eq!(evaluate_due_tiers(&mut t2, &mut t3, &mut t4, 30, 180), vec![1, 2, 3]); // 180s
    }
}
