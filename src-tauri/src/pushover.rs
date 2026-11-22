use crate::commands::monitor::{
    load_env_key_from_workspace, verify_trusted_home_network, TrustedNetworkState,
    TrustedNetworkVerdict,
};
use crate::commands::workspace::resolve_suite_workspace_root;
use crate::control_server::{classify_exe_channel, list_live_leases, resolve_ipc_lease_dir};
use crate::db::SreDatabase;
use crate::dev_supervisor::DevSupervisor;
use crate::ipc_security::hex_encode;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

const PUSHOVER_MESSAGES_API_URL: &str = "https://api.pushover.net/1/messages.json";
const SETTING_PUSHOVER_TOKEN_DPAPI: &str = "pushover_api_token_dpapi";
const SETTING_PUSHOVER_USER_DPAPI: &str = "pushover_user_key_dpapi";
const SETTING_PUSHOVER_PREFS: &str = "pushover_preferences_v1";
const SETTING_DISMISSED_BACKUP_KEYS: &str = "dismissed_backup_incident_keys";

/// Soft target length for mobile scannability (per Pushover UX guidelines; hard API cap is 1,024 chars).
pub const MAX_SCANNABLE_MESSAGE_CHARS: usize = 900;
pub const HARD_PUSHOVER_MESSAGE_LIMIT: usize = 1024;
/// Fixed Pushover notification sound so all PanoramaSRE alerts are immediately recognizable.
pub const PANORAMA_SRE_PUSHOVER_SOUND: &str = "cosmic";

fn shared_pushover_client() -> Option<&'static reqwest::Client> {
    static CLIENT: OnceLock<Option<reqwest::Client>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(10))
                .pool_idle_timeout(Duration::from_secs(90))
                .user_agent("PanoramaSRE-Pushover/1.0")
                .build()
                .ok()
        })
        .as_ref()
}

// ============================================================================
// Windows CurrentUser DPAPI Encryption for SQLite At-Rest Secret Protection
// ============================================================================

#[cfg(windows)]
mod dpapi {
    use std::ptr;

    #[repr(C)]
    struct CryptoApiBlob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            p_data_in: *const CryptoApiBlob,
            sz_data_descr: *const u16,
            p_optional_entropy: *const CryptoApiBlob,
            pv_reserved: *mut core::ffi::c_void,
            p_prompt_struct: *const core::ffi::c_void,
            dw_flags: u32,
            p_data_out: *mut CryptoApiBlob,
        ) -> i32;

        fn CryptUnprotectData(
            p_data_in: *const CryptoApiBlob,
            ppsz_data_descr: *mut *mut u16,
            p_optional_entropy: *const CryptoApiBlob,
            pv_reserved: *mut core::ffi::c_void,
            p_prompt_struct: *const core::ffi::c_void,
            dw_flags: u32,
            p_data_out: *mut CryptoApiBlob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(h_mem: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
    }

    pub fn encrypt_bytes(plain: &[u8]) -> Result<Vec<u8>, String> {
        if plain.is_empty() {
            return Ok(Vec::new());
        }
        let mut input = CryptoApiBlob {
            cb_data: plain.len() as u32,
            pb_data: plain.as_ptr() as *mut u8,
        };
        let mut output = CryptoApiBlob {
            cb_data: 0,
            pb_data: ptr::null_mut(),
        };

        let ok = unsafe {
            CryptProtectData(
                &mut input,
                ptr::null(),
                ptr::null(),
                ptr::null_mut(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 || output.pb_data.is_null() {
            return Err("Windows DPAPI CryptProtectData failed".to_string());
        }

        let bytes = unsafe {
            std::slice::from_raw_parts(output.pb_data, output.cb_data as usize).to_vec()
        };
        unsafe {
            LocalFree(output.pb_data as *mut core::ffi::c_void);
        }
        Ok(bytes)
    }

    pub fn decrypt_bytes(cipher: &[u8]) -> Result<Vec<u8>, String> {
        if cipher.is_empty() {
            return Ok(Vec::new());
        }
        let mut input = CryptoApiBlob {
            cb_data: cipher.len() as u32,
            pb_data: cipher.as_ptr() as *mut u8,
        };
        let mut output = CryptoApiBlob {
            cb_data: 0,
            pb_data: ptr::null_mut(),
        };

        let ok = unsafe {
            CryptUnprotectData(
                &mut input,
                ptr::null_mut(),
                ptr::null(),
                ptr::null_mut(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 || output.pb_data.is_null() {
            return Err("Windows DPAPI CryptUnprotectData failed".to_string());
        }

        let bytes = unsafe {
            std::slice::from_raw_parts(output.pb_data, output.cb_data as usize).to_vec()
        };
        unsafe {
            LocalFree(output.pb_data as *mut core::ffi::c_void);
        }
        Ok(bytes)
    }
}

fn hex_decode(hex_str: &str) -> Result<Vec<u8>, String> {
    let clean = hex_str.trim();
    if clean.len() % 2 != 0 {
        return Err("Invalid odd-length hex string".to_string());
    }
    let mut out = Vec::with_capacity(clean.len() / 2);
    for i in (0..clean.len()).step_by(2) {
        let byte = u8::from_str_radix(&clean[i..i + 2], 16)
            .map_err(|_| "Invalid hex character".to_string())?;
        out.push(byte);
    }
    Ok(out)
}

pub fn seal_secret_for_storage(secret: &str) -> Result<String, String> {
    let trimmed = secret.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    #[cfg(windows)]
    {
        let enc = dpapi::encrypt_bytes(trimmed.as_bytes())?;
        Ok(format!("dpapi:{}", hex_encode(&enc)))
    }
    #[cfg(not(windows))]
    {
        Ok(format!("hex:{}", hex_encode(trimmed.as_bytes())))
    }
}

pub fn unseal_secret_from_storage(stored: &str) -> Result<String, String> {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    #[cfg(windows)]
    if let Some(rest) = trimmed.strip_prefix("dpapi:") {
        let raw = hex_decode(rest)?;
        let dec = dpapi::decrypt_bytes(&raw)?;
        return String::from_utf8(dec).map_err(|_| "Invalid UTF-8 in decrypted secret".to_string());
    }
    if let Some(rest) = trimmed.strip_prefix("hex:") {
        let raw = hex_decode(rest)?;
        return String::from_utf8(raw).map_err(|_| "Invalid UTF-8 in stored secret".to_string());
    }
    Err("Unrecognized secret storage prefix".to_string())
}

pub fn mask_secret_preview(secret: &str) -> String {
    let clean = secret.trim();
    if clean.is_empty() {
        return String::new();
    }
    let chars: Vec<char> = clean.chars().collect();
    if chars.len() <= 8 {
        "••••••••".to_string()
    } else {
        let prefix: String = chars[..4].iter().collect();
        let suffix: String = chars[chars.len() - 4..].iter().collect();
        format!("{}••••{}", prefix, suffix)
    }
}

// ============================================================================
// Configuration & Preference DTOs
// ============================================================================

fn default_true() -> bool {
    true
}

fn default_update_sound() -> String {
    PANORAMA_SRE_PUSHOVER_SOUND.to_string()
}

fn default_failure_sound() -> String {
    PANORAMA_SRE_PUSHOVER_SOUND.to_string()
}

fn default_recovery_sound() -> String {
    PANORAMA_SRE_PUSHOVER_SOUND.to_string()
}

fn default_failure_priority() -> i8 {
    0
}

fn default_expected_wsh_ip() -> String {
    "172.25.25.5".to_string()
}

fn default_canary_host() -> String {
    "ui.panoramadr.com".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushoverCategoryPrefs {
    #[serde(default = "default_true")]
    pub system_updates: bool,
    #[serde(default = "default_true")]
    pub app_and_host_failures: bool,
    #[serde(default = "default_true")]
    pub smoke_failures: bool,
    #[serde(default = "default_true")]
    pub ssl_alerts: bool,
    #[serde(default = "default_true")]
    pub backup_failures: bool,
    #[serde(default)]
    pub opt_in_events: bool,
    #[serde(default)]
    pub recovery_alerts: bool,
}

impl Default for PushoverCategoryPrefs {
    fn default() -> Self {
        Self {
            system_updates: true,
            app_and_host_failures: true,
            smoke_failures: true,
            ssl_alerts: true,
            backup_failures: true,
            opt_in_events: false,
            recovery_alerts: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushoverPreferences {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub device: String,
    #[serde(default = "default_update_sound")]
    pub update_sound: String,
    #[serde(default = "default_failure_sound")]
    pub failure_sound: String,
    #[serde(default = "default_recovery_sound")]
    pub recovery_sound: String,
    #[serde(default = "default_failure_priority")]
    pub failure_priority: i8,
    #[serde(default = "default_expected_wsh_ip")]
    pub expected_wsh_ip: String,
    #[serde(default = "default_canary_host")]
    pub canary_host: String,
    #[serde(default)]
    pub categories: PushoverCategoryPrefs,
}

impl Default for PushoverPreferences {
    fn default() -> Self {
        Self {
            enabled: true,
            device: String::new(),
            update_sound: default_update_sound(),
            failure_sound: default_failure_sound(),
            recovery_sound: default_recovery_sound(),
            failure_priority: default_failure_priority(),
            expected_wsh_ip: default_expected_wsh_ip(),
            canary_host: default_canary_host(),
            categories: PushoverCategoryPrefs::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushoverSettingsViewDto {
    pub configured: bool,
    pub credential_source: String, // "dpapi" | "env_local_keys" | "none"
    pub masked_token: String,
    pub masked_user: String,
    pub preferences: PushoverPreferences,
    pub network_gate: TrustedNetworkVerdict,
    pub tracked_state_count: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePushoverSettingsInput {
    pub api_token: Option<String>,
    pub user_key: Option<String>,
    pub clear_stored_credentials: Option<bool>,
    pub preferences: PushoverPreferences,
}

#[derive(Debug, Clone)]
pub struct ResolvedPushoverCredentials {
    pub api_token: String,
    pub user_key: String,
    pub source: String,
}

pub fn load_preferences(db: &SreDatabase) -> PushoverPreferences {
    let mut prefs = db
        .get_setting(SETTING_PUSHOVER_PREFS)
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str::<PushoverPreferences>(&raw).ok())
        .unwrap_or_default();
    prefs.update_sound = PANORAMA_SRE_PUSHOVER_SOUND.to_string();
    prefs.failure_sound = PANORAMA_SRE_PUSHOVER_SOUND.to_string();
    prefs.recovery_sound = PANORAMA_SRE_PUSHOVER_SOUND.to_string();
    prefs
}

pub fn save_preferences(db: &SreDatabase, prefs: &PushoverPreferences) -> Result<(), String> {
    let mut normalized = prefs.clone();
    normalized.failure_priority = normalized.failure_priority.clamp(-2, 1);
    normalized.device = normalized.device.trim().to_string();
    normalized.update_sound = PANORAMA_SRE_PUSHOVER_SOUND.to_string();
    normalized.failure_sound = PANORAMA_SRE_PUSHOVER_SOUND.to_string();
    normalized.recovery_sound = PANORAMA_SRE_PUSHOVER_SOUND.to_string();
    normalized.expected_wsh_ip = if normalized.expected_wsh_ip.trim().is_empty() {
        default_expected_wsh_ip()
    } else {
        normalized.expected_wsh_ip.trim().to_string()
    };
    normalized.canary_host = if normalized.canary_host.trim().is_empty() {
        default_canary_host()
    } else {
        normalized.canary_host.trim().to_string()
    };

    let raw = serde_json::to_string(&normalized)
        .map_err(|e| format!("Failed to serialize Pushover preferences: {}", e))?;
    db.set_setting(SETTING_PUSHOVER_PREFS, &raw)
        .map_err(|e| format!("Failed to save Pushover preferences: {}", e))
}

pub fn candidate_env_key_workspaces(db: &SreDatabase) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd.clone());
        if let Some(parent) = cwd.parent() {
            dirs.push(parent.to_path_buf());
        }
    }
    let configured_ws = db.get_setting("workspace_root").ok().flatten();
    let suite_root = resolve_suite_workspace_root(configured_ws.as_deref());
    dirs.push(suite_root.join("PanoramaSRE"));
    dirs.push(suite_root.join("PanoramaAuth"));
    dirs.push(suite_root);
    dirs
}

pub fn resolve_pushover_credentials(db: &SreDatabase) -> Option<ResolvedPushoverCredentials> {
    // 1. Primary: Encrypted DPAPI credentials stored in app_settings
    let stored_tok = db
        .get_setting(SETTING_PUSHOVER_TOKEN_DPAPI)
        .ok()
        .flatten()
        .and_then(|s| unseal_secret_from_storage(&s).ok())
        .filter(|s| !s.trim().is_empty());
    let stored_usr = db
        .get_setting(SETTING_PUSHOVER_USER_DPAPI)
        .ok()
        .flatten()
        .and_then(|s| unseal_secret_from_storage(&s).ok())
        .filter(|s| !s.trim().is_empty());

    if let (Some(api_token), Some(user_key)) = (stored_tok, stored_usr) {
        return Some(ResolvedPushoverCredentials {
            api_token,
            user_key,
            source: "dpapi".to_string(),
        });
    }

    // 2. Fallback: Tier-4 .env.local.keys in PanoramaSRE or PanoramaAuth workspace
    for dir in candidate_env_key_workspaces(db) {
        let dir_str = dir.to_string_lossy();
        let tok = load_env_key_from_workspace(&dir_str, "PUSHOVER_API_TOKEN");
        let usr = load_env_key_from_workspace(&dir_str, "PUSHOVER_USER_KEY");
        if let (Some(api_token), Some(user_key)) = (tok, usr) {
            return Some(ResolvedPushoverCredentials {
                api_token,
                user_key,
                source: "env_local_keys".to_string(),
            });
        }
    }

    // 3. Process environment fallback
    if let (Ok(t), Ok(u)) = (
        std::env::var("PUSHOVER_API_TOKEN"),
        std::env::var("PUSHOVER_USER_KEY"),
    ) {
        if !t.trim().is_empty() && !u.trim().is_empty() {
            return Some(ResolvedPushoverCredentials {
                api_token: t.trim().to_string(),
                user_key: u.trim().to_string(),
                source: "env".to_string(),
            });
        }
    }

    None
}

// ============================================================================
// Multi-Instance Alert Leader Guard
// ============================================================================

pub fn is_current_instance_alert_leader(dev_supervisor: &DevSupervisor) -> bool {
    let current_pid = std::process::id();
    let lease_dir = resolve_ipc_lease_dir();
    let active_leases = list_live_leases(&lease_dir);
    if active_leases.is_empty() {
        return true;
    }
    if dev_supervisor.get_managed_app_count() > 0 {
        return true;
    }

    let exe_path = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let my_channel = classify_exe_channel(&exe_path);

    let installed_pids: Vec<u32> = active_leases
        .iter()
        .filter(|l| l.channel == "installed")
        .map(|l| l.pid)
        .collect();

    if !installed_pids.is_empty() {
        if my_channel != "installed" {
            return false;
        }
        let min_installed = installed_pids.into_iter().min().unwrap_or(current_pid);
        return current_pid <= min_installed;
    }

    let min_pid = active_leases
        .iter()
        .map(|l| l.pid)
        .min()
        .unwrap_or(current_pid);
    current_pid <= min_pid
}

// ============================================================================
// HTML Formatting, Escaping & <= 900 Char Scannability Builder
// ============================================================================

pub fn escape_pushover_html(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(ch),
        }
    }
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormattedBulletItem {
    pub label: String,
    pub detail: String,
}

/// Builds an HTML-formatted Pushover body (`html: 1`) strictly within `max_chars` (default 900,
/// capped below 1024), never slicing mid-tag or mid-UTF-8 character.
pub fn build_scannable_html_message(
    heading: &str,
    items: &[FormattedBulletItem],
    footer_note: Option<&str>,
    max_chars: usize,
) -> String {
    let cap = max_chars.clamp(160, HARD_PUSHOVER_MESSAGE_LIMIT - 24);
    let safe_heading = format!("<b>{}</b>", escape_pushover_html(heading.trim()));

    let footer_rendered = footer_note
        .map(|f| f.trim())
        .filter(|f| !f.is_empty())
        .map(|f| format!("\n\n<i>{}</i>", escape_pushover_html(f)))
        .unwrap_or_default();

    let mut body = safe_heading;
    let total = items.len();
    let mut included = 0usize;

    for (idx, item) in items.iter().enumerate() {
        let remaining_after = total.saturating_sub(idx + 1);
        let overflow_reserve = if remaining_after > 0 { 52 } else { 0 };
        let label_esc = escape_pushover_html(item.label.trim());
        let detail_esc = escape_pushover_html(item.detail.trim());
        let line = if detail_esc.is_empty() {
            format!("\n• <b>{}</b>", label_esc)
        } else {
            format!("\n• <b>{}:</b> {}", label_esc, detail_esc)
        };

        let projected =
            body.chars().count() + line.chars().count() + footer_rendered.chars().count() + overflow_reserve;

        if projected > cap {
            if included == 0 {
                // Always include at least one truncated item if the single first item was overly long
                let available = cap
                    .saturating_sub(body.chars().count() + footer_rendered.chars().count() + overflow_reserve + 16);
                let short_detail: String = item.detail.trim().chars().take(available.max(24)).collect();
                body.push_str(&format!(
                    "\n• <b>{}:</b> {}…",
                    label_esc,
                    escape_pushover_html(&short_detail)
                ));
                included += 1;
            }
            break;
        }

        body.push_str(&line);
        included += 1;
    }

    if included < total {
        let omitted = total - included;
        body.push_str(&format!(
            "\n• <i>+{} additional item(s) in PanoramaSRE</i>",
            omitted
        ));
    }

    if body.chars().count() + footer_rendered.chars().count() <= cap {
        body.push_str(&footer_rendered);
    }

    body
}

// ============================================================================
// Outbound Pushover REST Client
// ============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct PushoverMessageRequest {
    pub token: String,
    pub user: String,
    pub title: String,
    pub message: String,
    pub html: u8,
    pub priority: i8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sound: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushoverSendReceipt {
    pub request_id: String,
    pub status: i32,
    pub title: String,
}

#[derive(Debug, Deserialize)]
struct PushoverApiRawResponse {
    status: Option<i32>,
    request: Option<String>,
    errors: Option<Vec<String>>,
}

pub async fn dispatch_pushover_message(
    creds: &ResolvedPushoverCredentials,
    title: &str,
    html_message: &str,
    priority: i8,
    sound: Option<&str>,
    device: Option<&str>,
    url: Option<&str>,
    url_title: Option<&str>,
) -> Result<PushoverSendReceipt, String> {
    let client = shared_pushover_client()
        .ok_or_else(|| "Failed to initialize Pushover TLS HTTP client".to_string())?;

    let bounded_title: String = title.trim().chars().take(240).collect();
    let bounded_msg: String = if html_message.chars().count() > HARD_PUSHOVER_MESSAGE_LIMIT {
        let mut truncated: String = html_message.chars().take(HARD_PUSHOVER_MESSAGE_LIMIT - 4).collect();
        truncated.push('…');
        truncated
    } else {
        html_message.to_string()
    };

    let clean_sound = sound
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let clean_device = device
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty());
    let clean_url = url
        .map(|u| u.trim().to_string())
        .filter(|u| !u.is_empty())
        .map(|u| u.chars().take(500).collect());
    let clean_url_title = url_title
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .map(|t| t.chars().take(96).collect());

    let payload = PushoverMessageRequest {
        token: creds.api_token.clone(),
        user: creds.user_key.clone(),
        title: bounded_title.clone(),
        message: bounded_msg,
        html: 1,
        priority: priority.clamp(-2, 1),
        sound: clean_sound,
        device: clean_device,
        url: clean_url,
        url_title: clean_url_title,
    };

    let resp = client
        .post(PUSHOVER_MESSAGES_API_URL)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Pushover HTTP transport error: {}", e))?;

    let http_status = resp.status();
    let raw_text = resp.text().await.unwrap_or_default();
    let parsed: Option<PushoverApiRawResponse> = serde_json::from_str(&raw_text).ok();

    if http_status.is_success() {
        if let Some(body) = parsed {
            if body.status == Some(1) {
                return Ok(PushoverSendReceipt {
                    request_id: body.request.unwrap_or_else(|| "ok".to_string()),
                    status: 1,
                    title: bounded_title,
                });
            }
            let errs = body.errors.unwrap_or_default().join("; ");
            return Err(format!("Pushover API rejected payload: {}", errs));
        }
    }

    let detail = parsed
        .and_then(|p| p.errors)
        .map(|e| e.join("; "))
        .unwrap_or_else(|| raw_text.chars().take(200).collect());
    Err(format!("Pushover API HTTP {}: {}", http_status, detail))
}

// ============================================================================
// Periodic Sync Observation DTOs & Pure Edge-Triggered Deduplication Engine
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppHealthObservationDto {
    pub slug: String,
    pub display_name: String,
    pub base_path: String,
    pub status: String, // "healthy" | "unhealthy" | "unreachable"
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApplianceObservationDto {
    pub key: String,
    pub name: String,
    pub host: String,
    pub status: String, // "ONLINE" | "OFFLINE"
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WshObservationDto {
    pub dietpi_version: String,
    pub dietpi_update_available: String,
    pub reboot_required: bool,
    pub kernel: String,
    pub rpi_throttled: String,
    pub lighttpd_status: String,
    pub docker_status: String,
    pub ssh_status: String,
    pub apt_upgradable_raw: String,
    pub security_violation_count: usize,
    #[serde(default)]
    pub failing_invariants: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TunnelVersionObservationDto {
    pub running_version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub release_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SslDomainObservationDto {
    pub domain: String,
    pub display_name: String,
    pub status: String,       // "HEALTHY" | "EXPIRING_SOON" | "CRITICAL" | "EXPIRED" | "SELF_SIGNED" | "MISSING" | "ERROR"
    pub drift_status: String, // "IN_SYNC" | "DRIFT_DETECTED" | ...
    pub days_remaining: i64,
    pub live_reachable: bool,
    pub thumbprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BackupObservationDto {
    pub incident_key: Option<String>,
    pub last_run_status: Option<String>,
    pub failed_runs_7d: usize,
    #[serde(default)]
    pub failed_apps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SmokeRunObservationDto {
    pub id: String,
    pub timestamp: String,
    pub triggered_by: String,
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
    #[serde(default)]
    pub failed_checks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncAlertEvaluationInput {
    #[serde(default)]
    pub maintenance_suppressed: bool,
    pub apps: Option<Vec<AppHealthObservationDto>>,
    pub appliances: Option<Vec<ApplianceObservationDto>>,
    pub wsh: Option<WshObservationDto>,
    pub tunnel_version: Option<TunnelVersionObservationDto>,
    pub ssl_domains: Option<Vec<SslDomainObservationDto>>,
    pub backup: Option<BackupObservationDto>,
    pub latest_smoke_run: Option<SmokeRunObservationDto>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutboundBatchKind {
    Failure,
    Update,
    Recovery,
}

#[derive(Debug, Clone)]
pub struct PlannedPushoverBatch {
    pub kind: OutboundBatchKind,
    pub title: String,
    pub html_message: String,
    pub priority: i8,
    pub sound: String,
    pub url: Option<String>,
    pub url_title: Option<String>,
    pub dedup_keys_notified: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncEvaluationSummaryDto {
    pub skipped: bool,
    pub skip_reason: Option<String>,
    pub network_state: TrustedNetworkState,
    pub dispatched_batches: usize,
    pub notified_keys: Vec<String>,
}

/// Parses `apt list --upgradable` lines into sorted `(package_name, target_version)` pairs and a stable SHA-256 hash.
pub fn summarize_apt_upgradable(raw: &str) -> (usize, Vec<String>, String) {
    let mut normalized_entries: Vec<(String, String)> = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("Listing...") {
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        let first = parts.next().unwrap_or("");
        let pkg_name = first.split('/').next().unwrap_or(first).trim();
        if pkg_name.is_empty() {
            continue;
        }
        let target_ver = parts.next().unwrap_or("latest").trim();
        normalized_entries.push((pkg_name.to_string(), target_ver.to_string()));
    }

    normalized_entries.sort();
    normalized_entries.dedup();

    if normalized_entries.is_empty() {
        return (0, Vec::new(), String::new());
    }

    let mut hasher = Sha256::new();
    for (pkg, ver) in &normalized_entries {
        hasher.update(pkg.as_bytes());
        hasher.update(b"=");
        hasher.update(ver.as_bytes());
        hasher.update(b"\n");
    }
    let digest = hex_encode(&hasher.finalize());
    let pkg_names: Vec<String> = normalized_entries.into_iter().map(|(p, _)| p).collect();
    (pkg_names.len(), pkg_names, digest)
}

/// Decodes `vcgencmd get_throttled` hex bitmask and returns `true` ONLY when active
/// lower bits (0..=3: under-voltage, freq-capped, throttled, soft-temp-limit) are set.
/// Historical sticky bits since boot (bits 16..=19, e.g. `0xe0000`) are ignored.
pub fn is_rpi_actively_throttled(raw: &str) -> bool {
    let trimmed = raw.trim();
    let hex_str = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    if hex_str.is_empty() {
        return false;
    }
    match u32::from_str_radix(hex_str, 16) {
        Ok(val) => (val & 0x0F) != 0,
        Err(_) => false,
    }
}

pub fn load_dismissed_backup_keys(db: &SreDatabase) -> Vec<String> {
    db.get_setting(SETTING_DISMISSED_BACKUP_KEYS)
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
        .unwrap_or_default()
}

pub fn record_dismissed_backup_key(db: &SreDatabase, key: &str) -> Result<Vec<String>, String> {
    let clean = key.trim();
    if clean.is_empty() {
        return Ok(load_dismissed_backup_keys(db));
    }
    let mut keys = load_dismissed_backup_keys(db);
    if !keys.iter().any(|k| k == clean) {
        keys.push(clean.to_string());
        if keys.len() > 30 {
            let excess = keys.len() - 30;
            keys.drain(0..excess);
        }
        let serialized = serde_json::to_string(&keys)
            .map_err(|e| format!("Failed serializing dismissed backup keys: {}", e))?;
        db.set_setting(SETTING_DISMISSED_BACKUP_KEYS, &serialized)
            .map_err(|e| format!("Failed saving dismissed backup keys: {}", e))?;
    }
    Ok(keys)
}

fn ssl_severity_rank(status: &str, drift_status: &str) -> u8 {
    if status == "EXPIRED" || status == "SELF_SIGNED" || drift_status == "SELF_SIGNED" {
        3
    } else if status == "CRITICAL" || drift_status == "DRIFT_DETECTED" {
        2
    } else if status == "EXPIRING_SOON" {
        1
    } else {
        0
    }
}

/// Evaluates whether a newly seen fingerprint for an *update* key should trigger a one-shot alert.
fn evaluate_update_key(
    db: &SreDatabase,
    dedup_key: &str,
    active_fingerprint: Option<&str>,
    now_iso: &str,
) -> bool {
    let prev = db.get_pushover_alert_state(dedup_key).ok().flatten();
    match active_fingerprint {
        Some(fp) if !fp.trim().is_empty() => {
            let already_announced = prev
                .as_ref()
                .map(|r| r.is_failing && r.fingerprint == fp)
                .unwrap_or(false);
            if already_announced {
                let next_count = prev.map(|r| r.consecutive_count.saturating_add(1)).unwrap_or(1);
                let _ = db.upsert_pushover_alert_state(dedup_key, fp, true, next_count, None);
                false
            } else {
                let _ = db.upsert_pushover_alert_state(dedup_key, fp, true, 1, Some(now_iso));
                true
            }
        }
        _ => {
            if prev.as_ref().map(|r| r.is_failing).unwrap_or(false) {
                let _ = db.upsert_pushover_alert_state(dedup_key, "up_to_date", false, 0, None);
            }
            false
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IncidentTransition {
    None,
    Triggered,
    Recovered,
}

/// Evaluates an *incident/failure* state machine with configurable consecutive-failure debounce
/// and optional escalation fingerprint detection.
fn evaluate_incident_key(
    db: &SreDatabase,
    dedup_key: &str,
    failing_fingerprint: Option<&str>,
    required_consecutive: u32,
    escalated_over_prev: impl Fn(&str, &str) -> bool,
    now_iso: &str,
) -> IncidentTransition {
    let prev = db.get_pushover_alert_state(dedup_key).ok().flatten();
    let threshold = required_consecutive.max(1);

    match failing_fingerprint {
        Some(fp) if !fp.trim().is_empty() => {
            let prev_count = prev
                .as_ref()
                .filter(|r| r.fingerprint != "ok")
                .map(|r| r.consecutive_count)
                .unwrap_or(0);
            let next_count = prev_count.saturating_add(1);
            let was_notified_active = prev.as_ref().map(|r| r.is_failing).unwrap_or(false);

            if was_notified_active {
                let prev_fp = prev.as_ref().map(|r| r.fingerprint.as_str()).unwrap_or("");
                if escalated_over_prev(prev_fp, fp) {
                    let _ = db.upsert_pushover_alert_state(
                        dedup_key,
                        fp,
                        true,
                        next_count,
                        Some(now_iso),
                    );
                    IncidentTransition::Triggered
                } else {
                    let _ = db.upsert_pushover_alert_state(dedup_key, fp, true, next_count, None);
                    IncidentTransition::None
                }
            } else if next_count >= threshold {
                let _ = db.upsert_pushover_alert_state(
                    dedup_key,
                    fp,
                    true,
                    next_count,
                    Some(now_iso),
                );
                IncidentTransition::Triggered
            } else {
                // Still within debounce window: record streak with is_failing = false
                let _ = db.upsert_pushover_alert_state(dedup_key, fp, false, next_count, None);
                IncidentTransition::None
            }
        }
        _ => {
            let was_notified_active = prev.as_ref().map(|r| r.is_failing).unwrap_or(false);
            if prev.is_some() {
                let _ = db.upsert_pushover_alert_state(dedup_key, "ok", false, 0, None);
            }
            if was_notified_active {
                IncidentTransition::Recovered
            } else {
                IncidentTransition::None
            }
        }
    }
}

fn is_smoke_run_recent(timestamp_str: &str, now_utc: chrono::DateTime<chrono::Utc>, max_age_mins: i64) -> bool {
    if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(timestamp_str.trim()) {
        let age = now_utc.signed_duration_since(parsed.with_timezone(&chrono::Utc));
        age.num_minutes() <= max_age_mins
    } else {
        true
    }
}

/// Pure, deterministic state-transition evaluator over SQLite `pushover_alert_state`.
/// Assumes the caller has already verified `TrustedNetworkVerdict.is_trusted == true`.
pub fn plan_pushover_batches_from_sync(
    db: &SreDatabase,
    prefs: &PushoverPreferences,
    verdict: &TrustedNetworkVerdict,
    input: &SyncAlertEvaluationInput,
    now_utc: chrono::DateTime<chrono::Utc>,
) -> Vec<PlannedPushoverBatch> {
    if !prefs.enabled || !verdict.is_trusted {
        return Vec::new();
    }

    let now_iso = now_utc.to_rfc3339();
    let mut failure_items: Vec<FormattedBulletItem> = Vec::new();
    let mut failure_keys: Vec<String> = Vec::new();
    let mut single_app_failure_url: Option<(String, String)> = None;
    let mut update_items: Vec<FormattedBulletItem> = Vec::new();
    let mut update_keys: Vec<String> = Vec::new();
    let mut update_url: Option<(String, String)> = None;
    let mut recovery_items: Vec<FormattedBulletItem> = Vec::new();
    let mut recovery_keys: Vec<String> = Vec::new();

    // ------------------------------------------------------------------------
    // 1. WSH Host Reachability (when Home Canary proves LAN/VPN is active!)
    // ------------------------------------------------------------------------
    if prefs.categories.app_and_host_failures && !input.maintenance_suppressed {
        let wsh_down_fp = if !verdict.wsh_reachable && verdict.canary_reachable {
            Some("wsh_host_down")
        } else {
            None
        };
        let key = "wsh:host_reachable";
        match evaluate_incident_key(db, key, wsh_down_fp, 1, |_, _| false, &now_iso) {
            IncidentTransition::Triggered => {
                failure_keys.push(key.to_string());
                failure_items.push(FormattedBulletItem {
                    label: "DietPi WSH Host".to_string(),
                    detail: format!(
                        "UNREACHABLE on {} (:443 & :22) while Home Canary ({}) is online",
                        prefs.expected_wsh_ip, prefs.canary_host
                    ),
                });
            }
            IncidentTransition::Recovered if prefs.categories.recovery_alerts => {
                recovery_keys.push(key.to_string());
                recovery_items.push(FormattedBulletItem {
                    label: "DietPi WSH Host".to_string(),
                    detail: format!("Recovered and reachable at {}", prefs.expected_wsh_ip),
                });
            }
            _ => {}
        }
    }

    // ------------------------------------------------------------------------
    // 2. Suite Production App Health Probes (Tier 3)
    // ------------------------------------------------------------------------
    if prefs.categories.app_and_host_failures && !input.maintenance_suppressed {
        if let Some(ref apps) = input.apps {
            let simultaneous_failures = apps
                .iter()
                .filter(|a| a.status != "healthy")
                .count();
            // Immediate alert when >=3 apps fail simultaneously; 2-strike debounce for single-app blips
            let debounce = if simultaneous_failures >= 3 { 1 } else { 2 };

            for app in apps {
                let key = format!("app_health:{}", app.slug);
                let fail_fp = if app.status == "healthy" {
                    None
                } else {
                    Some(format!(
                        "{}:{}",
                        app.status,
                        app.detail.as_deref().unwrap_or("unhealthy")
                    ))
                };
                match evaluate_incident_key(
                    db,
                    &key,
                    fail_fp.as_deref(),
                    debounce,
                    |_, _| false,
                    &now_iso,
                ) {
                    IncidentTransition::Triggered => {
                        failure_keys.push(key);
                        let detail = match app.detail.as_deref() {
                            Some(d) if !d.is_empty() => format!("{} ({})", app.status.to_uppercase(), d),
                            _ => app.status.to_uppercase(),
                        };
                        failure_items.push(FormattedBulletItem {
                            label: app.display_name.clone(),
                            detail,
                        });
                        if !app.base_path.trim().is_empty() {
                            let clean_bp = app.base_path.trim().trim_end_matches('/');
                            single_app_failure_url = Some((
                                format!("https://wsh.panoramadr.com{}", clean_bp),
                                format!("Open {}", app.display_name),
                            ));
                        }
                    }
                    IncidentTransition::Recovered if prefs.categories.recovery_alerts => {
                        recovery_keys.push(key);
                        recovery_items.push(FormattedBulletItem {
                            label: app.display_name.clone(),
                            detail: "Healthy (/api/health OK)".to_string(),
                        });
                    }
                    _ => {}
                }
            }
        }
    }

    // ------------------------------------------------------------------------
    // 3. Home Lab Appliances (Tier 2 - 60s, 2-strike debounce)
    // ------------------------------------------------------------------------
    if prefs.categories.app_and_host_failures && !input.maintenance_suppressed {
        if let Some(ref appliances) = input.appliances {
            for appl in appliances {
                let key = format!("appliance:{}", appl.key);
                let fail_fp = if appl.status.eq_ignore_ascii_case("ONLINE") {
                    None
                } else {
                    Some("offline")
                };
                match evaluate_incident_key(db, &key, fail_fp, 2, |_, _| false, &now_iso) {
                    IncidentTransition::Triggered => {
                        failure_keys.push(key);
                        failure_items.push(FormattedBulletItem {
                            label: appl.name.clone(),
                            detail: format!("OFFLINE ({})", appl.host),
                        });
                    }
                    IncidentTransition::Recovered if prefs.categories.recovery_alerts => {
                        recovery_keys.push(key);
                        recovery_items.push(FormattedBulletItem {
                            label: appl.name.clone(),
                            detail: format!("ONLINE ({})", appl.host),
                        });
                    }
                    _ => {}
                }
            }
        }
    }

    // ------------------------------------------------------------------------
    // 4. DietPi WSH Services, Thermals, Security & Updates (Tier 3)
    // ------------------------------------------------------------------------
    if let Some(ref wsh) = input.wsh {
        if prefs.categories.app_and_host_failures && !input.maintenance_suppressed {
            for (svc_name, svc_state) in [
                ("Lighttpd", wsh.lighttpd_status.trim()),
                ("Docker", wsh.docker_status.trim()),
                ("SSH", wsh.ssh_status.trim()),
            ] {
                if svc_state.is_empty() || svc_state.eq_ignore_ascii_case("unknown") {
                    continue;
                }
                let key = format!("wsh_service:{}", svc_name.to_ascii_lowercase());
                let fail_fp = if svc_state == "active" {
                    None
                } else {
                    Some(svc_state)
                };
                match evaluate_incident_key(db, &key, fail_fp, 1, |_, _| false, &now_iso) {
                    IncidentTransition::Triggered => {
                        failure_keys.push(key);
                        failure_items.push(FormattedBulletItem {
                            label: format!("WSH {} Service", svc_name),
                            detail: format!("systemd state '{}' (expected active)", svc_state),
                        });
                    }
                    IncidentTransition::Recovered if prefs.categories.recovery_alerts => {
                        recovery_keys.push(key);
                        recovery_items.push(FormattedBulletItem {
                            label: format!("WSH {} Service", svc_name),
                            detail: "active".to_string(),
                        });
                    }
                    _ => {}
                }
            }

            // RPi 5 active thermal / undervoltage throttle flag (bits 0..=3 only; ignore sticky bits like 0xe0000)
            let throttled_trimmed = wsh.rpi_throttled.trim();
            let th_fp = if is_rpi_actively_throttled(throttled_trimmed) {
                Some(throttled_trimmed)
            } else {
                None
            };
            if evaluate_incident_key(db, "wsh:throttled", th_fp, 1, |_, _| false, &now_iso)
                == IncidentTransition::Triggered
            {
                failure_keys.push("wsh:throttled".to_string());
                failure_items.push(FormattedBulletItem {
                    label: "RPi 5 Thermal/Power".to_string(),
                    detail: format!("vcgencmd throttled = {}", throttled_trimmed),
                });
            }

            // WSH Security Posture Invariants (SEC-01..08)
            let sec_fp = if wsh.security_violation_count > 0 {
                let ids = if wsh.failing_invariants.is_empty() {
                    format!("count={}", wsh.security_violation_count)
                } else {
                    wsh.failing_invariants.join(",")
                };
                Some(ids)
            } else {
                None
            };
            if evaluate_incident_key(
                db,
                "wsh:security_audit",
                sec_fp.as_deref(),
                1,
                |prev, curr| prev != curr,
                &now_iso,
            ) == IncidentTransition::Triggered
            {
                failure_keys.push("wsh:security_audit".to_string());
                let inv_label = if wsh.failing_invariants.is_empty() {
                    format!("{} invariant(s) failed", wsh.security_violation_count)
                } else {
                    format!(
                        "{} failed ({})",
                        wsh.security_violation_count,
                        wsh.failing_invariants.join(", ")
                    )
                };
                failure_items.push(FormattedBulletItem {
                    label: "WSH Network Hardening".to_string(),
                    detail: inv_label,
                });
            }
        }

        // System Updates on WSH (DietPi OS, Debian APT, Kernel Reboot Required)
        if prefs.categories.system_updates {
            let dp_avail = wsh.dietpi_update_available.trim();
            let has_dietpi_update = !dp_avail.is_empty()
                && !dp_avail.eq_ignore_ascii_case("false")
                && !dp_avail.eq_ignore_ascii_case("none");
            if evaluate_update_key(
                db,
                "update:dietpi",
                if has_dietpi_update { Some(dp_avail) } else { None },
                &now_iso,
            ) {
                update_keys.push("update:dietpi".to_string());
                update_items.push(FormattedBulletItem {
                    label: "DietPi OS Update".to_string(),
                    detail: format!("{} → {}", wsh.dietpi_version.trim(), dp_avail),
                });
            }

            let (apt_count, apt_pkgs, apt_hash) = summarize_apt_upgradable(&wsh.apt_upgradable_raw);
            if evaluate_update_key(
                db,
                "update:apt",
                if apt_count > 0 {
                    Some(apt_hash.as_str())
                } else {
                    None
                },
                &now_iso,
            ) {
                update_keys.push("update:apt".to_string());
                let preview: Vec<&str> = apt_pkgs.iter().take(5).map(|s| s.as_str()).collect();
                let suffix = if apt_count > 5 {
                    format!(" (+{} more)", apt_count - 5)
                } else {
                    String::new()
                };
                update_items.push(FormattedBulletItem {
                    label: format!("Debian APT ({} pkg{})", apt_count, if apt_count == 1 { "" } else { "s" }),
                    detail: format!("{}{}", preview.join(", "), suffix),
                });
            }

            let reboot_fp = if wsh.reboot_required {
                Some(format!("reboot:{}", wsh.kernel.trim()))
            } else {
                None
            };
            if evaluate_update_key(db, "wsh:reboot_required", reboot_fp.as_deref(), &now_iso) {
                update_keys.push("wsh:reboot_required".to_string());
                update_items.push(FormattedBulletItem {
                    label: "WSH Reboot Required".to_string(),
                    detail: format!("Pending kernel/library restart (running {})", wsh.kernel.trim()),
                });
            }
        }
    }

    // ------------------------------------------------------------------------
    // 5. Upstream Cloudflare Tunnel Release (Tier 4 - Hourly)
    // ------------------------------------------------------------------------
    if prefs.categories.system_updates {
        if let Some(ref cf) = input.tunnel_version {
            let cf_fp = if cf.update_available {
                cf.latest_version.as_deref()
            } else {
                None
            };
            if evaluate_update_key(db, "update:cloudflared", cf_fp, &now_iso) {
                update_keys.push("update:cloudflared".to_string());
                let running_v = cf.running_version.as_deref().unwrap_or("current");
                let latest_v = cf.latest_version.as_deref().unwrap_or("latest");
                update_items.push(FormattedBulletItem {
                    label: "Cloudflare Tunnel".to_string(),
                    detail: format!("v{} → v{}", running_v, latest_v),
                });
                if let Some(ref rel_url) = cf.release_url {
                    update_url = Some((
                        rel_url.clone(),
                        format!("cloudflared v{} Release Notes", latest_v),
                    ));
                }
            }
        }
    }

    // ------------------------------------------------------------------------
    // 6. SSL Certificate Expiry & Cryptographic Drift (Tier 4 - Hourly)
    // ------------------------------------------------------------------------
    if prefs.categories.ssl_alerts && !input.maintenance_suppressed {
        if let Some(ref domains) = input.ssl_domains {
            for d in domains {
                let rank = ssl_severity_rank(&d.status, &d.drift_status);
                let key = format!("ssl:{}", d.domain.to_ascii_lowercase());
                let fail_fp = if rank > 0 {
                    Some(format!("r{}:{}:{}:{}", rank, d.status, d.drift_status, d.thumbprint))
                } else {
                    None
                };

                let escalated = |prev_fp: &str, new_fp: &str| -> bool {
                    let p_rank = prev_fp
                        .strip_prefix('r')
                        .and_then(|s| s.chars().next())
                        .and_then(|c| c.to_digit(10))
                        .unwrap_or(0);
                    let n_rank = new_fp
                        .strip_prefix('r')
                        .and_then(|s| s.chars().next())
                        .and_then(|c| c.to_digit(10))
                        .unwrap_or(0);
                    n_rank > p_rank
                };

                match evaluate_incident_key(db, &key, fail_fp.as_deref(), 1, escalated, &now_iso) {
                    IncidentTransition::Triggered => {
                        failure_keys.push(key);
                        let detail = if d.drift_status == "DRIFT_DETECTED" {
                            format!("CERT DRIFT ({}, {}d left)", d.domain, d.days_remaining)
                        } else if d.status == "SELF_SIGNED" || d.drift_status == "SELF_SIGNED" {
                            format!("SELF-SIGNED CERT on {}", d.domain)
                        } else {
                            format!("{} ({}d left on {})", d.status, d.days_remaining, d.domain)
                        };
                        failure_items.push(FormattedBulletItem {
                            label: format!("SSL • {}", d.display_name),
                            detail,
                        });
                    }
                    IncidentTransition::Recovered if prefs.categories.recovery_alerts => {
                        recovery_keys.push(key);
                        recovery_items.push(FormattedBulletItem {
                            label: format!("SSL • {}", d.display_name),
                            detail: format!("In Sync & Healthy ({}d remaining)", d.days_remaining),
                        });
                    }
                    _ => {}
                }
            }
        }
    }

    // ------------------------------------------------------------------------
    // 7. GFS Database Backup Ledger (Tier 4 - Hourly)
    // ------------------------------------------------------------------------
    if prefs.categories.backup_failures {
        if let Some(ref bk) = input.backup {
            let fp = bk
                .incident_key
                .as_deref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty());
            match evaluate_incident_key(
                db,
                "backup:gfs",
                fp,
                1,
                |prev, curr| prev != curr,
                &now_iso,
            ) {
                IncidentTransition::Triggered => {
                    failure_keys.push("backup:gfs".to_string());
                    let detail = if !bk.failed_apps.is_empty() {
                        format!("Failed apps: {}", bk.failed_apps.join(", "))
                    } else {
                        format!(
                            "Status: {} ({} missed/failed in 7d window)",
                            bk.last_run_status.as_deref().unwrap_or("Failed"),
                            bk.failed_runs_7d.max(1)
                        )
                    };
                    failure_items.push(FormattedBulletItem {
                        label: "GFS Database Backup".to_string(),
                        detail,
                    });
                }
                IncidentTransition::Recovered if prefs.categories.recovery_alerts => {
                    recovery_keys.push("backup:gfs".to_string());
                    recovery_items.push(FormattedBulletItem {
                        label: "GFS Database Backup".to_string(),
                        detail: "Latest scheduled backup succeeded".to_string(),
                    });
                }
                _ => {}
            }
        }
    }

    // ------------------------------------------------------------------------
    // 8. Production Smoke Test Runs (4x/Day Scheduled + IPC/Manual)
    // ------------------------------------------------------------------------
    if prefs.categories.smoke_failures {
        if let Some(ref smoke) = input.latest_smoke_run {
            let prev_smoke = db.get_pushover_alert_state("smoke:latest").ok().flatten();
            if smoke.failed > 0 {
                // On first-ever baseline with no prior record, ignore stale historical runs (>45m old)
                let should_seed_silently =
                    prev_smoke.is_none() && !is_smoke_run_recent(&smoke.timestamp, now_utc, 45);
                if should_seed_silently {
                    let _ = db.upsert_pushover_alert_state(
                        "smoke:latest",
                        &smoke.id,
                        true,
                        1,
                        None,
                    );
                } else if is_smoke_run_recent(&smoke.timestamp, now_utc, 12 * 60) {
                    if evaluate_incident_key(
                        db,
                        "smoke:latest",
                        Some(smoke.id.as_str()),
                        1,
                        |prev_id, new_id| prev_id != new_id,
                        &now_iso,
                    ) == IncidentTransition::Triggered
                    {
                        failure_keys.push("smoke:latest".to_string());
                        failure_items.push(FormattedBulletItem {
                            label: format!("Smoke Suite ({})", smoke.triggered_by),
                            detail: format!(
                                "{} failed ({}/{} passed)",
                                smoke.failed, smoke.passed, smoke.total
                            ),
                        });
                        for chk in smoke.failed_checks.iter().take(4) {
                            failure_items.push(FormattedBulletItem {
                                label: "Failed Check".to_string(),
                                detail: chk.clone(),
                            });
                        }
                    }
                }
            } else {
                match evaluate_incident_key(
                    db,
                    "smoke:latest",
                    None,
                    1,
                    |_, _| false,
                    &now_iso,
                ) {
                    IncidentTransition::Recovered if prefs.categories.recovery_alerts => {
                        recovery_keys.push("smoke:latest".to_string());
                        recovery_items.push(FormattedBulletItem {
                            label: "Production Smoke Suite".to_string(),
                            detail: format!("All {}/{} checks passing", smoke.passed, smoke.total),
                        });
                    }
                    _ => {}
                }
            }
        }
    }

    // ------------------------------------------------------------------------
    // Coalesce into Clean, Scannable Batches (<= 900 chars each)
    // ------------------------------------------------------------------------
    let mut batches = Vec::new();

    if !failure_items.is_empty() {
        let count = failure_keys.len();
        let title = if count == 1 {
            format!("PanoramaSRE • Alert: {}", failure_items[0].label)
        } else {
            format!("PanoramaSRE • {} Actionable Failures", count)
        };
        let html_message = build_scannable_html_message(
            "Action Needed (Failure Detected):",
            &failure_items,
            None,
            MAX_SCANNABLE_MESSAGE_CHARS,
        );
        let (fail_url, fail_url_title) = if count == 1 && failure_keys[0].starts_with("app_health:") {
            match single_app_failure_url {
                Some((u, t)) => (Some(u), Some(t)),
                None => (None, None),
            }
        } else {
            (None, None)
        };
        batches.push(PlannedPushoverBatch {
            kind: OutboundBatchKind::Failure,
            title,
            html_message,
            priority: prefs.failure_priority.clamp(-2, 1),
            sound: prefs.failure_sound.clone(),
            url: fail_url,
            url_title: fail_url_title,
            dedup_keys_notified: failure_keys,
        });
    }

    if !update_items.is_empty() {
        let count = update_keys.len();
        let title = if count == 1 {
            format!("PanoramaSRE • {}", update_items[0].label)
        } else {
            format!("PanoramaSRE • {} System Updates", count)
        };
        let html_message = build_scannable_html_message(
            "System Updates Available:",
            &update_items,
            None,
            MAX_SCANNABLE_MESSAGE_CHARS,
        );
        let (u_link, u_title) = match update_url {
            Some((u, t)) => (Some(u), Some(t)),
            None => (None, None),
        };
        batches.push(PlannedPushoverBatch {
            kind: OutboundBatchKind::Update,
            title,
            html_message,
            priority: 0,
            sound: prefs.update_sound.clone(),
            url: u_link,
            url_title: u_title,
            dedup_keys_notified: update_keys,
        });
    }

    if !recovery_items.is_empty() && prefs.categories.recovery_alerts {
        let count = recovery_keys.len();
        let title = if count == 1 {
            format!("PanoramaSRE • Resolved: {}", recovery_items[0].label)
        } else {
            format!("PanoramaSRE • {} Incidents Resolved", count)
        };
        let html_message = build_scannable_html_message(
            "Recovered to Healthy State:",
            &recovery_items,
            None,
            MAX_SCANNABLE_MESSAGE_CHARS,
        );
        batches.push(PlannedPushoverBatch {
            kind: OutboundBatchKind::Recovery,
            title,
            html_message,
            priority: -1,
            sound: prefs.recovery_sound.clone(),
            url: None,
            url_title: None,
            dedup_keys_notified: recovery_keys,
        });
    }

    batches
}

/// Optional hook invoked from `optin_ops.rs` when new Parakith D1 SMS opt-in records arrive.
pub async fn maybe_notify_parakith_opt_ins(
    db: &Arc<Mutex<SreDatabase>>,
    new_count: usize,
    latest_id: i64,
    latest_consent: &str,
) {
    if new_count == 0 {
        return;
    }

    let (prefs, creds_opt) = {
        let Ok(guard) = db.lock() else {
            return;
        };
        let p = load_preferences(&guard);
        let c = resolve_pushover_credentials(&guard);
        (p, c)
    };

    if !prefs.enabled || !prefs.categories.opt_in_events {
        return;
    }
    let Some(creds) = creds_opt else {
        return;
    };

    let verdict = verify_trusted_home_network(&prefs.expected_wsh_ip, &prefs.canary_host).await;
    if !verdict.is_trusted {
        return;
    }

    let items = vec![FormattedBulletItem {
        label: if new_count == 1 {
            format!("Record #{}", latest_id)
        } else {
            format!("{} New Records (latest #{})", new_count, latest_id)
        },
        detail: format!("consent: {}", latest_consent),
    }];
    let html = build_scannable_html_message(
        "Parakith D1 SMS Opt-In Sync:",
        &items,
        None,
        MAX_SCANNABLE_MESSAGE_CHARS,
    );
    let device_opt = if prefs.device.is_empty() {
        None
    } else {
        Some(prefs.device.as_str())
    };

    match dispatch_pushover_message(
        &creds,
        "PanoramaSRE • Parakith Opt-In",
        &html,
        0,
        Some(prefs.update_sound.as_str()),
        device_opt,
        None,
        None,
    )
    .await
    {
        Ok(receipt) => {
            if let Ok(guard) = db.lock() {
                let _ = guard.log_action(
                    "NOTIFY",
                    "INFO",
                    &format!("Sent Pushover alert for {} Parakith opt-in(s)", new_count),
                    Some(&format!("request={}", receipt.request_id)),
                );
            }
        }
        Err(err) => {
            if let Ok(guard) = db.lock() {
                let _ = guard.log_action(
                    "NOTIFY",
                    "ERROR",
                    &format!("Pushover Parakith opt-in dispatch failed: {}", err),
                    None,
                );
            }
        }
    }
}

// ============================================================================
// Tauri IPC Commands
// ============================================================================

#[tauri::command]
pub async fn get_pushover_settings(
    db: tauri::State<'_, Arc<Mutex<SreDatabase>>>,
) -> Result<PushoverSettingsViewDto, String> {
    let (prefs, creds_opt, tracked_count) = {
        let guard = db.lock().map_err(|e| format!("DB mutex poisoned: {}", e))?;
        let p = load_preferences(&guard);
        let c = resolve_pushover_credentials(&guard);
        let count = guard
            .get_all_pushover_alert_states()
            .map(|v| v.len())
            .unwrap_or(0);
        (p, c, count)
    };

    let network_gate =
        verify_trusted_home_network(&prefs.expected_wsh_ip, &prefs.canary_host).await;

    match creds_opt {
        Some(creds) => Ok(PushoverSettingsViewDto {
            configured: true,
            credential_source: creds.source,
            masked_token: mask_secret_preview(&creds.api_token),
            masked_user: mask_secret_preview(&creds.user_key),
            preferences: prefs,
            network_gate,
            tracked_state_count: tracked_count,
        }),
        None => Ok(PushoverSettingsViewDto {
            configured: false,
            credential_source: "none".to_string(),
            masked_token: String::new(),
            masked_user: String::new(),
            preferences: prefs,
            network_gate,
            tracked_state_count: tracked_count,
        }),
    }
}

#[tauri::command]
pub async fn save_pushover_settings(
    db: tauri::State<'_, Arc<Mutex<SreDatabase>>>,
    input: SavePushoverSettingsInput,
) -> Result<PushoverSettingsViewDto, String> {
    {
        let guard = db.lock().map_err(|e| format!("DB mutex poisoned: {}", e))?;

        if input.clear_stored_credentials.unwrap_or(false) {
            guard
                .set_setting(SETTING_PUSHOVER_TOKEN_DPAPI, "")
                .map_err(|e| e.to_string())?;
            guard
                .set_setting(SETTING_PUSHOVER_USER_DPAPI, "")
                .map_err(|e| e.to_string())?;
        } else {
            if let Some(ref raw_tok) = input.api_token {
                let clean = raw_tok.trim();
                if !clean.is_empty() {
                    let sealed = seal_secret_for_storage(clean)?;
                    guard
                        .set_setting(SETTING_PUSHOVER_TOKEN_DPAPI, &sealed)
                        .map_err(|e| e.to_string())?;
                }
            }
            if let Some(ref raw_usr) = input.user_key {
                let clean = raw_usr.trim();
                if !clean.is_empty() {
                    let sealed = seal_secret_for_storage(clean)?;
                    guard
                        .set_setting(SETTING_PUSHOVER_USER_DPAPI, &sealed)
                        .map_err(|e| e.to_string())?;
                }
            }
        }

        save_preferences(&guard, &input.preferences)?;
        let _ = guard.log_action(
            "NOTIFY",
            "INFO",
            "Updated Pushover notification preferences & trusted-network gate settings",
            Some(&format!(
                "enabled={} wsh_ip={} canary={}",
                input.preferences.enabled,
                input.preferences.expected_wsh_ip,
                input.preferences.canary_host
            )),
        );
    }

    get_pushover_settings(db).await
}

#[tauri::command]
pub async fn reset_pushover_alert_baseline(
    db: tauri::State<'_, Arc<Mutex<SreDatabase>>>,
) -> Result<usize, String> {
    let guard = db.lock().map_err(|e| format!("DB mutex poisoned: {}", e))?;
    let prev_count = guard
        .get_all_pushover_alert_states()
        .map(|v| v.len())
        .unwrap_or(0);
    guard
        .clear_all_pushover_alert_states()
        .map_err(|e| format!("Failed clearing Pushover state ledger: {}", e))?;
    let _ = guard.log_action(
        "NOTIFY",
        "INFO",
        &format!(
            "Cleared {} Pushover deduplication fingerprint(s); next sync will re-evaluate cleanly",
            prev_count
        ),
        None,
    );
    Ok(prev_count)
}

#[tauri::command]
pub async fn send_test_pushover_notification(
    db: tauri::State<'_, Arc<Mutex<SreDatabase>>>,
    sound_override: Option<String>,
) -> Result<PushoverSendReceipt, String> {
    let (prefs, creds) = {
        let guard = db.lock().map_err(|e| format!("DB mutex poisoned: {}", e))?;
        let p = load_preferences(&guard);
        let c = resolve_pushover_credentials(&guard).ok_or_else(|| {
            "Pushover API Token & User Key are not configured. Enter them in Settings -> SSH & Secrets or .env.local.keys.".to_string()
        })?;
        (p, c)
    };

    let gate = verify_trusted_home_network(&prefs.expected_wsh_ip, &prefs.canary_host).await;
    let gate_label = if gate.is_trusted {
        format!("ARMED ({})", gate.reason)
    } else {
        format!("PAUSED FOR AUTO-ALERTS ({})", gate.reason)
    };

    let chosen_sound = sound_override
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| PANORAMA_SRE_PUSHOVER_SOUND.to_string());

    let items = vec![
        FormattedBulletItem {
            label: "Dispatcher".to_string(),
            detail: "PanoramaSRE Rust TLS 1.3 Client (Direct)".to_string(),
        },
        FormattedBulletItem {
            label: "Network Gate".to_string(),
            detail: gate_label,
        },
        FormattedBulletItem {
            label: "Sound Profile".to_string(),
            detail: format!("{} (PanoramaSRE Signature)", chosen_sound),
        },
    ];
    let html_body = build_scannable_html_message(
        "Pushover Verification Succeeded:",
        &items,
        Some("Manual test triggered from PanoramaSRE Settings."),
        MAX_SCANNABLE_MESSAGE_CHARS,
    );

    let device_opt = if prefs.device.is_empty() {
        None
    } else {
        Some(prefs.device.as_str())
    };

    let receipt = dispatch_pushover_message(
        &creds,
        "PanoramaSRE • Test Notification",
        &html_body,
        0,
        Some(chosen_sound.as_str()),
        device_opt,
        None,
        None,
    )
    .await?;

    if let Ok(guard) = db.lock() {
        let _ = guard.log_action(
            "NOTIFY",
            "INFO",
            "Delivered manual Pushover test notification",
            Some(&format!("request={} sound={}", receipt.request_id, chosen_sound)),
        );
    }

    Ok(receipt)
}

#[tauri::command]
pub async fn evaluate_and_notify_sync(
    db: tauri::State<'_, Arc<Mutex<SreDatabase>>>,
    dev_supervisor: tauri::State<'_, Arc<DevSupervisor>>,
    input: SyncAlertEvaluationInput,
) -> Result<SyncEvaluationSummaryDto, String> {
    if !is_current_instance_alert_leader(dev_supervisor.inner()) {
        return Ok(SyncEvaluationSummaryDto {
            skipped: true,
            skip_reason: Some("NOT_PRIMARY_INSTANCE".to_string()),
            network_state: TrustedNetworkState::TrustedHomeOrVpn,
            dispatched_batches: 0,
            notified_keys: Vec::new(),
        });
    }

    let (prefs, creds_opt) = {
        let guard = db.lock().map_err(|e| format!("DB mutex poisoned: {}", e))?;
        (load_preferences(&guard), resolve_pushover_credentials(&guard))
    };

    if !prefs.enabled {
        return Ok(SyncEvaluationSummaryDto {
            skipped: true,
            skip_reason: Some("PUSHOVER_DISABLED".to_string()),
            network_state: TrustedNetworkState::TrustedHomeOrVpn,
            dispatched_batches: 0,
            notified_keys: Vec::new(),
        });
    }

    let Some(creds) = creds_opt else {
        return Ok(SyncEvaluationSummaryDto {
            skipped: true,
            skip_reason: Some("CREDENTIALS_NOT_CONFIGURED".to_string()),
            network_state: TrustedNetworkState::TrustedHomeOrVpn,
            dispatched_batches: 0,
            notified_keys: Vec::new(),
        });
    };

    // CRITICAL ROAMING LAPTOP GATE:
    // Short-circuit BEFORE touching pushover_alert_state so away/untrusted networks
    // never emit false-positive outages AND never pollute/trigger fake recovery alerts on return!
    let verdict = verify_trusted_home_network(&prefs.expected_wsh_ip, &prefs.canary_host).await;
    if !verdict.is_trusted {
        return Ok(SyncEvaluationSummaryDto {
            skipped: true,
            skip_reason: Some(verdict.reason.clone()),
            network_state: verdict.state,
            dispatched_batches: 0,
            notified_keys: Vec::new(),
        });
    }

    let planned_batches = {
        let guard = db.lock().map_err(|e| format!("DB mutex poisoned: {}", e))?;
        let mut sanitized_input = input.clone();
        if let Some(ref mut bk) = sanitized_input.backup {
            if let Some(ref key) = bk.incident_key {
                let dismissed = load_dismissed_backup_keys(&guard);
                if dismissed.iter().any(|d| d == key) {
                    bk.incident_key = None;
                }
            }
        }
        plan_pushover_batches_from_sync(&guard, &prefs, &verdict, &sanitized_input, chrono::Utc::now())
    };

    if planned_batches.is_empty() {
        return Ok(SyncEvaluationSummaryDto {
            skipped: false,
            skip_reason: None,
            network_state: verdict.state,
            dispatched_batches: 0,
            notified_keys: Vec::new(),
        });
    }

    let mut dispatched_batches = 0usize;
    let mut notified_keys = Vec::new();
    let device_opt = if prefs.device.is_empty() {
        None
    } else {
        Some(prefs.device.as_str())
    };

    for batch in planned_batches {
        match dispatch_pushover_message(
            &creds,
            &batch.title,
            &batch.html_message,
            batch.priority,
            Some(batch.sound.as_str()),
            device_opt,
            batch.url.as_deref(),
            batch.url_title.as_deref(),
        )
        .await
        {
            Ok(receipt) => {
                dispatched_batches += 1;
                notified_keys.extend(batch.dedup_keys_notified.clone());
                if let Ok(guard) = db.lock() {
                    let _ = guard.log_action(
                        "NOTIFY",
                        if batch.kind == OutboundBatchKind::Failure {
                            "WARN"
                        } else {
                            "INFO"
                        },
                        &format!("Pushover sent: {}", batch.title),
                        Some(&format!(
                            "request={} keys={}",
                            receipt.request_id,
                            batch.dedup_keys_notified.join(",")
                        )),
                    );
                }
            }
            Err(err) => {
                // Roll back is_failing on keys that failed HTTP delivery so next sync retries cleanly
                if let Ok(guard) = db.lock() {
                    for k in &batch.dedup_keys_notified {
                        let _ = guard.upsert_pushover_alert_state(k, "retry_pending", false, 1, None);
                    }
                    let _ = guard.log_action(
                        "NOTIFY",
                        "ERROR",
                        &format!("Pushover delivery failed for '{}': {}", batch.title, err),
                        None,
                    );
                }
            }
        }
    }

    Ok(SyncEvaluationSummaryDto {
        skipped: false,
        skip_reason: None,
        network_state: verdict.state,
        dispatched_batches,
        notified_keys,
    })
}

#[tauri::command]
pub async fn get_dismissed_backup_incidents(
    db: tauri::State<'_, Arc<Mutex<SreDatabase>>>,
) -> Result<Vec<String>, String> {
    let guard = db.lock().map_err(|e| format!("DB mutex poisoned: {}", e))?;
    Ok(load_dismissed_backup_keys(&guard))
}

#[tauri::command]
pub async fn dismiss_backup_incident(
    db: tauri::State<'_, Arc<Mutex<SreDatabase>>>,
    incident_key: String,
) -> Result<Vec<String>, String> {
    let guard = db.lock().map_err(|e| format!("DB mutex poisoned: {}", e))?;
    let updated = record_dismissed_backup_key(&guard, &incident_key)?;
    let _ = guard.log_action(
        "BACKUP",
        "INFO",
        &format!("Globally dismissed backup incident '{}'", incident_key.trim()),
        None,
    );
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn trusted_verdict_both_up() -> TrustedNetworkVerdict {
        TrustedNetworkVerdict {
            state: TrustedNetworkState::TrustedHomeOrVpn,
            is_trusted: true,
            wsh_resolved_ips: vec!["172.25.25.5".to_string()],
            matched_expected_wsh_ip: true,
            wsh_reachable: true,
            canary_reachable: true,
            reason: "Home LAN verified".to_string(),
        }
    }

    fn untrusted_roaming_verdict() -> TrustedNetworkVerdict {
        TrustedNetworkVerdict {
            state: TrustedNetworkState::RoamingUntrusted,
            is_trusted: false,
            wsh_resolved_ips: vec!["104.21.76.18".to_string()],
            matched_expected_wsh_ip: false,
            wsh_reachable: false,
            canary_reachable: false,
            reason: "Away without VPN".to_string(),
        }
    }

    #[test]
    fn dpapi_or_storage_seal_roundtrip_and_masking() {
        let secret = "test_pushover_token_placeholder_01";
        let sealed = seal_secret_for_storage(secret).expect("seal");
        assert!(!sealed.contains(secret));
        let unsealed = unseal_secret_from_storage(&sealed).expect("unseal");
        assert_eq!(unsealed, secret);
        assert_eq!(mask_secret_preview(secret), "test••••r_01");
    }

    #[test]
    fn html_formatter_enforces_900_char_cap_and_escapes_html() {
        let mut items = Vec::new();
        for i in 1..=25 {
            items.push(FormattedBulletItem {
                label: format!("Service <#{}>", i),
                detail: "HTTP 502 & upstream connection reset while probing /api/health endpoint".to_string(),
            });
        }

        let msg = build_scannable_html_message(
            "Action Needed <Critical>:",
            &items,
            Some("Check PanoramaSRE console."),
            MAX_SCANNABLE_MESSAGE_CHARS,
        );

        assert!(msg.chars().count() <= MAX_SCANNABLE_MESSAGE_CHARS);
        assert!(msg.contains("<b>Action Needed &lt;Critical&gt;:</b>"));
        assert!(msg.contains("&amp; upstream"));
        assert!(msg.contains("additional item(s) in PanoramaSRE</i>"));
        // Verify balanced <b> and <i> tags
        assert_eq!(msg.matches("<b>").count(), msg.matches("</b>").count());
        assert_eq!(msg.matches("<i>").count(), msg.matches("</i>").count());
    }

    #[test]
    fn updates_fire_strictly_once_per_unique_version_or_apt_set() {
        let db = SreDatabase::new(":memory:").unwrap();
        let prefs = PushoverPreferences::default();
        let verdict = trusted_verdict_both_up();
        let now = chrono::Utc::now();

        let mut input = SyncAlertEvaluationInput::default();
        input.tunnel_version = Some(TunnelVersionObservationDto {
            running_version: Some("2026.10.6".to_string()),
            latest_version: Some("2026.11.0".to_string()),
            update_available: true,
            release_url: Some("https://github.com/cloudflare/cloudflared/releases/tag/2026.11.0".to_string()),
        });
        input.wsh = Some(WshObservationDto {
            dietpi_version: "9.8.0".to_string(),
            dietpi_update_available: String::new(),
            reboot_required: true,
            kernel: "6.12.20-rpt-rpi-2712".to_string(),
            rpi_throttled: "0x0".to_string(),
            lighttpd_status: "active".to_string(),
            docker_status: "active".to_string(),
            ssh_status: "active".to_string(),
            apt_upgradable_raw: "Listing...\ndocker-ce/bookworm 5:27.4.0 arm64 [upgradable from: 5:27.3.1]\n".to_string(),
            security_violation_count: 0,
            failing_invariants: Vec::new(),
        });

        // First evaluation -> 1 coalesced Update batch with 3 keys
        let first = plan_pushover_batches_from_sync(&db, &prefs, &verdict, &input, now);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].kind, OutboundBatchKind::Update);
        assert_eq!(first[0].sound, "cosmic");
        assert_eq!(first[0].dedup_keys_notified.len(), 3);

        // Next 5 periodic ticks with identical versions -> 0 notifications!
        for _ in 0..5 {
            let repeat = plan_pushover_batches_from_sync(&db, &prefs, &verdict, &input, now);
            assert!(repeat.is_empty());
        }

        // Upstream releases an even newer cloudflared 2026.11.1 -> fires strictly for the new version!
        input.tunnel_version.as_mut().unwrap().latest_version = Some("2026.11.1".to_string());
        let newer = plan_pushover_batches_from_sync(&db, &prefs, &verdict, &input, now);
        assert_eq!(newer.len(), 1);
        assert_eq!(newer[0].dedup_keys_notified, vec!["update:cloudflared".to_string()]);
    }

    #[test]
    fn debounces_single_blip_and_freezes_state_while_roaming() {
        let db = SreDatabase::new(":memory:").unwrap();
        let mut prefs = PushoverPreferences::default();
        prefs.categories.recovery_alerts = true;
        let home = trusted_verdict_both_up();
        let away = untrusted_roaming_verdict();
        let now = chrono::Utc::now();

        let mut fail_input = SyncAlertEvaluationInput::default();
        fail_input.appliances = Some(vec![ApplianceObservationDto {
            key: "ha".to_string(),
            name: "Home Assistant".to_string(),
            host: "ha.panoramadr.com".to_string(),
            status: "OFFLINE".to_string(),
        }]);

        // Tick 1 at home: 1st failure is debounced (requires 2 consecutive ticks)
        assert!(plan_pushover_batches_from_sync(&db, &prefs, &home, &fail_input, now).is_empty());

        // Tick 2 at home: 2nd consecutive failure -> triggers 1 Failure alert!
        let triggered = plan_pushover_batches_from_sync(&db, &prefs, &home, &fail_input, now);
        assert_eq!(triggered.len(), 1);
        assert_eq!(triggered[0].kind, OutboundBatchKind::Failure);

        // Tick 3 while roaming without VPN (even if everything looks healthy or offline) -> frozen!
        let mut ok_input = SyncAlertEvaluationInput::default();
        ok_input.appliances = Some(vec![ApplianceObservationDto {
            key: "ha".to_string(),
            name: "Home Assistant".to_string(),
            host: "ha.panoramadr.com".to_string(),
            status: "ONLINE".to_string(),
        }]);
        assert!(plan_pushover_batches_from_sync(&db, &prefs, &away, &ok_input, now).is_empty());
        assert!(db.get_pushover_alert_state("appliance:ha").unwrap().unwrap().is_failing);

        // Tick 4 back on Home LAN/VPN and appliance is ONLINE -> fires Recovery once
        let rec = plan_pushover_batches_from_sync(&db, &prefs, &home, &ok_input, now);
        assert_eq!(rec.len(), 1);
        assert_eq!(rec[0].kind, OutboundBatchKind::Recovery);
    }

    #[test]
    fn alerts_when_wsh_pi_is_down_while_home_canary_is_online() {
        let db = SreDatabase::new(":memory:").unwrap();
        let prefs = PushoverPreferences::default();
        let pi_crashed_at_home = TrustedNetworkVerdict {
            state: TrustedNetworkState::TrustedHomeOrVpn,
            is_trusted: true,
            wsh_resolved_ips: vec!["172.25.25.5".to_string()],
            matched_expected_wsh_ip: true,
            wsh_reachable: false,
            canary_reachable: true,
            reason: "Canary online, WSH down".to_string(),
        };

        let batches = plan_pushover_batches_from_sync(
            &db,
            &prefs,
            &pi_crashed_at_home,
            &SyncAlertEvaluationInput::default(),
            chrono::Utc::now(),
        );
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].kind, OutboundBatchKind::Failure);
        assert_eq!(batches[0].dedup_keys_notified, vec!["wsh:host_reachable".to_string()]);
        assert_eq!(batches[0].url, None);
    }

    #[test]
    fn rpi_throttled_ignores_historical_sticky_bits_and_alerts_only_on_active_bits() {
        assert!(!is_rpi_actively_throttled("0x0"));
        assert!(!is_rpi_actively_throttled("0xe0000"));
        assert!(!is_rpi_actively_throttled("0x50000"));
        assert!(is_rpi_actively_throttled("0x1"));
        assert!(is_rpi_actively_throttled("0x50005"));
        assert!(is_rpi_actively_throttled("0xe0004"));
        assert!(!is_rpi_actively_throttled(""));

        let db = SreDatabase::new(":memory:").unwrap();
        let prefs = PushoverPreferences::default();
        let home = trusted_verdict_both_up();
        let mut input = SyncAlertEvaluationInput::default();
        input.wsh = Some(WshObservationDto {
            dietpi_version: "9.8.0".to_string(),
            dietpi_update_available: String::new(),
            reboot_required: false,
            kernel: "6.12.20".to_string(),
            rpi_throttled: "0xe0000".to_string(),
            lighttpd_status: "active".to_string(),
            docker_status: "active".to_string(),
            ssh_status: "active".to_string(),
            apt_upgradable_raw: String::new(),
            security_violation_count: 0,
            failing_invariants: Vec::new(),
        });

        assert!(plan_pushover_batches_from_sync(&db, &prefs, &home, &input, chrono::Utc::now()).is_empty());

        input.wsh.as_mut().unwrap().rpi_throttled = "0xe0004".to_string();
        let active = plan_pushover_batches_from_sync(&db, &prefs, &home, &input, chrono::Utc::now());
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].dedup_keys_notified, vec!["wsh:throttled".to_string()]);
        assert_eq!(active[0].url, None);
    }

    #[test]
    fn dismissed_backup_incident_keys_persist_globally() {
        let db = SreDatabase::new(":memory:").unwrap();
        assert!(load_dismissed_backup_keys(&db).is_empty());
        let saved = record_dismissed_backup_key(&db, "missed:2026-11-12").expect("save");
        assert_eq!(saved, vec!["missed:2026-11-12".to_string()]);
        // Duplicate insert is idempotent
        let dup = record_dismissed_backup_key(&db, "missed:2026-11-12").expect("dup");
        assert_eq!(dup.len(), 1);
    }
}
