use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

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

        let path = Path::new(&path_str);
        let raw = fs::read_to_string(path).map_err(|e| format!("Failed to read backup ledger: {}", e))?;
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
            let final_size = explicit_size.or(if calculated_total_size > 0 { Some(calculated_total_size) } else { None });

            let apps_count = if !app_details.is_empty() {
                app_details.len() as u32
            } else {
                r["apps_backed_up"].as_u64().unwrap_or(0) as u32
            };

            if parsed.len() < 50 {
                parsed.push(BackupRecord {
                    timestamp: r["timestamp"].as_str().unwrap_or("").to_string(),
                    status: if is_success { "Success".into() } else { "Failed".into() },
                    run_type: r["run_type"].as_str().map(|s| s.to_string()),
                    total_apps: apps_count,
                    total_size_bytes: final_size,
                    destination: r["destination"].as_str().unwrap_or("Google Drive DatabaseBackups").to_string(),
                    app_details,
                    pruned_files,
                });
            }
        }

        let last_run = parsed.first();
        let latest_app_details = last_run.map(|r| r.app_details.clone()).unwrap_or_default();

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
        let today = chrono::Local::now().date_naive();
        let mut daily_pips_7d: Vec<DayBackupStatus> = Vec::new();
        let mut runs_7d = 0;
        let mut successful_runs_7d = 0;
        let mut failed_runs_7d = 0;

        for day_offset in (0..7).rev() {
            let day_date = today - chrono::Duration::days(day_offset);
            let date_str = day_date.format("%Y-%m-%d").to_string();
            let day_label = day_date.format("%a").to_string();

            let mut day_success_count = 0;
            let mut day_failed_count = 0;

            for r in &records {
                let ts = r["timestamp"].as_str().unwrap_or("");
                if ts.starts_with(&date_str) {
                    let status_raw = r["status"].as_str().unwrap_or("Unknown");
                    if status_raw.eq_ignore_ascii_case("success") {
                        day_success_count += 1;
                    } else {
                        day_failed_count += 1;
                    }
                }
            }

            let day_run_count = day_success_count + day_failed_count;
            let day_status = if day_failed_count > 0 {
                "Failed".to_string()
            } else if day_success_count > 0 {
                "Success".to_string()
            } else {
                "NoRun".to_string()
            };

            runs_7d += day_run_count;
            successful_runs_7d += day_success_count;
            failed_runs_7d += day_failed_count;

            daily_pips_7d.push(DayBackupStatus {
                date: date_str,
                day_label,
                status: day_status,
                run_count: day_run_count,
            });
        }

        Ok(BackupLedgerSummary {
            history_file_exists: true,
            ledger_source_path: path_str,
            total_runs,
            successful_runs,
            failed_runs,
            runs_7d,
            successful_runs_7d,
            failed_runs_7d,
            daily_pips_7d,
            total_pruned_count,
            pruned_per_app,
            last_run_timestamp: last_run.map(|r| r.timestamp.clone()),
            last_run_status: last_run.map(|r| r.status.clone()),
            latest_app_details,
            recent_records: parsed,
        })
    })
    .await
    .map_err(|e| format!("Join error: {}", e))?
}
