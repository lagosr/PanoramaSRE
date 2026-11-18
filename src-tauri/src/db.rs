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

pub struct SreDatabase {
    conn: Connection,
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

        let db = SreDatabase { conn, log_file_path };
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

        // Reconcile any stale running flags left over from prior terminated app runs
        self.conn.execute("UPDATE console_sessions SET is_running = 0 WHERE is_running = 1", [])?;

        // Auto-purge console sessions and system logs older than 28 days
        self.purge_old_entries(28).ok();

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
