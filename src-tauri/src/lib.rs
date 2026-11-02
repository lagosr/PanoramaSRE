pub mod commands {
    pub mod dietpi_ops;
    pub mod git_ops;
    pub mod ledger;
    pub mod local_backups;
    pub mod log_ops;
    pub mod monitor;
    pub mod runner;
    pub mod ssl_ops;
    pub mod workspace;
}
pub mod db;
pub mod dev_supervisor;
pub mod job_manager;
pub mod notifications;
pub mod scheduler;
pub mod scrubber;
pub mod tray;

use commands::dietpi_ops::*;
use commands::git_ops::*;
use commands::ledger::*;
use commands::local_backups::*;
use commands::log_ops::*;
use commands::monitor::*;
use commands::runner::*;
use commands::ssl_ops::*;
use commands::workspace::*;
use db::SreDatabase;
use dev_supervisor::{get_dev_servers_status, start_dev_server, stop_dev_server, DevSupervisor};
use job_manager::JobManager;
use scheduler::TelemetryScheduler;
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let job_manager = Arc::new(JobManager::new());
    let job_manager_clone = Arc::clone(&job_manager);
    let dev_supervisor = Arc::new(DevSupervisor::new());
    let dev_supervisor_clone = Arc::clone(&dev_supervisor);
    let scheduler = Arc::new(TelemetryScheduler::new());
    let scheduler_clone = Arc::clone(&scheduler);

    // Initialize SQLite DB in data/sre.sqlite
    let sre_db = Arc::new(Mutex::new(
        SreDatabase::new("data/sre.sqlite").unwrap_or_else(|_| {
            SreDatabase::new("sre.sqlite").expect("Failed to initialize SQLite database")
        })
    ));

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
            run_process_stream,
            abort_process,
            list_active_jobs,
            compute_app_composition,
            detect_network_posture,
            probe_app_health,
            probe_appliances,
            get_dev_servers_status,
            start_dev_server,
            stop_dev_server,
            scan_local_backups,
            fetch_wsh_snapshot,
            read_backup_ledger,
            get_ssl_fleet_status,
            get_system_logs,
            clear_system_logs,
            save_console_session,
            get_saved_console_sessions,
            delete_console_session,
            delete_all_console_sessions,
            exit_app_completely
        ])
        .setup(move |app| {
            // Setup System Tray
            if let Err(e) = tray::setup_tray(app.handle()) {
                eprintln!("[WARN] Failed to initialize system tray: {}", e);
            }

            // Start background TelemetryScheduler
            scheduler_clone.start(app.handle().clone());

            // Window close-to-tray handler per ADR-01
            if let Some(window) = app.get_webview_window("main") {
                let jm = Arc::clone(&job_manager_clone);
                let ds = Arc::clone(&dev_supervisor_clone);

                window.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::Destroyed => {
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
