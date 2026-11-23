use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
use std::net::Ipv4Addr;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::task::JoinSet;

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
    #[serde(default)]
    pub vlan_id: Option<u32>,
    #[serde(default)]
    pub zone_name: Option<String>,
    pub oui_vendor: Option<String>,
    pub client_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiNetworkDto {
    pub id: String,
    pub name: String,
    pub vlan_id: Option<u32>,
    pub enabled: bool,
    pub is_default: bool,
    pub zone_id: Option<String>,
    pub zone_name: Option<String>,
    pub subnet_cidr: Option<String>,
    pub gateway_ip: Option<String>,
    pub isolation_enabled: bool,
    pub internet_access_enabled: bool,
    pub mdns_forwarding_enabled: bool,
    pub origin: String,
    pub client_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiZoneDto {
    pub id: String,
    pub name: String,
    pub origin: String,
    pub network_ids: Vec<String>,
    pub network_names: Vec<String>,
    pub vlan_ids: Vec<u32>,
    pub client_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiPolicyDto {
    pub id: String,
    pub name: String,
    pub action: String,
    pub enabled: bool,
    pub description: Option<String>,
    #[serde(default)]
    pub index: i64,
    #[serde(default)]
    pub origin: String,
    #[serde(default)]
    pub source_zone_id: Option<String>,
    #[serde(default)]
    pub destination_zone_id: Option<String>,
    #[serde(default)]
    pub allow_return_traffic: bool,
    #[serde(default)]
    pub has_source_filter: bool,
    #[serde(default)]
    pub source_filter_summary: Option<String>,
    #[serde(default)]
    pub has_destination_filter: bool,
    #[serde(default)]
    pub destination_filter_summary: Option<String>,
    #[serde(default)]
    pub protocol: Option<String>,
    #[serde(default)]
    pub connection_states: Vec<String>,
    #[serde(default)]
    pub logging_enabled: bool,
    #[serde(default)]
    pub schedule_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiSecuritySnapshot {
    pub base_url: String,
    pub app_version: String,
    #[serde(default)]
    pub captured_at: String,
    pub sites: Vec<UnifiSiteDto>,
    pub devices: Vec<UnifiDeviceDto>,
    pub clients: Vec<UnifiClientDto>,
    pub policies: Vec<UnifiPolicyDto>,
    #[serde(default)]
    pub networks: Vec<UnifiNetworkDto>,
    #[serde(default)]
    pub zones: Vec<UnifiZoneDto>,
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

fn compute_ipv4_cidr(host_ip: &str, prefix_len: u8) -> Option<String> {
    let ip: Ipv4Addr = host_ip.trim().parse().ok()?;
    let bits = prefix_len.min(32);
    let mask: u32 = if bits == 0 {
        0
    } else {
        u32::MAX << (32 - bits)
    };
    let net_u32 = u32::from(ip) & mask;
    let net_ip = Ipv4Addr::from(net_u32);
    Some(format!("{}/{}", net_ip, bits))
}

fn parse_cidr_tuple(cidr: &str) -> Option<(u32, u32, u8)> {
    let (ip_str, prefix_str) = cidr.trim().split_once('/')?;
    let ip: Ipv4Addr = ip_str.trim().parse().ok()?;
    let prefix: u8 = prefix_str.trim().parse().ok()?;
    if prefix == 0 || prefix > 32 {
        return None;
    }
    let mask = u32::MAX << (32 - prefix);
    Some((u32::from(ip) & mask, mask, prefix))
}

fn summarize_traffic_filter(endpoint: Option<&serde_json::Map<String, Value>>) -> (bool, Option<String>) {
    let Some(tf) = endpoint
        .and_then(|e| e.get("trafficFilter"))
        .and_then(|v| v.as_object())
    else {
        return (false, None);
    };

    let ftype = tf
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("FILTER")
        .trim()
        .to_string();

    let mut parts: Vec<String> = Vec::new();

    if let Some(ips) = tf
        .get("ipAddressFilter")
        .and_then(|v| v.get("items"))
        .and_then(|v| v.as_array())
    {
        let vals: Vec<String> = ips
            .iter()
            .filter_map(|item| item.get("value").and_then(|v| v.as_str()).map(|s| s.to_string()))
            .collect();
        if !vals.is_empty() {
            if vals.len() <= 2 {
                parts.push(vals.join(", "));
            } else {
                parts.push(format!("{} (+{} IPs)", vals[..2].join(", "), vals.len() - 2));
            }
        }
    }

    if let Some(ports) = tf
        .get("portFilter")
        .and_then(|v| v.get("items"))
        .and_then(|v| v.as_array())
    {
        let pvals: Vec<String> = ports
            .iter()
            .filter_map(|item| {
                if let Some(num) = item.get("value").and_then(|v| v.as_u64()) {
                    Some(num.to_string())
                } else {
                    item.get("value").and_then(|v| v.as_str()).map(|s| s.to_string())
                }
            })
            .collect();
        if !pvals.is_empty() {
            parts.push(format!("ports {}", pvals.into_iter().take(4).collect::<Vec<_>>().join(",")));
        }
    }

    if let Some(app_cats) = tf
        .get("applicationCategoryFilter")
        .and_then(|v| v.get("applicationCategoryIds"))
        .and_then(|v| v.as_array())
    {
        if !app_cats.is_empty() {
            parts.push(format!("{} app categories", app_cats.len()));
        }
    }

    if let Some(net_items) = tf
        .get("networkFilter")
        .and_then(|v| v.get("items"))
        .and_then(|v| v.as_array())
    {
        if !net_items.is_empty() {
            parts.push(format!("{} network(s)", net_items.len()));
        }
    }

    let summary = if parts.is_empty() {
        ftype
    } else {
        format!("{}: {}", ftype, parts.join(" • "))
    };
    (true, Some(summary))
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
            vlan_id: None,
            zone_name: None,
            oui_vendor: pick_opt_str(obj, &["oui", "vendor", "manufacturer"]),
            client_type: pick_opt_str(obj, &["type", "connectionType"]),
        });
    }
    out
}

pub fn parse_unifi_networks_json(raw: &Value) -> Vec<UnifiNetworkDto> {
    let mut out = Vec::new();
    for item in extract_data_items(raw) {
        let Some(obj) = item.as_object() else { continue };
        let Some(id) = pick_opt_str(obj, &["id"]) else { continue };
        let name = pick_opt_str(obj, &["name"]).unwrap_or_else(|| id.clone());
        let vlan_id = obj.get("vlanId").and_then(|v| v.as_u64()).map(|v| v as u32);
        let enabled = obj.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
        let is_default = obj.get("default").and_then(|v| v.as_bool()).unwrap_or(false);
        let zone_id = pick_opt_str(obj, &["zoneId"]);
        let origin = obj
            .get("metadata")
            .and_then(|m| m.get("origin"))
            .and_then(|v| v.as_str())
            .unwrap_or("USER_DEFINED")
            .to_string();

        let mut net = UnifiNetworkDto {
            id,
            name,
            vlan_id,
            enabled,
            is_default,
            zone_id,
            zone_name: None,
            subnet_cidr: None,
            gateway_ip: None,
            isolation_enabled: obj
                .get("isolationEnabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            internet_access_enabled: obj
                .get("internetAccessEnabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(true),
            mdns_forwarding_enabled: obj
                .get("mdnsForwardingEnabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            origin,
            client_count: 0,
        };
        merge_unifi_network_detail(&mut net, item);
        out.push(net);
    }
    out
}

pub fn merge_unifi_network_detail(net: &mut UnifiNetworkDto, detail: &Value) {
    if let Some(v) = detail.get("isolationEnabled").and_then(|b| b.as_bool()) {
        net.isolation_enabled = v;
    }
    if let Some(v) = detail.get("internetAccessEnabled").and_then(|b| b.as_bool()) {
        net.internet_access_enabled = v;
    }
    if let Some(v) = detail.get("mdnsForwardingEnabled").and_then(|b| b.as_bool()) {
        net.mdns_forwarding_enabled = v;
    }
    if let Some(zid) = detail.get("zoneId").and_then(|v| v.as_str()) {
        let clean = zid.trim();
        if !clean.is_empty() {
            net.zone_id = Some(clean.to_string());
        }
    }
    if let Some(ipv4) = detail.get("ipv4Configuration").and_then(|v| v.as_object()) {
        let host_ip = ipv4
            .get("hostIpAddress")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let prefix = ipv4
            .get("prefixLength")
            .and_then(|v| v.as_u64())
            .map(|p| p as u8);
        if let Some(ip) = host_ip {
            net.gateway_ip = Some(ip.clone());
            if let Some(p) = prefix {
                net.subnet_cidr = compute_ipv4_cidr(&ip, p);
            }
        }
    }
}

pub fn parse_unifi_zones_json(raw: &Value) -> Vec<UnifiZoneDto> {
    let mut out = Vec::new();
    for item in extract_data_items(raw) {
        let Some(obj) = item.as_object() else { continue };
        let Some(id) = pick_opt_str(obj, &["id"]) else { continue };
        let name = pick_opt_str(obj, &["name"]).unwrap_or_else(|| id.clone());
        let origin = obj
            .get("metadata")
            .and_then(|m| m.get("origin"))
            .and_then(|v| v.as_str())
            .unwrap_or("USER_DEFINED")
            .to_string();
        let network_ids: Vec<String> = obj
            .get("networkIds")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        out.push(UnifiZoneDto {
            id,
            name,
            origin,
            network_ids,
            network_names: Vec::new(),
            vlan_ids: Vec::new(),
            client_count: 0,
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
        let action_obj = obj.get("action").and_then(|a| a.as_object());
        let action = action_obj
            .and_then(|o| pick_opt_str(o, &["type"]))
            .or_else(|| pick_opt_str(obj, &["action", "type"]))
            .unwrap_or_else(|| "UNKNOWN".to_string());
        let allow_return_traffic = action_obj
            .and_then(|o| o.get("allowReturnTraffic"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let enabled = obj.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
        let index = obj.get("index").and_then(|v| v.as_i64()).unwrap_or(0);
        let origin = obj
            .get("metadata")
            .and_then(|m| m.get("origin"))
            .and_then(|v| v.as_str())
            .unwrap_or("USER_DEFINED")
            .to_string();

        let src_obj = obj.get("source").and_then(|s| s.as_object());
        let dst_obj = obj.get("destination").and_then(|d| d.as_object());
        let source_zone_id = src_obj.and_then(|s| pick_opt_str(s, &["zoneId"]));
        let destination_zone_id = dst_obj.and_then(|d| pick_opt_str(d, &["zoneId"]));
        let (has_source_filter, source_filter_summary) = summarize_traffic_filter(src_obj);
        let (has_destination_filter, destination_filter_summary) = summarize_traffic_filter(dst_obj);

        let protocol = obj
            .get("ipProtocolScope")
            .and_then(|s| s.get("protocolFilter"))
            .and_then(|p| p.get("protocol"))
            .and_then(|pr| pr.get("name"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                obj.get("ipProtocolScope")
                    .and_then(|s| s.get("ipVersion"))
                    .and_then(|v| v.as_str())
                    .map(|v| match v {
                        "IPV4_AND_IPV6" => "All Protocols".to_string(),
                        other => other.to_string(),
                    })
            });

        let connection_states: Vec<String> = obj
            .get("connectionStateFilter")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let logging_enabled = obj
            .get("loggingEnabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let schedule_mode = obj
            .get("schedule")
            .and_then(|s| s.get("mode"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        out.push(UnifiPolicyDto {
            id,
            name,
            action,
            enabled,
            description: pick_opt_str(obj, &["description"]),
            index,
            origin,
            source_zone_id,
            destination_zone_id,
            allow_return_traffic,
            has_source_filter,
            source_filter_summary,
            has_destination_filter,
            destination_filter_summary,
            protocol,
            connection_states,
            logging_enabled,
            schedule_mode,
        });
    }
    out
}

pub fn enrich_unifi_topology(
    networks: &mut [UnifiNetworkDto],
    zones: &mut [UnifiZoneDto],
    clients: &mut [UnifiClientDto],
) {
    let zone_name_by_id: HashMap<String, String> =
        zones.iter().map(|z| (z.id.clone(), z.name.clone())).collect();

    // Also build network -> zone fallback from zone.network_ids
    let mut zone_id_by_network_id: HashMap<String, String> = HashMap::new();
    for z in zones.iter() {
        for nid in &z.network_ids {
            zone_id_by_network_id
                .entry(nid.clone())
                .or_insert_with(|| z.id.clone());
        }
    }

    for net in networks.iter_mut() {
        net.client_count = 0;
        if net.zone_id.is_none() {
            net.zone_id = zone_id_by_network_id.get(&net.id).cloned();
        }
        if let Some(ref zid) = net.zone_id {
            net.zone_name = zone_name_by_id.get(zid).cloned();
        }
    }

    let parsed_cidrs: Vec<Option<(u32, u32, u8)>> = networks
        .iter()
        .map(|n| n.subnet_cidr.as_deref().and_then(parse_cidr_tuple))
        .collect();

    for cli in clients.iter_mut() {
        let Some(ref ip_str) = cli.ip_address else {
            continue;
        };
        let Ok(ip_v4) = ip_str.trim().parse::<Ipv4Addr>() else {
            continue;
        };
        let ip_u32 = u32::from(ip_v4);

        let mut best_match: Option<(usize, u8)> = None;
        for (idx, cidr_opt) in parsed_cidrs.iter().enumerate() {
            let Some((net_u32, mask_u32, prefix_len)) = cidr_opt else {
                continue;
            };
            if (ip_u32 & *mask_u32) == *net_u32 {
                match best_match {
                    Some((_, best_prefix)) if *prefix_len <= best_prefix => {}
                    _ => best_match = Some((idx, *prefix_len)),
                }
            }
        }

        if let Some((best_idx, _)) = best_match {
            let net = &mut networks[best_idx];
            net.client_count += 1;
            cli.vlan_id = net.vlan_id;
            cli.zone_name = net.zone_name.clone();
            cli.network_name = Some(match net.vlan_id {
                Some(vid) => format!("{} (VLAN {})", net.name, vid),
                None => net.name.clone(),
            });
        }
    }

    for z in zones.iter_mut() {
        let mut net_names = Vec::new();
        let mut vlans = BTreeSet::new();
        let mut total_clients = 0usize;

        for net in networks.iter() {
            let belongs = net.zone_id.as_deref() == Some(z.id.as_str())
                || z.network_ids.iter().any(|nid| nid == &net.id);
            if belongs {
                if !net_names.contains(&net.name) {
                    net_names.push(net.name.clone());
                }
                if let Some(vid) = net.vlan_id {
                    vlans.insert(vid);
                }
                total_clients += net.client_count;
            }
        }

        z.network_names = net_names;
        z.vlan_ids = vlans.into_iter().collect();
        z.client_count = total_clients;
    }
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
    let mut networks = Vec::new();
    let mut zones = Vec::new();

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

        if let Ok(mut site_nets) = fetch_unifi_paginated(
            client,
            &format!("{}/sites/{}/networks", prefix, site.id),
            api_key,
            100,
            2,
            parse_unifi_networks_json,
        )
        .await
        {
            let mut join_set = JoinSet::new();
            for (idx, net) in site_nets.iter().enumerate() {
                let detail_url = format!("{}/sites/{}/networks/{}", prefix, site.id, net.id);
                let key_owned = api_key.to_string();
                join_set.spawn(async move {
                    let res = fetch_unifi_json(client, &detail_url, &key_owned).await;
                    (idx, res)
                });
            }
            while let Some(joined) = join_set.join_next().await {
                if let Ok((idx, Ok((_, detail_val)))) = joined {
                    if let Some(net) = site_nets.get_mut(idx) {
                        merge_unifi_network_detail(net, &detail_val);
                    }
                }
            }
            networks.extend(site_nets);
        }

        if let Ok(site_zones) = fetch_unifi_paginated(
            client,
            &format!("{}/sites/{}/firewall/zones", prefix, site.id),
            api_key,
            100,
            2,
            parse_unifi_zones_json,
        )
        .await
        {
            zones.extend(site_zones);
        }

        if let Ok(pols) = fetch_unifi_paginated(
            client,
            &format!("{}/sites/{}/firewall/policies", prefix, site.id),
            api_key,
            200,
            5,
            parse_unifi_policies_json,
        )
        .await
        {
            policies.extend(pols);
        }
    }

    enrich_unifi_topology(&mut networks, &mut zones, &mut clients);

    Ok(UnifiSecuritySnapshot {
        base_url: base,
        app_version,
        captured_at: Utc::now().to_rfc3339(),
        sites,
        devices,
        clients,
        policies,
        networks,
        zones,
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
        "networkCount": snap.networks.len(),
        "zoneCount": snap.zones.len(),
        "policyCount": snap.policies.len(),
    }))
}
