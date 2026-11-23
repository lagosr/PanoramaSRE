import { describe, it, expect } from 'vitest';
import {
  computeActionableSecuritySummary,
  getCollectorOutages,
  isActorActionable,
  isFindingActionable,
} from '../threat-actionability';
import type {
  CfWafRuleDto,
  ThreatActorRow,
  ThreatAuditRunRow,
  ThreatFindingRow,
} from '../types';

function makeRun(overrides: Partial<ThreatAuditRunRow> = {}): ThreatAuditRunRow {
  return {
    id: 'threat-live-1',
    startedAt: '2026-11-23T15:17:00Z',
    completedAt: '2026-11-23T15:21:00Z',
    windowStart: '2026-11-23T09:17:00Z',
    windowEnd: '2026-11-23T15:17:00Z',
    windowHours: 6,
    triggerSource: 'scheduled',
    status: 'DEGRADED',
    overallSeverity: 'HIGH',
    intrusionVerdict: 'SUSPICIOUS_ACTIVITY',
    collectorStatusesJson:
      '{"cloudflare":"Connected","unifi":"Connected","wshAuth":"Connected"}',
    errorMessage:
      'Stage 2 Carbon failed (Stage 1 retained): Gemini gemini-4-carbon timed out after 115s',
    escalatedToTier2: false,
    ...overrides,
  };
}

function makeActor(overrides: Partial<ThreatActorRow> = {}): ThreatActorRow {
  return {
    id: '2a06:98c0:3600::103',
    actorType: 'IP',
    ipAddress: '2a06:98c0:3600::103',
    asn: '13335',
    asOrg: 'Cloudflare, Inc.',
    country: 'RU',
    intelTagsJson: '[]',
    intelSummary: null,
    firstSeenAt: '2026-11-22T20:00:00Z',
    lastSeenAt: '2026-11-23T15:15:00Z',
    runsSeen: 4,
    totalRequests: 155,
    totalOrigin200s: 0,
    highestSeverity: 'MEDIUM',
    latestClassification: 'OPPORTUNISTIC_SCANNER',
    targetHostsJson: '["parakith.com"]',
    samplePathsJson: '["/wp-admin/install.php"]',
    disposition: 'ACTIVE',
    ...overrides,
  };
}

function makeFinding(overrides: Partial<ThreatFindingRow> = {}): ThreatFindingRow {
  return {
    id: 'f-1',
    runId: 'threat-live-1',
    sourceLayer: 'UNIFI',
    ruleId: 'UNIFI_ROGUE_LAN_CLIENT',
    severity: 'LOW',
    category: 'ZERO_TRUST',
    title: 'Unknown LAN Device Detected: Drake phone',
    summary: 'MAC C4:EF:3D:56:9C:07 on Kid Safe (VLAN 100)',
    host: 'Kid Safe (VLAN 100)',
    actorIp: '172.16.1.37',
    actorAsn: null,
    rayIdsJson: '[]',
    evidenceJson: '{"macAddress":"C4:EF:3D:56:9C:07"}',
    createdAt: '2026-11-23T15:17:10Z',
    disposition: 'ACTIVE',
    ...overrides,
  };
}

const WSH_NON_US_WAF_RULE: CfWafRuleDto = {
  id: 'waf-wsh-nonus',
  zoneId: 'zone-pan',
  zoneName: 'panoramadr.com',
  description: 'Block non US from WSH',
  action: 'block',
  expression: '(http.host eq "wsh.panoramadr.com" and ip.geoip.country ne "US")',
  enabled: true,
  source: 'cloudflare_live',
};

describe('threat-actionability', () => {
  it('suppresses real-world low/medium scanner noise, benign crawlers, WAF-covered actors, isolated Kid phones, and AI Carbon timeouts to 0 badge', () => {
    const wpScanners = Array.from({ length: 10 }, (_, idx) =>
      makeActor({
        id: `198.51.100.${idx + 1}`,
        ipAddress: `198.51.100.${idx + 1}`,
        highestSeverity: 'MEDIUM',
        latestClassification: 'OPPORTUNISTIC_SCANNER',
      })
    );
    const benignCrawler = makeActor({
      id: '3.87.76.163',
      ipAddress: '3.87.76.163',
      highestSeverity: 'LOW',
      latestClassification: 'BENIGN_CRAWLER',
      samplePathsJson: '["/"]',
    });
    const tencentCovered = [
      makeActor({
        id: '43.157.175.122',
        ipAddress: '43.157.175.122',
        country: 'BR',
        highestSeverity: 'HIGH',
        latestClassification: 'TARGETED_RECON',
        targetHostsJson: '["wsh.panoramadr.com"]',
        samplePathsJson: '["/"]',
      }),
      makeActor({
        id: '43.134.23.177',
        ipAddress: '43.134.23.177',
        country: 'SG',
        highestSeverity: 'MEDIUM',
        latestClassification: 'TARGETED_RECON',
        targetHostsJson: '["wsh.panoramadr.com"]',
        samplePathsJson: '["/"]',
      }),
      makeActor({
        id: '129.226.146.146',
        ipAddress: '129.226.146.146',
        country: 'SG',
        highestSeverity: 'MEDIUM',
        latestClassification: 'TARGETED_RECON',
        targetHostsJson: '["wsh.panoramadr.com"]',
        samplePathsJson: '["/"]',
      }),
    ];
    const singleProbes = [
      makeActor({
        id: '54.211.224.47',
        ipAddress: '54.211.224.47',
        country: 'US',
        highestSeverity: 'LOW',
        totalRequests: 1,
        targetHostsJson: '["wsh.panoramadr.com"]',
        samplePathsJson: '["/"]',
      }),
      makeActor({
        id: '78.135.96.195',
        ipAddress: '78.135.96.195',
        country: 'TR',
        highestSeverity: 'LOW',
        totalRequests: 1,
        targetHostsJson: '["panoramadr.com"]',
        samplePathsJson: '["/"]',
      }),
    ];

    const actors = [...wpScanners, benignCrawler, ...tencentCovered, ...singleProbes];
    const drakePhoneFinding = makeFinding();

    const summary = computeActionableSecuritySummary({
      latestRun: makeRun(),
      findings: [drakePhoneFinding],
      actors,
      wafRules: [WSH_NON_US_WAF_RULE],
    });

    expect(summary.totalActionable).toBe(0);
    expect(summary.externalCount).toBe(0);
    expect(summary.internalCount).toBe(0);
    expect(summary.sidebarBadge).toEqual({ count: 0, severity: null });
    expect(summary.isAiOnlyDegraded).toBe(true);
    expect(summary.backgroundNoiseActors.length).toBe(16);
    expect(summary.informationalOrResolvedFindings).toHaveLength(1);
  });

  it('surfaces real HIGH/CRITICAL breaches, privileged unknown MACs, and collector/tunnel outages with IP deduplication', () => {
    const breachActor = makeActor({
      id: '45.55.1.10',
      ipAddress: '45.55.1.10',
      country: 'BR',
      highestSeverity: 'HIGH',
      totalOrigin200s: 3,
      latestClassification: 'EXPLOIT_ATTEMPT',
      targetHostsJson: '["wsh.panoramadr.com"]',
    });
    const standaloneHighActor = makeActor({
      id: '91.99.88.77',
      ipAddress: '91.99.88.77',
      country: 'RU',
      highestSeverity: 'HIGH',
      totalOrigin200s: 0,
      latestClassification: 'CREDENTIAL_ABUSE',
      targetHostsJson: '["panoramadr.com"]',
    });

    const originBreachFinding = makeFinding({
      id: 'f-origin',
      sourceLayer: 'CLOUDFLARE',
      ruleId: 'ORIGIN_BREACH_THROUGH',
      severity: 'HIGH',
      host: 'wsh.panoramadr.com',
      actorIp: '45.55.1.10',
    });
    const privilegedMacFinding = makeFinding({
      id: 'f-priv-mac',
      sourceLayer: 'UNIFI',
      ruleId: 'UNIFI_ROGUE_LAN_CLIENT',
      severity: 'HIGH',
      host: 'Internal (VLAN 1)',
      actorIp: '10.10.1.99',
    });
    const tunnelDownFinding = makeFinding({
      id: 'f-tunnel',
      sourceLayer: 'CLOUDFLARE',
      ruleId: 'TUNNEL_DEGRADED',
      severity: 'MEDIUM',
      host: 'wsh.panoramadr.com',
      actorIp: null,
    });

    const runWithOutage = makeRun({
      status: 'DEGRADED',
      collectorStatusesJson:
        '{"cloudflare":"Connected","unifi":"Offline: connection refused","wshAuth":"Connected"}',
    });

    const summary = computeActionableSecuritySummary({
      latestRun: runWithOutage,
      findings: [originBreachFinding, privilegedMacFinding, tunnelDownFinding],
      actors: [breachActor, standaloneHighActor],
      wafRules: [WSH_NON_US_WAF_RULE],
    });

    // External: originBreachFinding (even though WAF exists, ORIGIN_BREACH_THROUGH is never suppressed)
    // + tunnelDownFinding + standaloneHighActor (breachActor IP 45.55.1.10 deduplicated!) = 3
    expect(summary.externalCount).toBe(3);
    // Internal: privilegedMacFinding + unifi collector offline = 2 (no newUnknownLanMacs double-count!)
    expect(summary.internalCount).toBe(2);
    expect(summary.totalActionable).toBe(5);
    expect(summary.sidebarBadge).toEqual({ count: 5, severity: 'error' });
    expect(summary.isAiOnlyDegraded).toBe(false);
    expect(getCollectorOutages(runWithOutage)).toHaveLength(1);
  });

  it('clears actionable flags immediately when a finding is marked RESOLVED, SNOOZED, or DISMISSED', () => {
    const activeHigh = makeFinding({
      id: 'f-high',
      severity: 'HIGH',
      disposition: 'ACTIVE',
    });
    expect(isFindingActionable(activeHigh)).toBe(true);
    expect(isFindingActionable({ ...activeHigh, disposition: 'RESOLVED' })).toBe(false);
    expect(isFindingActionable({ ...activeHigh, disposition: 'SNOOZED' })).toBe(false);
    expect(isFindingActionable({ ...activeHigh, disposition: 'DISMISSED' })).toBe(false);

    const benign = makeActor({
      latestClassification: 'BENIGN_CRAWLER',
      highestSeverity: 'LOW',
      totalOrigin200s: 0,
    });
    expect(isActorActionable(benign)).toBe(false);
  });
});
