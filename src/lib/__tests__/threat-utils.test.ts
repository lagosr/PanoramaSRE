import { describe, it, expect } from 'vitest';
import {
  buildCloudflareSecurityEventsUrl,
  buildCloudflareZeroTrustLogsUrl,
  buildUnifiConsoleUrl,
  buildWafRuleExpression,
  collectorStatusToBadgeVariant,
  computeThreatSidebarBadge,
  filterThreatActors,
  formatCompactBytes,
  safeParseJson,
  severityToBadgeVariant,
  verdictToBadgeVariant,
} from '../threat-utils';
import type { ThreatActorRow, ThreatAuditRunRow } from '../types';

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
      'https://ui.panoramadr.com/network/default/security/insights'
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
});
