import { classifyFindingSurface, safeParseJson } from './threat-utils';
import { evaluateActorWafCoverage, evaluateFindingWafCoverage } from './waf-coverage';
import type {
  CfWafRuleDto,
  CollectorStatuses,
  ThreatActorRow,
  ThreatAuditRunRow,
  ThreatFindingRow,
} from './types';

export const INFRA_OUTAGE_RULE_IDS = new Set([
  'TUNNEL_DEGRADED',
  'UNIFI_DEVICE_OFFLINE',
]);

export interface CollectorOutageItem {
  collector: 'cloudflare' | 'unifi' | 'wshAuth';
  label: string;
  surface: 'external' | 'internal';
  status: string;
}

export interface ActionableSecuritySummary {
  totalActionable: number;
  externalCount: number;
  internalCount: number;
  actionableFindings: ThreatFindingRow[];
  actionableExternalFindings: ThreatFindingRow[];
  actionableInternalFindings: ThreatFindingRow[];
  informationalOrResolvedFindings: ThreatFindingRow[];
  actionableActors: ThreatActorRow[];
  deduplicatedActionableActors: ThreatActorRow[];
  backgroundNoiseActors: ThreatActorRow[];
  collectorOutages: CollectorOutageItem[];
  isAiOnlyDegraded: boolean;
  sidebarBadge: { count: number; severity: 'error' | 'warning' | null };
}

/**
 * Returns normalized disposition for a ThreatFindingRow (defaults legacy rows to 'ACTIVE').
 */
export function getFindingDisposition(finding: ThreatFindingRow): string {
  const raw = (finding.disposition || 'ACTIVE').trim().toUpperCase();
  if (raw === 'RESOLVED' || raw === 'SNOOZED' || raw === 'DISMISSED') {
    return raw;
  }
  return 'ACTIVE';
}

/**
 * Returns true if the finding represents a real infrastructure availability outage.
 */
export function isInfraOutageFinding(finding: ThreatFindingRow): boolean {
  return INFRA_OUTAGE_RULE_IDS.has((finding.ruleId || '').trim().toUpperCase());
}

/**
 * Single source of truth for whether a finding requires operator action or raises security badges.
 * Excludes resolved/snoozed/dismissed items, LOW/MEDIUM scanner noise, and WAF-covered edge hits.
 */
export function isFindingActionable(
  finding: ThreatFindingRow,
  wafRules: CfWafRuleDto[] = []
): boolean {
  if (getFindingDisposition(finding) !== 'ACTIVE') {
    return false;
  }
  const sev = (finding.severity || '').trim().toUpperCase();
  const highOrCritical = sev === 'HIGH' || sev === 'CRITICAL';
  const isOutage = isInfraOutageFinding(finding);
  if (!highOrCritical && !isOutage) {
    return false;
  }

  if (classifyFindingSurface(finding.sourceLayer) === 'external' && wafRules.length > 0) {
    // Origin 200/302 breaches reached the origin server even if edge rules exist — never suppress them.
    const ruleUpper = (finding.ruleId || '').trim().toUpperCase();
    if (ruleUpper !== 'ORIGIN_BREACH_THROUGH' && ruleUpper !== 'ZT_UNEXPECTED_ACCESS') {
      const cov = evaluateFindingWafCoverage(finding, wafRules);
      if (cov.status === 'COVERED') {
        return false;
      }
    }
  }

  return true;
}

/**
 * Single source of truth for whether a recurring threat actor requires operator attention.
 */
export function isActorActionable(
  actor: ThreatActorRow,
  wafRules: CfWafRuleDto[] = []
): boolean {
  if ((actor.disposition || '').trim().toUpperCase() !== 'ACTIVE') {
    return false;
  }
  const cls = (actor.latestClassification || '').trim().toUpperCase();
  const hasOriginBreach = (actor.totalOrigin200s ?? 0) > 0;
  if (cls === 'BENIGN_CRAWLER' && !hasOriginBreach) {
    return false;
  }

  const sev = (actor.highestSeverity || '').trim().toUpperCase();
  const highOrCritical = sev === 'HIGH' || sev === 'CRITICAL';
  if (!highOrCritical && !hasOriginBreach) {
    return false;
  }

  // Only suppress WAF-covered actors when zero origin breaches occurred.
  if (!hasOriginBreach && wafRules.length > 0) {
    const cov = evaluateActorWafCoverage(actor, wafRules);
    if (cov.status === 'COVERED') {
      return false;
    }
  }

  return true;
}

/**
 * Extracts real configured collector outages (Error / Offline) while ignoring Not Configured and AI-only timeouts.
 */
export function getCollectorOutages(
  latestRun: ThreatAuditRunRow | null | undefined
): CollectorOutageItem[] {
  if (!latestRun?.collectorStatusesJson) {
    return [];
  }
  const statuses = safeParseJson<Partial<CollectorStatuses>>(
    latestRun.collectorStatusesJson,
    {}
  );
  const candidates: Array<{
    collector: 'cloudflare' | 'unifi' | 'wshAuth';
    label: string;
    surface: 'external' | 'internal';
    raw: string | undefined;
  }> = [
    {
      collector: 'cloudflare',
      label: 'Cloudflare Collector',
      surface: 'external',
      raw: statuses.cloudflare,
    },
    {
      collector: 'unifi',
      label: 'UniFi CloudKey Collector',
      surface: 'internal',
      raw: statuses.unifi,
    },
    {
      collector: 'wshAuth',
      label: 'WSH / PanoramaAuth Collector',
      surface: 'internal',
      raw: statuses.wshAuth,
    },
  ];

  const outages: CollectorOutageItem[] = [];
  for (const c of candidates) {
    const val = (c.raw || '').trim();
    const low = val.toLowerCase();
    if (low.startsWith('error') || low.startsWith('offline')) {
      outages.push({
        collector: c.collector,
        label: c.label,
        surface: c.surface,
        status: val,
      });
    }
  }
  return outages;
}

/**
 * Computes canonical actionable counts, deduplicated badges, and noise separation across Sidebar, Overview, External, and Internal tabs.
 */
export function computeActionableSecuritySummary(input: {
  latestRun: ThreatAuditRunRow | null | undefined;
  findings: ThreatFindingRow[];
  actors: ThreatActorRow[];
  wafRules: CfWafRuleDto[];
}): ActionableSecuritySummary {
  const { latestRun, findings, actors, wafRules } = input;

  const actionableFindings: ThreatFindingRow[] = [];
  const actionableExternalFindings: ThreatFindingRow[] = [];
  const actionableInternalFindings: ThreatFindingRow[] = [];
  const informationalOrResolvedFindings: ThreatFindingRow[] = [];

  const externalFindingIps = new Set<string>();

  for (const f of findings) {
    if (isFindingActionable(f, wafRules)) {
      actionableFindings.push(f);
      if (classifyFindingSurface(f.sourceLayer) === 'external') {
        actionableExternalFindings.push(f);
        const ip = (f.actorIp || '').trim().toLowerCase();
        if (ip) externalFindingIps.add(ip);
      } else {
        actionableInternalFindings.push(f);
      }
    } else {
      informationalOrResolvedFindings.push(f);
    }
  }

  const actionableActors: ThreatActorRow[] = [];
  const deduplicatedActionableActors: ThreatActorRow[] = [];
  const backgroundNoiseActors: ThreatActorRow[] = [];

  for (const actor of actors) {
    const disp = (actor.disposition || '').trim().toUpperCase();
    if (isActorActionable(actor, wafRules)) {
      actionableActors.push(actor);
      const ipKey = (actor.ipAddress || actor.id || '').trim().toLowerCase();
      if (!ipKey || !externalFindingIps.has(ipKey)) {
        deduplicatedActionableActors.push(actor);
      }
    } else if (disp === 'ACTIVE') {
      backgroundNoiseActors.push(actor);
    }
  }

  const collectorOutages = getCollectorOutages(latestRun);
  const externalOutageCount = collectorOutages.filter((o) => o.surface === 'external').length;
  const internalOutageCount = collectorOutages.filter((o) => o.surface === 'internal').length;

  const externalCount =
    actionableExternalFindings.length + deduplicatedActionableActors.length + externalOutageCount;
  const internalCount = actionableInternalFindings.length + internalOutageCount;
  const totalActionable = externalCount + internalCount;

  const errLow = (latestRun?.errorMessage || '').toLowerCase();
  const isAiOnlyDegraded =
    (latestRun?.status || '').trim().toUpperCase() === 'DEGRADED' &&
    collectorOutages.length === 0 &&
    (errLow.includes('carbon') ||
      errLow.includes('neon') ||
      errLow.includes('gemini') ||
      errLow.includes('stage 1') ||
      errLow.includes('stage 2'));

  const verdictUpper = (latestRun?.intrusionVerdict || '').trim().toUpperCase();
  const hasExplicitIntrusionVerdict =
    verdictUpper === 'LIKELY_INTRUSION' ||
    verdictUpper === 'LIKELY_COMPROMISE' ||
    verdictUpper === 'CONFIRMED_COMPROMISE';

  let sidebarBadge: { count: number; severity: 'error' | 'warning' | null };
  if (totalActionable > 0) {
    sidebarBadge = { count: totalActionable, severity: 'error' };
  } else if (hasExplicitIntrusionVerdict && findings.length === 0 && actors.length === 0) {
    sidebarBadge = { count: 1, severity: 'error' };
  } else {
    sidebarBadge = { count: 0, severity: null };
  }

  return {
    totalActionable,
    externalCount,
    internalCount,
    actionableFindings,
    actionableExternalFindings,
    actionableInternalFindings,
    informationalOrResolvedFindings,
    actionableActors,
    deduplicatedActionableActors,
    backgroundNoiseActors,
    collectorOutages,
    isAiOnlyDegraded,
    sidebarBadge,
  };
}
