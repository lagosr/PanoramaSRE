use crate::commands::dietpi_ops::get_cached_cloudflared_version_raw;
use crate::db::SreDatabase;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::ToSocketAddrs;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const CF_VERSION_COOLDOWN_SECS: u64 = 55 * 60;
const CF_VERSION_SETTING_KEY: &str = "cf_tunnel_version_cache";
const GITHUB_CLOUDFLARED_LATEST_API: &str =
    "https://api.github.com/repos/cloudflare/cloudflared/releases/latest";

fn shared_lan_client() -> Option<&'static reqwest::Client> {
    static CLIENT: OnceLock<Option<reqwest::Client>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .pool_idle_timeout(Duration::from_secs(90))
                .danger_accept_invalid_certs(true)
                .build()
                .ok()
        })
        .as_ref()
}

fn shared_appliance_client() -> Option<&'static reqwest::Client> {
    static CLIENT: OnceLock<Option<reqwest::Client>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(3))
                .pool_idle_timeout(Duration::from_secs(90))
                .danger_accept_invalid_certs(true)
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .ok()
        })
        .as_ref()
}

fn shared_github_client() -> Option<&'static reqwest::Client> {
    static CLIENT: OnceLock<Option<reqwest::Client>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(10))
                .pool_idle_timeout(Duration::from_secs(120))
                .user_agent("PanoramaSRE-Monitor/1.0")
                .build()
                .ok()
        })
        .as_ref()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum NetworkPosture {
    #[serde(rename = "LAN_DIRECT")]
    LanDirect,
    #[serde(rename = "WAN_CLOUDFLARE")]
    WanCloudflare,
    #[serde(rename = "OFFLINE")]
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseInfo {
    pub release_id: Option<String>,
    pub semver: Option<String>,
    pub image_tag: Option<String>,
    pub commit_sha: Option<String>,
    pub commit_short: Option<String>,
    pub commit_subject: Option<String>,
    pub branch: Option<String>,
    pub dirty: Option<bool>,
    pub deployed_at: Option<String>,
    pub deps_lock_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppHealthResponse {
    pub status: String,
    pub version: Option<String>,
    pub deployed_at: Option<String>,
    pub database: Option<String>,
    pub timestamp: Option<String>,
    pub release: Option<serde_json::Value>,
    pub metrics: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbedAppHealth {
    pub app_id: String,
    pub status: String, // "healthy" | "unhealthy" | "unreachable"
    pub latency_ms: u64,
    pub health: Option<AppHealthResponse>,
    pub raw_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplianceStatus {
    pub key: String,
    pub name: String,
    pub host: String,
    pub status: String, // "ONLINE" | "OFFLINE"
    pub http_code: Option<u16>,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostVitals {
    pub cpu_temp: Option<f32>,
    pub uptime_secs: Option<u64>,
    pub throttled: Option<String>,
    pub is_throttled: bool,
    pub temp_alert: bool,
}

/// Detects split-DNS network posture:
/// Resolves wsh.panoramadr.com to an IP.
/// RFC1918 (10.*, 172.16-31.*, 192.168.*) => LAN_DIRECT
/// Non-RFC1918 public IP => WAN_CLOUDFLARE
/// Resolve failed => OFFLINE
#[tauri::command]
pub async fn detect_network_posture(target_host: Option<String>) -> NetworkPosture {
    let host = target_host.unwrap_or_else(|| "wsh.panoramadr.com".to_string());
    tokio::task::spawn_blocking(move || {
        let socket_addr = format!("{}:443", host);
        match socket_addr.to_socket_addrs() {
            Ok(mut addrs) => {
                if let Some(addr) = addrs.next() {
                    let ip = addr.ip();
                    if ip.is_loopback() {
                        NetworkPosture::LanDirect
                    } else {
                        match ip {
                            std::net::IpAddr::V4(v4) => {
                                let octets = v4.octets();
                                if octets[0] == 10
                                    || (octets[0] == 172 && (16..=31).contains(&octets[1]))
                                    || (octets[0] == 192 && octets[1] == 168)
                                {
                                    NetworkPosture::LanDirect
                                } else {
                                    NetworkPosture::WanCloudflare
                                }
                            }
                            std::net::IpAddr::V6(v6) => {
                                // Unique local address (fc00::/7)
                                if (v6.segments()[0] & 0xfe00) == 0xfc00 {
                                    NetworkPosture::LanDirect
                                } else {
                                    NetworkPosture::WanCloudflare
                                }
                            }
                        }
                    }
                } else {
                    NetworkPosture::Offline
                }
            }
            Err(_) => NetworkPosture::Offline,
        }
    })
    .await
    .unwrap_or(NetworkPosture::Offline)
}

/// Probes whether a specific host and port (defaulting to wsh.panoramadr.com:22) is actively accepting TCP connections.
/// Used for reboot lifecycle monitoring and host recovery detection.
#[tauri::command]
pub async fn probe_host_tcp(
    host: Option<String>,
    port: Option<u16>,
    timeout_ms: Option<u64>,
) -> bool {
    let target_host = host.unwrap_or_else(|| "wsh.panoramadr.com".to_string());
    let target_port = port.unwrap_or(22);
    let ms = timeout_ms.unwrap_or(1500);

    tokio::task::spawn_blocking(move || {
        let addr_str = format!("{}:{}", target_host, target_port);
        match addr_str.to_socket_addrs() {
            Ok(addrs) => {
                for addr in addrs {
                    if std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(ms)).is_ok() {
                        return true;
                    }
                }
                false
            }
            Err(_) => false,
        }
    })
    .await
    .unwrap_or(false)
}

/// Probes an app's /api/health endpoint asynchronously with latency tracking using the shared pooled client
#[tauri::command]
pub async fn probe_app_health(
    app_id: String,
    url: String,
    timeout_ms: Option<u64>,
) -> ProbedAppHealth {
    let client = match shared_lan_client() {
        Some(c) => c,
        None => {
            return ProbedAppHealth {
                app_id,
                status: "unreachable".into(),
                latency_ms: 0,
                health: None,
                raw_error: Some("Failed to initialize shared HTTP client".into()),
            };
        }
    };

    let req_timeout = Duration::from_millis(timeout_ms.unwrap_or(4000));
    let start = Instant::now();
    match client.get(&url).timeout(req_timeout).send().await {
        Ok(resp) => {
            let latency_ms = start.elapsed().as_millis() as u64;
            if resp.status().is_success() {
                match resp.json::<AppHealthResponse>().await {
                    Ok(parsed) => ProbedAppHealth {
                        app_id,
                        status: if parsed.status == "healthy" { "healthy".into() } else { "unhealthy".into() },
                        latency_ms,
                        health: Some(parsed),
                        raw_error: None,
                    },
                    Err(e) => ProbedAppHealth {
                        app_id,
                        status: "unhealthy".into(),
                        latency_ms,
                        health: None,
                        raw_error: Some(format!("Invalid JSON response: {}", e)),
                    },
                }
            } else {
                ProbedAppHealth {
                    app_id,
                    status: "unhealthy".into(),
                    latency_ms,
                    health: None,
                    raw_error: Some(format!("HTTP {}", resp.status())),
                }
            }
        }
        Err(e) => ProbedAppHealth {
            app_id,
            status: "unreachable".into(),
            latency_ms: start.elapsed().as_millis() as u64,
            health: None,
            raw_error: Some(e.to_string()),
        },
    }
}

/// Probes home lab appliances (ui, protect, ha, genmon) using the shared pooled client
#[tauri::command]
pub async fn probe_appliances(
    appliances: Vec<(String, String, String)>, // (key, name, host)
    timeout_ms: Option<u64>,
) -> Vec<ApplianceStatus> {
    let client = match shared_appliance_client() {
        Some(c) => c.clone(),
        None => return Vec::new(),
    };
    let req_timeout = Duration::from_millis(timeout_ms.unwrap_or(2500));

    let mut handles = Vec::new();
    for (key, name, host) in appliances {
        let cl = client.clone();
        let handle = tokio::spawn(async move {
            let target_url = if host.starts_with("http://") || host.starts_with("https://") {
                host.clone()
            } else {
                format!("https://{}", host)
            };

            let start = Instant::now();
            match cl.get(&target_url).timeout(req_timeout).send().await {
                Ok(resp) => {
                    let code = resp.status().as_u16();
                    // 200, 301, 302, 401 are considered reachable/online
                    let is_online = resp.status().is_success()
                        || resp.status().is_redirection()
                        || code == 401;
                    ApplianceStatus {
                        key,
                        name,
                        host,
                        status: if is_online { "ONLINE".into() } else { "OFFLINE".into() },
                        http_code: Some(code),
                        latency_ms: start.elapsed().as_millis() as u64,
                    }
                }
                Err(_) => ApplianceStatus {
                    key,
                    name,
                    host,
                    status: "OFFLINE".into(),
                    http_code: None,
                    latency_ms: start.elapsed().as_millis() as u64,
                },
            }
        });
        handles.push(handle);
    }

    let mut results = Vec::new();
    for h in handles {
        if let Ok(res) = h.await {
            results.push(res);
        }
    }
    results
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareTunnelVersionStatus {
    pub running_version: Option<String>,
    pub running_raw: Option<String>,
    pub latest_version: Option<String>,
    pub release_url: Option<String>,
    pub published_at: Option<String>,
    pub is_up_to_date: Option<bool>,
    pub update_available: bool,
    pub etag: Option<String>,
    pub checked_at_iso: String,
    pub checked_at_epoch: i64,
    pub source: String,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubLatestReleaseResponse {
    tag_name: Option<String>,
    html_url: Option<String>,
    published_at: Option<String>,
}

struct TunnelVersionCacheState {
    status: Option<CloudflareTunnelVersionStatus>,
    last_checked: Option<Instant>,
}

fn cf_version_cache() -> &'static Mutex<TunnelVersionCacheState> {
    static CACHE: OnceLock<Mutex<TunnelVersionCacheState>> = OnceLock::new();
    CACHE.get_or_init(|| {
        Mutex::new(TunnelVersionCacheState {
            status: None,
            last_checked: None,
        })
    })
}

fn cf_fetch_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// Extracts a normalized numeric version string (e.g., `"2026.10.7"`) from
/// `"cloudflared version 2026.10.7 (built ...)"`, `"v2026.10.7"`, or `"2026.10.7"`.
pub fn extract_cloudflared_version(raw: &str) -> Option<String> {
    static VER_RE: OnceLock<Regex> = OnceLock::new();
    let re = VER_RE.get_or_init(|| {
        Regex::new(r"(?i)(?:version\s+|v)?(\d{4}\.\d+(?:\.\d+)+|\d+\.\d+\.\d+)")
            .expect("valid cloudflared version regex")
    });
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    re.captures(trimmed)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string())
}

fn parse_version_segments(ver: &str) -> Option<Vec<u64>> {
    let cleaned = ver.trim().trim_start_matches(['v', 'V']);
    if cleaned.is_empty() {
        return None;
    }
    let mut parts = Vec::new();
    for seg in cleaned.split('.') {
        if seg.is_empty() || !seg.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        parts.push(seg.parse::<u64>().ok()?);
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts)
    }
}

/// Compares CalVer/SemVer version strings numerically (e.g. `2026.9.1` < `2026.10.7`).
/// Returns `true` strictly when `latest > running`.
pub fn is_latest_version_newer(running: &str, latest: &str) -> bool {
    let (Some(r_parts), Some(l_parts)) =
        (parse_version_segments(running), parse_version_segments(latest))
    else {
        return false;
    };
    let max_len = r_parts.len().max(l_parts.len());
    for i in 0..max_len {
        let r = *r_parts.get(i).unwrap_or(&0);
        let l = *l_parts.get(i).unwrap_or(&0);
        if l != r {
            return l > r;
        }
    }
    false
}

fn apply_running_version(
    mut status: CloudflareTunnelVersionStatus,
    running_raw_override: Option<String>,
) -> CloudflareTunnelVersionStatus {
    let chosen_raw = running_raw_override
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(get_cached_cloudflared_version_raw)
        .or_else(|| status.running_raw.clone());

    status.running_raw = chosen_raw.clone();
    status.running_version = chosen_raw
        .as_deref()
        .and_then(extract_cloudflared_version);

    if let (Some(ref running), Some(ref latest)) =
        (&status.running_version, &status.latest_version)
    {
        let newer = is_latest_version_newer(running, latest);
        status.update_available = newer;
        status.is_up_to_date = Some(!newer);
    } else {
        status.update_available = false;
        status.is_up_to_date = None;
    }

    status
}

fn load_cached_status_from_memory_or_db(
    sre_db: &Arc<Mutex<SreDatabase>>,
) -> (Option<CloudflareTunnelVersionStatus>, Option<Instant>) {
    {
        let guard = cf_version_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.status.is_some() {
            return (guard.status.clone(), guard.last_checked);
        }
    }

    let db_raw = sre_db
        .lock()
        .ok()
        .and_then(|db| db.get_setting(CF_VERSION_SETTING_KEY).ok())
        .flatten();

    if let Some(raw_json) = db_raw {
        if let Ok(parsed) = serde_json::from_str::<CloudflareTunnelVersionStatus>(&raw_json) {
            let mut guard = cf_version_cache()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if guard.status.is_none() {
                guard.status = Some(parsed.clone());
            }
            return (guard.status.clone(), guard.last_checked);
        }
    }

    (None, None)
}

fn persist_tunnel_version_status(
    sre_db: &Arc<Mutex<SreDatabase>>,
    status: &CloudflareTunnelVersionStatus,
    mark_checked_now: bool,
) {
    {
        let mut guard = cf_version_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.status = Some(status.clone());
        if mark_checked_now {
            guard.last_checked = Some(Instant::now());
        }
    }

    if let Ok(serialized) = serde_json::to_string(status) {
        if let Ok(db) = sre_db.lock() {
            let _ = db.set_setting(CF_VERSION_SETTING_KEY, &serialized);
        }
    }
}

/// Non-blocking read of the persisted/in-memory Cloudflare Tunnel version status with the
/// latest cached WSH `cloudflared` running version applied.
pub fn get_cached_tunnel_version_status(
    sre_db: &Arc<Mutex<SreDatabase>>,
) -> Option<CloudflareTunnelVersionStatus> {
    let (cached_opt, _) = load_cached_status_from_memory_or_db(sre_db);
    cached_opt.map(|s| apply_running_version(s, None))
}

/// Checks the latest upstream `cloudflared` GitHub release using `If-None-Match` ETag
/// validation and SQLite-persisted 55-minute cooldown caching. Never spawns an SSH session.
pub async fn check_cloudflare_tunnel_version_internal(
    running_version_raw: Option<String>,
    force: bool,
    sre_db: &Arc<Mutex<SreDatabase>>,
) -> CloudflareTunnelVersionStatus {
    let _fetch_guard = cf_fetch_lock().lock().await;
    let effective_running_raw = running_version_raw
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(get_cached_cloudflared_version_raw);

    let (cached_opt, last_checked_inst) = load_cached_status_from_memory_or_db(sre_db);
    let now = chrono::Utc::now();
    let now_epoch = now.timestamp();
    let now_iso = now.to_rfc3339();

    if !force {
        if let Some(ref cached) = cached_opt {
            let within_monotonic = last_checked_inst
                .map(|inst| inst.elapsed() < Duration::from_secs(CF_VERSION_COOLDOWN_SECS))
                .unwrap_or(false);
            let within_wall = cached.checked_at_epoch > 0
                && now_epoch >= cached.checked_at_epoch
                && ((now_epoch - cached.checked_at_epoch) as u64) < CF_VERSION_COOLDOWN_SECS;

            if cached.latest_version.is_some() && (within_monotonic || within_wall) {
                let mut refreshed = apply_running_version(cached.clone(), effective_running_raw);
                refreshed.source = "cache".to_string();
                refreshed.error = None;
                // Keep persisted running version synced if a newer SSH snapshot provided one
                if refreshed.running_raw != cached.running_raw {
                    persist_tunnel_version_status(sre_db, &refreshed, false);
                }
                return refreshed;
            }
        }
    }

    let client = match shared_github_client() {
        Some(c) => c,
        None => {
            if let Some(cached) = cached_opt {
                let mut stale = apply_running_version(cached, effective_running_raw);
                stale.source = "stale_cache".to_string();
                stale.error = Some("Failed to initialize GitHub HTTP client".to_string());
                return stale;
            }
            return apply_running_version(
                CloudflareTunnelVersionStatus {
                    running_version: None,
                    running_raw: effective_running_raw.clone(),
                    latest_version: None,
                    release_url: None,
                    published_at: None,
                    is_up_to_date: None,
                    update_available: false,
                    etag: None,
                    checked_at_iso: now_iso,
                    checked_at_epoch: now_epoch,
                    source: "unavailable".to_string(),
                    error: Some("Failed to initialize GitHub HTTP client".to_string()),
                },
                effective_running_raw,
            );
        }
    };

    let mut req = client
        .get(GITHUB_CLOUDFLARED_LATEST_API)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json");

    if let Some(ref cached) = cached_opt {
        if cached.latest_version.is_some() {
            if let Some(ref etag) = cached.etag {
                req = req.header(reqwest::header::IF_NONE_MATCH, etag.as_str());
            }
        }
    }

    match req.send().await {
        Ok(resp) => {
            if resp.status() == reqwest::StatusCode::NOT_MODIFIED {
                if let Some(cached) = cached_opt {
                    let mut validated = apply_running_version(cached, effective_running_raw);
                    validated.checked_at_iso = now_iso;
                    validated.checked_at_epoch = now_epoch;
                    validated.source = "github_304".to_string();
                    validated.error = None;
                    persist_tunnel_version_status(sre_db, &validated, true);
                    return validated;
                }
            }

            if resp.status().is_success() {
                let next_etag = resp
                    .headers()
                    .get(reqwest::header::ETAG)
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string())
                    .or_else(|| cached_opt.as_ref().and_then(|c| c.etag.clone()));

                match resp.json::<GithubLatestReleaseResponse>().await {
                    Ok(payload) => {
                        let latest_extracted = payload
                            .tag_name
                            .as_deref()
                            .and_then(extract_cloudflared_version)
                            .or_else(|| {
                                payload
                                    .tag_name
                                    .as_deref()
                                    .map(|s| s.trim().trim_start_matches(['v', 'V']).to_string())
                                    .filter(|s| !s.is_empty())
                            });

                        let fresh = apply_running_version(
                            CloudflareTunnelVersionStatus {
                                running_version: None,
                                running_raw: effective_running_raw.clone(),
                                latest_version: latest_extracted,
                                release_url: payload.html_url,
                                published_at: payload.published_at,
                                is_up_to_date: None,
                                update_available: false,
                                etag: next_etag,
                                checked_at_iso: now_iso,
                                checked_at_epoch: now_epoch,
                                source: "github".to_string(),
                                error: None,
                            },
                            effective_running_raw,
                        );
                        persist_tunnel_version_status(sre_db, &fresh, true);

                        if fresh.update_available {
                            if let (Some(ref r), Some(ref l)) =
                                (&fresh.running_version, &fresh.latest_version)
                            {
                                if let Ok(db) = sre_db.lock() {
                                    let _ = db.log_action(
                                        "SYSTEM",
                                        "WARN",
                                        &format!(
                                            "Cloudflare Tunnel update available: running v{} < latest v{}",
                                            r, l
                                        ),
                                        fresh.release_url.as_deref(),
                                    );
                                }
                            }
                        }

                        return fresh;
                    }
                    Err(e) => {
                        let err_msg = format!("Invalid GitHub release JSON: {}", e);
                        if let Some(cached) = cached_opt {
                            let mut stale = apply_running_version(cached, effective_running_raw);
                            stale.source = "stale_cache".to_string();
                            stale.error = Some(err_msg);
                            return stale;
                        }
                        return apply_running_version(
                            CloudflareTunnelVersionStatus {
                                running_version: None,
                                running_raw: effective_running_raw.clone(),
                                latest_version: None,
                                release_url: None,
                                published_at: None,
                                is_up_to_date: None,
                                update_available: false,
                                etag: None,
                                checked_at_iso: now_iso,
                                checked_at_epoch: now_epoch,
                                source: "unavailable".to_string(),
                                error: Some(err_msg),
                            },
                            effective_running_raw,
                        );
                    }
                }
            } else {
                let err_msg = format!("GitHub API HTTP {}", resp.status());
                if let Some(cached) = cached_opt {
                    let mut stale = apply_running_version(cached, effective_running_raw);
                    stale.source = "stale_cache".to_string();
                    stale.error = Some(err_msg);
                    return stale;
                }
                return apply_running_version(
                    CloudflareTunnelVersionStatus {
                        running_version: None,
                        running_raw: effective_running_raw.clone(),
                        latest_version: None,
                        release_url: None,
                        published_at: None,
                        is_up_to_date: None,
                        update_available: false,
                        etag: None,
                        checked_at_iso: now_iso,
                        checked_at_epoch: now_epoch,
                        source: "unavailable".to_string(),
                        error: Some(err_msg),
                    },
                    effective_running_raw,
                );
            }
        }
        Err(e) => {
            let err_msg = format!("GitHub API request failed: {}", e);
            if let Some(cached) = cached_opt {
                let mut stale = apply_running_version(cached, effective_running_raw);
                stale.source = "stale_cache".to_string();
                stale.error = Some(err_msg);
                return stale;
            }
            apply_running_version(
                CloudflareTunnelVersionStatus {
                    running_version: None,
                    running_raw: effective_running_raw.clone(),
                    latest_version: None,
                    release_url: None,
                    published_at: None,
                    is_up_to_date: None,
                    update_available: false,
                    etag: None,
                    checked_at_iso: now_iso,
                    checked_at_epoch: now_epoch,
                    source: "unavailable".to_string(),
                    error: Some(err_msg),
                },
                effective_running_raw,
            )
        }
    }
}

#[tauri::command]
pub async fn check_cloudflare_tunnel_version(
    running_version_raw: Option<String>,
    force: Option<bool>,
    state: tauri::State<'_, Arc<Mutex<SreDatabase>>>,
) -> Result<CloudflareTunnelVersionStatus, String> {
    Ok(check_cloudflare_tunnel_version_internal(
        running_version_raw,
        force.unwrap_or(false),
        state.inner(),
    )
    .await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_cloudflared_calver_and_semver_strings() {
        assert_eq!(
            extract_cloudflared_version("cloudflared version 2026.10.7 (built 2026-10-15-1234 UTC)"),
            Some("2026.10.7".to_string())
        );
        assert_eq!(
            extract_cloudflared_version("v2026.11.0"),
            Some("2026.11.0".to_string())
        );
        assert_eq!(
            extract_cloudflared_version("2026.9.1"),
            Some("2026.9.1".to_string())
        );
        assert_eq!(extract_cloudflared_version("cloudflared daemon"), None);
        assert_eq!(extract_cloudflared_version(""), None);
    }

    #[test]
    fn compares_calver_segments_numerically() {
        assert!(is_latest_version_newer("2026.9.1", "2026.10.7"));
        assert!(!is_latest_version_newer("2026.10.7", "2026.10.7"));
        assert!(!is_latest_version_newer("2026.10.8", "2026.10.7"));
        assert!(is_latest_version_newer("2026.10.7", "2026.11.0"));
        assert!(is_latest_version_newer("2026.10", "2026.10.1"));
        assert!(is_latest_version_newer("v2026.9.12", "v2026.10.0"));
    }

    #[test]
    fn recomputes_update_available_when_running_version_changes() {
        let base = CloudflareTunnelVersionStatus {
            running_version: Some("2026.9.1".to_string()),
            running_raw: Some("cloudflared version 2026.9.1".to_string()),
            latest_version: Some("2026.10.7".to_string()),
            release_url: Some("https://github.com/cloudflare/cloudflared/releases/tag/2026.10.7".to_string()),
            published_at: None,
            is_up_to_date: Some(false),
            update_available: true,
            etag: Some("W/\"abc\"".to_string()),
            checked_at_iso: "2026-11-13T10:00:00Z".to_string(),
            checked_at_epoch: 1794564000,
            source: "cache".to_string(),
            error: None,
        };

        let upgraded = apply_running_version(
            base.clone(),
            Some("cloudflared version 2026.10.7 (built 2026-10-15 UTC)".to_string()),
        );
        assert_eq!(upgraded.running_version.as_deref(), Some("2026.10.7"));
        assert_eq!(upgraded.is_up_to_date, Some(true));
        assert!(!upgraded.update_available);

        let unknown_latest = CloudflareTunnelVersionStatus {
            latest_version: None,
            ..base
        };
        let evaluated = apply_running_version(unknown_latest, None);
        assert_eq!(evaluated.is_up_to_date, None);
        assert!(!evaluated.update_available);
    }
}
