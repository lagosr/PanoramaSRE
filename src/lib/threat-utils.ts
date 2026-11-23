import type {
  GeminiCampaignDto,
  LanClientBaselineRow,
  ThreatActorRow,
  ThreatAuditRunRow,
  ThreatFindingRow,
} from './types';

export interface FilterSelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface ExternalFindingFilters {
  search: string;
  domain: string;
  severity: string;
  vector: string;
}

export interface ThreatActorExtraFilters {
  domain?: string;
  severity?: string;
  vector?: string;
  country?: string;
}

export interface ExternalCampaignFilters {
  domain: string;
  severity: string;
}

export type ThreatSurfaceDomain = 'external' | 'internal' | 'crossover';

export type BadgeVariant = 'danger' | 'warning' | 'info' | 'success' | 'neutral';

export function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeAsnDigits(raw: string): string {
  const clean = raw.trim().toUpperCase();
  const stripped = clean.startsWith('AS') ? clean.slice(2).trim() : clean;
  return /^\d+$/.test(stripped) ? stripped : '';
}

/**
 * Generates a copyable Cloudflare WAF Custom Rule expression for blocking IPs and/or ASNs.
 * Matches backend `build_waf_rule_expression` syntax.
 */
export function buildWafRuleExpression(ips: Array<string | null | undefined>, asns: Array<string | null | undefined> = []): string {
  const seenIps = new Set<string>();
  const cleanIps: string[] = [];
  for (const raw of ips) {
    const val = (raw ?? '').trim();
    if (!val || seenIps.has(val)) continue;
    seenIps.add(val);
    cleanIps.push(val);
  }

  const seenAsns = new Set<string>();
  const cleanAsns: string[] = [];
  for (const raw of asns) {
    const digits = normalizeAsnDigits(raw ?? '');
    if (!digits || seenAsns.has(digits)) continue;
    seenAsns.add(digits);
    cleanAsns.push(digits);
  }

  const clauses: string[] = [];
  if (cleanIps.length > 0) {
    clauses.push(`ip.src in {${cleanIps.join(' ')}}`);
  }
  if (cleanAsns.length > 0) {
    clauses.push(`ip.geoip.asnum in {${cleanAsns.join(' ')}}`);
  }
  if (clauses.length === 0) return '';
  if (clauses.length === 1) return `(${clauses[0]})`;
  return `(${clauses.join(' or ')})`;
}

export function buildCloudflareSecurityEventsUrl(
  accountId: string | null | undefined,
  zoneName: string | null | undefined,
  ip?: string | null
): string {
  const acct = (accountId ?? '').trim();
  const zone = (zoneName ?? '').trim();
  if (!acct || !zone) {
    return 'https://dash.cloudflare.com/';
  }
  const base = `https://dash.cloudflare.com/${encodeURIComponent(acct)}/${encodeURIComponent(zone)}/security/events`;
  const cleanIp = (ip ?? '').trim();
  return cleanIp ? `${base}?ip=${encodeURIComponent(cleanIp)}` : base;
}

export function buildCloudflareZeroTrustLogsUrl(accountId: string | null | undefined): string {
  const acct = (accountId ?? '').trim();
  if (!acct) {
    return 'https://one.dash.cloudflare.com/';
  }
  return `https://one.dash.cloudflare.com/${encodeURIComponent(acct)}/logs/access`;
}

export function buildUnifiConsoleUrl(
  baseUrl: string | null | undefined,
  section?: 'clients' | 'threats' | 'policies'
): string {
  const raw = (baseUrl ?? '').trim().replace(/\/+$/, '');
  const root = raw || 'https://ui.panoramadr.com';
  switch (section) {
    case 'clients':
      return `${root}/network/default/clients`;
    case 'threats':
      return `${root}/network/default/security/insights`;
    case 'policies':
      return `${root}/network/default/settings/security/firewall`;
    default:
      return `${root}/network/default/dashboard`;
  }
}

export function computeThreatSidebarBadge(
  latestRun: ThreatAuditRunRow | null | undefined,
  activeActorsCount: number
): { count: number; severity: 'error' | 'warning' | null } {
  if (!latestRun) {
    return { count: 0, severity: null };
  }
  const sev = latestRun.overallSeverity.trim().toUpperCase();
  const verdict = latestRun.intrusionVerdict.trim().toUpperCase();

  if (
    sev === 'HIGH' ||
    sev === 'CRITICAL' ||
    verdict === 'LIKELY_INTRUSION' ||
    verdict === 'LIKELY_COMPROMISE' ||
    verdict === 'CONFIRMED_COMPROMISE'
  ) {
    return { count: Math.max(1, activeActorsCount), severity: 'error' };
  }
  if (sev === 'MEDIUM' || verdict === 'SUSPICIOUS_ACTIVITY') {
    return { count: Math.max(1, activeActorsCount), severity: 'warning' };
  }
  return { count: 0, severity: null };
}

export function severityToBadgeVariant(severity: string): BadgeVariant {
  switch (severity.trim().toUpperCase()) {
    case 'CRITICAL':
    case 'HIGH':
      return 'danger';
    case 'MEDIUM':
      return 'warning';
    case 'LOW':
      return 'info';
    default:
      return 'neutral';
  }
}

export function verdictToBadgeVariant(verdict: string): 'danger' | 'warning' | 'success' | 'neutral' {
  switch (verdict.trim().toUpperCase()) {
    case 'CONFIRMED_COMPROMISE':
    case 'LIKELY_COMPROMISE':
    case 'LIKELY_INTRUSION':
      return 'danger';
    case 'SUSPICIOUS_ACTIVITY':
      return 'warning';
    case 'NO_EVIDENCE':
      return 'success';
    default:
      return 'neutral';
  }
}

export function collectorStatusToBadgeVariant(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  const clean = (status ?? '').trim().toLowerCase();
  if (clean === 'connected') return 'success';
  if (clean.startsWith('not configured')) return 'warning';
  if (clean.startsWith('error') || clean.startsWith('offline')) return 'danger';
  return 'neutral';
}

export function filterThreatActors(
  actors: ThreatActorRow[],
  query: string,
  disposition: string,
  extra?: ThreatActorExtraFilters
): ThreatActorRow[] {
  const dispNorm = disposition.trim().toUpperCase();
  const q = query.trim().toLowerCase();
  const domainFilter = extra?.domain ?? 'ALL';
  const severityFilter = extra?.severity ?? 'ALL';
  const vectorFilter = (extra?.vector ?? 'ALL').trim().toUpperCase();
  const countryFilter = (extra?.country ?? 'ALL').trim().toUpperCase();

  return actors.filter((actor) => {
    if (dispNorm && dispNorm !== 'ALL' && actor.disposition.toUpperCase() !== dispNorm) {
      return false;
    }
    if (domainFilter && domainFilter !== 'ALL') {
      const targetHosts = safeParseJson<string[]>(actor.targetHostsJson, []);
      if (!matchesDomainFilter(targetHosts, domainFilter)) {
        return false;
      }
    }
    if (!matchesSeverityFilter(actor.highestSeverity, severityFilter)) {
      return false;
    }
    if (vectorFilter && vectorFilter !== 'ALL') {
      if (vectorFilter === 'ORIGIN_CROSSOVER') {
        if (actor.totalOrigin200s <= 0) return false;
      } else if (vectorFilter === 'INTEL_TAGGED') {
        if (safeParseJson<string[]>(actor.intelTagsJson, []).length === 0) return false;
      } else if (vectorFilter === 'REPEAT_OFFENDER') {
        if (actor.runsSeen < 2) return false;
      } else if (vectorFilter === 'EXPLOIT_PROBES') {
        if (!actorHasExploitProbePaths(actor)) return false;
      } else if (vectorFilter.startsWith('CLASS:')) {
        const expectedClass = vectorFilter.slice(6).trim();
        if ((actor.latestClassification ?? '').trim().toUpperCase() !== expectedClass) {
          return false;
        }
      }
    }
    if (countryFilter && countryFilter !== 'ALL') {
      const c = (actor.country ?? '').trim().toUpperCase();
      if (countryFilter === 'NON_US') {
        if (!c || c === 'US') return false;
      } else if (countryFilter === 'UNKNOWN') {
        if (c !== '') return false;
      } else if (c !== countryFilter) {
        return false;
      }
    }
    if (!q) return true;

    const hay = [
      actor.id,
      actor.ipAddress ?? '',
      actor.asn ?? '',
      actor.asOrg ?? '',
      actor.country ?? '',
      actor.intelSummary ?? '',
      actor.latestClassification ?? '',
      actor.targetHostsJson,
      actor.samplePathsJson,
    ]
      .join(' ')
      .toLowerCase();

    return hay.includes(q);
  });
}

export function formatCompactBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val >= 10 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

export function classifyFindingSurface(sourceLayer: string): 'external' | 'internal' {
  const s = (sourceLayer || '').trim().toUpperCase();
  if (s === 'CLOUDFLARE' || s === 'ZERO_TRUST' || s.includes('CLOUDFLARE')) {
    return 'external';
  }
  return 'internal';
}

export function classifyActionSurface(surface: string): ThreatSurfaceDomain {
  const s = (surface || '').trim().toUpperCase();
  if (s.includes('CLOUDFLARE') || s.includes('ZERO_TRUST')) {
    return 'external';
  }
  if (s.includes('UNIFI') || s.includes('WSH') || s.includes('ORIGIN') || s.includes('AUTH')) {
    return 'internal';
  }
  return 'crossover';
}

export function classifyAllowlistSurface(entryType: string): 'external' | 'internal' {
  const t = (entryType || '').trim().toUpperCase();
  if (t === 'LAN_MAC' || t === 'SSH_KEY') {
    return 'internal';
  }
  return 'external';
}

export function filterLanClients(
  clients: LanClientBaselineRow[],
  search: string,
  trustFilter: 'ALL' | 'TRUSTED' | 'UNREVIEWED',
  vlanFilter = 'ALL'
): LanClientBaselineRow[] {
  const q = search.trim().toLowerCase();
  const vlanTarget = vlanFilter.trim().toLowerCase();
  return clients.filter((cli) => {
    if (trustFilter === 'TRUSTED' && !cli.isTrusted) return false;
    if (trustFilter === 'UNREVIEWED' && cli.isTrusted) return false;
    if (vlanTarget && vlanTarget !== 'all') {
      const cliVlan = (cli.networkVlan || '').trim().toLowerCase();
      if (!cliVlan) return false;
      const matched =
        cliVlan === vlanTarget ||
        cliVlan.startsWith(`${vlanTarget} (`) ||
        vlanTarget.startsWith(`${cliVlan} (`);
      if (!matched) return false;
    }
    if (!q) return true;
    const hay = [
      cli.label,
      cli.hostname ?? '',
      cli.macAddress,
      cli.ipAddress ?? '',
      cli.networkVlan ?? '',
      cli.ouiVendor ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

const EXPLOIT_PATH_REGEX =
  /\.env|\.git|wp-login|wp-admin|wp-content|xmlrpc|\.php|cgi-bin|phpmyadmin|actuator|\/etc\/passwd/i;

const FINDING_VECTOR_META: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'ORIGIN_BREACH', label: 'Origin Breach (200/302)' },
  { key: 'EXPLOIT_PROBES', label: 'Exploit / Secret Probes' },
  { key: 'INTEL_TAGGED', label: 'CF Threat Intel Tagged' },
  { key: 'ZERO_TRUST', label: 'Zero Trust Access' },
  { key: 'TUNNEL', label: 'Tunnel Health' },
  { key: 'AUDIT_LOG', label: 'Control-Plane Audit' },
];

const FINDING_VECTOR_LABEL_MAP = new Map<string, string>(
  FINDING_VECTOR_META.map((item) => [item.key, item.label])
);

function formatEnumLabel(raw: string): string {
  return raw
    .trim()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Normalizes a URL or host token to a bare lowercase DNS hostname without protocol, path, or port.
 */
export function normalizeHostname(raw: string | null | undefined): string {
  if (!raw) return '';
  let val = raw.trim().toLowerCase();
  if (!val) return '';
  val = val.replace(/^https?:\/\//, '');
  val = val.split(/[/?#]/, 1)[0] ?? '';
  if (val.startsWith('[')) {
    const closeIdx = val.indexOf(']');
    if (closeIdx > 0) {
      val = val.slice(0, closeIdx + 1);
    }
  } else {
    const firstColon = val.indexOf(':');
    const lastColon = val.lastIndexOf(':');
    if (firstColon > 0 && firstColon === lastColon) {
      val = val.slice(0, firstColon);
    }
  }
  return val.replace(/\.+$/, '');
}

/**
 * Resolves the root Cloudflare zone for a normalized hostname (matching knownZones first).
 */
export function extractRootZone(host: string, knownZones: string[] = []): string {
  const cleanHost = normalizeHostname(host);
  if (!cleanHost) return '';

  const sortedZones = Array.from(
    new Set(knownZones.map((z) => normalizeHostname(z)).filter(Boolean))
  ).sort((a, b) => b.length - a.length);

  for (const zone of sortedZones) {
    if (cleanHost === zone || cleanHost.endsWith(`.${zone}`)) {
      return zone;
    }
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(cleanHost) || cleanHost.includes(':')) {
    return cleanHost;
  }

  const parts = cleanHost.split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : cleanHost;
}

/**
 * Checks whether a list of target hostnames satisfies a structured domain filter (`ALL`, `NONE`, `zone:<root>`, `host:<exact>`, or bare domain).
 */
export function matchesDomainFilter(
  hosts: Array<string | null | undefined>,
  domainFilter: string
): boolean {
  const cleanFilter = (domainFilter || '').trim().toLowerCase();
  if (!cleanFilter || cleanFilter === 'all') return true;

  const cleanHosts = hosts.map(normalizeHostname).filter(Boolean);
  if (cleanFilter === 'none') {
    return cleanHosts.length === 0;
  }

  if (cleanFilter.startsWith('zone:')) {
    const root = normalizeHostname(cleanFilter.slice(5));
    if (!root) return true;
    return cleanHosts.some((h) => h === root || h.endsWith(`.${root}`));
  }

  if (cleanFilter.startsWith('host:')) {
    const exact = normalizeHostname(cleanFilter.slice(5));
    if (!exact) return true;
    return cleanHosts.some((h) => h === exact);
  }

  const bare = normalizeHostname(cleanFilter);
  if (!bare) return true;
  return cleanHosts.some((h) => h === bare || h.endsWith(`.${bare}`));
}

/**
 * Builds deduplicated domain dropdown options containing zone rollups, exact subdomains, and optional hostless bucket.
 */
export function buildDomainFilterOptions(
  itemHostsList: Array<Array<string | null | undefined>>,
  knownZones: string[] = []
): FilterSelectOption[] {
  const cleanKnownZones = Array.from(
    new Set(knownZones.map((z) => normalizeHostname(z)).filter(Boolean))
  );

  const zoneCounts = new Map<string, number>();
  for (const z of cleanKnownZones) {
    zoneCounts.set(z, 0);
  }

  const hostCounts = new Map<string, number>();
  const distinctHostsByZone = new Map<string, Set<string>>();
  let hostlessCount = 0;

  for (const rawHosts of itemHostsList) {
    const cleanHosts = Array.from(new Set(rawHosts.map(normalizeHostname).filter(Boolean)));
    if (cleanHosts.length === 0) {
      hostlessCount += 1;
      continue;
    }

    const itemZones = new Set<string>();
    for (const h of cleanHosts) {
      hostCounts.set(h, (hostCounts.get(h) ?? 0) + 1);
      const root = extractRootZone(h, cleanKnownZones);
      if (root) {
        itemZones.add(root);
        let hostSet = distinctHostsByZone.get(root);
        if (!hostSet) {
          hostSet = new Set<string>();
          distinctHostsByZone.set(root, hostSet);
        }
        hostSet.add(h);
      }
    }

    for (const z of itemZones) {
      zoneCounts.set(z, (zoneCounts.get(z) ?? 0) + 1);
    }
  }

  const options: FilterSelectOption[] = [
    { value: 'ALL', label: `All Domains (${itemHostsList.length})` },
  ];

  const sortedZones = Array.from(zoneCounts.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  for (const [zone, count] of sortedZones) {
    options.push({
      value: `zone:${zone}`,
      label: `${zone} (Zone) (${count})`,
    });
  }

  const sortedHosts = Array.from(hostCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [host, count] of sortedHosts) {
    const root = extractRootZone(host, cleanKnownZones);
    const zoneHostCount = distinctHostsByZone.get(root)?.size ?? 0;
    if (host !== root || zoneHostCount > 1) {
      options.push({
        value: `host:${host}`,
        label: `${host} (${count})`,
      });
    }
  }

  if (hostlessCount > 0) {
    options.push({
      value: 'NONE',
      label: `Account-Wide / No Host (${hostlessCount})`,
    });
  }

  return options;
}

/**
 * Matches a finding or actor severity against `'ALL'`, `'CRITICAL_HIGH'`, or an exact severity level.
 */
export function matchesSeverityFilter(
  severity: string | null | undefined,
  severityFilter: string
): boolean {
  const filter = (severityFilter || '').trim().toUpperCase();
  if (!filter || filter === 'ALL') return true;

  const actual = (severity || '').trim().toUpperCase();
  if (filter === 'CRITICAL_HIGH') {
    return actual === 'CRITICAL' || actual === 'HIGH';
  }
  return actual === filter;
}

/**
 * Builds standard severity filter options with live counts from the inspected items.
 */
export function buildSeverityFilterOptions(
  severities: Array<string | null | undefined>
): FilterSelectOption[] {
  const counts: Record<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW', number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };

  for (const raw of severities) {
    const sev = (raw || '').trim().toUpperCase();
    if (sev === 'CRITICAL' || sev === 'HIGH' || sev === 'MEDIUM' || sev === 'LOW') {
      counts[sev] += 1;
    }
  }

  return [
    { value: 'ALL', label: `All Severities (${severities.length})` },
    { value: 'CRITICAL_HIGH', label: `Critical & High (${counts.CRITICAL + counts.HIGH})` },
    { value: 'CRITICAL', label: `Critical (${counts.CRITICAL})` },
    { value: 'HIGH', label: `High (${counts.HIGH})` },
    { value: 'MEDIUM', label: `Medium (${counts.MEDIUM})` },
    { value: 'LOW', label: `Low (${counts.LOW})` },
  ];
}

/**
 * Maps a Cloudflare external deterministic finding into a normalized vector filter bucket.
 */
export function classifyFindingVector(finding: ThreatFindingRow): string {
  const rule = (finding.ruleId || '').trim().toUpperCase();
  const cat = (finding.category || '').trim().toUpperCase();

  if (rule === 'ORIGIN_BREACH_THROUGH' || cat === 'ORIGIN_BREACH') return 'ORIGIN_BREACH';
  if (rule === 'SECRET_EXPLOIT_PROBE') return 'EXPLOIT_PROBES';
  if (rule === 'MALICIOUS_INTEL_HIT') return 'INTEL_TAGGED';
  if (rule === 'ZT_UNEXPECTED_ACCESS' || cat === 'ZERO_TRUST') return 'ZERO_TRUST';
  if (rule === 'TUNNEL_DEGRADED' || cat === 'TUNNEL') return 'TUNNEL';
  if (rule === 'CONTROL_PLANE_MUTATION' || cat === 'AUDIT_LOG') return 'AUDIT_LOG';
  return cat || rule || 'OTHER';
}

/**
 * Builds vector dropdown options for External Perimeter Findings with live per-vector counts.
 */
export function buildExternalFindingVectorOptions(
  findings: ThreatFindingRow[]
): FilterSelectOption[] {
  const counts = new Map<string, number>();
  for (const f of findings) {
    const vec = classifyFindingVector(f);
    counts.set(vec, (counts.get(vec) ?? 0) + 1);
  }

  const options: FilterSelectOption[] = [
    { value: 'ALL', label: `All Vectors (${findings.length})` },
  ];

  for (const meta of FINDING_VECTOR_META) {
    options.push({
      value: meta.key,
      label: `${meta.label} (${counts.get(meta.key) ?? 0})`,
    });
  }

  const extraKeys = Array.from(counts.keys())
    .filter((k) => !FINDING_VECTOR_LABEL_MAP.has(k))
    .sort((a, b) => a.localeCompare(b));
  for (const key of extraKeys) {
    options.push({
      value: key,
      label: `${formatEnumLabel(key)} (${counts.get(key) ?? 0})`,
    });
  }

  return options;
}

/**
 * Filters Cloudflare external deterministic findings by domain, severity, vector, and search text.
 */
export function filterExternalFindings(
  findings: ThreatFindingRow[],
  filters: ExternalFindingFilters
): ThreatFindingRow[] {
  const q = filters.search.trim().toLowerCase();
  const vectorFilter = (filters.vector || 'ALL').trim().toUpperCase();

  return findings.filter((f) => {
    if (!matchesDomainFilter([f.host], filters.domain)) {
      return false;
    }
    if (!matchesSeverityFilter(f.severity, filters.severity)) {
      return false;
    }
    if (vectorFilter && vectorFilter !== 'ALL' && classifyFindingVector(f) !== vectorFilter) {
      return false;
    }
    if (!q) return true;

    const hay = [
      f.title,
      f.summary,
      f.ruleId,
      f.category,
      f.host ?? '',
      f.actorIp ?? '',
      f.actorAsn ?? '',
      f.rayIdsJson,
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

/**
 * Returns true when an external threat actor shows exploit-attempt classification or high-risk probe paths.
 */
export function actorHasExploitProbePaths(actor: ThreatActorRow): boolean {
  if ((actor.latestClassification ?? '').trim().toUpperCase() === 'EXPLOIT_ATTEMPT') {
    return true;
  }
  const paths = safeParseJson<string[]>(actor.samplePathsJson, []);
  return paths.some((p) => EXPLOIT_PATH_REGEX.test(p));
}

/**
 * Builds vector and AI-classification dropdown options for Recurring External Threat Actors.
 */
export function buildActorVectorOptions(actors: ThreatActorRow[]): FilterSelectOption[] {
  let crossoverCount = 0;
  let intelCount = 0;
  let exploitCount = 0;
  let repeatCount = 0;
  const classCounts = new Map<string, number>();

  for (const actor of actors) {
    if (actor.totalOrigin200s > 0) crossoverCount += 1;
    if (safeParseJson<string[]>(actor.intelTagsJson, []).length > 0) intelCount += 1;
    if (actorHasExploitProbePaths(actor)) exploitCount += 1;
    if (actor.runsSeen >= 2) repeatCount += 1;

    const cls = (actor.latestClassification ?? '').trim().toUpperCase();
    if (cls) {
      classCounts.set(cls, (classCounts.get(cls) ?? 0) + 1);
    }
  }

  const options: FilterSelectOption[] = [
    { value: 'ALL', label: `All Vectors (${actors.length})` },
    { value: 'ORIGIN_CROSSOVER', label: `Origin 200 Crossover (${crossoverCount})` },
    { value: 'INTEL_TAGGED', label: `CF Intel Tagged (${intelCount})` },
    { value: 'EXPLOIT_PROBES', label: `Exploit Probes (${exploitCount})` },
    { value: 'REPEAT_OFFENDER', label: `Repeat Offender 2+ Runs (${repeatCount})` },
  ];

  const sortedClasses = Array.from(classCounts.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  for (const [cls, count] of sortedClasses) {
    options.push({
      value: `CLASS:${cls}`,
      label: `Class: ${formatEnumLabel(cls)} (${count})`,
    });
  }

  return options;
}

/**
 * Builds country/geo filter dropdown options for Recurring External Threat Actors.
 */
export function buildActorCountryOptions(actors: ThreatActorRow[]): FilterSelectOption[] {
  let nonUsCount = 0;
  let usCount = 0;
  let unknownCount = 0;
  const countryCounts = new Map<string, number>();

  for (const actor of actors) {
    const code = (actor.country ?? '').trim().toUpperCase();
    if (!code) {
      unknownCount += 1;
      continue;
    }
    if (code === 'US') {
      usCount += 1;
    } else {
      nonUsCount += 1;
      countryCounts.set(code, (countryCounts.get(code) ?? 0) + 1);
    }
  }

  const options: FilterSelectOption[] = [
    { value: 'ALL', label: `All Countries (${actors.length})` },
    { value: 'NON_US', label: `Non-US Traffic (${nonUsCount})` },
    { value: 'US', label: `US Only (${usCount})` },
  ];

  const sortedCountries = Array.from(countryCounts.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  for (const [code, count] of sortedCountries) {
    options.push({
      value: code,
      label: `${code} (${count})`,
    });
  }

  if (unknownCount > 0) {
    options.push({
      value: 'UNKNOWN',
      label: `Unknown Geo (${unknownCount})`,
    });
  }

  return options;
}

/**
 * Filters Gemini external attack campaigns by target domain and severity.
 */
export function filterExternalCampaigns(
  campaigns: GeminiCampaignDto[],
  filters: ExternalCampaignFilters
): GeminiCampaignDto[] {
  return campaigns.filter(
    (camp) =>
      matchesDomainFilter(camp.targetHosts, filters.domain) &&
      matchesSeverityFilter(camp.severity, filters.severity)
  );
}
