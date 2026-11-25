import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreatIntelView } from '../../components/security/ThreatIntelView';
import {
  buildRecommendedActionKey,
  isRecommendedActionSuppressed,
  partitionRecommendedActions,
  type RecommendedActionDispositionMap,
} from '../recommended-action-triage';
import type { ThreatAuditRunRow, ThreatRunDetailDto } from '../types';

function makeRunWithActions(): ThreatAuditRunRow {
  return {
    id: 'run-actions-1',
    triggerSource: 'SCHEDULED',
    windowStart: '2026-11-25T03:00:00Z',
    windowEnd: '2026-11-25T10:02:28Z',
    windowHours: 6,
    startedAt: '2026-11-25T10:00:18Z',
    completedAt: '2026-11-25T10:02:28Z',
    status: 'COMPLETED',
    overallSeverity: 'HIGH',
    intrusionVerdict: 'NO_EVIDENCE',
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
      accessAppCount: 1,
      accessAllowed: 1,
      accessDenied: 0,
      tunnels: [],
      auditMutations: 0,
    }),
    internalSummaryJson: JSON.stringify({
      unifiDevicesTotal: 0,
      unifiOfflineDevices: [],
      unifiClientsTotal: 0,
      newUnknownLanMacs: [],
      unifiPoliciesTotal: 0,
      panoramaAuthAvailable: true,
      panoramaAuthAnomalies: 0,
      sshAnomalyCount: 0,
      unifiSiemCefEvents: 0,
      unifiCefSecurityAlerts: 0,
    }),
    geminiBriefJson: JSON.stringify({
      executiveSummary: 'All clear except minor routine scanner probes.',
      externalPerimeterAssessment: 'Clean edge posture.',
      internalNetworkAssessment: 'IoT device confined.',
      recommendedActions: [
        {
          priority: 'MONITOR',
          surface: 'INTERNAL_UNIFI',
          action: 'Confirm hostname AIVI2-B 33:17 corresponds to an expected smart-home appliance on VLAN 20.',
          rationale: 'Client is confined to Untrusted & IoT zone with 0 alerts.',
        },
        {
          priority: 'SOON',
          surface: 'EXTERNAL_CLOUDFLARE',
          action: 'Deploy one consolidated dotfile block rule on parakith.com.',
          rationale: 'Blocks /.git and /.env recon.',
          wafRuleSnippet: '(http.request.uri.path contains "/.git")',
        },
      ],
    }),
  };
}

describe('Recommended action snooze and permanent dismissal', () => {
  it('normalizes action keys consistently across whitespace and case differences', () => {
    const k1 = buildRecommendedActionKey({
      surface: 'INTERNAL_UNIFI',
      action: 'Confirm hostname AIVI2-B 33:17 on VLAN 20.',
    });
    const k2 = buildRecommendedActionKey({
      surface: 'internal_unifi',
      action: '  confirm   hostname aivi2-b 33:17 on vlan 20 ',
    });
    expect(k1).toBe(k2);
  });

  it('suppresses snoozed actions until expiry and permanently hides dismissed actions', () => {
    const nowMs = Date.parse('2026-11-25T12:00:00Z');
    const a1 = {
      priority: 'MONITOR' as const,
      surface: 'INTERNAL_UNIFI',
      action: 'Confirm smart-home appliance on VLAN 20',
      rationale: 'Routine check.',
    };
    const a2 = {
      priority: 'SOON' as const,
      surface: 'EXTERNAL_CLOUDFLARE',
      action: 'Deploy dotfile rule',
      rationale: 'Static site noise.',
      wafRuleSnippet: '(http.request.uri.path contains "/.git")',
    };
    const a3 = {
      priority: 'SOON' as const,
      surface: 'INTERNAL_WSH',
      action: 'Verify VPN routing between 100.64.2.2 and 172.16.200.2',
      rationale: 'Roaming event.',
    };

    const k1 = buildRecommendedActionKey(a1);
    const k2 = buildRecommendedActionKey(a2);

    const dispositions: RecommendedActionDispositionMap = {
      [k1]: {
        key: k1,
        status: 'SNOOZED',
        snoozedUntil: '2026-12-02T12:00:00Z',
        updatedAt: '2026-11-25T12:00:00Z',
        actionLabel: a1.action,
        surface: a1.surface,
      },
      [k2]: {
        key: k2,
        status: 'DISMISSED',
        snoozedUntil: null,
        updatedAt: '2026-11-25T12:00:00Z',
        actionLabel: a2.action,
        surface: a2.surface,
      },
    };

    expect(isRecommendedActionSuppressed(dispositions[k1], nowMs).suppressed).toBe(true);
    expect(isRecommendedActionSuppressed(dispositions[k2], nowMs).suppressed).toBe(true);

    const partitioned = partitionRecommendedActions(
      [{ action: a1 }, { action: a2 }, { action: a3 }],
      dispositions,
      nowMs
    );
    expect(partitioned.active.map((x) => x.action.action)).toEqual([a3.action]);
    expect(partitioned.hidden.map((x) => x.disposition.status)).toEqual(['SNOOZED', 'DISMISSED']);

    // Once snooze expires, a1 reappears automatically while permanently dismissed a2 stays hidden forever
    const after30DaysMs = Date.parse('2026-12-25T12:00:00Z');
    const afterExpiry = partitionRecommendedActions(
      [{ action: a1 }, { action: a2 }, { action: a3 }],
      dispositions,
      after30DaysMs
    );
    expect(afterExpiry.active.map((x) => x.action.action)).toEqual([a1.action, a3.action]);
    expect(afterExpiry.hidden.map((x) => x.disposition.status)).toEqual(['DISMISSED']);
  });

  it('renders SnoozeSplitButton and permanent Dismiss button on Recommended Actions in ThreatIntelView', () => {
    const run = makeRunWithActions();
    const detail: ThreatRunDetailDto = { run, findings: [] };

    const html = renderToStaticMarkup(
      <ThreatIntelView
        latestDetail={detail}
        runs={[run]}
        settings={null}
        isRunningAudit={false}
        onRunAuditNow={vi.fn()}
        onEscalateRunToCarbon={vi.fn()}
        onSelectRunId={vi.fn()}
        onRefreshAll={vi.fn()}
        onNavigateToSettings={vi.fn()}
      />
    );

    expect(html).toContain('Recommended Actions by Surface (2)');
    expect(html).toContain('Snooze 7d');
    expect(html).toContain('Dismiss');
    expect(html).toContain('Confirm hostname AIVI2-B 33:17');
  });
});
