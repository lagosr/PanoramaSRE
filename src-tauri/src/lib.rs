pub mod commands {
    pub mod cloudflare_ops;
    pub mod dietpi_ops;
    pub mod git_ops;
    pub mod ledger;
    pub mod local_backups;
    pub mod log_ops;
    pub mod monitor;
    pub mod optin_ops;
    pub mod runner;
    pub mod smoke_ops;
    pub mod ssl_ops;
    pub mod telemetry_ops;
    pub mod threat_intel_ops;
    pub mod unifi_ops;
    pub mod workspace;
}
pub mod control_server;
pub mod db;
pub mod dev_supervisor;
pub mod ipc_security;
pub mod job_manager;
pub mod notifications;
pub mod pushover;
pub mod scheduler;
pub mod scrubber;
pub mod tray;

use commands::cloudflare_ops::*;
use commands::dietpi_ops::*;
use commands::git_ops::*;
use commands::ledger::*;
use commands::local_backups::*;
use commands::log_ops::*;
use commands::monitor::*;
use commands::optin_ops::*;
use commands::runner::*;
use commands::smoke_ops::*;
use commands::ssl_ops::*;
use commands::telemetry_ops::*;
use commands::threat_intel_ops::*;
use commands::workspace::*;
use db::SreDatabase;
use dev_supervisor::{get_dev_servers_status, start_dev_server, stop_dev_server, DevSupervisor};
use job_manager::JobManager;
use pushover::{
    dismiss_backup_incident, evaluate_and_notify_sync, get_dismissed_backup_incidents,
    get_pushover_settings, reset_pushover_alert_baseline, save_pushover_settings,
    send_test_pushover_notification,
};
use scheduler::{TelemetryScheduler, update_scheduler_intervals};
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub fn resolve_sre_db_path() -> std::path::PathBuf {
    // 1. If running in local dev repository or directory with existing data/sre.sqlite, use local
    let local_data = std::path::Path::new("data/sre.sqlite");
    if local_data.exists() || std::path::Path::new("data").is_dir() {
        return local_data.to_path_buf();
    }

    // 2. Fallback to AppData Local directory (e.g. C:\Users\<user>\AppData\Local\com.panoramadr.sre\data\sre.sqlite)
    #[cfg(windows)]
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let app_dir = std::path::Path::new(&local_app_data).join("com.panoramadr.sre").join("data");
        std::fs::create_dir_all(&app_dir).ok();
        return app_dir.join("sre.sqlite");
    }

    #[cfg(not(windows))]
    if let Ok(home) = std::env::var("HOME") {
        let app_dir = std::path::Path::new(&home).join(".local").join("share").join("com.panoramadr.sre").join("data");
        std::fs::create_dir_all(&app_dir).ok();
        return app_dir.join("sre.sqlite");
    }

    local_data.to_path_buf()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let job_manager = Arc::new(JobManager::new());
    let job_manager_clone = Arc::clone(&job_manager);
    let dev_supervisor = Arc::new(DevSupervisor::new());
    let dev_supervisor_clone = Arc::clone(&dev_supervisor);
    let scheduler = Arc::new(TelemetryScheduler::new());
    let scheduler_clone = Arc::clone(&scheduler);

    // Initialize SQLite DB in resolved persistent path
    let db_path = resolve_sre_db_path();
    let sre_db = Arc::new(Mutex::new(
        SreDatabase::new(&db_path).unwrap_or_else(|_| {
            SreDatabase::new("sre.sqlite").expect("Failed to initialize SQLite database")
        })
    ));
    let sre_db_clone = Arc::clone(&sre_db);
    let dev_supervisor_ipc = Arc::clone(&dev_supervisor);
    let sre_db_threat = Arc::clone(&sre_db);
    let dev_supervisor_threat = Arc::clone(&dev_supervisor);

    {
        if let Ok(guard) = sre_db.lock() {
            let _ = guard.log_action("SYSTEM", "INFO", "PanoramaSRE Control Plane Initialized", None);
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .manage(job_manager)
        .manage(dev_supervisor)
        .manage(scheduler)
        .manage(sre_db)
        .invoke_handler(tauri::generate_handler![
            discover_suite_apps,
            get_workspace_setting,
            save_workspace_setting,
            run_process_stream,
            abort_process,
            list_active_jobs,
            compute_app_composition,
            detect_network_posture,
            probe_host_tcp,
            probe_app_health,
            probe_appliances,
            check_cloudflare_tunnel_version,
            update_scheduler_intervals,
            get_dev_servers_status,
            start_dev_server,
            stop_dev_server,
            scan_local_backups,
            fetch_wsh_snapshot,
            read_backup_ledger,
            check_pageant_status,
            launch_pageant_with_key,
            get_ssl_fleet_status,
            get_system_logs,
            clear_system_logs,
            save_console_session,
            get_saved_console_sessions,
            delete_console_session,
            delete_all_console_sessions,
            open_in_file_manager,
            exit_app_completely,
            get_smoke_test_history,
            run_smoke_tests_now,
            get_deploy_telemetry_history,
            get_local_docker_disk_usage,
            list_cloudflare_deployments,
            get_cached_parakith_opt_ins,
            sync_parakith_opt_ins,
            mark_parakith_opt_ins_seen,
            export_parakith_opt_ins,
            delete_parakith_opt_in,
            control_server::get_mcp_bridge_status,
            get_pushover_settings,
            save_pushover_settings,
            reset_pushover_alert_baseline,
            send_test_pushover_notification,
            evaluate_and_notify_sync,
            get_dismissed_backup_incidents,
            dismiss_backup_incident,
            get_threat_intel_settings,
            save_threat_intel_settings,
            test_cloudflare_threat_connection,
            test_unifi_connection,
            test_wsh_security_probe,
            test_gemini_connection,
            run_threat_audit_now,
            escalate_threat_run_to_carbon,
            get_threat_audit_runs,
            get_threat_run_detail,
            get_threat_actors,
            set_threat_actor_disposition,
            get_lan_clients_baseline,
            set_lan_client_trusted,
            trust_all_lan_clients,
            get_unifi_network_topology,
            get_threat_allowlist,
            upsert_threat_allowlist,
            delete_threat_allowlist,
            get_cloudflare_waf_rules,
            upsert_waf_rule_override,
            delete_waf_rule_override,
            get_unifi_siem_env_config,
            save_unifi_siem_env_config,
            get_windows_autostart_status,
            set_windows_autostart
        ])
        .setup(move |app| {
            // Setup System Tray
            if let Err(e) = tray::setup_tray(app.handle()) {
                eprintln!("[WARN] Failed to initialize system tray: {}", e);
            }

            // Start background TelemetryScheduler
            scheduler_clone.start(app.handle().clone());

            // Start 360 Threat Intelligence & Zero Trust 6h scheduler
            commands::threat_intel_ops::spawn_threat_audit_scheduler(
                app.handle().clone(),
                Arc::clone(&sre_db_threat),
                Arc::clone(&dev_supervisor_threat),
            );

            // Start Zero-Trust Named Pipe IPC Control Server for AI Agent MCP Bridge
            control_server::start_control_server(
                app.handle().clone(),
                Arc::clone(&dev_supervisor_ipc),
                Arc::clone(&sre_db_clone),
            );

            // Window close-to-tray handler per ADR-01
            if let Some(window) = app.get_webview_window("main") {
                if std::env::args().any(|arg| arg == "--minimized") {
                    let _ = window.hide();
                }
                if let Ok(app_icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png")) {
                    let _ = window.set_icon(app_icon);
                } else if let Some(default_icon) = app.default_window_icon().cloned() {
                    let _ = window.set_icon(default_icon);
                }

                let jm = Arc::clone(&job_manager_clone);
                let ds = Arc::clone(&dev_supervisor_clone);

                window.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::Destroyed => {
                            control_server::cleanup_current_lease();
                            ds.stop_all();
                            let jm_task = Arc::clone(&jm);
                            tokio::spawn(async move {
                                jm_task.abort_all().await;
                            });
                        }
                        _ => {}
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running PanoramaSRE application");
}
