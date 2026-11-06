use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::ToSocketAddrs;
use std::time::{Duration, Instant};

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

/// Probes an app's /api/health endpoint asynchronously with latency tracking
#[tauri::command]
pub async fn probe_app_health(
    app_id: String,
    url: String,
    timeout_ms: Option<u64>,
) -> ProbedAppHealth {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms.unwrap_or(4000)))
        .danger_accept_invalid_certs(true)
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return ProbedAppHealth {
                app_id,
                status: "unreachable".into(),
                latency_ms: 0,
                health: None,
                raw_error: Some(e.to_string()),
            };
        }
    };

    let start = Instant::now();
    match client.get(&url).send().await {
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

/// Probes home lab appliances (ui, protect, ha, genmon)
#[tauri::command]
pub async fn probe_appliances(
    appliances: Vec<(String, String, String)>, // (key, name, host)
    timeout_ms: Option<u64>,
) -> Vec<ApplianceStatus> {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms.unwrap_or(2500)))
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

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
            match cl.get(&target_url).send().await {
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
