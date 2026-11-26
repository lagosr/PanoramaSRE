use crate::scrubber::scrub_secrets;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const SURICATA_MAX_SYNS_PER_WINDOW: usize = 2;
pub const SURICATA_WINDOW_SECS: u64 = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OttoRuntimePhase {
    Idle,
    Sensing,
    Stage0Eval,
    Thinking,
    Staging,
    Acting,
    Verifying,
    AwaitingApproval,
    Tripped,
    Paused,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoLifecycleSnapshot {
    pub state: OttoRuntimePhase,
    pub phase_label: String,
    pub active_model: Option<String>,
    pub thinking_level: Option<String>,
    pub current_target: Option<String>,
    pub summary: String,
    pub started_at: Option<String>,
    pub trace_run_id: Option<String>,
    pub can_abort: bool,
    pub kill_switch_active: bool,
    pub circuit_breaker_state: String,
    pub pending_approvals_count: i64,
    pub active_soaks_count: i64,
    pub daily_t1_calls: i64,
    pub daily_t2_calls: i64,
    pub dropped_noise_24h_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuricataGatekeeperStatusDto {
    pub used_last_120s: usize,
    pub max_per_120s: usize,
    pub window_secs: u64,
    pub remaining: usize,
    pub next_slot_in_secs: u64,
    pub gatekeeper_key_path: String,
    pub gatekeeper_key_exists: bool,
    pub gatekeeper_verified: bool,
    pub last_probe_at: Option<String>,
    pub last_probe_detail: String,
}

pub struct SuricataSshBudget {
    timestamps: Mutex<VecDeque<Instant>>,
    max_per_window: usize,
    window: Duration,
    last_probe_at: Mutex<Option<String>>,
    last_probe_detail: Mutex<String>,
    gatekeeper_verified: AtomicBool,
}

impl SuricataSshBudget {
    pub fn new(max_per_window: usize, window_secs: u64) -> Self {
        Self {
            timestamps: Mutex::new(VecDeque::new()),
            max_per_window: max_per_window.max(1),
            window: Duration::from_secs(window_secs.max(1)),
            last_probe_at: Mutex::new(None),
            last_probe_detail: Mutex::new("Standby — ready to probe sre-agent-wsh".to_string()),
            gatekeeper_verified: AtomicBool::new(false),
        }
    }

    pub fn try_acquire_at(&self, now: Instant) -> Result<(), u64> {
        let mut guard = self
            .timestamps
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        while let Some(&front) = guard.front() {
            if now.duration_since(front) >= self.window {
                guard.pop_front();
            } else {
                break;
            }
        }
        if guard.len() >= self.max_per_window {
            let oldest = *guard.front().unwrap();
            let wait = self
                .window
                .saturating_sub(now.duration_since(oldest))
                .as_secs()
                .max(1);
            return Err(wait);
        }
        guard.push_back(now);
        Ok(())
    }

    pub fn try_acquire(&self) -> Result<(), u64> {
        self.try_acquire_at(Instant::now())
    }

    pub fn record_probe_result(&self, verified: bool, detail: &str) {
        self.gatekeeper_verified.store(verified, Ordering::SeqCst);
        if let Ok(mut ts) = self.last_probe_at.lock() {
            *ts = Some(Utc::now().to_rfc3339());
        }
        if let Ok(mut d) = self.last_probe_detail.lock() {
            *d = scrub_secrets(detail);
        }
    }

    pub fn snapshot(&self) -> SuricataGatekeeperStatusDto {
        let now = Instant::now();
        let mut guard = self
            .timestamps
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        while let Some(&front) = guard.front() {
            if now.duration_since(front) >= self.window {
                guard.pop_front();
            } else {
                break;
            }
        }
        let used = guard.len();
        let remaining = self.max_per_window.saturating_sub(used);
        let next_slot_in_secs = if remaining == 0 {
            guard
                .front()
                .map(|&oldest| {
                    self.window
                        .saturating_sub(now.duration_since(oldest))
                        .as_secs()
                        .max(1)
                })
                .unwrap_or(0)
        } else {
            0
        };
        drop(guard);

        let key_path = default_gatekeeper_key_path();
        let key_exists = Path::new(&key_path).exists();
        let last_probe_at = self.last_probe_at.lock().ok().and_then(|g| g.clone());
        let last_probe_detail = self
            .last_probe_detail
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default();

        SuricataGatekeeperStatusDto {
            used_last_120s: used,
            max_per_120s: self.max_per_window,
            window_secs: self.window.as_secs(),
            remaining,
            next_slot_in_secs,
            gatekeeper_key_path: key_path,
            gatekeeper_key_exists: key_exists,
            gatekeeper_verified: self.gatekeeper_verified.load(Ordering::Relaxed),
            last_probe_at,
            last_probe_detail,
        }
    }
}

pub fn default_gatekeeper_key_path() -> String {
    #[cfg(windows)]
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        let p = PathBuf::from(userprofile).join(".ssh").join("sre-agent-wsh");
        return p.to_string_lossy().to_string();
    }
    "C:\\Users\\rodrigo\\.ssh\\sre-agent-wsh".to_string()
}

pub const ALLOWED_WSH_CONTAINERS: &[&str] = &[
    "panorama-auth",
    "spendy-ledger",
    "biomed-maven",
    "water-analyzer",
    "tasty-basket",
    "energy-analyzer",
    "panorama-resources",
    "unifi-siem",
];

pub fn resolve_allowlisted_wsh_container(slug_or_name: &str) -> Option<&'static str> {
    match slug_or_name.trim().to_ascii_lowercase().as_str() {
        "auth" | "panorama-auth" => Some("panorama-auth"),
        "spendy" | "spendy-ledger" => Some("spendy-ledger"),
        "biomed" | "biomed-maven" => Some("biomed-maven"),
        "water" | "water-analyzer" => Some("water-analyzer"),
        "basket" | "tasty-basket" => Some("tasty-basket"),
        "energy" | "energy-analyzer" => Some("energy-analyzer"),
        "res" | "resources" | "panorama-resources" => Some("panorama-resources"),
        "unifi-siem" | "siem" => Some("unifi-siem"),
        _ => None,
    }
}

/// Validates and normalizes a compiled gatekeeper command strictly matching
/// `/usr/local/bin/sre-agent-gatekeeper.sh` (4 verbs only, zero shell metacharacters).
pub fn validate_gatekeeper_command(raw_verb: &str) -> Result<String, String> {
    let trimmed = raw_verb.trim();
    if trimmed.is_empty() {
        return Err("Gatekeeper command cannot be empty".to_string());
    }
    if trimmed.contains([';', '&', '|', '$', '`', '\n', '\r', '>', '<', '\\', '"', '\'']) {
        return Err("Gatekeeper command contains prohibited shell metacharacters".to_string());
    }
    let tokens: Vec<&str> = trimmed.split_whitespace().collect();
    match tokens.as_slice() {
        ["probe-snapshot"] => Ok("probe-snapshot".to_string()),
        ["probe-logs"] => Ok("probe-logs".to_string()),
        ["restart-container", target] => {
            let safe_name = resolve_allowlisted_wsh_container(target).ok_or_else(|| {
                format!(
                    "Container '{}' is not in compiled WSH gatekeeper allowlist",
                    target
                )
            })?;
            Ok(format!("restart-container {}", safe_name))
        }
        ["container-health", target] => {
            let safe_name = resolve_allowlisted_wsh_container(target).ok_or_else(|| {
                format!(
                    "Container '{}' is not in compiled WSH gatekeeper allowlist",
                    target
                )
            })?;
            Ok(format!("container-health {}", safe_name))
        }
        _ => Err(format!(
            "Gatekeeper verb '{}' is not in the compiled 4-verb allowlist",
            trimmed
        )),
    }
}

/// Executes a strictly compiled verb against WSH using ONLY the dedicated `sre-agent-wsh`
/// Ed25519 key (never `rsa-key-deployment`), enforced by the Suricata SSH SYN token bucket.
pub fn run_gatekeeper_verb(
    budget: &SuricataSshBudget,
    verb: &str,
) -> Result<String, String> {
    let clean_verb = validate_gatekeeper_command(verb)?;

    let key_path = default_gatekeeper_key_path();
    if !Path::new(&key_path).exists() {
        let msg = format!(
            "Dedicated Ed25519 key not provisioned yet at {} (run server-setup gatekeeper setup when ready)",
            key_path
        );
        budget.record_probe_result(false, &msg);
        return Err(msg);
    }

    if let Err(wait_secs) = budget.try_acquire() {
        let msg = format!(
            "Suricata SSH SYN budget exhausted ({}/{} per {}s) — retry in {}s",
            SURICATA_MAX_SYNS_PER_WINDOW,
            SURICATA_MAX_SYNS_PER_WINDOW,
            SURICATA_WINDOW_SECS,
            wait_secs
        );
        budget.record_probe_result(false, &msg);
        return Err(msg);
    }

    let mut cmd = Command::new("ssh.exe");
    cmd.args([
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=8",
        "-i",
        &key_path,
        "root@wsh.panoramadr.com",
        &clean_verb,
    ]);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to invoke ssh.exe for gatekeeper: {}", e))?;

    let stdout = scrub_secrets(&String::from_utf8_lossy(&output.stdout));
    let stderr = scrub_secrets(&String::from_utf8_lossy(&output.stderr));

    if output.status.success() {
        let detail = format!("Gatekeeper verb '{}' succeeded ({} bytes)", clean_verb, stdout.len());
        budget.record_probe_result(true, &detail);
        Ok(stdout)
    } else {
        let detail = format!(
            "Gatekeeper verb '{}' failed ({}): {}",
            clean_verb,
            output.status,
            if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            }
        );
        budget.record_probe_result(false, &detail);
        Err(detail)
    }
}

pub struct OttoRuntimeController {
    lifecycle: Mutex<OttoLifecycleSnapshot>,
    pub ssh_budget: Arc<SuricataSshBudget>,
    abort_requested: AtomicBool,
}

impl Default for OttoRuntimeController {
    fn default() -> Self {
        Self::new()
    }
}

impl OttoRuntimeController {
    pub fn new() -> Self {
        Self {
            lifecycle: Mutex::new(OttoLifecycleSnapshot {
                state: OttoRuntimePhase::Idle,
                phase_label: "Otto: Idle · Shadow".to_string(),
                active_model: None,
                thinking_level: None,
                current_target: None,
                summary: "Standing watch in Shadow / Observe mode".to_string(),
                started_at: None,
                trace_run_id: None,
                can_abort: false,
                kill_switch_active: false,
                circuit_breaker_state: "CLOSED".to_string(),
                pending_approvals_count: 0,
                active_soaks_count: 0,
                daily_t1_calls: 0,
                daily_t2_calls: 0,
                dropped_noise_24h_count: 0,
            }),
            ssh_budget: Arc::new(SuricataSshBudget::new(
                SURICATA_MAX_SYNS_PER_WINDOW,
                SURICATA_WINDOW_SECS,
            )),
            abort_requested: AtomicBool::new(false),
        }
    }

    pub fn snapshot(&self) -> OttoLifecycleSnapshot {
        self.lifecycle
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    pub fn request_abort(&self) {
        self.abort_requested.store(true, Ordering::SeqCst);
    }

    pub fn clear_abort(&self) {
        self.abort_requested.store(false, Ordering::SeqCst);
    }

    pub fn is_abort_requested(&self) -> bool {
        self.abort_requested.load(Ordering::Relaxed)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_phase(
        &self,
        app: Option<&AppHandle>,
        state: OttoRuntimePhase,
        phase_label: impl Into<String>,
        active_model: Option<String>,
        thinking_level: Option<String>,
        current_target: Option<String>,
        summary: impl Into<String>,
        trace_run_id: Option<String>,
        can_abort: bool,
    ) -> OttoLifecycleSnapshot {
        let mut guard = self.lifecycle.lock().unwrap_or_else(|p| p.into_inner());
        guard.state = state;
        guard.phase_label = phase_label.into();
        guard.active_model = active_model;
        guard.thinking_level = thinking_level;
        guard.current_target = current_target;
        guard.summary = scrub_secrets(&summary.into());
        guard.trace_run_id = trace_run_id;
        guard.can_abort = can_abort;
        guard.started_at = if matches!(
            state,
            OttoRuntimePhase::Idle | OttoRuntimePhase::Paused | OttoRuntimePhase::Tripped | OttoRuntimePhase::AwaitingApproval
        ) {
            None
        } else {
            Some(Utc::now().to_rfc3339())
        };
        let snap = guard.clone();
        drop(guard);

        if let Some(handle) = app {
            let _ = handle.emit("sre://agent-lifecycle", &snap);
        }
        snap
    }

    #[allow(clippy::too_many_arguments)]
    pub fn sync_from_db_state(
        &self,
        app: Option<&AppHandle>,
        kill_switch_active: bool,
        circuit_breaker_state: &str,
        pending_approvals_count: i64,
        active_soaks_count: i64,
        daily_t1_calls: i64,
        daily_t2_calls: i64,
        dropped_noise_24h_count: i64,
    ) -> OttoLifecycleSnapshot {
        let mut guard = self.lifecycle.lock().unwrap_or_else(|p| p.into_inner());
        guard.kill_switch_active = kill_switch_active;
        guard.circuit_breaker_state = circuit_breaker_state.to_string();
        guard.pending_approvals_count = pending_approvals_count;
        guard.active_soaks_count = active_soaks_count;
        guard.daily_t1_calls = daily_t1_calls;
        guard.daily_t2_calls = daily_t2_calls;
        guard.dropped_noise_24h_count = dropped_noise_24h_count;

        let is_busy = matches!(
            guard.state,
            OttoRuntimePhase::Sensing
                | OttoRuntimePhase::Stage0Eval
                | OttoRuntimePhase::Thinking
                | OttoRuntimePhase::Staging
                | OttoRuntimePhase::Acting
                | OttoRuntimePhase::Verifying
        );

        if kill_switch_active {
            guard.state = OttoRuntimePhase::Paused;
            guard.phase_label = "Otto: Paused (Kill-Switch)".to_string();
            guard.summary = "Global Emergency Kill-Switch engaged — all mutations halted".to_string();
            guard.can_abort = false;
            guard.started_at = None;
        } else if !is_busy {
            if circuit_breaker_state == "TRIPPED" {
                guard.state = OttoRuntimePhase::Tripped;
                guard.phase_label = "Otto: Breaker Tripped".to_string();
                guard.summary = "Circuit breaker tripped — inspect trace and reset in Policy Matrix".to_string();
            } else if pending_approvals_count > 0 {
                guard.state = OttoRuntimePhase::AwaitingApproval;
                guard.phase_label = format!(
                    "Otto: {} Approval{}",
                    pending_approvals_count,
                    if pending_approvals_count == 1 { "" } else { "s" }
                );
                guard.summary = format!(
                    "{} L3 proposal{} waiting for desktop review{}",
                    pending_approvals_count,
                    if pending_approvals_count == 1 { "" } else { "s" },
                    if active_soaks_count > 0 {
                        format!(" · {} soak{} active", active_soaks_count, if active_soaks_count == 1 { "" } else { "s" })
                    } else {
                        String::new()
                    }
                );
            } else if active_soaks_count > 0 {
                guard.state = OttoRuntimePhase::Verifying;
                guard.phase_label = format!(
                    "Otto: Soaking ({})",
                    active_soaks_count
                );
                guard.summary = format!(
                    "Monitoring {} active 15m post-deploy soak window{}",
                    active_soaks_count,
                    if active_soaks_count == 1 { "" } else { "s" }
                );
            } else {
                guard.state = OttoRuntimePhase::Idle;
                guard.phase_label = "Otto: Idle · Shadow".to_string();
                guard.summary = "Standing watch in Shadow / Observe mode".to_string();
            }
        }

        let snap = guard.clone();
        drop(guard);

        if let Some(handle) = app {
            let _ = handle.emit("sre://agent-lifecycle", &snap);
        }
        snap
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suricata_token_bucket_strictly_enforces_two_syns_per_120s() {
        let budget = SuricataSshBudget::new(2, 120);
        let t0 = Instant::now();

        assert!(budget.try_acquire_at(t0).is_ok());
        assert!(budget.try_acquire_at(t0 + Duration::from_secs(10)).is_ok());
        // 3rd attempt within 120s MUST be rejected with wait time > 0
        let blocked = budget.try_acquire_at(t0 + Duration::from_secs(20));
        assert!(blocked.is_err());
        assert!(blocked.unwrap_err() >= 95);

        // After 121s from first SYN, slot frees up cleanly
        assert!(budget.try_acquire_at(t0 + Duration::from_secs(121)).is_ok());
        // 2nd SYN from t0+10 is still in window, so a 4th immediately at t0+121 must block
        assert!(budget.try_acquire_at(t0 + Duration::from_secs(121)).is_err());
    }

    #[test]
    fn lifecycle_fsm_transitions_and_kill_switch_override() {
        let ctrl = OttoRuntimeController::new();
        let s1 = ctrl.set_phase(
            None,
            OttoRuntimePhase::Thinking,
            "Otto: Thinking (Neon · high)",
            Some("gemini-4-neon".into()),
            Some("high".into()),
            Some("auth".into()),
            "Evaluating detection-defect hypothesis",
            Some("trace-123".into()),
            true,
        );
        assert_eq!(s1.state, OttoRuntimePhase::Thinking);
        assert!(s1.started_at.is_some());
        assert!(s1.can_abort);

        let paused = ctrl.sync_from_db_state(None, true, "CLOSED", 0, 0, 1, 1, 12);
        assert_eq!(paused.state, OttoRuntimePhase::Paused);
        assert!(paused.kill_switch_active);
        assert!(!paused.can_abort);
    }
}
