#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    panorama_sre_lib::run();
}

#[cfg(test)]
mod tests {
    use panorama_sre_lib::commands::cloudflare_ops::parse_wrangler_deployments_json;
    use panorama_sre_lib::commands::dietpi_ops::WshSnapshot;
    use panorama_sre_lib::commands::git_ops::classify_blast_radius;
    use panorama_sre_lib::commands::workspace::{compute_normalized_lf_sha256, SreConfigDto};
    use panorama_sre_lib::commands::monitor::{
        build_parakith_stealth_headers, extract_cloudflared_version, extract_url_pathname,
        is_latest_version_newer,
    };
    use panorama_sre_lib::commands::optin_ops::{
        format_opt_ins_csv, mask_phone_number, parse_wrangler_d1_opt_ins_json,
    };
    use panorama_sre_lib::commands::smoke_ops::{sanitize_smoke_target_url, sanitize_smoke_trigger};
    use panorama_sre_lib::commands::telemetry_ops::{
        ingest_deploy_history_jsonl, parse_console_session_to_telemetry, parse_docker_size_bytes,
        parse_docker_system_df_json,
    };
    use panorama_sre_lib::db::{ConsoleSessionRecord, OptInCacheRow, SreDatabase};
    use panorama_sre_lib::dev_supervisor::{is_dev_server_ready_line, DevSupervisor};
    use panorama_sre_lib::ipc_security::validate_dev_command;
    use panorama_sre_lib::scheduler::{evaluate_due_tiers, TelemetryScheduler};

    #[test]
    fn test_console_session_scope_and_startup_reconciliation() {
        let unique = format!(
            "panorama_sre_test_{}_{}.sqlite",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        );
        let db_path = std::env::temp_dir().join(unique);

        {
            let db = SreDatabase::new(&db_path).expect("create temp test sqlite db");
            db.save_console_session(
                "deploy-auth-1",
                "Deploy: PanoramaAuth",
                &["line 1".to_string(), "line 2".to_string()],
                true,
                None,
                Some("releases"),
                Some("ui"),
            )
            .expect("save scoped session");

            db.save_console_session(
                "deploy-auth-1",
                "Deploy: PanoramaAuth",
                &["line 1".to_string(), "line 2".to_string(), "done".to_string()],
                false,
                Some(0),
                None,
                None,
            )
            .expect("preserve existing scope/source when None");

            // Stale running row simulating abrupt process termination before restart
            db.save_console_session(
                "smoke-stale-2",
                "MCP Smoke Run",
                &["running...".to_string()],
                true,
                None,
                Some("smoke"),
                Some("mcp"),
            )
            .expect("save stale running row");
        }

        // Reopen database -> startup reconciliation must reset stale is_running=1 -> 0
        {
            let db_reopened = SreDatabase::new(&db_path).expect("reopen temp sqlite db");
            let sessions = db_reopened
                .get_saved_console_sessions()
                .expect("read saved sessions");
            let deploy = sessions
                .iter()
                .find(|s| s.id == "deploy-auth-1")
                .expect("deploy session present");
            assert_eq!(deploy.page_scope.as_deref(), Some("releases"));
            assert_eq!(deploy.source.as_deref(), Some("ui"));
            assert_eq!(deploy.exit_code, Some(0));
            assert_eq!(deploy.lines.len(), 3);
            assert!(!deploy.is_running);

            let stale = sessions
                .iter()
                .find(|s| s.id == "smoke-stale-2")
                .expect("stale session present");
            assert!(!stale.is_running);
            assert_eq!(stale.page_scope.as_deref(), Some("smoke"));
            assert_eq!(stale.source.as_deref(), Some("mcp"));
        }

        let _ = std::fs::remove_file(&db_path);
        let wal = db_path.with_extension("sqlite-wal");
        let shm = db_path.with_extension("sqlite-shm");
        let _ = std::fs::remove_file(wal);
        let _ = std::fs::remove_file(shm);
    }

    #[test]
    fn test_dev_server_ready_detection_handles_ansi_and_filters_noise() {
        assert!(is_dev_server_ready_line("\x1b[32m✓\x1b[39m Ready in 1420ms"));
        assert!(is_dev_server_ready_line(
            "  - Local:        \x1b[36mhttp://localhost:3002/biomed\x1b[39m"
        ));
        assert!(is_dev_server_ready_line("started server on 0.0.0.0:3000"));
        assert!(is_dev_server_ready_line("Listening on http://127.0.0.1:3001"));
        assert!(!is_dev_server_ready_line(" ○ Compiling /page ..."));
        assert!(!is_dev_server_ready_line("GET /biomed/api/health 200 in 18ms"));
    }

    #[test]
    fn test_four_tier_scheduler_boundaries_and_coalescing() {
        let mut t2 = 0u32;
        let mut t3 = 0u32;
        let mut t4 = 0u32;

        // First 3 ticks at 15s (15s, 30s, 45s): Tier 1 only
        for _ in 0..3 {
            assert_eq!(evaluate_due_tiers(&mut t2, &mut t3, &mut t4, 15, 300), vec![1]);
        }

        // Tick 4 (60s): Tier 1 + Tier 2
        assert_eq!(evaluate_due_tiers(&mut t2, &mut t3, &mut t4, 15, 300), vec![1, 2]);
        assert_eq!(t2, 0);

        // Advance to 300s (16 more ticks * 15s = 240s, total 300s): Tier 1 + 2 + 3
        let mut due = Vec::new();
        for _ in 0..16 {
            due = evaluate_due_tiers(&mut t2, &mut t3, &mut t4, 15, 300);
        }
        assert_eq!(due, vec![1, 2, 3]);
        assert_eq!(t3, 0);

        // Advance remaining 3300s to 3600s (220 ticks * 15s): Tier 1 + 2 + 3 + 4
        for _ in 0..220 {
            due = evaluate_due_tiers(&mut t2, &mut t3, &mut t4, 15, 300);
        }
        assert_eq!(due, vec![1, 2, 3, 4]);
        assert_eq!(t4, 0);

        // Scheduler clamps configurable intervals cleanly
        let sched = TelemetryScheduler::new();
        assert_eq!(sched.get_intervals(), (15, 300));
        sched.set_intervals(Some(1), Some(30));
        assert_eq!(sched.get_intervals(), (5, 60));
        sched.set_intervals(Some(30), Some(600));
        assert_eq!(sched.get_intervals(), (30, 600));
    }

    #[test]
    fn test_cloudflared_version_extraction_and_calver_comparison() {
        assert_eq!(
            extract_cloudflared_version("cloudflared version 2026.10.7 (built 2026-10-15-1234 UTC)"),
            Some("2026.10.7".to_string())
        );
        assert_eq!(
            extract_cloudflared_version("v2026.11.0"),
            Some("2026.11.0".to_string())
        );
        assert_eq!(extract_cloudflared_version("cloudflared daemon"), None);

        assert!(is_latest_version_newer("2026.9.1", "2026.10.7"));
        assert!(!is_latest_version_newer("2026.10.7", "2026.10.7"));
        assert!(!is_latest_version_newer("2026.10.8", "2026.10.7"));
        assert!(is_latest_version_newer("2026.10.7", "2026.11.0"));
    }

    #[test]
    fn test_parakith_edge_integrations_and_optin_cache() {
        assert_eq!(
            validate_dev_command("npm run preview").unwrap(),
            "npm run preview"
        );
        assert!(validate_dev_command("npm run preview && whoami").is_err());

        assert_eq!(
            DevSupervisor::normalize_local_url(3500, "/"),
            "http://localhost:3500"
        );
        assert!(is_dev_server_ready_line(
            "[wrangler:inf] Ready on http://localhost:3500"
        ));

        assert_eq!(
            extract_url_pathname("https://www.parakith.com/api/health?probe=1"),
            "/api/health"
        );
        let h1 = build_parakith_stealth_headers(
            "0123456789abcdef0123456789abcdef",
            "/api/health",
            Some(1762897000),
            Some("deadbeefdeadbeefdeadbeefdeadbeef"),
        );
        let h2 = build_parakith_stealth_headers(
            "0123456789abcdef0123456789abcdef",
            "/api/health",
            Some(1762897000),
            Some("deadbeefdeadbeefdeadbeefdeadbeef"),
        );
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 3);
        assert_eq!(h1[2].0, "X-Parakith-Probe-Sig");
        assert_eq!(h1[2].1.len(), 64);

        let badges = classify_blast_radius(
            &[
                "functions/api/health.ts".to_string(),
                "schema/001_opt_ins.sql".to_string(),
                "src/app/opt-in/page.tsx".to_string(),
            ],
            false,
        );
        assert!(badges.contains(&"EDGE_FUNCTIONS".to_string()));
        assert!(badges.contains(&"D1_SCHEMA_INFRA".to_string()));
        assert!(badges.contains(&"COMPLIANCE_POLICY".to_string()));

        let deps = parse_wrangler_deployments_json(
            r#"[
              {
                "id": "11111111-2222-3333-4444-555555555555",
                "environment": "Production",
                "url": "https://parakith-site.pages.dev",
                "created_on": "2026-11-14T20:00:00Z",
                "deployment_trigger": { "metadata": { "branch": "main", "commit_hash": "abcdef1234567", "commit_message": "feat: stealth health" } }
              },
              {
                "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                "environment": "Preview",
                "url": "https://prev.parakith-site.pages.dev",
                "created_on": "2026-11-14T19:00:00Z"
              }
            ]"#,
        )
        .expect("parse wrangler deployments");
        assert_eq!(deps.len(), 2);
        assert_eq!(deps[0].short_id, "11111111");
        assert!(deps[0].is_active);
        assert!(!deps[1].is_active);

        let wrangler_v4_deps = parse_wrangler_deployments_json(
            r#"[
              {
                "Id": "099a859f-4a84-47bb-a057-9285308c995e",
                "Environment": "Production",
                "Branch": "main",
                "Source": "5aaa1c3",
                "Deployment": "https://099a859f.parakith-site.pages.dev",
                "Status": "Failure",
                "Build": "https://dash.cloudflare.com/x"
              },
              {
                "Id": "2a0b05fb-8515-4b46-8ceb-65eb0370b896",
                "Environment": "Production",
                "Branch": "main",
                "Source": "810d12e",
                "Deployment": "https://2a0b05fb.parakith-site.pages.dev",
                "Status": "7 hours ago",
                "Build": "https://dash.cloudflare.com/y"
              }
            ]"#,
        )
        .expect("parse wrangler 4.162 json");
        assert_eq!(wrangler_v4_deps.len(), 2);
        assert_eq!(wrangler_v4_deps[0].status, "Failure");
        assert_eq!(wrangler_v4_deps[0].commit_hash, "5aaa1c3");
        assert_eq!(wrangler_v4_deps[0].created_on, "");
        assert!(!wrangler_v4_deps[0].is_active);
        assert_eq!(wrangler_v4_deps[1].status, "7 hours ago");
        assert_eq!(wrangler_v4_deps[1].commit_hash, "810d12e");
        assert_eq!(wrangler_v4_deps[1].created_on, "7 hours ago");
        assert!(wrangler_v4_deps[1].is_active);

        let parsed_records = parse_wrangler_d1_opt_ins_json(
            r#"[{
              "results": [
                { "id": 1, "first_name": "Alex", "last_name": "Rivera", "phone": "+15552345678", "consent": "yes", "ip_address": "198.51.100.1", "user_agent": "Mozilla/5.0", "created_at": "2026-11-14T18:00:00Z" },
                { "id": 2, "first_name": "Jordan", "last_name": "Lee", "phone": "+15559876543", "consent": "no", "ip_address": "198.51.100.2", "user_agent": "Mozilla/5.0", "created_at": "2026-11-14T19:00:00Z" }
              ]
            }]"#,
            "2026-11-14T20:00:00Z",
        )
        .expect("parse wrangler d1 opt-ins");
        assert_eq!(parsed_records.len(), 2);
        assert_eq!(parsed_records[0].id, 2);
        assert_eq!(mask_phone_number("+1 (555) 234-5678"), "***-***-5678");
        let csv = format_opt_ins_csv(&parsed_records);
        assert!(csv.contains("id,first_name,last_name,phone,consent"));
        assert!(csv.contains("Alex"));

        let unique = format!(
            "panorama_sre_optin_test_{}_{}.sqlite",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        );
        let db_path = std::env::temp_dir().join(unique);
        {
            let db = SreDatabase::new(&db_path).expect("create optin temp sqlite");
            let rows: Vec<OptInCacheRow> = parsed_records
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
            db.replace_parakith_opt_ins(&rows).expect("replace optins cache");
            let loaded = db.get_parakith_opt_ins().expect("read optins cache");
            assert_eq!(loaded.len(), 2);
            db.delete_parakith_opt_in_cache(1).expect("delete optin row");
            let remaining = db.get_parakith_opt_ins().expect("read remaining optin row");
            assert_eq!(remaining.len(), 1);
            assert_eq!(remaining[0].id, 2);
        }
        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_file(db_path.with_extension("sqlite-wal"));
        let _ = std::fs::remove_file(db_path.with_extension("sqlite-shm"));
    }

    #[test]
    fn test_smoke_ipc_param_sanitization() {
        assert_eq!(sanitize_smoke_trigger(Some("scheduled")), "scheduled");
        assert_eq!(sanitize_smoke_trigger(Some("scheduled:08:00")), "scheduled:08:00");
        assert_eq!(sanitize_smoke_trigger(Some("mcp-agent")), "mcp-agent");
        assert_eq!(sanitize_smoke_trigger(Some("bad;whoami")), "mcp-agent");
        assert_eq!(sanitize_smoke_trigger(Some("")), "mcp-agent");
        assert_eq!(sanitize_smoke_trigger(None), "mcp-agent");

        assert_eq!(
            sanitize_smoke_target_url(Some("https://wsh.panoramadr.com")),
            Some("https://wsh.panoramadr.com".to_string())
        );
        assert_eq!(
            sanitize_smoke_target_url(Some("https://wsh.panoramadr.com && calc")),
            None
        );
        assert_eq!(sanitize_smoke_target_url(Some("file:///etc/passwd")), None);
        assert_eq!(sanitize_smoke_target_url(None), None);
    }

    #[test]
    fn test_cron_manifest_dto_sha256_and_wsh_snapshot_cron_telemetry() {
        assert_eq!(
            compute_normalized_lf_sha256("#!/bin/sh\r\necho hi\r\n"),
            compute_normalized_lf_sha256("#!/bin/sh\necho hi\n")
        );

        let sre: SreConfigDto = serde_json::from_str(
            r#"{
                "deployScript": "deploy-docker.ps1",
                "cronJobs": [
                    {
                        "id": "heartbeat",
                        "description": "15-minute heartbeat",
                        "schedule": "*/15 * * * *",
                        "script": "scripts/cron-heartbeat.sh"
                    }
                ],
                "cronLegacyFiles": ["legacy-job"]
            }"#,
        )
        .expect("deserialize SreConfigDto with cronJobs");
        assert_eq!(sre.cron_jobs.len(), 1);
        assert_eq!(sre.cron_jobs[0].shell, "/bin/sh");
        assert_eq!(sre.cron_jobs[0].user, "root");
        assert_eq!(sre.cron_jobs[0].log_redirect, "> /dev/null 2>&1");
        assert!(sre.cron_jobs[0].enabled);
        assert_eq!(sre.cron_legacy_files, vec!["legacy-job"]);

        let snap: WshSnapshot = serde_json::from_str(
            r#"{
                "mode": "--fast",
                "hostname": "wsh",
                "kernel": "6.12",
                "uptime_secs": 120.0,
                "dietpi_version": "9.11.0",
                "dietpi_update_available": "",
                "reboot_required": false,
                "rpi_throttled": "0x0",
                "services": { "lighttpd": "active", "docker": "active", "ssh": "active", "cron": "active" },
                "listening_ports": [443],
                "lighttpd_routes_raw": "",
                "containers": [],
                "container_stats": [],
                "images": [],
                "cloudflared": {},
                "apt_upgradable_raw": "",
                "data_volumes_raw": "",
                "docker_df": [],
                "release_ledgers": {},
                "cron_telemetry": {
                    "cron_d_files": [{ "name": "panorama-energy", "mode": "644" }],
                    "app_scripts": [],
                    "recent_runs_raw": "cron[1]: CMD (/opt/energy-analyzer/scripts/cron-heartbeat.sh)"
                }
            }"#,
        )
        .expect("deserialize WshSnapshot with cron_telemetry");
        assert_eq!(snap.services["cron"], "active");
        assert_eq!(snap.cron_telemetry["cron_d_files"][0]["name"], "panorama-energy");
    }

    #[test]
    fn test_backup_ledger_reconciles_manual_snapshots_and_same_day_recovery() {
        use chrono::{Datelike, TimeZone};
        use panorama_sre_lib::commands::ledger::read_backup_ledger_from_paths;
        use std::fs;
        use std::time::{SystemTime, UNIX_EPOCH};

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp_root = std::env::temp_dir().join(format!("panorama_sre_ledger_test_{}", unique));
        let ws_root = temp_root.join("workspaces");
        let backups_root = temp_root.join("backups");
        let energy_backup_dir = backups_root.join("EnergyAnalyzer");
        let spendy_backup_dir = backups_root.join("SpendyLedger");
        let energy_ws = ws_root.join("EnergyAnalyzer");

        fs::create_dir_all(&energy_backup_dir).unwrap();
        fs::create_dir_all(&spendy_backup_dir).unwrap();
        fs::create_dir_all(&energy_ws).unwrap();
        fs::write(
            energy_ws.join(".env.deploy"),
            format!("LOCAL_BACKUP_DIR={}\n", energy_backup_dir.display()),
        )
        .unwrap();

        let history_path = temp_root.join("backup_history.json");

        // Build 6 prior healthy days + today failed EnergyAnalyzer run at 09:00Z
        let now_local = chrono::Local::now();
        let today = now_local.date_naive();
        let mut history_entries: Vec<serde_json::Value> = Vec::new();
        for offset in (1..=6).rev() {
            let day = today - chrono::Duration::days(offset);
            let ts = format!("{}T15:00:00Z", day.format("%Y-%m-%d"));
            history_entries.push(serde_json::json!({
                "timestamp": ts,
                "status": "Success",
                "run_type": "Automated",
                "apps": {
                    "EnergyAnalyzer": { "status": "Success", "file": "db-backup_v4_old.tar.gz", "size_bytes": 1000 }
                }
            }));
        }

        let today_str = today.format("%Y-%m-%d").to_string();
        let failed_run_ts = format!("{}T09:00:02Z", today_str);
        history_entries.push(serde_json::json!({
            "timestamp": failed_run_ts,
            "status": "Failed",
            "run_type": "Automated",
            "apps": {
                "EnergyAnalyzer": { "status": "Failed", "error": "No such container: energy-analyzer" },
                "BiomedMaven": { "status": "Success", "file": "db-backup_v6_ok.tar.gz", "size_bytes": 701450 }
            }
        }));
        fs::write(
            &history_path,
            serde_json::to_string_pretty(&history_entries).unwrap(),
        )
        .unwrap();

        // 1. Before manual snapshot: EnergyAnalyzer remains Failed and 7d window has 1 failure
        let initial =
            read_backup_ledger_from_paths(&history_path, &ws_root, &backups_root, now_local)
                .unwrap();
        assert_eq!(initial.last_run_status.as_deref(), Some("Failed"));
        assert_eq!(initial.failed_runs_7d, 1);
        let ea_initial = initial
            .latest_app_details
            .iter()
            .find(|d| d.app_name == "EnergyAnalyzer")
            .unwrap();
        assert_eq!(ea_initial.status, "Failed");

        // 2. Drop an older snapshot (before 09:00Z / 02:00 AM local) AND a corrupt non-gzip file — both must be ignored
        let older_file = energy_backup_dir.join(format!("db-backup_v4_{}_01-00-00.tar.gz", today_str));
        fs::write(&older_file, b"\x1f\x8b\x08\x00older").unwrap();
        let corrupt_file = energy_backup_dir.join(format!("db-backup_v4_{}_23-59-00.tar.gz", today_str));
        fs::write(&corrupt_file, b"NOT_A_GZIP_ARCHIVE").unwrap();

        let still_failed =
            read_backup_ledger_from_paths(&history_path, &ws_root, &backups_root, now_local)
                .unwrap();
        assert_eq!(still_failed.last_run_status.as_deref(), Some("Failed"));
        assert_eq!(still_failed.failed_runs_7d, 1);

        // 3. Create valid newer gzip manual snapshot for EnergyAnalyzer
        let recovery_utc = chrono::DateTime::parse_from_rfc3339(&failed_run_ts)
            .unwrap()
            .with_timezone(&chrono::Utc)
            + chrono::Duration::hours(3);
        let recovery_local = recovery_utc.with_timezone(&chrono::Local);
        let recovery_name = format!(
            "db-backup_v4_{}.tar.gz",
            recovery_local.format("%Y-%m-%d_%H-%M-%S")
        );
        let recovery_path = energy_backup_dir.join(&recovery_name);
        let payload = b"\x1f\x8b\x08\x00\x00\x00\x00\x00\x02\x03valid-sqlite-backup-payload";
        fs::write(&recovery_path, payload).unwrap();

        let recovered =
            read_backup_ledger_from_paths(&history_path, &ws_root, &backups_root, now_local)
                .unwrap();
        assert_eq!(recovered.last_run_status.as_deref(), Some("Success"));
        assert_eq!(recovered.failed_runs_7d, 0);
        let ea_recovered = recovered
            .latest_app_details
            .iter()
            .find(|d| d.app_name == "EnergyAnalyzer")
            .unwrap();
        assert_eq!(ea_recovered.status, "Success");
        assert_eq!(ea_recovered.file.as_deref(), Some(recovery_name.as_str()));
        assert_eq!(ea_recovered.size_bytes, Some(payload.len() as u64));
        assert_eq!(ea_recovered.error, None);
        assert_eq!(
            recovered.recent_records[0].run_type.as_deref(),
            Some("Manual Snapshot")
        );
        assert_eq!(
            recovered.daily_pips_7d.last().unwrap().status,
            "Success"
        );

        // 4. Partial recovery: add SpendyLedger as Failed in latest entry -> only EnergyAnalyzer recovered -> overall stays Failed
        if let Some(last) = history_entries.last_mut() {
            last["apps"]["SpendyLedger"] =
                serde_json::json!({ "status": "Failed", "error": "SSH timeout" });
        }
        fs::write(
            &history_path,
            serde_json::to_string_pretty(&history_entries).unwrap(),
        )
        .unwrap();
        let partial =
            read_backup_ledger_from_paths(&history_path, &ws_root, &backups_root, now_local)
                .unwrap();
        assert_eq!(partial.last_run_status.as_deref(), Some("Failed"));
        assert_eq!(partial.failed_runs_7d, 1);
        assert_eq!(
            partial
                .latest_app_details
                .iter()
                .find(|d| d.app_name == "EnergyAnalyzer")
                .unwrap()
                .status,
            "Success"
        );
        assert_eq!(
            partial
                .latest_app_details
                .iter()
                .find(|d| d.app_name == "SpendyLedger")
                .unwrap()
                .status,
            "Failed"
        );

        // 5. Same-day automated retry (Failed at 09:00Z, Success at 14:00Z) clears failure in 7d window
        let retry_utc = chrono::DateTime::parse_from_rfc3339(&failed_run_ts)
            .unwrap()
            .with_timezone(&chrono::Utc)
            + chrono::Duration::hours(5);
        history_entries.push(serde_json::json!({
            "timestamp": retry_utc.to_rfc3339(),
            "status": "Success",
            "run_type": "Automated",
            "apps": {
                "EnergyAnalyzer": { "status": "Success", "file": "db-backup_v4_retry.tar.gz", "size_bytes": 52509196 },
                "SpendyLedger": { "status": "Success", "file": "db-backup_v10_retry.tar.gz", "size_bytes": 9373924 }
            }
        }));
        fs::write(
            &history_path,
            serde_json::to_string_pretty(&history_entries).unwrap(),
        )
        .unwrap();
        let retried =
            read_backup_ledger_from_paths(&history_path, &ws_root, &backups_root, now_local)
                .unwrap();
        assert_eq!(retried.last_run_status.as_deref(), Some("Success"));
        assert_eq!(retried.failed_runs_7d, 0);
        assert_eq!(retried.daily_pips_7d.last().unwrap().status, "Success");

        // 6. Cross-day partial archives (next day has only 1 of 2 apps -> Incomplete Run / Failed)
        let tomorrow = today + chrono::Duration::days(1);
        let tomorrow_str = tomorrow.format("%Y-%m-%d").to_string();
        let next_day_local = chrono::Local
            .with_ymd_and_hms(
                tomorrow.year(),
                tomorrow.month(),
                tomorrow.day(),
                8,
                0,
                0,
            )
            .single()
            .unwrap_or(now_local + chrono::Duration::days(1));

        let partial_next_day_file = energy_backup_dir.join(format!(
            "db-backup_v4_{}_02-00-05.tar.gz",
            tomorrow_str
        ));
        fs::write(&partial_next_day_file, payload).unwrap();

        let cross_day_partial =
            read_backup_ledger_from_paths(&history_path, &ws_root, &backups_root, next_day_local)
                .unwrap();
        assert_eq!(cross_day_partial.last_run_status.as_deref(), Some("Failed"));
        assert!(cross_day_partial.failed_runs_7d >= 1);
        assert_eq!(
            cross_day_partial.daily_pips_7d.last().unwrap().status,
            "Failed"
        );
        let spendy_partial = cross_day_partial
            .latest_app_details
            .iter()
            .find(|d| d.app_name == "SpendyLedger")
            .unwrap();
        assert_eq!(spendy_partial.status, "Failed");
        assert_eq!(
            cross_day_partial.recent_records[0].run_type.as_deref(),
            Some("Incomplete Run")
        );

        // 7. Active in-flight backup_run_state.json suppresses premature partial-archive failure mid-run
        let run_state_path = temp_root.join("backup_run_state.json");
        let active_started_at = (next_day_local.with_timezone(&chrono::Utc) - chrono::Duration::minutes(2)).to_rfc3339();
        fs::write(
            &run_state_path,
            serde_json::json!({
                "pid": std::process::id(),
                "started_at": active_started_at,
                "current_app": "SpendyLedger"
            })
            .to_string(),
        )
        .unwrap();
        let in_flight =
            read_backup_ledger_from_paths(&history_path, &ws_root, &backups_root, next_day_local)
                .unwrap();
        assert_eq!(in_flight.last_run_status.as_deref(), Some("Success"));

        // 8. Stale/stuck backup_run_state.json (> 20m) flags Failed with stuck app error
        let stuck_started_at = (next_day_local.with_timezone(&chrono::Utc) - chrono::Duration::minutes(25)).to_rfc3339();
        fs::write(
            &run_state_path,
            serde_json::json!({
                "pid": std::process::id(),
                "started_at": stuck_started_at,
                "current_app": "SpendyLedger"
            })
            .to_string(),
        )
        .unwrap();
        let stuck =
            read_backup_ledger_from_paths(&history_path, &ws_root, &backups_root, next_day_local)
                .unwrap();
        assert_eq!(stuck.last_run_status.as_deref(), Some("Failed"));
        assert_eq!(stuck.daily_pips_7d.last().unwrap().status, "Failed");
        let spendy_stuck = stuck
            .latest_app_details
            .iter()
            .find(|d| d.app_name == "SpendyLedger")
            .unwrap();
        assert_eq!(spendy_stuck.status, "Failed");
        assert!(spendy_stuck
            .error
            .as_deref()
            .unwrap_or("")
            .contains("SpendyLedger"));

        // 9. Completing remaining app archive & removing run_state clears partial failure to Success
        let _ = fs::remove_file(&run_state_path);
        let spendy_next_day_file = spendy_backup_dir.join(format!(
            "db-backup_v10_{}_02-00-13.tar.gz",
            tomorrow_str
        ));
        fs::write(&spendy_next_day_file, payload).unwrap();
        let cross_day_complete =
            read_backup_ledger_from_paths(&history_path, &ws_root, &backups_root, next_day_local)
                .unwrap();
        assert_eq!(
            cross_day_complete.last_run_status.as_deref(),
            Some("Success")
        );
        assert_eq!(
            cross_day_complete.daily_pips_7d.last().unwrap().status,
            "Success"
        );

        let _ = fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn test_deploy_telemetry_persistence_backfill_jsonl_and_docker_df() {
        use std::fs;

        let db = SreDatabase::new(":memory:").expect("init memory db");

        // 1. Parse modern v0.7.0 console session with [TELEMETRY], [DEPLOY-TIMING], and [TELEMETRY-WARN]
        let modern_session = ConsoleSessionRecord {
            id: "deploy-basket-1763599000".to_string(),
            title: "Deploy: TastyBasket".to_string(),
            lines: vec![
                "  PanoramaDrSuite Unified Deployer (Transactional Engine v0.7.0)".to_string(),
                "Release Identity: 1.0.10+abcdef1 | Image Tag: 1.0.10-abcdef1".to_string(),
                "Pre-build validation passed cleanly (typecheck: 2.15s).".to_string(),
                "Successfully bumped version to v1.0.10 with release commit & tag.".to_string(),
                "  [TELEMETRY] Profile=nextjs-standalone | Posture=cached | Status=OPTIMAL | Total=4.6s (Deps=0s [cached=True], NextBuild=0s, ARM64Natives=0s [cached=True], Export=2.9s, Context=340.5KB, ELF=2 [cached=True])".to_string(),
                "  [TELEMETRY-WARN] Sample non-fatal notice".to_string(),
                "--- SUITE SMOKE TEST VERIFICATION GATE ---".to_string(),
                "[DEPLOY-TIMING] Total=31.4s | S1=2.15s | Bump=1.4s | S2=4.6s | S3=0.9s | S4=3.2s | Snap=1.5s | Swap=5.8s | Verify=1.9s | Smoke=6.2s | Cron=0.8s | Finalize=2.1s".to_string(),
            ],
            is_running: false,
            exit_code: Some(0),
            created_at: Some("2026-11-21 15:00:00".to_string()),
            updated_at: Some("2026-11-21 15:00:32".to_string()),
            page_scope: Some("releases".to_string()),
            source: Some("ui".to_string()),
        };

        let modern_row =
            parse_console_session_to_telemetry(&modern_session).expect("parse modern session");
        assert_eq!(modern_row.app_slug, "basket");
        assert_eq!(modern_row.app_name, "TastyBasket");
        assert_eq!(modern_row.engine_version.as_deref(), Some("0.7.0"));
        assert_eq!(modern_row.cache_posture, "cached");
        assert_eq!(modern_row.wall_duration_sec, Some(31.4));
        assert_eq!(modern_row.host_typecheck_sec, Some(2.15));
        assert_eq!(modern_row.deps_cache_hit, Some(true));
        assert_eq!(modern_row.arm64_natives_cache_hit, Some(true));
        assert_eq!(modern_row.stage5_swap_sec, Some(5.8));
        assert!(modern_row.bumped);
        assert!(modern_row.ran_smoke);
        assert_eq!(modern_row.warnings, vec!["Sample non-fatal notice".to_string()]);

        db.upsert_deploy_telemetry_run(&modern_row, false)
            .expect("insert modern row");

        // 2. Legacy pre-v0.4.0 session falls back to timestamps and legacy posture
        let legacy_session = ConsoleSessionRecord {
            id: "deploy-water-1762400000".to_string(),
            title: "Deploy: WaterAnalyzer".to_string(),
            lines: vec!["[Stage 2/5] docker buildx build".to_string()],
            is_running: false,
            exit_code: Some(0),
            created_at: Some("2026-11-05 10:00:00".to_string()),
            updated_at: Some("2026-11-05 10:03:05".to_string()),
            page_scope: Some("releases".to_string()),
            source: Some("ui".to_string()),
        };
        let legacy_row =
            parse_console_session_to_telemetry(&legacy_session).expect("parse legacy session");
        assert_eq!(legacy_row.cache_posture, "legacy");
        assert_eq!(legacy_row.wall_duration_sec, Some(185.0));
        db.upsert_deploy_telemetry_run(&legacy_row, false)
            .expect("insert legacy row");

        // Verify purge_old_entries(28) does NOT purge deploy_telemetry_runs
        db.purge_old_entries(28).expect("purge console sessions");
        let saved_rows = db.get_deploy_telemetry_runs(100).expect("load telemetry");
        assert_eq!(saved_rows.len(), 2);

        // 3. Verify CLI JSONL ingestion
        let tmp_ws = std::env::temp_dir().join(format!(
            "panorama_sre_jsonl_{}_{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let jsonl_dir = tmp_ws.join("PanoramaDrSuite").join("tools").join("deploy-telemetry");
        fs::create_dir_all(&jsonl_dir).unwrap();
        let jsonl_line = serde_json::json!({
            "id": "cli-biomed-20261121T160000Z",
            "app_slug": "biomed",
            "app_name": "BiomedMaven",
            "started_at": "2026-11-21T16:00:00Z",
            "finished_at": "2026-11-21T16:00:25Z",
            "wall_duration_sec": 25.0,
            "exit_code": 0,
            "engine_version": "0.7.0",
            "release_id": "1.2.0+abc1234",
            "cache_posture": "warm",
            "status": "OPTIMAL",
            "build_total_sec": 18.2,
            "deps_cache_hit": true,
            "arm64_natives_cache_hit": true,
            "context_transfer_kb": 355.0,
            "bumped": false,
            "ran_smoke": true,
            "warnings_json": "[]",
            "source": "cli"
        });
        fs::write(
            jsonl_dir.join("deploy-history.jsonl"),
            format!("{}\n", jsonl_line),
        )
        .unwrap();

        let ingested = ingest_deploy_history_jsonl(&tmp_ws.to_string_lossy(), &db);
        assert_eq!(ingested, 1);
        let after_ingest = db.get_deploy_telemetry_runs(100).expect("load after jsonl");
        assert_eq!(after_ingest.len(), 3);
        assert_eq!(after_ingest[0].id, "cli-biomed-20261121T160000Z");

        let _ = fs::remove_dir_all(&tmp_ws);

        // 4. Verify docker system df JSON + size unit parser
        assert_eq!(parse_docker_size_bytes("107.1GB (100%)"), 107_100_000_000);
        assert_eq!(parse_docker_size_bytes("651.8MB"), 651_800_000);
        assert_eq!(parse_docker_size_bytes("0B"), 0);

        let df_sample = r#"{"Active":"0","Reclaimable":"4.15GB (100%)","Size":"4.15GB","TotalCount":"2","Type":"Images"}
{"Active":"0","Reclaimable":"0B","Size":"0B","TotalCount":"0","Type":"Containers"}
{"Active":"0","Reclaimable":"0B (0%)","Size":"0B","TotalCount":"0","Type":"Local Volumes"}
{"Active":"12","Reclaimable":"95.4GB (89%)","Size":"107.1GB","TotalCount":"973","Type":"Build Cache"}"#;
        let parsed_df = parse_docker_system_df_json(df_sample).expect("parse df json");
        assert_eq!(parsed_df.images.total_count, 2);
        assert_eq!(parsed_df.images.size_bytes, 4_150_000_000);
        assert_eq!(parsed_df.build_cache.total_count, 973);
        assert_eq!(parsed_df.build_cache.size_bytes, 107_100_000_000);
        assert_eq!(parsed_df.build_cache.reclaimable_bytes, 95_400_000_000);

        // 5. Verify sanitize_smoke_trigger allows comma-separated batch slugs up to 96 chars
        assert_eq!(
            sanitize_smoke_trigger(Some("deploy:batch:auth,spendy,biomed,water,basket,energy")),
            "deploy:batch:auth,spendy,biomed,water,basket,energy"
        );
    }
}
