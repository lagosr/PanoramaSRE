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
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );"
        )?;

        // Auto-purge console sessions and system logs older than 28 days
        self.purge_old_entries(28).ok();

        Ok(())
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

    pub fn save_console_session(&self, id: &str, title: &str, lines: &[String], is_running: bool, exit_code: Option<i32>) -> Result<()> {
        let lines_json = serde_json::to_string(lines).unwrap_or_else(|_| "[]".to_string());
        self.conn.execute(
            "INSERT INTO console_sessions (id, title, lines_json, is_running, exit_code, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                lines_json = excluded.lines_json,
                is_running = excluded.is_running,
                exit_code = excluded.exit_code,
                updated_at = CURRENT_TIMESTAMP",
            params![id, title, lines_json, if is_running { 1 } else { 0 }, exit_code],
        )?;
        Ok(())
    }

    pub fn get_saved_console_sessions(&self) -> Result<Vec<(String, String, Vec<String>, bool, Option<i32>, Option<String>, Option<String>)>> {
        // Auto-purge > 28 days first
        let _ = self.purge_old_entries(28);

        let mut stmt = self.conn.prepare(
            "SELECT id, title, lines_json, is_running, exit_code, created_at, updated_at FROM console_sessions ORDER BY datetime(COALESCE(updated_at, created_at)) DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let title: String = row.get(1)?;
            let lines_raw: String = row.get(2)?;
            let is_running_int: i32 = row.get(3)?;
            let exit_code: Option<i32> = row.get(4)?;
            let created_at: Option<String> = row.get(5)?;
            let updated_at: Option<String> = row.get(6)?;
            let lines: Vec<String> = serde_json::from_str(&lines_raw).unwrap_or_default();
            Ok((id, title, lines, is_running_int == 1, exit_code, created_at, updated_at))
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
}
