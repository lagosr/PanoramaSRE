import { describe, it, expect } from 'vitest';
import {
  evaluateActionWafCoverage,
  evaluateActorWafCoverage,
  evaluateCampaignWafCoverage,
  evaluateFindingWafCoverage,
  partitionExternalActions,
  parseWafRuleExpression,
  ruleMatchesPath,
} from '../waf-coverage';
import type {
  CfWafRuleDto,
  GeminiActionDto,
  GeminiCampaignDto,
  ThreatActorRow,
  ThreatFindingRow,
} from '../types';

function makeRule(overrides: Partial<CfWafRuleDto> = {}): CfWafRuleDto {
  return {
    id: 'rule-1',
    zoneId: 'z-1',
    zoneName: 'parakith.com',
    description: 'Block WP Probes',
    action: 'block',
    expression:
      '(http.host eq "parakith.com" and (http.request.uri.path contains "wp-" or http.request.uri.path contains "wlwmanifest.xml" or http.request.uri.path contains "xmlrpc.php"))',
    enabled: true,
    source: 'cloudflare_live',
    ...overrides,
  };
}

describe('waf-coverage', () => {
  it('parses wirefilter predicates and distinguishes exact vs contains paths (double-slash bypass)', () => {
    const exactOnly = parseWafRuleExpression(
      makeRule({
        expression:
          '(http.host eq "parakith.com" and (http.request.uri.path eq "/wp-admin/install.php" or http.request.uri.path eq "/xmlrpc.php"))',
      })
    );
    expect(ruleMatchesPath(exactOnly, '/wp-admin/install.php')).toBe(true);
    expect(ruleMatchesPath(exactOnly, '/xmlrpc.php')).toBe(true);
    expect(ruleMatchesPath(exactOnly, '//xmlrpc.php')).toBe(false);
    expect(ruleMatchesPath(exactOnly, '//2019/wp-includes/wlwmanifest.xml')).toBe(false);

    const containsRule = parseWafRuleExpression(makeRule());
    expect(ruleMatchesPath(containsRule, '//xmlrpc.php')).toBe(true);
    expect(ruleMatchesPath(containsRule, '//2019/wp-includes/wlwmanifest.xml')).toBe(true);
    expect(ruleMatchesPath(containsRule, '/wp-json/batch/v1')).toBe(true);
  });

  it('marks non-US WSH campaign COVERED and suppresses duplicate Add WAF action', () => {
    const wshGeoRule = makeRule({
      id: 'wsh-geo-1',
      zoneName: 'panoramadr.com',
      description: 'Block non-US WSH',
      expression: '(http.host eq "wsh.panoramadr.com" and ip.geoip.country ne "US")',
    });

    const wshCampaign: GeminiCampaignDto = {
      name: 'Non-US Probing of Strict Private Host',
      severity: 'MEDIUM',
      sourceLayers: ['CLOUDFLARE'],
      targetHosts: ['wsh.panoramadr.com'],
      pattern: 'Non-US requests from BR and SG hitting root on wsh.panoramadr.com',
      countEstimate: 4,
      sampleRayIds: ['r1'],
      suggestedWafExpression: '(http.host eq "wsh.panoramadr.com" and ip.geoip.country ne "US")',
    };

    const cov = evaluateCampaignWafCoverage(wshCampaign, [wshGeoRule]);
    expect(cov.status).toBe('COVERED');
    expect(cov.primaryRuleName).toBe('Block non-US WSH');

    const actions: GeminiActionDto[] = [
      {
        priority: 'SOON',
        surface: 'CLOUDFLARE_WAF',
        action: 'Block non-US traffic to strict private hostname wsh.panoramadr.com at the WAF edge.',
        rationale: 'Prevent non-US scanners.',
        wafRuleSnippet: '(http.host eq "wsh.panoramadr.com" and ip.geoip.country ne "US")',
      },
      {
        priority: 'MONITOR',
        surface: 'ZERO_TRUST_ACCESS',
        action: 'Verify Access application session policy.',
        rationale: 'Routine Zero Trust check.',
      },
    ];

    const partitioned = partitionExternalActions(actions, [wshGeoRule], [wshCampaign]);
    expect(partitioned.suppressedCoveredCount).toBe(1);
    expect(partitioned.suppressedRuleNames).toEqual(['Block non-US WSH']);
    expect(partitioned.visibleActions).toHaveLength(1);
    expect(partitioned.visibleActions[0].action.surface).toBe('ZERO_TRUST_ACCESS');
  });

  it('detects PARTIAL coverage when narrow eq rule leaves //xmlrpc.php or /wp-login.php exposed', () => {
    const narrowRule = makeRule({
      description: 'Block WP Install Only',
      expression: '(http.host eq "parakith.com" and http.request.uri.path eq "/wp-admin/install.php")',
    });

    const wpCampaign: GeminiCampaignDto = {
      name: 'WordPress Exploit and Recon Probing on Public Web',
      severity: 'MEDIUM',
      sourceLayers: ['CLOUDFLARE'],
      targetHosts: ['parakith.com'],
      pattern: 'Automated scanning for /wp-admin/install.php, /wp-login.php, /wp-json/, and //xmlrpc.php.',
      countEstimate: 111,
      sampleRayIds: ['a5ee1'],
    };

    const cov = evaluateCampaignWafCoverage(wpCampaign, [narrowRule]);
    expect(cov.status).toBe('PARTIAL');
    expect(cov.uncoveredPaths).toContain('/wp-login.php');
    expect(cov.uncoveredPaths).toContain('//xmlrpc.php');

    const wpAction: GeminiActionDto = {
      priority: 'SOON',
      surface: 'CLOUDFLARE_WAF',
      action: 'Deploy WAF block for WordPress legacy/install paths on parakith.com.',
      rationale: 'Blocks scanners.',
      wafRuleSnippet:
        '(http.host eq "parakith.com" and (http.request.uri.path eq "/wp-admin/install.php" or http.request.uri.path eq "/wp-login.php" or http.request.uri.path contains "xmlrpc.php"))',
    };

    const actCov = evaluateActionWafCoverage(wpAction, [narrowRule], [wpCampaign]);
    expect(actCov.status).toBe('PARTIAL');

    const partitioned = partitionExternalActions([wpAction], [narrowRule], [wpCampaign]);
    expect(partitioned.suppressedCoveredCount).toBe(0);
    expect(partitioned.visibleActions).toHaveLength(1);
  });

  it('ignores disabled rules and non-blocking log/skip rules, and supports manual_override + actor/finding checks', () => {
    const disabledRule = makeRule({ enabled: false });
    const skipRule = makeRule({ action: 'skip' });
    const manualGeo = makeRule({
      id: 'ov-1',
      zoneName: 'panoramadr.com',
      description: 'Manual Non-US WSH',
      expression: '(http.host eq "wsh.panoramadr.com" and ip.geoip.country ne "US")',
      source: 'manual_override',
    });
    const broadWpRule = makeRule();

    const finding: ThreatFindingRow = {
      id: 'f1',
      runId: 'r1',
      sourceLayer: 'CLOUDFLARE',
      ruleId: 'STRICT_PRIVATE_NON_US_PROBE',
      severity: 'MEDIUM',
      category: 'ZERO_TRUST',
      title: 'Non-US Traffic Reaching Private Edge (1 unblocked) [Partial WAF Coverage]',
      summary: 'Slip through',
      host: 'wsh.panoramadr.com',
      actorIp: '43.157.175.122',
      actorAsn: '132203',
      rayIdsJson: '[]',
      evidenceJson: JSON.stringify({ blockedHits: 0, unblockedHits: 1, partialWafRule: 'Manual Non-US WSH' }),
      createdAt: '2026-11-23T05:00:00Z',
    };

    // Disabled/skip rules should not match WP actor
    const wpActor: ThreatActorRow = {
      id: '188.166.230.208',
      actorType: 'IP',
      ipAddress: '188.166.230.208',
      asn: '14061',
      asOrg: 'DigitalOcean',
      country: 'SG',
      intelTagsJson: '[]',
      firstSeenAt: '2026-11-22T00:00:00Z',
      lastSeenAt: '2026-11-23T05:00:00Z',
      runsSeen: 3,
      totalRequests: 63,
      totalOrigin200s: 0,
      highestSeverity: 'LOW',
      latestClassification: 'OPPORTUNISTIC_SCANNER',
      targetHostsJson: '["parakith.com"]',
      samplePathsJson: '["//2018/wp-includes/wlwmanifest.xml","//xmlrpc.php","/wp-admin/install.php"]',
      disposition: 'ACTIVE',
    };

    expect(evaluateActorWafCoverage(wpActor, [disabledRule, skipRule]).status).toBe('UNCOVERED');
    expect(evaluateActorWafCoverage(wpActor, [broadWpRule]).status).toBe('COVERED');
    expect(evaluateFindingWafCoverage(finding, [manualGeo]).status).toBe('PARTIAL');
  });

  it('keeps whole-host non-US geo rules COVERED despite observed paths and marks mixed-host geo campaigns/actors PARTIAL', () => {
    const wshLiveRule = makeRule({
      id: '57d45a8510194bccac3f381ef2ed1a45',
      zoneName: 'panoramadr.com',
      description: 'Block non US from WSH',
      expression: '(http.host eq "wsh.panoramadr.com" and ip.geoip.country ne "US")',
    });

    const foreignWshCampaign: GeminiCampaignDto = {
      name: 'Foreign Probing of Strict-Private Host',
      severity: 'MEDIUM',
      sourceLayers: ['CLOUDFLARE'],
      targetHosts: ['wsh.panoramadr.com'],
      pattern: 'Non-US requests from Tencent Cloud (SG and BR) to root path (/) on strict-private host wsh.panoramadr.com.',
      countEstimate: 5,
      sampleRayIds: [],
      suggestedWafExpression: '(http.host eq "wsh.panoramadr.com" and ip.geoip.country ne "US")',
    };
    const foreignCov = evaluateCampaignWafCoverage(
      foreignWshCampaign,
      [wshLiveRule],
      ['/', '/cdn-cgi/l/email-protection']
    );
    expect(foreignCov.status).toBe('COVERED');
    expect(foreignCov.primaryRuleName).toBe('Block non US from WSH');
    expect(foreignCov.uncoveredPaths).toEqual([]);

    const mixedHostCampaign: GeminiCampaignDto = {
      name: 'Non-US Recon Against Strict Private Host',
      severity: 'MEDIUM',
      sourceLayers: ['CLOUDFLARE'],
      targetHosts: ['wsh.panoramadr.com', 'parakith.com'],
      pattern: 'Foreign ASN (AS132203 Tencent, BR) issued requests including strict-private wsh.panoramadr.com.',
      countEstimate: 3,
      sampleRayIds: [],
    };
    const mixedCov = evaluateCampaignWafCoverage(
      mixedHostCampaign,
      [wshLiveRule],
      ['//2019/wp-includes/wlwmanifest.xml', '//xmlrpc.php', '/cdn-cgi/l/email-protection']
    );
    expect(mixedCov.status).toBe('PARTIAL');
    expect(mixedCov.uncoveredPaths).toEqual([]);
    expect(mixedCov.reason).toContain('wsh.panoramadr.com');
    expect(mixedCov.reason).toContain('parakith.com');

    const baseActor: ThreatActorRow = {
      id: 'actor',
      actorType: 'IP',
      ipAddress: '43.157.175.122',
      asn: '132203',
      asOrg: 'Tencent',
      country: 'BR',
      intelTagsJson: '[]',
      firstSeenAt: '2026-11-23T02:39:28Z',
      lastSeenAt: '2026-11-23T09:07:57Z',
      runsSeen: 3,
      totalRequests: 9,
      totalOrigin200s: 0,
      highestSeverity: 'MEDIUM',
      latestClassification: 'TARGETED_RECON',
      targetHostsJson: '["parakith.com","wsh.panoramadr.com"]',
      samplePathsJson: '["/","/cdn-cgi/l/email-protection"]',
      disposition: 'ACTIVE',
    };
    const multiHostCov = evaluateActorWafCoverage(baseActor, [wshLiveRule]);
    expect(multiHostCov.status).toBe('PARTIAL');
    expect(multiHostCov.primaryRuleName).toBe('Block non US from WSH');
    expect(multiHostCov.reason).toContain('wsh.panoramadr.com');
    expect(multiHostCov.reason).toContain('parakith.com');

    const usWshActor: ThreatActorRow = {
      ...baseActor,
      id: '54.211.224.47',
      ipAddress: '54.211.224.47',
      country: 'US',
      targetHostsJson: '["wsh.panoramadr.com"]',
      samplePathsJson: '["/"]',
    };
    expect(evaluateActorWafCoverage(usWshActor, [wshLiveRule]).status).toBe('UNCOVERED');

    const apexNonUsActor: ThreatActorRow = {
      ...baseActor,
      id: '78.135.96.195',
      ipAddress: '78.135.96.195',
      country: 'TR',
      targetHostsJson: '["panoramadr.com"]',
      samplePathsJson: '["/"]',
    };
    expect(evaluateActorWafCoverage(apexNonUsActor, [wshLiveRule]).status).toBe('UNCOVERED');
  });
});
