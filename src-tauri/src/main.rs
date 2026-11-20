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
    use panorama_sre_lib::db::{OptInCacheRow, SreDatabase};
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
}
