use crate::commands::threat_intel_ops::{build_waf_rule_expression, classify_host_sensitivity, DomainProfile};
use crate::db::SreDatabase;
use crate::otto_db::OttoWafLeaseRow;
use crate::otto_policy::{
    evaluate_policy_decision, is_protected_asn, is_protected_ip, AssetTier, AutonomyMode,
    PolicyDecision, PolicyEvalRequest, PolicyVerdict,
};
use crate::scrubber::scrub_secrets;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::net::IpAddr;
use std::path::Path;
use std::sync::{Arc, Mutex};

pub const CLOUDFLARE_API_BASE_URL: &str = "https://api.cloudflare.com/client/v4";
pub const IMPOSSIBLE_STACK_SCORE_CAP: u32 = 15;
pub const MATERIAL_THREAT_MIN_SCORE: u32 = 60;
pub const WATCH_LOW_MIN_SCORE: u32 = 25;
pub const DEFAULT_TEMP_CHALLENGE_TTL_MINS: i64 = 60;

// ============================================================================
// 1. Dynamic SuiteExposureProfile & Surface-Aware Stack Ground Truth
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExposureSurface {
    StrictPrivate,
    PublicWeb,
    ApexMonitor,
}

impl ExposureSurface {
    pub fn as_str(&self) -> &'static str {
        match self {
            ExposureSurface::StrictPrivate => "StrictPrivate",
            ExposureSurface::PublicWeb => "PublicWeb",
            ExposureSurface::ApexMonitor => "ApexMonitor",
        }
    }

    pub fn from_domain_profile(p: DomainProfile) -> Self {
        match p {
            DomainProfile::StrictPrivate => ExposureSurface::StrictPrivate,
            DomainProfile::PublicWeb => ExposureSurface::PublicWeb,
            DomainProfile::ApexMonitor => ExposureSurface::ApexMonitor,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuiteExposureProfile {
    pub strict_private_hosts: Vec<String>,
    pub public_web_hosts: Vec<String>,
    pub apex_monitor_hosts: Vec<String>,
    pub active_base_paths: Vec<String>,
    pub lan_only_appliances: Vec<String>,
    pub zero_wan_port_forwards: bool,
    pub wsh_stack_summary: String,
    pub public_web_stack_summary: String,
}

impl Default for SuiteExposureProfile {
    fn default() -> Self {
        Self {
            strict_private_hosts: vec!["wsh.panoramadr.com".to_string()],
            public_web_hosts: vec![
                "parakith.com".to_string(),
                "www.parakith.com".to_string(),
                "parakith-site.pages.dev".to_string(),
            ],
            apex_monitor_hosts: vec![
                "panoramadr.com".to_string(),
                "www.panoramadr.com".to_string(),
            ],
            active_base_paths: vec![
                "/auth".to_string(),
                "/spendy".to_string(),
                "/biomed".to_string(),
                "/water".to_string(),
                "/basket".to_string(),
                "/energy".to_string(),
                "/res".to_string(),
            ],
            lan_only_appliances: vec![
                "ui.panoramadr.com".to_string(),
                "protect.panoramadr.com".to_string(),
                "ha.panoramadr.com".to_string(),
                "genmon.panoramadr.com".to_string(),
            ],
            zero_wan_port_forwards: true,
            wsh_stack_summary: "cloudflared (cf-egress-net) -> DietPi RPi 5 Lighttpd :443 -> Next.js 16 / node:22-alpine (127.0.0.1) -> SQLite WAL -> PanoramaAuth RS256/PKCE/AAL3".to_string(),
            public_web_stack_summary: "Cloudflare Pages static assets + Pages Functions (/api/opt-in, HMAC /api/health) + Cloudflare D1 (zero Linux OS, zero Next.js server, zero SSH)".to_string(),
        }
    }
}

/// Dynamically synthesizes `SuiteExposureProfile` from discovered `panorama.app.json` manifests
/// inside `suite_root`, falling back cleanly to the canonical defaults when manifests are absent.
pub fn build_suite_exposure_profile(suite_root: &Path) -> SuiteExposureProfile {
    let mut profile = SuiteExposureProfile::default();
    let mut base_paths: BTreeSet<String> = profile.active_base_paths.iter().cloned().collect();
    let mut strict_hosts: BTreeSet<String> = profile.strict_private_hosts.iter().cloned().collect();
    let mut public_hosts: BTreeSet<String> = profile.public_web_hosts.iter().cloned().collect();

    if let Ok(entries) = std::fs::read_dir(suite_root) {
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let manifest_path = dir.join("panorama.app.json");
            if !manifest_path.is_file() {
                continue;
            }
            let Ok(raw) = std::fs::read_to_string(&manifest_path) else {
                continue;
            };
            let Ok(val) = serde_json::from_str::<Value>(&raw) else {
                continue;
            };

            let hosting = val
                .get("hostingTarget")
                .and_then(|v| v.as_str())
                .unwrap_or("wsh-docker")
                .trim()
                .to_ascii_lowercase();

            if let Some(bp) = val.get("basePath").and_then(|v| v.as_str()) {
                let clean = bp.trim();
                if clean.starts_with('/') && clean.len() > 1 {
                    base_paths.insert(clean.trim_end_matches('/').to_string());
                }
            }

            if let Some(domains) = val
                .pointer("/cloudflare/domains")
                .and_then(|v| v.as_array())
            {
                for d in domains.iter().filter_map(|x| x.as_str()) {
                    let clean = d.trim().to_ascii_lowercase();
                    if clean.is_empty() {
                        continue;
                    }
                    if hosting == "cloudflare-pages" || clean.contains("parakith") {
                        public_hosts.insert(clean);
                    } else if clean.starts_with("wsh.") {
                        strict_hosts.insert(clean);
                    }
                }
            }
        }
    }

    profile.active_base_paths = base_paths.into_iter().collect();
    profile.strict_private_hosts = strict_hosts.into_iter().collect();
    profile.public_web_hosts = public_hosts.into_iter().collect();
    profile
}

pub fn classify_exposure_surface(
    host: &str,
    profile: Option<&SuiteExposureProfile>,
) -> ExposureSurface {
    let h = host.trim().to_ascii_lowercase();
    if let Some(p) = profile {
        if p.public_web_hosts.iter().any(|x| x.eq_ignore_ascii_case(&h)) {
            return ExposureSurface::PublicWeb;
        }
        if p.strict_private_hosts
            .iter()
            .any(|x| x.eq_ignore_ascii_case(&h))
        {
            return ExposureSurface::StrictPrivate;
        }
        if p.apex_monitor_hosts
            .iter()
            .any(|x| x.eq_ignore_ascii_case(&h))
        {
            return ExposureSurface::ApexMonitor;
        }
    }
    ExposureSurface::from_domain_profile(classify_host_sensitivity(host))
}

/// Returns true for probes targeting stacks/technologies completely ABSENT from the target surface:
/// - WordPress, PHP, Spring Boot (`/actuator`), ASP.NET, JSP, AWS (`/.aws`), router exploits anywhere.
/// - Linux OS filesystem (`/.env`, `/.git`, `/.ssh`, `/etc/passwd`, `../`) and Next.js runtime
///   (`/_next/data`, `x-middleware-subrequest`, `next-action`) targeting `PublicWeb` static Cloudflare Pages
///   (`parakith.com`), which has ZERO Linux OS, ZERO disk `.env`, and ZERO Next.js runtime.
pub fn is_absent_stack_probe(path_or_query: &str, surface: ExposureSurface) -> bool {
    let p = path_or_query.trim().to_ascii_lowercase();
    if p.is_empty() {
        return false;
    }

    const UNIVERSAL_ABSENT_PATTERNS: &[&str] = &[
        "wp-login",
        "wp-admin",
        "wp-includes",
        "wp-content",
        "wp-json",
        "wlwmanifest.xml",
        "xmlrpc.php",
        "phpmyadmin",
        ".php",
        "/vendor/phpunit",
        "/boaform",
        "/cgi-bin/",
        "/actuator",
        "/.aws",
        ".aspx",
        ".ashx",
        ".jsp",
        ".cfm",
        "/solr/",
        "/struts",
        "/jmx-console",
    ];
    if UNIVERSAL_ABSENT_PATTERNS.iter().any(|pat| p.contains(pat)) {
        return true;
    }

    // PublicWeb (Cloudflare Pages static + D1) has zero Linux OS / disk / Next.js server runtime
    if surface == ExposureSurface::PublicWeb {
        const PAGES_ABSENT_PATTERNS: &[&str] = &[
            "/.env",
            "/.git",
            "/.ssh",
            "/etc/passwd",
            "/etc/shadow",
            "/proc/self",
            "../",
            "..\\",
            "/_next/data",
            "/_next/image",
            "x-middleware-subrequest",
            "next-action",
        ];
        if PAGES_ABSENT_PATTERNS.iter().any(|pat| p.contains(pat)) {
            return true;
        }
    }

    false
}

/// Surface-aware stack-relevant probe matcher replacing the legacy host-blind matcher.
/// Eliminates `/actuator` and `/.aws` false escalations everywhere, and prevents Linux OS /
/// Next.js probes from false-escalating on `PublicWeb` static Cloudflare Pages (`parakith.com`).
pub fn is_stack_relevant_probe_for_surface(
    path_or_query: &str,
    surface: ExposureSurface,
    active_base_paths: &[String],
) -> bool {
    let p = path_or_query.trim().to_ascii_lowercase();
    if p.is_empty() || is_absent_stack_probe(&p, surface) {
        return false;
    }

    match surface {
        ExposureSurface::StrictPrivate => {
            const STRICT_PATTERNS: &[&str] = &[
                "/.env",
                "/.git",
                "/.ssh",
                "/api/admin",
                "/etc/passwd",
                "../",
                "..\\",
                "<script",
                "union+select",
                "union%20select",
                "x-middleware-subrequest",
                "next-action",
                "/_next/data",
                "/_next/image",
                "x-panorama-service-key",
            ];
            if STRICT_PATTERNS.iter().any(|pat| p.contains(pat)) {
                return true;
            }
            // Match discovered basePath admin/auth/internal API targeting
            active_base_paths.iter().any(|bp| {
                let b = bp.trim().trim_end_matches('/').to_ascii_lowercase();
                !b.is_empty()
                    && (p.starts_with(&format!("{}/api/admin", b))
                        || p.starts_with(&format!("{}/api/sms", b))
                        || p.starts_with(&format!("{}/api/mail", b)))
            })
        }
        ExposureSurface::PublicWeb => {
            // PublicWeb (parakith.com) only runs Cloudflare Pages Functions: /api/opt-in & HMAC /api/health
            const PUBLIC_API_INJECTION: &[&str] = &[
                "<script",
                "union+select",
                "union%20select",
                "x-parakith-probe-sig",
            ];
            let hits_live_function = p.starts_with("/api/opt-in") || p.starts_with("/api/health");
            hits_live_function || PUBLIC_API_INJECTION.iter().any(|pat| p.contains(pat))
        }
        ExposureSurface::ApexMonitor => {
            // Apex monitor has no backend stack; only injection/admin targeting matters if origin responds
            p.starts_with("/api/admin") || p.contains("union+select") || p.contains("union%20select")
        }
    }
}

// ============================================================================
// 2. Surface-Aware 5-Factor Materiality Scoring Engine (0–100)
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MaterialityDisposition {
    NoiseSafeDrop,
    WatchLowMateriality,
    MaterialThreat,
}

impl MaterialityDisposition {
    pub fn as_str(&self) -> &'static str {
        match self {
            MaterialityDisposition::NoiseSafeDrop => "NOISE_SAFE_DROP",
            MaterialityDisposition::WatchLowMateriality => "WATCH_LOW_MATERIALITY",
            MaterialityDisposition::MaterialThreat => "MATERIAL_THREAT",
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalActorTelemetry {
    pub actor_ip: String,
    pub actor_asn: String,
    pub country: String,
    pub host: String,
    pub surface: Option<ExposureSurface>,
    pub paths: Vec<String>,
    pub total_requests: u64,
    pub origin_hits: u64,
    pub origin_200s: u64,
    pub origin_5xx: u64,
    pub edge_blocked_hits: u64,
    pub static_404_hits: u64,
    pub optin_post_hits: u64,
    pub optin_5xx: u64,
    pub stealth_health_probe_hits: u64,
    pub unblocked_rsc_origin_hits: u64,
    pub admin_or_service_key_hits: u64,
    pub verified_origin_breach: bool,
    pub rejected_access_email: bool,
    pub high_risk_intel_tags: Vec<String>,
    pub panorama_auth_anomalies: u64,
    pub outbound_lan_c2_ips: bool,
    pub inbound_wan_default_deny_only: bool,
    pub multi_window_persistent: bool,
    pub volumetric_ratio_vs_median: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialityScoreResult {
    pub surface: String,
    pub stack_match_pts: u32,            // max 25
    pub boundary_penetration_pts: u32,   // max 30
    pub auth_write_impact_pts: u32,      // max 20
    pub volumetric_persistence_pts: u32, // max 15
    pub cross_layer_pts: u32,            // max 10
    pub total_score: u32,                // 0..=100
    pub disposition: MaterialityDisposition,
    pub drop_reason: Option<String>, // absent_stack | edge_blocked_zero_origin | static_404_crawler | wan_default_deny
    pub short_circuited: bool,
    pub hard_triggers: Vec<String>,
    pub rationale: String,
}

pub fn evaluate_external_actor_materiality(
    actor: &ExternalActorTelemetry,
    profile: &SuiteExposureProfile,
) -> MaterialityScoreResult {
    let surface = actor
        .surface
        .unwrap_or_else(|| classify_exposure_surface(&actor.host, Some(profile)));

    // 0. Inbound WAN port scan dropped by UniFi default-deny firewall (0 exposed WAN ports)
    if actor.inbound_wan_default_deny_only
        && !actor.outbound_lan_c2_ips
        && actor.origin_hits == 0
        && !actor.verified_origin_breach
        && !actor.rejected_access_email
    {
        return MaterialityScoreResult {
            surface: surface.as_str().to_string(),
            stack_match_pts: 0,
            boundary_penetration_pts: 0,
            auth_write_impact_pts: 0,
            volumetric_persistence_pts: 0,
            cross_layer_pts: 5,
            total_score: 5,
            disposition: MaterialityDisposition::NoiseSafeDrop,
            drop_reason: Some("wan_default_deny".to_string()),
            short_circuited: true,
            hard_triggers: vec![],
            rationale: "Inbound WAN scan dropped by UniFi default-deny firewall (0 forwarded WAN ports) — safely dropped at Stage 0 ($0 LLM).".to_string(),
        };
    }

    // Collect hard triggers that immediately guarantee MATERIAL_THREAT
    let mut hard_triggers: Vec<String> = Vec::new();
    if actor.verified_origin_breach {
        hard_triggers.push("VERIFIED_4LAYER_ORIGIN_BREACH".to_string());
    }
    if actor.rejected_access_email {
        hard_triggers.push("ZT_REJECTED_EMAIL_LOGIN".to_string());
    }
    if surface == ExposureSurface::PublicWeb
        && (actor.optin_post_hits >= 10 || (actor.optin_post_hits >= 5 && actor.optin_5xx > 0))
    {
        hard_triggers.push("PARAKITH_D1_OPTIN_WRITE_FLOOD".to_string());
    }
    if surface == ExposureSurface::StrictPrivate && actor.unblocked_rsc_origin_hits > 0 {
        hard_triggers.push("UNBLOCKED_NEXTJS_RSC_ORIGIN_HIT".to_string());
    }
    if actor.outbound_lan_c2_ips {
        hard_triggers.push("OUTBOUND_LAN_TO_WAN_C2_IPS".to_string());
    }
    if surface == ExposureSurface::ApexMonitor && actor.origin_200s > 0 {
        hard_triggers.push("APEX_UNEXPECTED_ORIGIN_200_EXPOSURE".to_string());
    }

    // Check stack relevance vs absent stack across all recorded paths
    let has_paths = !actor.paths.is_empty();
    let all_absent_stack = has_paths
        && actor
            .paths
            .iter()
            .all(|p| is_absent_stack_probe(p, surface));
    let any_stack_relevant = actor
        .paths
        .iter()
        .any(|p| is_stack_relevant_probe_for_surface(p, surface, &profile.active_base_paths))
        || actor.optin_post_hits > 0
        || actor.stealth_health_probe_hits > 0
        || actor.unblocked_rsc_origin_hits > 0
        || actor.admin_or_service_key_hits > 0;

    let has_volumetric_impact =
        actor.volumetric_ratio_vs_median >= 5.0 || actor.origin_5xx > 0 || actor.optin_5xx > 0;

    // Hard Short-Circuit Rule: IMPOSSIBLE_STACK_CAP <= 15 -> NOISE_SAFE_DROP ($0 LLM)
    if all_absent_stack
        && hard_triggers.is_empty()
        && !has_volumetric_impact
        && actor.origin_200s == 0
        && actor.optin_post_hits == 0
    {
        let capped = (if actor.high_risk_intel_tags.is_empty() { 8 } else { 14 })
            .min(IMPOSSIBLE_STACK_SCORE_CAP);
        return MaterialityScoreResult {
            surface: surface.as_str().to_string(),
            stack_match_pts: 0,
            boundary_penetration_pts: 0,
            auth_write_impact_pts: 0,
            volumetric_persistence_pts: if actor.total_requests >= 20 { 5 } else { 0 },
            cross_layer_pts: if actor.high_risk_intel_tags.is_empty() { 0 } else { 5 },
            total_score: capped,
            disposition: MaterialityDisposition::NoiseSafeDrop,
            drop_reason: Some("absent_stack".to_string()),
            short_circuited: true,
            hard_triggers: vec![],
            rationale: format!(
                "100% of probes target stacks absent from {} (hard-capped <= {} pts) with zero origin/D1/5xx impact — safely dropped at Stage 0 ($0 LLM).",
                surface.as_str(),
                IMPOSSIBLE_STACK_SCORE_CAP
            ),
        };
    }

    // Factor 1: Surface-Specific Stack Match (0..25)
    let stack_match_pts: u32 = if !hard_triggers.is_empty() || actor.unblocked_rsc_origin_hits > 0 || actor.admin_or_service_key_hits > 0 {
        25
    } else if any_stack_relevant {
        20
    } else if surface == ExposureSurface::StrictPrivate && actor.origin_200s > 0 {
        15
    } else {
        0
    };

    // Factor 2: Exposure Boundary Penetration (0..30)
    let boundary_penetration_pts: u32 = if actor.verified_origin_breach || actor.unblocked_rsc_origin_hits > 0 {
        30
    } else if surface == ExposureSurface::PublicWeb && actor.optin_post_hits >= 5 {
        25
    } else if actor.origin_200s > 0 {
        22
    } else if actor.origin_hits > 0 && actor.edge_blocked_hits == 0 {
        12
    } else {
        0 // Stopped cleanly at Cloudflare WAF/Access (origin_hits == 0)
    };

    // Factor 3: Auth, Write & Data Impact (0..20)
    let auth_write_impact_pts: u32 = if actor.rejected_access_email || actor.panorama_auth_anomalies > 0 {
        20
    } else if actor.optin_post_hits >= 5 || actor.admin_or_service_key_hits > 0 {
        18
    } else if actor.stealth_health_probe_hits >= 3 {
        12
    } else {
        0
    };

    // Factor 4: Volumetric & Sustained Persistence (0..15)
    let volumetric_persistence_pts: u32 = if actor.volumetric_ratio_vs_median >= 5.0 || actor.origin_5xx > 0 || actor.optin_5xx > 0 {
        15
    } else if actor.multi_window_persistent && actor.total_requests >= 25 {
        10
    } else if actor.total_requests >= 50 {
        8
    } else if actor.total_requests >= 10 {
        4
    } else {
        0
    };

    // Factor 5: Cross-Layer Corroboration (0..10)
    let cross_layer_pts: u32 = if actor.outbound_lan_c2_ips
        || (!actor.high_risk_intel_tags.is_empty() && actor.panorama_auth_anomalies > 0)
    {
        10
    } else if !actor.high_risk_intel_tags.is_empty() || actor.panorama_auth_anomalies > 0 {
        6
    } else {
        0
    };

    let raw_sum = (stack_match_pts
        + boundary_penetration_pts
        + auth_write_impact_pts
        + volumetric_persistence_pts
        + cross_layer_pts)
        .min(100);

    // Zero-origin edge-blocked noise short-circuit (non-volumetric, no hard triggers)
    if hard_triggers.is_empty()
        && actor.origin_hits == 0
        && actor.edge_blocked_hits > 0
        && !has_volumetric_impact
        && raw_sum < MATERIAL_THREAT_MIN_SCORE
    {
        let capped = raw_sum.min(20);
        return MaterialityScoreResult {
            surface: surface.as_str().to_string(),
            stack_match_pts,
            boundary_penetration_pts: 0,
            auth_write_impact_pts,
            volumetric_persistence_pts,
            cross_layer_pts,
            total_score: capped,
            disposition: MaterialityDisposition::NoiseSafeDrop,
            drop_reason: Some("edge_blocked_zero_origin".to_string()),
            short_circuited: true,
            hard_triggers: vec![],
            rationale: format!(
                "All hits on {} were stopped at Cloudflare edge ({} blocked, 0 origin reach, non-volumetric) — safely dropped at Stage 0 ($0 LLM).",
                surface.as_str(),
                actor.edge_blocked_hits
            ),
        };
    }

    // Static 404 crawler on PublicWeb / ApexMonitor with zero API writes and zero 5xx
    if hard_triggers.is_empty()
        && matches!(surface, ExposureSurface::PublicWeb | ExposureSurface::ApexMonitor)
        && actor.static_404_hits > 0
        && actor.optin_post_hits == 0
        && actor.stealth_health_probe_hits == 0
        && actor.origin_200s == 0
        && actor.origin_5xx == 0
        && !has_volumetric_impact
        && raw_sum < WATCH_LOW_MIN_SCORE
    {
        return MaterialityScoreResult {
            surface: surface.as_str().to_string(),
            stack_match_pts,
            boundary_penetration_pts,
            auth_write_impact_pts,
            volumetric_persistence_pts,
            cross_layer_pts,
            total_score: raw_sum.min(18),
            disposition: MaterialityDisposition::NoiseSafeDrop,
            drop_reason: Some("static_404_crawler".to_string()),
            short_circuited: false,
            hard_triggers: vec![],
            rationale: format!(
                "Routine 404 internet crawler on {} ({} static 404s, 0 API/write impact) — safely dropped at Stage 0 ($0 LLM).",
                surface.as_str(),
                actor.static_404_hits
            ),
        };
    }

    let final_score = if !hard_triggers.is_empty() {
        raw_sum.clamp(75, 100)
    } else {
        raw_sum
    };

    let (disposition, drop_reason) = if !hard_triggers.is_empty() || final_score >= MATERIAL_THREAT_MIN_SCORE {
        (MaterialityDisposition::MaterialThreat, None)
    } else if final_score >= WATCH_LOW_MIN_SCORE {
        (MaterialityDisposition::WatchLowMateriality, None)
    } else {
        let reason = if actor.origin_hits == 0 {
            "edge_blocked_zero_origin"
        } else {
            "static_404_crawler"
        };
        (MaterialityDisposition::NoiseSafeDrop, Some(reason.to_string()))
    };

    let rationale = match disposition {
        MaterialityDisposition::MaterialThreat => {
            if hard_triggers.is_empty() {
                format!(
                    "Material external threat on {} (score {}/100: stack={}, boundary={}, impact={}, vol={}, xlayer={}) — escalated for Defense Plan synthesis.",
                    surface.as_str(),
                    final_score,
                    stack_match_pts,
                    boundary_penetration_pts,
                    auth_write_impact_pts,
                    volumetric_persistence_pts,
                    cross_layer_pts
                )
            } else {
                format!(
                    "Material external threat on {} via hard trigger(s) [{}] (score {}/100) — escalated for Defense Plan synthesis.",
                    surface.as_str(),
                    hard_triggers.join(", "),
                    final_score
                )
            }
        }
        MaterialityDisposition::WatchLowMateriality => format!(
            "Low-materiality external signal on {} (score {}/100) — tracked silently in rolling window with zero WAF mutations.",
            surface.as_str(),
            final_score
        ),
        MaterialityDisposition::NoiseSafeDrop => format!(
            "Low-risk background noise on {} (score {}/100) — safely dropped at Stage 0 ($0 LLM).",
            surface.as_str(),
            final_score
        ),
    };

    MaterialityScoreResult {
        surface: surface.as_str().to_string(),
        stack_match_pts,
        boundary_penetration_pts,
        auth_write_impact_pts,
        volumetric_persistence_pts,
        cross_layer_pts,
        total_score: final_score,
        disposition,
        drop_reason,
        short_circuited: false,
        hard_triggers,
        rationale,
    }
}

// ============================================================================
// 3. Inside-Perimeter 4-Point Detection-Defect & False-Positive Classifier
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InsidePerimeterVerdict {
    ConfirmedBenignFalsePositive,
    DetectionDefectSuspected,
    ConfirmedInternalAnomaly,
}

impl InsidePerimeterVerdict {
    pub fn as_str(&self) -> &'static str {
        match self {
            InsidePerimeterVerdict::ConfirmedBenignFalsePositive => {
                "CONFIRMED_BENIGN_FALSE_POSITIVE"
            }
            InsidePerimeterVerdict::DetectionDefectSuspected => "DETECTION_DEFECT_SUSPECTED",
            InsidePerimeterVerdict::ConfirmedInternalAnomaly => "CONFIRMED_INTERNAL_ANOMALY",
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsidePerimeterSignal {
    pub rule_id: String,
    pub actor_ip: String,
    pub host: String,
    pub is_us_residential_or_lan: bool,
    pub access_gate_verified_intact: bool,
    pub access_policy_sync_stale_or_failed: bool,
    pub matched_allowlisted_family_email: bool,
    pub rotated_mobile_ipv6_prefix_64: bool,
    pub cross_host_public_404_bleed: bool,
    pub static_asset_only_200s: bool,
    pub matches_known_suite_automation: bool, // deploy, smoke-tester, */15 cron, Suricata admin SSH
    pub rejected_access_email: bool,
    pub overly_broad_access_policy: bool,
    pub panorama_auth_anomalies: bool,
    pub rogue_lan_mac_scanning: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsidePerimeterEvaluation {
    pub verdict: InsidePerimeterVerdict,
    pub suppress_defense_blocking: bool,
    pub gate_and_attribution_audit: String,
    pub infrastructure_correlation: String,
    pub defect_hypothesis: String,
    pub suspected_code_locations: Vec<String>,
    pub recommended_handoff_summary: Option<String>,
}

pub fn evaluate_inside_perimeter_signal(sig: &InsidePerimeterSignal) -> InsidePerimeterEvaluation {
    // Hard internal anomaly checks first (fail-closed on real compromise / policy breaches)
    if sig.rejected_access_email
        || sig.overly_broad_access_policy
        || sig.panorama_auth_anomalies
        || sig.rogue_lan_mac_scanning
    {
        let mut reasons = Vec::new();
        if sig.rejected_access_email {
            reasons.push("ZT_REJECTED_EMAIL_LOGIN observed");
        }
        if sig.overly_broad_access_policy {
            reasons.push("ZT_OVERLY_BROAD_POLICY detected on Cloudflare Access");
        }
        if sig.panorama_auth_anomalies {
            reasons.push("PanoramaAuth security anomalies / quarantined or locked accounts present");
        }
        if sig.rogue_lan_mac_scanning {
            reasons.push("Untrusted LAN MAC exhibiting active internal VLAN scanning");
        }
        return InsidePerimeterEvaluation {
            verdict: InsidePerimeterVerdict::ConfirmedInternalAnomaly,
            suppress_defense_blocking: false,
            gate_and_attribution_audit: format!("Fail-closed anomaly triggered: {}", reasons.join("; ")),
            infrastructure_correlation: "Did not match benign PanoramaSRE automation or verified family session.".to_string(),
            defect_hypothesis: "Hostile or policy-breaching evidence survived all 4 false-positive elimination checks.".to_string(),
            suspected_code_locations: vec![],
            recommended_handoff_summary: None,
        };
    }

    // Point 2: Known suite automation (Suricata admin SSH, deploy, smoke tests, */15 crons)
    if sig.matches_known_suite_automation {
        return InsidePerimeterEvaluation {
            verdict: InsidePerimeterVerdict::ConfirmedBenignFalsePositive,
            suppress_defense_blocking: true,
            gate_and_attribution_audit: "Zero Trust Access gate intact; zero PanoramaAuth anomalies.".to_string(),
            infrastructure_correlation: format!(
                "Aligned with known PanoramaSRE / Suite automation activity for {} ({})",
                sig.rule_id, sig.actor_ip
            ),
            defect_hypothesis: "Benign operational telemetry (e.g., admin SSH burst, smoke test, or 15m cron); no WAF block permitted.".to_string(),
            suspected_code_locations: vec![],
            recommended_handoff_summary: None,
        };
    }

    // Point 1 & 3: Detection-code defect indicators (stale Access sync, cross-host bleed, static-asset 200)
    if sig.access_policy_sync_stale_or_failed
        || sig.cross_host_public_404_bleed
        || sig.static_asset_only_200s
    {
        let mut defect_causes = Vec::new();
        let mut files = vec!["src-tauri/src/commands/threat_intel_ops.rs".to_string()];
        if sig.access_policy_sync_stale_or_failed {
            defect_causes.push("Cloudflare Access policy sync or allowlist state was stale/empty during triage");
        }
        if sig.cross_host_public_404_bleed {
            defect_causes.push("Cross-host rollup bled PublicWeb 404/paths into a StrictPrivate alert");
        }
        if sig.static_asset_only_200s {
            defect_causes.push("Static branding/UI assets returned HTTP 200 and were miscounted as protected origin leaks");
        }
        if sig.rule_id.contains("UNCORRELATED") {
            files.push("PanoramaAuth/src/lib/session-roam.ts".to_string());
        }
        let summary = format!(
            "Suspected detection code defect on rule '{}' (IP {}, host {}): {}. Hard-suppressed all defensive blocking.",
            sig.rule_id,
            sig.actor_ip,
            sig.host,
            defect_causes.join("; ")
        );
        return InsidePerimeterEvaluation {
            verdict: InsidePerimeterVerdict::DetectionDefectSuspected,
            suppress_defense_blocking: true,
            gate_and_attribution_audit: format!(
                "Access gate intact={} | allowlisted_email={} | sync_stale={}",
                sig.access_gate_verified_intact,
                sig.matched_allowlisted_family_email,
                sig.access_policy_sync_stale_or_failed
            ),
            infrastructure_correlation: "No hostile lateral movement or PanoramaAuth tampering corroborated.".to_string(),
            defect_hypothesis: summary.clone(),
            suspected_code_locations: files,
            recommended_handoff_summary: Some(summary),
        };
    }

    // Point 1: Roaming mobile IPv6 /64 or allowlisted family US session with intact gate
    if (sig.matched_allowlisted_family_email || sig.rotated_mobile_ipv6_prefix_64)
        && sig.access_gate_verified_intact
    {
        return InsidePerimeterEvaluation {
            verdict: InsidePerimeterVerdict::ConfirmedBenignFalsePositive,
            suppress_defense_blocking: true,
            gate_and_attribution_audit: format!(
                "Verified allowlisted family attribution (ipv6_prefix_64_roam={}) with intact Zero Trust Access gate and 0 PanoramaAuth anomalies.",
                sig.rotated_mobile_ipv6_prefix_64
            ),
            infrastructure_correlation: "Normal authenticated family roaming session.".to_string(),
            defect_hypothesis: "Confirmed benign false positive — defensive blocking permanently suppressed.".to_string(),
            suspected_code_locations: vec![],
            recommended_handoff_summary: None,
        };
    }

    // US residential with intact gate & zero auth anomalies -> suspect correlation gap before blocking
    if sig.is_us_residential_or_lan && sig.access_gate_verified_intact {
        let summary = format!(
            "Uncorrelated inside-perimeter US/LAN alert '{}' for {} on {} despite intact Cloudflare Access gate and 0 PanoramaAuth anomalies — likely session-touch/IPv6 correlation lag.",
            sig.rule_id, sig.actor_ip, sig.host
        );
        return InsidePerimeterEvaluation {
            verdict: InsidePerimeterVerdict::DetectionDefectSuspected,
            suppress_defense_blocking: true,
            gate_and_attribution_audit: "4-layer gate intact; missing timely SessionAuthIndex join.".to_string(),
            infrastructure_correlation: "No external attack indicators or PanoramaAuth anomalies.".to_string(),
            defect_hypothesis: summary.clone(),
            suspected_code_locations: vec![
                "src-tauri/src/commands/threat_intel_ops.rs".to_string(),
                "PanoramaAuth/src/lib/session-roam.ts".to_string(),
            ],
            recommended_handoff_summary: Some(summary),
        };
    }

    InsidePerimeterEvaluation {
        verdict: InsidePerimeterVerdict::ConfirmedInternalAnomaly,
        suppress_defense_blocking: false,
        gate_and_attribution_audit: "Inside-perimeter gate integrity could not be confirmed; fail-closed escalation.".to_string(),
        infrastructure_correlation: "No benign automation or family attribution match.".to_string(),
        defect_hypothesis: "Requires human operator L3 review.".to_string(),
        suspected_code_locations: vec![],
        recommended_handoff_summary: None,
    }
}

// ============================================================================
// 4. OWASP ASI01 Indirect Prompt-Injection Sanitizer & Independent Verifier
// ============================================================================

/// Sanitizes untrusted external telemetry strings (HTTP paths, queries, User-Agents, log lines)
/// against OWASP ASI01 indirect prompt-injection & delimiter breakout before reaching Gemini.
pub fn sanitize_untrusted_telemetry_text(raw: &str, max_len: usize) -> String {
    let scrubbed = scrub_secrets(raw);
    let mut cleaned = String::with_capacity(scrubbed.len().min(max_len));
    for ch in scrubbed.chars() {
        // Strip zero-width, bidi override, BOM, and ASCII control characters
        let is_bidi_or_zw = matches!(
            ch,
            '\u{200B}'..='\u{200F}'
                | '\u{202A}'..='\u{202E}'
                | '\u{2060}'..='\u{206F}'
                | '\u{FEFF}'
        );
        if is_bidi_or_zw || (ch.is_control() && ch != ' ') {
            if ch == '\n' || ch == '\r' || ch == '\t' {
                cleaned.push(' ');
            }
            continue;
        }
        // Neutralize XML/HTML tag delimiters & markdown fence backticks
        match ch {
            '<' => cleaned.push('['),
            '>' => cleaned.push(']'),
            '`' => cleaned.push('\''),
            _ if ch.is_ascii() => cleaned.push(ch),
            _ => cleaned.push('?'),
        }
        if cleaned.len() >= max_len {
            break;
        }
    }
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn sanitize_json_value(val: &Value, max_str_len: usize) -> Value {
    match val {
        Value::String(s) => Value::String(sanitize_untrusted_telemetry_text(s, max_str_len)),
        Value::Array(arr) => Value::Array(
            arr.iter()
                .take(40)
                .map(|v| sanitize_json_value(v, max_str_len))
                .collect(),
        ),
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map {
                let safe_k = sanitize_untrusted_telemetry_text(k, 64);
                out.insert(safe_k, sanitize_json_value(v, max_str_len));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

/// Dual-channel framing: strictly isolates sanitized untrusted telemetry inside
/// `<untrusted_telemetry_data>` delimiters so adversarial HTTP paths/UAs cannot escape framing.
pub fn frame_untrusted_telemetry_block(payload: &Value) -> String {
    let sanitized = sanitize_json_value(payload, 220);
    let rendered = serde_json::to_string_pretty(&sanitized).unwrap_or_else(|_| "{}".to_string());
    format!(
        "<untrusted_telemetry_data>\n{}\n</untrusted_telemetry_data>",
        rendered
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefensePlanDto {
    pub summary: String,
    pub recommended_action: String, // managed_challenge | block | observe_only
    pub target_zone: String,
    pub target_host: Option<String>,
    #[serde(default)]
    pub target_ips: Vec<String>,
    #[serde(default)]
    pub target_asns: Vec<String>,
    #[serde(default)]
    pub target_paths: Vec<String>,
    pub ttl_minutes: Option<i64>,
    #[serde(default)]
    pub allowlist_mutation_requested: bool,
    #[serde(default)]
    pub rationale: String,
    #[serde(default)]
    pub evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedDefensePlan {
    pub action_id: String,      // apply_cf_temp_challenge | apply_cf_permanent_waf
    pub cf_action: String,      // managed_challenge | block
    pub target_zone: String,
    pub verified_ips: Vec<String>,
    pub verified_asns: Vec<String>,
    pub compiled_expression: String,
    pub ttl_minutes: Option<i64>,
    pub policy_decision: PolicyDecision,
    pub home_wan_and_family_protected: bool,
    pub summary: String,
    pub rationale: String,
    pub evidence_refs: Vec<String>,
}

/// Validates a Cloudflare hostname scope string strictly before compiling into Wirefilter.
fn is_safe_hostname_token(host: &str) -> bool {
    let h = host.trim();
    !h.is_empty()
        && h.len() <= 128
        && h.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'))
}

/// Strictly compiles a Cloudflare Wirefilter expression in Rust from verified IPs, ASNs,
/// and optional host scope. Zero raw LLM-authored expressions are ever accepted.
pub fn build_compiled_waf_expression(
    ips: &[String],
    asns: &[String],
    host_scope: Option<&str>,
) -> Result<String, String> {
    let mut valid_ips = Vec::new();
    for raw in ips {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Accept valid IPv4/IPv6 literal or CIDR (<ip>/<prefix>)
        if let Some((ip_part, prefix_part)) = trimmed.split_once('/') {
            let Ok(addr) = ip_part.parse::<IpAddr>() else {
                return Err(format!("Invalid CIDR IP literal '{}'", trimmed));
            };
            let Ok(prefix) = prefix_part.parse::<u8>() else {
                return Err(format!("Invalid CIDR prefix '{}'", trimmed));
            };
            let max_p = if addr.is_ipv4() { 32 } else { 128 };
            if prefix == 0 || prefix > max_p {
                return Err(format!("Out-of-range CIDR prefix '{}'", trimmed));
            }
            valid_ips.push(trimmed.to_string());
        } else {
            let Ok(_) = trimmed.parse::<IpAddr>() else {
                return Err(format!("Invalid IP literal '{}'", trimmed));
            };
            valid_ips.push(trimmed.to_string());
        }
    }

    let mut valid_asns = Vec::new();
    for raw in asns {
        let digits: String = raw
            .trim()
            .trim_start_matches("AS")
            .trim_start_matches("as")
            .chars()
            .filter(|c| c.is_ascii_digit())
            .collect();
        if !digits.is_empty() && digits.len() <= 10 {
            valid_asns.push(digits);
        }
    }

    let base_expr = build_waf_rule_expression(&valid_ips, &valid_asns);
    if base_expr.is_empty() {
        return Err("WAF expression requires at least one valid IP or ASN target".to_string());
    }

    if let Some(host) = host_scope.map(str::trim).filter(|h| !h.is_empty()) {
        if !is_safe_hostname_token(host) {
            return Err(format!("Invalid hostname scope '{}'", host));
        }
        Ok(format!(
            "(http.host eq \"{}\" and {})",
            host.to_ascii_lowercase(),
            base_expr
        ))
    } else {
        Ok(base_expr)
    }
}

/// Independent Rust Parameter & Safety Verifier (OWASP ASI01 + Policy Kernel L4-06).
/// Cross-checks every Gemini-proposed DefensePlanDto against deterministic Stage-0 evidence,
/// Protected Allowlists, and the compiled Rust Policy Kernel.
#[allow(clippy::too_many_arguments)]
pub fn verify_defense_plan_against_stage0(
    plan: &DefensePlanDto,
    stage0_material_ips: &[String],
    stage0_material_asns: &[String],
    protected_ips: &[String],
    protected_asns: &[String],
    classification: &str,
    configured_mode: AutonomyMode,
    kill_switch_active: bool,
    circuit_breaker_tripped: bool,
) -> Result<VerifiedDefensePlan, String> {
    // 1. ASI01 hard block: LLM can NEVER mutate allowlists or bypass Zero Trust
    if plan.allowlist_mutation_requested {
        return Err(
            "OWASP ASI01 / L4-06 BLOCKED: Defense plans can never request allowlist mutations."
                .to_string(),
        );
    }

    let norm_action = plan.recommended_action.trim().to_ascii_lowercase();
    if norm_action == "observe_only" || norm_action == "none" {
        return Err("Plan recommends observe_only — no Cloudflare WAF mutation staged.".to_string());
    }
    if norm_action != "managed_challenge" && norm_action != "block" {
        return Err(format!(
            "Unsupported WAF action '{}' (only 'managed_challenge' or 'block' compiled).",
            plan.recommended_action
        ));
    }

    // 2. Reject any LLM-injected IP or ASN that is NOT in deterministic Stage-0 MATERIAL_THREAT evidence
    let allowed_ips_set: BTreeSet<String> = stage0_material_ips
        .iter()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    let allowed_asns_set: BTreeSet<String> = stage0_material_asns
        .iter()
        .map(|s| {
            s.trim()
                .trim_start_matches("AS")
                .trim_start_matches("as")
                .to_string()
        })
        .filter(|s| !s.is_empty())
        .collect();

    let mut verified_ips = Vec::new();
    for raw_ip in &plan.target_ips {
        let clean = raw_ip.trim();
        if clean.is_empty() {
            continue;
        }
        // Explicitly check L4-06 Protected Allowlist FIRST so hijacked home-WAN blocks return clear L4-06 denial
        if is_protected_ip(clean, protected_ips) {
            return Err(format!(
                "L4-06 BLOCKED: Target IP '{}' is protected (Home WAN / Family Allowlist / LAN / Loopback / Cloudflare).",
                clean
            ));
        }
        if !allowed_ips_set.contains(&clean.to_ascii_lowercase()) {
            return Err(format!(
                "OWASP ASI01 BLOCKED: Proposed target IP '{}' was NOT present in deterministic Stage-0 MATERIAL_THREAT evidence.",
                clean
            ));
        }
        verified_ips.push(clean.to_string());
    }

    let mut verified_asns = Vec::new();
    for raw_asn in &plan.target_asns {
        let clean = raw_asn
            .trim()
            .trim_start_matches("AS")
            .trim_start_matches("as")
            .to_string();
        if clean.is_empty() {
            continue;
        }
        if is_protected_asn(&clean, protected_asns) {
            return Err(format!(
                "L4-06 BLOCKED: Target ASN 'AS{}' belongs to Protected Allowlist or Cloudflare infrastructure.",
                clean
            ));
        }
        if !allowed_asns_set.contains(&clean) {
            return Err(format!(
                "OWASP ASI01 BLOCKED: Proposed target ASN 'AS{}' was NOT present in deterministic Stage-0 MATERIAL_THREAT evidence.",
                clean
            ));
        }
        verified_asns.push(clean);
    }

    if verified_ips.is_empty() && verified_asns.is_empty() {
        return Err("Defense plan contains zero Stage-0 verified target IPs or ASNs.".to_string());
    }

    // 3. Map to compiled Policy Kernel action_id
    let (action_id, ttl_minutes) = if norm_action == "managed_challenge" {
        let ttl = plan
            .ttl_minutes
            .unwrap_or(DEFAULT_TEMP_CHALLENGE_TTL_MINS)
            .clamp(15, 240);
        ("apply_cf_temp_challenge".to_string(), Some(ttl))
    } else {
        ("apply_cf_permanent_waf".to_string(), None)
    };

    // 4. Compile Wirefilter expression deterministically in Rust
    let compiled_expression = build_compiled_waf_expression(
        &verified_ips,
        &verified_asns,
        plan.target_host.as_deref(),
    )?;

    // 5. Independent Policy Kernel evaluation (enforces L4-01..06, kill-switch, breaker, classification)
    let raw_check_payload = format!(
        "{} {} {} {}",
        action_id, plan.target_zone, compiled_expression, plan.summary
    );
    let decision = evaluate_policy_decision(&PolicyEvalRequest {
        action_id: action_id.clone(),
        asset_slug: plan.target_zone.clone(),
        asset_tier: AssetTier::Tier2ExternalEdge,
        configured_mode,
        kill_switch_active,
        circuit_breaker_tripped,
        has_db_migration: false,
        classification: Some(classification.to_string()),
        raw_payload_text: raw_check_payload,
        target_ips: verified_ips.clone(),
        target_asns: verified_asns.clone(),
        target_paths: plan.target_paths.clone(),
        protected_ips: protected_ips.to_vec(),
        protected_asns: protected_asns.to_vec(),
        proposed_semver_bump: None,
    });

    if matches!(
        decision.verdict,
        PolicyVerdict::DenyL4HardBlocked
            | PolicyVerdict::DenyKillSwitch
            | PolicyVerdict::DenyCircuitBreaker
    ) {
        return Err(format!(
            "Policy Kernel denied defense plan ({:?}): {}",
            decision.verdict, decision.reason
        ));
    }

    Ok(VerifiedDefensePlan {
        action_id,
        cf_action: norm_action,
        target_zone: plan.target_zone.trim().to_ascii_lowercase(),
        verified_ips,
        verified_asns,
        compiled_expression,
        ttl_minutes,
        policy_decision: decision,
        home_wan_and_family_protected: true,
        summary: sanitize_untrusted_telemetry_text(&plan.summary, 240),
        rationale: sanitize_untrusted_telemetry_text(&plan.rationale, 500),
        evidence_refs: plan
            .evidence_refs
            .iter()
            .take(12)
            .map(|r| sanitize_untrusted_telemetry_text(r, 120))
            .collect(),
    })
}

// ============================================================================
// 5. Cloudflare WAF Rulesets API Executor, Snapshot Capture & TTL Reconciler
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedWafRuleReceipt {
    pub cf_ruleset_id: String,
    pub cf_rule_id: String,
    pub rule_description: String,
    pub prior_ruleset_snapshot_json: String,
    pub rules_count_before: usize,
    pub rules_count_after: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WafLeaseReconcileReport {
    pub checked_expired: usize,
    pub reverted_count: usize,
    pub failed_count: usize,
    pub details: Vec<String>,
}

/// Embeds deterministic Otto lease tracking & TTL expiry metadata into a Cloudflare rule description.
pub fn embed_waf_lease_tag(
    base_description: &str,
    lease_id: &str,
    expires_at: Option<&str>,
) -> String {
    let clean_base = sanitize_untrusted_telemetry_text(base_description, 120);
    let prefix = if clean_base.is_empty() {
        "Otto Defense Rule".to_string()
    } else {
        clean_base
    };
    match expires_at {
        Some(iso) if !iso.trim().is_empty() => format!(
            "{} [otto-lease:{}] [panorama-sre-ttl:{}]",
            prefix,
            lease_id.trim(),
            iso.trim()
        ),
        _ => format!("{} [otto-lease:{}]", prefix, lease_id.trim()),
    }
}

/// Extracts the `panorama-sre-ttl:<iso>` timestamp from a Cloudflare rule description, if present.
pub fn extract_waf_ttl_tag(description: &str) -> Option<String> {
    let marker = "[panorama-sre-ttl:";
    let start = description.find(marker)? + marker.len();
    let rest = &description[start..];
    let end = rest.find(']')?;
    let val = rest[..end].trim();
    if val.is_empty() {
        None
    } else {
        Some(val.to_string())
    }
}

async fn cf_waf_get_entrypoint(
    client: &reqwest::Client,
    api_base: &str,
    token: &str,
    zone_id: &str,
) -> Result<Option<(String, Vec<Value>, Value)>, String> {
    let url = format!(
        "{}/zones/{}/rulesets/phases/http_request_firewall_custom/entrypoint",
        api_base.trim_end_matches('/'),
        zone_id.trim()
    );
    let resp = client
        .get(&url)
        .bearer_auth(token.trim())
        .send()
        .await
        .map_err(|e| format!("Cloudflare WAF GET entrypoint transport error: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if status.as_u16() == 404 {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(format!(
            "Cloudflare WAF GET entrypoint returned HTTP {}: {}",
            status.as_u16(),
            scrub_secrets(&text.chars().take(240).collect::<String>())
        ));
    }
    let val: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Invalid Cloudflare WAF entrypoint JSON: {}", e))?;
    let ruleset_id = val
        .pointer("/result/id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let rules = val
        .pointer("/result/rules")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(Some((ruleset_id, rules, val)))
}

/// Captures the prior Cloudflare custom WAF ruleset snapshot, appends a single compiled
/// rule tagged with `[otto-lease:<id>]` (and `[panorama-sre-ttl:<iso>]` for temporary rules),
/// and PUTs the updated entrypoint ruleset back to Cloudflare.
#[allow(clippy::too_many_arguments)]
pub async fn apply_cloudflare_waf_lease_via_api(
    client: &reqwest::Client,
    api_base: &str,
    token: &str,
    zone_id: &str,
    lease_id: &str,
    cf_action: &str,
    compiled_expression: &str,
    base_description: &str,
    expires_at: Option<&str>,
    max_zone_rules: usize,
) -> Result<AppliedWafRuleReceipt, String> {
    if cf_action != "managed_challenge" && cf_action != "block" {
        return Err(format!("Unsupported Cloudflare WAF action '{}'", cf_action));
    }

    // 1. Capture prior ruleset snapshot BEFORE mutating anything
    let existing_opt = cf_waf_get_entrypoint(client, api_base, token, zone_id).await?;
    let (prior_ruleset_id, mut rules, prior_snapshot_json) = match existing_opt {
        Some((rs_id, existing_rules, raw_val)) => {
            let snap = json!({
                "rulesetId": rs_id,
                "capturedAt": Utc::now().to_rfc3339(),
                "rules": existing_rules,
                "rawResultVersion": raw_val.pointer("/result/version")
            })
            .to_string();
            (rs_id, existing_rules, snap)
        }
        None => {
            let snap = json!({
                "rulesetId": null,
                "capturedAt": Utc::now().to_rfc3339(),
                "rules": []
            })
            .to_string();
            (String::new(), Vec::new(), snap)
        }
    };

    let rules_count_before = rules.len();
    if max_zone_rules > 0 && rules_count_before >= max_zone_rules {
        return Err(format!(
            "Cloudflare zone custom WAF rule budget exhausted ({}/{} rules used). Free up a slot or consolidate rules before applying.",
            rules_count_before, max_zone_rules
        ));
    }

    // 2. Append the compiled rule with deterministic Otto lease & TTL tags
    let tagged_desc = embed_waf_lease_tag(base_description, lease_id, expires_at);
    let new_rule = json!({
        "action": cf_action,
        "expression": compiled_expression,
        "description": tagged_desc,
        "enabled": true
    });
    rules.push(new_rule);

    // 3. PUT updated entrypoint ruleset
    let put_url = format!(
        "{}/zones/{}/rulesets/phases/http_request_firewall_custom/entrypoint",
        api_base.trim_end_matches('/'),
        zone_id.trim()
    );
    let body = json!({
        "name": "PanoramaSRE Otto Custom WAF Ruleset",
        "description": "Managed custom firewall ruleset with Otto TTL lease snapshots",
        "rules": rules
    });

    let resp = client
        .put(&put_url)
        .bearer_auth(token.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Cloudflare WAF PUT entrypoint transport error: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let hint = if status.as_u16() == 403 || status.as_u16() == 401 {
            " (Ensure CLOUDFLARE_API_TOKEN has 'Zone -> Zone WAF -> Edit' permission to apply live rules.)"
        } else {
            ""
        };
        return Err(format!(
            "Cloudflare WAF PUT entrypoint returned HTTP {}{}: {}",
            status.as_u16(),
            hint,
            scrub_secrets(&text.chars().take(260).collect::<String>())
        ));
    }

    let parsed: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Invalid Cloudflare WAF PUT response JSON: {}", e))?;
    let returned_ruleset_id = parsed
        .pointer("/result/id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or(prior_ruleset_id);

    let returned_rules = parsed
        .pointer("/result/rules")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let lease_marker = format!("[otto-lease:{}]", lease_id);
    let created_rule_id = returned_rules
        .iter()
        .rev()
        .find(|r| {
            r.get("description")
                .and_then(|v| v.as_str())
                .map(|d| d.contains(&lease_marker))
                .unwrap_or(false)
        })
        .and_then(|r| r.get("id").and_then(|v| v.as_str()))
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("rule-{}", lease_id));

    Ok(AppliedWafRuleReceipt {
        cf_ruleset_id: returned_ruleset_id,
        cf_rule_id: created_rule_id,
        rule_description: tagged_desc,
        prior_ruleset_snapshot_json: prior_snapshot_json,
        rules_count_before,
        rules_count_after: returned_rules.len().max(rules_count_before + 1),
    })
}

/// 1-Click Revert & TTL Expiry Cleanup:
/// Fetches the live Cloudflare custom WAF ruleset, removes ONLY the targeted lease rule
/// (matched by `cf_rule_id` or `[otto-lease:<id>]`), and PUTs the cleaned rules back so
/// unrelated user/suite rules are preserved intact.
pub async fn revert_cloudflare_waf_lease_via_api(
    client: &reqwest::Client,
    api_base: &str,
    token: &str,
    lease: &OttoWafLeaseRow,
) -> Result<String, String> {
    let existing_opt = cf_waf_get_entrypoint(client, api_base, token, &lease.cf_zone_id).await?;
    let Some((_rs_id, current_rules, _raw)) = existing_opt else {
        return Ok("Cloudflare zone entrypoint ruleset already absent (rule not present).".to_string());
    };

    let lease_marker = format!("[otto-lease:{}]", lease.id);
    let before_len = current_rules.len();
    let remaining: Vec<Value> = current_rules
        .into_iter()
        .filter(|r| {
            let id_match = r
                .get("id")
                .and_then(|v| v.as_str())
                .map(|id| !lease.cf_rule_id.is_empty() && id == lease.cf_rule_id)
                .unwrap_or(false);
            let marker_match = r
                .get("description")
                .and_then(|v| v.as_str())
                .map(|d| d.contains(&lease_marker))
                .unwrap_or(false);
            !(id_match || marker_match)
        })
        .collect();

    if remaining.len() == before_len {
        return Ok(format!(
            "Rule '{}' was already absent from Cloudflare zone '{}' ({} rules unchanged).",
            lease.cf_rule_id, lease.cf_zone_name, before_len
        ));
    }

    let put_url = format!(
        "{}/zones/{}/rulesets/phases/http_request_firewall_custom/entrypoint",
        api_base.trim_end_matches('/'),
        lease.cf_zone_id.trim()
    );
    let body = json!({
        "name": "PanoramaSRE Otto Custom WAF Ruleset",
        "description": "Reverted Otto WAF lease cleanly",
        "rules": remaining
    });
    let resp = client
        .put(&put_url)
        .bearer_auth(token.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Cloudflare WAF revert PUT transport error: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Cloudflare WAF revert PUT returned HTTP {}: {}",
            status.as_u16(),
            scrub_secrets(&text.chars().take(240).collect::<String>())
        ));
    }

    Ok(format!(
        "Removed Otto WAF lease '{}' from zone '{}' ({} -> {} custom rules).",
        lease.id,
        lease.cf_zone_name,
        before_len,
        remaining.len()
    ))
}

/// TTL Reconciler: finds all `ACTIVE` Cloudflare WAF leases whose `expires_at <= now`,
/// removes each rule cleanly from Cloudflare, updates SQLite to `EXPIRED_REVERTED`, and
/// appends an audit log entry.
pub async fn reconcile_expired_waf_leases_with_base(
    db: &Arc<Mutex<SreDatabase>>,
    client: &reqwest::Client,
    api_base: &str,
    token: &str,
    now_utc: DateTime<Utc>,
) -> Result<WafLeaseReconcileReport, String> {
    let now_iso = now_utc.to_rfc3339();
    let expired = {
        let guard = db.lock().map_err(|_| "DB lock poisoned".to_string())?;
        guard
            .list_expired_active_waf_leases(&now_iso)
            .map_err(|e| format!("Failed querying expired WAF leases: {}", e))?
    };

    let mut report = WafLeaseReconcileReport {
        checked_expired: expired.len(),
        ..Default::default()
    };

    for lease in expired {
        match revert_cloudflare_waf_lease_via_api(client, api_base, token, &lease).await {
            Ok(msg) => {
                report.reverted_count += 1;
                report.details.push(msg.clone());
                if let Ok(guard) = db.lock() {
                    let _ = guard.mark_otto_waf_lease_reverted(
                        &lease.id,
                        "EXPIRED_REVERTED",
                        &now_iso,
                        None,
                    );
                    let _ = guard.append_otto_audit(
                        "WAF_TTL_RECONCILE",
                        Some("apply_cf_temp_challenge"),
                        Some(&lease.cf_zone_name),
                        "EXPIRED_REVERTED",
                        &msg,
                        lease.trace_run_id.as_deref(),
                    );
                }
            }
            Err(err) => {
                report.failed_count += 1;
                report.details.push(format!("Lease {} revert failed: {}", lease.id, err));
                if let Ok(guard) = db.lock() {
                    let _ = guard.append_otto_audit(
                        "WAF_TTL_RECONCILE",
                        Some("apply_cf_temp_challenge"),
                        Some(&lease.cf_zone_name),
                        "FAILED",
                        &err,
                        lease.trace_run_id.as_deref(),
                    );
                }
            }
        }
    }

    Ok(report)
}
