use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub async fn exit_app_completely(
    app: tauri::AppHandle,
    dev_supervisor: tauri::State<'_, std::sync::Arc<crate::dev_supervisor::DevSupervisor>>,
    job_manager: tauri::State<'_, std::sync::Arc<crate::job_manager::JobManager>>,
) -> Result<(), String> {
    dev_supervisor.stop_all();
    job_manager.abort_all().await;
    app.exit(0);
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppManifestDto {
    pub schema_version: Option<i32>,
    pub app_id: Option<String>,
    pub slug: String,
    pub display_name: String,
    pub portal_title: Option<String>,
    pub description: Option<String>,
    pub base_path: String,
    pub port: u16,
    pub container_name: Option<String>,
    pub remote_app_root: Option<String>,
    pub data_volume: Option<String>,
    pub local_sqlite_path: Option<String>,
    pub theme_color: Option<String>,
    pub icon: Option<String>,
    pub has_database: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredAppDto {
    pub manifest: AppManifestDto,
    pub workspace_path: String,
    pub manifest_path: String,
}

#[tauri::command]
pub fn discover_suite_apps(workspace_root: Option<String>) -> Result<Vec<DiscoveredAppDto>, String> {
    let root = match workspace_root {
        Some(r) => PathBuf::from(r),
        None => {
            // Find root by checking standard AG Projects parent directory
            // or searching up until we find child apps with panorama.app.json
            let mut candidate = std::env::current_dir().map_err(|e| e.to_string())?;
            if let Ok(exe) = std::env::current_exe() {
                if let Some(exe_dir) = exe.parent() {
                    candidate = exe_dir.to_path_buf();
                }
            }

            // Climb up looking for the workspace umbrella directory containing child apps
            let mut search_dir = candidate.clone();
            let mut resolved = candidate.clone();
            for _ in 0..6 {
                // Check if this dir contains directories with panorama.app.json
                if let Ok(entries) = fs::read_dir(&search_dir) {
                    let has_child_apps = entries.flatten().any(|e| {
                        e.path().is_dir() && e.path().join("panorama.app.json").exists()
                    });
                    if has_child_apps {
                        resolved = search_dir;
                        break;
                    }
                }
                if let Some(parent) = search_dir.parent() {
                    search_dir = parent.to_path_buf();
                } else {
                    break;
                }
            }
            resolved
        }
    };

    let mut apps = Vec::new();
    let entries = fs::read_dir(&root).map_err(|e| format!("Failed to read workspace root: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let manifest_path = path.join("panorama.app.json");
            if manifest_path.exists() {
                if let Ok(content) = fs::read_to_string(&manifest_path) {
                    // Normalize JSON and deserialize
                    let content_clean = content.trim_start_matches('\u{feff}');
                    if let Ok(manifest_val) = serde_json::from_str::<serde_json::Value>(content_clean) {
                        let slug = manifest_val["slug"].as_str().unwrap_or("").to_string();
                        let display_name = manifest_val["displayName"].as_str().unwrap_or(&slug).to_string();
                        let base_path = manifest_val["basePath"].as_str().unwrap_or("").to_string();
                        let port = manifest_val["port"].as_u64().unwrap_or(3000) as u16;

                        // Exclude desktop control plane itself or non-web apps
                        let app_id_str = manifest_val["appId"].as_str().unwrap_or(&slug);
                        if slug == "sre" || app_id_str == "sre" {
                            continue;
                        }

                        if !slug.is_empty() {
                            let dto = AppManifestDto {
                                schema_version: manifest_val["schemaVersion"].as_i64().map(|v| v as i32),
                                app_id: manifest_val["appId"].as_str().map(|s| s.to_string()),
                                slug,
                                display_name,
                                portal_title: manifest_val["portalTitle"].as_str().map(|s| s.to_string()),
                                description: manifest_val["description"].as_str().map(|s| s.to_string()),
                                base_path,
                                port,
                                container_name: manifest_val["containerName"].as_str().map(|s| s.to_string()),
                                remote_app_root: manifest_val["remoteAppRoot"].as_str().map(|s| s.to_string()),
                                data_volume: manifest_val["dataVolume"].as_str().map(|s| s.to_string()),
                                local_sqlite_path: manifest_val["localSqlitePath"].as_str().map(|s| s.to_string()),
                                theme_color: manifest_val["themeColor"].as_str().map(|s| s.to_string()),
                                icon: manifest_val["icon"].as_str().map(|s| s.to_string()),
                                has_database: manifest_val["hasDatabase"].as_bool(),
                            };

                            apps.push(DiscoveredAppDto {
                                manifest: dto,
                                workspace_path: path.to_string_lossy().to_string(),
                                manifest_path: manifest_path.to_string_lossy().to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    // Sort stably by port
    apps.sort_by_key(|a| a.manifest.port);
    Ok(apps)
}
