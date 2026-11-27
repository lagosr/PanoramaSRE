import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OttoDefensePanel } from '../../components/agent/OttoDefensePanel';
import { OttoAgentView } from '../../components/agent/OttoAgentView';
import { WshHardeningView } from '../../components/security/WshHardeningView';
import { UnifiNetworkZbfView } from '../../components/network/UnifiNetworkZbfView';
import type { OttoDefenseOverviewDto, OttoProposalRow } from '../types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

function makeDefenseOverview(): OttoDefenseOverviewDto {
  const stagedPlan: OttoProposalRow = {
    id: 'prop-def-1',
    traceRunId: 'trace-def-1',
    domain: 'DEFENSE',
    classification: 'MATERIAL_THREAT',
    assetSlug: 'parakith.com',
    assetTier: 'TIER2_EXTERNAL_EDGE',
    actionId: 'apply_cf_temp_challenge',
    paramsJson: JSON.stringify({
      targetZone: 'parakith.com',
      cfAction: 'managed_challenge',
      ttlMinutes: 60,
      homeWanAndFamilyProtected: true,
      materialityBreakdown: {
        surface: 'PublicWeb',
        stackMatchPts: 25,
        boundaryPenetrationPts: 25,
        authWriteImpactPts: 18,
        volumetricPersistencePts: 10,
        crossLayerPts: 6,
        totalScore: 84,
      },
    }),
    title: '60m Managed Challenge on D1 Opt-In Flood (198.51.100.77)',
    severity: 'HIGH',
    confidence: 0.94,
    rcaSummary: '12 POST /api/opt-in write flood hits targeting parakith-opt-ins D1.',
    evidenceJson: '["score:84/100"]',
    diffPreview:
      'Zone: parakith.com | Action: managed_challenge (60m TTL) | Expr: (ip.src in {198.51.100.77})',
    rollbackPlanJson: '{}',
    blastRadiusFlagsJson: '["CLOUDFLARE_EDGE_WAF"]',
    status: 'PENDING_APPROVAL',
    createdAt: '2026-11-27T20:00:00Z',
  };

  const defectPlan: OttoProposalRow = {
    id: 'prop-def-2',
    traceRunId: 'trace-def-2',
    domain: 'BUG_DIAGNOSTIC',
    classification: 'DETECTION_DEFECT_SUSPECTED',
    assetSlug: 'auth',
    assetTier: 'TIER0_CRITICAL',
    actionId: 'create_bug_handoff',
    paramsJson: '{}',
    title: 'Suspected Cross-Host Correlation Bug on wsh.panoramadr.com',
    severity: 'LOW',
    confidence: 0.91,
    rcaSummary: 'Public 404 paths leaked into strict-private rollup.',
    evidenceJson: '[]',
    blastRadiusFlagsJson: '[]',
    status: 'SHADOW_LOGGED',
    createdAt: '2026-11-27T20:05:00Z',
  };

  return {
    exposureProfile: {
      strictPrivateHosts: ['wsh.panoramadr.com'],
      publicWebHosts: ['parakith.com', 'www.parakith.com'],
      apexMonitorHosts: ['panoramadr.com'],
      activeBasePaths: ['/auth', '/spendy', '/biomed', '/water', '/basket', '/energy', '/res'],
      lanOnlyAppliances: ['ui.panoramadr.com', 'protect.panoramadr.com'],
      zeroWanPortForwards: true,
      wshStackSummary: 'cloudflared -> Lighttpd -> Next.js 16 -> SQLite WAL',
      publicWebStackSummary: 'Cloudflare Pages + D1 (zero Linux OS / zero Next.js)',
    },
    activeLeases: [
      {
        id: 'lease-active-1',
        proposalId: 'prop-prev',
        cfZoneId: 'zone-1',
        cfZoneName: 'parakith.com',
        cfRulesetId: 'rs-1',
        cfRuleId: 'rule-192',
        ruleDescription: 'Safe RFC 5737 Test [otto-lease:lease-active-1]',
        ruleExpression: '(ip.src in {192.0.2.99})',
        actionType: 'managed_challenge',
        targetSummary: 'IPs: 192.0.2.99',
        priorRulesetSnapshotJson: '{"rules":[]}',
        ttlMinutes: 60,
        createdAt: '2026-11-27T22:00:00Z',
        expiresAt: new Date(Date.now() + 45 * 60_000).toISOString(),
        status: 'ACTIVE',
        traceRunId: 'trace-lease-1',
      },
    ],
    leaseHistory: [
      {
        id: 'lease-old-1',
        proposalId: 'prop-old',
        cfZoneId: 'zone-1',
        cfZoneName: 'parakith.com',
        cfRulesetId: 'rs-1',
        cfRuleId: 'rule-old',
        ruleDescription: 'Expired TTL Test',
        ruleExpression: '(ip.src in {192.0.2.10})',
        actionType: 'managed_challenge',
        targetSummary: 'IPs: 192.0.2.10',
        priorRulesetSnapshotJson: '{"rules":[]}',
        ttlMinutes: 60,
        createdAt: '2026-11-27T18:00:00Z',
        expiresAt: '2026-11-27T19:00:00Z',
        revertedAt: '2026-11-27T19:00:05Z',
        status: 'EXPIRED_REVERTED',
      },
    ],
    droppedNoise24h: {
      totalEvents: 2,
      totalRequests: 44,
      absentStack: 14,
      edgeBlockedZeroOrigin: 0,
      static404Crawler: 0,
      wanDefaultDeny: 30,
    },
    recentDroppedNoise: [
      {
        id: 'drop-1',
        actorIp: '185.220.101.4',
        actorAsn: '12345',
        country: 'DE',
        host: 'parakith.com',
        surface: 'PublicWeb',
        reason: 'absent_stack',
        score: 8,
        requestCount: 14,
        samplePathsJson: '["/wp-login.php","/actuator/env"]',
        createdAt: '2026-11-27T21:55:00Z',
      },
    ],
    defenseProposals: [stagedPlan, defectPlan],
    cfConfigured: true,
    lastSweepTrace: null,
  };
}

describe('Otto Phase 3 — Dual-Perimeter Defense & Ask Otto Entry Points', () => {
  it('renders OttoDefensePanel with Exposure Profile, Dropped Noise ($0 LLM), Active Lease Revert, Suspected Detection Bug badge, and Materiality Breakdown', () => {
    const html = renderToStaticMarkup(
      <OttoDefensePanel
        overview={makeDefenseOverview()}
        onRefreshDefense={vi.fn().mockResolvedValue(undefined)}
        onRefreshOtto={vi.fn().mockResolvedValue(undefined)}
        onInspectTrace={vi.fn()}
        onDecideProposal={vi.fn().mockResolvedValue(undefined)}
        onAskOtto={vi.fn()}
      />
    );

    expect(html).toContain('Home WAN &amp; Family Access Protected');
    expect(html).toContain('Surface A · StrictPrivate');
    expect(html).toContain('Surface B · PublicWeb');
    expect(html).toContain('44 reqs');
    expect(html).toContain('Materiality 84/100');
    expect(html).toContain('(ip.src in {192.0.2.99})');
    expect(html).toContain('Revert Rule Now');
    expect(html).toContain('Suspected Detection Bug');
    expect(html).toContain('185.220.101.4');
    expect(html).toContain('Stage Safe RFC 5737 Test Lease');
  });

  it('renders Defense Plans & Leases tab inside OttoAgentView cleanly', () => {
    const html = renderToStaticMarkup(
      <OttoAgentView
        apps={[]}
        status={null}
        policies={[]}
        l4Invariants={[]}
        traces={[]}
        proposals={[]}
        soaks={[]}
        defenseOverview={makeDefenseOverview()}
        initialSubView="defense"
        onRefreshOtto={vi.fn().mockResolvedValue(undefined)}
        onToggleKillSwitch={vi.fn().mockResolvedValue(undefined)}
        onAbortStep={vi.fn().mockResolvedValue(undefined)}
        onResetCircuitBreaker={vi.fn().mockResolvedValue(undefined)}
        onUpdatePolicyMode={vi.fn().mockResolvedValue(undefined)}
        onDecideProposal={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(html).toContain('Defense Plans &amp; Leases (1)');
    expect(html).toContain('Dual-Perimeter Proactive Defense');
  });

  it('renders context-seeded Ask Otto button in WshHardeningView', () => {
    const html = renderToStaticMarkup(
      <WshHardeningView snapshot={null} apps={[]} onAskOtto={vi.fn()} />
    );

    expect(html).toContain('WSH Hardening');
    expect(html).toContain('Ask Otto');
  });

  it('renders context-seeded Ask Otto button in UnifiNetworkZbfView', () => {
    const html = renderToStaticMarkup(<UnifiNetworkZbfView onAskOtto={vi.fn()} />);

    expect(html).toContain('UniFi Network');
    expect(html).toContain('Ask Otto');
  });
});
