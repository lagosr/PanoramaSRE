use crate::commands::telemetry_ops::parse_docker_system_df_json;
use crate::commands::threat_intel_ops::{
    free_plan_rule_limit_for_plan, resolve_cf_account_and_zones, resolve_cf_api_token,
    shared_cf_http_client,
};
use crate::commands::workspace::resolve_suite_workspace_root;
use crate::db::SreDatabase;
use crate::job_manager::{JobManager, JobStatus, ResourceLock};
use crate::otto_db::{OttoHandoffPacketRow, OttoWafLeaseRow};
use crate::otto_defense::{
    apply_cloudflare_waf_lease_via_api, build_compiled_waf_expression, CLOUDFLARE_API_BASE_URL,
    DEFAULT_TEMP_CHALLENGE_TTL_MINS,
};
use crate::otto_policy::{
    evaluate_policy_decision, AssetTier, AutonomyMode, PolicyEvalRequest, PolicyVerdict,
};
use crate::otto_runtime::{
    resolve_allowlisted_wsh_container, run_gatekeeper_verb, OttoRuntimeController, OttoRuntimePhase,
};
use crate::pushover::{maybe_notify_otto_event, FormattedBulletItem, OttoPushoverCategory};
use crate::scrubber::scrub_secrets;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use uuid::Uuid;

// ============================================================================
// Calibrated Phase 2 Constants (1:1 parity with deployHistoryAnalytics.ts & PRD)
// ============================================================================

pub const DEFAULT_SOAK_DURATION_SECS: i64 = 900; // 15 minutes
pub const BUILDKIT_RECLAIMABLE_WARN_BYTES: u64 = 35_000_000_000; // 35 GB reclaimable
pub const BUILDKIT_TOTAL_WARN_BYTES: u64 = 100_000_000_000; // 100 GB total
pub const CASCADE_DEGRADED_APP_THRESHOLD: usize = 2; // >=2 apps degraded in 5m -> shared infra L3
pub const GLOBAL_L2_MAX_PER_HOUR: i64 = 3;
pub const SSL_RENEW_THRESHOLD_DAYS: i64 = 21;

/// Calibrated BuildKit cache hygiene threshold matching `isBuildKitCacheHigh()` in TS.
pub fn is_buildkit_cache_high(reclaimable_bytes: u64, total_bytes: u64) -> bool {
    reclaimable_bytes >= BUILDKIT_RECLAIMABLE_WARN_BYTES || total_bytes >= BUILDKIT_TOTAL_WARN_BYTES
}

/// Strictly compiled BuildKit prune arguments (zero LLM-constructed flags).
pub fn compiled_buildkit_prune_args() -> Vec<String> {
    vec![
        "buildx".to_string(),
        "prune".to_string(),
        "--all".to_string(),
        "--filter".to_string(),
        "until=72h".to_string(),
        "-f".to_string(),
    ]
}

/// Validates a Docker image / Git rollback tag (strictly alphanumeric + `._+-`, no leading `-`).
pub fn is_valid_rollback_tag(raw: &str) -> bool {
    let clean = raw.trim();
    if clean.is_empty() || clean.len() > 64 || clean.starts_with('-') {
        return false;
    }
    clean
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-'))
}

/// Returns true if an execution recorded at `last_exec_iso` is still inside `cooldown_secs`.
pub fn is_cooldown_active(
    last_exec_iso: Option<&str>,
    cooldown_secs: i64,
    now_utc: DateTime<Utc>,
) -> bool {
    let Some(raw) = last_exec_iso else {
        return false;
    };
    let Ok(parsed) = DateTime::parse_from_rfc3339(raw.trim()) else {
        return false;
    };
    let elapsed = now_utc
        .signed_duration_since(parsed.with_timezone(&Utc))
        .num_seconds();
    elapsed >= 0 && elapsed < cooldown_secs.max(0)
}

// ============================================================================
// Pure Post-Deployment Soak & Self-Healing Decision State Machine (Unit Tested)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoakSample {
    pub timestamp: String,
    pub healthy: bool,
    pub latency_ms: Option<u64>,
    pub container_state: Option<String>,
    pub detail: String,
}

#[derive(Debug, Clone)]
pub struct SoakEvaluationInput {
    pub app_slug: String,
    pub hosting_target: String,
    pub asset_tier: AssetTier,
    pub release_id: String,
    pub previous_image_tag: Option<String>,
    pub has_db_migration: bool,
    pub window_elapsed: bool,
    pub consecutive_unhealthy: usize,
    pub degraded_apps_in_window: Vec<String>,
    pub rollback_policy_mode: AutonomyMode,
    pub restart_policy_mode: AutonomyMode,
    pub kill_switch_active: bool,
    pub circuit_breaker_tripped: bool,
    pub rollback_cooldown_active: bool,
    pub restart_cooldown_active: bool,
    pub hourly_l2_executions: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SoakDecision {
    ContinueSoaking,
    HealthyVerified,
    CascadeEscalateL3 {
        degraded_apps: Vec<String>,
        reason: String,
    },
    ShadowRollback {
        previous_tag: String,
        reason: String,
    },
    ExecuteL2Rollback {
        previous_tag: String,
        reason: String,
    },
    EscalateL3Rollback {
        previous_tag: Option<String>,
        reason: String,
        blast_radius_flags: Vec<String>,
    },
    ShadowRestart {
        action_id: String,
        container_name: String,
        reason: String,
    },
    ExecuteL2Restart {
        action_id: String,
        container_name: String,
        reason: String,
    },
    EscalateL3Restart {
        action_id: String,
        container_name: String,
        reason: String,
    },
}

/// Pure, deterministic soak failure & recovery evaluator enforcing:
/// 1. Multi-app cascade suppression (>=2 apps degraded -> single shared-infra L3 incident).
/// 2. Tier-0 Critical never auto-rolls back; hard-down restart respects 15m cooldown.
/// 3. Tier-1 DB_MIGRATION == true hard-routes to L3 Approval even in L2_AUTO mode.
/// 4. Tier-1 DB_MIGRATION == false respects SHADOW vs L2_AUTO, cooldowns, kill-switch & breaker.
pub fn evaluate_soak_decision(ctx: &SoakEvaluationInput) -> SoakDecision {
    // 1. Cross-app cascade guard (>=2 apps degraded in same window -> suppress per-app L2!)
    if ctx.degraded_apps_in_window.len() >= CASCADE_DEGRADED_APP_THRESHOLD {
        return SoakDecision::CascadeEscalateL3 {
            degraded_apps: ctx.degraded_apps_in_window.clone(),
            reason: format!(
                "Cross-app cascade detected ({} apps degraded: {}) — suppressing per-app L2 actions and escalating shared infrastructure incident to L3",
                ctx.degraded_apps_in_window.len(),
                ctx.degraded_apps_in_window.join(", ")
            ),
        };
    }

    // 2. If currently healthy (or single transient blip < 2 consecutive probes)
    if ctx.consecutive_unhealthy < 2 {
        if ctx.window_elapsed && ctx.consecutive_unhealthy == 0 {
            return SoakDecision::HealthyVerified;
        }
        return SoakDecision::ContinueSoaking;
    }

    // 3. Confirmed post-deploy regression (>=2 consecutive unhealthy samples)
    let container_name = resolve_allowlisted_wsh_container(&ctx.app_slug)
        .unwrap_or("unknown-container")
        .to_string();

    // Tier-2 (External/Edge): never auto-mutates WSH; escalate to L3
    if ctx.asset_tier == AssetTier::Tier2ExternalEdge {
        return SoakDecision::EscalateL3Rollback {
            previous_tag: ctx.previous_image_tag.clone(),
            reason: format!(
                "Tier-2 external target '{}' failed {} consecutive soak probes — escalated to Desktop L3 Approval",
                ctx.app_slug, ctx.consecutive_unhealthy
            ),
            blast_radius_flags: vec!["TIER2_EXTERNAL_EDGE".to_string()],
        };
    }

    // Tier-0 Critical (PanoramaAuth / unifi-siem): NEVER auto-rolls back!
    // Hard-down single-container restart allowed ONLY if restart_tier0_hard_down policy permits and 15m cooldown clear.
    if ctx.asset_tier == AssetTier::Tier0Critical {
        if ctx.hosting_target == "wsh-docker-service" || ctx.app_slug.eq_ignore_ascii_case("auth") || ctx.app_slug.eq_ignore_ascii_case("unifi-siem") {
            let restart_action = "restart_tier0_hard_down".to_string();
            if ctx.kill_switch_active || ctx.circuit_breaker_tripped || ctx.restart_cooldown_active || ctx.hourly_l2_executions >= GLOBAL_L2_MAX_PER_HOUR {
                return SoakDecision::EscalateL3Restart {
                    action_id: restart_action,
                    container_name,
                    reason: format!(
                        "Tier-0 Critical '{}' failed {} consecutive soak probes (auto-restart suppressed by cooldown/breaker/kill-switch; Tier-0 auto-rollback is permanently disabled)",
                        ctx.app_slug, ctx.consecutive_unhealthy
                    ),
                };
            }
            return match ctx.restart_policy_mode {
                AutonomyMode::Shadow | AutonomyMode::Observe => SoakDecision::ShadowRestart {
                    action_id: restart_action,
                    container_name,
                    reason: format!(
                        "Tier-0 Critical '{}' hard-down across {} consecutive probes — logged Shadow restart (0 remote commands executed; Tier-0 never auto-rolls back)",
                        ctx.app_slug, ctx.consecutive_unhealthy
                    ),
                },
                AutonomyMode::L2Auto => SoakDecision::ExecuteL2Restart {
                    action_id: restart_action,
                    container_name,
                    reason: format!(
                        "Tier-0 Critical '{}' hard-down across {} consecutive probes — executing rate-limited hard-down restart via sre-agent-wsh (Tier-0 auto-rollback forbidden)",
                        ctx.app_slug, ctx.consecutive_unhealthy
                    ),
                },
                _ => SoakDecision::EscalateL3Restart {
                    action_id: restart_action,
                    container_name,
                    reason: format!(
                        "Tier-0 Critical '{}' failed {} consecutive soak probes — requires Desktop L3 Approval",
                        ctx.app_slug, ctx.consecutive_unhealthy
                    ),
                },
            };
        }
        return SoakDecision::EscalateL3Rollback {
            previous_tag: ctx.previous_image_tag.clone(),
            reason: format!(
                "Tier-0 Critical '{}' failed soak — Tier-0 rollbacks strictly require Desktop L3 Approval",
                ctx.app_slug
            ),
            blast_radius_flags: vec!["TIER0_CRITICAL".to_string()],
        };
    }

    // Tier-1 Child Docker App: check DB_MIGRATION hard guard first!
    if ctx.has_db_migration {
        return SoakDecision::EscalateL3Rollback {
            previous_tag: ctx.previous_image_tag.clone(),
            reason: format!(
                "Release '{}' for '{}' carries DB_MIGRATION — auto-rollback is hard-blocked by Policy Kernel; routed to L3 Approval Queue",
                ctx.release_id, ctx.app_slug
            ),
            blast_radius_flags: vec!["DB_MIGRATION".to_string()],
        };
    }

    // Need a valid previous_image_tag for N-3 rollback
    let valid_prev_tag = ctx
        .previous_image_tag
        .as_deref()
        .map(str::trim)
        .filter(|t| is_valid_rollback_tag(t))
        .map(|s| s.to_string());

    let Some(prev_tag) = valid_prev_tag else {
        return SoakDecision::EscalateL3Rollback {
            previous_tag: None,
            reason: format!(
                "Tier-1 '{}' failed {} soak probes but no verified previous N-3 tag was recorded — routed to L3 Approval Queue",
                ctx.app_slug, ctx.consecutive_unhealthy
            ),
            blast_radius_flags: vec!["MISSING_ROLLBACK_TAG".to_string()],
        };
    };

    // Delegate through compiled Rust Policy Kernel for final verdict
    let decision = evaluate_policy_decision(&PolicyEvalRequest {
        action_id: "rollback_n3_db_safe".to_string(),
        asset_slug: ctx.app_slug.clone(),
        asset_tier: ctx.asset_tier,
        configured_mode: ctx.rollback_policy_mode,
        kill_switch_active: ctx.kill_switch_active,
        circuit_breaker_tripped: ctx.circuit_breaker_tripped,
        has_db_migration: ctx.has_db_migration,
        classification: Some("RELIABILITY".to_string()),
        raw_payload_text: format!("rollback {} to {}", ctx.app_slug, prev_tag),
        target_ips: vec![],
        target_asns: vec![],
        target_paths: vec![],
        protected_ips: vec![],
        protected_asns: vec![],
        proposed_semver_bump: None,
    });

    if ctx.rollback_cooldown_active || ctx.hourly_l2_executions >= GLOBAL_L2_MAX_PER_HOUR {
        return SoakDecision::EscalateL3Rollback {
            previous_tag: Some(prev_tag),
            reason: format!(
                "Tier-1 '{}' failed soak, but rollback cooldown (60m) or hourly L2 velocity limit ({}/h) is active — escalated to L3 Approval",
                ctx.app_slug, GLOBAL_L2_MAX_PER_HOUR
            ),
            blast_radius_flags: vec!["COOLDOWN_OR_VELOCITY_GUARD".to_string()],
        };
    }

    match decision.verdict {
        PolicyVerdict::AllowL2Auto => SoakDecision::ExecuteL2Rollback {
            previous_tag: prev_tag,
            reason: format!(
                "Tier-1 '{}' failed {} consecutive soak probes (DB_MIGRATION == false, L2_AUTO active) — executing DB-Safe N-3 rollback",
                ctx.app_slug, ctx.consecutive_unhealthy
            ),
        },
        PolicyVerdict::ShadowOnly | PolicyVerdict::AllowObserve => SoakDecision::ShadowRollback {
            previous_tag: prev_tag,
            reason: format!(
                "Tier-1 '{}' failed {} consecutive soak probes (DB_MIGRATION == false, SHADOW mode) — logged rollback proposal with 0 remote commands",
                ctx.app_slug, ctx.consecutive_unhealthy
            ),
        },
        _ => SoakDecision::EscalateL3Rollback {
            previous_tag: Some(prev_tag),
            reason: format!(
                "Tier-1 '{}' failed {} consecutive soak probes — {}",
                ctx.app_slug, ctx.consecutive_unhealthy, decision.reason
            ),
            blast_radius_flags: vec![],
        },
    }
}

// ============================================================================
// Unified Console Dock Streaming Helper for Compiled Otto Executors
// ============================================================================

fn emit_agent_stream_start(
    app: &AppHandle,
    job_id: &str,
    title: &str,
    app_slug: &str,
    is_human_approved_l3: bool,
) {
    let _ = app.emit(
        "sre://agent-stream-start",
        json!({
            "id": job_id,
            "title": scrub_secrets(title),
            "appSlug": app_slug,
            "source": if is_human_approved_l3 { "ui" } else { "agent" },
            "autoOpenTier": if is_human_approved_l3 { "A" } else { "C" },
            "pageScope": "agent"
        }),
    );
}

fn emit_agent_stream_line(app: &AppHandle, job_id: &str, line: &str) {
    let _ = app.emit(
        "sre://agent-stream-line",
        json!({
            "id": job_id,
            "line": scrub_secrets(line)
        }),
    );
}

fn emit_agent_stream_end(app: &AppHandle, job_id: &str, exit_code: i32) {
    let _ = app.emit(
        "sre://agent-stream-end",
        json!({
            "id": job_id,
            "exitCode": exit_code
        }),
    );
}

// ============================================================================
// Subprocess Runner Helper (Compiled Commands Only — Zero Raw Shell Strings)
// ============================================================================

#[allow(clippy::too_many_arguments)]
async fn run_compiled_process(
    app: &AppHandle,
    job_manager: &Arc<JobManager>,
    job_id: &str,
    label: &str,
    program: &str,
    args: &[String],
    working_dir: Option<&str>,
    lock_type: ResourceLock,
    timeout_secs: u64,
) -> Result<(i32, String), String> {
    job_manager
        .register_job(JobStatus {
            id: job_id.to_string(),
            label: label.to_string(),
            lock_type,
            status: "queued".to_string(),
            pid: None,
            started_at: Utc::now().to_rfc3339(),
            completed_at: None,
            exit_code: None,
        })
        .await;

    let maybe_lock_arc = job_manager.get_lock(lock_type).await;
    let _lock_guard = match &maybe_lock_arc {
        Some(lock_arc) => {
            emit_agent_stream_line(
                app,
                job_id,
                &format!("[OTTO LOCK] Waiting for {:?} mutex...", lock_type),
            );
            Some(lock_arc.lock().await)
        }
        None => None,
    };

    emit_agent_stream_line(
        app,
        job_id,
        &format!("[OTTO EXEC] {} {}", program, args.join(" ")),
    );

    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(wd) = working_dir {
        cmd.current_dir(wd);
    }

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn '{}': {}", program, e))?;

    if let Some(pid) = child.id() {
        job_manager.attach_pid(job_id, pid).await;
    }

    let captured = Arc::new(Mutex::new(Vec::<String>::new()));

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let app_out = app.clone();
    let jid_out = job_id.to_string();
    let cap_out = Arc::clone(&captured);
    let out_task = tokio::spawn(async move {
        if let Some(s) = stdout {
            let mut reader = BufReader::new(s).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let clean = scrub_secrets(&line);
                emit_agent_stream_line(&app_out, &jid_out, &clean);
                if let Ok(mut buf) = cap_out.lock() {
                    if buf.len() < 120 {
                        buf.push(clean);
                    }
                }
            }
        }
    });

    let app_err = app.clone();
    let jid_err = job_id.to_string();
    let cap_err = Arc::clone(&captured);
    let err_task = tokio::spawn(async move {
        if let Some(s) = stderr {
            let mut reader = BufReader::new(s).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let clean = scrub_secrets(&line);
                emit_agent_stream_line(&app_err, &jid_err, &format!("[stderr] {}", clean));
                if let Ok(mut buf) = cap_err.lock() {
                    if buf.len() < 120 {
                        buf.push(clean);
                    }
                }
            }
        }
    });

    let mut timed_out = false;
    let exit_code = match tokio::time::timeout(Duration::from_secs(timeout_secs), child.wait()).await
    {
        Ok(res) => res
            .map_err(|e| format!("Process wait error: {}", e))?
            .code()
            .unwrap_or(-1),
        Err(_) => {
            timed_out = true;
            emit_agent_stream_line(
                app,
                job_id,
                &format!("[OTTO ERROR] Timed out after {}s; aborting process tree", timeout_secs),
            );
            if job_manager.abort_job(job_id).await.is_err() {
                let _ = child.kill().await;
            }
            124
        }
    };

    let _ = tokio::time::timeout(Duration::from_secs(3), async {
        let _ = tokio::join!(out_task, err_task);
    })
    .await;

    job_manager
        .update_completion(job_id, Some(exit_code), timed_out)
        .await;

    let tail_text = captured
        .lock()
        .map(|v| v.join("\n"))
        .unwrap_or_default();
    Ok((exit_code, tail_text))
}

/// Checks whether the local Docker Desktop engine daemon is running and reachable.
pub async fn check_local_docker_daemon() -> Result<String, String> {
    let mut cmd = Command::new("docker");
    cmd.args(["info", "--format", "{{.ServerVersion}}"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = tokio::time::timeout(Duration::from_secs(8), cmd.output())
        .await
        .map_err(|_| {
            "Local Docker Desktop engine timed out responding to `docker info`. Verify Docker Desktop is running on Windows."
                .to_string()
        })?
        .map_err(|e| {
            format!(
                "Docker CLI could not be launched ({}). Ensure Docker Desktop is installed and on PATH.",
                e
            )
        })?;

    if output.status.success() {
        let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok(if ver.is_empty() { "ready".to_string() } else { ver });
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("dockerdesktoplinuxengine")
        || lower.contains("docker_engine")
        || lower.contains("cannot find the file specified")
        || lower.contains("error during connect")
        || lower.contains("daemon is running")
    {
        return Err(
            "Local Docker Desktop is not running. Start Docker Desktop on Windows, wait for the engine to initialize, and click Approve & Execute again."
                .to_string(),
        );
    }

    Err(format!(
        "Local Docker engine pre-flight failed: {}",
        scrub_secrets(&stderr.chars().take(240).collect::<String>())
    ))
}

/// Formats optional `(reclaimable_bytes, total_bytes)` BuildKit stats cleanly for logs.
pub fn format_buildkit_usage(usage: Option<(u64, u64)>) -> String {
    match usage {
        Some((reclaim, total)) => format!(
            "{:.2} GB reclaimable / {:.2} GB total",
            reclaim as f64 / 1_000_000_000.0,
            total as f64 / 1_000_000_000.0
        ),
        None => "unavailable".to_string(),
    }
}

/// Checks local Docker BuildKit disk usage directly via compiled `docker system df --format json`.
async fn read_local_buildkit_bytes() -> Option<(u64, u64)> {
    let mut cmd = Command::new("docker");
    cmd.args(["system", "df", "--format", "{{json .}}"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = tokio::time::timeout(Duration::from_secs(12), cmd.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let parsed = parse_docker_system_df_json(&raw).ok()?;
    let bc = parsed.build_cache;
    Some((bc.reclaimable_bytes, bc.size_bytes))
}

/// Verifies an app's HTTP `/api/health` endpoint after a restart or N-3 rollback.
async fn verify_app_http_recovery(base_path: &str) -> (bool, String) {
    let clean_bp = base_path.trim().trim_end_matches('/');
    if clean_bp.is_empty() {
        return (true, "No HTTP basePath (service target)".to_string());
    }
    let url = format!("https://wsh.panoramadr.com{}/api/health", clean_bp);
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .danger_accept_invalid_certs(true)
        .build()
    else {
        return (false, "Failed creating HTTP verification client".to_string());
    };

    for attempt in 1..=3 {
        if let Ok(resp) = client.get(&url).send().await {
            let code = resp.status().as_u16();
            if resp.status().is_success() {
                return (true, format!("{} returned HTTP {} on probe #{}", url, code, attempt));
            }
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    (false, format!("{} remained unhealthy across 3 post-action probes", url))
}

/// Execution-time fail-closed guard invoked inside `execute_compiled_otto_action`.
/// Ensures that autonomous (`!is_human_approved_l3`) paths NEVER bypass L3/Shadow/Observe,
/// per-action cooldowns, or the global 3/hr L2 velocity cap even when multiple actions are queued.
pub fn validate_execution_time_guards(
    is_human_approved_l3: bool,
    policy_decision: &crate::otto_policy::PolicyDecision,
    cooldown_active: bool,
    hourly_l2_executions: i64,
) -> Result<(), String> {
    if matches!(
        policy_decision.verdict,
        PolicyVerdict::DenyL4HardBlocked
            | PolicyVerdict::DenyKillSwitch
            | PolicyVerdict::DenyCircuitBreaker
    ) {
        return Err(policy_decision.reason.clone());
    }

    if !is_human_approved_l3 {
        if policy_decision.verdict != PolicyVerdict::AllowL2Auto {
            return Err(format!(
                "Autonomous L2 execution denied by Policy Kernel: verdict {:?} requires L3/Shadow/Observe ({})",
                policy_decision.verdict, policy_decision.reason
            ));
        }
        if cooldown_active {
            return Err(
                "Autonomous L2 execution suppressed: per-action cooldown window is still active"
                    .to_string(),
            );
        }
        if hourly_l2_executions >= GLOBAL_L2_MAX_PER_HOUR {
            return Err(format!(
                "Autonomous L2 execution suppressed: global velocity cap reached ({}/{} L2 actions in last hour)",
                hourly_l2_executions, GLOBAL_L2_MAX_PER_HOUR
            ));
        }
    }

    Ok(())
}

// ============================================================================
// Master Parameterized Action Executor (L2 Auto & L3 Human-Approved)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoActionExecutionOutcome {
    pub success: bool,
    pub final_status: String, // VERIFIED | ROLLED_BACK | APPROVED_DRY_RUN | FAILED | BLOCKED
    pub summary: String,
    pub trace_run_id: String,
    pub job_id: Option<String>,
    pub verification_json: String,
}

#[allow(clippy::too_many_arguments)]
pub async fn execute_compiled_otto_action(
    app: &AppHandle,
    db: &Arc<Mutex<SreDatabase>>,
    runtime: &Arc<OttoRuntimeController>,
    job_manager: &Arc<JobManager>,
    action_id: &str,
    asset_slug: &str,
    params_json: &str,
    classification: Option<&str>,
    proposal_id: Option<&str>,
    existing_trace_run_id: Option<&str>,
    is_human_approved_l3: bool,
    note: Option<&str>,
) -> Result<OttoActionExecutionOutcome, String> {
    let started = Instant::now();
    let params_val: Value = serde_json::from_str(params_json).unwrap_or_else(|_| json!({}));

    // 1. Re-validate through compiled Rust Policy Kernel (even on L3 click, L4 & Kill-Switch hold!)
    let (
        trace_run_id,
        asset_tier,
        kill_switch_active,
        circuit_tripped,
        configured_mode,
        cooldown_active,
        hourly_l2_executions,
        suite_root,
        base_step_idx,
        protected_ips,
        protected_asns,
    ) = {
        let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
        let state = guard
            .get_otto_state()
            .map_err(|e| format!("Failed reading Otto state: {}", e))?;
        let policies = guard.list_otto_policies().unwrap_or_default();
        let matched_policy = policies.iter().find(|p| p.action_id == action_id);
        let configured_mode = matched_policy
            .and_then(|p| AutonomyMode::parse(&p.mode))
            .unwrap_or(AutonomyMode::Shadow);
        let cooldown_secs = matched_policy.map(|p| p.cooldown_secs).unwrap_or(900);
        let last_exec_at = guard
            .last_executed_action_at(action_id, asset_slug)
            .ok()
            .flatten();
        let cooldown_active = is_cooldown_active(last_exec_at.as_deref(), cooldown_secs, Utc::now());
        let hourly_l2 = guard.count_recent_l2_executions(3600).unwrap_or(0);
        let tier = AssetTier::from_slug(asset_slug, None);
        let configured_ws = guard.get_setting("workspace_root").ok().flatten();
        let suite_root = resolve_suite_workspace_root(configured_ws.as_deref());
        let allowlist_rows = guard.list_threat_allowlist().unwrap_or_default();
        let protected_ips: Vec<String> = allowlist_rows
            .iter()
            .filter(|a| a.entry_type.eq_ignore_ascii_case("IP"))
            .map(|a| a.value.clone())
            .collect();
        let protected_asns: Vec<String> = allowlist_rows
            .iter()
            .filter(|a| a.entry_type.eq_ignore_ascii_case("ASN"))
            .map(|a| a.value.clone())
            .collect();

        let (tid, next_idx) = if let Some(existing) = existing_trace_run_id {
            let count = guard
                .get_otto_trace_detail(existing)
                .ok()
                .flatten()
                .map(|d| d.steps.len() as i64)
                .unwrap_or(0);
            (existing.to_string(), count)
        } else {
            let id = guard
                .create_otto_trace_run(
                    if is_human_approved_l3 { "L3_EXEC" } else { "L2_AUTO" },
                    if action_id.starts_with("apply_cf_") {
                        "DEFENSE"
                    } else {
                        "HEAL"
                    },
                    Some(asset_slug),
                    None,
                    None,
                )
                .map_err(|e| format!("Failed creating execution trace run: {}", e))?;
            (id, 0)
        };

        (
            tid,
            tier,
            state.kill_switch_active,
            state.circuit_breaker_state == "TRIPPED",
            configured_mode,
            cooldown_active,
            hourly_l2,
            suite_root,
            next_idx,
            protected_ips,
            protected_asns,
        )
    };

    let has_db_migration = params_val
        .get("hasDbMigration")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let extract_str_array = |key: &str| -> Vec<String> {
        params_val
            .get(key)
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.trim().to_string()))
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default()
    };
    let target_ips = extract_str_array("targetIps");
    let target_asns = extract_str_array("targetAsns");
    let target_paths = extract_str_array("targetPaths");

    let policy_decision = evaluate_policy_decision(&PolicyEvalRequest {
        action_id: action_id.to_string(),
        asset_slug: asset_slug.to_string(),
        asset_tier,
        configured_mode: if is_human_approved_l3 {
            AutonomyMode::L3Approval
        } else {
            configured_mode
        },
        kill_switch_active,
        circuit_breaker_tripped: !is_human_approved_l3 && circuit_tripped,
        has_db_migration,
        classification: classification.map(|s| s.to_string()),
        raw_payload_text: format!("{} {} {}", action_id, asset_slug, params_json),
        target_ips: target_ips.clone(),
        target_asns: target_asns.clone(),
        target_paths: target_paths.clone(),
        protected_ips,
        protected_asns,
        proposed_semver_bump: None,
    });

    let exec_guard_result = validate_execution_time_guards(
        is_human_approved_l3,
        &policy_decision,
        cooldown_active,
        hourly_l2_executions,
    );

    {
        if let Ok(guard) = db.lock() {
            let _ = guard.append_otto_trace_step(
                &trace_run_id,
                base_step_idx,
                "POLICY_KERNEL",
                &format!(
                    "Execution-time Policy Kernel re-check for '{}' ({}) -> {:?}",
                    action_id,
                    if is_human_approved_l3 { "L3_CLICK" } else { "L2_AUTO" },
                    policy_decision.verdict
                ),
                if exec_guard_result.is_err() {
                    "BLOCKED"
                } else {
                    "OK"
                },
                1,
                None,
                Some(
                    &json!({
                        "decision": policy_decision,
                        "cooldownActive": cooldown_active,
                        "hourlyL2Executions": hourly_l2_executions,
                        "guardError": exec_guard_result.as_ref().err()
                    })
                    .to_string(),
                ),
            );
        }
    }

    if let Err(block_reason) = exec_guard_result {
        let verification_json = json!({
            "verified": false,
            "blocked": true,
            "verdict": policy_decision.verdict,
            "reason": block_reason,
            "cooldownActive": cooldown_active,
            "hourlyL2Executions": hourly_l2_executions,
            "decidedAt": Utc::now().to_rfc3339()
        })
        .to_string();
        if let Ok(guard) = db.lock() {
            let _ = guard.append_otto_audit(
                "EXECUTOR_BLOCKED",
                Some(action_id),
                Some(asset_slug),
                "BLOCKED",
                &block_reason,
                Some(&trace_run_id),
            );
            if let Some(pid) = proposal_id {
                let _ = guard.update_otto_proposal_status(pid, "BLOCKED", None, Some(&verification_json));
            }
        }
        return Err(block_reason);
    }

    // 2. Phase 4 upgrade/worktree actions remain dry-run until Phase 4 unlocks
    if matches!(
        action_id,
        "stage_worktree_patch" | "deploy_verified_patch" | "wsh_apt_dist_upgrade"
    ) {
        let summary = format!(
            "Approved '{}' for '{}' (executor unlocks in Phase 4; recorded dry-run audit)",
            action_id, asset_slug
        );
        let verification_json = json!({
            "phase": "PHASE_3_DEFERRED_TO_P4",
            "verified": true,
            "note": scrub_secrets(note.unwrap_or(&summary)),
            "decidedAt": Utc::now().to_rfc3339()
        })
        .to_string();
        if let Ok(guard) = db.lock() {
            let _ = guard.append_otto_trace_step(
                &trace_run_id,
                base_step_idx + 1,
                "EXECUTE",
                &summary,
                "DRY_RUN",
                0,
                None,
                Some(&verification_json),
            );
        }
        return Ok(OttoActionExecutionOutcome {
            success: true,
            final_status: "APPROVED_DRY_RUN".to_string(),
            summary,
            trace_run_id,
            job_id: None,
            verification_json,
        });
    }

    // 3. Dispatch Compiled Phase 2 Executors
    let job_id = format!("otto-{}-{}-{}", action_id, asset_slug, Utc::now().timestamp_millis());
    let stream_title = format!(
        "Otto {}: {} ({})",
        if is_human_approved_l3 { "L3" } else { "L2" },
        action_id,
        asset_slug
    );

    let _ = runtime.set_phase(
        Some(app),
        OttoRuntimePhase::Acting,
        format!("Otto: Acting ({} {})", action_id, asset_slug),
        None,
        None,
        Some(asset_slug.to_string()),
        format!("Executing compiled '{}' on {}", action_id, asset_slug),
        Some(trace_run_id.clone()),
        false,
    );

    let exec_start = Instant::now();
    let (exec_ok, exec_detail, verify_ok, verify_detail, final_status_ok) = match action_id {
        "create_bug_handoff" => {
            let summary = note
                .map(|s| s.to_string())
                .or_else(|| {
                    params_val
                        .get("summary")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| {
                    format!(
                        "Detection-defect / diagnostic handoff packet published for {}",
                        asset_slug
                    )
                });
            let pkt = OttoHandoffPacketRow {
                id: format!("handoff-{}", Uuid::new_v4()),
                proposal_id: proposal_id.map(|s| s.to_string()),
                trace_run_id: Some(trace_run_id.clone()),
                app_slug: asset_slug.to_string(),
                category: classification.unwrap_or("DETECTION_DEFECT_SUSPECTED").to_string(),
                summary: summary.clone(),
                logs_scrubbed: scrub_secrets(params_json),
                diff_patch: None,
                status: "OPEN".to_string(),
                created_at: Utc::now().to_rfc3339(),
            };
            let inserted = db
                .lock()
                .ok()
                .and_then(|g| g.insert_otto_handoff_packet(&pkt).ok())
                .is_some();
            (
                inserted,
                format!("Published scrubbed handoff packet '{}' to agent_handoff_packets", pkt.id),
                inserted,
                "Zero-mutation handoff persisted cleanly in sre.sqlite".to_string(),
                "VERIFIED".to_string(),
            )
        }

        "prune_buildkit_cache" => {
            emit_agent_stream_start(app, &job_id, &stream_title, asset_slug, is_human_approved_l3);
            emit_agent_stream_line(
                app,
                &job_id,
                "[OTTO PREFLIGHT] Checking local Docker Desktop engine availability...",
            );
            if let Err(daemon_err) = check_local_docker_daemon().await {
                emit_agent_stream_line(app, &job_id, &format!("[OTTO PREFLIGHT] {}", daemon_err));
                emit_agent_stream_end(app, &job_id, 1);
                if let Ok(guard) = db.lock() {
                    let _ = guard.append_otto_trace_step(
                        &trace_run_id,
                        base_step_idx + 1,
                        "PREFLIGHT",
                        &daemon_err,
                        "PRECONDITION_UNMET",
                        exec_start.elapsed().as_millis() as i64,
                        None,
                        Some(&json!({ "dockerDaemonRunning": false, "proposalKeptPending": is_human_approved_l3 }).to_string()),
                    );
                    if existing_trace_run_id.is_none() {
                        let _ = guard.complete_otto_trace_run(
                            &trace_run_id,
                            "PRECONDITION_UNMET",
                            None,
                            None,
                            0,
                            0,
                            0,
                            started.elapsed().as_millis() as i64,
                            &daemon_err,
                            Some(&daemon_err),
                        );
                    }
                    let _ = runtime.set_phase(
                        Some(app),
                        OttoRuntimePhase::Idle,
                        "Otto: Idle · Shadow",
                        None,
                        None,
                        None,
                        "Ready",
                        Some(trace_run_id.clone()),
                        false,
                    );
                    if let Ok(st) = guard.get_otto_state() {
                        let pending = guard.count_pending_otto_approvals().unwrap_or(0);
                        let active_soaks = guard.count_active_otto_soaks().unwrap_or(0);
                        let _ = runtime.sync_from_db_state(
                            Some(app),
                            st.kill_switch_active,
                            &st.circuit_breaker_state,
                            pending,
                            active_soaks,
                            st.daily_t1_calls,
                            st.daily_t2_calls,
                            st.dropped_noise_24h_count,
                        );
                    }
                }
                return Err(daemon_err);
            }

            let before_usage = read_local_buildkit_bytes().await;
            emit_agent_stream_line(
                app,
                &job_id,
                &format!(
                    "[OTTO PREFLIGHT] Local Docker engine online · BuildKit cache before prune: {}",
                    format_buildkit_usage(before_usage)
                ),
            );
            if !is_human_approved_l3 {
                if let Some((reclaim, total)) = before_usage {
                    if !is_buildkit_cache_high(reclaim, total) {
                        let msg = format!(
                            "Calibrated BuildKit guard skipped L2 prune ({} < 35 GB reclaimable / 100 GB total)",
                            format_buildkit_usage(Some((reclaim, total)))
                        );
                        emit_agent_stream_line(app, &job_id, &msg);
                        emit_agent_stream_end(app, &job_id, 0);
                        return Ok(OttoActionExecutionOutcome {
                            success: true,
                            final_status: "VERIFIED".to_string(),
                            summary: msg.clone(),
                            trace_run_id,
                            job_id: Some(job_id),
                            verification_json: json!({ "skipped": true, "reason": msg }).to_string(),
                        });
                    }
                }
            }
            let args = compiled_buildkit_prune_args();
            let run_res = run_compiled_process(
                app,
                job_manager,
                &job_id,
                &stream_title,
                "docker",
                &args,
                None,
                ResourceLock::None,
                300,
            )
            .await;

            match run_res {
                Ok((code, tail)) => {
                    let ok = code == 0;
                    let _ = runtime.set_phase(
                        Some(app),
                        OttoRuntimePhase::Verifying,
                        "Otto: Verifying Cache",
                        None,
                        None,
                        Some("buildkit".to_string()),
                        "Checking BuildKit disk usage after prune",
                        Some(trace_run_id.clone()),
                        false,
                    );
                    let after_usage = read_local_buildkit_bytes().await;
                    let verify_msg = format!(
                        "docker buildx prune exited {} (before: {}; after: {})",
                        code,
                        format_buildkit_usage(before_usage),
                        format_buildkit_usage(after_usage)
                    );
                    emit_agent_stream_line(app, &job_id, &format!("[OTTO VERIFY] {}", verify_msg));
                    emit_agent_stream_end(app, &job_id, code);
                    (
                        ok,
                        if ok {
                            format!("BuildKit cache pruned (--all --filter until=72h -f): {}", tail.lines().last().unwrap_or("OK"))
                        } else {
                            format!("BuildKit prune exited {}: {}", code, tail.lines().last().unwrap_or("error"))
                        },
                        ok,
                        verify_msg,
                        "VERIFIED".to_string(),
                    )
                }
                Err(err) => {
                    emit_agent_stream_line(app, &job_id, &format!("[OTTO ERROR] {}", err));
                    emit_agent_stream_end(app, &job_id, 1);
                    (false, err.clone(), false, err, "FAILED".to_string())
                }
            }
        }

        "renew_ssl_cert" => {
            emit_agent_stream_start(app, &job_id, &stream_title, asset_slug, is_human_approved_l3);
            let tools_dir = suite_root.join("PanoramaDrSuite").join("tools");
            let tools_str = tools_dir.to_string_lossy().to_string();
            let args = vec![
                "-NoProfile".to_string(),
                "-ExecutionPolicy".to_string(),
                "Bypass".to_string(),
                "-File".to_string(),
                "./Get-SSLCerts.ps1".to_string(),
                "-Unattended".to_string(),
            ];
            let run_res = run_compiled_process(
                app,
                job_manager,
                &job_id,
                &stream_title,
                "pwsh.exe",
                &args,
                Some(&tools_str),
                ResourceLock::WshRemoteMutation,
                420,
            )
            .await;
            match run_res {
                Ok((code, tail)) => {
                    let ok = code == 0;
                    emit_agent_stream_end(app, &job_id, code);
                    (
                        ok,
                        format!("Get-SSLCerts.ps1 -Unattended exited {}", code),
                        ok,
                        tail.lines().last().unwrap_or("Completed").to_string(),
                        "VERIFIED".to_string(),
                    )
                }
                Err(err) => {
                    emit_agent_stream_line(app, &job_id, &format!("[OTTO ERROR] {}", err));
                    emit_agent_stream_end(app, &job_id, 1);
                    (false, err.clone(), false, err, "FAILED".to_string())
                }
            }
        }

        "restart_container" | "restart_tier0_hard_down" => {
            emit_agent_stream_start(app, &job_id, &stream_title, asset_slug, is_human_approved_l3);
            let container_opt = params_val
                .get("containerName")
                .and_then(|v| v.as_str())
                .and_then(resolve_allowlisted_wsh_container)
                .or_else(|| resolve_allowlisted_wsh_container(asset_slug));

            let Some(container_name) = container_opt else {
                let err = format!(
                    "Container for '{}' is not in the compiled WSH gatekeeper allowlist",
                    asset_slug
                );
                emit_agent_stream_line(app, &job_id, &format!("[OTTO ERROR] {}", err));
                emit_agent_stream_end(app, &job_id, 1);
                return Err(err);
            };

            let maybe_lock = job_manager.get_lock(ResourceLock::WshRemoteMutation).await;
            let _lock_guard = match &maybe_lock {
                Some(l) => Some(l.lock().await),
                None => None,
            };

            let verb = format!("restart-container {}", container_name);
            emit_agent_stream_line(
                app,
                &job_id,
                &format!("[OTTO GATEKEEPER] Invoking sre-agent-wsh verb '{}'", verb),
            );
            let budget = Arc::clone(&runtime.ssh_budget);
            let verb_clone = verb.clone();
            let restart_res = tokio::task::spawn_blocking(move || run_gatekeeper_verb(&budget, &verb_clone))
                .await
                .map_err(|e| format!("Gatekeeper restart task panicked: {}", e))?;

            match restart_res {
                Ok(stdout) => {
                    emit_agent_stream_line(app, &job_id, &format!("[OTTO PASS] {}", stdout.trim()));
                    let _ = runtime.set_phase(
                        Some(app),
                        OttoRuntimePhase::Verifying,
                        format!("Otto: Verifying {}", asset_slug),
                        None,
                        None,
                        Some(asset_slug.to_string()),
                        format!("Probing {} recovery after container restart", container_name),
                        Some(trace_run_id.clone()),
                        false,
                    );
                    tokio::time::sleep(Duration::from_secs(3)).await;

                    let base_path = params_val
                        .get("basePath")
                        .and_then(|v| v.as_str())
                        .unwrap_or(match asset_slug {
                            "auth" => "/auth",
                            "spendy" => "/spendy",
                            "biomed" => "/biomed",
                            "water" => "/water",
                            "basket" => "/basket",
                            "energy" => "/energy",
                            "res" | "resources" => "/res",
                            _ => "",
                        });
                    let (v_ok, v_msg) = if base_path.is_empty() {
                        // Service target (e.g., unifi-siem): verify via gatekeeper container-health verb
                        let b2 = Arc::clone(&runtime.ssh_budget);
                        let hv = format!("container-health {}", container_name);
                        match tokio::task::spawn_blocking(move || run_gatekeeper_verb(&b2, &hv)).await {
                            Ok(Ok(out)) => (
                                out.to_ascii_lowercase().contains("running"),
                                format!("container-health: {}", out.trim()),
                            ),
                            Ok(Err(e)) => (false, e),
                            Err(e) => (false, format!("Verification panic: {}", e)),
                        }
                    } else {
                        verify_app_http_recovery(base_path).await
                    };
                    emit_agent_stream_line(app, &job_id, &format!("[OTTO VERIFY] {}", v_msg));
                    emit_agent_stream_end(app, &job_id, if v_ok { 0 } else { 1 });
                    (true, format!("Restarted '{}' via sre-agent-wsh", container_name), v_ok, v_msg, "VERIFIED".to_string())
                }
                Err(err) => {
                    emit_agent_stream_line(app, &job_id, &format!("[OTTO ERROR] {}", err));
                    emit_agent_stream_end(app, &job_id, 1);
                    (false, err.clone(), false, err, "FAILED".to_string())
                }
            }
        }

        "rollback_n3_db_safe" => {
            emit_agent_stream_start(app, &job_id, &stream_title, asset_slug, is_human_approved_l3);
            if !is_human_approved_l3 && (asset_tier != AssetTier::Tier1ChildApp || has_db_migration) {
                let err = "DB-Safe N-3 auto-rollback requires Tier-1 app with DB_MIGRATION == false".to_string();
                emit_agent_stream_line(app, &job_id, &format!("[OTTO BLOCKED] {}", err));
                emit_agent_stream_end(app, &job_id, 1);
                return Err(err);
            }
            let prev_tag = params_val
                .get("previousTag")
                .or_else(|| params_val.get("tag"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .unwrap_or("");
            if !is_valid_rollback_tag(prev_tag) {
                let err = format!(
                    "Invalid or missing rollback tag '{}' (must match [a-zA-Z0-9._+-])",
                    prev_tag
                );
                emit_agent_stream_line(app, &job_id, &format!("[OTTO ERROR] {}", err));
                emit_agent_stream_end(app, &job_id, 1);
                return Err(err);
            }

            // Resolve app workspace strictly from discovered panorama.app.json manifests inside suite_root
            let mut resolved_workspace: Option<(String, String)> = None;
            if let Ok(entries) = std::fs::read_dir(&suite_root) {
                for entry in entries.flatten() {
                    let dir_path = entry.path();
                    if !dir_path.is_dir() {
                        continue;
                    }
                    let manifest_path = dir_path.join("panorama.app.json");
                    if !manifest_path.is_file() {
                        continue;
                    }
                    if let Ok(raw_manifest) = std::fs::read_to_string(&manifest_path) {
                        if let Ok(val) = serde_json::from_str::<Value>(&raw_manifest) {
                            let slug_match = val
                                .get("slug")
                                .and_then(|v| v.as_str())
                                .map(|s| s.eq_ignore_ascii_case(asset_slug))
                                .unwrap_or(false);
                            if slug_match {
                                let bp = val
                                    .get("basePath")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                resolved_workspace = Some((dir_path.to_string_lossy().to_string(), bp));
                                break;
                            }
                        }
                    }
                }
            }
            let Some((workspace_path, base_path)) = resolved_workspace else {
                let err = format!("Could not resolve discovered workspace for slug '{}'", asset_slug);
                emit_agent_stream_line(app, &job_id, &format!("[OTTO ERROR] {}", err));
                emit_agent_stream_end(app, &job_id, 1);
                return Err(err);
            };

            let args = vec![
                "-NoProfile".to_string(),
                "-ExecutionPolicy".to_string(),
                "Bypass".to_string(),
                "-File".to_string(),
                "./deploy-docker.ps1".to_string(),
                "-RollbackToTag".to_string(),
                prev_tag.to_string(),
            ];
            let run_res = run_compiled_process(
                app,
                job_manager,
                &job_id,
                &stream_title,
                "pwsh.exe",
                &args,
                Some(&workspace_path),
                ResourceLock::WshRemoteMutation,
                300,
            )
            .await;

            match run_res {
                Ok((code, _tail)) => {
                    let ok = code == 0;
                    let _ = runtime.set_phase(
                        Some(app),
                        OttoRuntimePhase::Verifying,
                        format!("Otto: Verifying Rollback ({})", asset_slug),
                        None,
                        None,
                        Some(asset_slug.to_string()),
                        format!("Verifying /api/health after rollback to {}", prev_tag),
                        Some(trace_run_id.clone()),
                        false,
                    );
                    let (v_ok, v_msg) = if ok {
                        verify_app_http_recovery(&base_path).await
                    } else {
                        (false, format!("deploy-docker.ps1 -RollbackToTag exited {}", code))
                    };
                    emit_agent_stream_line(app, &job_id, &format!("[OTTO VERIFY] {}", v_msg));
                    emit_agent_stream_end(app, &job_id, if ok && v_ok { 0 } else { 1 });
                    (
                        ok,
                        format!("Rolled back '{}' to tag '{}'", asset_slug, prev_tag),
                        ok && v_ok,
                        v_msg,
                        "ROLLED_BACK".to_string(),
                    )
                }
                Err(err) => {
                    emit_agent_stream_line(app, &job_id, &format!("[OTTO ERROR] {}", err));
                    emit_agent_stream_end(app, &job_id, 1);
                    (false, err.clone(), false, err, "FAILED".to_string())
                }
            }
        }

        "apply_cf_temp_challenge" | "apply_cf_permanent_waf" => {
            emit_agent_stream_start(app, &job_id, &stream_title, asset_slug, is_human_approved_l3);
            if action_id == "apply_cf_permanent_waf" && !is_human_approved_l3 {
                let err = "Permanent Cloudflare WAF rules strictly require explicit Desktop L3 Approval (never autonomous L2).".to_string();
                emit_agent_stream_line(app, &job_id, &format!("[OTTO BLOCKED] {}", err));
                emit_agent_stream_end(app, &job_id, 1);
                return Err(err);
            }

            let target_asns = extract_str_array("targetAsns");
            let target_zone_hint = params_val
                .get("targetZone")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_ascii_lowercase())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| asset_slug.trim().to_ascii_lowercase());
            let target_host = params_val
                .get("targetHost")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            // Compile Wirefilter strictly in Rust from verified IPs/ASNs (zero raw LLM expressions)
            let compiled_expr = match build_compiled_waf_expression(
                &target_ips,
                &target_asns,
                target_host.as_deref(),
            ) {
                Ok(e) => e,
                Err(err) => {
                    emit_agent_stream_line(app, &job_id, &format!("[OTTO ERROR] {}", err));
                    emit_agent_stream_end(app, &job_id, 1);
                    return Err(err);
                }
            };

            // Enforce action contract: temp challenge NEVER uses 'block'
            let (cf_action, ttl_mins, expires_at_opt) = if action_id == "apply_cf_temp_challenge" {
                let mins = params_val
                    .get("ttlMinutes")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(DEFAULT_TEMP_CHALLENGE_TTL_MINS)
                    .clamp(15, 240);
                let exp = (Utc::now() + chrono::Duration::minutes(mins)).to_rfc3339();
                ("managed_challenge", Some(mins), Some(exp))
            } else {
                let requested = params_val
                    .get("cfAction")
                    .and_then(|v| v.as_str())
                    .unwrap_or("block")
                    .trim()
                    .to_ascii_lowercase();
                let safe_act = if requested == "managed_challenge" {
                    "managed_challenge"
                } else {
                    "block"
                };
                (safe_act, None, None)
            };

            let (cf_token, configured_acct) = {
                let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
                let tok = resolve_cf_api_token(&guard).map(|s| s.value);
                let acct = guard.get_setting("cf_account_id").ok().flatten();
                (tok, acct)
            };
            let Some(token) = cf_token else {
                let err = "Cloudflare API token is not configured. Configure CLOUDFLARE_API_TOKEN under Settings -> AI, Credentials & Connectors.".to_string();
                emit_agent_stream_line(app, &job_id, &format!("[OTTO PREFLIGHT] {}", err));
                emit_agent_stream_end(app, &job_id, 1);
                return Err(err);
            };
            let Some(cf_client) = shared_cf_http_client() else {
                let err = "Failed initializing Cloudflare HTTPS client".to_string();
                emit_agent_stream_line(app, &job_id, &format!("[OTTO ERROR] {}", err));
                emit_agent_stream_end(app, &job_id, 1);
                return Err(err);
            };

            emit_agent_stream_line(
                app,
                &job_id,
                &format!(
                    "[OTTO WAF] Resolving Cloudflare zone '{}' (action={}, expr={})...",
                    target_zone_hint, cf_action, compiled_expr
                ),
            );
            let zones_res =
                resolve_cf_account_and_zones(cf_client, &token, configured_acct.as_deref()).await;
            let matched_zone = match zones_res {
                Ok((_acct, zones)) => zones
                    .into_iter()
                    .find(|(_, zname, _)| {
                        zname.eq_ignore_ascii_case(&target_zone_hint)
                            || target_zone_hint.ends_with(&format!(".{}", zname.to_ascii_lowercase()))
                    }),
                Err(err) => {
                    emit_agent_stream_line(app, &job_id, &format!("[OTTO ERROR] {}", err));
                    emit_agent_stream_end(app, &job_id, 1);
                    return Err(err);
                }
            };

            let Some((zone_id, zone_name, plan_name)) = matched_zone else {
                let err = format!(
                    "Could not resolve Cloudflare zone matching '{}' in your Cloudflare account.",
                    target_zone_hint
                );
                emit_agent_stream_line(app, &job_id, &format!("[OTTO ERROR] {}", err));
                emit_agent_stream_end(app, &job_id, 1);
                return Err(err);
            };

            let lease_id = format!("lease-{}", Uuid::new_v4());
            let base_desc = params_val
                .get("description")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("Otto Proactive Defense Rule");
            let max_rules = free_plan_rule_limit_for_plan(&plan_name);

            emit_agent_stream_line(
                app,
                &job_id,
                &format!(
                    "[OTTO WAF] Capturing prior custom WAF ruleset snapshot on {} (plan={}, limit={})...",
                    zone_name, plan_name, max_rules
                ),
            );

            match apply_cloudflare_waf_lease_via_api(
                cf_client,
                CLOUDFLARE_API_BASE_URL,
                &token,
                &zone_id,
                &lease_id,
                cf_action,
                &compiled_expr,
                base_desc,
                expires_at_opt.as_deref(),
                max_rules,
            )
            .await
            {
                Ok(receipt) => {
                    emit_agent_stream_line(
                        app,
                        &job_id,
                        &format!(
                            "[OTTO PASS] Applied Cloudflare WAF rule '{}' on {} ({} -> {} rules; prior snapshot saved)",
                            receipt.cf_rule_id,
                            zone_name,
                            receipt.rules_count_before,
                            receipt.rules_count_after
                        ),
                    );
                    let target_summary = {
                        let mut parts = Vec::new();
                        if !target_ips.is_empty() {
                            parts.push(format!("IPs: {}", target_ips.join(", ")));
                        }
                        if !target_asns.is_empty() {
                            parts.push(format!("ASNs: {}", target_asns.join(", ")));
                        }
                        parts.join(" · ")
                    };
                    let lease_row = OttoWafLeaseRow {
                        id: lease_id.clone(),
                        proposal_id: proposal_id.map(|s| s.to_string()),
                        cf_zone_id: zone_id.clone(),
                        cf_zone_name: zone_name.clone(),
                        cf_ruleset_id: receipt.cf_ruleset_id.clone(),
                        cf_rule_id: receipt.cf_rule_id.clone(),
                        rule_description: receipt.rule_description.clone(),
                        rule_expression: compiled_expr.clone(),
                        action_type: cf_action.to_string(),
                        target_summary,
                        prior_ruleset_snapshot_json: receipt.prior_ruleset_snapshot_json,
                        ttl_minutes: ttl_mins,
                        created_at: Utc::now().to_rfc3339(),
                        expires_at: expires_at_opt.clone(),
                        reverted_at: None,
                        status: "ACTIVE".to_string(),
                        trace_run_id: Some(trace_run_id.clone()),
                        error_text: None,
                    };
                    if let Ok(guard) = db.lock() {
                        let _ = guard.insert_otto_waf_lease(&lease_row);
                    }
                    let verify_msg = format!(
                        "Verified live Cloudflare rule '{}' on {} (lease={}, ttl={})",
                        receipt.cf_rule_id,
                        zone_name,
                        lease_id,
                        ttl_mins
                            .map(|m| format!("{}m auto-revert", m))
                            .unwrap_or_else(|| "permanent (1-click revert)".to_string())
                    );
                    emit_agent_stream_line(app, &job_id, &format!("[OTTO VERIFY] {}", verify_msg));
                    emit_agent_stream_end(app, &job_id, 0);
                    (
                        true,
                        format!(
                            "Applied Cloudflare WAF {} on {} ({})",
                            cf_action, zone_name, compiled_expr
                        ),
                        true,
                        verify_msg,
                        "VERIFIED".to_string(),
                    )
                }
                Err(err) => {
                    emit_agent_stream_line(app, &job_id, &format!("[OTTO ERROR] {}", err));
                    emit_agent_stream_end(app, &job_id, 1);
                    (false, err.clone(), false, err, "FAILED".to_string())
                }
            }
        }

        other => {
            return Err(format!("Unsupported compiled executor '{}'", other));
        }
    };

    let overall_ok = exec_ok && verify_ok;
    let final_status = if overall_ok {
        final_status_ok
    } else {
        "FAILED".to_string()
    };
    let elapsed_ms = exec_start.elapsed().as_millis() as i64;

    let verification_json = json!({
        "verified": overall_ok,
        "triggerSource": if is_human_approved_l3 { "L3_HUMAN_APPROVED" } else { "L2_AUTO" },
        "execDetail": scrub_secrets(&exec_detail),
        "verifyDetail": scrub_secrets(&verify_detail),
        "durationMs": elapsed_ms,
        "completedAt": Utc::now().to_rfc3339()
    })
    .to_string();

    let mut breaker_just_tripped = false;
    {
        if let Ok(guard) = db.lock() {
            let _ = guard.append_otto_trace_step(
                &trace_run_id,
                base_step_idx + 1,
                "EXECUTE",
                &exec_detail,
                if exec_ok { "OK" } else { "FAILED" },
                elapsed_ms,
                None,
                Some(&json!({ "actionId": action_id, "assetSlug": asset_slug, "jobId": job_id }).to_string()),
            );
            let _ = guard.append_otto_trace_step(
                &trace_run_id,
                base_step_idx + 2,
                "OUTCOME_VERIFY",
                &verify_detail,
                if verify_ok { "OK" } else { "FAILED" },
                0,
                None,
                Some(&verification_json),
            );
            if existing_trace_run_id.is_none() {
                let _ = guard.complete_otto_trace_run(
                    &trace_run_id,
                    if overall_ok { "COMPLETED" } else { "FAILED" },
                    None,
                    None,
                    0,
                    0,
                    0,
                    started.elapsed().as_millis() as i64,
                    &format!("{}: {}", action_id, verify_detail),
                    if overall_ok { None } else { Some(&verify_detail) },
                );
            }

            let audit_decision = if overall_ok {
                if final_status == "ROLLED_BACK" {
                    "ROLLED_BACK"
                } else if is_human_approved_l3 {
                    "EXECUTED_L3"
                } else {
                    "EXECUTED_L2"
                }
            } else {
                "FAILED"
            };
            let _ = guard.append_otto_audit(
                "ACTION_EXECUTION",
                Some(action_id),
                Some(asset_slug),
                audit_decision,
                &verify_detail,
                Some(&trace_run_id),
            );

            if overall_ok {
                let _ = guard.record_otto_verified_success();
            } else if !is_human_approved_l3 {
                if let Ok(next_state) = guard.record_otto_circuit_failure(&verify_detail) {
                    breaker_just_tripped = next_state.circuit_breaker_state == "TRIPPED";
                }
            }

            if let Some(pid) = proposal_id {
                let _ = guard.update_otto_proposal_execution(pid, &final_status, Some(&verification_json));
            }

            let _ = runtime.set_phase(
                Some(app),
                OttoRuntimePhase::Idle,
                "Otto: Idle · Shadow",
                None,
                None,
                None,
                "Ready",
                Some(trace_run_id.clone()),
                false,
            );
            if let Ok(st) = guard.get_otto_state() {
                let pending = guard.count_pending_otto_approvals().unwrap_or(0);
                let active_soaks = guard.count_active_otto_soaks().unwrap_or(0);
                let _ = runtime.sync_from_db_state(
                    Some(app),
                    st.kill_switch_active,
                    &st.circuit_breaker_state,
                    pending,
                    active_soaks,
                    st.daily_t1_calls,
                    st.daily_t2_calls,
                    st.dropped_noise_24h_count,
                );
            }
        }
    }

    // Fire Pushover notifications cleanly outside DB lock
    if breaker_just_tripped {
        maybe_notify_otto_event(
            db,
            OttoPushoverCategory::CircuitBreakerOrCascade,
            "Otto AI SRE • Circuit Breaker TRIPPED",
            "Autonomous L2 Execution Frozen:",
            &[
                FormattedBulletItem {
                    label: "Action".to_string(),
                    detail: format!("{} ({})", action_id, asset_slug),
                },
                FormattedBulletItem {
                    label: "Reason".to_string(),
                    detail: verify_detail.clone(),
                },
            ],
        )
        .await;
    } else if overall_ok && !is_human_approved_l3 {
        maybe_notify_otto_event(
            db,
            OttoPushoverCategory::L2AutoAction,
            &format!("Otto AI SRE • L2 Auto-Healed {}", asset_slug),
            "Reversible Autonomous Remediation Verified:",
            &[
                FormattedBulletItem {
                    label: action_id.to_string(),
                    detail: verify_detail.clone(),
                },
            ],
        )
        .await;
    }

    Ok(OttoActionExecutionOutcome {
        success: overall_ok,
        final_status,
        summary: format!("{} — {}", exec_detail, verify_detail),
        trace_run_id,
        job_id: Some(job_id),
        verification_json,
    })
}
