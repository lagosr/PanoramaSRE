use serde::{Deserialize, Serialize};
use std::net::IpAddr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AssetTier {
    Tier0Critical,
    Tier1ChildApp,
    Tier2ExternalEdge,
}

impl AssetTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            AssetTier::Tier0Critical => "TIER0_CRITICAL",
            AssetTier::Tier1ChildApp => "TIER1_CHILD_APP",
            AssetTier::Tier2ExternalEdge => "TIER2_EXTERNAL_EDGE",
        }
    }

    pub fn from_slug(slug: &str, hosting_target: Option<&str>) -> Self {
        let s = slug.trim().to_ascii_lowercase();
        let target = hosting_target.unwrap_or("").trim().to_ascii_lowercase();
        if target == "cloudflare-pages"
            || matches!(s.as_str(), "parakith" | "ui" | "protect" | "ha" | "genmon")
        {
            return AssetTier::Tier2ExternalEdge;
        }
        if matches!(
            s.as_str(),
            "auth" | "panorama-auth" | "wsh" | "dietpi" | "lighttpd" | "cloudflared" | "unifi-siem"
        ) || target == "wsh-docker-service"
        {
            return AssetTier::Tier0Critical;
        }
        AssetTier::Tier1ChildApp
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AutonomyMode {
    Observe = 0,
    Shadow = 1,
    L3Approval = 2,
    L2Auto = 3,
    L4HardBlocked = 4,
}

impl AutonomyMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            AutonomyMode::Observe => "OBSERVE",
            AutonomyMode::Shadow => "SHADOW",
            AutonomyMode::L3Approval => "L3_APPROVAL",
            AutonomyMode::L2Auto => "L2_AUTO",
            AutonomyMode::L4HardBlocked => "L4_HARD_BLOCKED",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_uppercase().as_str() {
            "OBSERVE" | "L0" => Some(AutonomyMode::Observe),
            "SHADOW" | "L1" => Some(AutonomyMode::Shadow),
            "L3_APPROVAL" | "L3" => Some(AutonomyMode::L3Approval),
            "L2_AUTO" | "L2" => Some(AutonomyMode::L2Auto),
            "L4_HARD_BLOCKED" | "L4" => Some(AutonomyMode::L4HardBlocked),
            _ => None,
        }
    }

    pub fn rank_permissive(&self) -> u8 {
        match self {
            AutonomyMode::Observe => 0,
            AutonomyMode::Shadow => 1,
            AutonomyMode::L3Approval => 2,
            AutonomyMode::L2Auto => 3,
            AutonomyMode::L4HardBlocked => 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionCatalogSpec {
    pub action_id: &'static str,
    pub domain: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub asset_tier: AssetTier,
    pub default_mode: AutonomyMode,
    pub max_allowed_mode: AutonomyMode,
    pub cooldown_secs: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct L4HardBlockInvariant {
    pub id: &'static str,
    pub category: &'static str,
    pub title: &'static str,
    pub detail: &'static str,
}

pub fn compiled_action_catalog() -> Vec<ActionCatalogSpec> {
    vec![
        ActionCatalogSpec {
            action_id: "restart_container",
            domain: "HEAL",
            label: "Single-Container Restart",
            description: "Restart one crashed or wedged WSH Docker container via sre-agent-wsh gatekeeper (rate-limited 1x/15m).",
            asset_tier: AssetTier::Tier1ChildApp,
            default_mode: AutonomyMode::Shadow,
            max_allowed_mode: AutonomyMode::L2Auto,
            cooldown_secs: 900,
        },
        ActionCatalogSpec {
            action_id: "restart_tier0_hard_down",
            domain: "HEAL",
            label: "Tier-0 Hard-Down Restart",
            description: "Restart PanoramaAuth or unifi-siem ONLY if Docker reports exited/dead/unhealthy across 2 consecutive probes.",
            asset_tier: AssetTier::Tier0Critical,
            default_mode: AutonomyMode::Shadow,
            max_allowed_mode: AutonomyMode::L2Auto,
            cooldown_secs: 900,
        },
        ActionCatalogSpec {
            action_id: "rollback_n3_db_safe",
            domain: "HEAL",
            label: "DB-Safe N-3 Rollback",
            description: "Instant N-3 rollback (-RollbackToTag) for Tier-1 apps ONLY when DB_MIGRATION == false (1x/60m).",
            asset_tier: AssetTier::Tier1ChildApp,
            default_mode: AutonomyMode::Shadow,
            max_allowed_mode: AutonomyMode::L2Auto,
            cooldown_secs: 3600,
        },
        ActionCatalogSpec {
            action_id: "renew_ssl_cert",
            domain: "HEAL",
            label: "Unattended SSL Renewal",
            description: "Renew expiring certificates (<21d) via Get-SSLCerts.ps1 -Unattended under WshRemoteMutation mutex.",
            asset_tier: AssetTier::Tier2ExternalEdge,
            default_mode: AutonomyMode::Shadow,
            max_allowed_mode: AutonomyMode::L2Auto,
            cooldown_secs: 3600,
        },
        ActionCatalogSpec {
            action_id: "prune_buildkit_cache",
            domain: "HEAL",
            label: "Calibrated BuildKit Cache Prune",
            description: "Prune local Docker BuildKit cache (--all --filter until=72h) ONLY when >= 35 GB reclaimable or >= 100 GB total.",
            asset_tier: AssetTier::Tier1ChildApp,
            default_mode: AutonomyMode::Shadow,
            max_allowed_mode: AutonomyMode::L2Auto,
            cooldown_secs: 21600,
        },
        ActionCatalogSpec {
            action_id: "apply_cf_temp_challenge",
            domain: "DEFENSE",
            label: "Temporary 60m Cloudflare Managed Challenge",
            description: "Apply auto-expiring 60m TTL Cloudflare Managed Challenge (never hard block) on confirmed MATERIAL_THREAT volumetric bursts.",
            asset_tier: AssetTier::Tier2ExternalEdge,
            default_mode: AutonomyMode::Shadow,
            max_allowed_mode: AutonomyMode::L2Auto,
            cooldown_secs: 1800,
        },
        ActionCatalogSpec {
            action_id: "apply_cf_permanent_waf",
            domain: "DEFENSE",
            label: "Permanent Cloudflare WAF Block / Rate-Limit",
            description: "Apply permanent Cloudflare WAF rule after Protected Allowlist & SessionAuthIndex validation (always Desktop L3 Approval).",
            asset_tier: AssetTier::Tier2ExternalEdge,
            default_mode: AutonomyMode::L3Approval,
            max_allowed_mode: AutonomyMode::L3Approval,
            cooldown_secs: 300,
        },
        ActionCatalogSpec {
            action_id: "stage_worktree_patch",
            domain: "UPGRADE",
            label: "Isolated Worktree Patch Verification",
            description: "Stage CVE/Patch update inside %LOCALAPPDATA% Git worktree with --ignore-scripts, tsc, vitest, and -VerifyLocal (zero prod impact).",
            asset_tier: AssetTier::Tier1ChildApp,
            default_mode: AutonomyMode::Shadow,
            max_allowed_mode: AutonomyMode::L2Auto,
            cooldown_secs: 1800,
        },
        ActionCatalogSpec {
            action_id: "deploy_verified_patch",
            domain: "UPGRADE",
            label: "Production App Rollout (deploy-docker.ps1)",
            description: "Deploy a verified patch or suite sync release to WSH (strictly Desktop L3 Human-Approved).",
            asset_tier: AssetTier::Tier1ChildApp,
            default_mode: AutonomyMode::L3Approval,
            max_allowed_mode: AutonomyMode::L3Approval,
            cooldown_secs: 600,
        },
        ActionCatalogSpec {
            action_id: "wsh_apt_dist_upgrade",
            domain: "UPGRADE",
            label: "WSH DietPi APT Upgrade / Reboot",
            description: "Apply OS security packages or graceful host reboot on wsh.panoramadr.com (strictly Desktop L3 Human-Approved).",
            asset_tier: AssetTier::Tier0Critical,
            default_mode: AutonomyMode::L3Approval,
            max_allowed_mode: AutonomyMode::L3Approval,
            cooldown_secs: 3600,
        },
        ActionCatalogSpec {
            action_id: "create_bug_handoff",
            domain: "BUG_DIAGNOSTIC",
            label: "Detection-Defect Antigravity Handoff",
            description: "Publish scrubbed Detection-Defect Bug Report & Deep-Thinking Trace to MCP sre_agent_handoffs (zero mutation).",
            asset_tier: AssetTier::Tier1ChildApp,
            default_mode: AutonomyMode::L2Auto,
            max_allowed_mode: AutonomyMode::L2Auto,
            cooldown_secs: 60,
        },
    ]
}

pub fn l4_hard_blocked_invariants() -> Vec<L4HardBlockInvariant> {
    vec![
        L4HardBlockInvariant {
            id: "L4-01",
            category: "Workstation",
            title: "Zero Arbitrary Shell Execution",
            detail: "LLM output can never synthesize or execute raw PowerShell, cmd.exe, bash, or SSH strings. Every action maps to a compiled Rust handler.",
        },
        L4HardBlockInvariant {
            id: "L4-02",
            category: "Workstation",
            title: "Filesystem & Credential Jail",
            detail: "Zero access to .ssh/, *.env.local.keys, *.env.deploy, D:/, E:/, Windows System paths, or uncommitted live AG Projects working trees.",
        },
        L4HardBlockInvariant {
            id: "L4-03",
            category: "Workstation",
            title: "Zero UAC & SemVer Major/Minor Lock",
            detail: "Never requests administrator UAC elevation, never runs destructive Git (reset --hard / push --force), and forbids Major or Minor SemVer bumps.",
        },
        L4HardBlockInvariant {
            id: "L4-04",
            category: "Production Data",
            title: "Zero Production SQLite & Volume Mutations",
            detail: "Permanently forbids INSERT/UPDATE/DELETE/ALTER/DROP, RestoreRemote, or removing /var/data/* SQLite volumes.",
        },
        L4HardBlockInvariant {
            id: "L4-05",
            category: "WSH Security",
            title: "Immutable Firewall & Container Containment (SEC-01..09)",
            detail: "Permanently forbids flushing/editing DOCKER-USER or PANORAMA-INPUT, binding 0.0.0.0, network_mode: host, RFC1918 bridges, or exposing :22/:9442.",
        },
        L4HardBlockInvariant {
            id: "L4-06",
            category: "Perimeter Defense",
            title: "Protected Allowlist & False-Positive Block Immunity",
            detail: "Never blocks home WAN IP, RFC1918 LAN, 127.0.0.1, Cloudflare ranges, /api/health, /auth/api/auth/jwks, allowlisted family sessions, or DETECTION_DEFECT_SUSPECTED / NOISE_SAFE_DROP events.",
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyEvalRequest {
    pub action_id: String,
    pub asset_slug: String,
    pub asset_tier: AssetTier,
    pub configured_mode: AutonomyMode,
    pub kill_switch_active: bool,
    pub circuit_breaker_tripped: bool,
    pub has_db_migration: bool,
    pub classification: Option<String>,
    pub raw_payload_text: String,
    pub target_ips: Vec<String>,
    #[serde(default)]
    pub target_asns: Vec<String>,
    pub target_paths: Vec<String>,
    pub protected_ips: Vec<String>,
    #[serde(default)]
    pub protected_asns: Vec<String>,
    pub proposed_semver_bump: Option<(String, String)>, // (old_ver, new_ver)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PolicyVerdict {
    AllowObserve,
    ShadowOnly,
    RequireL3Approval,
    AllowL2Auto,
    DenyL4HardBlocked,
    DenyKillSwitch,
    DenyCircuitBreaker,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyDecision {
    pub verdict: PolicyVerdict,
    pub invariant_id: Option<String>,
    pub effective_mode: AutonomyMode,
    pub reason: String,
    pub checks_passed: Vec<String>,
}

pub fn is_major_or_minor_bump(old_ver: &str, new_ver: &str) -> bool {
    let parse = |s: &str| -> Option<(u64, u64, u64)> {
        let clean = s.trim().trim_start_matches('v').trim_start_matches('^').trim_start_matches('~');
        let mut parts = clean.split('.');
        let maj = parts.next()?.parse().ok()?;
        let min = parts.next()?.parse().ok()?;
        let pat_raw = parts.next().unwrap_or("0").split('-').next().unwrap_or("0");
        let pat = pat_raw.parse().ok()?;
        Some((maj, min, pat))
    };
    match (parse(old_ver), parse(new_ver)) {
        (Some((o_maj, o_min, _)), Some((n_maj, n_min, _))) => n_maj > o_maj || n_min > o_min,
        _ => false,
    }
}

fn parse_ip_or_cidr(raw: &str) -> Option<(IpAddr, u8)> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some((ip_part, prefix_part)) = trimmed.split_once('/') {
        let addr = ip_part.trim().parse::<IpAddr>().ok()?;
        let prefix = prefix_part.trim().parse::<u8>().ok()?;
        let max_p = if addr.is_ipv4() { 32 } else { 128 };
        if prefix > max_p {
            return None;
        }
        Some((addr, prefix))
    } else {
        let addr = trimmed.parse::<IpAddr>().ok()?;
        let max_p = if addr.is_ipv4() { 32 } else { 128 };
        Some((addr, max_p))
    }
}

fn ipv4_mask(prefix: u8) -> u32 {
    if prefix == 0 {
        0
    } else if prefix >= 32 {
        u32::MAX
    } else {
        !0u32 << (32 - prefix)
    }
}

fn ipv6_mask(prefix: u8) -> u128 {
    if prefix == 0 {
        0
    } else if prefix >= 128 {
        u128::MAX
    } else {
        !0u128 << (128 - prefix)
    }
}

fn cidrs_overlap(a: (IpAddr, u8), b: (IpAddr, u8)) -> bool {
    match (a.0, b.0) {
        (IpAddr::V4(va), IpAddr::V4(vb)) => {
            let mask = ipv4_mask(a.1.min(b.1));
            (u32::from(va) & mask) == (u32::from(vb) & mask)
        }
        (IpAddr::V6(va), IpAddr::V6(vb)) => {
            let mask = ipv6_mask(a.1.min(b.1));
            (u128::from(va) & mask) == (u128::from(vb) & mask)
        }
        _ => false,
    }
}

/// Returns true if an IP or CIDR range overlaps any Protected Allowlist IP/CIDR,
/// loopback, RFC1918 LAN, CGNAT, link-local, ULA, or Cloudflare infrastructure range.
/// Malformed CIDR strings fail closed (return true).
pub fn is_protected_ip(ip_str: &str, extra_protected: &[String]) -> bool {
    let trimmed = ip_str.trim();
    if trimmed.is_empty() {
        return false;
    }
    if extra_protected
        .iter()
        .any(|p| p.trim().eq_ignore_ascii_case(trimmed))
    {
        return true;
    }
    let Some(target) = parse_ip_or_cidr(trimmed) else {
        // Fail closed on malformed CIDR literals (e.g. "76.25.246.157/99")
        return trimmed.contains('/');
    };

    // Any /0 wildcard CIDR matches everything including protected infrastructure
    if target.1 == 0 {
        return true;
    }

    // Check bitwise overlap against every extra_protected IP or CIDR (e.g. Home WAN / allowlist)
    for prot in extra_protected {
        if let Some(prot_cidr) = parse_ip_or_cidr(prot) {
            if cidrs_overlap(target, prot_cidr) {
                return true;
            }
        }
    }

    // Built-in protected IPv4 & IPv6 CIDRs (loopback, RFC1918, CGNAT, link-local, Cloudflare)
    const BUILTIN_PROTECTED_CIDRS: &[&str] = &[
        "0.0.0.0/8",
        "10.0.0.0/8",
        "100.64.0.0/10",
        "127.0.0.0/8",
        "169.254.0.0/16",
        "172.16.0.0/12",
        "192.168.0.0/16",
        // Cloudflare published IPv4 edge ranges
        "173.245.48.0/20",
        "103.21.244.0/22",
        "103.22.200.0/22",
        "103.31.4.0/22",
        "141.101.64.0/18",
        "108.162.192.0/18",
        "190.93.240.0/20",
        "188.114.96.0/20",
        "197.234.240.0/22",
        "198.41.128.0/17",
        "162.158.0.0/15",
        "104.16.0.0/13",
        "104.24.0.0/14",
        "172.64.0.0/13",
        "131.0.72.0/22",
        // IPv6 loopback, unspecified, ULA, link-local & Cloudflare IPv6 edge ranges
        "::/128",
        "::1/128",
        "fc00::/7",
        "fe80::/10",
        "2400:cb00::/32",
        "2606:4700::/32",
        "2803:f800::/32",
        "2405:b500::/32",
        "2405:8100::/32",
        "2a06:98c0::/29",
        "2c0f:f248::/32",
    ];
    for builtin in BUILTIN_PROTECTED_CIDRS {
        if let Some(b_cidr) = parse_ip_or_cidr(builtin) {
            if cidrs_overlap(target, b_cidr) {
                return true;
            }
        }
    }

    false
}

fn normalize_asn_digits(raw: &str) -> String {
    raw.trim()
        .trim_start_matches("AS")
        .trim_start_matches("as")
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect()
}

/// Returns true if an ASN matches Cloudflare infrastructure ASNs or any user-allowlisted ASN.
pub fn is_protected_asn(asn_str: &str, extra_protected_asns: &[String]) -> bool {
    let digits = normalize_asn_digits(asn_str);
    if digits.is_empty() {
        return false;
    }
    const BUILTIN_PROTECTED_ASNS: &[&str] = &[
        "13335",  // Cloudflare primary
        "209242", // Cloudflare London / Spectrum
        "132892", // Cloudflare Asia
        "394536", // Cloudflare
    ];
    if BUILTIN_PROTECTED_ASNS.iter().any(|a| *a == digits) {
        return true;
    }
    extra_protected_asns
        .iter()
        .any(|p| normalize_asn_digits(p) == digits)
}

fn contains_l4_forbidden_pattern(text: &str) -> Option<(&'static str, &'static str)> {
    let lower = text.to_ascii_lowercase();

    // L4-01: Arbitrary shell execution or injection metacharacters
    const SHELL_PATTERNS: &[&str] = &[
        "pwsh -command",
        "powershell -command",
        "cmd.exe /c",
        "cmd /c",
        "bash -c",
        "sh -c",
        "rm -rf",
        "$(",
        "`",
        "; rm ",
        "&& rm ",
        "| sh",
        "| bash",
    ];
    for pat in SHELL_PATTERNS {
        if lower.contains(pat) {
            return Some(("L4-01", "Arbitrary shell execution or injection sequence detected"));
        }
    }

    // L4-02: Forbidden workstation filesystem & credential paths
    const PATH_PATTERNS: &[&str] = &[
        "\\.ssh\\",
        "/.ssh/",
        ".env.local.keys",
        ".env.deploy",
        "rsa-key-deployment",
        "panorama-ssh-vault",
        "d:\\",
        "e:\\",
        "c:\\windows\\system32",
        "\\windows\\system32",
    ];
    for pat in PATH_PATTERNS {
        if lower.contains(pat) {
            return Some(("L4-02", "Access to protected workstation credential, backup, or system path is permanently blocked"));
        }
    }

    // L4-03: UAC elevation & destructive git
    const GIT_UAC_PATTERNS: &[&str] = &[
        "git reset --hard",
        "git push --force",
        "git push -f",
        "--no-verify",
        "allow_major_minor_bump",
        "-verb runas",
    ];
    for pat in GIT_UAC_PATTERNS {
        if lower.contains(pat) {
            return Some(("L4-03", "Destructive Git, hook bypass, SemVer bypass, or UAC elevation is permanently blocked"));
        }
    }

    // L4-04: Production SQLite / volume mutations
    const DB_PATTERNS: &[&str] = &[
        "drop table",
        "drop database",
        "delete from ",
        "alter table",
        "truncate table",
        "restoreremote",
        "docker volume rm",
        "rm -rf /var/data",
    ];
    for pat in DB_PATTERNS {
        if lower.contains(pat) {
            return Some(("L4-04", "Production database mutation or volume deletion is permanently blocked"));
        }
    }

    // L4-05: WSH firewall & containment invariants
    const WSH_PATTERNS: &[&str] = &[
        "iptables -f",
        "iptables --flush",
        "iptables -x docker-user",
        "iptables -d docker-user",
        "iptables -d panorama-input",
        "panorama-firewall.service stop",
        "systemctl disable panorama-firewall",
        "network_mode: host",
        "\"network_mode\": \"host\"",
        "0.0.0.0:300",
        "passwordauthentication yes",
        "permitrootlogin yes",
    ];
    for pat in WSH_PATTERNS {
        if lower.contains(pat) {
            return Some(("L4-05", "Modification of WSH kernel firewall chains, loopback binding, or SSH hardening is permanently blocked"));
        }
    }

    None
}

pub fn evaluate_policy_decision(req: &PolicyEvalRequest) -> PolicyDecision {
    let mut checks_passed = Vec::new();

    // 1. Compile-time L4 forbidden signature check on payload text
    if let Some((inv_id, msg)) = contains_l4_forbidden_pattern(&req.raw_payload_text) {
        return PolicyDecision {
            verdict: PolicyVerdict::DenyL4HardBlocked,
            invariant_id: Some(inv_id.to_string()),
            effective_mode: AutonomyMode::L4HardBlocked,
            reason: msg.to_string(),
            checks_passed,
        };
    }
    checks_passed.push("L4-01..05 payload signature scan clean".to_string());

    // 2. L4-03 SemVer Major/Minor Lock check
    if let Some((ref old_v, ref new_v)) = req.proposed_semver_bump {
        if is_major_or_minor_bump(old_v, new_v) {
            return PolicyDecision {
                verdict: PolicyVerdict::DenyL4HardBlocked,
                invariant_id: Some("L4-03".to_string()),
                effective_mode: AutonomyMode::L4HardBlocked,
                reason: format!(
                    "SemVer Major/Minor bump ({} -> {}) is permanently blocked from autonomous execution",
                    old_v, new_v
                ),
                checks_passed,
            };
        }
        checks_passed.push(format!("L4-03 SemVer patch-only verified ({} -> {})", old_v, new_v));
    }

    // 3. L4-06 Protected Allowlist IP & protected route check for defense actions
    let is_defense_action = req.action_id.starts_with("apply_cf_") || req.action_id.contains("waf") || req.action_id.contains("block");
    if is_defense_action {
        for ip in &req.target_ips {
            if is_protected_ip(ip, &req.protected_ips) {
                return PolicyDecision {
                    verdict: PolicyVerdict::DenyL4HardBlocked,
                    invariant_id: Some("L4-06".to_string()),
                    effective_mode: AutonomyMode::L4HardBlocked,
                    reason: format!(
                        "Target IP/CIDR '{}' overlaps Protected Allowlist / LAN / Loopback / Cloudflare infrastructure",
                        ip
                    ),
                    checks_passed,
                };
            }
        }
        for asn in &req.target_asns {
            if is_protected_asn(asn, &req.protected_asns) {
                return PolicyDecision {
                    verdict: PolicyVerdict::DenyL4HardBlocked,
                    invariant_id: Some("L4-06".to_string()),
                    effective_mode: AutonomyMode::L4HardBlocked,
                    reason: format!(
                        "Target ASN '{}' belongs to Protected Allowlist or Cloudflare infrastructure",
                        asn
                    ),
                    checks_passed,
                };
            }
        }
        for path in &req.target_paths {
            let p = path.trim().to_ascii_lowercase();
            if p.ends_with("/api/health") || p.contains("/api/auth/jwks") || p == "/auth/api/auth/jwks" {
                return PolicyDecision {
                    verdict: PolicyVerdict::DenyL4HardBlocked,
                    invariant_id: Some("L4-06".to_string()),
                    effective_mode: AutonomyMode::L4HardBlocked,
                    reason: format!("Protected health/JWKS route '{}' cannot be blocked", path),
                    checks_passed,
                };
            }
        }
        if let Some(ref cls) = req.classification {
            let c = cls.trim().to_ascii_uppercase();
            if matches!(
                c.as_str(),
                "DETECTION_DEFECT_SUSPECTED" | "CONFIRMED_BENIGN_FALSE_POSITIVE" | "NOISE_SAFE_DROP"
            ) {
                return PolicyDecision {
                    verdict: PolicyVerdict::DenyL4HardBlocked,
                    invariant_id: Some("L4-06".to_string()),
                    effective_mode: AutonomyMode::L4HardBlocked,
                    reason: format!(
                        "Defensive blocking is permanently prohibited for classification '{}'",
                        c
                    ),
                    checks_passed,
                };
            }
        }
        checks_passed.push("L4-06 Protected Allowlist & false-positive immunity verified".to_string());
    }

    // 4. Lookup compiled Action Catalog (unknown actions are L4-01 hard-blocked!)
    let catalog = compiled_action_catalog();
    let Some(spec) = catalog.iter().find(|s| s.action_id == req.action_id) else {
        return PolicyDecision {
            verdict: PolicyVerdict::DenyL4HardBlocked,
            invariant_id: Some("L4-01".to_string()),
            effective_mode: AutonomyMode::L4HardBlocked,
            reason: format!(
                "Action '{}' is not registered in the compiled Rust Action Broker catalog",
                req.action_id
            ),
            checks_passed,
        };
    };
    checks_passed.push(format!("Action '{}' verified in compiled Rust catalog", spec.action_id));

    // 5. Global Emergency Kill-Switch check (allows read-only OBSERVE only)
    if req.kill_switch_active && spec.action_id != "create_bug_handoff" {
        return PolicyDecision {
            verdict: PolicyVerdict::DenyKillSwitch,
            invariant_id: None,
            effective_mode: AutonomyMode::Observe,
            reason: "Global Emergency Kill-Switch is engaged — all L1/L2/L3 mutations halted".to_string(),
            checks_passed,
        };
    }

    // 6. Circuit Breaker check (freezes L2 auto-execution)
    if req.circuit_breaker_tripped && req.configured_mode == AutonomyMode::L2Auto {
        return PolicyDecision {
            verdict: PolicyVerdict::DenyCircuitBreaker,
            invariant_id: None,
            effective_mode: AutonomyMode::L3Approval,
            reason: "Circuit Breaker is TRIPPED — L2 autonomous execution frozen until operator reset".to_string(),
            checks_passed,
        };
    }

    // 7. Tier-0 & DB_MIGRATION hard downgrade to L3 Approval on rollbacks
    if req.action_id == "rollback_n3_db_safe" {
        if req.asset_tier == AssetTier::Tier0Critical {
            return PolicyDecision {
                verdict: PolicyVerdict::RequireL3Approval,
                invariant_id: Some("TIER0-GUARD".to_string()),
                effective_mode: AutonomyMode::L3Approval,
                reason: format!(
                    "Asset '{}' is Tier-0 Critical — rollbacks strictly require Desktop L3 Approval",
                    req.asset_slug
                ),
                checks_passed,
            };
        }
        if req.has_db_migration {
            return PolicyDecision {
                verdict: PolicyVerdict::RequireL3Approval,
                invariant_id: Some("DB-MIGRATION-GUARD".to_string()),
                effective_mode: AutonomyMode::L3Approval,
                reason: format!(
                    "Release for '{}' carries DB_MIGRATION blast-radius flag — auto-rollback forbidden; escalated to L3 Approval",
                    req.asset_slug
                ),
                checks_passed,
            };
        }
        checks_passed.push("Tier-1 & DB_MIGRATION == false rollback safety verified".to_string());
    }

    // 8. Clamp configured mode against compile-time max_allowed_mode ceiling
    let effective = if req.configured_mode.rank_permissive() > spec.max_allowed_mode.rank_permissive() {
        spec.max_allowed_mode
    } else {
        req.configured_mode
    };
    checks_passed.push(format!(
        "Effective autonomy clamped to {} (ceiling: {})",
        effective.as_str(),
        spec.max_allowed_mode.as_str()
    ));

    match effective {
        AutonomyMode::Observe => PolicyDecision {
            verdict: PolicyVerdict::AllowObserve,
            invariant_id: None,
            effective_mode: AutonomyMode::Observe,
            reason: "Policy is OBSERVE — telemetry recorded with zero execution".to_string(),
            checks_passed,
        },
        AutonomyMode::Shadow => PolicyDecision {
            verdict: PolicyVerdict::ShadowOnly,
            invariant_id: None,
            effective_mode: AutonomyMode::Shadow,
            reason: "Policy is SHADOW — logged what Otto would execute without mutating infrastructure".to_string(),
            checks_passed,
        },
        AutonomyMode::L3Approval => PolicyDecision {
            verdict: PolicyVerdict::RequireL3Approval,
            invariant_id: None,
            effective_mode: AutonomyMode::L3Approval,
            reason: "Action queued for explicit Desktop L3 Approval before execution".to_string(),
            checks_passed,
        },
        AutonomyMode::L2Auto => PolicyDecision {
            verdict: PolicyVerdict::AllowL2Auto,
            invariant_id: None,
            effective_mode: AutonomyMode::L2Auto,
            reason: "Policy permits reversible L2 execution under circuit-breaker guardrails".to_string(),
            checks_passed,
        },
        AutonomyMode::L4HardBlocked => PolicyDecision {
            verdict: PolicyVerdict::DenyL4HardBlocked,
            invariant_id: Some("L4-01".to_string()),
            effective_mode: AutonomyMode::L4HardBlocked,
            reason: "Action is hard-blocked".to_string(),
            checks_passed,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_req(action_id: &str) -> PolicyEvalRequest {
        PolicyEvalRequest {
            action_id: action_id.to_string(),
            asset_slug: "spendy".to_string(),
            asset_tier: AssetTier::Tier1ChildApp,
            configured_mode: AutonomyMode::L2Auto,
            kill_switch_active: false,
            circuit_breaker_tripped: false,
            has_db_migration: false,
            classification: None,
            raw_payload_text: "{}".to_string(),
            target_ips: vec![],
            target_asns: vec![],
            target_paths: vec![],
            protected_ips: vec!["198.51.100.10".to_string()],
            protected_asns: vec![],
            proposed_semver_bump: None,
        }
    }

    #[test]
    fn l4_blocks_arbitrary_shell_and_sensitive_paths_and_db_and_firewall() {
        for (payload, expected_inv) in [
            ("pwsh -Command Get-Process", "L4-01"),
            ("cat C:\\Users\\rodrigo\\.ssh\\rsa-key-deployment", "L4-02"),
            ("read .env.local.keys", "L4-02"),
            ("copy to D:\\Google\\My Drive", "L4-02"),
            ("git push --force origin main", "L4-03"),
            ("DROP TABLE users;", "L4-04"),
            ("RestoreRemote backup.sqlite", "L4-04"),
            ("iptables -F DOCKER-USER", "L4-05"),
            ("ports: 0.0.0.0:3001:3001", "L4-05"),
        ] {
            let mut req = base_req("restart_container");
            req.raw_payload_text = payload.to_string();
            let res = evaluate_policy_decision(&req);
            assert_eq!(res.verdict, PolicyVerdict::DenyL4HardBlocked, "failed for payload: {}", payload);
            assert_eq!(res.invariant_id.as_deref(), Some(expected_inv));
        }
    }

    #[test]
    fn l4_blocks_unknown_uncompiled_action_id() {
        let req = base_req("exec_arbitrary_bash");
        let res = evaluate_policy_decision(&req);
        assert_eq!(res.verdict, PolicyVerdict::DenyL4HardBlocked);
        assert_eq!(res.invariant_id.as_deref(), Some("L4-01"));
    }

    #[test]
    fn l4_blocks_major_and_minor_semver_bumps_allows_patch() {
        let mut major = base_req("stage_worktree_patch");
        major.proposed_semver_bump = Some(("1.10.11".into(), "2.0.0".into()));
        assert_eq!(evaluate_policy_decision(&major).verdict, PolicyVerdict::DenyL4HardBlocked);

        let mut minor = base_req("stage_worktree_patch");
        minor.proposed_semver_bump = Some(("1.10.11".into(), "1.11.0".into()));
        assert_eq!(evaluate_policy_decision(&minor).verdict, PolicyVerdict::DenyL4HardBlocked);

        let mut patch = base_req("stage_worktree_patch");
        patch.proposed_semver_bump = Some(("1.10.11".into(), "1.10.12".into()));
        assert_eq!(evaluate_policy_decision(&patch).verdict, PolicyVerdict::AllowL2Auto);
    }

    #[test]
    fn l4_protects_allowlisted_ips_routes_and_detection_defects() {
        for protected_ip in ["127.0.0.1", "192.168.1.50", "172.25.25.5", "100.64.250.2", "198.51.100.10"] {
            let mut req = base_req("apply_cf_temp_challenge");
            req.target_ips = vec![protected_ip.to_string()];
            let res = evaluate_policy_decision(&req);
            assert_eq!(res.verdict, PolicyVerdict::DenyL4HardBlocked, "IP {} must be protected", protected_ip);
            assert_eq!(res.invariant_id.as_deref(), Some("L4-06"));
        }

        let mut health_req = base_req("apply_cf_permanent_waf");
        health_req.target_paths = vec!["/auth/api/auth/jwks".to_string()];
        assert_eq!(evaluate_policy_decision(&health_req).verdict, PolicyVerdict::DenyL4HardBlocked);

        let mut defect_req = base_req("apply_cf_temp_challenge");
        defect_req.target_ips = vec!["203.0.113.55".to_string()];
        defect_req.classification = Some("DETECTION_DEFECT_SUSPECTED".to_string());
        assert_eq!(evaluate_policy_decision(&defect_req).verdict, PolicyVerdict::DenyL4HardBlocked);
    }

    #[test]
    fn enforces_db_migration_and_tier0_rollback_guards_and_kill_switch_and_breaker() {
        let mut db_mig = base_req("rollback_n3_db_safe");
        db_mig.has_db_migration = true;
        assert_eq!(evaluate_policy_decision(&db_mig).verdict, PolicyVerdict::RequireL3Approval);

        let mut tier0 = base_req("rollback_n3_db_safe");
        tier0.asset_slug = "auth".into();
        tier0.asset_tier = AssetTier::Tier0Critical;
        assert_eq!(evaluate_policy_decision(&tier0).verdict, PolicyVerdict::RequireL3Approval);

        let mut safe_rb = base_req("rollback_n3_db_safe");
        safe_rb.configured_mode = AutonomyMode::Shadow;
        assert_eq!(evaluate_policy_decision(&safe_rb).verdict, PolicyVerdict::ShadowOnly);

        let mut ks = base_req("restart_container");
        ks.kill_switch_active = true;
        assert_eq!(evaluate_policy_decision(&ks).verdict, PolicyVerdict::DenyKillSwitch);

        let mut cb = base_req("restart_container");
        cb.circuit_breaker_tripped = true;
        assert_eq!(evaluate_policy_decision(&cb).verdict, PolicyVerdict::DenyCircuitBreaker);

        // Production deploy ceiling is strictly L3Approval even if L2Auto requested
        let deploy = base_req("deploy_verified_patch");
        assert_eq!(evaluate_policy_decision(&deploy).verdict, PolicyVerdict::RequireL3Approval);
    }
}
