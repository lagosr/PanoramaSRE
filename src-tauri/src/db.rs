use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemLogEntry {
    pub id: i64,
    pub category: String,
    pub level: String,
    pub message: String,
    pub metadata: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptInCacheRow {
    pub id: i64,
    pub first_name: String,
    pub last_name: String,
    pub phone: String,
    pub consent: String,
    pub ip_address: String,
    pub user_agent: String,
    pub created_at: String,
    pub synced_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsoleSessionRecord {
    pub id: String,
    pub title: String,
    pub lines: Vec<String>,
    pub is_running: bool,
    pub exit_code: Option<i32>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub page_scope: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PushoverAlertStateRow {
    pub dedup_key: String,
    pub fingerprint: String,
    pub is_failing: bool,
    pub consecutive_count: u32,
    pub updated_at: String,
    pub last_notified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeployTelemetryRunRow {
    pub id: String,
    pub console_session_id: Option<String>,
    pub app_slug: String,
    pub app_name: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub wall_duration_sec: Option<f64>,
    pub exit_code: Option<i32>,
    pub engine_version: Option<String>,
    pub release_id: Option<String>,
    pub cache_posture: String,
    pub status: String,
    pub host_typecheck_sec: Option<f64>,
    pub semver_bump_sec: Option<f64>,
    pub build_total_sec: Option<f64>,
    pub deps_stage_sec: Option<f64>,
    pub deps_cache_hit: Option<bool>,
    pub next_build_sec: Option<f64>,
    pub arm64_natives_sec: Option<f64>,
    pub arm64_natives_cache_hit: Option<bool>,
    pub export_tar_sec: Option<f64>,
    pub context_transfer_kb: Option<f64>,
    pub elf_verified_count: Option<i64>,
    pub stage3_preflight_sec: Option<f64>,
    pub stage4_upload_sec: Option<f64>,
    pub stage5_snapshot_sec: Option<f64>,
    pub stage5_swap_sec: Option<f64>,
    pub stage5_verify_sec: Option<f64>,
    pub stage5_smoke_sec: Option<f64>,
    pub stage5_finalize_sec: Option<f64>,
    pub stage5_cron_sec: Option<f64>,
    pub stage5_manifest_sync_sec: Option<f64>,
    pub bumped: bool,
    pub ran_smoke: bool,
    pub warnings: Vec<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreatAuditRunRow {
    pub id: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub window_start: String,
    pub window_end: String,
    pub window_hours: u32,
    pub trigger_source: String,
    pub status: String,
    pub overall_severity: String,
    pub intrusion_verdict: String,
    pub tier1_model: Option<String>,
    pub tier2_model: Option<String>,
    pub escalated_to_tier2: bool,
    pub escalation_reasons_json: Option<String>,
    pub collector_statuses_json: Option<String>,
    pub zones_summary_json: Option<String>,
    pub zero_trust_summary_json: Option<String>,
    pub internal_summary_json: Option<String>,
    pub gemini_brief_json: Option<String>,
    pub token_usage_json: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreatActorRow {
    pub id: String,
    pub actor_type: String,
    pub ip_address: Option<String>,
    pub asn: Option<String>,
    pub as_org: Option<String>,
    pub country: Option<String>,
    pub intel_tags_json: String,
    pub intel_summary: Option<String>,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub runs_seen: u32,
    pub total_requests: u64,
    pub total_origin_200s: u64,
    pub highest_severity: String,
    pub latest_classification: Option<String>,
    pub target_hosts_json: String,
    pub sample_paths_json: String,
    pub disposition: String,
    #[serde(default)]
    pub snoozed_until: Option<String>,
}

fn default_active_disposition() -> String {
    "ACTIVE".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreatFindingRow {
    pub id: String,
    pub run_id: String,
    pub source_layer: String,
    pub rule_id: String,
    pub severity: String,
    pub category: String,
    pub title: String,
    pub summary: String,
    pub host: Option<String>,
    pub actor_ip: Option<String>,
    pub actor_asn: Option<String>,
    pub ray_ids_json: String,
    pub evidence_json: String,
    pub created_at: String,
    #[serde(default = "default_active_disposition")]
    pub disposition: String,
    #[serde(default)]
    pub snoozed_until: Option<String>,
    #[serde(default)]
    pub resolved_at: Option<String>,
    #[serde(default)]
    pub resolution_note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanClientBaselineRow {
    pub mac_address: String,
    pub ip_address: Option<String>,
    pub hostname: Option<String>,
    pub network_vlan: Option<String>,
    pub oui_vendor: Option<String>,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub is_trusted: bool,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreatAllowlistRow {
    pub id: String,
    pub entry_type: String,
    pub value: String,
    pub label: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuarantinedAccessEmailRow {
    pub email: String,
    pub status: String,
    pub policy_grants_json: String,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub reviewed_at: Option<String>,
    pub removed_at: Option<String>,
    pub review_note: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct QuarantineReconcileOutcome {
    pub newly_quarantined: Vec<QuarantinedAccessEmailRow>,
    pub pending_all: Vec<QuarantinedAccessEmailRow>,
    pub auto_revoked: Vec<QuarantinedAccessEmailRow>,
    pub newly_attached_policy_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WafRuleOverrideRow {
    pub id: String,
    pub zone_name: String,
    pub rule_name: String,
    pub action: String,
    pub expression: String,
    pub enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SreDbStats {
    pub db_path: String,
    pub db_size_bytes: u64,
    pub wal_size_bytes: u64,
    pub shm_size_bytes: u64,
    pub total_size_bytes: u64,
    pub log_count: i64,
    pub console_session_count: i64,
    pub threat_run_count: i64,
    pub journal_mode: String,
}

pub struct SreDatabase {
    conn: Connection,
    db_path: PathBuf,
    log_file_path: PathBuf,
}

impl SreDatabase {
    pub fn new<P: AsRef<Path>>(db_path: P) -> Result<Self> {
        let path_ref = db_path.as_ref();
        if let Some(parent) = path_ref.parent() {
            fs::create_dir_all(parent).ok();
        }

        let log_file_path = if let Some(parent) = path_ref.parent() {
            parent.join("sre.log")
        } else {
            PathBuf::from("data/sre.log")
        };

        let conn = Connection::open(path_ref)?;

        // Enable WAL mode and synchronous normal for concurrency
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;"
        )?;

        let db = SreDatabase {
            conn,
            db_path: path_ref.to_path_buf(),
            log_file_path,
        };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS system_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                metadata TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS telemetry_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tier INTEGER NOT NULL,
                payload TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS command_runs (
                id TEXT PRIMARY KEY,
                tool_id TEXT NOT NULL,
                action_id TEXT NOT NULL,
                status TEXT NOT NULL,
                exit_code INTEGER,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                log_path TEXT
            );

            CREATE TABLE IF NOT EXISTS console_sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                lines_json TEXT NOT NULL,
                is_running INTEGER NOT NULL DEFAULT 0,
                exit_code INTEGER,
                page_scope TEXT,
                source TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS parakith_opt_ins_cache (
                id INTEGER PRIMARY KEY,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                consent TEXT NOT NULL,
                ip_address TEXT NOT NULL,
                user_agent TEXT NOT NULL,
                created_at TEXT NOT NULL,
                synced_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS pushover_alert_state (
                dedup_key TEXT PRIMARY KEY,
                fingerprint TEXT NOT NULL,
                is_failing INTEGER NOT NULL DEFAULT 0,
                consecutive_count INTEGER NOT NULL DEFAULT 1,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_notified_at TEXT
            );

            CREATE TABLE IF NOT EXISTS deploy_telemetry_runs (
                id TEXT PRIMARY KEY,
                console_session_id TEXT,
                app_slug TEXT NOT NULL,
                app_name TEXT NOT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                wall_duration_sec REAL,
                exit_code INTEGER,
                engine_version TEXT,
                release_id TEXT,
                cache_posture TEXT NOT NULL,
                status TEXT NOT NULL,
                host_typecheck_sec REAL,
                semver_bump_sec REAL,
                build_total_sec REAL,
                deps_stage_sec REAL,
                deps_cache_hit INTEGER,
                next_build_sec REAL,
                arm64_natives_sec REAL,
                arm64_natives_cache_hit INTEGER,
                export_tar_sec REAL,
                context_transfer_kb REAL,
                elf_verified_count INTEGER,
                stage3_preflight_sec REAL,
                stage4_upload_sec REAL,
                stage5_snapshot_sec REAL,
                stage5_swap_sec REAL,
                stage5_verify_sec REAL,
                stage5_smoke_sec REAL,
                stage5_finalize_sec REAL,
                stage5_cron_sec REAL,
                stage5_manifest_sync_sec REAL,
                bumped INTEGER NOT NULL DEFAULT 0,
                ran_smoke INTEGER NOT NULL DEFAULT 0,
                warnings_json TEXT,
                source TEXT NOT NULL DEFAULT 'backfill',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_deploy_telemetry_started_slug
                ON deploy_telemetry_runs (started_at DESC, app_slug);

            CREATE TABLE IF NOT EXISTS threat_audit_runs (
                id TEXT PRIMARY KEY,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                window_start TEXT NOT NULL,
                window_end TEXT NOT NULL,
                window_hours INTEGER NOT NULL DEFAULT 6,
                trigger_source TEXT NOT NULL,
                status TEXT NOT NULL,
                overall_severity TEXT NOT NULL,
                intrusion_verdict TEXT NOT NULL,
                tier1_model TEXT,
                tier2_model TEXT,
                escalated_to_tier2 INTEGER NOT NULL DEFAULT 0,
                escalation_reasons_json TEXT,
                collector_statuses_json TEXT,
                zones_summary_json TEXT,
                zero_trust_summary_json TEXT,
                internal_summary_json TEXT,
                gemini_brief_json TEXT,
                token_usage_json TEXT,
                error_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_threat_runs_started
                ON threat_audit_runs (started_at DESC);

            CREATE TABLE IF NOT EXISTS threat_actors (
                id TEXT PRIMARY KEY,
                actor_type TEXT NOT NULL,
                ip_address TEXT,
                asn TEXT,
                as_org TEXT,
                country TEXT,
                intel_tags_json TEXT NOT NULL DEFAULT '[]',
                intel_summary TEXT,
                first_seen_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                runs_seen INTEGER NOT NULL DEFAULT 1,
                total_requests INTEGER NOT NULL DEFAULT 0,
                total_origin_200s INTEGER NOT NULL DEFAULT 0,
                highest_severity TEXT NOT NULL DEFAULT 'LOW',
                latest_classification TEXT,
                target_hosts_json TEXT NOT NULL DEFAULT '[]',
                sample_paths_json TEXT NOT NULL DEFAULT '[]',
                disposition TEXT NOT NULL DEFAULT 'ACTIVE',
                snoozed_until TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_threat_actors_disp_seen
                ON threat_actors (disposition, last_seen_at DESC);

            CREATE TABLE IF NOT EXISTS threat_findings (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                source_layer TEXT NOT NULL,
                rule_id TEXT NOT NULL,
                severity TEXT NOT NULL,
                category TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                host TEXT,
                actor_ip TEXT,
                actor_asn TEXT,
                ray_ids_json TEXT NOT NULL DEFAULT '[]',
                evidence_json TEXT NOT NULL DEFAULT '{}',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                disposition TEXT NOT NULL DEFAULT 'ACTIVE',
                snoozed_until TEXT,
                resolved_at TEXT,
                resolution_note TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_threat_findings_run
                ON threat_findings (run_id, severity);

            CREATE TABLE IF NOT EXISTS lan_clients_baseline (
                mac_address TEXT PRIMARY KEY,
                ip_address TEXT,
                hostname TEXT,
                network_vlan TEXT,
                oui_vendor TEXT,
                first_seen_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                is_trusted INTEGER NOT NULL DEFAULT 0,
                label TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS threat_allowlist (
                id TEXT PRIMARY KEY,
                entry_type TEXT NOT NULL,
                value TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS cf_ip_intel_cache (
                ip TEXT PRIMARY KEY,
                payload_json TEXT NOT NULL,
                fetched_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS waf_rule_overrides (
                id TEXT PRIMARY KEY,
                zone_name TEXT NOT NULL,
                rule_name TEXT NOT NULL,
                action TEXT NOT NULL DEFAULT 'block',
                expression TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(zone_name, rule_name)
            );

            CREATE TABLE IF NOT EXISTS quarantined_access_emails (
                email TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                policy_grants_json TEXT NOT NULL DEFAULT '[]',
                first_seen_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                reviewed_at TEXT,
                removed_at TEXT,
                review_note TEXT
            );"
        )?;

        // Idempotent column migration for existing console_sessions tables
        let existing_cols = self.get_table_columns("console_sessions")?;
        if !existing_cols.iter().any(|c| c == "page_scope") {
            self.conn.execute("ALTER TABLE console_sessions ADD COLUMN page_scope TEXT", [])?;
        }
        if !existing_cols.iter().any(|c| c == "source") {
            self.conn.execute("ALTER TABLE console_sessions ADD COLUMN source TEXT", [])?;
        }

        // Idempotent column migration for threat_actors snooze support
        let actor_cols = self.get_table_columns("threat_actors")?;
        if !actor_cols.iter().any(|c| c == "snoozed_until") {
            self.conn.execute("ALTER TABLE threat_actors ADD COLUMN snoozed_until TEXT", [])?;
        }

        // Idempotent column migration for threat_findings disposition & resolution tracking
        let finding_cols = self.get_table_columns("threat_findings")?;
        if !finding_cols.iter().any(|c| c == "disposition") {
            self.conn.execute(
                "ALTER TABLE threat_findings ADD COLUMN disposition TEXT NOT NULL DEFAULT 'ACTIVE'",
                [],
            )?;
        }
        if !finding_cols.iter().any(|c| c == "snoozed_until") {
            self.conn.execute("ALTER TABLE threat_findings ADD COLUMN snoozed_until TEXT", [])?;
        }
        if !finding_cols.iter().any(|c| c == "resolved_at") {
            self.conn.execute("ALTER TABLE threat_findings ADD COLUMN resolved_at TEXT", [])?;
        }
        if !finding_cols.iter().any(|c| c == "resolution_note") {
            self.conn.execute("ALTER TABLE threat_findings ADD COLUMN resolution_note TEXT", [])?;
        }

        // Reconcile any stale running flags left over from prior terminated app runs
        self.conn.execute("UPDATE console_sessions SET is_running = 0 WHERE is_running = 1", [])?;

        // Auto-purge console sessions and system logs older than 28 days
        self.purge_old_entries(28).ok();
        // Auto-purge detailed threat runs & findings older than 90 days (keeps actor & LAN baseline history)
        self.purge_old_threat_runs(90).ok();
        // Run startup threat hygiene (clean benign crawlers, expire 7d stale noise, align isolated LAN severity)
        self.run_threat_hygiene_pass(&chrono::Utc::now().to_rfc3339()).ok();

        Ok(())
    }

    fn get_table_columns(&self, table_name: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(&format!("PRAGMA table_info({})", table_name))?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        let mut cols = Vec::new();
        for r in rows {
            cols.push(r?);
        }
        Ok(cols)
    }

    pub fn purge_old_entries(&self, days: i64) -> Result<()> {
        let modifier = format!("-{} days", days);
        self.conn.execute(
            "DELETE FROM console_sessions WHERE created_at < datetime('now', ?1)",
            params![modifier],
        )?;
        self.conn.execute(
            "DELETE FROM system_logs WHERE created_at < datetime('now', ?1)",
            params![modifier],
        )?;
        Ok(())
    }

    pub fn save_console_session(
        &self,
        id: &str,
        title: &str,
        lines: &[String],
        is_running: bool,
        exit_code: Option<i32>,
        page_scope: Option<&str>,
        source: Option<&str>,
    ) -> Result<()> {
        let lines_json = serde_json::to_string(lines).unwrap_or_else(|_| "[]".to_string());
        self.conn.execute(
            "INSERT INTO console_sessions (id, title, lines_json, is_running, exit_code, page_scope, source, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                lines_json = excluded.lines_json,
                is_running = excluded.is_running,
                exit_code = excluded.exit_code,
                page_scope = COALESCE(excluded.page_scope, console_sessions.page_scope),
                source = COALESCE(excluded.source, console_sessions.source),
                updated_at = CURRENT_TIMESTAMP",
            params![id, title, lines_json, if is_running { 1 } else { 0 }, exit_code, page_scope, source],
        )?;
        Ok(())
    }

    pub fn get_saved_console_sessions(&self) -> Result<Vec<ConsoleSessionRecord>> {
        // Auto-purge > 28 days first
        let _ = self.purge_old_entries(28);

        let mut stmt = self.conn.prepare(
            "SELECT id, title, lines_json, is_running, exit_code, created_at, updated_at, page_scope, source
             FROM console_sessions
             ORDER BY datetime(COALESCE(updated_at, created_at)) DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let title: String = row.get(1)?;
            let lines_raw: String = row.get(2)?;
            let is_running_int: i32 = row.get(3)?;
            let exit_code: Option<i32> = row.get(4)?;
            let created_at: Option<String> = row.get(5)?;
            let updated_at: Option<String> = row.get(6)?;
            let page_scope: Option<String> = row.get(7)?;
            let source: Option<String> = row.get(8)?;
            let lines: Vec<String> = serde_json::from_str(&lines_raw).unwrap_or_default();
            Ok(ConsoleSessionRecord {
                id,
                title,
                lines,
                is_running: is_running_int == 1,
                exit_code,
                created_at,
                updated_at,
                page_scope,
                source,
            })
        })?;

        let mut res = Vec::new();
        for r in rows {
            res.push(r?);
        }
        Ok(res)
    }

    pub fn delete_console_session(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM console_sessions WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn delete_all_console_sessions(&self) -> Result<()> {
        self.conn.execute("DELETE FROM console_sessions", [])?;
        Ok(())
    }

    pub fn log_action(&self, category: &str, level: &str, message: &str, metadata: Option<&str>) -> Result<()> {
        self.conn.execute(
            "INSERT INTO system_logs (category, level, message, metadata) VALUES (?1, ?2, ?3, ?4)",
            params![category, level, message, metadata],
        )?;

        // Append to flat log file for auditability
        let timestamp = chrono::Utc::now().to_rfc3339();
        let meta_str = metadata.map(|m| format!(" | {}", m)).unwrap_or_default();
        let line = format!("[{}] [{}] [{}] {}{}\n", timestamp, level.to_uppercase(), category.to_uppercase(), message, meta_str);
        
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&self.log_file_path) {
            let _ = file.write_all(line.as_bytes());
        }

        Ok(())
    }

    pub fn get_logs(&self, limit: usize, category: Option<&str>) -> Result<Vec<SystemLogEntry>> {
        let mut sql = "SELECT id, category, level, message, metadata, created_at FROM system_logs".to_string();
        if let Some(cat) = category {
            if !cat.is_empty() && cat != "ALL" {
                sql.push_str(&format!(" WHERE category = '{}'", cat.replace('\'', "''")));
            }
        }
        sql.push_str(&format!(" ORDER BY id DESC LIMIT {}", limit));

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            Ok(SystemLogEntry {
                id: row.get(0)?,
                category: row.get(1)?,
                level: row.get(2)?,
                message: row.get(3)?,
                metadata: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }
        Ok(entries)
    }

    pub fn clear_logs(&self) -> Result<()> {
        self.conn.execute("DELETE FROM system_logs", [])?;
        if let Ok(mut file) = OpenOptions::new().create(true).truncate(true).write(true).open(&self.log_file_path) {
            let _ = file.write_all(b"");
        }
        Ok(())
    }

    pub fn get_db_stats(&self) -> Result<SreDbStats> {
        let base_display = self.db_path.display().to_string();
        let wal_path = PathBuf::from(format!("{}-wal", base_display));
        let shm_path = PathBuf::from(format!("{}-shm", base_display));

        let db_size_bytes = fs::metadata(&self.db_path).map(|m| m.len()).unwrap_or(0);
        let wal_size_bytes = fs::metadata(&wal_path).map(|m| m.len()).unwrap_or(0);
        let shm_size_bytes = fs::metadata(&shm_path).map(|m| m.len()).unwrap_or(0);
        let total_size_bytes = db_size_bytes
            .saturating_add(wal_size_bytes)
            .saturating_add(shm_size_bytes);

        let log_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM system_logs", [], |r| r.get(0))
            .unwrap_or(0);
        let console_session_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM console_sessions", [], |r| r.get(0))
            .unwrap_or(0);
        let threat_run_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM threat_audit_runs", [], |r| r.get(0))
            .unwrap_or(0);
        let journal_mode: String = self
            .conn
            .query_row("PRAGMA journal_mode;", [], |r| r.get(0))
            .unwrap_or_else(|_| "unknown".to_string());

        Ok(SreDbStats {
            db_path: base_display,
            db_size_bytes,
            wal_size_bytes,
            shm_size_bytes,
            total_size_bytes,
            log_count,
            console_session_count,
            threat_run_count,
            journal_mode,
        })
    }

    pub fn vacuum_and_checkpoint(&self) -> Result<SreDbStats> {
        self.conn
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")?;
        let _ = self.log_action(
            "SYSTEM",
            "INFO",
            "Executed WAL checkpoint (TRUNCATE) and SQLite VACUUM on sre.sqlite",
            None,
        );
        self.get_db_stats()
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare("SELECT value FROM app_settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            let val: String = row.get(0)?;
            Ok(Some(val))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn replace_parakith_opt_ins(&self, rows: &[OptInCacheRow]) -> Result<()> {
        self.conn.execute_batch("BEGIN IMMEDIATE;")?;
        let res = (|| -> Result<()> {
            self.conn.execute("DELETE FROM parakith_opt_ins_cache", [])?;
            let mut stmt = self.conn.prepare(
                "INSERT INTO parakith_opt_ins_cache
                 (id, first_name, last_name, phone, consent, ip_address, user_agent, created_at, synced_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )?;
            for row in rows {
                stmt.execute(params![
                    row.id,
                    row.first_name,
                    row.last_name,
                    row.phone,
                    row.consent,
                    row.ip_address,
                    row.user_agent,
                    row.created_at,
                    row.synced_at,
                ])?;
            }
            Ok(())
        })();

        match res {
            Ok(_) => {
                self.conn.execute_batch("COMMIT;")?;
                Ok(())
            }
            Err(err) => {
                let _ = self.conn.execute_batch("ROLLBACK;");
                Err(err)
            }
        }
    }

    pub fn get_parakith_opt_ins(&self) -> Result<Vec<OptInCacheRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, first_name, last_name, phone, consent, ip_address, user_agent, created_at, synced_at
             FROM parakith_opt_ins_cache
             ORDER BY id DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(OptInCacheRow {
                id: row.get(0)?,
                first_name: row.get(1)?,
                last_name: row.get(2)?,
                phone: row.get(3)?,
                consent: row.get(4)?,
                ip_address: row.get(5)?,
                user_agent: row.get(6)?,
                created_at: row.get(7)?,
                synced_at: row.get(8)?,
            })
        })?;

        let mut out = Vec::new();
        for item in rows {
            out.push(item?);
        }
        Ok(out)
    }

    pub fn delete_parakith_opt_in_cache(&self, id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM parakith_opt_ins_cache WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_pushover_alert_state(&self, dedup_key: &str) -> Result<Option<PushoverAlertStateRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT dedup_key, fingerprint, is_failing, consecutive_count, updated_at, last_notified_at
             FROM pushover_alert_state
             WHERE dedup_key = ?1",
        )?;
        let mut rows = stmt.query(params![dedup_key])?;
        if let Some(row) = rows.next()? {
            let is_failing_int: i32 = row.get(2)?;
            let consecutive_raw: i64 = row.get(3)?;
            Ok(Some(PushoverAlertStateRow {
                dedup_key: row.get(0)?,
                fingerprint: row.get(1)?,
                is_failing: is_failing_int != 0,
                consecutive_count: consecutive_raw.max(0) as u32,
                updated_at: row.get(4)?,
                last_notified_at: row.get(5)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_all_pushover_alert_states(&self) -> Result<Vec<PushoverAlertStateRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT dedup_key, fingerprint, is_failing, consecutive_count, updated_at, last_notified_at
             FROM pushover_alert_state
             ORDER BY dedup_key ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            let is_failing_int: i32 = row.get(2)?;
            let consecutive_raw: i64 = row.get(3)?;
            Ok(PushoverAlertStateRow {
                dedup_key: row.get(0)?,
                fingerprint: row.get(1)?,
                is_failing: is_failing_int != 0,
                consecutive_count: consecutive_raw.max(0) as u32,
                updated_at: row.get(4)?,
                last_notified_at: row.get(5)?,
            })
        })?;

        let mut out = Vec::new();
        for item in rows {
            out.push(item?);
        }
        Ok(out)
    }

    pub fn upsert_pushover_alert_state(
        &self,
        dedup_key: &str,
        fingerprint: &str,
        is_failing: bool,
        consecutive_count: u32,
        last_notified_at: Option<&str>,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO pushover_alert_state
             (dedup_key, fingerprint, is_failing, consecutive_count, updated_at, last_notified_at)
             VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, ?5)
             ON CONFLICT(dedup_key) DO UPDATE SET
                fingerprint = excluded.fingerprint,
                is_failing = excluded.is_failing,
                consecutive_count = excluded.consecutive_count,
                updated_at = CURRENT_TIMESTAMP,
                last_notified_at = COALESCE(excluded.last_notified_at, pushover_alert_state.last_notified_at)",
            params![
                dedup_key,
                fingerprint,
                if is_failing { 1 } else { 0 },
                consecutive_count as i64,
                last_notified_at
            ],
        )?;
        Ok(())
    }

    pub fn clear_all_pushover_alert_states(&self) -> Result<()> {
        self.conn.execute("DELETE FROM pushover_alert_state", [])?;
        Ok(())
    }

    pub fn upsert_deploy_telemetry_run(
        &self,
        row: &DeployTelemetryRunRow,
        overwrite_existing: bool,
    ) -> Result<()> {
        let warnings_json = serde_json::to_string(&row.warnings).unwrap_or_else(|_| "[]".to_string());
        let deps_hit_int: Option<i32> = row.deps_cache_hit.map(|b| if b { 1 } else { 0 });
        let arm64_hit_int: Option<i32> = row.arm64_natives_cache_hit.map(|b| if b { 1 } else { 0 });
        let sql = if overwrite_existing {
            "INSERT INTO deploy_telemetry_runs (
                id, console_session_id, app_slug, app_name, started_at, finished_at,
                wall_duration_sec, exit_code, engine_version, release_id, cache_posture, status,
                host_typecheck_sec, semver_bump_sec, build_total_sec, deps_stage_sec, deps_cache_hit,
                next_build_sec, arm64_natives_sec, arm64_natives_cache_hit, export_tar_sec,
                context_transfer_kb, elf_verified_count, stage3_preflight_sec, stage4_upload_sec,
                stage5_snapshot_sec, stage5_swap_sec, stage5_verify_sec, stage5_smoke_sec,
                stage5_finalize_sec, stage5_cron_sec, stage5_manifest_sync_sec,
                bumped, ran_smoke, warnings_json, source
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                ?7, ?8, ?9, ?10, ?11, ?12,
                ?13, ?14, ?15, ?16, ?17,
                ?18, ?19, ?20, ?21,
                ?22, ?23, ?24, ?25,
                ?26, ?27, ?28, ?29,
                ?30, ?31, ?32,
                ?33, ?34, ?35, ?36
            )
            ON CONFLICT(id) DO UPDATE SET
                console_session_id = COALESCE(excluded.console_session_id, deploy_telemetry_runs.console_session_id),
                app_slug = excluded.app_slug,
                app_name = excluded.app_name,
                started_at = excluded.started_at,
                finished_at = COALESCE(excluded.finished_at, deploy_telemetry_runs.finished_at),
                wall_duration_sec = COALESCE(excluded.wall_duration_sec, deploy_telemetry_runs.wall_duration_sec),
                exit_code = COALESCE(excluded.exit_code, deploy_telemetry_runs.exit_code),
                engine_version = COALESCE(excluded.engine_version, deploy_telemetry_runs.engine_version),
                release_id = COALESCE(excluded.release_id, deploy_telemetry_runs.release_id),
                cache_posture = excluded.cache_posture,
                status = excluded.status,
                host_typecheck_sec = COALESCE(excluded.host_typecheck_sec, deploy_telemetry_runs.host_typecheck_sec),
                semver_bump_sec = COALESCE(excluded.semver_bump_sec, deploy_telemetry_runs.semver_bump_sec),
                build_total_sec = COALESCE(excluded.build_total_sec, deploy_telemetry_runs.build_total_sec),
                deps_stage_sec = COALESCE(excluded.deps_stage_sec, deploy_telemetry_runs.deps_stage_sec),
                deps_cache_hit = COALESCE(excluded.deps_cache_hit, deploy_telemetry_runs.deps_cache_hit),
                next_build_sec = COALESCE(excluded.next_build_sec, deploy_telemetry_runs.next_build_sec),
                arm64_natives_sec = COALESCE(excluded.arm64_natives_sec, deploy_telemetry_runs.arm64_natives_sec),
                arm64_natives_cache_hit = COALESCE(excluded.arm64_natives_cache_hit, deploy_telemetry_runs.arm64_natives_cache_hit),
                export_tar_sec = COALESCE(excluded.export_tar_sec, deploy_telemetry_runs.export_tar_sec),
                context_transfer_kb = COALESCE(excluded.context_transfer_kb, deploy_telemetry_runs.context_transfer_kb),
                elf_verified_count = COALESCE(excluded.elf_verified_count, deploy_telemetry_runs.elf_verified_count),
                stage3_preflight_sec = COALESCE(excluded.stage3_preflight_sec, deploy_telemetry_runs.stage3_preflight_sec),
                stage4_upload_sec = COALESCE(excluded.stage4_upload_sec, deploy_telemetry_runs.stage4_upload_sec),
                stage5_snapshot_sec = COALESCE(excluded.stage5_snapshot_sec, deploy_telemetry_runs.stage5_snapshot_sec),
                stage5_swap_sec = COALESCE(excluded.stage5_swap_sec, deploy_telemetry_runs.stage5_swap_sec),
                stage5_verify_sec = COALESCE(excluded.stage5_verify_sec, deploy_telemetry_runs.stage5_verify_sec),
                stage5_smoke_sec = COALESCE(excluded.stage5_smoke_sec, deploy_telemetry_runs.stage5_smoke_sec),
                stage5_finalize_sec = COALESCE(excluded.stage5_finalize_sec, deploy_telemetry_runs.stage5_finalize_sec),
                stage5_cron_sec = COALESCE(excluded.stage5_cron_sec, deploy_telemetry_runs.stage5_cron_sec),
                stage5_manifest_sync_sec = COALESCE(excluded.stage5_manifest_sync_sec, deploy_telemetry_runs.stage5_manifest_sync_sec),
                bumped = excluded.bumped,
                ran_smoke = excluded.ran_smoke,
                warnings_json = excluded.warnings_json,
                source = excluded.source"
        } else {
            "INSERT OR IGNORE INTO deploy_telemetry_runs (
                id, console_session_id, app_slug, app_name, started_at, finished_at,
                wall_duration_sec, exit_code, engine_version, release_id, cache_posture, status,
                host_typecheck_sec, semver_bump_sec, build_total_sec, deps_stage_sec, deps_cache_hit,
                next_build_sec, arm64_natives_sec, arm64_natives_cache_hit, export_tar_sec,
                context_transfer_kb, elf_verified_count, stage3_preflight_sec, stage4_upload_sec,
                stage5_snapshot_sec, stage5_swap_sec, stage5_verify_sec, stage5_smoke_sec,
                stage5_finalize_sec, stage5_cron_sec, stage5_manifest_sync_sec,
                bumped, ran_smoke, warnings_json, source
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                ?7, ?8, ?9, ?10, ?11, ?12,
                ?13, ?14, ?15, ?16, ?17,
                ?18, ?19, ?20, ?21,
                ?22, ?23, ?24, ?25,
                ?26, ?27, ?28, ?29,
                ?30, ?31, ?32,
                ?33, ?34, ?35, ?36
            )"
        };

        self.conn.execute(
            sql,
            params![
                row.id,
                row.console_session_id,
                row.app_slug,
                row.app_name,
                row.started_at,
                row.finished_at,
                row.wall_duration_sec,
                row.exit_code,
                row.engine_version,
                row.release_id,
                row.cache_posture,
                row.status,
                row.host_typecheck_sec,
                row.semver_bump_sec,
                row.build_total_sec,
                row.deps_stage_sec,
                deps_hit_int,
                row.next_build_sec,
                row.arm64_natives_sec,
                arm64_hit_int,
                row.export_tar_sec,
                row.context_transfer_kb,
                row.elf_verified_count,
                row.stage3_preflight_sec,
                row.stage4_upload_sec,
                row.stage5_snapshot_sec,
                row.stage5_swap_sec,
                row.stage5_verify_sec,
                row.stage5_smoke_sec,
                row.stage5_finalize_sec,
                row.stage5_cron_sec,
                row.stage5_manifest_sync_sec,
                if row.bumped { 1 } else { 0 },
                if row.ran_smoke { 1 } else { 0 },
                warnings_json,
                row.source,
            ],
        )?;
        Ok(())
    }

    pub fn list_deploy_console_sessions(&self) -> Result<Vec<ConsoleSessionRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, lines_json, is_running, exit_code, created_at, updated_at, page_scope, source
             FROM console_sessions
             WHERE id LIKE 'deploy-%' AND is_running = 0
             ORDER BY datetime(COALESCE(created_at, updated_at)) DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            let lines_raw: String = row.get(2)?;
            let lines: Vec<String> = serde_json::from_str(&lines_raw).unwrap_or_default();
            Ok(ConsoleSessionRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                lines,
                is_running: row.get::<_, i32>(3)? == 1,
                exit_code: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                page_scope: row.get(7)?,
                source: row.get(8)?,
            })
        })?;
        let mut res = Vec::new();
        for r in rows {
            res.push(r?);
        }
        Ok(res)
    }

    pub fn get_deploy_telemetry_runs(&self, limit: usize) -> Result<Vec<DeployTelemetryRunRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT
                id, console_session_id, app_slug, app_name, started_at, finished_at,
                wall_duration_sec, exit_code, engine_version, release_id, cache_posture, status,
                host_typecheck_sec, semver_bump_sec, build_total_sec, deps_stage_sec, deps_cache_hit,
                next_build_sec, arm64_natives_sec, arm64_natives_cache_hit, export_tar_sec,
                context_transfer_kb, elf_verified_count, stage3_preflight_sec, stage4_upload_sec,
                stage5_snapshot_sec, stage5_swap_sec, stage5_verify_sec, stage5_smoke_sec,
                stage5_finalize_sec, stage5_cron_sec, stage5_manifest_sync_sec,
                bumped, ran_smoke, warnings_json, source
             FROM deploy_telemetry_runs
             ORDER BY datetime(started_at) DESC, started_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            let warnings_raw: Option<String> = row.get(34)?;
            let warnings: Vec<String> = warnings_raw
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
            let deps_hit_opt: Option<i32> = row.get(16)?;
            let arm64_hit_opt: Option<i32> = row.get(19)?;
            Ok(DeployTelemetryRunRow {
                id: row.get(0)?,
                console_session_id: row.get(1)?,
                app_slug: row.get(2)?,
                app_name: row.get(3)?,
                started_at: row.get(4)?,
                finished_at: row.get(5)?,
                wall_duration_sec: row.get(6)?,
                exit_code: row.get(7)?,
                engine_version: row.get(8)?,
                release_id: row.get(9)?,
                cache_posture: row.get(10)?,
                status: row.get(11)?,
                host_typecheck_sec: row.get(12)?,
                semver_bump_sec: row.get(13)?,
                build_total_sec: row.get(14)?,
                deps_stage_sec: row.get(15)?,
                deps_cache_hit: deps_hit_opt.map(|v| v != 0),
                next_build_sec: row.get(17)?,
                arm64_natives_sec: row.get(18)?,
                arm64_natives_cache_hit: arm64_hit_opt.map(|v| v != 0),
                export_tar_sec: row.get(20)?,
                context_transfer_kb: row.get(21)?,
                elf_verified_count: row.get(22)?,
                stage3_preflight_sec: row.get(23)?,
                stage4_upload_sec: row.get(24)?,
                stage5_snapshot_sec: row.get(25)?,
                stage5_swap_sec: row.get(26)?,
                stage5_verify_sec: row.get(27)?,
                stage5_smoke_sec: row.get(28)?,
                stage5_finalize_sec: row.get(29)?,
                stage5_cron_sec: row.get(30)?,
                stage5_manifest_sync_sec: row.get(31)?,
                bumped: row.get::<_, i32>(32)? != 0,
                ran_smoke: row.get::<_, i32>(33)? != 0,
                warnings,
                source: row.get(35)?,
            })
        })?;
        let mut out = Vec::new();
        for item in rows {
            out.push(item?);
        }
        Ok(out)
    }

    pub fn delete_setting(&self, key: &str) -> Result<()> {
        self.conn.execute("DELETE FROM app_settings WHERE key = ?1", params![key])?;
        Ok(())
    }

    pub fn purge_old_threat_runs(&self, days: i64) -> Result<()> {
        let modifier = format!("-{} days", days.max(1));
        self.conn.execute(
            "DELETE FROM threat_findings WHERE created_at < datetime('now', ?1)",
            params![modifier],
        )?;
        self.conn.execute(
            "DELETE FROM threat_audit_runs WHERE created_at < datetime('now', ?1)",
            params![modifier],
        )?;
        Ok(())
    }

    pub fn save_threat_audit_run(&self, run: &ThreatAuditRunRow) -> Result<()> {
        self.conn.execute(
            "INSERT INTO threat_audit_runs (
                id, started_at, completed_at, window_start, window_end, window_hours,
                trigger_source, status, overall_severity, intrusion_verdict,
                tier1_model, tier2_model, escalated_to_tier2, escalation_reasons_json,
                collector_statuses_json, zones_summary_json, zero_trust_summary_json,
                internal_summary_json, gemini_brief_json, token_usage_json, error_message
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14,
                ?15, ?16, ?17,
                ?18, ?19, ?20, ?21
            )
            ON CONFLICT(id) DO UPDATE SET
                completed_at = excluded.completed_at,
                status = excluded.status,
                overall_severity = excluded.overall_severity,
                intrusion_verdict = excluded.intrusion_verdict,
                tier1_model = excluded.tier1_model,
                tier2_model = excluded.tier2_model,
                escalated_to_tier2 = excluded.escalated_to_tier2,
                escalation_reasons_json = excluded.escalation_reasons_json,
                collector_statuses_json = excluded.collector_statuses_json,
                zones_summary_json = excluded.zones_summary_json,
                zero_trust_summary_json = excluded.zero_trust_summary_json,
                internal_summary_json = excluded.internal_summary_json,
                gemini_brief_json = excluded.gemini_brief_json,
                token_usage_json = excluded.token_usage_json,
                error_message = excluded.error_message",
            params![
                run.id,
                run.started_at,
                run.completed_at,
                run.window_start,
                run.window_end,
                run.window_hours as i64,
                run.trigger_source,
                run.status,
                run.overall_severity,
                run.intrusion_verdict,
                run.tier1_model,
                run.tier2_model,
                if run.escalated_to_tier2 { 1 } else { 0 },
                run.escalation_reasons_json,
                run.collector_statuses_json,
                run.zones_summary_json,
                run.zero_trust_summary_json,
                run.internal_summary_json,
                run.gemini_brief_json,
                run.token_usage_json,
                run.error_message,
            ],
        )?;
        Ok(())
    }

    fn map_threat_audit_run_row(row: &rusqlite::Row<'_>) -> Result<ThreatAuditRunRow> {
        let win_hrs: i64 = row.get(5)?;
        let esc_int: i32 = row.get(12)?;
        Ok(ThreatAuditRunRow {
            id: row.get(0)?,
            started_at: row.get(1)?,
            completed_at: row.get(2)?,
            window_start: row.get(3)?,
            window_end: row.get(4)?,
            window_hours: win_hrs.max(1) as u32,
            trigger_source: row.get(6)?,
            status: row.get(7)?,
            overall_severity: row.get(8)?,
            intrusion_verdict: row.get(9)?,
            tier1_model: row.get(10)?,
            tier2_model: row.get(11)?,
            escalated_to_tier2: esc_int != 0,
            escalation_reasons_json: row.get(13)?,
            collector_statuses_json: row.get(14)?,
            zones_summary_json: row.get(15)?,
            zero_trust_summary_json: row.get(16)?,
            internal_summary_json: row.get(17)?,
            gemini_brief_json: row.get(18)?,
            token_usage_json: row.get(19)?,
            error_message: row.get(20)?,
        })
    }

    pub fn list_threat_audit_runs(&self, limit: usize) -> Result<Vec<ThreatAuditRunRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT
                id, started_at, completed_at, window_start, window_end, window_hours,
                trigger_source, status, overall_severity, intrusion_verdict,
                tier1_model, tier2_model, escalated_to_tier2, escalation_reasons_json,
                collector_statuses_json, zones_summary_json, zero_trust_summary_json,
                internal_summary_json, gemini_brief_json, token_usage_json, error_message
             FROM threat_audit_runs
             ORDER BY datetime(started_at) DESC, started_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit.max(1) as i64], Self::map_threat_audit_run_row)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn get_threat_audit_run(&self, run_id: &str) -> Result<Option<ThreatAuditRunRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT
                id, started_at, completed_at, window_start, window_end, window_hours,
                trigger_source, status, overall_severity, intrusion_verdict,
                tier1_model, tier2_model, escalated_to_tier2, escalation_reasons_json,
                collector_statuses_json, zones_summary_json, zero_trust_summary_json,
                internal_summary_json, gemini_brief_json, token_usage_json, error_message
             FROM threat_audit_runs
             WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![run_id], Self::map_threat_audit_run_row)?;
        if let Some(first) = rows.next() {
            Ok(Some(first?))
        } else {
            Ok(None)
        }
    }

    pub fn get_latest_completed_threat_audit_at(&self) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT completed_at
             FROM threat_audit_runs
             WHERE completed_at IS NOT NULL AND status IN ('COMPLETED', 'DEGRADED')
             ORDER BY datetime(completed_at) DESC, completed_at DESC
             LIMIT 1",
        )?;
        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            Ok(row.get(0)?)
        } else {
            Ok(None)
        }
    }

    pub fn count_carbon_escalations_since(&self, since_iso: &str) -> Result<u32> {
        let Ok(since_dt) = chrono::DateTime::parse_from_rfc3339(since_iso) else {
            return Ok(0);
        };
        let since_utc = since_dt.with_timezone(&chrono::Utc);
        let mut stmt = self.conn.prepare(
            "SELECT started_at
             FROM threat_audit_runs
             WHERE escalated_to_tier2 = 1 AND trigger_source != 'manual'
             ORDER BY datetime(started_at) DESC
             LIMIT 100",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut count = 0u32;
        for item in rows {
            let ts = item?;
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&ts) {
                if dt.with_timezone(&chrono::Utc) >= since_utc {
                    count += 1;
                }
            }
        }
        Ok(count)
    }

    pub fn is_isolated_lan_text(text: &str) -> bool {
        let lower = text.to_ascii_lowercase();
        ["guest", "kid", "untrusted", "iot", "hotspot"]
            .iter()
            .any(|kw| lower.contains(kw))
    }

    pub fn replace_threat_findings_for_run(
        &self,
        run_id: &str,
        findings: &[ThreatFindingRow],
    ) -> Result<()> {
        self.conn.execute_batch("BEGIN IMMEDIATE;")?;
        let res = (|| -> Result<()> {
            self.conn
                .execute("DELETE FROM threat_findings WHERE run_id = ?1", params![run_id])?;
            let mut stmt = self.conn.prepare(
                "INSERT INTO threat_findings (
                    id, run_id, source_layer, rule_id, severity, category,
                    title, summary, host, actor_ip, actor_asn, ray_ids_json, evidence_json,
                    disposition, snoozed_until, resolved_at, resolution_note
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            )?;
            for f in findings {
                let disp = if f.disposition.trim().is_empty() {
                    "ACTIVE".to_string()
                } else {
                    f.disposition.trim().to_ascii_uppercase()
                };
                stmt.execute(params![
                    f.id,
                    run_id,
                    f.source_layer,
                    f.rule_id,
                    f.severity,
                    f.category,
                    f.title,
                    f.summary,
                    f.host,
                    f.actor_ip,
                    f.actor_asn,
                    f.ray_ids_json,
                    f.evidence_json,
                    disp,
                    f.snoozed_until,
                    f.resolved_at,
                    f.resolution_note,
                ])?;
            }
            Ok(())
        })();
        match res {
            Ok(_) => {
                self.conn.execute_batch("COMMIT;")?;
                Ok(())
            }
            Err(err) => {
                let _ = self.conn.execute_batch("ROLLBACK;");
                Err(err)
            }
        }
    }

    pub fn expire_due_snoozed_findings(&self, now_iso: &str) -> Result<usize> {
        let now_dt = chrono::DateTime::parse_from_rfc3339(now_iso.trim())
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .unwrap_or_else(|_| chrono::Utc::now());
        let mut stmt = self.conn.prepare(
            "SELECT id, snoozed_until FROM threat_findings WHERE UPPER(COALESCE(disposition, 'ACTIVE')) = 'SNOOZED'",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?;
        let mut to_wake = Vec::new();
        for r in rows {
            let (id, until_opt) = r?;
            let is_expired = match until_opt
                .as_deref()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s.trim()).ok())
            {
                Some(until_dt) => until_dt.with_timezone(&chrono::Utc) <= now_dt,
                None => true,
            };
            if is_expired {
                to_wake.push(id);
            }
        }
        drop(stmt);

        let mut updated = 0usize;
        for id in to_wake {
            updated += self.conn.execute(
                "UPDATE threat_findings SET disposition = 'ACTIVE', snoozed_until = NULL WHERE id = ?1",
                params![id],
            )?;
        }
        Ok(updated)
    }

    pub fn list_threat_findings_for_run(&self, run_id: &str) -> Result<Vec<ThreatFindingRow>> {
        let _ = self.expire_due_snoozed_findings(&chrono::Utc::now().to_rfc3339());
        let mut stmt = self.conn.prepare(
            "SELECT id, run_id, source_layer, rule_id, severity, category,
                    title, summary, host, actor_ip, actor_asn, ray_ids_json, evidence_json, created_at,
                    COALESCE(disposition, 'ACTIVE'), snoozed_until, resolved_at, resolution_note
             FROM threat_findings
             WHERE run_id = ?1
             ORDER BY CASE severity
                 WHEN 'CRITICAL' THEN 0
                 WHEN 'HIGH' THEN 1
                 WHEN 'MEDIUM' THEN 2
                 ELSE 3
             END, id ASC",
        )?;
        let rows = stmt.query_map(params![run_id], |row| {
            Ok(ThreatFindingRow {
                id: row.get(0)?,
                run_id: row.get(1)?,
                source_layer: row.get(2)?,
                rule_id: row.get(3)?,
                severity: row.get(4)?,
                category: row.get(5)?,
                title: row.get(6)?,
                summary: row.get(7)?,
                host: row.get(8)?,
                actor_ip: row.get(9)?,
                actor_asn: row.get(10)?,
                ray_ids_json: row.get(11)?,
                evidence_json: row.get(12)?,
                created_at: row.get(13)?,
                disposition: row.get(14)?,
                snoozed_until: row.get(15)?,
                resolved_at: row.get(16)?,
                resolution_note: row.get(17)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn get_threat_finding_by_id(&self, finding_id: &str) -> Result<Option<ThreatFindingRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, run_id, source_layer, rule_id, severity, category,
                    title, summary, host, actor_ip, actor_asn, ray_ids_json, evidence_json, created_at,
                    COALESCE(disposition, 'ACTIVE'), snoozed_until, resolved_at, resolution_note
             FROM threat_findings
             WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![finding_id])?;
        if let Some(row) = rows.next()? {
            return Ok(Some(ThreatFindingRow {
                id: row.get(0)?,
                run_id: row.get(1)?,
                source_layer: row.get(2)?,
                rule_id: row.get(3)?,
                severity: row.get(4)?,
                category: row.get(5)?,
                title: row.get(6)?,
                summary: row.get(7)?,
                host: row.get(8)?,
                actor_ip: row.get(9)?,
                actor_asn: row.get(10)?,
                ray_ids_json: row.get(11)?,
                evidence_json: row.get(12)?,
                created_at: row.get(13)?,
                disposition: row.get(14)?,
                snoozed_until: row.get(15)?,
                resolved_at: row.get(16)?,
                resolution_note: row.get(17)?,
            }));
        }
        Ok(None)
    }

    pub fn set_threat_finding_disposition(
        &self,
        finding_id: &str,
        disposition: &str,
        snoozed_until: Option<&str>,
        note: Option<&str>,
    ) -> Result<Option<ThreatFindingRow>> {
        let norm = match disposition.trim().to_ascii_uppercase().as_str() {
            "RESOLVED" => "RESOLVED",
            "SNOOZED" => "SNOOZED",
            "DISMISSED" => "DISMISSED",
            _ => "ACTIVE",
        };
        let clean_note = note
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        if norm == "SNOOZED" {
            self.conn.execute(
                "UPDATE threat_findings
                 SET disposition = 'SNOOZED',
                     snoozed_until = ?2,
                     resolved_at = NULL,
                     resolution_note = COALESCE(?3, resolution_note)
                 WHERE id = ?1",
                params![finding_id, snoozed_until, clean_note],
            )?;
        } else if norm == "RESOLVED" || norm == "DISMISSED" {
            let resolved_ts = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
            self.conn.execute(
                "UPDATE threat_findings
                 SET disposition = ?2,
                     snoozed_until = NULL,
                     resolved_at = ?3,
                     resolution_note = COALESCE(?4, resolution_note)
                 WHERE id = ?1",
                params![finding_id, norm, resolved_ts, clean_note],
            )?;
        } else {
            self.conn.execute(
                "UPDATE threat_findings
                 SET disposition = 'ACTIVE',
                     snoozed_until = NULL,
                     resolved_at = NULL,
                     resolution_note = NULL
                 WHERE id = ?1",
                params![finding_id],
            )?;
        }

        self.get_threat_finding_by_id(finding_id)
    }

    pub fn resolve_findings_by_ids(&self, finding_ids: &[String], note: &str) -> Result<usize> {
        if finding_ids.is_empty() {
            return Ok(0);
        }
        let resolved_ts = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let clean_note = note.trim();
        let mut updated = 0usize;
        for id in finding_ids {
            let trimmed = id.trim();
            if trimmed.is_empty() {
                continue;
            }
            updated += self.conn.execute(
                "UPDATE threat_findings
                 SET disposition = 'RESOLVED',
                     snoozed_until = NULL,
                     resolved_at = ?2,
                     resolution_note = CASE WHEN length(?3) > 0 THEN ?3 ELSE resolution_note END
                 WHERE id = ?1 AND UPPER(COALESCE(disposition, 'ACTIVE')) = 'ACTIVE'",
                params![trimmed, resolved_ts, clean_note],
            )?;
        }
        Ok(updated)
    }

    pub fn resolve_findings_for_mac(&self, mac: &str, note: &str) -> Result<usize> {
        let mac_norm = mac.trim().to_ascii_uppercase();
        if mac_norm.is_empty() {
            return Ok(0);
        }
        let mut stmt = self.conn.prepare(
            "SELECT id, summary, evidence_json
             FROM threat_findings
             WHERE rule_id = 'UNIFI_ROGUE_LAN_CLIENT'
               AND UPPER(COALESCE(disposition, 'ACTIVE')) = 'ACTIVE'",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        let mut ids = Vec::new();
        for r in rows {
            let (id, summary, ev) = r?;
            if ev.to_ascii_uppercase().contains(&mac_norm)
                || summary.to_ascii_uppercase().contains(&mac_norm)
            {
                ids.push(id);
            }
        }
        drop(stmt);
        self.resolve_findings_by_ids(&ids, note)
    }

    pub fn resolve_findings_for_allowlisted_mac(&self, mac: &str, note: &str) -> Result<usize> {
        let mac_norm = mac.trim().to_ascii_uppercase();
        if mac_norm.is_empty() {
            return Ok(0);
        }
        let mut stmt = self.conn.prepare(
            "SELECT id, summary, evidence_json
             FROM threat_findings
             WHERE rule_id IN ('UNIFI_ROGUE_LAN_CLIENT', 'UNIFI_CEF_IPS_ALERT', 'UNIFI_CEF_ADMIN_SSH_BURST')
               AND UPPER(COALESCE(disposition, 'ACTIVE')) = 'ACTIVE'",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        let mut ids = Vec::new();
        for r in rows {
            let (id, summary, ev) = r?;
            if ev.to_ascii_uppercase().contains(&mac_norm)
                || summary.to_ascii_uppercase().contains(&mac_norm)
            {
                ids.push(id);
            }
        }
        drop(stmt);
        self.resolve_findings_by_ids(&ids, note)
    }

    pub fn resolve_all_rogue_lan_findings(&self, note: &str) -> Result<usize> {
        let resolved_ts = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let updated = self.conn.execute(
            "UPDATE threat_findings
             SET disposition = 'RESOLVED',
                 snoozed_until = NULL,
                 resolved_at = ?1,
                 resolution_note = ?2
             WHERE rule_id = 'UNIFI_ROGUE_LAN_CLIENT'
               AND UPPER(COALESCE(disposition, 'ACTIVE')) = 'ACTIVE'",
            params![resolved_ts, note.trim()],
        )?;
        Ok(updated)
    }

    pub fn resolve_findings_for_allowlist(
        &self,
        entry_type: &str,
        value: &str,
        note: &str,
    ) -> Result<usize> {
        let norm_type = entry_type.trim().to_ascii_uppercase();
        let clean_val = value.trim();
        if clean_val.is_empty() {
            return Ok(0);
        }
        let resolved_ts = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        match norm_type.as_str() {
            "LAN_MAC" => self.resolve_findings_for_allowlisted_mac(clean_val, note),
            "IP" => {
                let updated = self.conn.execute(
                    "UPDATE threat_findings
                     SET disposition = 'RESOLVED',
                         snoozed_until = NULL,
                         resolved_at = ?2,
                         resolution_note = ?3
                     WHERE LOWER(COALESCE(actor_ip, '')) = LOWER(?1)
                       AND UPPER(COALESCE(disposition, 'ACTIVE')) = 'ACTIVE'",
                    params![clean_val, resolved_ts, note.trim()],
                )?;
                Ok(updated)
            }
            "ASN" => {
                let digits = clean_val
                    .to_ascii_uppercase()
                    .trim_start_matches("AS")
                    .trim()
                    .to_string();
                if digits.is_empty() {
                    return Ok(0);
                }
                let with_as = format!("AS{}", digits);
                let updated = self.conn.execute(
                    "UPDATE threat_findings
                     SET disposition = 'RESOLVED',
                         snoozed_until = NULL,
                         resolved_at = ?3,
                         resolution_note = ?4
                     WHERE (UPPER(COALESCE(actor_asn, '')) = ?1 OR UPPER(COALESCE(actor_asn, '')) = ?2)
                       AND UPPER(COALESCE(disposition, 'ACTIVE')) = 'ACTIVE'",
                    params![digits, with_as, resolved_ts, note.trim()],
                )?;
                Ok(updated)
            }
            "EMAIL" => {
                let email_lower = clean_val.to_ascii_lowercase();
                let mut stmt = self.conn.prepare(
                    "SELECT id, rule_id, actor_ip, summary, evidence_json
                     FROM threat_findings
                     WHERE rule_id IN ('CONTROL_PLANE_MUTATION', 'CONTROL_PLANE_ADMIN_CHANGE', 'ZT_UNEXPECTED_ACCESS', 'ORIGIN_BREACH_THROUGH')
                       AND UPPER(COALESCE(disposition, 'ACTIVE')) = 'ACTIVE'",
                )?;
                let rows = stmt.query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                })?;
                let mut ids = Vec::new();
                let mut origin_ips = Vec::new();
                for r in rows {
                    let (id, rule_id, actor_ip, summary, ev) = r?;
                    if ev.to_ascii_lowercase().contains(&email_lower)
                        || summary.to_ascii_lowercase().contains(&email_lower)
                    {
                        ids.push(id);
                        if rule_id == "ORIGIN_BREACH_THROUGH" {
                            if let Some(ip) = actor_ip {
                                let clean_ip = ip.trim().to_string();
                                if !clean_ip.is_empty() {
                                    origin_ips.push(clean_ip);
                                }
                            }
                        }
                    }
                }
                drop(stmt);
                for ip in origin_ips {
                    let _ = self.set_threat_actor_disposition(&ip, "RESOLVED");
                }
                self.resolve_findings_by_ids(&ids, note)
            }
            _ => Ok(0),
        }
    }

    pub fn allowlist_actors_by_asn(&self, asn: &str) -> Result<usize> {
        let digits = asn
            .trim()
            .to_ascii_uppercase()
            .trim_start_matches("AS")
            .trim()
            .to_string();
        if digits.is_empty() {
            return Ok(0);
        }
        let with_as = format!("AS{}", digits);
        let updated = self.conn.execute(
            "UPDATE threat_actors
             SET disposition = 'ALLOWLISTED', snoozed_until = NULL
             WHERE UPPER(COALESCE(asn, '')) = ?1 OR UPPER(COALESCE(asn, '')) = ?2",
            params![digits, with_as],
        )?;
        Ok(updated)
    }

    pub fn delete_benign_crawler_actors(&self) -> Result<usize> {
        let deleted = self.conn.execute(
            "DELETE FROM threat_actors
             WHERE UPPER(COALESCE(latest_classification, '')) = 'BENIGN_CRAWLER'
               AND total_origin_200s = 0",
            [],
        )?;
        Ok(deleted)
    }

    pub fn expire_stale_noise_actors(&self, now_iso: &str, max_age_days: i64) -> Result<usize> {
        let now_dt = chrono::DateTime::parse_from_rfc3339(now_iso.trim())
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .unwrap_or_else(|_| chrono::Utc::now());
        let cutoff = now_dt - chrono::Duration::days(max_age_days.max(1));

        let mut stmt = self.conn.prepare(
            "SELECT id, last_seen_at
             FROM threat_actors
             WHERE UPPER(COALESCE(disposition, 'ACTIVE')) = 'ACTIVE'
               AND UPPER(COALESCE(highest_severity, 'LOW')) IN ('LOW', 'MEDIUM')
               AND total_origin_200s = 0",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut to_expire = Vec::new();
        for r in rows {
            let (id, seen) = r?;
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(seen.trim()) {
                if dt.with_timezone(&chrono::Utc) <= cutoff {
                    to_expire.push(id);
                }
            }
        }
        drop(stmt);

        let mut updated = 0usize;
        for id in to_expire {
            updated += self.conn.execute(
                "UPDATE threat_actors
                 SET disposition = 'EXPIRED', snoozed_until = NULL
                 WHERE id = ?1",
                params![id],
            )?;
        }
        Ok(updated)
    }

    pub fn downgrade_isolated_zone_rogue_findings(&self) -> Result<usize> {
        let mut stmt = self.conn.prepare(
            "SELECT id, host, summary, evidence_json
             FROM threat_findings
             WHERE rule_id = 'UNIFI_ROGUE_LAN_CLIENT'
               AND UPPER(severity) != 'LOW'",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        let mut to_downgrade = Vec::new();
        for r in rows {
            let (id, host_opt, summary, ev) = r?;
            let host_str = host_opt.unwrap_or_default();
            if Self::is_isolated_lan_text(&host_str)
                || Self::is_isolated_lan_text(&summary)
                || Self::is_isolated_lan_text(&ev)
            {
                to_downgrade.push(id);
            }
        }
        drop(stmt);

        let mut updated = 0usize;
        for id in to_downgrade {
            updated += self.conn.execute(
                "UPDATE threat_findings SET severity = 'LOW' WHERE id = ?1",
                params![id],
            )?;
        }
        Ok(updated)
    }

    pub fn auto_resolve_already_trusted_rogue_findings(&self) -> Result<usize> {
        let mut stmt = self
            .conn
            .prepare("SELECT mac_address FROM lan_clients_baseline WHERE is_trusted = 1")?;
        let macs: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);

        let mut resolved = 0usize;
        for mac in macs {
            resolved += self.resolve_findings_for_mac(&mac, "Owner marked LAN device as trusted")?;
        }
        Ok(resolved)
    }

    pub fn resolve_legacy_unparsed_admin_ssh_cef_findings(&self) -> Result<usize> {
        let resolved_ts = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let updated = self.conn.execute(
            "UPDATE threat_findings
             SET disposition = 'RESOLVED',
                 snoozed_until = NULL,
                 resolved_at = ?1,
                 resolution_note = ?2
             WHERE rule_id = 'UNIFI_CEF_IPS_ALERT'
               AND UPPER(COALESCE(disposition, 'ACTIVE')) = 'ACTIVE'
               AND title LIKE '%Potential SSH Scan OUTBOUND%'
               AND summary LIKE 'src=None -> dst=Some(\"172.25.25.5\"):Some(\"22\")%'",
            params![
                resolved_ts,
                "Auto-resolved legacy unparsed admin SSH burst finding (superseded by CEF client correlation)"
            ],
        )?;
        Ok(updated)
    }

    pub fn run_threat_hygiene_pass(&self, now_iso: &str) -> Result<(usize, usize, usize)> {
        let benign_deleted = self.delete_benign_crawler_actors().unwrap_or(0);
        let expired_actors = self.expire_stale_noise_actors(now_iso, 7).unwrap_or(0);
        let downgraded = self.downgrade_isolated_zone_rogue_findings().unwrap_or(0);
        let _ = self.auto_resolve_already_trusted_rogue_findings();
        let _ = self.resolve_legacy_unparsed_admin_ssh_cef_findings();
        let _ = self.expire_due_snoozed_actors(now_iso);
        let _ = self.expire_due_snoozed_findings(now_iso);
        Ok((benign_deleted, expired_actors, downgraded))
    }

    fn severity_rank(sev: &str) -> u8 {
        match sev.trim().to_ascii_uppercase().as_str() {
            "CRITICAL" => 4,
            "HIGH" => 3,
            "MEDIUM" => 2,
            "LOW" => 1,
            _ => 0,
        }
    }

    fn merge_json_string_arrays(existing_json: &str, incoming_json: &str, cap: usize) -> String {
        let mut merged: Vec<String> = serde_json::from_str(existing_json).unwrap_or_default();
        let incoming: Vec<String> = serde_json::from_str(incoming_json).unwrap_or_default();
        for item in incoming {
            let trimmed = item.trim().to_string();
            if !trimmed.is_empty() && !merged.iter().any(|e| e == &trimmed) {
                merged.push(trimmed);
                if merged.len() >= cap {
                    break;
                }
            }
        }
        serde_json::to_string(&merged).unwrap_or_else(|_| "[]".to_string())
    }

    pub fn expire_due_snoozed_actors(&self, now_iso: &str) -> Result<usize> {
        let now_dt = chrono::DateTime::parse_from_rfc3339(now_iso.trim())
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .unwrap_or_else(|_| chrono::Utc::now());
        let mut stmt = self.conn.prepare(
            "SELECT id, snoozed_until FROM threat_actors WHERE disposition = 'SNOOZED'",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?;
        let mut to_wake = Vec::new();
        for r in rows {
            let (id, until_opt) = r?;
            let is_expired = match until_opt
                .as_deref()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s.trim()).ok())
            {
                Some(until_dt) => until_dt.with_timezone(&chrono::Utc) <= now_dt,
                None => true,
            };
            if is_expired {
                to_wake.push(id);
            }
        }
        drop(stmt);

        let mut updated = 0usize;
        for id in to_wake {
            updated += self.conn.execute(
                "UPDATE threat_actors SET disposition = 'ACTIVE', snoozed_until = NULL WHERE id = ?1",
                params![id],
            )?;
        }
        Ok(updated)
    }

    pub fn upsert_threat_actor(&self, actor: &ThreatActorRow) -> Result<()> {
        let mut existing_stmt = self.conn.prepare(
            "SELECT first_seen_at, runs_seen, total_requests, total_origin_200s, highest_severity,
                    intel_tags_json, target_hosts_json, sample_paths_json, disposition, snoozed_until
             FROM threat_actors WHERE id = ?1",
        )?;
        let existing_opt: Option<(String, i64, i64, i64, String, String, String, String, String, Option<String>)> =
            existing_stmt
                .query_row(params![actor.id], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                        row.get(9)?,
                    ))
                })
                .ok();
        drop(existing_stmt);

        if let Some((
            prev_first_seen,
            prev_runs,
            prev_reqs,
            prev_o200,
            prev_sev,
            prev_tags,
            prev_hosts,
            prev_paths,
            prev_disp,
            prev_snoozed_until,
        )) = existing_opt
        {
            let highest_severity =
                if Self::severity_rank(&actor.highest_severity) > Self::severity_rank(&prev_sev) {
                    actor.highest_severity.clone()
                } else {
                    prev_sev.clone()
                };
            let merged_tags = Self::merge_json_string_arrays(&prev_tags, &actor.intel_tags_json, 24);
            let merged_hosts = Self::merge_json_string_arrays(&prev_hosts, &actor.target_hosts_json, 24);
            let merged_paths = Self::merge_json_string_arrays(&prev_paths, &actor.sample_paths_json, 32);

            let (new_disp, new_snoozed) = if prev_disp == "ALLOWLISTED" {
                ("ALLOWLISTED".to_string(), None)
            } else if prev_disp == "SNOOZED" {
                let ref_now = chrono::DateTime::parse_from_rfc3339(actor.last_seen_at.trim())
                    .map(|dt| dt.with_timezone(&chrono::Utc))
                    .unwrap_or_else(|_| chrono::Utc::now());
                let still_snoozed = prev_snoozed_until
                    .as_deref()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s.trim()).ok())
                    .map(|u| u.with_timezone(&chrono::Utc) > ref_now)
                    .unwrap_or(false);
                if still_snoozed {
                    ("SNOOZED".to_string(), prev_snoozed_until)
                } else {
                    ("ACTIVE".to_string(), None)
                }
            } else if prev_disp == "EXPIRED" {
                ("ACTIVE".to_string(), None)
            } else if prev_disp == "RESOLVED"
                && Self::severity_rank(&actor.highest_severity) > Self::severity_rank(&prev_sev)
            {
                ("ACTIVE".to_string(), None)
            } else {
                (prev_disp, None)
            };

            self.conn.execute(
                "UPDATE threat_actors SET
                    ip_address = COALESCE(?2, ip_address),
                    asn = COALESCE(?3, asn),
                    as_org = COALESCE(?4, as_org),
                    country = COALESCE(?5, country),
                    intel_tags_json = ?6,
                    intel_summary = COALESCE(?7, intel_summary),
                    first_seen_at = ?8,
                    last_seen_at = ?9,
                    runs_seen = ?10,
                    total_requests = ?11,
                    total_origin_200s = ?12,
                    highest_severity = ?13,
                    latest_classification = COALESCE(?14, latest_classification),
                    target_hosts_json = ?15,
                    sample_paths_json = ?16,
                    disposition = ?17,
                    snoozed_until = ?18
                 WHERE id = ?1",
                params![
                    actor.id,
                    actor.ip_address,
                    actor.asn,
                    actor.as_org,
                    actor.country,
                    merged_tags,
                    actor.intel_summary,
                    prev_first_seen,
                    actor.last_seen_at,
                    prev_runs + 1,
                    prev_reqs + actor.total_requests as i64,
                    prev_o200 + actor.total_origin_200s as i64,
                    highest_severity,
                    actor.latest_classification,
                    merged_hosts,
                    merged_paths,
                    new_disp,
                    new_snoozed,
                ],
            )?;
        } else {
            self.conn.execute(
                "INSERT INTO threat_actors (
                    id, actor_type, ip_address, asn, as_org, country,
                    intel_tags_json, intel_summary, first_seen_at, last_seen_at,
                    runs_seen, total_requests, total_origin_200s, highest_severity,
                    latest_classification, target_hosts_json, sample_paths_json, disposition, snoozed_until
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
                params![
                    actor.id,
                    actor.actor_type,
                    actor.ip_address,
                    actor.asn,
                    actor.as_org,
                    actor.country,
                    actor.intel_tags_json,
                    actor.intel_summary,
                    actor.first_seen_at,
                    actor.last_seen_at,
                    actor.runs_seen.max(1) as i64,
                    actor.total_requests as i64,
                    actor.total_origin_200s as i64,
                    actor.highest_severity,
                    actor.latest_classification,
                    actor.target_hosts_json,
                    actor.sample_paths_json,
                    actor.disposition,
                    actor.snoozed_until,
                ],
            )?;
        }
        Ok(())
    }

    pub fn list_threat_actors(&self, disposition: Option<&str>) -> Result<Vec<ThreatActorRow>> {
        let _ = self.expire_due_snoozed_actors(&chrono::Utc::now().to_rfc3339());
        let mut sql = String::from(
            "SELECT id, actor_type, ip_address, asn, as_org, country,
                    intel_tags_json, intel_summary, first_seen_at, last_seen_at,
                    runs_seen, total_requests, total_origin_200s, highest_severity,
                    latest_classification, target_hosts_json, sample_paths_json, disposition, snoozed_until
             FROM threat_actors",
        );
        let filter_clean = disposition
            .map(|d| d.trim().to_ascii_uppercase())
            .filter(|d| !d.is_empty() && d != "ALL");
        if filter_clean.is_some() {
            sql.push_str(" WHERE disposition = ?1");
        }
        sql.push_str(
            " ORDER BY CASE highest_severity
                WHEN 'CRITICAL' THEN 0
                WHEN 'HIGH' THEN 1
                WHEN 'MEDIUM' THEN 2
                ELSE 3
              END, last_seen_at DESC LIMIT 500",
        );

        let mut stmt = self.conn.prepare(&sql)?;
        let map_row = |row: &rusqlite::Row<'_>| -> Result<ThreatActorRow> {
            Ok(ThreatActorRow {
                id: row.get(0)?,
                actor_type: row.get(1)?,
                ip_address: row.get(2)?,
                asn: row.get(3)?,
                as_org: row.get(4)?,
                country: row.get(5)?,
                intel_tags_json: row.get(6)?,
                intel_summary: row.get(7)?,
                first_seen_at: row.get(8)?,
                last_seen_at: row.get(9)?,
                runs_seen: row.get::<_, i64>(10)?.max(1) as u32,
                total_requests: row.get::<_, i64>(11)?.max(0) as u64,
                total_origin_200s: row.get::<_, i64>(12)?.max(0) as u64,
                highest_severity: row.get(13)?,
                latest_classification: row.get(14)?,
                target_hosts_json: row.get(15)?,
                sample_paths_json: row.get(16)?,
                disposition: row.get(17)?,
                snoozed_until: row.get(18)?,
            })
        };

        let mut out = Vec::new();
        if let Some(disp) = filter_clean {
            let rows = stmt.query_map(params![disp], map_row)?;
            for r in rows {
                out.push(r?);
            }
        } else {
            let rows = stmt.query_map([], map_row)?;
            for r in rows {
                out.push(r?);
            }
        }
        Ok(out)
    }

    pub fn set_threat_actor_disposition(&self, actor_id: &str, disposition: &str) -> Result<()> {
        let normalized = match disposition.trim().to_ascii_uppercase().as_str() {
            "ALLOWLISTED" => "ALLOWLISTED",
            "RESOLVED" => "RESOLVED",
            "SNOOZED" => "SNOOZED",
            "EXPIRED" => "EXPIRED",
            _ => "ACTIVE",
        };
        if normalized == "SNOOZED" {
            self.conn.execute(
                "UPDATE threat_actors SET disposition = 'SNOOZED' WHERE id = ?1",
                params![actor_id],
            )?;
        } else {
            self.conn.execute(
                "UPDATE threat_actors SET disposition = ?2, snoozed_until = NULL WHERE id = ?1",
                params![actor_id, normalized],
            )?;
        }
        Ok(())
    }

    pub fn snooze_threat_actor(&self, actor_id: &str, snoozed_until_iso: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE threat_actors SET disposition = 'SNOOZED', snoozed_until = ?2 WHERE id = ?1",
            params![actor_id, snoozed_until_iso],
        )?;
        Ok(())
    }

    pub fn upsert_lan_client(&self, client: &LanClientBaselineRow) -> Result<bool> {
        let mac_norm = client.mac_address.trim().to_ascii_uppercase();
        let exists: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM lan_clients_baseline WHERE mac_address = ?1)",
                params![mac_norm],
                |row| row.get::<_, i32>(0),
            )
            .map(|v| v != 0)?;

        if exists {
            self.conn.execute(
                "UPDATE lan_clients_baseline SET
                    ip_address = COALESCE(?2, ip_address),
                    hostname = COALESCE(?3, hostname),
                    network_vlan = COALESCE(?4, network_vlan),
                    oui_vendor = COALESCE(?5, oui_vendor),
                    last_seen_at = ?6
                 WHERE mac_address = ?1",
                params![
                    mac_norm,
                    client.ip_address,
                    client.hostname,
                    client.network_vlan,
                    client.oui_vendor,
                    client.last_seen_at,
                ],
            )?;
            Ok(false)
        } else {
            self.conn.execute(
                "INSERT INTO lan_clients_baseline (
                    mac_address, ip_address, hostname, network_vlan, oui_vendor,
                    first_seen_at, last_seen_at, is_trusted, label
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    mac_norm,
                    client.ip_address,
                    client.hostname,
                    client.network_vlan,
                    client.oui_vendor,
                    client.first_seen_at,
                    client.last_seen_at,
                    if client.is_trusted { 1 } else { 0 },
                    client.label,
                ],
            )?;
            Ok(true)
        }
    }

    pub fn list_lan_clients(&self) -> Result<Vec<LanClientBaselineRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT mac_address, ip_address, hostname, network_vlan, oui_vendor,
                    first_seen_at, last_seen_at, is_trusted, label
             FROM lan_clients_baseline
             ORDER BY is_trusted ASC, last_seen_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(LanClientBaselineRow {
                mac_address: row.get(0)?,
                ip_address: row.get(1)?,
                hostname: row.get(2)?,
                network_vlan: row.get(3)?,
                oui_vendor: row.get(4)?,
                first_seen_at: row.get(5)?,
                last_seen_at: row.get(6)?,
                is_trusted: row.get::<_, i32>(7)? != 0,
                label: row.get(8)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn count_lan_clients(&self) -> Result<usize> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM lan_clients_baseline", [], |row| row.get(0))?;
        Ok(count.max(0) as usize)
    }

    pub fn set_lan_client_trusted(
        &self,
        mac: &str,
        trusted: bool,
        label: Option<&str>,
    ) -> Result<()> {
        let mac_norm = mac.trim().to_ascii_uppercase();
        if let Some(lbl) = label {
            self.conn.execute(
                "UPDATE lan_clients_baseline SET is_trusted = ?2, label = ?3 WHERE mac_address = ?1",
                params![mac_norm, if trusted { 1 } else { 0 }, lbl.trim()],
            )?;
        } else {
            self.conn.execute(
                "UPDATE lan_clients_baseline SET is_trusted = ?2 WHERE mac_address = ?1",
                params![mac_norm, if trusted { 1 } else { 0 }],
            )?;
        }
        Ok(())
    }

    pub fn trust_all_lan_clients(&self) -> Result<usize> {
        let changed = self
            .conn
            .execute("UPDATE lan_clients_baseline SET is_trusted = 1 WHERE is_trusted = 0", [])?;
        Ok(changed)
    }

    pub fn list_threat_allowlist(&self) -> Result<Vec<ThreatAllowlistRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, entry_type, value, label, created_at
             FROM threat_allowlist
             ORDER BY entry_type ASC, value ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ThreatAllowlistRow {
                id: row.get(0)?,
                entry_type: row.get(1)?,
                value: row.get(2)?,
                label: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn upsert_threat_allowlist(
        &self,
        entry_type: &str,
        value: &str,
        label: &str,
    ) -> Result<ThreatAllowlistRow> {
        let norm_type = entry_type.trim().to_ascii_uppercase();
        let norm_val = if norm_type == "LAN_MAC" {
            value.trim().to_ascii_uppercase()
        } else if norm_type == "EMAIL" {
            value.trim().to_ascii_lowercase()
        } else {
            value.trim().to_string()
        };
        let id = uuid::Uuid::new_v4().to_string();
        self.conn.execute(
            "INSERT INTO threat_allowlist (id, entry_type, value, label)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(value) DO UPDATE SET
                entry_type = excluded.entry_type,
                label = CASE WHEN length(trim(excluded.label)) > 0 THEN excluded.label ELSE threat_allowlist.label END",
            params![id, norm_type, norm_val, label.trim()],
        )?;

        let mut stmt = self.conn.prepare(
            "SELECT id, entry_type, value, label, created_at FROM threat_allowlist WHERE value = ?1",
        )?;
        stmt.query_row(params![norm_val], |row| {
            Ok(ThreatAllowlistRow {
                id: row.get(0)?,
                entry_type: row.get(1)?,
                value: row.get(2)?,
                label: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
    }

    pub fn delete_threat_allowlist(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM threat_allowlist WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_quarantined_access_emails(&self) -> Result<Vec<QuarantinedAccessEmailRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT email, status, policy_grants_json, first_seen_at, last_seen_at, reviewed_at, removed_at, review_note
             FROM quarantined_access_emails
             ORDER BY CASE UPPER(status)
                        WHEN 'PENDING' THEN 0
                        WHEN 'REJECTED' THEN 1
                        WHEN 'APPROVED' THEN 2
                        ELSE 3
                      END,
                      email ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(QuarantinedAccessEmailRow {
                email: row.get(0)?,
                status: row.get(1)?,
                policy_grants_json: row.get(2)?,
                first_seen_at: row.get(3)?,
                last_seen_at: row.get(4)?,
                reviewed_at: row.get(5)?,
                removed_at: row.get(6)?,
                review_note: row.get(7)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    fn extract_policy_ids_and_names(grants_json: &str) -> Vec<(String, String)> {
        let Ok(serde_json::Value::Array(arr)) = serde_json::from_str::<serde_json::Value>(grants_json) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for item in arr {
            let pid = item
                .get("policyId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let pname = item
                .get("policyName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if !pid.is_empty() {
                out.push((pid, if pname.is_empty() { "Unnamed Policy".to_string() } else { pname }));
            }
        }
        out
    }

    pub fn reconcile_cf_access_policy_emails(
        &self,
        discovered: &[(String, String)],
        sync_ok: bool,
        now_iso: &str,
    ) -> Result<QuarantineReconcileOutcome> {
        let mut outcome = QuarantineReconcileOutcome::default();
        if !sync_ok && discovered.is_empty() {
            outcome.pending_all = self
                .list_quarantined_access_emails()?
                .into_iter()
                .filter(|r| r.status == "PENDING")
                .collect();
            return Ok(outcome);
        }

        let existing_rows = self.list_quarantined_access_emails()?;
        let mut existing_map: std::collections::HashMap<String, QuarantinedAccessEmailRow> =
            existing_rows
                .iter()
                .map(|r| (r.email.to_ascii_lowercase(), r.clone()))
                .collect();

        let existing_allowlist_emails: std::collections::HashSet<String> = self
            .list_threat_allowlist()?
            .into_iter()
            .filter(|r| r.entry_type.eq_ignore_ascii_case("EMAIL"))
            .map(|r| r.value.trim().to_ascii_lowercase())
            .collect();

        let mut known_active_policy_ids: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        for row in &existing_rows {
            if row.status != "REMOVED" {
                for (pid, _) in Self::extract_policy_ids_and_names(&row.policy_grants_json) {
                    known_active_policy_ids.insert(pid);
                }
            }
        }
        let had_prior_policies = !known_active_policy_ids.is_empty();
        let mut newly_seen_policy_ids: std::collections::HashSet<String> =
            std::collections::HashSet::new();

        let mut discovered_set: std::collections::HashSet<String> = std::collections::HashSet::new();
        for (raw_email, grants_json) in discovered {
            let email = raw_email.trim().to_ascii_lowercase();
            if email.is_empty() {
                continue;
            }
            discovered_set.insert(email.clone());

            if had_prior_policies {
                for (pid, pname) in Self::extract_policy_ids_and_names(grants_json) {
                    if !known_active_policy_ids.contains(&pid) && newly_seen_policy_ids.insert(pid) {
                        outcome.newly_attached_policy_names.push(pname);
                    }
                }
            }

            match existing_map.get(&email) {
                None => {
                    let already_allowed = existing_allowlist_emails.contains(&email);
                    let status = if already_allowed { "APPROVED" } else { "PENDING" };
                    let reviewed_at = if already_allowed { Some(now_iso.to_string()) } else { None };
                    let note = if already_allowed {
                        Some("Matched existing Zero Trust Email allowlist entry".to_string())
                    } else {
                        None
                    };
                    self.conn.execute(
                        "INSERT INTO quarantined_access_emails
                         (email, status, policy_grants_json, first_seen_at, last_seen_at, reviewed_at, removed_at, review_note)
                         VALUES (?1, ?2, ?3, ?4, ?4, ?5, NULL, ?6)",
                        params![email, status, grants_json, now_iso, reviewed_at, note],
                    )?;
                    if !already_allowed {
                        outcome.newly_quarantined.push(QuarantinedAccessEmailRow {
                            email: email.clone(),
                            status: "PENDING".to_string(),
                            policy_grants_json: grants_json.clone(),
                            first_seen_at: now_iso.to_string(),
                            last_seen_at: now_iso.to_string(),
                            reviewed_at: None,
                            removed_at: None,
                            review_note: None,
                        });
                    }
                }
                Some(prev) => {
                    if prev.status == "REMOVED" {
                        self.conn.execute(
                            "UPDATE quarantined_access_emails
                             SET status = 'PENDING',
                                 policy_grants_json = ?2,
                                 last_seen_at = ?3,
                                 reviewed_at = NULL,
                                 removed_at = NULL,
                                 review_note = 'Re-added to Cloudflare wsh Access policies'
                             WHERE email = ?1",
                            params![email, grants_json, now_iso],
                        )?;
                        outcome.newly_quarantined.push(QuarantinedAccessEmailRow {
                            email: email.clone(),
                            status: "PENDING".to_string(),
                            policy_grants_json: grants_json.clone(),
                            first_seen_at: prev.first_seen_at.clone(),
                            last_seen_at: now_iso.to_string(),
                            reviewed_at: None,
                            removed_at: None,
                            review_note: Some("Re-added to Cloudflare wsh Access policies".to_string()),
                        });
                    } else if prev.status == "APPROVED" && !existing_allowlist_emails.contains(&email) {
                        // Operator manually removed from threat_allowlist -> place back into PENDING quarantine
                        self.conn.execute(
                            "UPDATE quarantined_access_emails
                             SET status = 'PENDING',
                                 policy_grants_json = ?2,
                                 last_seen_at = ?3,
                                 reviewed_at = NULL,
                                 review_note = 'Re-queued after allowlist removal'
                             WHERE email = ?1",
                            params![email, grants_json, now_iso],
                        )?;
                        outcome.newly_quarantined.push(QuarantinedAccessEmailRow {
                            email: email.clone(),
                            status: "PENDING".to_string(),
                            policy_grants_json: grants_json.clone(),
                            first_seen_at: prev.first_seen_at.clone(),
                            last_seen_at: now_iso.to_string(),
                            reviewed_at: None,
                            removed_at: None,
                            review_note: Some("Re-queued after allowlist removal".to_string()),
                        });
                    } else {
                        self.conn.execute(
                            "UPDATE quarantined_access_emails
                             SET policy_grants_json = ?2,
                                 last_seen_at = ?3
                             WHERE email = ?1",
                            params![email, grants_json, now_iso],
                        )?;
                    }
                }
            }
            existing_map.remove(&email);
        }

        // Removal lifecycle: strictly gated on sync_ok == true so API outages never revoke access
        if sync_ok {
            for (_key, stale) in existing_map {
                if stale.status == "REMOVED" {
                    continue;
                }
                if stale.status == "APPROVED" {
                    self.conn.execute(
                        "DELETE FROM threat_allowlist
                         WHERE UPPER(entry_type) = 'EMAIL' AND LOWER(value) = LOWER(?1)",
                        params![stale.email],
                    )?;
                    self.conn.execute(
                        "UPDATE quarantined_access_emails
                         SET status = 'REMOVED',
                             removed_at = ?2,
                             review_note = 'Auto-revoked: removed from Cloudflare wsh Access policies'
                         WHERE email = ?1",
                        params![stale.email, now_iso],
                    )?;
                    outcome.auto_revoked.push(QuarantinedAccessEmailRow {
                        status: "REMOVED".to_string(),
                        removed_at: Some(now_iso.to_string()),
                        review_note: Some("Auto-revoked: removed from Cloudflare wsh Access policies".to_string()),
                        ..stale
                    });
                } else {
                    self.conn.execute(
                        "UPDATE quarantined_access_emails
                         SET status = 'REMOVED',
                             removed_at = ?2,
                             review_note = 'Cleared: removed from Cloudflare wsh Access policies'
                         WHERE email = ?1",
                        params![stale.email, now_iso],
                    )?;
                }
            }
        }

        outcome.pending_all = self
            .list_quarantined_access_emails()?
            .into_iter()
            .filter(|r| r.status == "PENDING")
            .collect();
        Ok(outcome)
    }

    pub fn approve_quarantined_access_email(
        &self,
        email: &str,
        label: Option<&str>,
        now_iso: &str,
    ) -> Result<QuarantinedAccessEmailRow> {
        let email_norm = email.trim().to_ascii_lowercase();
        let clean_label = label
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Approved Cloudflare wsh Access Email");

        let updated = self.conn.execute(
            "UPDATE quarantined_access_emails
             SET status = 'APPROVED',
                 reviewed_at = ?2,
                 removed_at = NULL,
                 review_note = ?3
             WHERE LOWER(email) = LOWER(?1)",
            params![email_norm, now_iso, clean_label],
        )?;
        if updated == 0 {
            self.conn.execute(
                "INSERT INTO quarantined_access_emails
                 (email, status, policy_grants_json, first_seen_at, last_seen_at, reviewed_at, removed_at, review_note)
                 VALUES (?1, 'APPROVED', '[]', ?2, ?2, ?2, NULL, ?3)",
                params![email_norm, now_iso, clean_label],
            )?;
        }

        self.upsert_threat_allowlist("EMAIL", &email_norm, clean_label)?;
        let _ = self.resolve_findings_for_allowlist(
            "EMAIL",
            &email_norm,
            "Approved via Zero Trust Quarantine",
        );

        let mut stmt = self.conn.prepare(
            "SELECT email, status, policy_grants_json, first_seen_at, last_seen_at, reviewed_at, removed_at, review_note
             FROM quarantined_access_emails WHERE LOWER(email) = LOWER(?1)",
        )?;
        stmt.query_row(params![email_norm], |row| {
            Ok(QuarantinedAccessEmailRow {
                email: row.get(0)?,
                status: row.get(1)?,
                policy_grants_json: row.get(2)?,
                first_seen_at: row.get(3)?,
                last_seen_at: row.get(4)?,
                reviewed_at: row.get(5)?,
                removed_at: row.get(6)?,
                review_note: row.get(7)?,
            })
        })
    }

    pub fn reject_quarantined_access_email(
        &self,
        email: &str,
        note: Option<&str>,
        now_iso: &str,
    ) -> Result<QuarantinedAccessEmailRow> {
        let email_norm = email.trim().to_ascii_lowercase();
        let clean_note = note
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Rejected by operator in Zero Trust Quarantine");

        self.conn.execute(
            "DELETE FROM threat_allowlist
             WHERE UPPER(entry_type) = 'EMAIL' AND LOWER(value) = LOWER(?1)",
            params![email_norm],
        )?;
        let updated = self.conn.execute(
            "UPDATE quarantined_access_emails
             SET status = 'REJECTED',
                 reviewed_at = ?2,
                 review_note = ?3
             WHERE LOWER(email) = LOWER(?1)",
            params![email_norm, now_iso, clean_note],
        )?;
        if updated == 0 {
            self.conn.execute(
                "INSERT INTO quarantined_access_emails
                 (email, status, policy_grants_json, first_seen_at, last_seen_at, reviewed_at, removed_at, review_note)
                 VALUES (?1, 'REJECTED', '[]', ?2, ?2, ?2, NULL, ?3)",
                params![email_norm, now_iso, clean_note],
            )?;
        }

        let mut stmt = self.conn.prepare(
            "SELECT email, status, policy_grants_json, first_seen_at, last_seen_at, reviewed_at, removed_at, review_note
             FROM quarantined_access_emails WHERE LOWER(email) = LOWER(?1)",
        )?;
        stmt.query_row(params![email_norm], |row| {
            Ok(QuarantinedAccessEmailRow {
                email: row.get(0)?,
                status: row.get(1)?,
                policy_grants_json: row.get(2)?,
                first_seen_at: row.get(3)?,
                last_seen_at: row.get(4)?,
                reviewed_at: row.get(5)?,
                removed_at: row.get(6)?,
                review_note: row.get(7)?,
            })
        })
    }

    pub fn get_cached_cf_ip_intel(&self, ip: &str, max_age_hours: i64) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT payload_json, fetched_at FROM cf_ip_intel_cache WHERE ip = ?1",
        )?;
        let mut rows = stmt.query(params![ip.trim()])?;
        if let Some(row) = rows.next()? {
            let payload: String = row.get(0)?;
            let fetched_at: String = row.get(1)?;
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&fetched_at) {
                let age = chrono::Utc::now() - dt.with_timezone(&chrono::Utc);
                if age.num_hours() < max_age_hours.max(1) {
                    return Ok(Some(payload));
                }
            }
        }
        Ok(None)
    }

    pub fn put_cached_cf_ip_intel(&self, ip: &str, payload_json: &str) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO cf_ip_intel_cache (ip, payload_json, fetched_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(ip) DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at",
            params![ip.trim(), payload_json, now],
        )?;
        Ok(())
    }

    pub fn list_waf_rule_overrides(&self) -> Result<Vec<WafRuleOverrideRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, zone_name, rule_name, action, expression, enabled, created_at
             FROM waf_rule_overrides
             ORDER BY zone_name ASC, created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(WafRuleOverrideRow {
                id: row.get(0)?,
                zone_name: row.get(1)?,
                rule_name: row.get(2)?,
                action: row.get(3)?,
                expression: row.get(4)?,
                enabled: row.get::<_, i32>(5)? != 0,
                created_at: row.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn upsert_waf_rule_override(
        &self,
        zone_name: &str,
        rule_name: &str,
        action: &str,
        expression: &str,
        enabled: bool,
    ) -> Result<WafRuleOverrideRow> {
        let clean_zone = zone_name.trim().to_ascii_lowercase();
        let clean_name = rule_name.trim().to_string();
        let clean_action = {
            let a = action.trim().to_ascii_lowercase();
            if a.is_empty() { "block".to_string() } else { a }
        };
        let clean_expr = expression.trim().to_string();
        let id = uuid::Uuid::new_v4().to_string();
        let enabled_int = if enabled { 1 } else { 0 };

        self.conn.execute(
            "INSERT INTO waf_rule_overrides (id, zone_name, rule_name, action, expression, enabled)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(zone_name, rule_name) DO UPDATE SET
                action = excluded.action,
                expression = excluded.expression,
                enabled = excluded.enabled",
            params![id, clean_zone, clean_name, clean_action, clean_expr, enabled_int],
        )?;

        let mut stmt = self.conn.prepare(
            "SELECT id, zone_name, rule_name, action, expression, enabled, created_at
             FROM waf_rule_overrides
             WHERE zone_name = ?1 AND rule_name = ?2",
        )?;
        stmt.query_row(params![clean_zone, clean_name], |row| {
            Ok(WafRuleOverrideRow {
                id: row.get(0)?,
                zone_name: row.get(1)?,
                rule_name: row.get(2)?,
                action: row.get(3)?,
                expression: row.get(4)?,
                enabled: row.get::<_, i32>(5)? != 0,
                created_at: row.get(6)?,
            })
        })
    }

    pub fn delete_waf_rule_override(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM waf_rule_overrides WHERE id = ?1", params![id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_console_session_scope_persistence_and_reconciliation() {
        let db = SreDatabase::new(":memory:").expect("init memory db");

        db.save_console_session(
            "deploy-auth-1",
            "Deploy: PanoramaAuth",
            &["line 1".to_string(), "line 2".to_string()],
            true,
            None,
            Some("releases"),
            Some("ui"),
        )
        .expect("save session");

        // Second save passing None for page_scope/source must preserve existing metadata
        db.save_console_session(
            "deploy-auth-1",
            "Deploy: PanoramaAuth",
            &["line 1".to_string(), "line 2".to_string(), "done".to_string()],
            false,
            Some(0),
            None,
            None,
        )
        .expect("update session");

        let rows = db.get_saved_console_sessions().expect("read sessions");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "deploy-auth-1");
        assert_eq!(rows[0].page_scope.as_deref(), Some("releases"));
        assert_eq!(rows[0].source.as_deref(), Some("ui"));
        assert!(!rows[0].is_running);
        assert_eq!(rows[0].exit_code, Some(0));
        assert_eq!(rows[0].lines.len(), 3);

        // Simulate stale running session and verify init_tables clears is_running
        db.save_console_session(
            "smoke-stale-2",
            "Stale Smoke",
            &["running...".to_string()],
            true,
            None,
            Some("smoke"),
            Some("mcp"),
        )
        .expect("save stale");
        db.init_tables().expect("re-run init_tables idempotently");
        let after = db.get_saved_console_sessions().expect("read after restart");
        let stale = after.iter().find(|r| r.id == "smoke-stale-2").unwrap();
        assert!(!stale.is_running);
    }

    #[test]
    fn test_parakith_opt_ins_cache_crud() {
        let db = SreDatabase::new(":memory:").expect("init memory db");
        let rows = vec![
            OptInCacheRow {
                id: 1,
                first_name: "Alex".into(),
                last_name: "Rivera".into(),
                phone: "+15552345678".into(),
                consent: "yes".into(),
                ip_address: "198.51.100.1".into(),
                user_agent: "Mozilla/5.0".into(),
                created_at: "2026-11-14T18:00:00.000Z".into(),
                synced_at: "2026-11-14T18:05:00Z".into(),
            },
            OptInCacheRow {
                id: 2,
                first_name: "Jordan".into(),
                last_name: "Lee".into(),
                phone: "+15559876543".into(),
                consent: "no".into(),
                ip_address: "198.51.100.2".into(),
                user_agent: "Mozilla/5.0".into(),
                created_at: "2026-11-14T19:00:00.000Z".into(),
                synced_at: "2026-11-14T19:05:00Z".into(),
            },
        ];

        db.replace_parakith_opt_ins(&rows).expect("replace cache");
        let loaded = db.get_parakith_opt_ins().expect("load cache");
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, 2);
        assert_eq!(loaded[1].first_name, "Alex");

        db.delete_parakith_opt_in_cache(1).expect("delete row 1");
        let remaining = db.get_parakith_opt_ins().expect("load after delete");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, 2);
    }

    #[test]
    fn test_pushover_alert_state_persistence_and_reset() {
        let db = SreDatabase::new(":memory:").expect("init memory db");

        assert!(db.get_pushover_alert_state("update:cloudflared").unwrap().is_none());

        db.upsert_pushover_alert_state(
            "update:cloudflared",
            "2026.11.0",
            true,
            1,
            Some("2026-11-18T05:00:00Z"),
        )
        .expect("insert state");

        let row = db
            .get_pushover_alert_state("update:cloudflared")
            .unwrap()
            .expect("row exists");
        assert_eq!(row.fingerprint, "2026.11.0");
        assert!(row.is_failing);
        assert_eq!(row.consecutive_count, 1);
        assert_eq!(row.last_notified_at.as_deref(), Some("2026-11-18T05:00:00Z"));

        // Subsequent update with None preserves last_notified_at
        db.upsert_pushover_alert_state("update:cloudflared", "up_to_date", false, 0, None)
            .expect("resolve state");
        let resolved = db
            .get_pushover_alert_state("update:cloudflared")
            .unwrap()
            .unwrap();
        assert_eq!(resolved.fingerprint, "up_to_date");
        assert!(!resolved.is_failing);
        assert_eq!(resolved.consecutive_count, 0);
        assert_eq!(
            resolved.last_notified_at.as_deref(),
            Some("2026-11-18T05:00:00Z")
        );

        db.clear_all_pushover_alert_states().expect("clear all");
        assert!(db.get_all_pushover_alert_states().unwrap().is_empty());
    }
}
