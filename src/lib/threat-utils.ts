import type {
  ThreatActorRow,
  ThreatAuditRunRow,
} from './types';

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
  disposition: string
): ThreatActorRow[] {
  const dispNorm = disposition.trim().toUpperCase();
  const q = query.trim().toLowerCase();

  return actors.filter((actor) => {
    if (dispNorm && dispNorm !== 'ALL' && actor.disposition.toUpperCase() !== dispNorm) {
      return false;
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
