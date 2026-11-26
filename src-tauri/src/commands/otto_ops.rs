use crate::commands::threat_intel_ops::{load_threat_preferences, resolve_gemini_api_key};
use crate::db::SreDatabase;
use crate::job_manager::JobManager;
use crate::otto_db::{
    OttoAgentStateRow, OttoChatMessageRow, OttoChatThreadRow, OttoPolicyRow, OttoProposalRow,
    OttoSavedPromptRow, OttoSoakSessionRow, OttoTraceDetailDto, OttoTraceRunRow,
};
use crate::otto_policy::{
    evaluate_policy_decision, l4_hard_blocked_invariants, AssetTier, AutonomyMode,
    L4HardBlockInvariant, PolicyEvalRequest, PolicyVerdict,
};
use crate::otto_runtime::{
    resolve_allowlisted_wsh_container, run_gatekeeper_verb, OttoLifecycleSnapshot,
    OttoRuntimeController, OttoRuntimePhase, SuricataGatekeeperStatusDto,
};
use crate::otto_soak::{
    evaluate_soak_decision, execute_compiled_otto_action, is_buildkit_cache_high,
    is_cooldown_active, SoakDecision, SoakEvaluationInput, SoakSample, DEFAULT_SOAK_DURATION_SECS,
    SSL_RENEW_THRESHOLD_DAYS,
};
use crate::pushover::{maybe_notify_otto_event, FormattedBulletItem, OttoPushoverCategory};
use crate::scrubber::scrub_secrets;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

// ============================================================================
// HTTP Client & DTOs
// ============================================================================

fn shared_otto_gemini_client() -> Option<&'static reqwest::Client> {
    static CLIENT: OnceLock<Option<reqwest::Client>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(195))
                .pool_idle_timeout(Duration::from_secs(60))
                .user_agent("PanoramaSRE-Otto/1.0")
                .build()
                .ok()
        })
        .as_ref()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoStatusDto {
    pub lifecycle: OttoLifecycleSnapshot,
    pub agent_state: OttoAgentStateRow,
    pub suricata: SuricataGatekeeperStatusDto,
    pub gemini_configured: bool,
    pub default_tier1_model: String,
    pub default_tier2_model: String,
    pub daily_t2_cap: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoToolUsePill {
    pub tool: String,
    pub summary: String,
    pub items_count: usize,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOttoChatThreadInput {
    pub title: String,
    pub context_seed_json: Option<String>,
    pub origin_view: Option<String>,
    pub origin_entity_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendOttoChatMessageInput {
    pub thread_id: String,
    pub user_message: String,
    pub model_choice: Option<String>,
    pub thinking_level: Option<String>,
    pub context_seed_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendOttoChatMessageResult {
    pub user_message: OttoChatMessageRow,
    pub assistant_message: OttoChatMessageRow,
    pub trace_run_id: String,
    pub inline_proposal: Option<OttoProposalRow>,
    pub lifecycle: OttoLifecycleSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecideOttoProposalInput {
    pub proposal_id: String,
    pub decision: String, // APPROVE | REJECT | SNOOZE_24H | SHADOW_AGREE | SHADOW_DISAGREE
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoTraceDebugBundleDto {
    pub trace_run_id: String,
    pub markdown: String,
    pub json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoLogDeltaProbeResult {
    pub ok: bool,
    pub verb: String,
    pub detail: String,
    pub line_count: usize,
    pub preview: String,
    pub suricata: SuricataGatekeeperStatusDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OttoModelProposalDraft {
    action_id: String,
    #[serde(default = "default_asset_slug")]
    asset_slug: String,
    #[serde(default = "default_domain")]
    domain: String,
    #[serde(default = "default_classification")]
    classification: String,
    title: String,
    #[serde(default = "default_severity")]
    severity: String,
    #[serde(default = "default_confidence")]
    confidence: f64,
    #[serde(default)]
    rca_summary: String,
    #[serde(default)]
    params: Value,
    #[serde(default)]
    target_ips: Vec<String>,
    #[serde(default)]
    target_paths: Vec<String>,
    #[serde(default)]
    has_db_migration: bool,
    #[serde(default)]
    proposed_semver_old: Option<String>,
    #[serde(default)]
    proposed_semver_new: Option<String>,
    #[serde(default)]
    evidence: Vec<String>,
}

fn default_asset_slug() -> String {
    "wsh".to_string()
}
fn default_domain() -> String {
    "SECURITY".to_string()
}
fn default_classification() -> String {
    "RELIABILITY".to_string()
}
fn default_severity() -> String {
    "MEDIUM".to_string()
}
fn default_confidence() -> f64 {
    0.75
}

// ============================================================================
// Pure Helper Functions (Unit Tested)
// ============================================================================

/// Extracts non-thought answer text, native Deep-Thinking summary (`part.thought == true`),
/// and token counts from a Gemini `generateContent` JSON envelope.
pub fn extract_gemini_parts_with_thoughts(
    parsed: &Value,
) -> Result<(String, Option<String>, i64, i64, i64), String> {
    let parts = parsed
        .pointer("/candidates/0/content/parts")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Gemini response contained no candidate parts".to_string())?;

    let mut thought_chunks: Vec<String> = Vec::new();
    let mut answer_chunks: Vec<String> = Vec::new();

    for part in parts {
        let is_thought = part.get("thought").and_then(|b| b.as_bool()) == Some(true);
        if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                continue;
            }
            if is_thought {
                thought_chunks.push(trimmed.to_string());
            } else {
                answer_chunks.push(text.to_string());
            }
        }
    }

    if answer_chunks.is_empty() {
        return Err("Gemini response contained no non-thought answer text".to_string());
    }

    let answer_text = answer_chunks.join("\n").trim().to_string();
    let thinking_summary = if thought_chunks.is_empty() {
        None
    } else {
        Some(thought_chunks.join("\n\n"))
    };

    let usage = parsed.get("usageMetadata");
    let input_tokens = usage
        .and_then(|u| u.get("promptTokenCount"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let output_tokens = usage
        .and_then(|u| u.get("candidatesTokenCount"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let thought_tokens = usage
        .and_then(|u| u.get("thoughtsTokenCount"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    Ok((
        answer_text,
        thinking_summary,
        input_tokens,
        output_tokens,
        thought_tokens,
    ))
}

/// Resolves the target Gemini 4 model, clamped thinking level, and whether the call counts
/// toward the Tier-2 deep-reasoning daily budget.
pub fn resolve_otto_model_and_thinking(
    model_choice: Option<&str>,
    thinking_level: Option<&str>,
    default_t1: &str,
    default_t2: &str,
    user_message: &str,
    has_context_seed: bool,
) -> (String, String, bool) {
    let raw_model = model_choice.unwrap_or("auto").trim().to_ascii_lowercase();
    let raw_thinking = thinking_level.unwrap_or("auto").trim().to_ascii_lowercase();

    let lower_msg = user_message.to_ascii_lowercase();
    let needs_deep_reasoning = has_context_seed
        || lower_msg.contains("false positive")
        || lower_msg.contains("defect")
        || lower_msg.contains("bug")
        || lower_msg.contains("attack")
        || lower_msg.contains("breach")
        || lower_msg.contains("root cause")
        || lower_msg.contains("rca")
        || lower_msg.contains("waf")
        || lower_msg.contains("cve")
        || lower_msg.contains("upgrade")
        || user_message.len() > 260;

    let (model, is_tier2) = match raw_model.as_str() {
        "gemini-4-hydrogen" | "hydrogen" => ("gemini-4-hydrogen".to_string(), false),
        "gemini-4-neon" | "neon" => ("gemini-4-neon".to_string(), true),
        "gemini-4-carbon" | "carbon" => ("gemini-4-carbon".to_string(), true),
        _ => {
            if needs_deep_reasoning {
                let m = if default_t2.trim().is_empty() {
                    "gemini-4-neon"
                } else {
                    default_t2.trim()
                };
                (m.to_string(), true)
            } else {
                let m = if default_t1.trim().is_empty() {
                    "gemini-4-hydrogen"
                } else {
                    default_t1.trim()
                };
                (m.to_string(), false)
            }
        }
    };

    let mut level = match raw_thinking.as_str() {
        "low" => "low".to_string(),
        "medium" => "medium".to_string(),
        "high" => "high".to_string(),
        "xhigh" => "xhigh".to_string(),
        _ => {
            if is_tier2 {
                "high".to_string()
            } else {
                "medium".to_string()
            }
        }
    };

    // Gemini 4 Carbon supports low/medium/high (not xhigh)
    if model == "gemini-4-carbon" && level == "xhigh" {
        level = "high".to_string();
    }

    (model, level, is_tier2)
}

fn short_model_label(model: &str) -> &'static str {
    match model {
        "gemini-4-hydrogen" => "Hydrogen",
        "gemini-4-neon" => "Neon",
        "gemini-4-carbon" => "Carbon",
        _ => "Gemini 4",
    }
}

/// Extracts optional fenced ```otto-proposal ... ``` JSON blocks from Otto's response and returns
/// `(clean_markdown_prose, parsed_proposals)`.
fn parse_otto_proposed_actions(answer_text: &str) -> (String, Vec<OttoModelProposalDraft>) {
    let fence = "```otto-proposal";
    let Some(start_idx) = answer_text.find(fence) else {
        return (answer_text.to_string(), Vec::new());
    };

    let after_fence = &answer_text[start_idx + fence.len()..];
    let Some(end_rel) = after_fence.find("```") else {
        return (answer_text.to_string(), Vec::new());
    };

    let json_raw = after_fence[..end_rel].trim();
    let end_abs = start_idx + fence.len() + end_rel + 3;

    let mut drafts = Vec::new();
    if let Ok(val) = serde_json::from_str::<Value>(json_raw) {
        if let Some(arr) = val.as_array() {
            for item in arr {
                if let Ok(d) = serde_json::from_value::<OttoModelProposalDraft>(item.clone()) {
                    drafts.push(d);
                }
            }
        } else if let Ok(d) = serde_json::from_value::<OttoModelProposalDraft>(val) {
            drafts.push(d);
        }
    }

    let mut clean = String::new();
    clean.push_str(answer_text[..start_idx].trim_end());
    let tail = answer_text[end_abs..].trim_start();
    if !tail.is_empty() {
        if !clean.is_empty() {
            clean.push_str("\n\n");
        }
        clean.push_str(tail);
    }

    (clean, drafts)
}

pub fn build_trace_debug_bundle_markdown(detail: &OttoTraceDetailDto) -> String {
    let r = &detail.run;
    let mut md = String::new();
    md.push_str(&format!("# Otto SRE Trace Debug Bundle — `{}`\n\n", r.id));
    md.push_str(&format!(
        "- **Trigger:** `{}` | **Domain:** `{}` | **Asset:** `{}`\n",
        r.trigger_kind,
        r.domain,
        r.asset_slug.as_deref().unwrap_or("fleet")
    ));
    md.push_str(&format!(
        "- **Final State:** `{}` | **Model:** `{}` (`{}`)\n",
        r.final_state,
        r.model_used.as_deref().unwrap_or("none"),
        r.thinking_level.as_deref().unwrap_or("none")
    ));
    md.push_str(&format!(
        "- **Tokens:** input={} / output={} / thought={} | **Duration:** {} ms\n",
        r.input_tokens, r.output_tokens, r.thought_tokens, r.duration_ms
    ));
    md.push_str(&format!(
        "- **Started:** `{}` | **Completed:** `{}`\n",
        r.started_at,
        r.completed_at.as_deref().unwrap_or("in-progress")
    ));
    md.push_str(&format!(
        "- **Outcome:** {}\n",
        scrub_secrets(&r.outcome_summary)
    ));
    if let Some(ref err) = r.error_text {
        md.push_str(&format!("- **Error:** `{}`\n", scrub_secrets(err)));
    }
    md.push_str("\n## Execution Steps & Deep-Thinking Rundown\n\n");

    for step in &detail.steps {
        md.push_str(&format!(
            "### Step {}: [{}] {} ({} · {} ms)\n\n",
            step.step_index + 1,
            step.step_type,
            scrub_secrets(&step.title),
            step.status,
            step.duration_ms
        ));
        if let Some(ref thought) = step.thinking_summary_md {
            if !thought.trim().is_empty() {
                md.push_str("#### Deep-Thinking Rundown\n\n");
                md.push_str(&scrub_secrets(thought));
                md.push_str("\n\n");
            }
        }
        if let Some(ref payload) = step.structured_payload_json {
            if !payload.trim().is_empty() {
                md.push_str("```json\n");
                md.push_str(&scrub_secrets(payload));
                md.push_str("\n```\n\n");
            }
        }
    }

    scrub_secrets(&md)
}

// ============================================================================
// Read-Only Telemetry Context Gathering (Zero Mutation)
// ============================================================================

struct GatheredReadOnlyContext {
    context_json: Value,
    tools_used: Vec<OttoToolUsePill>,
    protected_ips: Vec<String>,
}

fn gather_otto_readonly_context(
    db: &SreDatabase,
    runtime: &OttoRuntimeController,
    context_seed_json: Option<&str>,
) -> GatheredReadOnlyContext {
    let mut tools_used = Vec::new();

    // 1. Threat SOC runs, findings, actors, quarantine, allowlist
    let t0 = Instant::now();
    let threat_runs = db.list_threat_audit_runs(3).unwrap_or_default();
    let latest_findings = threat_runs
        .first()
        .and_then(|run| db.list_threat_findings_for_run(&run.id).ok())
        .unwrap_or_default();
    let active_actors = db.list_threat_actors(Some("ACTIVE")).unwrap_or_default();
    let quarantined_emails = db.list_quarantined_access_emails().unwrap_or_default();
    let allowlist = db.list_threat_allowlist().unwrap_or_default();

    let protected_ips: Vec<String> = allowlist
        .iter()
        .filter(|a| a.entry_type.eq_ignore_ascii_case("IP"))
        .map(|a| a.value.clone())
        .collect();

    let findings_compact: Vec<Value> = latest_findings
        .iter()
        .take(15)
        .map(|f| {
            json!({
                "id": f.id,
                "sourceLayer": f.source_layer,
                "ruleId": f.rule_id,
                "severity": f.severity,
                "category": f.category,
                "title": f.title,
                "summary": scrub_secrets(&f.summary).chars().take(260).collect::<String>(),
                "host": f.host,
                "actorIp": f.actor_ip,
                "actorAsn": f.actor_asn,
                "disposition": f.disposition
            })
        })
        .collect();

    let actors_compact: Vec<Value> = active_actors
        .iter()
        .take(15)
        .map(|a| {
            json!({
                "id": a.id,
                "ip": a.ip_address,
                "asn": a.asn,
                "asOrg": a.as_org,
                "country": a.country,
                "severity": a.highest_severity,
                "classification": a.latest_classification,
                "requests": a.total_requests,
                "origin200s": a.total_origin_200s,
                "targetHosts": a.target_hosts_json,
                "samplePaths": a.sample_paths_json,
                "disposition": a.disposition
            })
        })
        .collect();

    let quarantine_compact: Vec<Value> = quarantined_emails
        .iter()
        .take(15)
        .map(|q| {
            json!({
                "email": q.email,
                "status": q.status,
                "firstSeenAt": q.first_seen_at,
                "lastSeenAt": q.last_seen_at,
                "reviewNote": q.review_note
            })
        })
        .collect();

    tools_used.push(OttoToolUsePill {
        tool: "inspect_threat_soc_sqlite".to_string(),
        summary: format!(
            "{} findings, {} active actors, {} quarantined emails",
            latest_findings.len(),
            active_actors.len(),
            quarantined_emails.len()
        ),
        items_count: latest_findings.len() + active_actors.len() + quarantined_emails.len(),
        duration_ms: t0.elapsed().as_millis() as i64,
    });

    // 2. Deploy telemetry history
    let t1 = Instant::now();
    let deploy_runs = db.get_deploy_telemetry_runs(10).unwrap_or_default();
    let deploys_compact: Vec<Value> = deploy_runs
        .iter()
        .map(|d| {
            json!({
                "appSlug": d.app_slug,
                "status": d.status,
                "releaseId": d.release_id,
                "wallSec": d.wall_duration_sec,
                "startedAt": d.started_at,
                "warningsCount": d.warnings.len()
            })
        })
        .collect();
    tools_used.push(OttoToolUsePill {
        tool: "inspect_deploy_telemetry".to_string(),
        summary: format!("{} recent deploy runs", deploy_runs.len()),
        items_count: deploy_runs.len(),
        duration_ms: t1.elapsed().as_millis() as i64,
    });

    // 3. Recent system logs
    let t2 = Instant::now();
    let sys_logs = db.get_logs(20, None).unwrap_or_default();
    let logs_compact: Vec<Value> = sys_logs
        .iter()
        .map(|l| {
            json!({
                "category": l.category,
                "level": l.level,
                "message": scrub_secrets(&l.message).chars().take(220).collect::<String>(),
                "createdAt": l.created_at
            })
        })
        .collect();
    tools_used.push(OttoToolUsePill {
        tool: "inspect_system_logs".to_string(),
        summary: format!("{} latest SRE audit/system entries", sys_logs.len()),
        items_count: sys_logs.len(),
        duration_ms: t2.elapsed().as_millis() as i64,
    });

    // 4. Governance, Policy Matrix & Suricata Gatekeeper budget
    let t3 = Instant::now();
    let policies = db.list_otto_policies().unwrap_or_default();
    let state = db.get_otto_state().ok();
    let suricata = runtime.ssh_budget.snapshot();
    let soak_sessions = db.list_otto_soak_sessions(10).unwrap_or_default();
    tools_used.push(OttoToolUsePill {
        tool: "inspect_otto_policy_and_suricata".to_string(),
        summary: format!(
            "{} policies, {} soak sessions, SSH SYN budget {}/{}",
            policies.len(),
            soak_sessions.len(),
            suricata.used_last_120s,
            suricata.max_per_120s
        ),
        items_count: policies.len() + soak_sessions.len(),
        duration_ms: t3.elapsed().as_millis() as i64,
    });

    let seed_value: Value = context_seed_json
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .unwrap_or(Value::Null);

    let context_json = json!({
        "pinnedEventContext": seed_value,
        "latestThreatRun": threat_runs.first().map(|r| json!({
            "id": r.id,
            "startedAt": r.started_at,
            "status": r.status,
            "overallSeverity": r.overall_severity,
            "intrusionVerdict": r.intrusion_verdict,
            "tier1Model": r.tier1_model,
            "tier2Model": r.tier2_model
        })),
        "latestThreatFindings": findings_compact,
        "activeThreatActors": actors_compact,
        "quarantinedAccessEmails": quarantine_compact,
        "allowlistSummary": {
            "totalEntries": allowlist.len(),
            "protectedIpsCount": protected_ips.len(),
            "allowedEmailsCount": allowlist.iter().filter(|a| a.entry_type.eq_ignore_ascii_case("EMAIL")).count()
        },
        "recentDeploys": deploys_compact,
        "recentSystemLogs": logs_compact,
        "ottoGovernance": {
            "agentState": state,
            "suricataBudget": suricata,
            "recentSoakSessions": soak_sessions.iter().take(6).map(|s| json!({
                "id": s.id,
                "appSlug": s.app_slug,
                "hostingTarget": s.hosting_target,
                "releaseId": s.release_id,
                "previousImageTag": s.previous_image_tag,
                "hasDbMigration": s.has_db_migration,
                "status": s.status,
                "startedAt": s.started_at,
                "endsAt": s.ends_at
            })).collect::<Vec<_>>(),
            "policies": policies.iter().map(|p| json!({
                "actionId": p.action_id,
                "domain": p.domain,
                "tier": p.asset_tier,
                "mode": p.mode,
                "maxAllowedMode": p.max_allowed_mode
            })).collect::<Vec<_>>()
        }
    });

    GatheredReadOnlyContext {
        context_json,
        tools_used,
        protected_ips,
    }
}

fn otto_system_prompt() -> &'static str {
    r#"You are **Otto**, the Autonomous AI SRE Engineer embedded inside **PanoramaSRE** for the **PanoramaDrSuite** ecosystem.

## PanoramaDrSuite Tech Stack & Real Exposure Surface (GROUND TRUTH)
1. **WSH Host (`wsh.panoramadr.com`, DietPi ARM64 on Raspberry Pi 5):**
   - Runs 6 containerized Next.js 16+ (App Router, Node 22 Alpine, SQLite WAL) apps bound strictly to `127.0.0.1:3000-3005` behind host Lighttpd `:443` and an isolated Cloudflare Tunnel (`cloudflared` on `cf-egress-net` `100.64.250.0/24`):
     - **Tier-0 Critical:** `PanoramaAuth` (`/auth`, `:3000`, Central RS256 JWKS + FIDO2 Passkey IdP), `unifi-siem` (syslog receiver), `Lighttpd`, `cloudflared`, WSH kernel firewall (`PANORAMA-INPUT`, `DOCKER-USER`).
     - **Tier-1 Child Apps:** `SpendyLedger` (`/spendy`, `:3001`), `BiomedMaven` (`/biomed`, `:3002`), `WaterAnalyzer` (`/water`, `:3003`), `TastyBasket` (`/basket`, `:3004`), `EnergyAnalyzer` (`/energy`, `:3005`).
   - Protected by **Cloudflare Zero Trust Access** at the edge (strict-host scoping + 72h SessionAuthIndex + Email Quarantine). Publicly reachable routes without Access cookie are ONLY `/api/health` and `/auth/api/auth/jwks` (plus public auth manifest/callback paths).
   - Zero PHP, zero WordPress, zero Apache/Nginx/Tomcat/Spring/Laravel/JNDI, zero exposed public SSH (`:22` is LAN/UniFi-only; Suricata IDS rule `2003068` fires if >4 SSH SYNs occur in 120s — Otto is capped at 2 SYNs/120s via dedicated `sre-agent-wsh` forced-command key).
2. **ParakithSite (`parakith.com`, Tier-2 External Edge):**
   - Static **Cloudflare Pages** + **Cloudflare Pages Functions** + **Cloudflare D1** SQLite. Zero origin server, zero container runtime, zero PHP/CMS.
3. **UniFi Network Appliances (Tier-2 External Edge):**
   - `ui.panoramadr.com` / `protect.panoramadr.com` — isolated VLANs (`Trusted`, `Guest`, `IoT`, `Kids`).

## Mandatory Threat & False-Positive Reasoning Protocol (CRITICAL)
Whenever analyzing Threat SOC findings, internal perimeter alerts, or external actors:
1. **Inside-Perimeter Alerts -> Check for Detection / Code Defects FIRST:**
   - Most historical inside-perimeter alerts in PanoramaSRE have been **false positives** caused by detection logic gaps (e.g., family member roaming across Wi-Fi/5G/Starlink IPs after valid Cloudflare Access login, UniFi CEF field-parsing glitches, isolated Guest/IoT VLAN noise, or allowlist propagation lag).
   - Explicitly classify findings using one of:
     - `DETECTION_DEFECT_SUSPECTED` (explain the probable parser/correlation bug and recommend a `create_bug_handoff` diagnostic instead of blocking!)
     - `CONFIRMED_BENIGN_FALSE_POSITIVE` (explain why the traffic is legitimate family/admin behavior)
     - `NOISE_SAFE_DROP` (generic internet background scan hitting non-existent `.php`/`.env`/`wp-login.php` on our Next.js/CF-Pages stack with 0 origin 200s — explain clearly why our stack is NOT exposed and it can be safely ignored/dropped without wasting WAF rules)
     - `MATERIAL_THREAT` (credible attack matching our real Next.js/SQLite/CF-Access/D1 exposure surface, sustained volumetric burst, or authenticated-boundary anomaly)
2. **Hard Safety Boundaries (Compiled Rust Policy Kernel):**
   - You NEVER emit raw shell commands for autonomous execution.
   - You NEVER propose mutating production SQLite DBs, flushing iptables, touching `.ssh/`, `.env.local.keys`, bumping Major/Minor SemVer versions, or blocking Protected Allowlist/LAN/Cloudflare/health/JWKS targets.
3. **Optional Structured Proposal Block:**
   - Only if the operator asks for a concrete remediation/handoff OR you identify a crisp, policy-valid action from the compiled catalog (`restart_container`, `restart_tier0_hard_down`, `rollback_n3_db_safe`, `renew_ssl_cert`, `prune_buildkit_cache`, `apply_cf_temp_challenge`, `apply_cf_permanent_waf`, `stage_worktree_patch`, `deploy_verified_patch`, `wsh_apt_dist_upgrade`, `create_bug_handoff`), you MAY append ONE fenced block at the very end of your response:
```otto-proposal
{
  "actionId": "create_bug_handoff",
  "assetSlug": "auth",
  "domain": "BUG_DIAGNOSTIC",
  "classification": "DETECTION_DEFECT_SUSPECTED",
  "title": "Concise action title",
  "severity": "MEDIUM",
  "confidence": 0.88,
  "rcaSummary": "1-2 sentence root cause summary",
  "params": {},
  "targetIps": [],
  "targetPaths": [],
  "hasDbMigration": false,
  "evidence": ["finding-id or log reference"]
}
```
   - Never fabricate telemetry that is not present in the JSON context snapshot. Be concise, technical, crisp, and actionable."#
}

async fn call_otto_gemini(
    api_key: &str,
    model: &str,
    thinking_level: &str,
    history_contents: Vec<Value>,
) -> Result<(String, Option<String>, i64, i64, i64), String> {
    let client = shared_otto_gemini_client()
        .ok_or_else(|| "Failed to initialize Otto Gemini HTTPS client".to_string())?;
    let clean_model = model.trim().trim_start_matches("models/");
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        clean_model
    );

    let body = json!({
        "systemInstruction": {
            "parts": [{ "text": otto_system_prompt() }]
        },
        "contents": history_contents,
        "generationConfig": {
            "temperature": 0.2,
            "thinkingConfig": {
                "thinkingLevel": thinking_level,
                "includeThoughts": true
            }
        }
    });

    let timeout_secs = match thinking_level {
        "low" => 65,
        "medium" => 120,
        "high" => 165,
        _ => 185,
    };

    let mut last_err = String::new();
    for attempt in 0..3 {
        let resp = client
            .post(&url)
            .timeout(Duration::from_secs(timeout_secs))
            .header("x-goog-api-key", api_key.trim())
            .json(&body)
            .send()
            .await;

        match resp {
            Ok(r) => {
                let status = r.status();
                let raw_text = r.text().await.unwrap_or_default();
                if status.is_success() {
                    let parsed: Value = serde_json::from_str(&raw_text)
                        .map_err(|e| format!("Invalid Gemini HTTP envelope: {}", e))?;
                    return extract_gemini_parts_with_thoughts(&parsed);
                }

                let code = status.as_u16();
                last_err = format!(
                    "Gemini {} returned HTTP {}: {}",
                    clean_model,
                    code,
                    scrub_secrets(&raw_text.chars().take(260).collect::<String>())
                );
                if (code == 429 || code == 503) && attempt < 2 {
                    tokio::time::sleep(Duration::from_secs(2u64.pow(attempt as u32 + 1))).await;
                    continue;
                }
                return Err(last_err);
            }
            Err(err) => {
                let is_timeout = err.is_timeout();
                last_err = if is_timeout {
                    format!("Gemini {} timed out after {}s", clean_model, timeout_secs)
                } else {
                    format!("Gemini transport error ({}): {}", clean_model, err)
                };
                if !is_timeout && attempt < 2 {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    continue;
                }
                return Err(last_err);
            }
        }
    }

    Err(last_err)
}

fn sync_runtime_snapshot(
    app: Option<&AppHandle>,
    db: &SreDatabase,
    runtime: &OttoRuntimeController,
) -> OttoLifecycleSnapshot {
    let state = db.get_otto_state().unwrap_or(OttoAgentStateRow {
        kill_switch_active: false,
        circuit_breaker_state: "CLOSED".to_string(),
        tripped_reason: None,
        tripped_at: None,
        consecutive_failures: 0,
        daily_t1_calls: 0,
        daily_t2_calls: 0,
        budget_date_utc: Utc::now().format("%Y-%m-%d").to_string(),
        dropped_noise_24h_count: 0,
        updated_at: Utc::now().to_rfc3339(),
    });
    let pending = db.count_pending_otto_approvals().unwrap_or(0);
    let active_soaks = db.count_active_otto_soaks().unwrap_or(0);
    runtime.sync_from_db_state(
        app,
        state.kill_switch_active,
        &state.circuit_breaker_state,
        pending,
        active_soaks,
        state.daily_t1_calls,
        state.daily_t2_calls,
        state.dropped_noise_24h_count,
    )
}

// ============================================================================
// Tauri IPC Commands — Governance, Status & Policy
// ============================================================================

#[tauri::command]
pub fn get_otto_status(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    runtime: State<'_, Arc<OttoRuntimeController>>,
) -> Result<OttoStatusDto, String> {
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    let agent_state = guard
        .get_otto_state()
        .map_err(|e| format!("Failed to read Otto state: {}", e))?;
    let lifecycle = sync_runtime_snapshot(None, &guard, &runtime);
    let prefs = load_threat_preferences(&guard);
    let gemini_configured = resolve_gemini_api_key(&guard).is_some();
    let suricata = runtime.ssh_budget.snapshot();

    Ok(OttoStatusDto {
        lifecycle,
        agent_state,
        suricata,
        gemini_configured,
        default_tier1_model: prefs.tier1_model,
        default_tier2_model: prefs.tier2_model,
        daily_t2_cap: prefs.daily_carbon_cap,
    })
}

#[tauri::command]
pub fn set_otto_kill_switch(
    app: AppHandle,
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    runtime: State<'_, Arc<OttoRuntimeController>>,
    active: bool,
    reason: Option<String>,
) -> Result<OttoStatusDto, String> {
    let why = reason
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(if active {
            "Operator engaged Global Emergency Kill-Switch"
        } else {
            "Operator released Global Emergency Kill-Switch"
        });

    if active {
        runtime.request_abort();
    } else {
        runtime.clear_abort();
    }

    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    let agent_state = guard
        .set_otto_kill_switch(active, why)
        .map_err(|e| format!("Failed to toggle Otto kill-switch: {}", e))?;
    let lifecycle = sync_runtime_snapshot(Some(&app), &guard, &runtime);
    let prefs = load_threat_preferences(&guard);
    let gemini_configured = resolve_gemini_api_key(&guard).is_some();
    let suricata = runtime.ssh_budget.snapshot();

    Ok(OttoStatusDto {
        lifecycle,
        agent_state,
        suricata,
        gemini_configured,
        default_tier1_model: prefs.tier1_model,
        default_tier2_model: prefs.tier2_model,
        daily_t2_cap: prefs.daily_carbon_cap,
    })
}

#[tauri::command]
pub fn abort_otto_active_step(
    app: AppHandle,
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    runtime: State<'_, Arc<OttoRuntimeController>>,
) -> Result<OttoLifecycleSnapshot, String> {
    runtime.request_abort();
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    let _ = guard.append_otto_audit(
        "STEP_ABORT",
        None,
        None,
        "ABORT_REQUESTED",
        "Operator requested abort of Otto's active step",
        runtime.snapshot().trace_run_id.as_deref(),
    );
    let _ = runtime.set_phase(
        Some(&app),
        OttoRuntimePhase::Idle,
        "Otto: Idle · Shadow",
        None,
        None,
        None,
        "Active step aborted by operator",
        None,
        false,
    );
    Ok(sync_runtime_snapshot(Some(&app), &guard, &runtime))
}

#[tauri::command]
pub fn reset_otto_circuit_breaker(
    app: AppHandle,
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    runtime: State<'_, Arc<OttoRuntimeController>>,
) -> Result<OttoStatusDto, String> {
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    let agent_state = guard
        .reset_otto_circuit_breaker()
        .map_err(|e| format!("Failed to reset circuit breaker: {}", e))?;
    let lifecycle = sync_runtime_snapshot(Some(&app), &guard, &runtime);
    let prefs = load_threat_preferences(&guard);
    let gemini_configured = resolve_gemini_api_key(&guard).is_some();
    let suricata = runtime.ssh_budget.snapshot();

    Ok(OttoStatusDto {
        lifecycle,
        agent_state,
        suricata,
        gemini_configured,
        default_tier1_model: prefs.tier1_model,
        default_tier2_model: prefs.tier2_model,
        daily_t2_cap: prefs.daily_carbon_cap,
    })
}

#[tauri::command]
pub fn get_otto_policies(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
) -> Result<Vec<OttoPolicyRow>, String> {
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    guard
        .list_otto_policies()
        .map_err(|e| format!("Failed to list Otto policies: {}", e))
}

#[tauri::command]
pub fn update_otto_policy_mode(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    action_id: String,
    mode: String,
) -> Result<OttoPolicyRow, String> {
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    guard.update_otto_policy_mode(&action_id, &mode)
}

#[tauri::command]
pub fn get_otto_l4_invariants() -> Vec<L4HardBlockInvariant> {
    l4_hard_blocked_invariants()
}

// ============================================================================
// Tauri IPC Commands — Verbose Traces & Debug Bundle Export
// ============================================================================

#[tauri::command]
pub fn get_otto_trace_runs(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    limit: Option<usize>,
) -> Result<Vec<OttoTraceRunRow>, String> {
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    guard
        .list_otto_trace_runs(limit.unwrap_or(50))
        .map_err(|e| format!("Failed to list Otto trace runs: {}", e))
}

#[tauri::command]
pub fn get_otto_trace_detail(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    trace_run_id: String,
) -> Result<Option<OttoTraceDetailDto>, String> {
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    guard
        .get_otto_trace_detail(&trace_run_id)
        .map_err(|e| format!("Failed to load Otto trace detail: {}", e))
}

#[tauri::command]
pub fn export_otto_trace_bundle(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    trace_run_id: String,
) -> Result<OttoTraceDebugBundleDto, String> {
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    let detail = guard
        .get_otto_trace_detail(&trace_run_id)
        .map_err(|e| format!("Failed to load trace detail: {}", e))?
        .ok_or_else(|| format!("Trace run '{}' not found", trace_run_id))?;

    let markdown = build_trace_debug_bundle_markdown(&detail);
    let raw_json = serde_json::to_string_pretty(&detail)
        .map_err(|e| format!("Failed to serialize trace bundle: {}", e))?;
    let json = scrub_secrets(&raw_json);

    Ok(OttoTraceDebugBundleDto {
        trace_run_id,
        markdown,
        json,
    })
}

// ============================================================================
// Tauri IPC Commands — Proposals & Decisions
// ============================================================================

#[tauri::command]
pub fn get_otto_proposals(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    limit: Option<usize>,
) -> Result<Vec<OttoProposalRow>, String> {
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    guard
        .list_otto_proposals(limit.unwrap_or(80))
        .map_err(|e| format!("Failed to list Otto proposals: {}", e))
}

#[tauri::command]
pub async fn decide_otto_proposal(
    app: AppHandle,
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    runtime: State<'_, Arc<OttoRuntimeController>>,
    job_manager: State<'_, Arc<JobManager>>,
    input: DecideOttoProposalInput,
) -> Result<OttoProposalRow, String> {
    let existing = {
        let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
        guard
            .get_otto_proposal_by_id(&input.proposal_id)
            .map_err(|e| format!("Failed to read proposal: {}", e))?
            .ok_or_else(|| format!("Proposal '{}' not found", input.proposal_id))?
    };

    let norm_decision = input.decision.trim().to_ascii_uppercase();
    if norm_decision == "APPROVE" {
        let db_arc = Arc::clone(db.inner());
        let rt_arc = Arc::clone(runtime.inner());
        let jm_arc = Arc::clone(job_manager.inner());
        let outcome = execute_compiled_otto_action(
            &app,
            &db_arc,
            &rt_arc,
            &jm_arc,
            &existing.action_id,
            &existing.asset_slug,
            &existing.params_json,
            Some(&existing.classification),
            Some(&existing.id),
            existing.trace_run_id.as_deref(),
            true,
            input.note.as_deref(),
        )
        .await?;

        let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
        guard
            .update_otto_proposal_execution(
                &existing.id,
                &outcome.final_status,
                Some(&outcome.verification_json),
            )
            .map_err(|e| format!("Failed updating approved proposal status: {}", e))?;
        let _ = sync_runtime_snapshot(Some(&app), &guard, &runtime);
        return guard
            .get_otto_proposal_by_id(&existing.id)
            .map_err(|e| format!("Failed to reload proposal: {}", e))?
            .ok_or_else(|| "Proposal disappeared after execution".to_string());
    }

    let (new_status, snoozed_until, verification_json) = match norm_decision.as_str() {
        "REJECT" => (
            "REJECTED".to_string(),
            None,
            Some(
                json!({
                    "note": scrub_secrets(input.note.as_deref().unwrap_or("Rejected by operator")),
                    "decidedAt": Utc::now().to_rfc3339()
                })
                .to_string(),
            ),
        ),
        "SNOOZE_24H" => {
            let until = (Utc::now() + chrono::Duration::hours(24)).to_rfc3339();
            ("SNOOZED".to_string(), Some(until), None)
        }
        "SHADOW_AGREE" => {
            if let Ok(guard) = db.lock() {
                let _ = guard.record_shadow_feedback(&existing.action_id, true);
            }
            (
                "SHADOW_AGREED".to_string(),
                None,
                Some(json!({ "shadowFeedback": "AGREED", "decidedAt": Utc::now().to_rfc3339() }).to_string()),
            )
        }
        "SHADOW_DISAGREE" => {
            if let Ok(guard) = db.lock() {
                let _ = guard.record_shadow_feedback(&existing.action_id, false);
            }
            (
                "SHADOW_DISAGREED".to_string(),
                None,
                Some(json!({ "shadowFeedback": "DISAGREED", "decidedAt": Utc::now().to_rfc3339() }).to_string()),
            )
        }
        _ => return Err(format!("Unsupported proposal decision '{}'", input.decision)),
    };

    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    guard
        .update_otto_proposal_status(
            &existing.id,
            &new_status,
            snoozed_until.as_deref(),
            verification_json.as_deref(),
        )
        .map_err(|e| format!("Failed to update proposal status: {}", e))?;

    let _ = guard.append_otto_audit(
        "PROPOSAL_DECISION",
        Some(&existing.action_id),
        Some(&existing.asset_slug),
        &new_status,
        input.note.as_deref().unwrap_or(&existing.title),
        existing.trace_run_id.as_deref(),
    );

    let _ = sync_runtime_snapshot(Some(&app), &guard, &runtime);

    guard
        .get_otto_proposal_by_id(&existing.id)
        .map_err(|e| format!("Failed to reload proposal: {}", e))?
        .ok_or_else(|| "Proposal disappeared after decision".to_string())
}

// ============================================================================
// Tauri IPC Commands — Ask Otto Conversational Threads & Saved Prompts
// ============================================================================

#[tauri::command]
pub fn get_otto_chat_threads(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    limit: Option<usize>,
) -> Result<Vec<OttoChatThreadRow>, String> {
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    guard
        .list_otto_chat_threads(limit.unwrap_or(50))
        .map_err(|e| format!("Failed to list Otto chat threads: {}", e))
}

#[tauri::command]
pub fn create_otto_chat_thread(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    input: CreateOttoChatThreadInput,
) -> Result<OttoChatThreadRow, String> {
    let title = if input.title.trim().is_empty() {
        "New Otto Investigation".to_string()
    } else {
        input.title.trim().chars().take(120).collect()
    };
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    guard
        .create_otto_chat_thread(
            &title,
            input.context_seed_json.as_deref(),
            input.origin_view.as_deref(),
            input.origin_entity_id.as_deref(),
        )
        .map_err(|e| format!("Failed to create Otto chat thread: {}", e))
}

#[tauri::command]
pub fn delete_otto_chat_thread(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    thread_id: String,
) -> Result<(), String> {
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    guard
        .delete_otto_chat_thread(&thread_id)
        .map_err(|e| format!("Failed to delete Otto chat thread: {}", e))
}

#[tauri::command]
pub fn get_otto_chat_messages(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    thread_id: String,
) -> Result<Vec<OttoChatMessageRow>, String> {
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    guard
        .list_otto_chat_messages(&thread_id)
        .map_err(|e| format!("Failed to list Otto chat messages: {}", e))
}

#[tauri::command]
pub fn get_otto_saved_prompts(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
) -> Result<Vec<OttoSavedPromptRow>, String> {
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    guard
        .list_otto_saved_prompts()
        .map_err(|e| format!("Failed to list Otto saved prompts: {}", e))
}

#[tauri::command]
pub fn save_otto_prompt(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    title: String,
    prompt_text: String,
    category: Option<String>,
) -> Result<OttoSavedPromptRow, String> {
    let clean_title = title.trim();
    let clean_text = prompt_text.trim();
    if clean_title.is_empty() || clean_text.is_empty() {
        return Err("Prompt title and body cannot be empty".to_string());
    }
    let cat = category
        .as_deref()
        .map(|s| s.trim().to_ascii_uppercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "GENERAL".to_string());
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    guard
        .insert_otto_saved_prompt(clean_title, clean_text, &cat)
        .map_err(|e| format!("Failed to save prompt: {}", e))
}

#[tauri::command]
pub fn delete_otto_prompt(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    id: String,
) -> Result<(), String> {
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    guard
        .delete_otto_saved_prompt(&id)
        .map_err(|e| format!("Failed to delete saved prompt: {}", e))
}

#[tauri::command]
pub async fn send_otto_chat_message(
    app: AppHandle,
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    runtime: State<'_, Arc<OttoRuntimeController>>,
    input: SendOttoChatMessageInput,
) -> Result<SendOttoChatMessageResult, String> {
    let trimmed_msg = input.user_message.trim();
    if trimmed_msg.is_empty() {
        return Err("Message cannot be empty".to_string());
    }

    runtime.clear_abort();
    let run_start = Instant::now();

    // 1. Gather API key, preferences, thread history, and read-only telemetry context under short lock
    let (
        api_key,
        model_used,
        thinking_level,
        is_tier2,
        user_msg_row,
        trace_run_id,
        history_contents,
        gathered_tools,
        protected_ips,
        agent_state_snapshot,
        policies_snapshot,
    ) = {
        let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
        let resolved_key = resolve_gemini_api_key(&guard).ok_or_else(|| {
            "Gemini API key not configured. Add it under Settings → Threat Intelligence & AI Connectors.".to_string()
        })?;
        let prefs = load_threat_preferences(&guard);
        let agent_state = guard
            .get_otto_state()
            .map_err(|e| format!("Failed to read Otto state: {}", e))?;
        let policies = guard.list_otto_policies().unwrap_or_default();

        // Pull thread's stored seed if caller didn't override
        let thread_seed = input.context_seed_json.clone().or_else(|| {
            guard
                .list_otto_chat_threads(100)
                .ok()
                .and_then(|ts| ts.into_iter().find(|t| t.id == input.thread_id))
                .and_then(|t| t.context_seed_json)
        });

        let (model, level, tier2) = resolve_otto_model_and_thinking(
            input.model_choice.as_deref(),
            input.thinking_level.as_deref(),
            &prefs.tier1_model,
            &prefs.tier2_model,
            trimmed_msg,
            thread_seed.is_some(),
        );

        let trace_id = guard
            .create_otto_trace_run("CHAT", "CONVERSATION", None, Some(&model), Some(&level))
            .map_err(|e| format!("Failed to create Otto trace run: {}", e))?;

        let _ = runtime.set_phase(
            Some(&app),
            OttoRuntimePhase::Stage0Eval,
            "Otto: Stage-0 Context",
            Some(model.clone()),
            Some(level.clone()),
            Some("sre.sqlite".to_string()),
            "Inspecting local Threat SOC, deploys, logs & policy guardrails",
            Some(trace_id.clone()),
            true,
        );

        let _ = guard.append_otto_trace_step(
            &trace_id,
            0,
            "TRIGGER",
            &format!("Ask Otto turn in thread {}", input.thread_id),
            "OK",
            0,
            None,
            Some(
                &json!({
                    "threadId": input.thread_id,
                    "hasContextSeed": thread_seed.is_some(),
                    "modelSelected": model,
                    "thinkingLevel": level
                })
                .to_string(),
            ),
        );

        let user_row = guard
            .insert_otto_chat_message(
                &input.thread_id,
                "user",
                trimmed_msg,
                None,
                None,
                None,
                None,
                None,
                Some(&trace_id),
                None,
            )
            .map_err(|e| format!("Failed to store user message: {}", e))?;

        let gathered = gather_otto_readonly_context(&guard, &runtime, thread_seed.as_deref());
        let _ = guard.append_otto_trace_step(
            &trace_id,
            1,
            "TOOL_CALL",
            &format!("Executed {} read-only inspection tools", gathered.tools_used.len()),
            "OK",
            gathered.tools_used.iter().map(|t| t.duration_ms).sum(),
            None,
            Some(&serde_json::to_string(&gathered.tools_used).unwrap_or_else(|_| "[]".to_string())),
        );

        // Build multi-turn Gemini `contents` (cap to last 10 prior messages + current enriched prompt)
        let prior_msgs = guard
            .list_otto_chat_messages(&input.thread_id)
            .unwrap_or_default();
        let mut contents: Vec<Value> = Vec::new();
        let skip_last_id = user_row.id.clone();
        let recent_history: Vec<&OttoChatMessageRow> = prior_msgs
            .iter()
            .filter(|m| m.id != skip_last_id)
            .rev()
            .take(10)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();

        for msg in recent_history {
            let role = if msg.role == "assistant" { "model" } else { "user" };
            contents.push(json!({
                "role": role,
                "parts": [{ "text": msg.content_md }]
            }));
        }

        let context_blob = serde_json::to_string(&gathered.context_json).unwrap_or_else(|_| "{}".to_string());
        let enriched_prompt = format!(
            "## Live Read-Only PanoramaSRE Telemetry Context\n```json\n{}\n```\n\n## Operator Question\n{}",
            scrub_secrets(&context_blob),
            scrub_secrets(trimmed_msg)
        );
        contents.push(json!({
            "role": "user",
            "parts": [{ "text": enriched_prompt }]
        }));

        (
            resolved_key.value,
            model,
            level,
            tier2,
            user_row,
            trace_id,
            contents,
            gathered.tools_used,
            gathered.protected_ips,
            agent_state,
            policies,
        )
    };

    // 2. Broadcast THINKING state before calling Gemini 4 API
    let _ = runtime.set_phase(
        Some(&app),
        OttoRuntimePhase::Thinking,
        format!(
            "Otto: Thinking ({} · {})",
            short_model_label(&model_used),
            thinking_level
        ),
        Some(model_used.clone()),
        Some(thinking_level.clone()),
        Some("Ask Otto".to_string()),
        "Reasoning with native Deep-Thinking rundown",
        Some(trace_run_id.clone()),
        true,
    );

    let llm_start = Instant::now();
    let llm_result = call_otto_gemini(&api_key, &model_used, &thinking_level, history_contents).await;
    let llm_ms = llm_start.elapsed().as_millis() as i64;

    if runtime.is_abort_requested() {
        let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
        let _ = guard.append_otto_trace_step(
            &trace_run_id,
            2,
            "LLM_THINKING",
            "Turn aborted by operator before completion",
            "ABORTED",
            llm_ms,
            None,
            None,
        );
        let _ = guard.complete_otto_trace_run(
            &trace_run_id,
            "ABORTED",
            Some(&model_used),
            Some(&thinking_level),
            0,
            0,
            0,
            run_start.elapsed().as_millis() as i64,
            "Operator aborted active Otto step",
            Some("Aborted by operator"),
        );
        let _ = sync_runtime_snapshot(Some(&app), &guard, &runtime);
        return Err("Otto step aborted by operator".to_string());
    }

    let (raw_answer, thinking_summary, in_tok, out_tok, thought_tok) = match llm_result {
        Ok(tuple) => tuple,
        Err(err_msg) => {
            let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
            let _ = guard.append_otto_trace_step(
                &trace_run_id,
                2,
                "LLM_THINKING",
                &format!("Gemini call failed ({})", model_used),
                "FAILED",
                llm_ms,
                None,
                Some(&json!({ "error": scrub_secrets(&err_msg) }).to_string()),
            );
            let _ = guard.complete_otto_trace_run(
                &trace_run_id,
                "FAILED",
                Some(&model_used),
                Some(&thinking_level),
                0,
                0,
                0,
                run_start.elapsed().as_millis() as i64,
                "Gemini 4 call failed",
                Some(&err_msg),
            );
            let _ = runtime.set_phase(
                Some(&app),
                OttoRuntimePhase::Idle,
                "Otto: Idle · Shadow",
                None,
                None,
                None,
                "Ready",
                None,
                false,
            );
            let _ = sync_runtime_snapshot(Some(&app), &guard, &runtime);
            return Err(err_msg);
        }
    };

    // 3. Parse optional proposals, evaluate STRICTLY through Policy-as-Code Kernel, persist trace & chat reply
    let (mut final_markdown, drafts) = parse_otto_proposed_actions(&raw_answer);
    let mut inline_proposal: Option<OttoProposalRow> = None;

    let (assistant_row, lifecycle_after) = {
        let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
        let _ = guard.increment_otto_ai_usage(is_tier2);

        let _ = guard.append_otto_trace_step(
            &trace_run_id,
            2,
            "LLM_THINKING",
            &format!(
                "Gemini {} ({}) deep reasoning complete ({} thought tokens)",
                short_model_label(&model_used),
                thinking_level,
                thought_tok
            ),
            "OK",
            llm_ms,
            thinking_summary.as_deref(),
            Some(
                &json!({
                    "model": model_used,
                    "thinkingLevel": thinking_level,
                    "inputTokens": in_tok,
                    "outputTokens": out_tok,
                    "thoughtTokens": thought_tok
                })
                .to_string(),
            ),
        );

        for (offset, draft) in drafts.into_iter().take(2).enumerate() {
            let step_idx = 3i64 + offset as i64;
            let asset_tier = AssetTier::from_slug(&draft.asset_slug, None);
            let configured_mode = policies_snapshot
                .iter()
                .find(|p| p.action_id == draft.action_id)
                .and_then(|p| AutonomyMode::parse(&p.mode))
                .unwrap_or(AutonomyMode::Shadow);

            let proposed_semver = match (&draft.proposed_semver_old, &draft.proposed_semver_new) {
                (Some(old_v), Some(new_v)) => Some((old_v.clone(), new_v.clone())),
                _ => None,
            };

            let eval_req = PolicyEvalRequest {
                action_id: draft.action_id.clone(),
                asset_slug: draft.asset_slug.clone(),
                asset_tier,
                configured_mode,
                kill_switch_active: agent_state_snapshot.kill_switch_active,
                circuit_breaker_tripped: agent_state_snapshot.circuit_breaker_state == "TRIPPED",
                has_db_migration: draft.has_db_migration,
                classification: Some(draft.classification.clone()),
                raw_payload_text: format!(
                    "{} {} {}",
                    draft.title,
                    draft.rca_summary,
                    draft.params
                ),
                target_ips: draft.target_ips.clone(),
                target_paths: draft.target_paths.clone(),
                protected_ips: protected_ips.clone(),
                proposed_semver_bump: proposed_semver,
            };

            let decision = evaluate_policy_decision(&eval_req);
            let _ = guard.append_otto_trace_step(
                &trace_run_id,
                step_idx,
                "POLICY_CHECK",
                &format!(
                    "Policy Kernel evaluated '{}' -> {:?}",
                    draft.action_id, decision.verdict
                ),
                if decision.verdict == PolicyVerdict::DenyL4HardBlocked {
                    "BLOCKED"
                } else {
                    "OK"
                },
                1,
                None,
                Some(&serde_json::to_string(&decision).unwrap_or_else(|_| "{}".to_string())),
            );

            match decision.verdict {
                PolicyVerdict::DenyL4HardBlocked => {
                    let inv = decision.invariant_id.as_deref().unwrap_or("L4");
                    let _ = guard.append_otto_audit(
                        "POLICY_BLOCK",
                        Some(&draft.action_id),
                        Some(&draft.asset_slug),
                        "L4_HARD_BLOCKED",
                        &format!("[{}] {}", inv, decision.reason),
                        Some(&trace_run_id),
                    );
                    final_markdown.push_str(&format!(
                        "\n\n> **Policy Kernel Hard-Block ({}):** Proposed action `{}` was permanently blocked: {}",
                        inv, draft.action_id, decision.reason
                    ));
                }
                PolicyVerdict::DenyKillSwitch | PolicyVerdict::DenyCircuitBreaker => {
                    let _ = guard.append_otto_audit(
                        "POLICY_BLOCK",
                        Some(&draft.action_id),
                        Some(&draft.asset_slug),
                        "HALTED",
                        &decision.reason,
                        Some(&trace_run_id),
                    );
                    final_markdown.push_str(&format!(
                        "\n\n> **Safety Halt:** Proposal `{}` was not queued: {}",
                        draft.action_id, decision.reason
                    ));
                }
                _ => {
                    let status = match decision.verdict {
                        PolicyVerdict::ShadowOnly | PolicyVerdict::AllowObserve => "SHADOW_LOGGED",
                        _ => "PENDING_APPROVAL",
                    };
                    let mut flags = Vec::new();
                    if asset_tier == AssetTier::Tier0Critical {
                        flags.push("TIER0_CRITICAL".to_string());
                    }
                    if draft.has_db_migration {
                        flags.push("DB_MIGRATION".to_string());
                    }
                    if !draft.target_ips.is_empty() {
                        flags.push("EDGE_WAF".to_string());
                    }
                    let proposal = OttoProposalRow {
                        id: format!("prop-{}", Uuid::new_v4()),
                        trace_run_id: Some(trace_run_id.clone()),
                        domain: draft.domain.to_ascii_uppercase(),
                        classification: draft.classification.to_ascii_uppercase(),
                        asset_slug: draft.asset_slug.clone(),
                        asset_tier: asset_tier.as_str().to_string(),
                        action_id: draft.action_id.clone(),
                        params_json: draft.params.to_string(),
                        title: draft.title.clone(),
                        severity: draft.severity.to_ascii_uppercase(),
                        confidence: draft.confidence.clamp(0.0, 1.0),
                        rca_summary: draft.rca_summary.clone(),
                        evidence_json: serde_json::to_string(&draft.evidence)
                            .unwrap_or_else(|_| "[]".to_string()),
                        diff_preview: None,
                        rollback_plan_json: Some(
                            json!({
                                "mode": decision.effective_mode.as_str(),
                                "checksPassed": decision.checks_passed
                            })
                            .to_string(),
                        ),
                        blast_radius_flags_json: serde_json::to_string(&flags)
                            .unwrap_or_else(|_| "[]".to_string()),
                        status: status.to_string(),
                        snoozed_until: None,
                        created_at: Utc::now().to_rfc3339(),
                        decided_at: None,
                        executed_at: None,
                        verification_result_json: None,
                    };
                    if guard.insert_otto_proposal(&proposal).is_ok() {
                        let _ = guard.append_otto_audit(
                            "PROPOSAL_CREATED",
                            Some(&proposal.action_id),
                            Some(&proposal.asset_slug),
                            status,
                            &proposal.title,
                            Some(&trace_run_id),
                        );
                        if inline_proposal.is_none() {
                            inline_proposal = Some(proposal);
                        }
                    }
                }
            }
        }

        let tools_json = serde_json::to_string(&gathered_tools).unwrap_or_else(|_| "[]".to_string());
        let usage_json = json!({
            "inputTokens": in_tok,
            "outputTokens": out_tok,
            "thoughtTokens": thought_tok,
            "durationMs": run_start.elapsed().as_millis() as i64
        })
        .to_string();

        let assistant_msg = guard
            .insert_otto_chat_message(
                &input.thread_id,
                "assistant",
                &final_markdown,
                Some(&model_used),
                Some(&thinking_level),
                thinking_summary.as_deref(),
                Some(&tools_json),
                inline_proposal.as_ref().map(|p| p.id.as_str()),
                Some(&trace_run_id),
                Some(&usage_json),
            )
            .map_err(|e| format!("Failed to store Otto reply: {}", e))?;

        let _ = guard.complete_otto_trace_run(
            &trace_run_id,
            "COMPLETED",
            Some(&model_used),
            Some(&thinking_level),
            in_tok,
            out_tok,
            thought_tok,
            run_start.elapsed().as_millis() as i64,
            &format!(
                "Answered Ask Otto turn using {} ({} thought tokens{})",
                short_model_label(&model_used),
                thought_tok,
                if inline_proposal.is_some() {
                    ", 1 proposal staged"
                } else {
                    ""
                }
            ),
            None,
        );

        let _ = runtime.set_phase(
            Some(&app),
            OttoRuntimePhase::Idle,
            "Otto: Idle · Shadow",
            None,
            None,
            None,
            "Standing watch in Shadow / Observe mode",
            Some(trace_run_id.clone()),
            false,
        );
        let snap = sync_runtime_snapshot(Some(&app), &guard, &runtime);
        (assistant_msg, snap)
    };

    Ok(SendOttoChatMessageResult {
        user_message: user_msg_row,
        assistant_message: assistant_row,
        trace_run_id,
        inline_proposal,
        lifecycle: lifecycle_after,
    })
}

// ============================================================================
// Tauri IPC Commands — Suricata-Safe Gatekeeper Status & Read-Only Probes
// ============================================================================

#[tauri::command]
pub fn get_suricata_gatekeeper_status(
    runtime: State<'_, Arc<OttoRuntimeController>>,
) -> SuricataGatekeeperStatusDto {
    runtime.ssh_budget.snapshot()
}

#[tauri::command]
pub async fn test_sre_agent_gatekeeper_connection(
    app: AppHandle,
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    runtime: State<'_, Arc<OttoRuntimeController>>,
) -> Result<OttoLogDeltaProbeResult, String> {
    let budget = Arc::clone(&runtime.ssh_budget);
    let _ = runtime.set_phase(
        Some(&app),
        OttoRuntimePhase::Sensing,
        "Otto: Probing Gatekeeper",
        None,
        None,
        Some("wsh.panoramadr.com".to_string()),
        "Testing sre-agent-wsh forced-command key (probe-snapshot)",
        None,
        false,
    );

    let probe_res = tokio::task::spawn_blocking(move || run_gatekeeper_verb(&budget, "probe-snapshot"))
        .await
        .map_err(|e| format!("Gatekeeper probe task panicked: {}", e))?;

    let suricata = runtime.ssh_budget.snapshot();
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    let _ = runtime.set_phase(
        Some(&app),
        OttoRuntimePhase::Idle,
        "Otto: Idle · Shadow",
        None,
        None,
        None,
        "Ready",
        None,
        false,
    );
    let _ = sync_runtime_snapshot(Some(&app), &guard, &runtime);

    match probe_res {
        Ok(stdout) => {
            let lines = stdout.lines().count();
            let _ = guard.append_otto_audit(
                "GATEKEEPER_PROBE",
                Some("probe-snapshot"),
                Some("wsh"),
                "OK",
                &format!("sre-agent-wsh forced-command probe-snapshot succeeded ({} lines)", lines),
                None,
            );
            Ok(OttoLogDeltaProbeResult {
                ok: true,
                verb: "probe-snapshot".to_string(),
                detail: format!("Connected via sre-agent-wsh ({} lines returned)", lines),
                line_count: lines,
                preview: stdout.chars().take(600).collect(),
                suricata,
            })
        }
        Err(err) => {
            let _ = guard.append_otto_audit(
                "GATEKEEPER_PROBE",
                Some("probe-snapshot"),
                Some("wsh"),
                "FAILED",
                &err,
                None,
            );
            Ok(OttoLogDeltaProbeResult {
                ok: false,
                verb: "probe-snapshot".to_string(),
                detail: err,
                line_count: 0,
                preview: String::new(),
                suricata,
            })
        }
    }
}

#[tauri::command]
pub async fn run_otto_log_delta_probe(
    app: AppHandle,
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    runtime: State<'_, Arc<OttoRuntimeController>>,
) -> Result<OttoLogDeltaProbeResult, String> {
    let budget = Arc::clone(&runtime.ssh_budget);
    let _ = runtime.set_phase(
        Some(&app),
        OttoRuntimePhase::Sensing,
        "Otto: Sensing Logs",
        None,
        None,
        Some("wsh.panoramadr.com".to_string()),
        "Coalescing WSH + container log delta via sre-agent-wsh (1 SSH SYN)",
        None,
        false,
    );

    let probe_res = tokio::task::spawn_blocking(move || run_gatekeeper_verb(&budget, "probe-logs"))
        .await
        .map_err(|e| format!("Log delta probe task panicked: {}", e))?;

    let suricata = runtime.ssh_budget.snapshot();
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    let _ = runtime.set_phase(
        Some(&app),
        OttoRuntimePhase::Idle,
        "Otto: Idle · Shadow",
        None,
        None,
        None,
        "Ready",
        None,
        false,
    );
    let _ = sync_runtime_snapshot(Some(&app), &guard, &runtime);

    match probe_res {
        Ok(stdout) => {
            let lines = stdout.lines().count();
            let cursor_ts = Utc::now().to_rfc3339();
            let _ = guard.upsert_otto_log_cursor("wsh_coalesced_logs", &cursor_ts);
            let _ = guard.append_otto_audit(
                "LOG_DELTA_PROBE",
                Some("probe-logs"),
                Some("wsh"),
                "OK",
                &format!("Coalesced WSH log delta returned {} lines (cursor updated)", lines),
                None,
            );
            Ok(OttoLogDeltaProbeResult {
                ok: true,
                verb: "probe-logs".to_string(),
                detail: format!("Coalesced {} log lines in 1 SSH SYN", lines),
                line_count: lines,
                preview: stdout.chars().take(800).collect(),
                suricata,
            })
        }
        Err(err) => {
            let _ = guard.append_otto_audit(
                "LOG_DELTA_PROBE",
                Some("probe-logs"),
                Some("wsh"),
                "FAILED",
                &err,
                None,
            );
            Ok(OttoLogDeltaProbeResult {
                ok: false,
                verb: "probe-logs".to_string(),
                detail: err,
                line_count: 0,
                preview: String::new(),
                suricata,
            })
        }
    }
}

// ============================================================================
// Phase 2 Tauri IPC Commands — Post-Deploy Soak Monitor & Steady-State Self-Heal
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOttoSoakInput {
    pub app_slug: String,
    pub hosting_target: Option<String>,
    pub release_id: String,
    pub previous_image_tag: Option<String>,
    #[serde(default)]
    pub has_db_migration: bool,
    pub duration_secs: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoakAppObservationInput {
    pub app_slug: String,
    pub hosting_target: Option<String>,
    pub healthy: bool,
    pub latency_ms: Option<u64>,
    pub container_state: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluateOttoSoakTickInput {
    pub observations: Vec<SoakAppObservationInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluateSteadyStateInput {
    pub unhealthy_apps: Vec<SoakAppObservationInput>,
    pub buildkit_reclaimable_bytes: Option<u64>,
    pub buildkit_total_bytes: Option<u64>,
    pub ssl_min_days_remaining: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoSteadyStateResult {
    pub trace_run_id: String,
    pub evaluated_checks: usize,
    pub proposals_created: Vec<String>,
    pub actions_executed: Vec<String>,
    pub summary: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueOttoManualProposalInput {
    pub action_id: String,
    pub asset_slug: String,
    pub title: String,
    pub rca_summary: String,
    pub params_json: Option<String>,
    pub severity: Option<String>,
    pub domain: Option<String>,
    pub has_db_migration: Option<bool>,
}

#[tauri::command]
pub fn get_otto_soak_sessions(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    limit: Option<usize>,
) -> Result<Vec<OttoSoakSessionRow>, String> {
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    guard
        .list_otto_soak_sessions(limit.unwrap_or(25))
        .map_err(|e| format!("Failed listing Otto soak sessions: {}", e))
}

#[tauri::command]
pub fn start_otto_soak_session(
    app: AppHandle,
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    runtime: State<'_, Arc<OttoRuntimeController>>,
    input: StartOttoSoakInput,
) -> Result<OttoSoakSessionRow, String> {
    let slug = input.app_slug.trim().to_ascii_lowercase();
    if slug.is_empty() {
        return Err("appSlug cannot be empty".to_string());
    }
    let hosting_target = input
        .hosting_target
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("wsh-docker")
        .to_string();
    let duration = input
        .duration_secs
        .unwrap_or(DEFAULT_SOAK_DURATION_SECS)
        .clamp(60, 3600);
    let now = Utc::now();
    let ends_at = now + chrono::Duration::seconds(duration);
    let soak_id = format!("soak-{}-{}", slug, Uuid::new_v4());

    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    let trace_id = guard
        .create_otto_trace_run("SOAK", "HEAL", Some(&slug), None, None)
        .map_err(|e| format!("Failed creating soak trace run: {}", e))?;

    let _ = guard.append_otto_trace_step(
        &trace_id,
        0,
        "SENSE",
        &format!(
            "Started {}m post-deploy soak monitor for '{}' (release {}, DB_MIGRATION={})",
            duration / 60,
            slug,
            input.release_id,
            input.has_db_migration
        ),
        "OK",
        0,
        None,
        Some(
            &json!({
                "soakId": soak_id,
                "appSlug": slug,
                "hostingTarget": hosting_target,
                "releaseId": input.release_id,
                "previousImageTag": input.previous_image_tag,
                "hasDbMigration": input.has_db_migration,
                "endsAt": ends_at.to_rfc3339()
            })
            .to_string(),
        ),
    );

    let row = OttoSoakSessionRow {
        id: soak_id,
        app_slug: slug.clone(),
        hosting_target,
        release_id: input.release_id,
        previous_image_tag: input.previous_image_tag,
        has_db_migration: input.has_db_migration,
        started_at: now.to_rfc3339(),
        ends_at: ends_at.to_rfc3339(),
        status: "SOAKING".to_string(),
        samples_json: "[]".to_string(),
        trace_run_id: Some(trace_id.clone()),
        updated_at: now.to_rfc3339(),
    };

    guard
        .insert_otto_soak_session(&row)
        .map_err(|e| format!("Failed inserting soak session: {}", e))?;
    let _ = guard.append_otto_audit(
        "SOAK_STARTED",
        Some("rollback_n3_db_safe"),
        Some(&slug),
        "SOAKING",
        &format!(
            "Monitoring {}m soak window (prev_tag={:?}, db_migration={})",
            duration / 60,
            row.previous_image_tag,
            row.has_db_migration
        ),
        Some(&trace_id),
    );

    let _ = sync_runtime_snapshot(Some(&app), &guard, &runtime);
    let _ = app.emit("sre://agent-soaks-updated", &row);
    Ok(row)
}

#[tauri::command]
pub fn cancel_otto_soak_session(
    app: AppHandle,
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    runtime: State<'_, Arc<OttoRuntimeController>>,
    soak_id: String,
) -> Result<OttoSoakSessionRow, String> {
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    let sessions = guard
        .list_otto_soak_sessions(50)
        .map_err(|e| format!("Failed listing soak sessions: {}", e))?;
    let existing = sessions
        .into_iter()
        .find(|s| s.id == soak_id)
        .ok_or_else(|| format!("Soak session '{}' not found", soak_id))?;

    guard
        .update_otto_soak_session(&existing.id, "CANCELLED", &existing.samples_json, None)
        .map_err(|e| format!("Failed cancelling soak session: {}", e))?;
    if let Some(ref tid) = existing.trace_run_id {
        let _ = guard.complete_otto_trace_run(
            tid,
            "CANCELLED",
            None,
            None,
            0,
            0,
            0,
            0,
            "Post-deploy soak monitor cancelled by operator",
            None,
        );
    }
    let _ = sync_runtime_snapshot(Some(&app), &guard, &runtime);

    let mut updated = existing;
    updated.status = "CANCELLED".to_string();
    let _ = app.emit("sre://agent-soaks-updated", &updated);
    Ok(updated)
}

#[tauri::command]
pub async fn evaluate_otto_soak_tick(
    app: AppHandle,
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    runtime: State<'_, Arc<OttoRuntimeController>>,
    job_manager: State<'_, Arc<JobManager>>,
    input: EvaluateOttoSoakTickInput,
) -> Result<Vec<OttoSoakSessionRow>, String> {
    let now = Utc::now();
    let degraded_apps: Vec<String> = input
        .observations
        .iter()
        .filter(|o| !o.healthy)
        .map(|o| o.app_slug.trim().to_ascii_lowercase())
        .collect();

    // Snapshot active soaks + policies + state under short DB lock
    let (active_soaks, agent_state, policies, hourly_l2) = {
        let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
        let all = guard.list_otto_soak_sessions(40).unwrap_or_default();
        let active: Vec<OttoSoakSessionRow> =
            all.into_iter().filter(|s| s.status == "SOAKING").collect();
        let st = guard
            .get_otto_state()
            .map_err(|e| format!("Failed reading Otto state: {}", e))?;
        let pols = guard.list_otto_policies().unwrap_or_default();
        let h_l2 = guard.count_recent_l2_executions(3600).unwrap_or(0);
        (active, st, pols, h_l2)
    };

    if active_soaks.is_empty() {
        return Ok(Vec::new());
    }

    let rollback_pol = policies
        .iter()
        .find(|p| p.action_id == "rollback_n3_db_safe");
    let rollback_mode = rollback_pol
        .and_then(|p| AutonomyMode::parse(&p.mode))
        .unwrap_or(AutonomyMode::Shadow);
    let rollback_cooldown_secs = rollback_pol.map(|p| p.cooldown_secs).unwrap_or(3600);

    let mut pending_l2_execs: Vec<(String, String, String, String, Option<String>)> = Vec::new();
    let mut notify_l3_items: Vec<FormattedBulletItem> = Vec::new();
    let mut notify_cascade_items: Vec<FormattedBulletItem> = Vec::new();

    for soak in active_soaks {
        let Some(obs) = input
            .observations
            .iter()
            .find(|o| o.app_slug.eq_ignore_ascii_case(&soak.app_slug))
        else {
            continue;
        };

        let mut samples: Vec<SoakSample> =
            serde_json::from_str(&soak.samples_json).unwrap_or_default();
        samples.push(SoakSample {
            timestamp: now.to_rfc3339(),
            healthy: obs.healthy,
            latency_ms: obs.latency_ms,
            container_state: obs.container_state.clone(),
            detail: obs
                .detail
                .clone()
                .unwrap_or_else(|| if obs.healthy { "healthy".into() } else { "unhealthy".into() }),
        });
        if samples.len() > 40 {
            let excess = samples.len() - 40;
            samples.drain(0..excess);
        }

        let consecutive_unhealthy = samples.iter().rev().take_while(|s| !s.healthy).count();
        let window_elapsed = DateTime::parse_from_rfc3339(&soak.ends_at)
            .map(|end| now >= end.with_timezone(&Utc))
            .unwrap_or(false);

        let asset_tier = AssetTier::from_slug(&soak.app_slug, Some(&soak.hosting_target));
        let restart_action_id = if asset_tier == AssetTier::Tier0Critical {
            "restart_tier0_hard_down"
        } else {
            "restart_container"
        };
        let restart_pol = policies.iter().find(|p| p.action_id == restart_action_id);
        let restart_mode = restart_pol
            .and_then(|p| AutonomyMode::parse(&p.mode))
            .unwrap_or(AutonomyMode::Shadow);
        let restart_cooldown_secs = restart_pol.map(|p| p.cooldown_secs).unwrap_or(900);

        let (rb_cool, rs_cool) = {
            let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
            let last_rb = guard
                .last_executed_action_at("rollback_n3_db_safe", &soak.app_slug)
                .ok()
                .flatten();
            let last_rs = guard
                .last_executed_action_at(restart_action_id, &soak.app_slug)
                .ok()
                .flatten();
            (
                is_cooldown_active(last_rb.as_deref(), rollback_cooldown_secs, now),
                is_cooldown_active(last_rs.as_deref(), restart_cooldown_secs, now),
            )
        };

        let decision = evaluate_soak_decision(&SoakEvaluationInput {
            app_slug: soak.app_slug.clone(),
            hosting_target: soak.hosting_target.clone(),
            asset_tier,
            release_id: soak.release_id.clone(),
            previous_image_tag: soak.previous_image_tag.clone(),
            has_db_migration: soak.has_db_migration,
            window_elapsed,
            consecutive_unhealthy,
            degraded_apps_in_window: degraded_apps.clone(),
            rollback_policy_mode: rollback_mode,
            restart_policy_mode: restart_mode,
            kill_switch_active: agent_state.kill_switch_active,
            circuit_breaker_tripped: agent_state.circuit_breaker_state == "TRIPPED",
            rollback_cooldown_active: rb_cool,
            restart_cooldown_active: rs_cool,
            hourly_l2_executions: hourly_l2,
        });

        let samples_str = serde_json::to_string(&samples).unwrap_or_else(|_| "[]".to_string());
        let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
        let step_idx = soak
            .trace_run_id
            .as_deref()
            .and_then(|tid| guard.get_otto_trace_detail(tid).ok().flatten())
            .map(|d| d.steps.len() as i64)
            .unwrap_or(1);

        match decision {
            SoakDecision::ContinueSoaking => {
                let _ = guard.update_otto_soak_session(&soak.id, "SOAKING", &samples_str, None);
            }
            SoakDecision::HealthyVerified => {
                let _ = guard.update_otto_soak_session(
                    &soak.id,
                    "HEALTHY_VERIFIED",
                    &samples_str,
                    None,
                );
                if let Some(ref tid) = soak.trace_run_id {
                    let _ = guard.append_otto_trace_step(
                        tid,
                        step_idx,
                        "OUTCOME_VERIFY",
                        &format!(
                            "15m post-deploy soak completed cleanly for '{}' ({} healthy samples)",
                            soak.app_slug,
                            samples.len()
                        ),
                        "OK",
                        0,
                        None,
                        Some(&json!({ "samplesCount": samples.len(), "releaseId": soak.release_id }).to_string()),
                    );
                    let _ = guard.complete_otto_trace_run(
                        tid,
                        "COMPLETED",
                        None,
                        None,
                        0,
                        0,
                        0,
                        0,
                        &format!("Soak HEALTHY_VERIFIED for {} ({})", soak.app_slug, soak.release_id),
                        None,
                    );
                }
                let _ = guard.append_otto_audit(
                    "SOAK_VERIFIED",
                    Some("rollback_n3_db_safe"),
                    Some(&soak.app_slug),
                    "HEALTHY_VERIFIED",
                    &format!("Release {} passed full post-deploy soak window", soak.release_id),
                    soak.trace_run_id.as_deref(),
                );
            }
            SoakDecision::CascadeEscalateL3 {
                degraded_apps: ref apps_bad,
                ref reason,
            } => {
                let _ = guard.update_otto_soak_session(&soak.id, "ESCALATED_L3", &samples_str, None);
                let prop = OttoProposalRow {
                    id: format!("prop-{}", Uuid::new_v4()),
                    trace_run_id: soak.trace_run_id.clone(),
                    domain: "HEAL".to_string(),
                    classification: "RELIABILITY".to_string(),
                    asset_slug: "wsh".to_string(),
                    asset_tier: AssetTier::Tier0Critical.as_str().to_string(),
                    action_id: "restart_tier0_hard_down".to_string(),
                    params_json: json!({ "degradedApps": apps_bad }).to_string(),
                    title: format!(
                        "Shared Infrastructure Cascade Detected ({} Apps Degraded)",
                        apps_bad.len()
                    ),
                    severity: "CRITICAL".to_string(),
                    confidence: 0.95,
                    rca_summary: reason.clone(),
                    evidence_json: serde_json::to_string(apps_bad).unwrap_or_else(|_| "[]".into()),
                    diff_preview: None,
                    rollback_plan_json: Some(json!({ "guard": "CROSS_APP_CASCADE_GUARD" }).to_string()),
                    blast_radius_flags_json: json!(["CASCADE_GUARD", "TIER0_CRITICAL"]).to_string(),
                    status: "PENDING_APPROVAL".to_string(),
                    snoozed_until: None,
                    created_at: now.to_rfc3339(),
                    decided_at: None,
                    executed_at: None,
                    verification_result_json: None,
                };
                let _ = guard.insert_otto_proposal(&prop);
                notify_cascade_items.push(FormattedBulletItem {
                    label: "Shared Infra Cascade".to_string(),
                    detail: reason.clone(),
                });
            }
            SoakDecision::ShadowRollback {
                ref previous_tag,
                ref reason,
            } => {
                let _ = guard.update_otto_soak_session(&soak.id, "DEGRADED_SHADOW", &samples_str, None);
                let prop = OttoProposalRow {
                    id: format!("prop-{}", Uuid::new_v4()),
                    trace_run_id: soak.trace_run_id.clone(),
                    domain: "HEAL".to_string(),
                    classification: "RELIABILITY".to_string(),
                    asset_slug: soak.app_slug.clone(),
                    asset_tier: asset_tier.as_str().to_string(),
                    action_id: "rollback_n3_db_safe".to_string(),
                    params_json: json!({ "previousTag": previous_tag, "hasDbMigration": false }).to_string(),
                    title: format!("[SHADOW] Roll back '{}' to {}", soak.app_slug, previous_tag),
                    severity: "HIGH".to_string(),
                    confidence: 0.9,
                    rca_summary: reason.clone(),
                    evidence_json: samples_str.clone(),
                    diff_preview: None,
                    rollback_plan_json: Some(json!({ "previousTag": previous_tag, "mode": "SHADOW" }).to_string()),
                    blast_radius_flags_json: json!(["SHADOW_DRY_RUN"]).to_string(),
                    status: "SHADOW_LOGGED".to_string(),
                    snoozed_until: None,
                    created_at: now.to_rfc3339(),
                    decided_at: None,
                    executed_at: None,
                    verification_result_json: None,
                };
                let _ = guard.insert_otto_proposal(&prop);
                if let Some(ref tid) = soak.trace_run_id {
                    let _ = guard.append_otto_trace_step(
                        tid,
                        step_idx,
                        "POLICY_KERNEL",
                        reason,
                        "SHADOW",
                        0,
                        None,
                        Some(&json!({ "previousTag": previous_tag, "remoteCommandsExecuted": 0 }).to_string()),
                    );
                }
            }
            SoakDecision::EscalateL3Rollback {
                ref previous_tag,
                ref reason,
                ref blast_radius_flags,
            } => {
                let _ = guard.update_otto_soak_session(&soak.id, "ESCALATED_L3", &samples_str, None);
                let prop = OttoProposalRow {
                    id: format!("prop-{}", Uuid::new_v4()),
                    trace_run_id: soak.trace_run_id.clone(),
                    domain: "HEAL".to_string(),
                    classification: "RELIABILITY".to_string(),
                    asset_slug: soak.app_slug.clone(),
                    asset_tier: asset_tier.as_str().to_string(),
                    action_id: "rollback_n3_db_safe".to_string(),
                    params_json: json!({
                        "previousTag": previous_tag,
                        "hasDbMigration": soak.has_db_migration
                    })
                    .to_string(),
                    title: format!("Soak Regression: Review Rollback for '{}'", soak.app_slug),
                    severity: "HIGH".to_string(),
                    confidence: 0.92,
                    rca_summary: reason.clone(),
                    evidence_json: samples_str.clone(),
                    diff_preview: None,
                    rollback_plan_json: Some(json!({ "previousTag": previous_tag }).to_string()),
                    blast_radius_flags_json: serde_json::to_string(blast_radius_flags)
                        .unwrap_or_else(|_| "[]".into()),
                    status: "PENDING_APPROVAL".to_string(),
                    snoozed_until: None,
                    created_at: now.to_rfc3339(),
                    decided_at: None,
                    executed_at: None,
                    verification_result_json: None,
                };
                let _ = guard.insert_otto_proposal(&prop);
                notify_l3_items.push(FormattedBulletItem {
                    label: soak.app_slug.clone(),
                    detail: reason.clone(),
                });
            }
            SoakDecision::ShadowRestart {
                ref action_id,
                ref container_name,
                ref reason,
            } => {
                let _ = guard.update_otto_soak_session(&soak.id, "DEGRADED_SHADOW", &samples_str, None);
                let prop = OttoProposalRow {
                    id: format!("prop-{}", Uuid::new_v4()),
                    trace_run_id: soak.trace_run_id.clone(),
                    domain: "HEAL".to_string(),
                    classification: "RELIABILITY".to_string(),
                    asset_slug: soak.app_slug.clone(),
                    asset_tier: asset_tier.as_str().to_string(),
                    action_id: action_id.clone(),
                    params_json: json!({ "containerName": container_name }).to_string(),
                    title: format!("[SHADOW] Restart container '{}'", container_name),
                    severity: "HIGH".to_string(),
                    confidence: 0.88,
                    rca_summary: reason.clone(),
                    evidence_json: samples_str.clone(),
                    diff_preview: None,
                    rollback_plan_json: None,
                    blast_radius_flags_json: json!(["TIER0_CRITICAL", "SHADOW_DRY_RUN"]).to_string(),
                    status: "SHADOW_LOGGED".to_string(),
                    snoozed_until: None,
                    created_at: now.to_rfc3339(),
                    decided_at: None,
                    executed_at: None,
                    verification_result_json: None,
                };
                let _ = guard.insert_otto_proposal(&prop);
            }
            SoakDecision::EscalateL3Restart {
                ref action_id,
                ref container_name,
                ref reason,
            } => {
                let _ = guard.update_otto_soak_session(&soak.id, "ESCALATED_L3", &samples_str, None);
                let prop = OttoProposalRow {
                    id: format!("prop-{}", Uuid::new_v4()),
                    trace_run_id: soak.trace_run_id.clone(),
                    domain: "HEAL".to_string(),
                    classification: "RELIABILITY".to_string(),
                    asset_slug: soak.app_slug.clone(),
                    asset_tier: asset_tier.as_str().to_string(),
                    action_id: action_id.clone(),
                    params_json: json!({ "containerName": container_name }).to_string(),
                    title: format!("Review Hard-Down Restart for '{}'", container_name),
                    severity: "CRITICAL".to_string(),
                    confidence: 0.9,
                    rca_summary: reason.clone(),
                    evidence_json: samples_str.clone(),
                    diff_preview: None,
                    rollback_plan_json: None,
                    blast_radius_flags_json: json!(["TIER0_CRITICAL"]).to_string(),
                    status: "PENDING_APPROVAL".to_string(),
                    snoozed_until: None,
                    created_at: now.to_rfc3339(),
                    decided_at: None,
                    executed_at: None,
                    verification_result_json: None,
                };
                let _ = guard.insert_otto_proposal(&prop);
                notify_l3_items.push(FormattedBulletItem {
                    label: container_name.clone(),
                    detail: reason.clone(),
                });
            }
            SoakDecision::ExecuteL2Rollback {
                ref previous_tag,
                ..
            } => {
                let _ = guard.update_otto_soak_session(&soak.id, "ROLLING_BACK", &samples_str, None);
                pending_l2_execs.push((
                    soak.id.clone(),
                    "rollback_n3_db_safe".to_string(),
                    soak.app_slug.clone(),
                    json!({ "previousTag": previous_tag, "hasDbMigration": false }).to_string(),
                    soak.trace_run_id.clone(),
                ));
            }
            SoakDecision::ExecuteL2Restart {
                ref action_id,
                ref container_name,
                ..
            } => {
                let _ = guard.update_otto_soak_session(&soak.id, "RECOVERING", &samples_str, None);
                pending_l2_execs.push((
                    soak.id.clone(),
                    action_id.clone(),
                    soak.app_slug.clone(),
                    json!({ "containerName": container_name }).to_string(),
                    soak.trace_run_id.clone(),
                ));
            }
        }
    }

    // Execute any L2_AUTO remediations cleanly outside DB mutex
    for (soak_id, action_id, slug, params_json, tid) in pending_l2_execs {
        let db_arc = Arc::clone(db.inner());
        let rt_arc = Arc::clone(runtime.inner());
        let jm_arc = Arc::clone(job_manager.inner());
        let res = execute_compiled_otto_action(
            &app,
            &db_arc,
            &rt_arc,
            &jm_arc,
            &action_id,
            &slug,
            &params_json,
            Some("RELIABILITY"),
            None,
            tid.as_deref(),
            false,
            None,
        )
        .await;

        if let Ok(guard) = db.lock() {
            let final_soak_state = match res {
                Ok(ref out) if out.success && action_id == "rollback_n3_db_safe" => "ROLLED_BACK",
                Ok(ref out) if out.success => "HEALTHY_VERIFIED",
                _ => "ESCALATED_L3",
            };
            if let Some(curr) = guard
                .list_otto_soak_sessions(40)
                .ok()
                .and_then(|v| v.into_iter().find(|s| s.id == soak_id))
            {
                let _ = guard.update_otto_soak_session(
                    &soak_id,
                    final_soak_state,
                    &curr.samples_json,
                    None,
                );
            }
        }
    }

    if !notify_cascade_items.is_empty() {
        maybe_notify_otto_event(
            db.inner(),
            OttoPushoverCategory::CircuitBreakerOrCascade,
            "Otto AI SRE • Shared Infra Cascade Escalated",
            "Per-App L2 Actions Suppressed (Cascade Guard):",
            &notify_cascade_items,
        )
        .await;
    }
    if !notify_l3_items.is_empty() {
        maybe_notify_otto_event(
            db.inner(),
            OttoPushoverCategory::L3ApprovalRequired,
            "Otto AI SRE • L3 Desktop Approval Required",
            "Post-Deploy Soak Escalated for Review:",
            &notify_l3_items,
        )
        .await;
    }

    let updated_list = {
        let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
        let _ = sync_runtime_snapshot(Some(&app), &guard, &runtime);
        guard.list_otto_soak_sessions(25).unwrap_or_default()
    };
    let _ = app.emit("sre://agent-soaks-updated", &updated_list);
    Ok(updated_list)
}

#[tauri::command]
pub async fn evaluate_otto_steady_state(
    app: AppHandle,
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    runtime: State<'_, Arc<OttoRuntimeController>>,
    job_manager: State<'_, Arc<JobManager>>,
    input: EvaluateSteadyStateInput,
) -> Result<OttoSteadyStateResult, String> {
    let now = Utc::now();
    let started = Instant::now();
    let mut evaluated_checks = 0usize;
    let mut proposals_created = Vec::new();
    let mut actions_executed = Vec::new();
    let mut l2_queue: Vec<(String, String, String, String)> = Vec::new();

    let trace_run_id = {
        let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
        let tid = guard
            .create_otto_trace_run("SCHEDULED", "HEAL", Some("fleet"), None, None)
            .map_err(|e| format!("Failed creating steady-state trace run: {}", e))?;
        let policies = guard.list_otto_policies().unwrap_or_default();
        let state = guard
            .get_otto_state()
            .map_err(|e| format!("Failed reading Otto state: {}", e))?;
        let hourly_l2 = guard.count_recent_l2_executions(3600).unwrap_or(0);
        let existing_open = guard.list_otto_proposals(100).unwrap_or_default();

        let has_open_proposal = |action_id: &str, slug: &str| -> bool {
            existing_open.iter().any(|p| {
                p.action_id == action_id
                    && p.asset_slug.eq_ignore_ascii_case(slug)
                    && matches!(p.status.as_str(), "PENDING_APPROVAL" | "SHADOW_LOGGED")
            })
        };

        let mut step_idx = 0i64;

        // 1. Calibrated BuildKit cache hygiene (>= 35 GB reclaimable OR >= 100 GB total)
        if let (Some(reclaim), Some(total)) = (input.buildkit_reclaimable_bytes, input.buildkit_total_bytes) {
            evaluated_checks += 1;
            let high = is_buildkit_cache_high(reclaim, total);
            let _ = guard.append_otto_trace_step(
                &tid,
                step_idx,
                "STAGE0_GATE",
                &format!(
                    "BuildKit cache hygiene check: {} ({:.2} GB reclaimable / {:.2} GB total)",
                    if high { "HIGH" } else { "NOMINAL" },
                    reclaim as f64 / 1e9,
                    total as f64 / 1e9
                ),
                "OK",
                0,
                None,
                Some(&json!({ "reclaimableBytes": reclaim, "totalBytes": total, "high": high }).to_string()),
            );
            step_idx += 1;

            if high && !has_open_proposal("prune_buildkit_cache", "buildkit") {
                let pol = policies.iter().find(|p| p.action_id == "prune_buildkit_cache");
                let mode = pol
                    .and_then(|p| AutonomyMode::parse(&p.mode))
                    .unwrap_or(AutonomyMode::Shadow);
                let cool = is_cooldown_active(
                    guard.last_executed_action_at("prune_buildkit_cache", "buildkit").ok().flatten().as_deref(),
                    pol.map(|p| p.cooldown_secs).unwrap_or(21600),
                    now,
                );
                let params_str = json!({
                    "reclaimableBytes": reclaim,
                    "totalBytes": total,
                    "filter": "until=72h"
                })
                .to_string();

                if mode == AutonomyMode::L2Auto
                    && !state.kill_switch_active
                    && state.circuit_breaker_state != "TRIPPED"
                    && !cool
                    && hourly_l2 < 3
                {
                    l2_queue.push(("prune_buildkit_cache".into(), "buildkit".into(), params_str, tid.clone()));
                } else if mode != AutonomyMode::Observe {
                    let status = if mode == AutonomyMode::Shadow { "SHADOW_LOGGED" } else { "PENDING_APPROVAL" };
                    let pid = format!("prop-{}", Uuid::new_v4());
                    let _ = guard.insert_otto_proposal(&OttoProposalRow {
                        id: pid.clone(),
                        trace_run_id: Some(tid.clone()),
                        domain: "HEAL".to_string(),
                        classification: "RELIABILITY".to_string(),
                        asset_slug: "buildkit".to_string(),
                        asset_tier: AssetTier::Tier1ChildApp.as_str().to_string(),
                        action_id: "prune_buildkit_cache".to_string(),
                        params_json: params_str,
                        title: format!(
                            "Prune Stale BuildKit Cache ({:.1} GB reclaimable / {:.1} GB total)",
                            reclaim as f64 / 1e9,
                            total as f64 / 1e9
                        ),
                        severity: "MEDIUM".to_string(),
                        confidence: 0.96,
                        rca_summary: "Local Docker BuildKit cache exceeded calibrated suite threshold (>= 35 GB reclaimable or >= 100 GB total). Runs docker buildx prune --all --filter until=72h -f.".to_string(),
                        evidence_json: json!([format!("reclaimable={}B", reclaim), format!("total={}B", total)]).to_string(),
                        diff_preview: None,
                        rollback_plan_json: Some(json!({ "note": "Non-destructive cache prune (>72h unused layers only)" }).to_string()),
                        blast_radius_flags_json: json!(["LOCAL_WORKSTATION_ONLY"]).to_string(),
                        status: status.to_string(),
                        snoozed_until: None,
                        created_at: now.to_rfc3339(),
                        decided_at: None,
                        executed_at: None,
                        verification_result_json: None,
                    });
                    proposals_created.push(pid);
                }
            }
        }

        // 2. Expiring SSL certificates (<21 days remaining)
        if let Some(min_days) = input.ssl_min_days_remaining {
            evaluated_checks += 1;
            let needs_renew = min_days < SSL_RENEW_THRESHOLD_DAYS;
            let _ = guard.append_otto_trace_step(
                &tid,
                step_idx,
                "STAGE0_GATE",
                &format!(
                    "SSL fleet expiry check: min {}d remaining (threshold <{}d)",
                    min_days, SSL_RENEW_THRESHOLD_DAYS
                ),
                "OK",
                0,
                None,
                Some(&json!({ "minDaysRemaining": min_days, "needsRenew": needs_renew }).to_string()),
            );
            step_idx += 1;

            if needs_renew && !has_open_proposal("renew_ssl_cert", "pki") {
                let pol = policies.iter().find(|p| p.action_id == "renew_ssl_cert");
                let mode = pol
                    .and_then(|p| AutonomyMode::parse(&p.mode))
                    .unwrap_or(AutonomyMode::Shadow);
                let cool = is_cooldown_active(
                    guard
                        .last_executed_action_at("renew_ssl_cert", "pki")
                        .ok()
                        .flatten()
                        .as_deref(),
                    pol.map(|p| p.cooldown_secs).unwrap_or(3600),
                    now,
                );
                let params_str = json!({ "minDaysRemaining": min_days }).to_string();
                if mode == AutonomyMode::L2Auto
                    && !state.kill_switch_active
                    && state.circuit_breaker_state != "TRIPPED"
                    && !cool
                    && (hourly_l2 + l2_queue.len() as i64) < 3
                {
                    l2_queue.push(("renew_ssl_cert".into(), "pki".into(), params_str, tid.clone()));
                } else if mode != AutonomyMode::Observe {
                    let status = if mode == AutonomyMode::Shadow { "SHADOW_LOGGED" } else { "PENDING_APPROVAL" };
                    let pid = format!("prop-{}", Uuid::new_v4());
                    let _ = guard.insert_otto_proposal(&OttoProposalRow {
                        id: pid.clone(),
                        trace_run_id: Some(tid.clone()),
                        domain: "HEAL".to_string(),
                        classification: "RELIABILITY".to_string(),
                        asset_slug: "pki".to_string(),
                        asset_tier: AssetTier::Tier2ExternalEdge.as_str().to_string(),
                        action_id: "renew_ssl_cert".to_string(),
                        params_json: params_str,
                        title: format!("Renew Expiring SSL Certificates ({}d remaining)", min_days),
                        severity: if min_days < 7 { "CRITICAL" } else { "HIGH" }.to_string(),
                        confidence: 0.95,
                        rca_summary: format!(
                            "Minimum fleet TLS certificate lifetime dropped to {}d (<21d threshold). Runs Get-SSLCerts.ps1 -Unattended under WshRemoteMutation lock.",
                            min_days
                        ),
                        evidence_json: json!([format!("ssl_min_days={}", min_days)]).to_string(),
                        diff_preview: None,
                        rollback_plan_json: None,
                        blast_radius_flags_json: json!(["EDGE_PKI"]).to_string(),
                        status: status.to_string(),
                        snoozed_until: None,
                        created_at: now.to_rfc3339(),
                        decided_at: None,
                        executed_at: None,
                        verification_result_json: None,
                    });
                    proposals_created.push(pid);
                }
            }
        }

        // 3. Steady-State Unhealthy Containers (respecting Cascade Guard >= 2 apps!)
        evaluated_checks += 1;
        if input.unhealthy_apps.len() >= 2 {
            let names: Vec<String> = input.unhealthy_apps.iter().map(|a| a.app_slug.clone()).collect();
            let _ = guard.append_otto_trace_step(
                &tid,
                step_idx,
                "STAGE0_GATE",
                &format!("Cross-app cascade guard triggered ({} unhealthy apps)", names.len()),
                "WARN",
                0,
                None,
                Some(&json!({ "unhealthyApps": names }).to_string()),
            );
            if !has_open_proposal("restart_tier0_hard_down", "wsh") {
                let pid = format!("prop-{}", Uuid::new_v4());
                let _ = guard.insert_otto_proposal(&OttoProposalRow {
                    id: pid.clone(),
                    trace_run_id: Some(tid.clone()),
                    domain: "HEAL".to_string(),
                    classification: "RELIABILITY".to_string(),
                    asset_slug: "wsh".to_string(),
                    asset_tier: AssetTier::Tier0Critical.as_str().to_string(),
                    action_id: "restart_tier0_hard_down".to_string(),
                    params_json: json!({ "unhealthyApps": names }).to_string(),
                    title: format!("Multi-App Cascade Detected ({} Unhealthy Apps)", names.len()),
                    severity: "CRITICAL".to_string(),
                    confidence: 0.94,
                    rca_summary: format!(
                        "Suppressed per-app L2 restarts because {} apps are simultaneously unhealthy ({}). Inspect shared WSH ingress/Lighttpd/Tunnel.",
                        names.len(),
                        names.join(", ")
                    ),
                    evidence_json: serde_json::to_string(&names).unwrap_or_else(|_| "[]".into()),
                    diff_preview: None,
                    rollback_plan_json: None,
                    blast_radius_flags_json: json!(["CASCADE_GUARD", "TIER0_CRITICAL"]).to_string(),
                    status: "PENDING_APPROVAL".to_string(),
                    snoozed_until: None,
                    created_at: now.to_rfc3339(),
                    decided_at: None,
                    executed_at: None,
                    verification_result_json: None,
                });
                proposals_created.push(pid);
            }
        } else if let Some(unhealthy) = input.unhealthy_apps.first() {
            let tier = AssetTier::from_slug(&unhealthy.app_slug, unhealthy.hosting_target.as_deref());
            let action_id = if tier == AssetTier::Tier0Critical {
                "restart_tier0_hard_down"
            } else {
                "restart_container"
            };
            if let Some(container) = resolve_allowlisted_wsh_container(&unhealthy.app_slug) {
                if !has_open_proposal(action_id, &unhealthy.app_slug) {
                    let pol = policies.iter().find(|p| p.action_id == action_id);
                    let mode = pol
                        .and_then(|p| AutonomyMode::parse(&p.mode))
                        .unwrap_or(AutonomyMode::Shadow);
                    let status = if mode == AutonomyMode::Shadow { "SHADOW_LOGGED" } else { "PENDING_APPROVAL" };
                    let pid = format!("prop-{}", Uuid::new_v4());
                    let _ = guard.insert_otto_proposal(&OttoProposalRow {
                        id: pid.clone(),
                        trace_run_id: Some(tid.clone()),
                        domain: "HEAL".to_string(),
                        classification: "RELIABILITY".to_string(),
                        asset_slug: unhealthy.app_slug.clone(),
                        asset_tier: tier.as_str().to_string(),
                        action_id: action_id.to_string(),
                        params_json: json!({ "containerName": container }).to_string(),
                        title: format!("Steady-State Recovery: Restart '{}'", container),
                        severity: if tier == AssetTier::Tier0Critical { "CRITICAL" } else { "HIGH" }.to_string(),
                        confidence: 0.87,
                        rca_summary: format!(
                            "App '{}' reported unhealthy ({}). Parameterized restart via sre-agent-wsh forced-command key.",
                            unhealthy.app_slug,
                            unhealthy.detail.as_deref().unwrap_or("probe failed")
                        ),
                        evidence_json: json!([unhealthy.detail.as_deref().unwrap_or("unhealthy")]).to_string(),
                        diff_preview: None,
                        rollback_plan_json: None,
                        blast_radius_flags_json: json!(if tier == AssetTier::Tier0Critical { vec!["TIER0_CRITICAL"] } else { vec!["REVERSIBLE_RESTART"] }).to_string(),
                        status: status.to_string(),
                        snoozed_until: None,
                        created_at: now.to_rfc3339(),
                        decided_at: None,
                        executed_at: None,
                        verification_result_json: None,
                    });
                    proposals_created.push(pid);
                }
            }
        }

        let summary = format!(
            "Steady-state sweep completed ({} checks, {} proposals staged, {} L2 actions queued)",
            evaluated_checks,
            proposals_created.len(),
            l2_queue.len()
        );
        let _ = guard.complete_otto_trace_run(
            &tid,
            "COMPLETED",
            None,
            None,
            0,
            0,
            0,
            started.elapsed().as_millis() as i64,
            &summary,
            None,
        );
        let _ = sync_runtime_snapshot(Some(&app), &guard, &runtime);
        tid
    };

    for (action_id, slug, params_json, tid) in l2_queue {
        let db_arc = Arc::clone(db.inner());
        let rt_arc = Arc::clone(runtime.inner());
        let jm_arc = Arc::clone(job_manager.inner());
        if let Ok(out) = execute_compiled_otto_action(
            &app,
            &db_arc,
            &rt_arc,
            &jm_arc,
            &action_id,
            &slug,
            &params_json,
            Some("RELIABILITY"),
            None,
            Some(&tid),
            false,
            None,
        )
        .await
        {
            actions_executed.push(format!("{}: {}", action_id, out.final_status));
        }
    }

    Ok(OttoSteadyStateResult {
        trace_run_id,
        evaluated_checks,
        proposals_created: proposals_created.clone(),
        actions_executed: actions_executed.clone(),
        summary: format!(
            "Checked {} signals · {} proposal(s) staged · {} L2 action(s) executed",
            evaluated_checks,
            proposals_created.len(),
            actions_executed.len()
        ),
    })
}

#[tauri::command]
pub fn queue_otto_manual_proposal(
    app: AppHandle,
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    runtime: State<'_, Arc<OttoRuntimeController>>,
    input: QueueOttoManualProposalInput,
) -> Result<OttoProposalRow, String> {
    let params_str = input.params_json.unwrap_or_else(|| "{}".to_string());
    let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
    let state = guard
        .get_otto_state()
        .map_err(|e| format!("Failed reading Otto state: {}", e))?;
    let tier = AssetTier::from_slug(&input.asset_slug, None);
    let has_db_mig = input.has_db_migration.unwrap_or(false);

    let decision = evaluate_policy_decision(&PolicyEvalRequest {
        action_id: input.action_id.clone(),
        asset_slug: input.asset_slug.clone(),
        asset_tier: tier,
        configured_mode: AutonomyMode::L3Approval,
        kill_switch_active: state.kill_switch_active,
        circuit_breaker_tripped: false,
        has_db_migration: has_db_mig,
        classification: Some("RELIABILITY".to_string()),
        raw_payload_text: format!("{} {} {}", input.title, input.rca_summary, params_str),
        target_ips: vec![],
        target_paths: vec![],
        protected_ips: vec![],
        proposed_semver_bump: None,
    });

    if matches!(
        decision.verdict,
        PolicyVerdict::DenyL4HardBlocked | PolicyVerdict::DenyKillSwitch
    ) {
        return Err(decision.reason);
    }

    let trace_id = guard
        .create_otto_trace_run("MANUAL", "HEAL", Some(&input.asset_slug), None, None)
        .map_err(|e| format!("Failed creating trace: {}", e))?;
    let _ = guard.append_otto_trace_step(
        &trace_id,
        0,
        "POLICY_KERNEL",
        &format!("Staged L3 proposal '{}' -> {:?}", input.action_id, decision.verdict),
        "OK",
        0,
        None,
        Some(&serde_json::to_string(&decision).unwrap_or_else(|_| "{}".into())),
    );
    let _ = guard.complete_otto_trace_run(
        &trace_id,
        "COMPLETED",
        None,
        None,
        0,
        0,
        0,
        1,
        &format!("Staged L3 approval card for {}", input.action_id),
        None,
    );

    let mut flags = Vec::new();
    if tier == AssetTier::Tier0Critical {
        flags.push("TIER0_CRITICAL".to_string());
    }
    if has_db_mig {
        flags.push("DB_MIGRATION".to_string());
    }
    if input.action_id == "prune_buildkit_cache" {
        flags.push("LOCAL_WORKSTATION_ONLY".to_string());
    }

    let proposal = OttoProposalRow {
        id: format!("prop-{}", Uuid::new_v4()),
        trace_run_id: Some(trace_id),
        domain: input.domain.unwrap_or_else(|| "HEAL".to_string()).to_ascii_uppercase(),
        classification: "RELIABILITY".to_string(),
        asset_slug: input.asset_slug,
        asset_tier: tier.as_str().to_string(),
        action_id: input.action_id,
        params_json: params_str,
        title: input.title,
        severity: input.severity.unwrap_or_else(|| "MEDIUM".to_string()).to_ascii_uppercase(),
        confidence: 0.95,
        rca_summary: input.rca_summary,
        evidence_json: "[]".to_string(),
        diff_preview: None,
        rollback_plan_json: Some(json!({ "checksPassed": decision.checks_passed }).to_string()),
        blast_radius_flags_json: serde_json::to_string(&flags).unwrap_or_else(|_| "[]".into()),
        status: "PENDING_APPROVAL".to_string(),
        snoozed_until: None,
        created_at: Utc::now().to_rfc3339(),
        decided_at: None,
        executed_at: None,
        verification_result_json: None,
    };

    guard
        .insert_otto_proposal(&proposal)
        .map_err(|e| format!("Failed inserting manual proposal: {}", e))?;
    let _ = sync_runtime_snapshot(Some(&app), &guard, &runtime);
    Ok(proposal)
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::otto_policy::compiled_action_catalog;

    #[test]
    fn extracts_native_deep_thinking_parts_separately_from_answer() {
        let envelope = json!({
            "candidates": [{
                "content": {
                    "parts": [
                        { "thought": true, "text": "Step 1: Check SessionAuthIndex for roaming IP." },
                        { "thought": true, "text": "Step 2: Confirmed false positive due to mobile carrier hop." },
                        { "text": "This alert is a **CONFIRMED_BENIGN_FALSE_POSITIVE** caused by mobile IP roaming." }
                    ]
                }
            }],
            "usageMetadata": {
                "promptTokenCount": 820,
                "candidatesTokenCount": 95,
                "thoughtsTokenCount": 312
            }
        });

        let (ans, thought, i, o, t) =
            extract_gemini_parts_with_thoughts(&envelope).expect("should parse thoughts & answer");
        assert!(ans.contains("CONFIRMED_BENIGN_FALSE_POSITIVE"));
        assert!(!ans.contains("Step 1:"));
        let thought_md = thought.expect("thinking summary must be captured");
        assert!(thought_md.contains("Step 1: Check SessionAuthIndex"));
        assert!(thought_md.contains("Step 2: Confirmed false positive"));
        assert_eq!((i, o, t), (820, 95, 312));
    }

    #[test]
    fn extracts_answer_when_no_thoughts_present() {
        let envelope = json!({
            "candidates": [{
                "content": {
                    "parts": [{ "text": "All 6 containers are healthy." }]
                }
            }],
            "usageMetadata": {
                "promptTokenCount": 200,
                "candidatesTokenCount": 12
            }
        });
        let (ans, thought, i, o, t) = extract_gemini_parts_with_thoughts(&envelope).unwrap();
        assert_eq!(ans, "All 6 containers are healthy.");
        assert!(thought.is_none());
        assert_eq!((i, o, t), (200, 12, 0));
    }

    #[test]
    fn resolves_auto_routing_to_hydrogen_or_neon_and_clamps_carbon_xhigh() {
        let (m1, l1, t1) = resolve_otto_model_and_thinking(
            Some("auto"),
            Some("auto"),
            "gemini-4-hydrogen",
            "gemini-4-neon",
            "What is my current fleet status?",
            false,
        );
        assert_eq!(m1, "gemini-4-hydrogen");
        assert_eq!(l1, "medium");
        assert!(!t1);

        let (m2, l2, t2) = resolve_otto_model_and_thinking(
            Some("auto"),
            Some("auto"),
            "gemini-4-hydrogen",
            "gemini-4-neon",
            "Is this inside-perimeter finding a false positive or detection defect?",
            true,
        );
        assert_eq!(m2, "gemini-4-neon");
        assert_eq!(l2, "high");
        assert!(t2);

        let (m3, l3, t3) = resolve_otto_model_and_thinking(
            Some("gemini-4-carbon"),
            Some("xhigh"),
            "gemini-4-hydrogen",
            "gemini-4-neon",
            "Deep audit",
            false,
        );
        assert_eq!(m3, "gemini-4-carbon");
        assert_eq!(l3, "high");
        assert!(t3);
    }

    #[test]
    fn parses_fenced_otto_proposal_and_strips_from_prose() {
        let raw = r#"I audited the UniFi CEF parser output and found a regex mismatch.

```otto-proposal
{
  "actionId": "create_bug_handoff",
  "assetSlug": "auth",
  "domain": "BUG_DIAGNOSTIC",
  "classification": "DETECTION_DEFECT_SUSPECTED",
  "title": "Fix CEF src IP fallback in threat_intel_ops",
  "severity": "MEDIUM",
  "confidence": 0.91,
  "rcaSummary": "Unparsed src=None produced false positive alert.",
  "params": {},
  "evidence": ["finding-123"]
}
```"#;
        let (clean, drafts) = parse_otto_proposed_actions(raw);
        assert_eq!(clean, "I audited the UniFi CEF parser output and found a regex mismatch.");
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].action_id, "create_bug_handoff");
        assert_eq!(drafts[0].classification, "DETECTION_DEFECT_SUSPECTED");
        assert!(compiled_action_catalog().iter().any(|c| c.action_id == drafts[0].action_id));
    }

    #[test]
    fn debug_bundle_markdown_includes_thinking_and_scrubs_secrets() {
        let detail = OttoTraceDetailDto {
            run: OttoTraceRunRow {
                id: "trace-abc".to_string(),
                trigger_kind: "CHAT".to_string(),
                domain: "SECURITY".to_string(),
                asset_slug: Some("auth".to_string()),
                final_state: "COMPLETED".to_string(),
                model_used: Some("gemini-4-neon".to_string()),
                thinking_level: Some("high".to_string()),
                input_tokens: 500,
                output_tokens: 100,
                thought_tokens: 250,
                duration_ms: 1420,
                outcome_summary: "Audited key GEMINI_API_KEY=AIzaSySecretTokenValue123456789012345".to_string(),
                error_text: None,
                started_at: "2026-11-26T12:00:00Z".to_string(),
                completed_at: Some("2026-11-26T12:00:01Z".to_string()),
            },
            steps: vec![crate::otto_db::OttoTraceStepRow {
                id: "step-1".to_string(),
                trace_run_id: "trace-abc".to_string(),
                step_index: 0,
                step_type: "LLM_THINKING".to_string(),
                title: "Deep Thinking".to_string(),
                status: "OK".to_string(),
                duration_ms: 900,
                thinking_summary_md: Some("Confirmed zero exposure to WordPress probes.".to_string()),
                structured_payload_json: Some("{\"verdict\":\"NOISE_SAFE_DROP\"}".to_string()),
                created_at: "2026-11-26T12:00:01Z".to_string(),
            }],
        };

        let md = build_trace_debug_bundle_markdown(&detail);
        assert!(md.contains("Deep-Thinking Rundown"));
        assert!(md.contains("Confirmed zero exposure to WordPress probes."));
        assert!(!md.contains("AIzaSySecretTokenValue"));
    }
}
