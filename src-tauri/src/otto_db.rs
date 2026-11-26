use crate::db::SreDatabase;
use crate::otto_policy::{compiled_action_catalog, AutonomyMode};
use crate::scrubber::scrub_secrets;
use chrono::Utc;
use rusqlite::{params, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoPolicyRow {
    pub action_id: String,
    pub domain: String,
    pub label: String,
    pub description: String,
    pub asset_tier: String,
    pub mode: String,
    pub max_allowed_mode: String,
    pub cooldown_secs: i64,
    pub shadow_runs_count: i64,
    pub shadow_agreed_count: i64,
    pub promoted_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoAgentStateRow {
    pub kill_switch_active: bool,
    pub circuit_breaker_state: String,
    pub tripped_reason: Option<String>,
    pub tripped_at: Option<String>,
    pub consecutive_failures: i64,
    pub daily_t1_calls: i64,
    pub daily_t2_calls: i64,
    pub budget_date_utc: String,
    pub dropped_noise_24h_count: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoTraceRunRow {
    pub id: String,
    pub trigger_kind: String,
    pub domain: String,
    pub asset_slug: Option<String>,
    pub final_state: String,
    pub model_used: Option<String>,
    pub thinking_level: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub thought_tokens: i64,
    pub duration_ms: i64,
    pub outcome_summary: String,
    pub error_text: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoTraceStepRow {
    pub id: String,
    pub trace_run_id: String,
    pub step_index: i64,
    pub step_type: String,
    pub title: String,
    pub status: String,
    pub duration_ms: i64,
    pub thinking_summary_md: Option<String>,
    pub structured_payload_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoTraceDetailDto {
    pub run: OttoTraceRunRow,
    pub steps: Vec<OttoTraceStepRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoProposalRow {
    pub id: String,
    pub trace_run_id: Option<String>,
    pub domain: String,
    pub classification: String,
    pub asset_slug: String,
    pub asset_tier: String,
    pub action_id: String,
    pub params_json: String,
    pub title: String,
    pub severity: String,
    pub confidence: f64,
    pub rca_summary: String,
    pub evidence_json: String,
    pub diff_preview: Option<String>,
    pub rollback_plan_json: Option<String>,
    pub blast_radius_flags_json: String,
    pub status: String,
    pub snoozed_until: Option<String>,
    pub created_at: String,
    pub decided_at: Option<String>,
    pub executed_at: Option<String>,
    pub verification_result_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoChatThreadRow {
    pub id: String,
    pub title: String,
    pub context_seed_json: Option<String>,
    pub origin_view: Option<String>,
    pub origin_entity_id: Option<String>,
    pub message_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoChatMessageRow {
    pub id: String,
    pub thread_id: String,
    pub role: String,
    pub content_md: String,
    pub model_used: Option<String>,
    pub thinking_level: Option<String>,
    pub thinking_summary_md: Option<String>,
    pub tools_used_json: Option<String>,
    pub inline_proposal_id: Option<String>,
    pub trace_run_id: Option<String>,
    pub token_usage_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoSavedPromptRow {
    pub id: String,
    pub title: String,
    pub prompt_text: String,
    pub category: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoSoakSessionRow {
    pub id: String,
    pub app_slug: String,
    pub hosting_target: String,
    pub release_id: String,
    pub previous_image_tag: Option<String>,
    pub has_db_migration: bool,
    pub started_at: String,
    pub ends_at: String,
    pub status: String,
    pub samples_json: String,
    pub trace_run_id: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoHandoffPacketRow {
    pub id: String,
    pub proposal_id: Option<String>,
    pub trace_run_id: Option<String>,
    pub app_slug: String,
    pub category: String,
    pub summary: String,
    pub logs_scrubbed: String,
    pub diff_patch: Option<String>,
    pub status: String,
    pub created_at: String,
}

impl SreDatabase {
    pub(crate) fn init_otto_tables(&self) -> Result<()> {
        let conn = self.conn();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS agent_policies (
                action_id TEXT PRIMARY KEY,
                asset_tier TEXT NOT NULL,
                mode TEXT NOT NULL,
                max_allowed_mode TEXT NOT NULL,
                cooldown_secs INTEGER NOT NULL DEFAULT 900,
                shadow_runs_count INTEGER NOT NULL DEFAULT 0,
                shadow_agreed_count INTEGER NOT NULL DEFAULT 0,
                promoted_at TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS agent_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                kill_switch_active INTEGER NOT NULL DEFAULT 0,
                circuit_breaker_state TEXT NOT NULL DEFAULT 'CLOSED',
                tripped_reason TEXT,
                tripped_at TEXT,
                consecutive_failures INTEGER NOT NULL DEFAULT 0,
                daily_t1_calls INTEGER NOT NULL DEFAULT 0,
                daily_t2_calls INTEGER NOT NULL DEFAULT 0,
                budget_date_utc TEXT NOT NULL,
                dropped_noise_24h_count INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS agent_trace_runs (
                id TEXT PRIMARY KEY,
                trigger_kind TEXT NOT NULL,
                domain TEXT NOT NULL,
                asset_slug TEXT,
                final_state TEXT NOT NULL,
                model_used TEXT,
                thinking_level TEXT,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                thought_tokens INTEGER NOT NULL DEFAULT 0,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                outcome_summary TEXT NOT NULL DEFAULT '',
                error_text TEXT,
                started_at TEXT NOT NULL,
                completed_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_agent_trace_runs_started
                ON agent_trace_runs (started_at DESC);

            CREATE TABLE IF NOT EXISTS agent_trace_steps (
                id TEXT PRIMARY KEY,
                trace_run_id TEXT NOT NULL,
                step_index INTEGER NOT NULL,
                step_type TEXT NOT NULL,
                title TEXT NOT NULL,
                status TEXT NOT NULL,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                thinking_summary_md TEXT,
                structured_payload_json TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_agent_trace_steps_run_idx
                ON agent_trace_steps (trace_run_id, step_index ASC);

            CREATE TABLE IF NOT EXISTS agent_proposals (
                id TEXT PRIMARY KEY,
                trace_run_id TEXT,
                domain TEXT NOT NULL,
                classification TEXT NOT NULL DEFAULT 'RELIABILITY',
                asset_slug TEXT NOT NULL,
                asset_tier TEXT NOT NULL,
                action_id TEXT NOT NULL,
                params_json TEXT NOT NULL DEFAULT '{}',
                title TEXT NOT NULL,
                severity TEXT NOT NULL DEFAULT 'INFO',
                confidence REAL NOT NULL DEFAULT 0.0,
                rca_summary TEXT NOT NULL DEFAULT '',
                evidence_json TEXT NOT NULL DEFAULT '[]',
                diff_preview TEXT,
                rollback_plan_json TEXT,
                blast_radius_flags_json TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
                snoozed_until TEXT,
                created_at TEXT NOT NULL,
                decided_at TEXT,
                executed_at TEXT,
                verification_result_json TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_agent_proposals_status_created
                ON agent_proposals (status, created_at DESC);

            CREATE TABLE IF NOT EXISTS agent_chat_threads (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                context_seed_json TEXT,
                origin_view TEXT,
                origin_entity_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_agent_chat_threads_updated
                ON agent_chat_threads (updated_at DESC);

            CREATE TABLE IF NOT EXISTS agent_chat_messages (
                id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content_md TEXT NOT NULL,
                model_used TEXT,
                thinking_level TEXT,
                thinking_summary_md TEXT,
                tools_used_json TEXT,
                inline_proposal_id TEXT,
                trace_run_id TEXT,
                token_usage_json TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_agent_chat_messages_thread_created
                ON agent_chat_messages (thread_id, created_at ASC);

            CREATE TABLE IF NOT EXISTS agent_saved_prompts (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                prompt_text TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'GENERAL',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS agent_log_cursors (
                source_key TEXT PRIMARY KEY,
                cursor_value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS agent_audit_ledger (
                id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                action_id TEXT,
                asset_slug TEXT,
                decision TEXT NOT NULL,
                reason TEXT NOT NULL,
                trace_run_id TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_agent_audit_ledger_created
                ON agent_audit_ledger (created_at DESC);

            CREATE TABLE IF NOT EXISTS agent_soak_sessions (
                id TEXT PRIMARY KEY,
                app_slug TEXT NOT NULL,
                hosting_target TEXT NOT NULL,
                release_id TEXT NOT NULL,
                previous_image_tag TEXT,
                has_db_migration INTEGER NOT NULL DEFAULT 0,
                started_at TEXT NOT NULL,
                ends_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'SOAKING',
                samples_json TEXT NOT NULL DEFAULT '[]',
                trace_run_id TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_agent_soak_sessions_status_ends
                ON agent_soak_sessions (status, ends_at DESC);

            CREATE INDEX IF NOT EXISTS idx_agent_soak_sessions_slug_started
                ON agent_soak_sessions (app_slug, started_at DESC);

            CREATE TABLE IF NOT EXISTS agent_handoff_packets (
                id TEXT PRIMARY KEY,
                proposal_id TEXT,
                trace_run_id TEXT,
                app_slug TEXT NOT NULL,
                category TEXT NOT NULL,
                summary TEXT NOT NULL,
                logs_scrubbed TEXT NOT NULL DEFAULT '',
                diff_patch TEXT,
                status TEXT NOT NULL DEFAULT 'OPEN',
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_agent_handoff_packets_created
                ON agent_handoff_packets (created_at DESC);",
        )?;

        let now = Utc::now().to_rfc3339();
        let today = Utc::now().format("%Y-%m-%d").to_string();

        // Seed singleton agent_state idempotently
        conn.execute(
            "INSERT OR IGNORE INTO agent_state (id, kill_switch_active, circuit_breaker_state, consecutive_failures, daily_t1_calls, daily_t2_calls, budget_date_utc, dropped_noise_24h_count, updated_at)
             VALUES (1, 0, 'CLOSED', 0, 0, 0, ?1, 0, ?2)",
            params![today, now],
        )?;

        // Seed compiled action policies idempotently (always safe SHADOW/L3 defaults)
        for spec in compiled_action_catalog() {
            conn.execute(
                "INSERT OR IGNORE INTO agent_policies (action_id, asset_tier, mode, max_allowed_mode, cooldown_secs, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    spec.action_id,
                    spec.asset_tier.as_str(),
                    spec.default_mode.as_str(),
                    spec.max_allowed_mode.as_str(),
                    spec.cooldown_secs,
                    now
                ],
            )?;
        }

        // Seed default saved SRE prompts ONLY when table is completely empty
        let prompt_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM agent_saved_prompts", [], |r| r.get(0))
            .unwrap_or(0);
        if prompt_count == 0 {
            let defaults = [
                (
                    "seed-defect-check",
                    "Audit Recent False Positives & Detection Bugs",
                    "Review our most recent Threat SOC findings and quarantined emails. Determine whether any inside-perimeter alerts look like detection or roaming-correlation code defects vs genuine anomalies.",
                    "SECURITY",
                ),
                (
                    "seed-noise-vs-threat",
                    "Outside Threats vs. Background Noise",
                    "Evaluate the active external threat actors against our actual tech stack (Next.js 16 / SQLite behind Cloudflare Access on WSH, and static Cloudflare Pages + D1 on ParakithSite). Which ones are material threats and which are safe to ignore?",
                    "SECURITY",
                ),
                (
                    "seed-fleet-health",
                    "Suite Health & Deploy Telemetry Summary",
                    "Summarize recent deploy telemetry, system logs, and any operational risks across the PanoramaDrSuite fleet.",
                    "RELIABILITY",
                ),
                (
                    "seed-policy-audit",
                    "Explain Otto's Active Safety Guardrails",
                    "List my current Otto policy modes, any L4 hard-blocked invariants, and our Suricata SSH SYN budget status.",
                    "GOVERNANCE",
                ),
            ];
            for (id, title, text, cat) in defaults {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO agent_saved_prompts (id, title, prompt_text, category, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![id, title, text, cat, now],
                );
            }
        }

        // Auto-prune old Otto trace runs > 30 days
        self.purge_old_otto_traces(30).ok();

        Ok(())
    }

    pub fn purge_old_otto_traces(&self, days: i64) -> Result<()> {
        let cutoff = (Utc::now() - chrono::Duration::days(days.max(1))).to_rfc3339();
        let conn = self.conn();
        conn.execute(
            "DELETE FROM agent_trace_steps WHERE trace_run_id IN (SELECT id FROM agent_trace_runs WHERE started_at < ?1)",
            params![cutoff],
        )?;
        conn.execute(
            "DELETE FROM agent_trace_runs WHERE started_at < ?1",
            params![cutoff],
        )?;
        Ok(())
    }

    pub fn get_otto_state(&self) -> Result<OttoAgentStateRow> {
        let conn = self.conn();
        let today = Utc::now().format("%Y-%m-%d").to_string();
        let now = Utc::now().to_rfc3339();

        let mut row: OttoAgentStateRow = conn.query_row(
            "SELECT kill_switch_active, circuit_breaker_state, tripped_reason, tripped_at,
                    consecutive_failures, daily_t1_calls, daily_t2_calls, budget_date_utc,
                    dropped_noise_24h_count, updated_at
             FROM agent_state WHERE id = 1",
            [],
            |r| {
                Ok(OttoAgentStateRow {
                    kill_switch_active: r.get::<_, i64>(0)? != 0,
                    circuit_breaker_state: r.get(1)?,
                    tripped_reason: r.get(2)?,
                    tripped_at: r.get(3)?,
                    consecutive_failures: r.get(4)?,
                    daily_t1_calls: r.get(5)?,
                    daily_t2_calls: r.get(6)?,
                    budget_date_utc: r.get(7)?,
                    dropped_noise_24h_count: r.get(8)?,
                    updated_at: r.get(9)?,
                })
            },
        )?;

        // Roll over daily call budgets automatically on UTC midnight
        if row.budget_date_utc != today {
            conn.execute(
                "UPDATE agent_state SET daily_t1_calls = 0, daily_t2_calls = 0, budget_date_utc = ?1, updated_at = ?2 WHERE id = 1",
                params![today, now],
            )?;
            row.daily_t1_calls = 0;
            row.daily_t2_calls = 0;
            row.budget_date_utc = today;
            row.updated_at = now;
        }
        Ok(row)
    }

    pub fn set_otto_kill_switch(&self, active: bool, reason: &str) -> Result<OttoAgentStateRow> {
        let now = Utc::now().to_rfc3339();
        self.conn().execute(
            "UPDATE agent_state SET kill_switch_active = ?1, updated_at = ?2 WHERE id = 1",
            params![if active { 1 } else { 0 }, now],
        )?;
        let _ = self.append_otto_audit(
            "KILL_SWITCH",
            None,
            None,
            if active { "ENGAGED" } else { "RELEASED" },
            reason,
            None,
        );
        self.get_otto_state()
    }

    pub fn record_otto_circuit_failure(&self, reason: &str) -> Result<OttoAgentStateRow> {
        let current = self.get_otto_state()?;
        let next_failures = current.consecutive_failures + 1;
        let now = Utc::now().to_rfc3339();
        let should_trip = next_failures >= 2;
        if should_trip {
            self.conn().execute(
                "UPDATE agent_state
                 SET consecutive_failures = ?1, circuit_breaker_state = 'TRIPPED',
                     tripped_reason = ?2, tripped_at = ?3, updated_at = ?3
                 WHERE id = 1",
                params![next_failures, scrub_secrets(reason), now],
            )?;
            let _ = self.append_otto_audit(
                "CIRCUIT_BREAKER",
                None,
                None,
                "TRIPPED",
                reason,
                None,
            );
        } else {
            self.conn().execute(
                "UPDATE agent_state SET consecutive_failures = ?1, updated_at = ?2 WHERE id = 1",
                params![next_failures, now],
            )?;
        }
        self.get_otto_state()
    }

    pub fn reset_otto_circuit_breaker(&self) -> Result<OttoAgentStateRow> {
        let now = Utc::now().to_rfc3339();
        self.conn().execute(
            "UPDATE agent_state
             SET consecutive_failures = 0, circuit_breaker_state = 'CLOSED',
                 tripped_reason = NULL, tripped_at = NULL, updated_at = ?1
             WHERE id = 1",
            params![now],
        )?;
        let _ = self.append_otto_audit(
            "CIRCUIT_BREAKER",
            None,
            None,
            "RESET",
            "Operator manually reset Otto circuit breaker",
            None,
        );
        self.get_otto_state()
    }

    pub fn record_otto_verified_success(&self) -> Result<OttoAgentStateRow> {
        let now = Utc::now().to_rfc3339();
        self.conn().execute(
            "UPDATE agent_state SET consecutive_failures = 0, updated_at = ?1 WHERE id = 1",
            params![now],
        )?;
        self.get_otto_state()
    }

    pub fn last_executed_action_at(
        &self,
        action_id: &str,
        asset_slug: &str,
    ) -> Result<Option<String>> {
        self.conn()
            .query_row(
                "SELECT created_at
                 FROM agent_audit_ledger
                 WHERE action_id = ?1
                   AND asset_slug = ?2
                   AND decision IN ('EXECUTED_L2', 'VERIFIED', 'EXECUTED_L3', 'ROLLED_BACK')
                 ORDER BY created_at DESC
                 LIMIT 1",
                params![action_id, asset_slug],
                |r| r.get(0),
            )
            .optional()
    }

    pub fn count_recent_l2_executions(&self, window_secs: i64) -> Result<i64> {
        let cutoff = (Utc::now() - chrono::Duration::seconds(window_secs.max(60))).to_rfc3339();
        self.conn().query_row(
            "SELECT COUNT(*)
             FROM agent_audit_ledger
             WHERE decision IN ('EXECUTED_L2', 'ROLLED_BACK')
               AND created_at >= ?1",
            params![cutoff],
            |r| r.get(0),
        )
    }

    pub fn increment_otto_ai_usage(&self, is_tier2: bool) -> Result<OttoAgentStateRow> {
        let _ = self.get_otto_state()?; // ensures midnight rollover
        let now = Utc::now().to_rfc3339();
        if is_tier2 {
            self.conn().execute(
                "UPDATE agent_state SET daily_t2_calls = daily_t2_calls + 1, updated_at = ?1 WHERE id = 1",
                params![now],
            )?;
        } else {
            self.conn().execute(
                "UPDATE agent_state SET daily_t1_calls = daily_t1_calls + 1, updated_at = ?1 WHERE id = 1",
                params![now],
            )?;
        }
        self.get_otto_state()
    }

    pub fn list_otto_policies(&self) -> Result<Vec<OttoPolicyRow>> {
        let catalog = compiled_action_catalog();
        let mut stmt = self.conn().prepare(
            "SELECT action_id, asset_tier, mode, max_allowed_mode, cooldown_secs,
                    shadow_runs_count, shadow_agreed_count, promoted_at, updated_at
             FROM agent_policies",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, Option<String>>(7)?,
                r.get::<_, String>(8)?,
            ))
        })?;

        let mut stored = std::collections::HashMap::new();
        for r in rows {
            let tuple = r?;
            stored.insert(tuple.0.clone(), tuple);
        }

        let mut out = Vec::with_capacity(catalog.len());
        for spec in catalog {
            if let Some(t) = stored.get(spec.action_id) {
                out.push(OttoPolicyRow {
                    action_id: spec.action_id.to_string(),
                    domain: spec.domain.to_string(),
                    label: spec.label.to_string(),
                    description: spec.description.to_string(),
                    asset_tier: t.1.clone(),
                    mode: t.2.clone(),
                    max_allowed_mode: spec.max_allowed_mode.as_str().to_string(),
                    cooldown_secs: t.4,
                    shadow_runs_count: t.5,
                    shadow_agreed_count: t.6,
                    promoted_at: t.7.clone(),
                    updated_at: t.8.clone(),
                });
            }
        }
        Ok(out)
    }

    pub fn update_otto_policy_mode(&self, action_id: &str, requested_mode: &str) -> std::result::Result<OttoPolicyRow, String> {
        let catalog = compiled_action_catalog();
        let spec = catalog
            .iter()
            .find(|s| s.action_id == action_id)
            .ok_or_else(|| format!("Unknown action_id '{}'", action_id))?;
        let parsed = AutonomyMode::parse(requested_mode)
            .ok_or_else(|| format!("Invalid autonomy mode '{}'", requested_mode))?;
        if parsed == AutonomyMode::L4HardBlocked {
            return Err("L4_HARD_BLOCKED is compile-time enforced and cannot be assigned manually".to_string());
        }
        if parsed.rank_permissive() > spec.max_allowed_mode.rank_permissive() {
            return Err(format!(
                "Policy mode '{}' exceeds compile-time ceiling '{}' for '{}'",
                parsed.as_str(),
                spec.max_allowed_mode.as_str(),
                spec.action_id
            ));
        }

        let now = Utc::now().to_rfc3339();
        let promoted_at = if parsed == AutonomyMode::L2Auto {
            Some(now.clone())
        } else {
            None
        };
        self.conn()
            .execute(
                "UPDATE agent_policies
                 SET mode = ?1, promoted_at = COALESCE(?2, promoted_at), updated_at = ?3
                 WHERE action_id = ?4",
                params![parsed.as_str(), promoted_at, now, action_id],
            )
            .map_err(|e| format!("Failed to update agent_policies: {}", e))?;

        let _ = self.append_otto_audit(
            "POLICY_CHANGE",
            Some(action_id),
            None,
            parsed.as_str(),
            &format!("Operator set policy '{}' to {}", action_id, parsed.as_str()),
            None,
        );

        self.list_otto_policies()
            .map_err(|e| format!("Failed to reload policies: {}", e))?
            .into_iter()
            .find(|p| p.action_id == action_id)
            .ok_or_else(|| "Policy row disappeared after update".to_string())
    }

    pub fn create_otto_trace_run(
        &self,
        trigger_kind: &str,
        domain: &str,
        asset_slug: Option<&str>,
        model_used: Option<&str>,
        thinking_level: Option<&str>,
    ) -> Result<String> {
        let id = format!("trace-{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();
        self.conn().execute(
            "INSERT INTO agent_trace_runs
             (id, trigger_kind, domain, asset_slug, final_state, model_used, thinking_level, started_at)
             VALUES (?1, ?2, ?3, ?4, 'RUNNING', ?5, ?6, ?7)",
            params![id, trigger_kind, domain, asset_slug, model_used, thinking_level, now],
        )?;
        Ok(id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn append_otto_trace_step(
        &self,
        trace_run_id: &str,
        step_index: i64,
        step_type: &str,
        title: &str,
        status: &str,
        duration_ms: i64,
        thinking_summary_md: Option<&str>,
        structured_payload_json: Option<&str>,
    ) -> Result<String> {
        let id = format!("step-{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();
        let safe_title = scrub_secrets(title);
        let safe_thinking = thinking_summary_md.map(scrub_secrets);
        let safe_payload = structured_payload_json.map(scrub_secrets);
        self.conn().execute(
            "INSERT INTO agent_trace_steps
             (id, trace_run_id, step_index, step_type, title, status, duration_ms, thinking_summary_md, structured_payload_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                trace_run_id,
                step_index,
                step_type,
                safe_title,
                status,
                duration_ms,
                safe_thinking,
                safe_payload,
                now
            ],
        )?;
        Ok(id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn complete_otto_trace_run(
        &self,
        trace_run_id: &str,
        final_state: &str,
        model_used: Option<&str>,
        thinking_level: Option<&str>,
        input_tokens: i64,
        output_tokens: i64,
        thought_tokens: i64,
        duration_ms: i64,
        outcome_summary: &str,
        error_text: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn().execute(
            "UPDATE agent_trace_runs
             SET final_state = ?1,
                 model_used = COALESCE(?2, model_used),
                 thinking_level = COALESCE(?3, thinking_level),
                 input_tokens = ?4,
                 output_tokens = ?5,
                 thought_tokens = ?6,
                 duration_ms = ?7,
                 outcome_summary = ?8,
                 error_text = ?9,
                 completed_at = ?10
             WHERE id = ?11",
            params![
                final_state,
                model_used,
                thinking_level,
                input_tokens,
                output_tokens,
                thought_tokens,
                duration_ms,
                scrub_secrets(outcome_summary),
                error_text.map(scrub_secrets),
                now,
                trace_run_id
            ],
        )?;
        Ok(())
    }

    pub fn list_otto_trace_runs(&self, limit: usize) -> Result<Vec<OttoTraceRunRow>> {
        let mut stmt = self.conn().prepare(
            "SELECT id, trigger_kind, domain, asset_slug, final_state, model_used, thinking_level,
                    input_tokens, output_tokens, thought_tokens, duration_ms, outcome_summary,
                    error_text, started_at, completed_at
             FROM agent_trace_runs
             ORDER BY started_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit.min(200) as i64], |r| {
            Ok(OttoTraceRunRow {
                id: r.get(0)?,
                trigger_kind: r.get(1)?,
                domain: r.get(2)?,
                asset_slug: r.get(3)?,
                final_state: r.get(4)?,
                model_used: r.get(5)?,
                thinking_level: r.get(6)?,
                input_tokens: r.get(7)?,
                output_tokens: r.get(8)?,
                thought_tokens: r.get(9)?,
                duration_ms: r.get(10)?,
                outcome_summary: r.get(11)?,
                error_text: r.get(12)?,
                started_at: r.get(13)?,
                completed_at: r.get(14)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn get_otto_trace_detail(&self, trace_run_id: &str) -> Result<Option<OttoTraceDetailDto>> {
        let run = self
            .conn()
            .query_row(
                "SELECT id, trigger_kind, domain, asset_slug, final_state, model_used, thinking_level,
                        input_tokens, output_tokens, thought_tokens, duration_ms, outcome_summary,
                        error_text, started_at, completed_at
                 FROM agent_trace_runs WHERE id = ?1",
                params![trace_run_id],
                |r| {
                    Ok(OttoTraceRunRow {
                        id: r.get(0)?,
                        trigger_kind: r.get(1)?,
                        domain: r.get(2)?,
                        asset_slug: r.get(3)?,
                        final_state: r.get(4)?,
                        model_used: r.get(5)?,
                        thinking_level: r.get(6)?,
                        input_tokens: r.get(7)?,
                        output_tokens: r.get(8)?,
                        thought_tokens: r.get(9)?,
                        duration_ms: r.get(10)?,
                        outcome_summary: r.get(11)?,
                        error_text: r.get(12)?,
                        started_at: r.get(13)?,
                        completed_at: r.get(14)?,
                    })
                },
            )
            .optional()?;

        let Some(run) = run else {
            return Ok(None);
        };

        let mut stmt = self.conn().prepare(
            "SELECT id, trace_run_id, step_index, step_type, title, status, duration_ms,
                    thinking_summary_md, structured_payload_json, created_at
             FROM agent_trace_steps
             WHERE trace_run_id = ?1
             ORDER BY step_index ASC",
        )?;
        let rows = stmt.query_map(params![trace_run_id], |r| {
            Ok(OttoTraceStepRow {
                id: r.get(0)?,
                trace_run_id: r.get(1)?,
                step_index: r.get(2)?,
                step_type: r.get(3)?,
                title: r.get(4)?,
                status: r.get(5)?,
                duration_ms: r.get(6)?,
                thinking_summary_md: r.get(7)?,
                structured_payload_json: r.get(8)?,
                created_at: r.get(9)?,
            })
        })?;
        let mut steps = Vec::new();
        for s in rows {
            steps.push(s?);
        }
        Ok(Some(OttoTraceDetailDto { run, steps }))
    }

    pub fn insert_otto_proposal(&self, p: &OttoProposalRow) -> Result<()> {
        self.conn().execute(
            "INSERT INTO agent_proposals
             (id, trace_run_id, domain, classification, asset_slug, asset_tier, action_id, params_json,
              title, severity, confidence, rca_summary, evidence_json, diff_preview, rollback_plan_json,
              blast_radius_flags_json, status, snoozed_until, created_at, decided_at, executed_at, verification_result_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
            params![
                p.id,
                p.trace_run_id,
                p.domain,
                p.classification,
                p.asset_slug,
                p.asset_tier,
                p.action_id,
                scrub_secrets(&p.params_json),
                scrub_secrets(&p.title),
                p.severity,
                p.confidence,
                scrub_secrets(&p.rca_summary),
                scrub_secrets(&p.evidence_json),
                p.diff_preview.as_deref().map(scrub_secrets),
                p.rollback_plan_json.as_deref().map(scrub_secrets),
                p.blast_radius_flags_json,
                p.status,
                p.snoozed_until,
                p.created_at,
                p.decided_at,
                p.executed_at,
                p.verification_result_json.as_deref().map(scrub_secrets)
            ],
        )?;
        Ok(())
    }

    pub fn list_otto_proposals(&self, limit: usize) -> Result<Vec<OttoProposalRow>> {
        let mut stmt = self.conn().prepare(
            "SELECT id, trace_run_id, domain, classification, asset_slug, asset_tier, action_id, params_json,
                    title, severity, confidence, rca_summary, evidence_json, diff_preview, rollback_plan_json,
                    blast_radius_flags_json, status, snoozed_until, created_at, decided_at, executed_at, verification_result_json
             FROM agent_proposals
             ORDER BY created_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit.min(200) as i64], |r| {
            Ok(OttoProposalRow {
                id: r.get(0)?,
                trace_run_id: r.get(1)?,
                domain: r.get(2)?,
                classification: r.get(3)?,
                asset_slug: r.get(4)?,
                asset_tier: r.get(5)?,
                action_id: r.get(6)?,
                params_json: r.get(7)?,
                title: r.get(8)?,
                severity: r.get(9)?,
                confidence: r.get(10)?,
                rca_summary: r.get(11)?,
                evidence_json: r.get(12)?,
                diff_preview: r.get(13)?,
                rollback_plan_json: r.get(14)?,
                blast_radius_flags_json: r.get(15)?,
                status: r.get(16)?,
                snoozed_until: r.get(17)?,
                created_at: r.get(18)?,
                decided_at: r.get(19)?,
                executed_at: r.get(20)?,
                verification_result_json: r.get(21)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn count_pending_otto_approvals(&self) -> Result<i64> {
        self.conn().query_row(
            "SELECT COUNT(*) FROM agent_proposals WHERE status = 'PENDING_APPROVAL'",
            [],
            |r| r.get(0),
        )
    }

    pub fn update_otto_proposal_status(
        &self,
        proposal_id: &str,
        new_status: &str,
        snoozed_until: Option<&str>,
        verification_json: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn().execute(
            "UPDATE agent_proposals
             SET status = ?1,
                 snoozed_until = ?2,
                 decided_at = COALESCE(decided_at, ?3),
                 verification_result_json = COALESCE(?4, verification_result_json)
             WHERE id = ?5",
            params![
                new_status,
                snoozed_until,
                now,
                verification_json.map(scrub_secrets),
                proposal_id
            ],
        )?;
        Ok(())
    }

    pub fn update_otto_proposal_execution(
        &self,
        proposal_id: &str,
        new_status: &str,
        verification_json: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn().execute(
            "UPDATE agent_proposals
             SET status = ?1,
                 decided_at = COALESCE(decided_at, ?2),
                 executed_at = COALESCE(executed_at, ?2),
                 verification_result_json = COALESCE(?3, verification_result_json)
             WHERE id = ?4",
            params![
                new_status,
                now,
                verification_json.map(scrub_secrets),
                proposal_id
            ],
        )?;
        Ok(())
    }

    pub fn get_otto_proposal_by_id(&self, proposal_id: &str) -> Result<Option<OttoProposalRow>> {
        self.conn()
            .query_row(
                "SELECT id, trace_run_id, domain, classification, asset_slug, asset_tier, action_id, params_json,
                        title, severity, confidence, rca_summary, evidence_json, diff_preview, rollback_plan_json,
                        blast_radius_flags_json, status, snoozed_until, created_at, decided_at, executed_at, verification_result_json
                 FROM agent_proposals
                 WHERE id = ?1",
                params![proposal_id],
                |r| {
                    Ok(OttoProposalRow {
                        id: r.get(0)?,
                        trace_run_id: r.get(1)?,
                        domain: r.get(2)?,
                        classification: r.get(3)?,
                        asset_slug: r.get(4)?,
                        asset_tier: r.get(5)?,
                        action_id: r.get(6)?,
                        params_json: r.get(7)?,
                        title: r.get(8)?,
                        severity: r.get(9)?,
                        confidence: r.get(10)?,
                        rca_summary: r.get(11)?,
                        evidence_json: r.get(12)?,
                        diff_preview: r.get(13)?,
                        rollback_plan_json: r.get(14)?,
                        blast_radius_flags_json: r.get(15)?,
                        status: r.get(16)?,
                        snoozed_until: r.get(17)?,
                        created_at: r.get(18)?,
                        decided_at: r.get(19)?,
                        executed_at: r.get(20)?,
                        verification_result_json: r.get(21)?,
                    })
                },
            )
            .optional()
    }

    pub fn insert_otto_soak_session(&self, s: &OttoSoakSessionRow) -> Result<()> {
        // Supersede any older active soak for the same app so only 1 soak runs per app at a time
        let now = Utc::now().to_rfc3339();
        self.conn().execute(
            "UPDATE agent_soak_sessions SET status = 'SUPERSEDED', updated_at = ?1
             WHERE app_slug = ?2 AND status = 'SOAKING'",
            params![now, s.app_slug],
        )?;
        self.conn().execute(
            "INSERT INTO agent_soak_sessions
             (id, app_slug, hosting_target, release_id, previous_image_tag, has_db_migration,
              started_at, ends_at, status, samples_json, trace_run_id, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                s.id,
                s.app_slug,
                s.hosting_target,
                scrub_secrets(&s.release_id),
                s.previous_image_tag.as_deref().map(scrub_secrets),
                if s.has_db_migration { 1 } else { 0 },
                s.started_at,
                s.ends_at,
                s.status,
                scrub_secrets(&s.samples_json),
                s.trace_run_id,
                s.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn update_otto_soak_session(
        &self,
        soak_id: &str,
        status: &str,
        samples_json: &str,
        trace_run_id: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn().execute(
            "UPDATE agent_soak_sessions
             SET status = ?1,
                 samples_json = ?2,
                 trace_run_id = COALESCE(?3, trace_run_id),
                 updated_at = ?4
             WHERE id = ?5",
            params![status, scrub_secrets(samples_json), trace_run_id, now, soak_id],
        )?;
        Ok(())
    }

    pub fn list_otto_soak_sessions(&self, limit: usize) -> Result<Vec<OttoSoakSessionRow>> {
        let mut stmt = self.conn().prepare(
            "SELECT id, app_slug, hosting_target, release_id, previous_image_tag, has_db_migration,
                    started_at, ends_at, status, samples_json, trace_run_id, updated_at
             FROM agent_soak_sessions
             ORDER BY started_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit.min(100) as i64], |r| {
            Ok(OttoSoakSessionRow {
                id: r.get(0)?,
                app_slug: r.get(1)?,
                hosting_target: r.get(2)?,
                release_id: r.get(3)?,
                previous_image_tag: r.get(4)?,
                has_db_migration: r.get::<_, i64>(5)? != 0,
                started_at: r.get(6)?,
                ends_at: r.get(7)?,
                status: r.get(8)?,
                samples_json: r.get(9)?,
                trace_run_id: r.get(10)?,
                updated_at: r.get(11)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn count_active_otto_soaks(&self) -> Result<i64> {
        self.conn().query_row(
            "SELECT COUNT(*) FROM agent_soak_sessions WHERE status = 'SOAKING'",
            [],
            |r| r.get(0),
        )
    }

    pub fn insert_otto_handoff_packet(&self, pkt: &OttoHandoffPacketRow) -> Result<()> {
        self.conn().execute(
            "INSERT INTO agent_handoff_packets
             (id, proposal_id, trace_run_id, app_slug, category, summary, logs_scrubbed, diff_patch, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                pkt.id,
                pkt.proposal_id,
                pkt.trace_run_id,
                pkt.app_slug,
                pkt.category,
                scrub_secrets(&pkt.summary),
                scrub_secrets(&pkt.logs_scrubbed),
                pkt.diff_patch.as_deref().map(scrub_secrets),
                pkt.status,
                pkt.created_at
            ],
        )?;
        Ok(())
    }

    pub fn list_otto_handoff_packets(&self, limit: usize) -> Result<Vec<OttoHandoffPacketRow>> {
        let mut stmt = self.conn().prepare(
            "SELECT id, proposal_id, trace_run_id, app_slug, category, summary, logs_scrubbed, diff_patch, status, created_at
             FROM agent_handoff_packets
             ORDER BY created_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit.min(50) as i64], |r| {
            Ok(OttoHandoffPacketRow {
                id: r.get(0)?,
                proposal_id: r.get(1)?,
                trace_run_id: r.get(2)?,
                app_slug: r.get(3)?,
                category: r.get(4)?,
                summary: r.get(5)?,
                logs_scrubbed: r.get(6)?,
                diff_patch: r.get(7)?,
                status: r.get(8)?,
                created_at: r.get(9)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn record_shadow_feedback(&self, action_id: &str, agreed: bool) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn().execute(
            "UPDATE agent_policies
             SET shadow_runs_count = shadow_runs_count + 1,
                 shadow_agreed_count = shadow_agreed_count + ?1,
                 updated_at = ?2
             WHERE action_id = ?3",
            params![if agreed { 1 } else { 0 }, now, action_id],
        )?;
        Ok(())
    }

    pub fn list_otto_chat_threads(&self, limit: usize) -> Result<Vec<OttoChatThreadRow>> {
        let mut stmt = self.conn().prepare(
            "SELECT t.id, t.title, t.context_seed_json, t.origin_view, t.origin_entity_id,
                    (SELECT COUNT(*) FROM agent_chat_messages m WHERE m.thread_id = t.id) as msg_count,
                    t.created_at, t.updated_at
             FROM agent_chat_threads t
             ORDER BY t.updated_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit.min(100) as i64], |r| {
            Ok(OttoChatThreadRow {
                id: r.get(0)?,
                title: r.get(1)?,
                context_seed_json: r.get(2)?,
                origin_view: r.get(3)?,
                origin_entity_id: r.get(4)?,
                message_count: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn create_otto_chat_thread(
        &self,
        title: &str,
        context_seed_json: Option<&str>,
        origin_view: Option<&str>,
        origin_entity_id: Option<&str>,
    ) -> Result<OttoChatThreadRow> {
        let id = format!("thread-{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();
        let safe_title = scrub_secrets(title);
        let safe_seed = context_seed_json.map(scrub_secrets);
        self.conn().execute(
            "INSERT INTO agent_chat_threads (id, title, context_seed_json, origin_view, origin_entity_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, safe_title, safe_seed, origin_view, origin_entity_id, now, now],
        )?;
        Ok(OttoChatThreadRow {
            id,
            title: safe_title,
            context_seed_json: safe_seed,
            origin_view: origin_view.map(|s| s.to_string()),
            origin_entity_id: origin_entity_id.map(|s| s.to_string()),
            message_count: 0,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn delete_otto_chat_thread(&self, thread_id: &str) -> Result<()> {
        self.conn().execute(
            "DELETE FROM agent_chat_messages WHERE thread_id = ?1",
            params![thread_id],
        )?;
        self.conn().execute(
            "DELETE FROM agent_chat_threads WHERE id = ?1",
            params![thread_id],
        )?;
        Ok(())
    }

    pub fn list_otto_chat_messages(&self, thread_id: &str) -> Result<Vec<OttoChatMessageRow>> {
        let mut stmt = self.conn().prepare(
            "SELECT id, thread_id, role, content_md, model_used, thinking_level, thinking_summary_md,
                    tools_used_json, inline_proposal_id, trace_run_id, token_usage_json, created_at
             FROM agent_chat_messages
             WHERE thread_id = ?1
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![thread_id], |r| {
            Ok(OttoChatMessageRow {
                id: r.get(0)?,
                thread_id: r.get(1)?,
                role: r.get(2)?,
                content_md: r.get(3)?,
                model_used: r.get(4)?,
                thinking_level: r.get(5)?,
                thinking_summary_md: r.get(6)?,
                tools_used_json: r.get(7)?,
                inline_proposal_id: r.get(8)?,
                trace_run_id: r.get(9)?,
                token_usage_json: r.get(10)?,
                created_at: r.get(11)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn insert_otto_chat_message(
        &self,
        thread_id: &str,
        role: &str,
        content_md: &str,
        model_used: Option<&str>,
        thinking_level: Option<&str>,
        thinking_summary_md: Option<&str>,
        tools_used_json: Option<&str>,
        inline_proposal_id: Option<&str>,
        trace_run_id: Option<&str>,
        token_usage_json: Option<&str>,
    ) -> Result<OttoChatMessageRow> {
        let id = format!("msg-{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();
        let safe_content = scrub_secrets(content_md);
        let safe_thinking = thinking_summary_md.map(scrub_secrets);
        let safe_tools = tools_used_json.map(scrub_secrets);
        self.conn().execute(
            "INSERT INTO agent_chat_messages
             (id, thread_id, role, content_md, model_used, thinking_level, thinking_summary_md,
              tools_used_json, inline_proposal_id, trace_run_id, token_usage_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                id,
                thread_id,
                role,
                safe_content,
                model_used,
                thinking_level,
                safe_thinking,
                safe_tools,
                inline_proposal_id,
                trace_run_id,
                token_usage_json,
                now
            ],
        )?;
        self.conn().execute(
            "UPDATE agent_chat_threads SET updated_at = ?1 WHERE id = ?2",
            params![now, thread_id],
        )?;
        Ok(OttoChatMessageRow {
            id,
            thread_id: thread_id.to_string(),
            role: role.to_string(),
            content_md: safe_content,
            model_used: model_used.map(|s| s.to_string()),
            thinking_level: thinking_level.map(|s| s.to_string()),
            thinking_summary_md: safe_thinking,
            tools_used_json: safe_tools,
            inline_proposal_id: inline_proposal_id.map(|s| s.to_string()),
            trace_run_id: trace_run_id.map(|s| s.to_string()),
            token_usage_json: token_usage_json.map(|s| s.to_string()),
            created_at: now,
        })
    }

    pub fn list_otto_saved_prompts(&self) -> Result<Vec<OttoSavedPromptRow>> {
        let mut stmt = self.conn().prepare(
            "SELECT id, title, prompt_text, category, created_at
             FROM agent_saved_prompts
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(OttoSavedPromptRow {
                id: r.get(0)?,
                title: r.get(1)?,
                prompt_text: r.get(2)?,
                category: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn insert_otto_saved_prompt(
        &self,
        title: &str,
        prompt_text: &str,
        category: &str,
    ) -> Result<OttoSavedPromptRow> {
        let id = format!("prompt-{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();
        let safe_title = scrub_secrets(title);
        let safe_text = scrub_secrets(prompt_text);
        self.conn().execute(
            "INSERT INTO agent_saved_prompts (id, title, prompt_text, category, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, safe_title, safe_text, category, now],
        )?;
        Ok(OttoSavedPromptRow {
            id,
            title: safe_title,
            prompt_text: safe_text,
            category: category.to_string(),
            created_at: now,
        })
    }

    pub fn delete_otto_saved_prompt(&self, id: &str) -> Result<()> {
        self.conn()
            .execute("DELETE FROM agent_saved_prompts WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_otto_log_cursor(&self, source_key: &str) -> Result<Option<String>> {
        self.conn()
            .query_row(
                "SELECT cursor_value FROM agent_log_cursors WHERE source_key = ?1",
                params![source_key],
                |r| r.get(0),
            )
            .optional()
    }

    pub fn upsert_otto_log_cursor(&self, source_key: &str, cursor_value: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn().execute(
            "INSERT INTO agent_log_cursors (source_key, cursor_value, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(source_key) DO UPDATE SET cursor_value = excluded.cursor_value, updated_at = excluded.updated_at",
            params![source_key, cursor_value, now],
        )?;
        Ok(())
    }

    pub fn append_otto_audit(
        &self,
        event_type: &str,
        action_id: Option<&str>,
        asset_slug: Option<&str>,
        decision: &str,
        reason: &str,
        trace_run_id: Option<&str>,
    ) -> Result<()> {
        let id = format!("audit-{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();
        let safe_reason = scrub_secrets(reason);
        self.conn().execute(
            "INSERT INTO agent_audit_ledger (id, event_type, action_id, asset_slug, decision, reason, trace_run_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, event_type, action_id, asset_slug, decision, safe_reason, trace_run_id, now],
        )?;

        let level = if decision.contains("BLOCK") || decision == "TRIPPED" || decision == "ENGAGED" {
            "WARN"
        } else {
            "INFO"
        };
        let msg = format!(
            "[Otto {}] {} -> {}: {}",
            event_type,
            action_id.unwrap_or("system"),
            decision,
            safe_reason
        );
        let _ = self.log_action("AGENT_AUDIT", level, &msg, trace_run_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_otto_tables_seed_scrub_and_circuit_breaker() {
        let db = SreDatabase::new(":memory:").expect("init in-memory db");

        let policies = db.list_otto_policies().expect("list policies");
        assert!(policies.len() >= 10);
        let deploy = policies.iter().find(|p| p.action_id == "deploy_verified_patch").unwrap();
        assert_eq!(deploy.mode, "L3_APPROVAL");
        assert_eq!(deploy.max_allowed_mode, "L3_APPROVAL");

        // Reject elevating deploy_verified_patch above compile-time L3 ceiling
        let err = db.update_otto_policy_mode("deploy_verified_patch", "L2_AUTO");
        assert!(err.is_err());

        // Allow promoting restart_container to L2_AUTO
        let updated = db
            .update_otto_policy_mode("restart_container", "L2_AUTO")
            .expect("allow within ceiling");
        assert_eq!(updated.mode, "L2_AUTO");

        // Secret scrubbing on trace steps
        let run_id = db
            .create_otto_trace_run("CHAT", "SECURITY", Some("auth"), Some("gemini-4-neon"), Some("high"))
            .expect("create trace");
        db.append_otto_trace_step(
            &run_id,
            0,
            "LLM_THINKING",
            "Analyze key GEMINI_API_KEY=AIzaSyDummySecretValue12345678901234567",
            "OK",
            120,
            Some("Checked X-Panorama-Service-Key: supersecret999 safely"),
            Some("{\"token\":\"cfat_1234567890abcdefghijklmno\"}"),
        )
        .expect("append trace step");
        let detail = db.get_otto_trace_detail(&run_id).unwrap().unwrap();
        assert_eq!(detail.steps.len(), 1);
        assert!(!detail.steps[0].title.contains("AIzaSy"));
        assert!(!detail.steps[0].thinking_summary_md.as_deref().unwrap().contains("supersecret999"));
        assert!(!detail.steps[0].structured_payload_json.as_deref().unwrap().contains("cfat_"));

        // Circuit breaker trips on 2nd consecutive failure & resets cleanly
        let s1 = db.record_otto_circuit_failure("failure 1").unwrap();
        assert_eq!(s1.circuit_breaker_state, "CLOSED");
        let s2 = db.record_otto_circuit_failure("failure 2").unwrap();
        assert_eq!(s2.circuit_breaker_state, "TRIPPED");
        let s3 = db.reset_otto_circuit_breaker().unwrap();
        assert_eq!(s3.circuit_breaker_state, "CLOSED");
        assert_eq!(s3.consecutive_failures, 0);
    }
}
