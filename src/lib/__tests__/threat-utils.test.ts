import { describe, it, expect } from 'vitest';
import {
  buildActorCountryOptions,
  buildActorVectorOptions,
  buildCloudflareSecurityEventsUrl,
  buildCloudflareZeroTrustLogsUrl,
  buildDomainFilterOptions,
  buildExternalFindingVectorOptions,
  buildSeverityFilterOptions,
  buildUnifiConsoleUrl,
  buildWafRuleExpression,
  classifyActionSurface,
  classifyAllowlistSurface,
  classifyCampaignSurface,
  classifyFindingSurface,
  classifyFindingVector,
  collectorStatusToBadgeVariant,
  computeThreatSidebarBadge,
  extractRootZone,
  filterExternalCampaigns,
  filterExternalFindings,
  filterLanClients,
  filterThreatActors,
  formatCompactBytes,
  formatSnoozeRemaining,
  matchesDomainFilter,
  matchesSeverityFilter,
  normalizeHostname,
  safeParseJson,
  severityToBadgeVariant,
  verdictToBadgeVariant,
} from '../threat-utils';
import type {
  GeminiCampaignDto,
  LanClientBaselineRow,
  ThreatActorRow,
  ThreatAuditRunRow,
  ThreatFindingRow,
} from '../types';

function makeRun(overrides: Partial<ThreatAuditRunRow> = {}): ThreatAuditRunRow {
  return {
    id: 'threat-1',
    startedAt: '2026-11-22T12:00:00Z',
    completedAt: '2026-11-22T12:00:10Z',
    windowStart: '2026-11-22T06:00:00Z',
    windowEnd: '2026-11-22T12:00:00Z',
    windowHours: 6,
    triggerSource: 'scheduled',
    status: 'COMPLETED',
    overallSeverity: 'LOW',
    intrusionVerdict: 'NO_EVIDENCE',
    escalatedToTier2: false,
    ...overrides,
  };
}

function makeActor(overrides: Partial<ThreatActorRow> = {}): ThreatActorRow {
  return {
    id: '198.51.100.42',
    actorType: 'IP',
    ipAddress: '198.51.100.42',
    asn: 'AS4134',
    asOrg: 'Chinanet Backbone',
    country: 'CN',
    intelTagsJson: '["scanner"]',
    intelSummary: 'Known automated scanner',
    firstSeenAt: '2026-11-21T00:00:00Z',
    lastSeenAt: '2026-11-22T11:55:00Z',
    runsSeen: 3,
    totalRequests: 480,
    totalOrigin200s: 0,
    highestSeverity: 'MEDIUM',
    latestClassification: 'OPPORTUNISTIC_SCANNER',
    targetHostsJson: '["panoramadr.com"]',
    samplePathsJson: '["/.env","/wp-login.php"]',
    disposition: 'ACTIVE',
    ...overrides,
  };
}

describe('threat-utils', () => {
  it('builds Cloudflare WAF custom rule expressions cleanly for IPs, ASNs, and combinations', () => {
    expect(buildWafRuleExpression([])).toBe('');
    expect(buildWafRuleExpression([' ', '   '], ['not-digits'])).toBe('');
    expect(buildWafRuleExpression(['203.0.113.5'])).toBe('(ip.src in {203.0.113.5})');
    expect(
      buildWafRuleExpression(['203.0.113.5', '198.51.100.8', '203.0.113.5'])
    ).toBe('(ip.src in {203.0.113.5 198.51.100.8})');
    expect(buildWafRuleExpression([], ['AS4134', '14061', 'as4134'])).toBe(
      '(ip.geoip.asnum in {4134 14061})'
    );
    expect(buildWafRuleExpression(['203.0.113.5'], ['AS4134'])).toBe(
      '(ip.src in {203.0.113.5} or ip.geoip.asnum in {4134})'
    );
  });

  it('builds valid Cloudflare and UniFi dashboard deep-links', () => {
    expect(buildCloudflareSecurityEventsUrl('', 'panoramadr.com')).toBe(
      'https://dash.cloudflare.com/'
    );
    expect(
      buildCloudflareSecurityEventsUrl('fb9fa6bffe4bdd6f885a0ae85d8385db', 'panoramadr.com')
    ).toBe('https://dash.cloudflare.com/fb9fa6bffe4bdd6f885a0ae85d8385db/panoramadr.com/security/events');
    expect(
      buildCloudflareSecurityEventsUrl('acct1', 'parakith.com', '198.51.100.42')
    ).toBe('https://dash.cloudflare.com/acct1/parakith.com/security/events?ip=198.51.100.42');

    expect(buildCloudflareZeroTrustLogsUrl('')).toBe('https://one.dash.cloudflare.com/');
    expect(buildCloudflareZeroTrustLogsUrl('acct1')).toBe(
      'https://one.dash.cloudflare.com/acct1/logs/access'
    );

    expect(buildUnifiConsoleUrl('https://ui.panoramadr.com/')).toBe(
      'https://ui.panoramadr.com/network/default/dashboard'
    );
    expect(buildUnifiConsoleUrl('https://ui.panoramadr.com', 'clients')).toBe(
      'https://ui.panoramadr.com/network/default/clients'
    );
    expect(buildUnifiConsoleUrl(undefined, 'threats')).toBe(
      'https://ui.panoramadr.com/network/default/flows'
    );
    expect(buildUnifiConsoleUrl('https://ui.panoramadr.com', 'policies')).toBe(
      'https://ui.panoramadr.com/network/default/settings/security'
    );
  });

  it('computes SidebarRail threat alert badge count and severity accurately', () => {
    expect(computeThreatSidebarBadge(null, 5)).toEqual({ count: 0, severity: null });
    expect(
      computeThreatSidebarBadge(
        makeRun({ overallSeverity: 'LOW', intrusionVerdict: 'NO_EVIDENCE' }),
        3
      )
    ).toEqual({ count: 0, severity: null });

    expect(
      computeThreatSidebarBadge(
        makeRun({ overallSeverity: 'MEDIUM', intrusionVerdict: 'NO_EVIDENCE' }),
        2
      )
    ).toEqual({ count: 2, severity: 'warning' });

    expect(
      computeThreatSidebarBadge(
        makeRun({ overallSeverity: 'HIGH', intrusionVerdict: 'SUSPICIOUS_ACTIVITY' }),
        0
      )
    ).toEqual({ count: 1, severity: 'error' });

    expect(
      computeThreatSidebarBadge(
        makeRun({ overallSeverity: 'LOW', intrusionVerdict: 'LIKELY_INTRUSION' }),
        4
      )
    ).toEqual({ count: 4, severity: 'error' });

    expect(
      computeThreatSidebarBadge(
        makeRun({ overallSeverity: 'LOW', intrusionVerdict: 'LIKELY_COMPROMISE' }),
        2
      )
    ).toEqual({ count: 2, severity: 'error' });
  });

  it('filters threat actors by disposition and free-text query across IP, ASN, org, host, and paths', () => {
    const actors = [
      makeActor({
        id: '198.51.100.42',
        ipAddress: '198.51.100.42',
        asn: 'AS4134',
        asOrg: 'Chinanet',
        disposition: 'ACTIVE',
      }),
      makeActor({
        id: '203.0.113.99',
        ipAddress: '203.0.113.99',
        asn: 'AS13335',
        asOrg: 'Cloudflare Warp',
        targetHostsJson: '["wsh.panoramadr.com"]',
        disposition: 'ALLOWLISTED',
      }),
      makeActor({
        id: '192.0.2.77',
        ipAddress: '192.0.2.77',
        asn: 'AS14061',
        asOrg: 'DigitalOcean',
        latestClassification: 'CREDENTIAL_ABUSE',
        disposition: 'RESOLVED',
      }),
    ];

    expect(filterThreatActors(actors, '', 'ACTIVE')).toHaveLength(1);
    expect(filterThreatActors(actors, '', 'ALL')).toHaveLength(3);
    expect(filterThreatActors(actors, '4134', 'ALL').map((a) => a.id)).toEqual(['198.51.100.42']);
    expect(filterThreatActors(actors, 'wsh.panoramadr.com', 'ALLOWLISTED').map((a) => a.id)).toEqual([
      '203.0.113.99',
    ]);
    expect(filterThreatActors(actors, 'CREDENTIAL_ABUSE', 'ALL').map((a) => a.id)).toEqual([
      '192.0.2.77',
    ]);
  });

  it('handles JSON parsing fallbacks, badge variants, and compact byte formatting safely', () => {
    expect(safeParseJson<{ a: number }>('{"a":42}', { a: 0 })).toEqual({ a: 42 });
    expect(safeParseJson<string[]>('not json{', ['fallback'])).toEqual(['fallback']);
    expect(safeParseJson<string[] | null>(null, null)).toBeNull();

    expect(severityToBadgeVariant('CRITICAL')).toBe('danger');
    expect(severityToBadgeVariant('MEDIUM')).toBe('warning');
    expect(severityToBadgeVariant('LOW')).toBe('info');

    expect(verdictToBadgeVariant('CONFIRMED_COMPROMISE')).toBe('danger');
    expect(verdictToBadgeVariant('LIKELY_COMPROMISE')).toBe('danger');
    expect(verdictToBadgeVariant('SUSPICIOUS_ACTIVITY')).toBe('warning');
    expect(verdictToBadgeVariant('NO_EVIDENCE')).toBe('success');

    expect(collectorStatusToBadgeVariant('Connected')).toBe('success');
    expect(collectorStatusToBadgeVariant('Not Configured')).toBe('warning');
    expect(collectorStatusToBadgeVariant('Offline: timeout')).toBe('danger');

    expect(formatCompactBytes(0)).toBe('0 B');
    expect(formatCompactBytes(2048)).toBe('2.0 KB');
    expect(formatCompactBytes(15 * 1024 * 1024)).toBe('15 MB');
  });

  it('classifies external, internal, and crossover surfaces accurately and filters LAN clients', () => {
    expect(classifyFindingSurface('CLOUDFLARE')).toBe('external');
    expect(classifyFindingSurface('ZERO_TRUST')).toBe('external');
    expect(classifyFindingSurface('UNIFI')).toBe('internal');
    expect(classifyFindingSurface('WSH')).toBe('internal');
    expect(classifyFindingSurface('PANORAMA_AUTH')).toBe('internal');

    expect(classifyActionSurface('CLOUDFLARE_WAF')).toBe('external');
    expect(classifyActionSurface('ZERO_TRUST_ACCESS')).toBe('external');
    expect(classifyActionSurface('UNIFI_NETWORK')).toBe('internal');
    expect(classifyActionSurface('ORIGIN_WSH')).toBe('internal');
    expect(classifyActionSurface('ALLOWLIST')).toBe('crossover');

    expect(classifyAllowlistSurface('IP')).toBe('external');
    expect(classifyAllowlistSurface('CIDR')).toBe('external');
    expect(classifyAllowlistSurface('ASN')).toBe('external');
    expect(classifyAllowlistSurface('EMAIL')).toBe('external');
    expect(classifyAllowlistSurface('LAN_MAC')).toBe('internal');
    expect(classifyAllowlistSurface('SSH_KEY')).toBe('internal');

    const lan: LanClientBaselineRow[] = [
      {
        macAddress: 'AA:BB:CC:11:22:33',
        ipAddress: '10.10.20.9',
        hostname: 'solar-assistant',
        networkVlan: 'IoT',
        ouiVendor: 'Raspberry Pi',
        firstSeenAt: '2026-11-22T00:00:00Z',
        lastSeenAt: '2026-11-22T12:00:00Z',
        isTrusted: false,
        label: 'Solar Assistant',
      },
      {
        macAddress: 'DD:EE:FF:44:55:66',
        ipAddress: '172.25.25.5',
        hostname: 'wsh',
        networkVlan: 'Servers',
        ouiVendor: 'Raspberry Pi',
        firstSeenAt: '2026-11-22T00:00:00Z',
        lastSeenAt: '2026-11-22T12:00:00Z',
        isTrusted: true,
        label: 'WSH',
      },
    ];

    expect(filterLanClients(lan, '', 'ALL')).toHaveLength(2);
    expect(filterLanClients(lan, '', 'TRUSTED').map((c) => c.hostname)).toEqual(['wsh']);
    expect(filterLanClients(lan, '', 'UNREVIEWED').map((c) => c.hostname)).toEqual([
      'solar-assistant',
    ]);
    expect(filterLanClients(lan, '10.10.20', 'ALL').map((c) => c.macAddress)).toEqual([
      'AA:BB:CC:11:22:33',
    ]);
    expect(filterLanClients(lan, 'DD:EE:FF', 'TRUSTED')).toHaveLength(1);
  });

  it('normalizes hostnames, builds deduplicated domain options, and matches zone vs exact hosts', () => {
    expect(normalizeHostname('HTTPS://WSH.PanoramaDR.com:443/api/health.')).toBe('wsh.panoramadr.com');
    expect(extractRootZone('wsh.panoramadr.com', ['panoramadr.com', 'parakith.com'])).toBe(
      'panoramadr.com'
    );
    expect(extractRootZone('sub.customzone.io')).toBe('customzone.io');

    const hostsList = [
      ['panoramadr.com', 'wsh.panoramadr.com'],
      ['panoramadr.com'],
      ['parakith.com'],
      [],
    ];
    const domainOpts = buildDomainFilterOptions(hostsList, ['panoramadr.com', 'parakith.com']);
    expect(domainOpts.map((o) => o.value)).toEqual([
      'ALL',
      'zone:panoramadr.com',
      'zone:parakith.com',
      'host:panoramadr.com',
      'host:wsh.panoramadr.com',
      'NONE',
    ]);
    expect(domainOpts.find((o) => o.value === 'zone:panoramadr.com')?.label).toBe(
      'panoramadr.com (Zone) (2)'
    );
    expect(domainOpts.find((o) => o.value === 'NONE')?.label).toBe('Account-Wide / No Host (1)');

    expect(matchesDomainFilter(['panoramadr.com'], 'zone:panoramadr.com')).toBe(true);
    expect(matchesDomainFilter(['wsh.panoramadr.com'], 'zone:panoramadr.com')).toBe(true);
    expect(matchesDomainFilter(['panoramadr.com'], 'host:wsh.panoramadr.com')).toBe(false);
    expect(matchesDomainFilter(['wsh.panoramadr.com'], 'host:wsh.panoramadr.com')).toBe(true);
    expect(matchesDomainFilter([], 'NONE')).toBe(true);
    expect(matchesDomainFilter(['parakith.com'], 'NONE')).toBe(false);
  });

  it('filters Cloudflare external findings by domain, severity, vector, and search query', () => {
    const makeFinding = (overrides: Partial<ThreatFindingRow> = {}): ThreatFindingRow => ({
      id: 'f-1',
      runId: 'run-1',
      sourceLayer: 'CLOUDFLARE',
      ruleId: 'SECRET_EXPLOIT_PROBE',
      severity: 'MEDIUM',
      category: 'HTTP_ATTACK',
      title: 'Automated Secret/Exploit Probing',
      summary: 'Probed /.env',
      host: 'parakith.com',
      actorIp: '198.51.100.10',
      actorAsn: 'AS14061',
      rayIdsJson: '["ray-111"]',
      evidenceJson: '{}',
      createdAt: '2026-11-22T12:00:00Z',
      ...overrides,
    });

    const findings: ThreatFindingRow[] = [
      makeFinding({ id: 'f-origin', ruleId: 'ORIGIN_BREACH_THROUGH', severity: 'HIGH', category: 'ORIGIN_BREACH', host: 'wsh.panoramadr.com', rayIdsJson: '["ray-origin"]' }),
      makeFinding({ id: 'f-probe', ruleId: 'SECRET_EXPLOIT_PROBE', severity: 'MEDIUM', category: 'HTTP_ATTACK', host: 'parakith.com' }),
      makeFinding({ id: 'f-intel', ruleId: 'MALICIOUS_INTEL_HIT', severity: 'CRITICAL', category: 'HTTP_ATTACK', host: 'panoramadr.com' }),
      makeFinding({ id: 'f-zt', ruleId: 'ZT_UNEXPECTED_ACCESS', severity: 'HIGH', category: 'ZERO_TRUST', host: 'wsh.panoramadr.com' }),
      makeFinding({ id: 'f-tun', ruleId: 'TUNNEL_DEGRADED', severity: 'MEDIUM', category: 'TUNNEL', host: 'wsh.panoramadr.com' }),
      makeFinding({ id: 'f-aud', ruleId: 'CONTROL_PLANE_MUTATION', severity: 'MEDIUM', category: 'AUDIT_LOG', host: null }),
    ];

    expect(classifyFindingVector(findings[0])).toBe('ORIGIN_BREACH');
    expect(classifyFindingVector(findings[1])).toBe('EXPLOIT_PROBES');
    expect(classifyFindingVector(findings[2])).toBe('INTEL_TAGGED');
    expect(classifyFindingVector(findings[3])).toBe('ZERO_TRUST');
    expect(classifyFindingVector(findings[4])).toBe('TUNNEL');
    expect(classifyFindingVector(findings[5])).toBe('AUDIT_LOG');

    const vecOpts = buildExternalFindingVectorOptions(findings);
    expect(vecOpts.find((v) => v.value === 'ALL')?.label).toBe('All Vectors (6)');
    expect(vecOpts.find((v) => v.value === 'ORIGIN_BREACH')?.label).toBe('Origin Breach (200/302) (1)');

    expect(matchesSeverityFilter('HIGH', 'CRITICAL_HIGH')).toBe(true);
    expect(matchesSeverityFilter('CRITICAL', 'CRITICAL_HIGH')).toBe(true);
    expect(matchesSeverityFilter('MEDIUM', 'CRITICAL_HIGH')).toBe(false);

    const sevOpts = buildSeverityFilterOptions(findings.map((f) => f.severity));
    expect(sevOpts.find((s) => s.value === 'CRITICAL_HIGH')?.label).toBe('Critical & High (3)');

    expect(
      filterExternalFindings(findings, { search: '', domain: 'zone:panoramadr.com', severity: 'ALL', vector: 'ALL' }).map((f) => f.id)
    ).toEqual(['f-origin', 'f-intel', 'f-zt', 'f-tun']);
    expect(
      filterExternalFindings(findings, { search: '', domain: 'host:wsh.panoramadr.com', severity: 'CRITICAL_HIGH', vector: 'ALL' }).map((f) => f.id)
    ).toEqual(['f-origin', 'f-zt']);
    expect(
      filterExternalFindings(findings, { search: 'ray-origin', domain: 'ALL', severity: 'ALL', vector: 'ORIGIN_BREACH' }).map((f) => f.id)
    ).toEqual(['f-origin']);
    expect(
      filterExternalFindings(findings, { search: '', domain: 'NONE', severity: 'ALL', vector: 'AUDIT_LOG' }).map((f) => f.id)
    ).toEqual(['f-aud']);
  });

  it('filters external threat actors and campaigns by domain, severity, vector, and country', () => {
    const actors: ThreatActorRow[] = [
      makeActor({
        id: '198.51.100.1',
        ipAddress: '198.51.100.1',
        country: 'CN',
        highestSeverity: 'HIGH',
        totalOrigin200s: 3,
        runsSeen: 4,
        intelTagsJson: '["botnet"]',
        latestClassification: 'EXPLOIT_ATTEMPT',
        targetHostsJson: '["wsh.panoramadr.com"]',
        samplePathsJson: '["/.env","/wp-login.php"]',
      }),
      makeActor({
        id: '203.0.113.2',
        ipAddress: '203.0.113.2',
        country: 'US',
        highestSeverity: 'LOW',
        totalOrigin200s: 0,
        runsSeen: 1,
        intelTagsJson: '[]',
        latestClassification: 'BENIGN_CRAWLER',
        targetHostsJson: '["parakith.com"]',
        samplePathsJson: '["/robots.txt"]',
      }),
      makeActor({
        id: '192.0.2.3',
        ipAddress: '192.0.2.3',
        country: '',
        highestSeverity: 'CRITICAL',
        totalOrigin200s: 0,
        runsSeen: 2,
        intelTagsJson: '["scanner"]',
        latestClassification: 'TARGETED_RECON',
        targetHostsJson: '["parakith.com"]',
        samplePathsJson: '["/api/health","/wp-admin"]',
      }),
    ];

    expect(
      filterThreatActors(actors, '', 'ACTIVE', {
        domain: 'zone:panoramadr.com',
        severity: 'CRITICAL_HIGH',
        vector: 'ORIGIN_CROSSOVER',
        country: 'NON_US',
      }).map((a) => a.id)
    ).toEqual(['198.51.100.1']);

    expect(
      filterThreatActors(actors, '', 'ACTIVE', {
        vector: 'REPEAT_OFFENDER',
        country: 'UNKNOWN',
      }).map((a) => a.id)
    ).toEqual(['192.0.2.3']);

    expect(
      filterThreatActors(actors, '', 'ACTIVE', {
        vector: 'EXPLOIT_PROBES',
      }).map((a) => a.id)
    ).toEqual(['198.51.100.1', '192.0.2.3']);

    expect(
      filterThreatActors(actors, '', 'ACTIVE', {
        vector: 'CLASS:BENIGN_CRAWLER',
        country: 'US',
      }).map((a) => a.id)
    ).toEqual(['203.0.113.2']);

    const actorVecOpts = buildActorVectorOptions(actors);
    expect(actorVecOpts.find((o) => o.value === 'ORIGIN_CROSSOVER')?.label).toBe('Origin 200 Crossover (1)');
    expect(actorVecOpts.find((o) => o.value === 'CLASS:EXPLOIT_ATTEMPT')?.label).toBe(
      'Class: Exploit Attempt (1)'
    );

    const countryOpts = buildActorCountryOptions(actors);
    expect(countryOpts.map((o) => o.value)).toEqual(['ALL', 'NON_US', 'US', 'CN', 'UNKNOWN']);
    expect(countryOpts.find((o) => o.value === 'NON_US')?.label).toBe('Non-US Traffic (1)');

    const campaigns: GeminiCampaignDto[] = [
      {
        name: 'WP Recon',
        severity: 'MEDIUM',
        sourceLayers: ['CLOUDFLARE'],
        targetHosts: ['parakith.com'],
        pattern: '/wp-login.php',
        countEstimate: 120,
        sampleRayIds: ['r1'],
      },
      {
        name: 'Root Probe on WSH',
        severity: 'HIGH',
        sourceLayers: ['CLOUDFLARE'],
        targetHosts: ['wsh.panoramadr.com'],
        pattern: '/api/admin',
        countEstimate: 5,
        sampleRayIds: ['r2'],
      },
    ];
    expect(
      filterExternalCampaigns(campaigns, { domain: 'host:wsh.panoramadr.com', severity: 'CRITICAL_HIGH' }).map(
        (c) => c.name
      )
    ).toEqual(['Root Probe on WSH']);
  });

  it('routes campaigns by surface and formats snooze countdowns & SNOOZED disposition filters', () => {
    expect(
      classifyCampaignSurface({
        name: 'Unverified LAN Client Onboarding',
        severity: 'MEDIUM',
        sourceLayers: ['UNIFI'],
        targetHosts: ['Kid Safe (VLAN 100)'],
        pattern: 'MAC joined LAN',
        countEstimate: 1,
        sampleRayIds: [],
      })
    ).toBe('internal');

    expect(
      classifyCampaignSurface({
        name: 'WordPress Probing',
        severity: 'LOW',
        sourceLayers: ['CLOUDFLARE'],
        targetHosts: ['parakith.com'],
        pattern: 'wp-login',
        countEstimate: 10,
        sampleRayIds: [],
      })
    ).toBe('external');

    expect(
      classifyCampaignSurface({
        name: 'Origin Breach + SSH',
        severity: 'HIGH',
        sourceLayers: ['CLOUDFLARE', 'WSH'],
        targetHosts: ['wsh.panoramadr.com'],
        pattern: 'Origin breach',
        countEstimate: 2,
        sampleRayIds: [],
      })
    ).toBe('crossover');

    const baseNow = Date.parse('2026-11-23T12:00:00Z');
    expect(formatSnoozeRemaining('2026-11-30T12:00:00Z', baseNow)).toBe('7d left');
    expect(formatSnoozeRemaining('2026-11-23T23:00:00Z', baseNow)).toBe('11h left');
    expect(formatSnoozeRemaining('2026-11-23T12:20:00Z', baseNow)).toBe('<1h left');
    expect(formatSnoozeRemaining('2026-11-23T11:00:00Z', baseNow)).toBeNull();
    expect(formatSnoozeRemaining(null, baseNow)).toBeNull();

    const actors = [
      makeActor({ id: '1.1.1.1', disposition: 'ACTIVE' }),
      makeActor({ id: '2.2.2.2', disposition: 'SNOOZED', snoozedUntil: '2026-11-30T12:00:00Z' }),
    ];
    expect(filterThreatActors(actors, '', 'SNOOZED').map((a) => a.id)).toEqual(['2.2.2.2']);
    expect(filterThreatActors(actors, '', 'ACTIVE').map((a) => a.id)).toEqual(['1.1.1.1']);
  });
});
