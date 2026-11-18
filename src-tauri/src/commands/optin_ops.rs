use crate::db::{OptInCacheRow, SreDatabase};
use chrono::{DateTime, Duration as ChronoDuration, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_notification::NotificationExt;

const SETTING_LAST_SEEN_ID: &str = "parakith_optin_last_seen_id";
const SETTING_HIGH_WATER_ID: &str = "parakith_optin_high_water_id";
const SETTING_LAST_SYNCED_AT: &str = "parakith_optin_last_synced_at";
const DEFAULT_D1_DATABASE_NAME: &str = "parakith-opt-ins";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParakithOptInRecord {
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
#[serde(rename_all = "camelCase")]
pub struct OptInComplianceSnapshot {
    pub records: Vec<ParakithOptInRecord>,
    pub total_count: usize,
    pub consented_count: usize,
    pub declined_count: usize,
    pub last_7d_count: usize,
    pub max_id: i64,
    pub last_seen_id: i64,
    pub unread_count: usize,
    pub last_synced_at: Option<String>,
    pub database_name: String,
    pub sync_error: Option<String>,
}

fn validate_d1_database_name(db_name: &str) -> Result<String, String> {
    let clean = db_name.trim().to_string();
    if clean.is_empty()
        || !clean
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("Invalid D1 database identifier '{}'", db_name));
    }
    Ok(clean)
}

fn extract_json_start(raw: &str) -> Option<&str> {
    let trimmed = raw.trim();
    if trimmed.starts_with('[') || trimmed.starts_with('{') {
        return Some(trimmed);
    }
    if let Some(idx) = trimmed.find('[') {
        return Some(&trimmed[idx..]);
    }
    trimmed.find('{').map(|idx| &trimmed[idx..])
}

fn parse_utc_timestamp(raw: &str) -> Option<DateTime<Utc>> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(t) {
        return Some(dt.with_timezone(&Utc));
    }
    if let Ok(naive) = NaiveDateTime::parse_from_str(t, "%Y-%m-%d %H:%M:%S") {
        return Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc));
    }
    None
}

/// Parses `npx wrangler d1 execute <db> --remote --json` stdout into normalized opt-in records.
pub fn parse_wrangler_d1_opt_ins_json(
    raw: &str,
    synced_at: &str,
) -> Result<Vec<ParakithOptInRecord>, String> {
    let json_slice = extract_json_start(raw)
        .ok_or_else(|| "Wrangler D1 output did not contain JSON".to_string())?;
    let parsed: Value = serde_json::from_str(json_slice)
        .map_err(|e| format!("Failed to parse Wrangler D1 JSON: {}", e))?;

    let results_val = if let Some(arr) = parsed.as_array() {
        arr.first()
            .and_then(|first| first.get("results"))
            .and_then(|r| r.as_array())
            .cloned()
            .unwrap_or_else(|| arr.clone())
    } else if let Some(arr) = parsed.get("results").and_then(|r| r.as_array()) {
        arr.clone()
    } else {
        return Err("Unexpected JSON shape returned from Wrangler D1 execute".to_string());
    };

    let mut out = Vec::with_capacity(results_val.len());
    for item in results_val {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let id = obj
            .get("id")
            .and_then(|v| v.as_i64())
            .or_else(|| obj.get("id").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()))
            .unwrap_or(0);
        if id <= 0 {
            continue;
        }
        let get_s = |key: &str| -> String {
            obj.get(key)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };

        out.push(ParakithOptInRecord {
            id,
            first_name: get_s("first_name"),
            last_name: get_s("last_name"),
            phone: get_s("phone"),
            consent: get_s("consent"),
            ip_address: get_s("ip_address"),
            user_agent: get_s("user_agent"),
            created_at: get_s("created_at"),
            synced_at: synced_at.to_string(),
        });
    }

    out.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(out)
}

pub fn build_snapshot_from_rows(
    records: Vec<ParakithOptInRecord>,
    last_seen_id: i64,
    last_synced_at: Option<String>,
    database_name: String,
    sync_error: Option<String>,
    now: DateTime<Utc>,
) -> OptInComplianceSnapshot {
    let total_count = records.len();
    let consented_count = records.iter().filter(|r| r.consent == "yes").count();
    let declined_count = records.iter().filter(|r| r.consent == "no").count();
    let cutoff = now - ChronoDuration::days(7);
    let last_7d_count = records
        .iter()
        .filter(|r| parse_utc_timestamp(&r.created_at).map(|dt| dt >= cutoff).unwrap_or(false))
        .count();
    let max_id = records.iter().map(|r| r.id).max().unwrap_or(0);
    let unread_count = records.iter().filter(|r| r.id > last_seen_id).count();

    OptInComplianceSnapshot {
        records,
        total_count,
        consented_count,
        declined_count,
        last_7d_count,
        max_id,
        last_seen_id,
        unread_count,
        last_synced_at,
        database_name,
        sync_error,
    }
}

fn cache_rows_to_records(rows: Vec<OptInCacheRow>) -> Vec<ParakithOptInRecord> {
    rows.into_iter()
        .map(|r| ParakithOptInRecord {
            id: r.id,
            first_name: r.first_name,
            last_name: r.last_name,
            phone: r.phone,
            consent: r.consent,
            ip_address: r.ip_address,
            user_agent: r.user_agent,
            created_at: r.created_at,
            synced_at: r.synced_at,
        })
        .collect()
}

pub fn read_cached_snapshot(
    db: &Arc<Mutex<SreDatabase>>,
    database_name: Option<&str>,
    sync_error: Option<String>,
) -> Result<OptInComplianceSnapshot, String> {
    let guard = db.lock().map_err(|e| format!("DB mutex poisoned: {}", e))?;
    let rows = guard
        .get_parakith_opt_ins()
        .map_err(|e| format!("Failed reading cached opt-ins: {}", e))?;
    let last_seen_id = guard
        .get_setting(SETTING_LAST_SEEN_ID)
        .ok()
        .flatten()
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    let last_synced_at = guard.get_setting(SETTING_LAST_SYNCED_AT).ok().flatten();
    let db_name = database_name
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_D1_DATABASE_NAME.to_string());

    Ok(build_snapshot_from_rows(
        cache_rows_to_records(rows),
        last_seen_id,
        last_synced_at,
        db_name,
        sync_error,
        Utc::now(),
    ))
}

fn run_wrangler_d1_command(workspace_path: &str, database_name: &str, sql: &str) -> Result<String, String> {
    #[cfg(windows)]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new("cmd.exe")
            .args([
                "/C",
                "npx",
                "wrangler",
                "d1",
                "execute",
                database_name,
                "--remote",
                "--json",
                "--command",
                sql,
            ])
            .current_dir(workspace_path)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
    };

    #[cfg(not(windows))]
    let output = Command::new("npx")
        .args([
            "wrangler",
            "d1",
            "execute",
            database_name,
            "--remote",
            "--json",
            "--command",
            sql,
        ])
        .current_dir(workspace_path)
        .output();

    let output = output.map_err(|e| format!("Failed to launch wrangler d1 execute: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let msg = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else {
            stdout.trim().to_string()
        };
        return Err(format!("Wrangler D1 query failed ({}): {}", output.status, msg));
    }
    Ok(stdout)
}

pub async fn sync_parakith_opt_ins_internal(
    app_handle: Option<&AppHandle>,
    db: &Arc<Mutex<SreDatabase>>,
    workspace_path: &str,
    database_name: &str,
    notify_on_new: bool,
) -> Result<OptInComplianceSnapshot, String> {
    let valid_db = validate_d1_database_name(database_name)?;
    let ws = workspace_path.trim().to_string();
    if ws.is_empty() || !Path::new(&ws).exists() {
        return Err(format!("ParakithSite workspace does not exist: {}", workspace_path));
    }

    let db_arg = valid_db.clone();
    let stdout = tokio::task::spawn_blocking(move || {
        run_wrangler_d1_command(
            &ws,
            &db_arg,
            "SELECT id, first_name, last_name, phone, consent, ip_address, user_agent, created_at FROM opt_ins ORDER BY id DESC",
        )
    })
    .await
    .map_err(|e| format!("D1 sync join error: {}", e))??;

    let synced_at = Utc::now().to_rfc3339();
    let records = parse_wrangler_d1_opt_ins_json(&stdout, &synced_at)?;
    let max_id = records.iter().map(|r| r.id).max().unwrap_or(0);

    let cache_rows: Vec<OptInCacheRow> = records
        .iter()
        .map(|r| OptInCacheRow {
            id: r.id,
            first_name: r.first_name.clone(),
            last_name: r.last_name.clone(),
            phone: r.phone.clone(),
            consent: r.consent.clone(),
            ip_address: r.ip_address.clone(),
            user_agent: r.user_agent.clone(),
            created_at: r.created_at.clone(),
            synced_at: r.synced_at.clone(),
        })
        .collect();

    let (newly_observed, last_seen_id) = {
        let guard = db.lock().map_err(|e| format!("DB mutex poisoned: {}", e))?;
        let prev_high_water = guard
            .get_setting(SETTING_HIGH_WATER_ID)
            .ok()
            .flatten()
            .and_then(|s| s.parse::<i64>().ok());
        let mut prev_seen_id = guard
            .get_setting(SETTING_LAST_SEEN_ID)
            .ok()
            .flatten()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);

        guard
            .replace_parakith_opt_ins(&cache_rows)
            .map_err(|e| format!("Failed caching opt-ins locally: {}", e))?;
        let _ = guard.set_setting(SETTING_LAST_SYNCED_AT, &synced_at);

        let mut new_records = Vec::new();
        match prev_high_water {
            None => {
                // First baseline sync: initialize both high-water and seen markers cleanly
                let _ = guard.set_setting(SETTING_HIGH_WATER_ID, &max_id.to_string());
                let _ = guard.set_setting(SETTING_LAST_SEEN_ID, &max_id.to_string());
                prev_seen_id = max_id;
            }
            Some(hw) if max_id > hw => {
                for rec in &records {
                    if rec.id > hw {
                        new_records.push(rec.clone());
                    }
                }
                let _ = guard.set_setting(SETTING_HIGH_WATER_ID, &max_id.to_string());
                for rec in new_records.iter().rev() {
                    let _ = guard.log_action(
                        "OPT_IN",
                        "INFO",
                        &format!(
                            "Parakith SMS Opt-In #{} recorded (consent: {})",
                            rec.id, rec.consent
                        ),
                        Some(&format!("database={}", valid_db)),
                    );
                }
            }
            _ => {}
        }

        (new_records, prev_seen_id)
    };

    if notify_on_new && !newly_observed.is_empty() {
        let latest = &newly_observed[0];
        crate::pushover::maybe_notify_parakith_opt_ins(
            db,
            newly_observed.len(),
            latest.id,
            &latest.consent,
        )
        .await;
        if let Some(app) = app_handle {
            let latest = &newly_observed[0];
            let body = if newly_observed.len() == 1 {
                format!(
                    "Parakith SMS Opt-In #{} recorded (consent: {})",
                    latest.id, latest.consent
                )
            } else {
                format!(
                    "{} new Parakith SMS Opt-In records received (latest #{} • consent: {})",
                    newly_observed.len(),
                    latest.id,
                    latest.consent
                )
            };
            let _ = app
                .notification()
                .builder()
                .title("Parakith D1 Opt-In Alert")
                .body(&body)
                .show();
            let _ = app.emit(
                "sre://parakith-opt-in",
                serde_json::json!({
                    "count": newly_observed.len(),
                    "latestId": latest.id,
                    "consent": latest.consent,
                    "syncedAt": synced_at,
                }),
            );
        }
    }

    Ok(build_snapshot_from_rows(
        records,
        last_seen_id,
        Some(synced_at),
        valid_db,
        None,
        Utc::now(),
    ))
}

fn escape_csv_cell(val: &str) -> String {
    if val.contains(',') || val.contains('"') || val.contains('\n') || val.contains('\r') {
        format!("\"{}\"", val.replace('"', "\"\""))
    } else {
        val.to_string()
    }
}

pub fn format_opt_ins_csv(records: &[ParakithOptInRecord]) -> String {
    let mut lines = Vec::with_capacity(records.len() + 1);
    lines.push("id,first_name,last_name,phone,consent,ip_address,user_agent,created_at".to_string());
    for r in records {
        lines.push(format!(
            "{},{},{},{},{},{},{},{}",
            r.id,
            escape_csv_cell(&r.first_name),
            escape_csv_cell(&r.last_name),
            escape_csv_cell(&r.phone),
            escape_csv_cell(&r.consent),
            escape_csv_cell(&r.ip_address),
            escape_csv_cell(&r.user_agent),
            escape_csv_cell(&r.created_at),
        ));
    }
    lines.join("\n")
}

/// Scrub subscriber phone number for MCP agent telemetry channels.
pub fn mask_phone_number(phone: &str) -> String {
    let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() >= 4 {
        let last4 = &digits[digits.len() - 4..];
        format!("***-***-{}", last4)
    } else {
        "***".to_string()
    }
}

#[tauri::command]
pub async fn get_cached_parakith_opt_ins(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    database_name: Option<String>,
) -> Result<OptInComplianceSnapshot, String> {
    read_cached_snapshot(&db, database_name.as_deref(), None)
}

#[tauri::command]
pub async fn sync_parakith_opt_ins(
    app: AppHandle,
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    workspace_path: String,
    database_name: Option<String>,
    notify_on_new: Option<bool>,
) -> Result<OptInComplianceSnapshot, String> {
    let db_name = database_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_D1_DATABASE_NAME.to_string());
    sync_parakith_opt_ins_internal(
        Some(&app),
        &db,
        &workspace_path,
        &db_name,
        notify_on_new.unwrap_or(true),
    )
    .await
}

#[tauri::command]
pub async fn mark_parakith_opt_ins_seen(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
) -> Result<(), String> {
    let guard = db.lock().map_err(|e| format!("DB mutex poisoned: {}", e))?;
    let rows = guard
        .get_parakith_opt_ins()
        .map_err(|e| format!("Failed reading cached opt-ins: {}", e))?;
    let max_id = rows.iter().map(|r| r.id).max().unwrap_or(0);
    guard
        .set_setting(SETTING_LAST_SEEN_ID, &max_id.to_string())
        .map_err(|e| format!("Failed updating last_seen_id: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn export_parakith_opt_ins(
    records: Vec<ParakithOptInRecord>,
    format: String,
    target_path: String,
) -> Result<usize, String> {
    let clean_path = target_path.trim();
    if clean_path.is_empty() {
        return Err("Export target path cannot be empty".to_string());
    }
    let content = match format.trim().to_ascii_lowercase().as_str() {
        "csv" => format_opt_ins_csv(&records),
        "json" => serde_json::to_string_pretty(&records)
            .map_err(|e| format!("Failed serializing JSON export: {}", e))?,
        other => return Err(format!("Unsupported export format '{}'", other)),
    };
    fs::write(clean_path, content).map_err(|e| format!("Failed writing export file: {}", e))?;
    Ok(records.len())
}

#[tauri::command]
pub async fn delete_parakith_opt_in(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    workspace_path: String,
    database_name: Option<String>,
    record_id: i64,
) -> Result<OptInComplianceSnapshot, String> {
    if record_id <= 0 {
        return Err("Invalid opt-in record ID".to_string());
    }
    let db_name = validate_d1_database_name(
        database_name
            .as_deref()
            .unwrap_or(DEFAULT_D1_DATABASE_NAME),
    )?;
    let ws = workspace_path.trim().to_string();
    if ws.is_empty() || !Path::new(&ws).exists() {
        return Err(format!("ParakithSite workspace does not exist: {}", workspace_path));
    }

    let db_for_exec = db_name.clone();
    tokio::task::spawn_blocking(move || {
        let sql = format!("DELETE FROM opt_ins WHERE id = {}", record_id);
        run_wrangler_d1_command(&ws, &db_for_exec, &sql)
    })
    .await
    .map_err(|e| format!("D1 delete join error: {}", e))??;

    {
        let guard = db.lock().map_err(|e| format!("DB mutex poisoned: {}", e))?;
        guard
            .delete_parakith_opt_in_cache(record_id)
            .map_err(|e| format!("Failed removing row from cache: {}", e))?;
        let _ = guard.log_action(
            "OPT_IN",
            "WARN",
            &format!("Deleted Parakith D1 opt-in record #{} via audited compliance action", record_id),
            Some(&format!("database={}", db_name)),
        );
    }

    read_cached_snapshot(&db, Some(&db_name), None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wrangler_d1_envelope_and_computes_snapshot_kpis() {
        let raw = r#"
        WARNING: Notice banner before JSON
        [
          {
            "results": [
              {
                "id": 2,
                "first_name": "Alex",
                "last_name": "Rivera",
                "phone": "555-234-5678",
                "consent": "yes",
                "ip_address": "198.51.100.1",
                "user_agent": "Mozilla/5.0",
                "created_at": "2026-11-14T20:00:00.000Z"
              },
              {
                "id": 1,
                "first_name": "Jordan",
                "last_name": "Lee",
                "phone": "+15550001111",
                "consent": "no",
                "ip_address": "198.51.100.2",
                "user_agent": "Safari",
                "created_at": "2026-10-01T10:00:00.000Z"
              }
            ],
            "success": true
          }
        ]
        "#;

        let rows = parse_wrangler_d1_opt_ins_json(raw, "2026-11-14T21:00:00Z").expect("parse d1");
        assert_eq!(rows.len(), 2);
        let now = DateTime::parse_from_rfc3339("2026-11-15T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let snap = build_snapshot_from_rows(
            rows,
            1,
            Some("2026-11-14T21:00:00Z".into()),
            "parakith-opt-ins".into(),
            None,
            now,
        );
        assert_eq!(snap.total_count, 2);
        assert_eq!(snap.consented_count, 1);
        assert_eq!(snap.declined_count, 1);
        assert_eq!(snap.last_7d_count, 1);
        assert_eq!(snap.max_id, 2);
        assert_eq!(snap.unread_count, 1);
    }

    #[test]
    fn formats_rfc4180_csv_and_masks_phone_numbers() {
        let recs = vec![ParakithOptInRecord {
            id: 7,
            first_name: "Alex".into(),
            last_name: "O\"Connor, Jr.".into(),
            phone: "(555) 234-5678".into(),
            consent: "yes".into(),
            ip_address: "198.51.100.42".into(),
            user_agent: "Chrome, Win11".into(),
            created_at: "2026-11-14T20:00:00Z".into(),
            synced_at: "2026-11-14T20:05:00Z".into(),
        }];
        let csv = format_opt_ins_csv(&recs);
        assert!(csv.contains("\"O\"\"Connor, Jr.\""));
        assert!(csv.contains("\"Chrome, Win11\""));
        assert_eq!(mask_phone_number("(555) 234-5678"), "***-***-5678");
    }
}
