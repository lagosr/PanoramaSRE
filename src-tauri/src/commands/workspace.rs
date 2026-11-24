use crate::db::SreDatabase;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;

#[tauri::command]
pub async fn exit_app_completely(
    app: tauri::AppHandle,
    dev_supervisor: tauri::State<'_, std::sync::Arc<crate::dev_supervisor::DevSupervisor>>,
    job_manager: tauri::State<'_, std::sync::Arc<crate::job_manager::JobManager>>,
) -> Result<(), String> {
    crate::control_server::cleanup_current_lease();
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
#[serde(rename_all = "camelCase")]
pub struct CloudflareConfigDto {
    pub pages_project: String,
    pub primary_url: String,
    #[serde(default)]
    pub domains: Vec<String>,
    #[serde(default)]
    pub d1_binding: Option<String>,
    #[serde(default)]
    pub d1_database_name: Option<String>,
    #[serde(default)]
    pub d1_database_id: Option<String>,
    #[serde(default)]
    pub deploy_mode: Option<String>,
}

fn default_cron_shell() -> String {
    "/bin/sh".to_string()
}

fn default_cron_user() -> String {
    "root".to_string()
}

fn default_cron_log_redirect() -> String {
    "> /dev/null 2>&1".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronJobDto {
    pub id: String,
    pub description: String,
    pub schedule: String,
    pub script: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default = "default_cron_shell")]
    pub shell: String,
    #[serde(default = "default_cron_user")]
    pub user: String,
    #[serde(default = "default_cron_log_redirect")]
    pub log_redirect: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub local_script_exists: bool,
    #[serde(default)]
    pub local_script_sha256: Option<String>,
}

pub fn compute_normalized_lf_sha256(content: &str) -> String {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let digest = Sha256::digest(normalized.as_bytes());
    digest.iter().map(|b| format!("{:02x}", b)).collect::<String>()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceConfigDto {
    pub protocol: String,
    pub bind_ip: String,
    pub network_name: String,
    pub network_subnet: String,
    #[serde(default)]
    pub host_env_path: Option<String>,
    #[serde(default)]
    pub host_log_path: Option<String>,
    #[serde(default)]
    pub optional_deployment: bool,
    #[serde(default)]
    pub requires_wsh_firewall: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SreConfigDto {
    #[serde(default)]
    pub deploy_script: Option<String>,
    #[serde(default)]
    pub db_script: Option<String>,
    #[serde(default)]
    pub dev_command: Option<String>,
    #[serde(default)]
    pub preview_command: Option<String>,
    #[serde(default)]
    pub health_endpoint: Option<String>,
    #[serde(default)]
    pub health_check_mode: Option<String>,
    #[serde(default)]
    pub health_auth_mode: Option<String>,
    #[serde(default)]
    pub manifest_endpoint: Option<String>,
    #[serde(default)]
    pub test_command: Option<String>,
    #[serde(default)]
    pub typecheck_command: Option<String>,
    #[serde(default)]
    pub requires_auth_in_dev: bool,
    #[serde(default)]
    pub automated_backup_default: bool,
    #[serde(default = "default_true")]
    pub expose_in_remote_portal: bool,
    #[serde(default)]
    pub supports_rollback: Option<bool>,
    #[serde(default)]
    pub supports_dry_run: Option<bool>,
    #[serde(default)]
    pub supports_verify_local: Option<bool>,
    #[serde(default)]
    pub supports_status: Option<bool>,
    #[serde(default)]
    pub supports_stop: Option<bool>,
    #[serde(default)]
    pub cron_jobs: Vec<CronJobDto>,
    #[serde(default)]
    pub cron_legacy_files: Vec<String>,
}

fn default_true() -> bool {
    true
}

fn default_hosting_target() -> String {
    "wsh-docker".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppManifestDto {
    pub schema_version: Option<i32>,
    pub app_id: Option<String>,
    pub slug: String,
    #[serde(rename = "hostingTarget", default = "default_hosting_target")]
    pub hosting_target: String,
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
    #[serde(rename = "portalOrder")]
    pub portal_order: Option<u32>,
    #[serde(default)]
    pub dev_command: Option<String>,
    #[serde(default)]
    pub requires_auth_in_dev: bool,
    #[serde(default)]
    pub cloudflare: Option<CloudflareConfigDto>,
    #[serde(default)]
    pub service: Option<ServiceConfigDto>,
    #[serde(default)]
    pub sre: Option<SreConfigDto>,
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

pub fn load_manifest_from_dir(path: &Path) -> Option<DiscoveredAppDto> {
    if !path.is_dir() {
        return None;
    }
    let manifest_path = path.join("panorama.app.json");
    if !manifest_path.exists() {
        return None;
    }
    let content = fs::read_to_string(&manifest_path).ok()?;
    let content_clean = content.trim_start_matches('\u{feff}');
    let manifest_val = serde_json::from_str::<serde_json::Value>(content_clean).ok()?;
    let slug = manifest_val["slug"].as_str().unwrap_or("").to_string();
    if slug.is_empty() {
        return None;
    }
    // Exclude desktop control plane itself
    let app_id_str = manifest_val["appId"].as_str().unwrap_or(&slug);
    if slug == "sre" || app_id_str == "sre" {
        return None;
    }

    let display_name = manifest_val["displayName"]
        .as_str()
        .unwrap_or(&slug)
        .to_string();
    let base_path = manifest_val["basePath"].as_str().unwrap_or("").to_string();
    let port = manifest_val["port"].as_u64().unwrap_or(3000) as u16;
    let hosting_target = manifest_val
        .get("hostingTarget")
        .and_then(|v| v.as_str())
        .unwrap_or("wsh-docker")
        .to_string();
    let sre_block = manifest_val.get("sre");
    let mut sre_dto = sre_block
        .and_then(|v| serde_json::from_value::<SreConfigDto>(v.clone()).ok());
    if let Some(ref mut sre) = sre_dto {
        for job in sre.cron_jobs.iter_mut() {
            let rel_clean = job.script.trim().replace('\\', "/");
            if rel_clean.starts_with("scripts/") && !rel_clean.contains("..") {
                let script_path = path.join(rel_clean.replace('/', std::path::MAIN_SEPARATOR_STR));
                if let Ok(raw) = fs::read_to_string(&script_path) {
                    job.local_script_exists = true;
                    job.local_script_sha256 = Some(compute_normalized_lf_sha256(&raw));
                } else {
                    job.local_script_exists = false;
                    job.local_script_sha256 = None;
                }
            } else {
                job.local_script_exists = false;
                job.local_script_sha256 = None;
            }
        }
    }
    let cloudflare_dto = manifest_val
        .get("cloudflare")
        .and_then(|v| serde_json::from_value::<CloudflareConfigDto>(v.clone()).ok());
    let service_dto = manifest_val
        .get("service")
        .and_then(|v| serde_json::from_value::<ServiceConfigDto>(v.clone()).ok());

    let dev_command = sre_dto
        .as_ref()
        .and_then(|s| s.dev_command.clone())
        .or_else(|| {
            sre_block
                .and_then(|s| s.get("devCommand"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        });
    let requires_auth_in_dev = sre_block
        .and_then(|s| s.get("requiresAuthInDev"))
        .and_then(|v| v.as_bool())
        .unwrap_or(
            hosting_target == "wsh-docker" && slug != "auth" && slug != "res",
        );

    let dto = AppManifestDto {
        schema_version: manifest_val["schemaVersion"].as_i64().map(|v| v as i32),
        app_id: manifest_val["appId"].as_str().map(|s| s.to_string()),
        slug,
        hosting_target,
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
        has_database: manifest_val
            .get("hasDatabase")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        portal_order: manifest_val
            .get("portalOrder")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        dev_command,
        requires_auth_in_dev,
        cloudflare: cloudflare_dto,
        service: service_dto,
        sre: sre_dto,
    };

    Some(DiscoveredAppDto {
        manifest: dto,
        workspace_path: path.to_string_lossy().to_string(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
    })
}

pub fn discover_suite_apps_in_root(root: &Path) -> Result<Vec<DiscoveredAppDto>, String> {
    let mut apps = Vec::new();
    let mut seen_slugs = std::collections::HashSet::new();
    let entries = fs::read_dir(root).map_err(|e| format!("Failed to read workspace root: {}", e))?;

    for entry in entries.flatten() {
        if let Some(app) = load_manifest_from_dir(&entry.path()) {
            let key = app.manifest.slug.to_lowercase();
            if seen_slugs.insert(key) {
                apps.push(app);
            }
        }
    }

    // Also discover first-class containerized tools/services nested under PanoramaDrSuite/tools/*
    let suite_tools_dir = root.join("PanoramaDrSuite").join("tools");
    if suite_tools_dir.is_dir() {
        if let Ok(tool_entries) = fs::read_dir(&suite_tools_dir) {
            for entry in tool_entries.flatten() {
                if let Some(app) = load_manifest_from_dir(&entry.path()) {
                    let key = app.manifest.slug.to_lowercase();
                    if seen_slugs.insert(key) {
                        apps.push(app);
                    }
                }
            }
        }
    }

    // Sort stably by port
    apps.sort_by_key(|a| a.manifest.port);
    Ok(apps)
}

pub fn discover_suite_apps_internal(
    db: &Arc<Mutex<SreDatabase>>,
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
    discover_suite_apps_in_root(&root)
}

#[tauri::command]
pub async fn discover_suite_apps(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    workspace_root: Option<String>,
) -> Result<Vec<DiscoveredAppDto>, String> {
    discover_suite_apps_internal(&db, workspace_root)
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
