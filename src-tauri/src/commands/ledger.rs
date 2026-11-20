use chrono::{TimeZone, Timelike};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

const DEFAULT_WORKSPACE_ROOT: &str = "C:\\Users\\rodrigo\\Documents\\AG Projects";
const DEFAULT_BACKUPS_ROOT: &str = "D:\\Google\\My Drive\\HomeApplicationData\\DatabaseBackups";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppBackupDetail {
    pub app_name: String,
    pub status: String,
    pub file: Option<String>,
    pub size_bytes: Option<u64>,
    pub duration_seconds: Option<f64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupRecord {
    pub timestamp: String,
    pub status: String, // "Success" | "Failed"
    pub run_type: Option<String>,
    pub total_apps: u32,
    pub total_size_bytes: Option<u64>,
    pub destination: String,
    pub app_details: Vec<AppBackupDetail>,
    pub pruned_files: HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayBackupStatus {
    pub date: String,       // YYYY-MM-DD
    pub day_label: String,  // "Mon", "Tue", etc.
    pub status: String,     // "Success" | "Failed" | "NoRun"
    pub run_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupLedgerSummary {
    pub history_file_exists: bool,
    pub ledger_source_path: String,
    pub total_runs: usize,
    pub successful_runs: usize,
    pub failed_runs: usize,
    pub runs_7d: usize,
    pub successful_runs_7d: usize,
    pub failed_runs_7d: usize,
    pub daily_pips_7d: Vec<DayBackupStatus>,
    pub total_pruned_count: usize,
    pub pruned_per_app: HashMap<String, usize>,
    pub last_run_timestamp: Option<String>,
    pub last_run_status: Option<String>,
    pub latest_app_details: Vec<AppBackupDetail>,
    pub recent_records: Vec<BackupRecord>,
}

fn is_safe_app_segment(app_name: &str) -> bool {
    !app_name.is_empty()
        && !app_name.contains("..")
        && !app_name.contains('/')
        && !app_name.contains('\\')
}

fn resolve_app_backup_dir(
    app_name: &str,
    workspace_root: &Path,
    backups_root: &Path,
) -> Option<PathBuf> {
    if !is_safe_app_segment(app_name) {
        return None;
    }

    let env_deploy = workspace_root.join(app_name).join(".env.deploy");
    if env_deploy.exists() {
        if let Ok(content) = fs::read_to_string(&env_deploy) {
            for line in content.lines() {
                if let Some(rest) = line.trim().strip_prefix("LOCAL_BACKUP_DIR=") {
                    let candidate_str = rest.trim().trim_matches('"').trim_matches('\'');
                    if !candidate_str.is_empty() {
                        let candidate = PathBuf::from(candidate_str);
                        if candidate.exists() {
                            return Some(candidate);
                        }
                    }
                }
            }
        }
    }

    let fallback = backups_root.join(app_name);
    if fallback.exists() {
        Some(fallback)
    } else {
        None
    }
}

fn parse_archive_utc_timestamp(path: &Path) -> Option<chrono::DateTime<chrono::Utc>> {
    if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
        if let Some(stem) = file_name.strip_suffix(".tar.gz") {
            let parts: Vec<&str> = stem.split('_').collect();
            if parts.len() >= 4 && parts[0] == "db-backup" {
                let naive_str = format!("{} {}", parts[2], parts[3].replace('-', ":"));
                if let Ok(naive_dt) =
                    chrono::NaiveDateTime::parse_from_str(&naive_str, "%Y-%m-%d %H:%M:%S")
                {
                    if let Some(local_dt) = chrono::Local.from_local_datetime(&naive_dt).earliest()
                    {
                        return Some(local_dt.with_timezone(&chrono::Utc));
                    }
                }
            }
        }
    }

    fs::metadata(path)
        .ok()?
        .modified()
        .ok()
        .map(chrono::DateTime::<chrono::Utc>::from)
}

fn is_valid_gzip_archive(path: &Path) -> bool {
    let Ok(meta) = fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() || meta.len() < 2 {
        return false;
    }
    let Ok(mut file) = File::open(path) else {
        return false;
    };
    let mut magic = [0u8; 2];
    file.read_exact(&mut magic).is_ok() && magic == [0x1f, 0x8b]
}

fn find_newer_manual_snapshot(
    app_name: &str,
    since_utc: chrono::DateTime<chrono::Utc>,
    workspace_root: &Path,
    backups_root: &Path,
) -> Option<(String, u64, chrono::DateTime<chrono::Utc>)> {
    let backup_dir = resolve_app_backup_dir(app_name, workspace_root, backups_root)?;
    let entries = fs::read_dir(&backup_dir).ok()?;
    let mut best: Option<(String, u64, chrono::DateTime<chrono::Utc>)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !file_name.starts_with("db-backup_") || !file_name.ends_with(".tar.gz") {
            continue;
        }
        if !is_valid_gzip_archive(&path) {
            continue;
        }
        let Some(archive_utc) = parse_archive_utc_timestamp(&path) else {
            continue;
        };
        if archive_utc <= since_utc {
            continue;
        }
        let size_bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let replace = match &best {
            None => true,
            Some((prev_name, _, prev_utc)) => {
                (archive_utc, file_name) > (*prev_utc, prev_name.as_str())
            }
        };
        if replace {
            best = Some((file_name.to_string(), size_bytes, archive_utc));
        }
    }

    best
}

fn parse_record_utc(ts: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

#[tauri::command]
pub async fn read_backup_ledger(custom_path: Option<String>) -> Result<BackupLedgerSummary, String> {
    tokio::task::spawn_blocking(move || {
        let candidate_paths = if let Some(p) = custom_path {
            vec![p]
        } else {
            vec![
                "C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaDrSuite\\tools\\backup-manager\\backup_history.json".to_string(),
                "D:\\Google\\My Drive\\HomeApplicationData\\DatabaseBackups\\backup_history.json".to_string(),
            ]
        };

        let mut resolved_path: Option<String> = None;
        for p in &candidate_paths {
            if Path::new(p).exists() {
                resolved_path = Some(p.clone());
                break;
            }
        }

        let path_str = match resolved_path {
            Some(p) => p,
            None => {
                return Ok(BackupLedgerSummary {
                    history_file_exists: false,
                    ledger_source_path: candidate_paths.first().cloned().unwrap_or_default(),
                    total_runs: 0,
                    successful_runs: 0,
                    failed_runs: 0,
                    runs_7d: 0,
                    successful_runs_7d: 0,
                    failed_runs_7d: 0,
                    daily_pips_7d: vec![],
                    total_pruned_count: 0,
                    pruned_per_app: HashMap::new(),
                    last_run_timestamp: None,
                    last_run_status: None,
                    latest_app_details: vec![],
                    recent_records: vec![],
                });
            }
        };

        read_backup_ledger_from_paths(
            Path::new(&path_str),
            Path::new(DEFAULT_WORKSPACE_ROOT),
            Path::new(DEFAULT_BACKUPS_ROOT),
            chrono::Local::now(),
        )
    })
    .await
    .map_err(|e| format!("Join error: {}", e))?
}

pub fn read_backup_ledger_from_paths(
    history_path: &Path,
    workspace_root: &Path,
    backups_root: &Path,
    now_local: chrono::DateTime<chrono::Local>,
) -> Result<BackupLedgerSummary, String> {
    if !history_path.exists() {
        return Ok(BackupLedgerSummary {
            history_file_exists: false,
            ledger_source_path: history_path.to_string_lossy().to_string(),
            total_runs: 0,
            successful_runs: 0,
            failed_runs: 0,
            runs_7d: 0,
            successful_runs_7d: 0,
            failed_runs_7d: 0,
            daily_pips_7d: vec![],
            total_pruned_count: 0,
            pruned_per_app: HashMap::new(),
            last_run_timestamp: None,
            last_run_status: None,
            latest_app_details: vec![],
            recent_records: vec![],
        });
    }

    let raw = fs::read_to_string(history_path)
        .map_err(|e| format!("Failed to read backup ledger: {}", e))?;
    let clean = raw.trim_start_matches('\u{feff}');

    let records: Vec<serde_json::Value> = serde_json::from_str(clean).unwrap_or_else(|_| vec![]);

    let total_runs = records.len();
    let mut successful_runs = 0;
    let mut failed_runs = 0;
    let mut parsed: Vec<BackupRecord> = Vec::new();

    for r in records.iter().rev() {
        let status_raw = r["status"].as_str().unwrap_or("Unknown");
        let is_success = status_raw.eq_ignore_ascii_case("success");
        if is_success {
            successful_runs += 1;
        } else {
            failed_runs += 1;
        }

        // Parse per-application details
        let mut app_details = Vec::new();
        let mut calculated_total_size: u64 = 0;

        if let Some(apps_map) = r["apps"].as_object() {
            for (app_name, info) in apps_map {
                let size = info["size_bytes"].as_u64();
                if let Some(s) = size {
                    calculated_total_size += s;
                }
                app_details.push(AppBackupDetail {
                    app_name: app_name.clone(),
                    status: info["status"].as_str().unwrap_or("Unknown").to_string(),
                    file: info["file"].as_str().map(|s| s.to_string()),
                    size_bytes: size,
                    duration_seconds: info["duration_seconds"].as_f64(),
                    error: info["error"].as_str().map(|s| s.to_string()),
                });
            }
        }

        // Sort app details alphabetically
        app_details.sort_by(|a, b| a.app_name.cmp(&b.app_name));

        // Parse pruning
        let mut pruned_files: HashMap<String, Vec<String>> = HashMap::new();
        if let Some(pruning_map) = r["pruning"].as_object() {
            for (app_name, pinfo) in pruning_map {
                if let Some(del_arr) = pinfo["deleted"].as_array() {
                    let dels: Vec<String> = del_arr
                        .iter()
                        .filter_map(|d| d.as_str().map(|s| s.to_string()))
                        .collect();
                    if !dels.is_empty() {
                        pruned_files.insert(app_name.clone(), dels);
                    }
                }
            }
        }

        let explicit_size = r["total_size_bytes"].as_u64();
        let final_size = explicit_size.or(if calculated_total_size > 0 {
            Some(calculated_total_size)
        } else {
            None
        });

        let apps_count = if !app_details.is_empty() {
            app_details.len() as u32
        } else {
            r["apps_backed_up"].as_u64().unwrap_or(0) as u32
        };

        if parsed.len() < 50 {
            parsed.push(BackupRecord {
                timestamp: r["timestamp"].as_str().unwrap_or("").to_string(),
                status: if is_success {
                    "Success".into()
                } else {
                    "Failed".into()
                },
                run_type: r["run_type"].as_str().map(|s| s.to_string()),
                total_apps: apps_count,
                total_size_bytes: final_size,
                destination: r["destination"]
                    .as_str()
                    .unwrap_or("Google Drive DatabaseBackups")
                    .to_string(),
                app_details,
                pruned_files,
            });
        }
    }

    let mut latest_app_details = parsed
        .first()
        .map(|r| r.app_details.clone())
        .unwrap_or_default();
    let mut effective_last_run_timestamp = parsed.first().map(|r| r.timestamp.clone());
    let mut effective_last_run_status = parsed.first().map(|r| r.status.clone());
    let mut effective_records = records.clone();

    if let Some(last_run_utc) = effective_last_run_timestamp
        .as_deref()
        .and_then(parse_record_utc)
    {
        let mut manual_snapshot_details: Vec<AppBackupDetail> = Vec::new();
        let mut latest_manual_utc: Option<chrono::DateTime<chrono::Utc>> = None;

        for detail in &mut latest_app_details {
            if let Some((file_name, size_bytes, archive_utc)) = find_newer_manual_snapshot(
                &detail.app_name,
                last_run_utc,
                workspace_root,
                backups_root,
            ) {
                detail.file = Some(file_name.clone());
                detail.size_bytes = Some(size_bytes);
                if detail.status.eq_ignore_ascii_case("failed") {
                    detail.status = "Success".to_string();
                    detail.error = None;
                    detail.duration_seconds = None;
                }
                manual_snapshot_details.push(detail.clone());
                latest_manual_utc = Some(match latest_manual_utc {
                    Some(prev) if prev >= archive_utc => prev,
                    _ => archive_utc,
                });
            }
        }

        if let Some(manual_utc) = latest_manual_utc {
            let any_remaining_failed = latest_app_details
                .iter()
                .any(|d| d.status.eq_ignore_ascii_case("failed"));
            let resolved_status = if any_remaining_failed {
                "Failed".to_string()
            } else {
                "Success".to_string()
            };
            let manual_total_size: u64 = manual_snapshot_details
                .iter()
                .filter_map(|d| d.size_bytes)
                .sum();
            let manual_ts = manual_utc.to_rfc3339();

            parsed.insert(
                0,
                BackupRecord {
                    timestamp: manual_ts.clone(),
                    status: resolved_status.clone(),
                    run_type: Some("Manual Snapshot".to_string()),
                    total_apps: manual_snapshot_details.len() as u32,
                    total_size_bytes: if manual_total_size > 0 {
                        Some(manual_total_size)
                    } else {
                        None
                    },
                    destination: "Google Drive DatabaseBackups (Manual Snapshot)".to_string(),
                    app_details: manual_snapshot_details,
                    pruned_files: HashMap::new(),
                },
            );
            parsed.truncate(50);

            effective_last_run_status = Some(resolved_status.clone());
            effective_last_run_timestamp = Some(manual_ts.clone());
            effective_records.push(serde_json::json!({
                "timestamp": manual_ts,
                "status": resolved_status,
                "run_type": "Manual Snapshot"
            }));
        }
    }

    // Calculate all-time pruned files
    let mut total_pruned_count: usize = 0;
    let mut pruned_per_app: HashMap<String, usize> = HashMap::new();
    for r in &records {
        if let Some(pruning_map) = r["pruning"].as_object() {
            for (app_name, pinfo) in pruning_map {
                if let Some(del_arr) = pinfo["deleted"].as_array() {
                    total_pruned_count += del_arr.len();
                    *pruned_per_app.entry(app_name.clone()).or_insert(0) += del_arr.len();
                }
            }
        }
    }

    // Calculate 7-day rolling window & daily status pips
    let (runs_7d, successful_runs_7d, failed_runs_7d, daily_pips_7d) =
        compute_7d_window(&effective_records, now_local);

    Ok(BackupLedgerSummary {
        history_file_exists: true,
        ledger_source_path: history_path.to_string_lossy().to_string(),
        total_runs,
        successful_runs,
        failed_runs,
        runs_7d,
        successful_runs_7d,
        failed_runs_7d,
        daily_pips_7d,
        total_pruned_count,
        pruned_per_app,
        last_run_timestamp: effective_last_run_timestamp,
        last_run_status: effective_last_run_status,
        latest_app_details,
        recent_records: parsed,
    })
}

/// Normalize an ISO/RFC3339 timestamp string to its local `YYYY-MM-DD` date string.
/// Falls back to taking the first 10 characters if RFC3339 parsing fails.
pub fn record_local_date_str(ts: &str) -> String {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
        return dt.with_timezone(&chrono::Local).format("%Y-%m-%d").to_string();
    }
    ts.chars().take(10).collect()
}

/// Compute the 7-day rolling reliability window and daily status pips.
/// For each local day, uses the chronologically latest non-`Manual Prune` record so
/// same-day retries or reconciled manual snapshots clear earlier failures cleanly.
/// Missed daily runs (`NoRun` on any past day, or today at/after the 02:00 AM window)
/// are counted as failures in `failed_runs_7d` and `runs_7d`.
pub fn compute_7d_window(
    records: &[serde_json::Value],
    now_local: chrono::DateTime<chrono::Local>,
) -> (usize, usize, usize, Vec<DayBackupStatus>) {
    let today = now_local.date_naive();
    let mut daily_pips_7d: Vec<DayBackupStatus> = Vec::new();
    let mut runs_7d = 0;
    let mut successful_runs_7d = 0;
    let mut failed_runs_7d = 0;

    for day_offset in (0..7).rev() {
        let day_date = today - chrono::Duration::days(day_offset);
        let date_str = day_date.format("%Y-%m-%d").to_string();
        let day_label = day_date.format("%a").to_string();

        let mut day_run_count = 0usize;
        let mut latest_for_day: Option<(Option<chrono::DateTime<chrono::Utc>>, String, usize, bool)> =
            None;

        for (idx, r) in records.iter().enumerate() {
            // Manual Prune entries do not perform database backups
            if r["run_type"].as_str() == Some("Manual Prune") {
                continue;
            }
            let ts = r["timestamp"].as_str().unwrap_or("");
            if record_local_date_str(ts) == date_str {
                day_run_count += 1;
                let status_raw = r["status"].as_str().unwrap_or("Unknown");
                let is_success = status_raw.eq_ignore_ascii_case("success");
                let parsed_utc = parse_record_utc(ts);

                let is_newer = match &latest_for_day {
                    None => true,
                    Some((prev_utc, prev_ts, prev_idx, _)) => match (parsed_utc, *prev_utc) {
                        (Some(curr), Some(prev)) => (curr, idx) > (prev, *prev_idx),
                        (Some(_), None) => true,
                        (None, Some(_)) => false,
                        (None, None) => (ts, idx) > (prev_ts.as_str(), *prev_idx),
                    },
                };

                if is_newer {
                    latest_for_day = Some((parsed_utc, ts.to_string(), idx, is_success));
                }
            }
        }

        let is_expected_schedule_passed = day_offset > 0 || now_local.hour() >= 2;

        let day_status = match latest_for_day {
            Some((_, _, _, true)) => "Success".to_string(),
            Some((_, _, _, false)) => "Failed".to_string(),
            None => "NoRun".to_string(),
        };

        if day_run_count > 0 {
            runs_7d += 1;
            if day_status == "Success" {
                successful_runs_7d += 1;
            } else {
                failed_runs_7d += 1;
            }
        } else if is_expected_schedule_passed {
            // A missed daily run in the 7-day window counts as 1 failed expected run
            runs_7d += 1;
            failed_runs_7d += 1;
        }

        daily_pips_7d.push(DayBackupStatus {
            date: date_str,
            day_label,
            status: day_status,
            run_count: day_run_count,
        });
    }

    (runs_7d, successful_runs_7d, failed_runs_7d, daily_pips_7d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn normalizes_utc_timestamp_to_local_date() {
        // 2026-11-13T09:00:03Z is 02:00:03 AM in America/Denver (UTC-7), still 2026-11-13
        let d = record_local_date_str("2026-11-13T09:00:03Z");
        assert_eq!(d.len(), 10);
    }

    #[test]
    fn counts_missed_days_as_failures_in_7d_window() {
        let now_local = chrono::Local
            .with_ymd_and_hms(2026, 11, 13, 11, 0, 0)
            .unwrap();

        // Simulate 6 days of successful runs and 1 missed day (2026-11-12)
        let records = vec![
            serde_json::json!({ "timestamp": "2026-11-07T09:00:04Z", "status": "Success", "run_type": "Automated" }),
            serde_json::json!({ "timestamp": "2026-11-08T09:00:04Z", "status": "Success", "run_type": "Automated" }),
            serde_json::json!({ "timestamp": "2026-11-09T09:00:04Z", "status": "Success", "run_type": "Automated" }),
            serde_json::json!({ "timestamp": "2026-11-10T09:00:04Z", "status": "Success", "run_type": "Automated" }),
            serde_json::json!({ "timestamp": "2026-11-11T09:00:05Z", "status": "Success", "run_type": "Automated" }),
            // 2026-11-12 is missing!
            serde_json::json!({ "timestamp": "2026-11-13T09:00:03Z", "status": "Success", "run_type": "Automated" }),
        ];

        let (runs_7d, successful_runs_7d, failed_runs_7d, pips) =
            compute_7d_window(&records, now_local);

        assert_eq!(runs_7d, 7);
        assert_eq!(successful_runs_7d, 6);
        assert_eq!(failed_runs_7d, 1);
        assert_eq!(pips.len(), 7);

        let thursday = pips.iter().find(|p| p.date == "2026-11-12").unwrap();
        assert_eq!(thursday.status, "NoRun");
        assert_eq!(thursday.run_count, 0);
    }
}
