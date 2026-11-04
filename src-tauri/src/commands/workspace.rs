use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;
use crate::db::SreDatabase;

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

#[tauri::command]
pub fn open_in_file_manager(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    #[cfg(windows)]
    {
        use std::process::Command;
        if p.is_dir() {
            Command::new("explorer")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open directory in Explorer: {}", e))?;
        } else {
            Command::new("explorer")
                .arg(format!("/select,{}", path))
                .spawn()
                .map_err(|e| format!("Failed to reveal file in Explorer: {}", e))?;
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        Err("Unsupported operating system for file manager command".to_string())
    }
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
    #[serde(rename = "hasDatabase")]
    pub has_database: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredAppDto {
    pub manifest: AppManifestDto,
    pub workspace_path: String,
    pub manifest_path: String,
}

fn dir_has_suite_apps(dir: &Path) -> bool {
    if let Ok(entries) = fs::read_dir(dir) {
        entries.flatten().any(|e| {
            e.path().is_dir() && e.path().join("panorama.app.json").exists()
        })
    } else {
        false
    }
}

pub fn resolve_suite_workspace_root(configured: Option<&str>) -> PathBuf {
    // 1. If explicitly configured by user setting or parameter, verify and return if valid
    if let Some(cfg) = configured {
        let p = PathBuf::from(cfg.trim());
        if !p.as_os_str().is_empty() && p.exists() {
            return p;
        }
    }

    // 2. Check environment variable PANORAMA_WORKSPACE_ROOT
    if let Ok(env_root) = std::env::var("PANORAMA_WORKSPACE_ROOT") {
        let p = PathBuf::from(env_root.trim());
        if !p.as_os_str().is_empty() && p.exists() {
            return p;
        }
    }

    // 3. Search up from current working directory
    if let Ok(cwd) = std::env::current_dir() {
        let mut search_dir = cwd;
        for _ in 0..6 {
            if dir_has_suite_apps(&search_dir) {
                return search_dir;
            }
            if let Some(parent) = search_dir.parent() {
                search_dir = parent.to_path_buf();
            } else {
                break;
            }
        }
    }

    // 4. Search up from current executable directory (useful during cargo run/debug)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let mut search_dir = exe_dir.to_path_buf();
            for _ in 0..6 {
                if dir_has_suite_apps(&search_dir) {
                    return search_dir;
                }
                if let Some(parent) = search_dir.parent() {
                    search_dir = parent.to_path_buf();
                } else {
                    break;
                }
            }
        }
    }

    // 5. Well-known user development locations fallback (crucial for MSI / installed exe in Program Files)
    let mut candidate_locations: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            let up = PathBuf::from(&userprofile);
            candidate_locations.push(up.join("Documents").join("AG Projects"));
            candidate_locations.push(up.join("Documents").join("Projects"));
            candidate_locations.push(up.join("source").join("repos"));
            candidate_locations.push(up.join("Projects"));
        }
        if let Ok(onedrive) = std::env::var("OneDrive") {
            let odp = PathBuf::from(&onedrive);
            candidate_locations.push(odp.join("Documents").join("AG Projects"));
        }
    }

    #[cfg(not(windows))]
    {
        if let Ok(home) = std::env::var("HOME") {
            let hp = PathBuf::from(&home);
            candidate_locations.push(hp.join("Documents").join("AG Projects"));
            candidate_locations.push(hp.join("Projects"));
        }
    }

    for candidate in candidate_locations {
        if candidate.exists() && (dir_has_suite_apps(&candidate) || candidate.is_dir()) {
            if dir_has_suite_apps(&candidate) {
                return candidate;
            }
        }
    }

    // Default fallback to current dir
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

#[tauri::command]
pub async fn get_workspace_setting(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
) -> Result<String, String> {
    let configured = {
        let guard = db.lock().map_err(|e| e.to_string())?;
        guard.get_setting("workspace_root").map_err(|e| e.to_string())?
    };

    let resolved = resolve_suite_workspace_root(configured.as_deref());
    Ok(resolved.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn save_workspace_setting(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    workspace_root: String,
) -> Result<String, String> {
    let clean = workspace_root.trim().to_string();
    let p = PathBuf::from(&clean);
    if !clean.is_empty() && !p.exists() {
        return Err(format!("Specified workspace directory does not exist: {}", clean));
    }

    {
        let guard = db.lock().map_err(|e| e.to_string())?;
        guard.set_setting("workspace_root", &clean).map_err(|e| e.to_string())?;
    }

    let resolved = resolve_suite_workspace_root(if clean.is_empty() { None } else { Some(&clean) });
    Ok(resolved.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn discover_suite_apps(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    workspace_root: Option<String>,
) -> Result<Vec<DiscoveredAppDto>, String> {
    let configured = if let Some(r) = workspace_root {
        if !r.trim().is_empty() {
            Some(r)
        } else {
            None
        }
    } else {
        let guard = db.lock().map_err(|e| e.to_string())?;
        guard.get_setting("workspace_root").map_err(|e| e.to_string())?
    };

    let root = resolve_suite_workspace_root(configured.as_deref());

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
                                has_database: manifest_val.get("hasDatabase").and_then(|v| v.as_bool()).unwrap_or(true),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dir_has_suite_apps_on_non_existent_path() {
        let dummy = Path::new("C:/non/existent/path/for/unit/test");
        assert!(!dir_has_suite_apps(dummy));
    }

    #[test]
    fn test_resolve_suite_workspace_root_prefers_valid_explicit() {
        let cwd = std::env::current_dir().unwrap();
        let resolved = resolve_suite_workspace_root(Some(&cwd.to_string_lossy()));
        assert_eq!(resolved, cwd);
    }
}
