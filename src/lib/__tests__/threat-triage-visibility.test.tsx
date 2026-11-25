import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreatIntelView } from '../../components/security/ThreatIntelView';
import { buildHudIncidentQueue, type HudSynthesisInput } from '../hud-synthesis';
import type { ThreatAuditRunRow, ThreatFindingRow, ThreatRunDetailDto } from '../types';

function makeBaseHudInput(overrides: Partial<HudSynthesisInput> = {}): HudSynthesisInput {
  return {
    apps: [],
    appliances: [],
    isInitialSyncComplete: true,
    networkPosture: 'LAN_DIRECT',
    ...overrides,
  };
}

function makeHighFinding(): ThreatFindingRow {
  return {
    id: 'f1',
    runId: 'run-1',
    sourceLayer: 'CLOUDFLARE',
    ruleId: 'ORIGIN_BREACH_THROUGH',
    severity: 'HIGH',
    category: 'ORIGIN_BREACH',
    title: 'Untrusted Origin Response on Strict Private Route (2607:fb91:7c6:892:ac39:bbf2:83c8:a0d8)',
    summary:
      '2607:fb91:7c6:892:ac39:bbf2:83c8:a0d8 (AS21928 T-Mobile USA, Inc., US) received 364 origin 200/302 responses on protected routes.',
    actorIp: '2607:fb91:7c6:892:ac39:bbf2:83c8:a0d8',
    actorAsn: 'AS21928',
    host: 'wsh.panoramadr.com',
    rayIdsJson: '["a5fc0f226933d302"]',
    evidenceJson: JSON.stringify({
      rayIds: ['a5fc0f226933d302'],
      matchedAccessEmails: ['family@example.com'],
      authProofStatus: 'UNALLOWLISTED_ACCESS_EMAIL',
    }),
    createdAt: '2026-11-25 00:00:46',
    disposition: 'ACTIVE',
  };
}

function makeRun(): ThreatAuditRunRow {
  return {
    id: 'run-1',
    triggerSource: 'MANUAL',
    windowStart: '2026-11-24T00:00:00Z',
    windowEnd: '2026-11-25T00:00:46Z',
    windowHours: 24,
    startedAt: '2026-11-24T23:58:00Z',
    completedAt: '2026-11-25T00:00:46Z',
    status: 'COMPLETED',
    overallSeverity: 'HIGH',
    intrusionVerdict: 'SUSPECTED_INTRUSION',
    escalatedToTier2: true,
    tier2Model: 'gemini-4-carbon',
    collectorStatusesJson: JSON.stringify({
      cloudflare: 'OK',
      zeroTrust: 'OK',
      unifi: 'OK',
      wshAuth: 'OK',
      gemini: 'OK',
    }),
    zonesSummaryJson: '[]',
    zeroTrustSummaryJson: JSON.stringify({
      accessAppCount: 5,
      accessAllowed: 1,
      accessDenied: 0,
      tunnels: [],
      auditMutations: 0,
      verifiedFamilySessions: [
        {
          email: 'family@example.com',
          ipAddress: '2607:fb91:7c6:892:ac39:bbf2:83c8:a0d8',
          authSource: 'Cloudflare Access (/64)',
          requests: 399,
          origin200s: 364,
          hosts: ['wsh.panoramadr.com'],
        },
      ],
    }),
    internalSummaryJson: JSON.stringify({
      unifiDevicesTotal: 4,
      unifiOfflineDevices: [],
      unifiClientsTotal: 10,
      newUnknownLanMacs: [],
      unifiPoliciesTotal: 5,
      panoramaAuthAvailable: true,
      panoramaAuthAnomalies: 0,
      sshAnomalyCount: 0,
      unifiSiemCefEvents: 0,
      unifiCefSecurityAlerts: 0,
    }),
  };
}

function makeDetail(): ThreatRunDetailDto {
  return {
    run: makeRun(),
    findings: [makeHighFinding()],
  };
}

describe('High-threat triage visibility and direct HUD drill-down', () => {
  it('surfaces concrete HIGH finding title, summary, and deep-link target in HUD incident queue', () => {
    const incidents = buildHudIncidentQueue(
      makeBaseHudInput({
        threatAlertCount: 1,
        threatAlertSeverity: 'warning',
        latestThreatRun: makeRun(),
        topThreatTitle:
          'HIGH: Untrusted Origin Response on Strict Private Route (2607:fb91:7c6:892:ac39:bbf2:83c8:a0d8)',
        topThreatDetail:
          '2607:fb91:7c6:892:ac39:bbf2:83c8:a0d8 (AS21928 T-Mobile USA, Inc., US) received 364 origin 200/302 responses • Host: wsh.panoramadr.com',
        topThreatTargetTab: 'external',
        topThreatFocusId: 'threat-finding-f1',
      })
    );

    const threatInc = incidents.find((i) => i.domain === 'threat');
    expect(threatInc).toBeDefined();
    expect(threatInc?.title).toContain('2607:fb91:7c6:892:ac39:bbf2:83c8:a0d8');
    expect(threatInc?.detail).toContain('wsh.panoramadr.com');
    expect(threatInc?.primaryAction.label).toBe('Inspect High Threat');
    expect(threatInc?.primaryAction.threatTab).toBe('external');
    expect(threatInc?.primaryAction.threatFocusId).toBe('threat-finding-f1');
  });

  it('pins Action Required spotlight above the 4-card Context Ribbon with inline triage controls', () => {
    const html = renderToStaticMarkup(
      <ThreatIntelView
        latestDetail={makeDetail()}
        runs={[makeRun()]}
        settings={null}
        isRunningAudit={false}
        onRunAuditNow={vi.fn()}
        onEscalateRunToCarbon={vi.fn()}
        onSelectRunId={vi.fn()}
        onRefreshAll={vi.fn()}
        onNavigateToSettings={vi.fn()}
      />
    );

    const spotlightIdx = html.indexOf('data-testid="threat-action-required-spotlight"');
    const contextRibbonIdx = html.indexOf('Cloudflare Edge');

    expect(spotlightIdx).toBeGreaterThan(-1);
    expect(contextRibbonIdx).toBeGreaterThan(-1);
    expect(spotlightIdx).toBeLessThan(contextRibbonIdx);

    expect(html).toContain('2607:fb91:7c6:892:ac39:bbf2:83c8:a0d8');
    expect(html).toContain('Trust Email (family@example.com)');
    expect(html).toContain('1 Family Session Verified');
    expect(html).toContain('Mark Resolved');
    expect(html).toContain('Allowlist IP');
    expect(html).toContain('Jump to Details');
  });

  it('renders External Perimeter Findings before Cloudflare Custom WAF Rules and highlights focused finding', () => {
    const html = renderToStaticMarkup(
      <ThreatIntelView
        latestDetail={makeDetail()}
        runs={[makeRun()]}
        settings={null}
        isRunningAudit={false}
        onRunAuditNow={vi.fn()}
        onEscalateRunToCarbon={vi.fn()}
        onSelectRunId={vi.fn()}
        onRefreshAll={vi.fn()}
        onNavigateToSettings={vi.fn()}
        initialSubView="external"
        initialFocusId="threat-finding-f1"
        initialNavNonce={1}
      />
    );

    const findingsIdx = html.indexOf('External Perimeter Findings');
    const actorsIdx = html.indexOf('Recurring External Threat Actors');
    const wafIdx = html.indexOf('id="cf-waf-rules-card"');

    expect(findingsIdx).toBeGreaterThan(-1);
    expect(actorsIdx).toBeGreaterThan(-1);
    expect(wafIdx).toBeGreaterThan(-1);
    expect(findingsIdx).toBeLessThan(wafIdx);
    expect(actorsIdx).toBeLessThan(wafIdx);
    expect(html).toContain('id="threat-finding-f1"');
    expect(html).toContain('ring-rose-500');
  });
});
