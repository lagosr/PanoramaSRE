use crate::db::{ConsoleSessionRecord, DeployTelemetryRunRow, SreDatabase};
use chrono::{DateTime, NaiveDateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct DockerDiskCategoryUsage {
    pub total_count: u64,
    pub active_count: u64,
    pub size_bytes: u64,
    pub reclaimable_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalDockerDiskUsage {
    pub images: DockerDiskCategoryUsage,
    pub containers: DockerDiskCategoryUsage,
    pub volumes: DockerDiskCategoryUsage,
    pub build_cache: DockerDiskCategoryUsage,
    pub captured_at: String,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JsonlDeployRecord {
    id: String,
    app_slug: String,
    app_name: String,
    started_at: String,
    finished_at: Option<String>,
    wall_duration_sec: Option<f64>,
    exit_code: Option<i32>,
    engine_version: Option<String>,
    release_id: Option<String>,
    cache_posture: Option<String>,
    status: Option<String>,
    host_typecheck_sec: Option<f64>,
    semver_bump_sec: Option<f64>,
    build_total_sec: Option<f64>,
    deps_stage_sec: Option<f64>,
    deps_cache_hit: Option<bool>,
    next_build_sec: Option<f64>,
    arm64_natives_sec: Option<f64>,
    arm64_natives_cache_hit: Option<bool>,
    export_tar_sec: Option<f64>,
    context_transfer_kb: Option<f64>,
    elf_verified_count: Option<i64>,
    stage3_preflight_sec: Option<f64>,
    stage4_upload_sec: Option<f64>,
    stage5_snapshot_sec: Option<f64>,
    stage5_swap_sec: Option<f64>,
    stage5_verify_sec: Option<f64>,
    stage5_smoke_sec: Option<f64>,
    stage5_finalize_sec: Option<f64>,
    stage5_cron_sec: Option<f64>,
    stage5_manifest_sync_sec: Option<f64>,
    bumped: Option<bool>,
    ran_smoke: Option<bool>,
    warnings: Option<Vec<String>>,
    warnings_json: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DockerSystemDfLine {
    #[serde(rename = "Type")]
    kind: Option<String>,
    #[serde(rename = "TotalCount")]
    total_count: Option<serde_json::Value>,
    #[serde(rename = "Active")]
    active: Option<serde_json::Value>,
    #[serde(rename = "Size")]
    size: Option<String>,
    #[serde(rename = "Reclaimable")]
    reclaimable: Option<String>,
}

fn parse_utc_timestamp(raw: &str) -> Option<DateTime<Utc>> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        return Some(dt.with_timezone(&Utc));
    }
    if let Ok(naive) = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S%.f") {
        return Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc));
    }
    if let Ok(naive) = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S") {
        return Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc));
    }
    None
}

fn parse_u64_json_val(v: Option<&serde_json::Value>) -> u64 {
    match v {
        Some(serde_json::Value::Number(n)) => n.as_u64().unwrap_or(0),
        Some(serde_json::Value::String(s)) => s.trim().parse::<u64>().unwrap_or(0),
        _ => 0,
    }
}

pub fn parse_docker_size_bytes(raw: &str) -> u64 {
    // Handles strings like "107.1GB", "4.15GB", "651.8MB", "24.5kB", "0B", or "107.1GB (100%)"
    let clean = raw
        .split('(')
        .next()
        .unwrap_or("")
        .trim();
    if clean.is_empty() {
        return 0;
    }

    let re = Regex::new(r"(?i)^([\d\.]+)\s*([a-z]+)$").ok();
    let Some(caps) = re.and_then(|r| r.captures(clean)) else {
        return clean.parse::<u64>().unwrap_or(0);
    };
    let num: f64 = caps[1].parse().unwrap_or(0.0);
    let unit = caps[2].to_ascii_lowercase();
    let mult: f64 = match unit.as_str() {
        "b" => 1.0,
        "kb" => 1_000.0,
        "kib" => 1_024.0,
        "mb" => 1_000_000.0,
        "mib" => 1_048_576.0,
        "gb" => 1_000_000_000.0,
        "gib" => 1_073_741_824.0,
        "tb" => 1_000_000_000_000.0,
        "tib" => 1_099_511_627_776.0,
        _ => 1.0,
    };
    (num * mult).round().max(0.0) as u64
}

pub fn parse_docker_system_df_json(stdout: &str) -> Result<LocalDockerDiskUsage, String> {
    let mut usage = LocalDockerDiskUsage {
        images: DockerDiskCategoryUsage::default(),
        containers: DockerDiskCategoryUsage::default(),
        volumes: DockerDiskCategoryUsage::default(),
        build_cache: DockerDiskCategoryUsage::default(),
        captured_at: Utc::now().to_rfc3339(),
        error: None,
    };

    let mut matched = 0usize;
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || !trimmed.starts_with('{') {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<DockerSystemDfLine>(trimmed) else {
            continue;
        };
        let cat = DockerDiskCategoryUsage {
            total_count: parse_u64_json_val(entry.total_count.as_ref()),
            active_count: parse_u64_json_val(entry.active.as_ref()),
            size_bytes: parse_docker_size_bytes(entry.size.as_deref().unwrap_or("0B")),
            reclaimable_bytes: parse_docker_size_bytes(entry.reclaimable.as_deref().unwrap_or("0B")),
        };
        match entry.kind.as_deref().unwrap_or("").trim().to_ascii_lowercase().as_str() {
            "images" => {
                usage.images = cat;
                matched += 1;
            }
            "containers" => {
                usage.containers = cat;
                matched += 1;
            }
            "local volumes" | "volumes" => {
                usage.volumes = cat;
                matched += 1;
            }
            "build cache" => {
                usage.build_cache = cat;
                matched += 1;
            }
            _ => {}
        }
    }

    if matched == 0 {
        return Err("No docker system df JSON rows parsed from output.".to_string());
    }

    Ok(usage)
}

fn infer_app_slug_and_name(session: &ConsoleSessionRecord) -> (String, String) {
    let slug = if let Some(rest) = session.id.strip_prefix("deploy-") {
        let parts: Vec<&str> = rest.split('-').collect();
        if parts.len() >= 2 && parts.last().map(|s| s.chars().all(|c| c.is_ascii_digit())).unwrap_or(false) {
            parts[..parts.len() - 1].join("-")
        } else {
            parts.first().copied().unwrap_or("unknown").to_string()
        }
    } else {
        "unknown".to_string()
    };

    let title_clean = session
        .title
        .trim()
        .strip_prefix("Deploy:")
        .or_else(|| session.title.trim().strip_prefix("Edge Publish:"))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let app_name = title_clean.unwrap_or_else(|| slug.clone());
    (slug, app_name)
}

pub fn parse_console_session_to_telemetry(session: &ConsoleSessionRecord) -> Option<DeployTelemetryRunRow> {
    if !session.id.starts_with("deploy-") || session.is_running {
        return None;
    }

    let (app_slug, app_name) = infer_app_slug_and_name(session);
    let started_raw = session
        .created_at
        .as_deref()
        .or(session.updated_at.as_deref())
        .unwrap_or("");
    if started_raw.is_empty() {
        return None;
    }

    let wall_from_timestamps = match (
        session.created_at.as_deref().and_then(parse_utc_timestamp),
        session.updated_at.as_deref().and_then(parse_utc_timestamp),
    ) {
        (Some(start_dt), Some(end_dt)) => {
            let secs = (end_dt - start_dt).num_milliseconds() as f64 / 1000.0;
            if secs >= 0.0 {
                Some((secs * 10.0).round() / 10.0)
            } else {
                None
            }
        }
        _ => None,
    };

    let joined = session.lines.join("\n");
    let re_engine = Regex::new(r"Transactional Engine v([\d\.]+)").ok()?;
    let engine_version = re_engine
        .captures(&joined)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());

    let re_release = Regex::new(r"Release Identity:\s*([^\s|]+)").ok()?;
    let release_id = re_release
        .captures(&joined)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());

    let re_typecheck = Regex::new(r"Pre-build validation passed cleanly \(typecheck:\s*([\d\.]+)s\)").ok()?;
    let mut host_typecheck_sec = re_typecheck
        .captures(&joined)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<f64>().ok());

    let mut telemetry_posture: Option<String> = None;
    let mut telemetry_status: Option<String> = None;
    let mut build_total_sec: Option<f64> = None;
    let mut deps_stage_sec: Option<f64> = None;
    let mut deps_cache_hit: Option<bool> = None;
    let mut next_build_sec: Option<f64> = None;
    let mut arm64_natives_sec: Option<f64> = None;
    let mut arm64_natives_cache_hit: Option<bool> = None;
    let mut export_tar_sec: Option<f64> = None;
    let mut context_transfer_kb: Option<f64> = None;
    let mut elf_verified_count: Option<i64> = None;

    let mut semver_bump_sec: Option<f64> = None;
    let mut stage3_preflight_sec: Option<f64> = None;
    let mut stage4_upload_sec: Option<f64> = None;
    let mut stage5_snapshot_sec: Option<f64> = None;
    let mut stage5_swap_sec: Option<f64> = None;
    let mut stage5_verify_sec: Option<f64> = None;
    let mut stage5_smoke_sec: Option<f64> = None;
    let mut stage5_finalize_sec: Option<f64> = None;
    let mut stage5_cron_sec: Option<f64> = None;
    let mut stage5_manifest_sync_sec: Option<f64> = None;
    let mut timing_total_sec: Option<f64> = None;

    let mut warnings = Vec::new();
    let mut bumped = false;
    let mut ran_smoke = false;

    for line in &session.lines {
        let trimmed = line.trim();
        if trimmed.contains("Executing guided SemVer bump") || trimmed.contains("Successfully bumped version") {
            bumped = true;
        }
        if trimmed.contains("SUITE SMOKE TEST VERIFICATION GATE") {
            ran_smoke = true;
        }
        if let Some(rest) = trimmed.split("[TELEMETRY-WARN]").nth(1) {
            let msg = rest.trim();
            if !msg.is_empty() && !warnings.contains(&msg.to_string()) {
                warnings.push(msg.to_string());
            }
        }
        if trimmed.contains("[TELEMETRY]") {
            if let Some(m) = Regex::new(r"Posture=([a-zA-Z]+)").ok().and_then(|r| r.captures(trimmed)) {
                telemetry_posture = Some(m[1].to_ascii_lowercase());
            }
            if let Some(m) = Regex::new(r"Status=([A-Z0-9_]+)").ok().and_then(|r| r.captures(trimmed)) {
                telemetry_status = Some(m[1].to_string());
            }
            if let Some(m) = Regex::new(r"Total=([\d\.]+)s").ok().and_then(|r| r.captures(trimmed)) {
                build_total_sec = m[1].parse::<f64>().ok();
            }
            if let Some(m) = Regex::new(r"(?i)Deps=([\d\.]+)s\s*\[cached=(true|false)\]").ok().and_then(|r| r.captures(trimmed)) {
                deps_stage_sec = m[1].parse::<f64>().ok();
                deps_cache_hit = Some(m[2].eq_ignore_ascii_case("true"));
            }
            if let Some(m) = Regex::new(r"NextBuild=([\d\.]+)s").ok().and_then(|r| r.captures(trimmed)) {
                next_build_sec = m[1].parse::<f64>().ok();
            }
            if let Some(m) = Regex::new(r"(?i)ARM64Natives=([\d\.]+)s(?:\s*\[cached=(true|false)\])?").ok().and_then(|r| r.captures(trimmed)) {
                arm64_natives_sec = m[1].parse::<f64>().ok();
                if let Some(hit) = m.get(2) {
                    arm64_natives_cache_hit = Some(hit.as_str().eq_ignore_ascii_case("true"));
                }
            }
            if let Some(m) = Regex::new(r"Export=([\d\.]+)s").ok().and_then(|r| r.captures(trimmed)) {
                export_tar_sec = m[1].parse::<f64>().ok();
            }
            if let Some(m) = Regex::new(r"Context=([\d\.]+)KB").ok().and_then(|r| r.captures(trimmed)) {
                context_transfer_kb = m[1].parse::<f64>().ok();
            }
            if let Some(m) = Regex::new(r"ELF=(\d+)").ok().and_then(|r| r.captures(trimmed)) {
                elf_verified_count = m[1].parse::<i64>().ok();
            }
        }
        if trimmed.contains("[DEPLOY-TIMING]") {
            let pick = |key: &str| -> Option<f64> {
                Regex::new(&format!(r"{}=([\d\.]+)s", key))
                    .ok()
                    .and_then(|r| r.captures(trimmed))
                    .and_then(|c| c[1].parse::<f64>().ok())
            };
            timing_total_sec = pick("Total");
            if let Some(s1) = pick("S1") {
                host_typecheck_sec = Some(s1);
            }
            semver_bump_sec = pick("Bump");
            if let Some(s2) = pick("S2") {
                build_total_sec = Some(s2);
            }
            stage3_preflight_sec = pick("S3");
            stage4_upload_sec = pick("S4");
            stage5_snapshot_sec = pick("Snap");
            stage5_swap_sec = pick("Swap");
            stage5_verify_sec = pick("Verify");
            if let Some(sm) = pick("Smoke") {
                stage5_smoke_sec = Some(sm);
                if sm > 0.0 {
                    ran_smoke = true;
                }
            }
            stage5_cron_sec = pick("Cron");
            stage5_finalize_sec = pick("Finalize");
            stage5_manifest_sync_sec = pick("Sync");
        }
    }

    let is_edge = joined.contains("deploy-cloudflare-pages.ps1") || session.title.starts_with("Edge Publish:");
    let cache_posture = if is_edge {
        "static".to_string()
    } else if let Some(p) = telemetry_posture {
        p
    } else {
        "legacy".to_string()
    };

    let status = if let Some(st) = telemetry_status {
        st
    } else if session.exit_code == Some(0) {
        "OPTIMAL".to_string()
    } else {
        "FAILED".to_string()
    };

    Some(DeployTelemetryRunRow {
        id: session.id.clone(),
        console_session_id: Some(session.id.clone()),
        app_slug,
        app_name,
        started_at: started_raw.to_string(),
        finished_at: session.updated_at.clone(),
        wall_duration_sec: timing_total_sec.or(wall_from_timestamps),
        exit_code: session.exit_code,
        engine_version,
        release_id,
        cache_posture,
        status,
        host_typecheck_sec,
        semver_bump_sec,
        build_total_sec,
        deps_stage_sec,
        deps_cache_hit,
        next_build_sec,
        arm64_natives_sec,
        arm64_natives_cache_hit,
        export_tar_sec,
        context_transfer_kb,
        elf_verified_count,
        stage3_preflight_sec,
        stage4_upload_sec,
        stage5_snapshot_sec,
        stage5_swap_sec,
        stage5_verify_sec,
        stage5_smoke_sec,
        stage5_finalize_sec,
        stage5_cron_sec,
        stage5_manifest_sync_sec,
        bumped,
        ran_smoke,
        warnings,
        source: session
            .source
            .clone()
            .unwrap_or_else(|| "backfill".to_string()),
    })
}

pub fn ingest_deploy_history_jsonl(workspace_root: &str, db: &SreDatabase) -> usize {
    let jsonl_path = PathBuf::from(workspace_root)
        .join("PanoramaDrSuite")
        .join("tools")
        .join("deploy-telemetry")
        .join("deploy-history.jsonl");
    if !jsonl_path.exists() {
        return 0;
    }

    let Ok(content) = std::fs::read_to_string(&jsonl_path) else {
        return 0;
    };

    let mut count = 0usize;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(rec) = serde_json::from_str::<JsonlDeployRecord>(trimmed) else {
            continue;
        };
        let warnings = rec.warnings.unwrap_or_else(|| {
            rec.warnings_json
                .as_deref()
                .and_then(|w| serde_json::from_str::<Vec<String>>(w).ok())
                .unwrap_or_default()
        });

        let row = DeployTelemetryRunRow {
            id: rec.id,
            console_session_id: None,
            app_slug: rec.app_slug,
            app_name: rec.app_name,
            started_at: rec.started_at,
            finished_at: rec.finished_at,
            wall_duration_sec: rec.wall_duration_sec,
            exit_code: rec.exit_code,
            engine_version: rec.engine_version,
            release_id: rec.release_id,
            cache_posture: rec.cache_posture.unwrap_or_else(|| "warm".to_string()),
            status: rec.status.unwrap_or_else(|| "OPTIMAL".to_string()),
            host_typecheck_sec: rec.host_typecheck_sec,
            semver_bump_sec: rec.semver_bump_sec,
            build_total_sec: rec.build_total_sec,
            deps_stage_sec: rec.deps_stage_sec,
            deps_cache_hit: rec.deps_cache_hit,
            next_build_sec: rec.next_build_sec,
            arm64_natives_sec: rec.arm64_natives_sec,
            arm64_natives_cache_hit: rec.arm64_natives_cache_hit,
            export_tar_sec: rec.export_tar_sec,
            context_transfer_kb: rec.context_transfer_kb,
            elf_verified_count: rec.elf_verified_count,
            stage3_preflight_sec: rec.stage3_preflight_sec,
            stage4_upload_sec: rec.stage4_upload_sec,
            stage5_snapshot_sec: rec.stage5_snapshot_sec,
            stage5_swap_sec: rec.stage5_swap_sec,
            stage5_verify_sec: rec.stage5_verify_sec,
            stage5_smoke_sec: rec.stage5_smoke_sec,
            stage5_finalize_sec: rec.stage5_finalize_sec,
            stage5_cron_sec: rec.stage5_cron_sec,
            stage5_manifest_sync_sec: rec.stage5_manifest_sync_sec,
            bumped: rec.bumped.unwrap_or(false),
            ran_smoke: rec.ran_smoke.unwrap_or(false),
            warnings,
            source: rec.source.unwrap_or_else(|| "cli".to_string()),
        };

        if db.upsert_deploy_telemetry_run(&row, true).is_ok() {
            count += 1;
        }
    }

    count
}

#[tauri::command]
pub fn get_deploy_telemetry_history(
    workspace_root: String,
    limit: Option<usize>,
    db: State<'_, Arc<Mutex<SreDatabase>>>,
) -> Result<Vec<DeployTelemetryRunRow>, String> {
    let guard = db.lock().map_err(|e| format!("Database lock error: {}", e))?;

    if let Ok(sessions) = guard.list_deploy_console_sessions() {
        for sess in sessions {
            if let Some(row) = parse_console_session_to_telemetry(&sess) {
                let _ = guard.upsert_deploy_telemetry_run(&row, false);
            }
        }
    }

    if !workspace_root.trim().is_empty() {
        let _ = ingest_deploy_history_jsonl(&workspace_root, &guard);
    }

    guard
        .get_deploy_telemetry_runs(limit.unwrap_or(1000))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_local_docker_disk_usage() -> Result<LocalDockerDiskUsage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let mut cmd = Command::new("docker");
        cmd.args(["system", "df", "--format", "json"]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        match cmd.output() {
            Ok(out) if out.status.success() => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                parse_docker_system_df_json(&stdout)
            }
            Ok(out) => {
                let err_msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
                Ok(LocalDockerDiskUsage {
                    images: DockerDiskCategoryUsage::default(),
                    containers: DockerDiskCategoryUsage::default(),
                    volumes: DockerDiskCategoryUsage::default(),
                    build_cache: DockerDiskCategoryUsage::default(),
                    captured_at: Utc::now().to_rfc3339(),
                    error: Some(if err_msg.is_empty() {
                        "Docker daemon returned non-zero status".to_string()
                    } else {
                        err_msg
                    }),
                })
            }
            Err(e) => Ok(LocalDockerDiskUsage {
                images: DockerDiskCategoryUsage::default(),
                containers: DockerDiskCategoryUsage::default(),
                volumes: DockerDiskCategoryUsage::default(),
                build_cache: DockerDiskCategoryUsage::default(),
                captured_at: Utc::now().to_rfc3339(),
                error: Some(format!("Failed to invoke docker CLI: {}", e)),
            }),
        }
    })
    .await
    .map_err(|e| format!("Docker disk check task failed: {}", e))?
}
