#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    panorama_sre_lib::run();
}

#[cfg(test)]
mod tests {
    use panorama_sre_lib::db::SreDatabase;
    use panorama_sre_lib::dev_supervisor::is_dev_server_ready_line;

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
}
