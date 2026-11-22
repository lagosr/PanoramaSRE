use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiSiteDto {
    pub id: String,
    pub name: String,
    pub internal_reference: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiDeviceDto {
    pub id: String,
    pub name: String,
    pub mac_address: String,
    pub ip_address: Option<String>,
    pub model: Option<String>,
    pub state: String,
    pub firmware_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiClientDto {
    pub id: String,
    pub mac_address: String,
    pub ip_address: Option<String>,
    pub name: Option<String>,
    pub hostname: Option<String>,
    pub network_name: Option<String>,
    pub oui_vendor: Option<String>,
    pub client_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiPolicyDto {
    pub id: String,
    pub name: String,
    pub action: String,
    pub enabled: bool,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiSecuritySnapshot {
    pub base_url: String,
    pub app_version: String,
    pub sites: Vec<UnifiSiteDto>,
    pub devices: Vec<UnifiDeviceDto>,
    pub clients: Vec<UnifiClientDto>,
    pub policies: Vec<UnifiPolicyDto>,
}

fn shared_unifi_client() -> Option<&'static reqwest::Client> {
    static CLIENT: OnceLock<Option<reqwest::Client>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(10))
                .pool_idle_timeout(Duration::from_secs(60))
                .user_agent("PanoramaSRE-UniFi/1.0")
                .build()
                .ok()
        })
        .as_ref()
}

fn extract_data_items(raw: &Value) -> Vec<&Value> {
    if let Some(arr) = raw.get("data").and_then(|v| v.as_array()) {
        return arr.iter().collect();
    }
    if let Some(arr) = raw.as_array() {
        return arr.iter().collect();
    }
    Vec::new()
}

fn pick_opt_str(obj: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(val) = obj.get(*k) {
            if let Some(s) = val.as_str() {
                let t = s.trim();
                if !t.is_empty() {
                    return Some(t.to_string());
                }
            }
        }
    }
    None
}

pub fn parse_unifi_sites_json(raw: &Value) -> Vec<UnifiSiteDto> {
    let mut out = Vec::new();
    for item in extract_data_items(raw) {
        let Some(obj) = item.as_object() else { continue };
        let Some(id) = pick_opt_str(obj, &["id", "siteId"]) else { continue };
        let name = pick_opt_str(obj, &["name", "description", "internalReference"])
            .unwrap_or_else(|| id.clone());
        out.push(UnifiSiteDto {
            id,
            name,
            internal_reference: pick_opt_str(obj, &["internalReference", "meta"]),
        });
    }
    out
}

pub fn parse_unifi_devices_json(raw: &Value) -> Vec<UnifiDeviceDto> {
    let mut out = Vec::new();
    for item in extract_data_items(raw) {
        let Some(obj) = item.as_object() else { continue };
        let id = pick_opt_str(obj, &["id", "macAddress", "mac"]).unwrap_or_default();
        let mac = pick_opt_str(obj, &["macAddress", "mac"])
            .unwrap_or_else(|| id.clone())
            .to_ascii_uppercase();
        if mac.is_empty() {
            continue;
        }
        let name = pick_opt_str(obj, &["name", "model"]).unwrap_or_else(|| mac.clone());
        let state = pick_opt_str(obj, &["state", "status"]).unwrap_or_else(|| "UNKNOWN".to_string());
        out.push(UnifiDeviceDto {
            id,
            name,
            mac_address: mac,
            ip_address: pick_opt_str(obj, &["ipAddress", "ip"]),
            model: pick_opt_str(obj, &["model", "shortname"]),
            state,
            firmware_version: pick_opt_str(obj, &["firmwareVersion", "version"]),
        });
    }
    out
}

pub fn parse_unifi_clients_json(raw: &Value) -> Vec<UnifiClientDto> {
    let mut out = Vec::new();
    for item in extract_data_items(raw) {
        let Some(obj) = item.as_object() else { continue };
        let mac = match pick_opt_str(obj, &["macAddress", "mac"]) {
            Some(m) => m.to_ascii_uppercase(),
            None => continue,
        };
        let id = pick_opt_str(obj, &["id"]).unwrap_or_else(|| mac.clone());
        let network_name = pick_opt_str(obj, &["networkName", "network", "uplinkNetworkName"])
            .or_else(|| {
                obj.get("uplink")
                    .and_then(|u| u.as_object())
                    .and_then(|u| pick_opt_str(u, &["networkName", "name"]))
            });
        out.push(UnifiClientDto {
            id,
            mac_address: mac,
            ip_address: pick_opt_str(obj, &["ipAddress", "ip"]),
            name: pick_opt_str(obj, &["name", "displayName"]),
            hostname: pick_opt_str(obj, &["hostname", "hostName"]),
            network_name,
            oui_vendor: pick_opt_str(obj, &["oui", "vendor", "manufacturer"]),
            client_type: pick_opt_str(obj, &["type", "connectionType"]),
        });
    }
    out
}

pub fn parse_unifi_policies_json(raw: &Value) -> Vec<UnifiPolicyDto> {
    let mut out = Vec::new();
    for item in extract_data_items(raw) {
        let Some(obj) = item.as_object() else { continue };
        let Some(id) = pick_opt_str(obj, &["id"]) else { continue };
        let name = pick_opt_str(obj, &["name", "description"]).unwrap_or_else(|| id.clone());
        let action = obj
            .get("action")
            .and_then(|a| a.as_object())
            .and_then(|o| pick_opt_str(o, &["type"]))
            .or_else(|| pick_opt_str(obj, &["action", "type"]))
            .unwrap_or_else(|| "UNKNOWN".to_string());
        let enabled = obj.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
        out.push(UnifiPolicyDto {
            id,
            name,
            action,
            enabled,
            description: pick_opt_str(obj, &["description"]),
        });
    }
    out
}

fn normalize_unifi_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        "https://ui.panoramadr.com".to_string()
    } else if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    }
}

async fn fetch_unifi_json(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
) -> Result<(u16, Value), String> {
    let resp = client
        .get(url)
        .header("Accept", "application/json")
        .header("X-API-Key", api_key.trim())
        .send()
        .await
        .map_err(|e| format!("UniFi API request failed ({}): {}", url, e))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    if status == 401 || status == 403 {
        return Err(format!("UniFi API authentication/permission denied (HTTP {})", status));
    }
    if !(200..300).contains(&status) {
        return Err(format!(
            "UniFi API returned HTTP {}: {}",
            status,
            text.chars().take(180).collect::<String>()
        ));
    }
    let val: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Invalid UniFi JSON response ({}): {}", url, e))?;
    Ok((status, val))
}

async fn fetch_unifi_paginated<T, F>(
    client: &reqwest::Client,
    url_base: &str,
    api_key: &str,
    page_limit: usize,
    max_pages: usize,
    parser: F,
) -> Result<Vec<T>, String>
where
    F: Fn(&Value) -> Vec<T>,
{
    let limit = page_limit.clamp(1, 200);
    let mut out = Vec::new();
    let mut offset = 0usize;
    let sep = if url_base.contains('?') { '&' } else { '?' };

    for _ in 0..max_pages.max(1) {
        let page_url = format!("{}{}offset={}&limit={}", url_base, sep, offset, limit);
        let (_, val) = fetch_unifi_json(client, &page_url, api_key).await?;
        let batch_len = extract_data_items(&val).len();
        out.extend(parser(&val));

        let total_count = val.get("totalCount").and_then(|v| v.as_u64()).map(|v| v as usize);
        offset += batch_len;

        if batch_len < limit {
            break;
        }
        if let Some(total) = total_count {
            if offset >= total {
                break;
            }
        }
    }

    Ok(out)
}

pub async fn collect_unifi_snapshot(
    base_url: &str,
    api_key: &str,
) -> Result<UnifiSecuritySnapshot, String> {
    let client = shared_unifi_client()
        .ok_or_else(|| "Failed to build UniFi HTTPS client".to_string())?;
    let base = normalize_unifi_base_url(base_url);
    let prefix = format!("{}/proxy/network/integration/v1", base);

    let (_, info_val) = fetch_unifi_json(client, &format!("{}/info", prefix), api_key).await?;
    let app_version = info_val
        .get("applicationVersion")
        .and_then(|v| v.as_str())
        .or_else(|| info_val.get("version").and_then(|v| v.as_str()))
        .unwrap_or("unknown")
        .to_string();

    let (_, sites_val) = fetch_unifi_json(
        client,
        &format!("{}/sites?offset=0&limit=25", prefix),
        api_key,
    )
    .await?;
    let sites = parse_unifi_sites_json(&sites_val);

    let mut devices = Vec::new();
    let mut clients = Vec::new();
    let mut policies = Vec::new();

    for site in &sites {
        devices.extend(
            fetch_unifi_paginated(
                client,
                &format!("{}/sites/{}/devices", prefix, site.id),
                api_key,
                100,
                5,
                parse_unifi_devices_json,
            )
            .await?,
        );

        clients.extend(
            fetch_unifi_paginated(
                client,
                &format!("{}/sites/{}/clients", prefix, site.id),
                api_key,
                200,
                5,
                parse_unifi_clients_json,
            )
            .await?,
        );

        if let Ok(pols) = fetch_unifi_paginated(
            client,
            &format!("{}/sites/{}/firewall/policies", prefix, site.id),
            api_key,
            200,
            3,
            parse_unifi_policies_json,
        )
        .await
        {
            policies.extend(pols);
        }
    }

    Ok(UnifiSecuritySnapshot {
        base_url: base,
        app_version,
        sites,
        devices,
        clients,
        policies,
    })
}

pub async fn test_unifi_api_key(base_url: &str, api_key: &str) -> Result<Value, String> {
    let snap = collect_unifi_snapshot(base_url, api_key).await?;
    Ok(serde_json::json!({
        "ok": true,
        "baseUrl": snap.base_url,
        "appVersion": snap.app_version,
        "siteCount": snap.sites.len(),
        "deviceCount": snap.devices.len(),
        "clientCount": snap.clients.len(),
        "policyCount": snap.policies.len(),
    }))
}
