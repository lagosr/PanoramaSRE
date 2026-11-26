import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OttoIcon } from '../../components/agent/OttoAvatar';
import { OttoMarkdownRenderer } from '../../components/agent/OttoMarkdownRenderer';
import { TopLiveSyncBar } from '../../components/layout/TopLiveSyncBar';
import { SidebarRail } from '../../components/layout/SidebarRail';
import { OttoAgentView } from '../../components/agent/OttoAgentView';
import { DietPiHardwareNetworkCard } from '../../components/topology/DietPiHardwareNetworkCard';
import { PriorityAttentionQueue } from '../../components/hud/PriorityAttentionQueue';
import {
  shouldAutoOpenOnJobStart,
  shouldAutoOpenOnJobFinish,
} from '../console-dock-policy';
import { synthesizeTopology } from '../topology-synthesizer';
import type {
  OttoL4Invariant,
  OttoLifecycleSnapshot,
  OttoPolicyRow,
  OttoProposalRow,
  OttoStatusDto,
  OttoTraceRunRow,
} from '../types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', resolvedTheme: 'dark', toggleTheme: vi.fn() }),
}));

const SAMPLE_LIFECYCLE: OttoLifecycleSnapshot = {
  state: 'THINKING',
  phaseLabel: 'Otto: Thinking (Neon · high)',
  activeModel: 'gemini-4-neon',
  thinkingLevel: 'high',
  currentTarget: 'auth',
  summary: 'Evaluating detection-defect hypothesis',
  startedAt: new Date(Date.now() - 4000).toISOString(),
  traceRunId: 'trace-100',
  canAbort: true,
  killSwitchActive: false,
  circuitBreakerState: 'CLOSED',
  pendingApprovalsCount: 1,
  activeSoaksCount: 0,
  dailyT1Calls: 2,
  dailyT2Calls: 1,
  droppedNoise24hCount: 14,
};

const SAMPLE_STATUS: OttoStatusDto = {
  lifecycle: SAMPLE_LIFECYCLE,
  agentState: {
    killSwitchActive: false,
    circuitBreakerState: 'CLOSED',
    trippedReason: null,
    trippedAt: null,
    consecutiveFailures: 0,
    dailyT1Calls: 2,
    dailyT2Calls: 1,
    budgetDateUtc: '2026-11-26',
    droppedNoise24hCount: 14,
    updatedAt: '2026-11-26T12:00:00Z',
  },
  suricata: {
    usedLast120s: 1,
    maxPer120s: 2,
    windowSecs: 120,
    remaining: 1,
    nextSlotInSecs: 0,
    gatekeeperKeyPath: 'C:\\Users\\rodrigo\\.ssh\\sre-agent-wsh',
    gatekeeperKeyExists: true,
    gatekeeperVerified: true,
    lastProbeAt: '2026-11-26T12:00:00Z',
    lastProbeDetail: 'Gatekeeper verb probe-snapshot succeeded',
  },
  geminiConfigured: true,
  defaultTier1Model: 'gemini-4-hydrogen',
  defaultTier2Model: 'gemini-4-neon',
  dailyT2Cap: 6,
};

const SAMPLE_POLICIES: OttoPolicyRow[] = [
  {
    actionId: 'deploy_verified_patch',
    domain: 'UPGRADE',
    label: 'Production App Rollout (deploy-docker.ps1)',
    description: 'Deploy verified patch (strictly Desktop L3 Human-Approved).',
    assetTier: 'TIER1_CHILD_APP',
    mode: 'L3_APPROVAL',
    maxAllowedMode: 'L3_APPROVAL',
    cooldownSecs: 600,
    shadowRunsCount: 0,
    shadowAgreedCount: 0,
    promotedAt: null,
    updatedAt: '2026-11-26T12:00:00Z',
  },
];

const SAMPLE_L4: OttoL4Invariant[] = [
  {
    id: 'L4-01',
    category: 'Workstation',
    title: 'Zero Arbitrary Shell Execution',
    detail: 'Every action maps to a compiled Rust handler.',
  },
  {
    id: 'L4-06',
    category: 'Perimeter Defense',
    title: 'Protected Allowlist & False-Positive Block Immunity',
    detail: 'Never blocks LAN/allowlist/health/JWKS or detection defects.',
  },
];

const SAMPLE_TRACES: OttoTraceRunRow[] = [
  {
    id: 'trace-100',
    triggerKind: 'CHAT',
    domain: 'SECURITY',
    assetSlug: 'auth',
    finalState: 'COMPLETED',
    modelUsed: 'gemini-4-neon',
    thinkingLevel: 'high',
    inputTokens: 640,
    outputTokens: 120,
    thoughtTokens: 310,
    durationMs: 1450,
    outcomeSummary: 'Identified roaming family IP false positive',
    errorText: null,
    startedAt: '2026-11-26T12:00:00Z',
    completedAt: '2026-11-26T12:00:01Z',
  },
];

const SAMPLE_PROPOSALS: OttoProposalRow[] = [
  {
    id: 'prop-1',
    traceRunId: 'trace-100',
    domain: 'BUG_DIAGNOSTIC',
    classification: 'DETECTION_DEFECT_SUSPECTED',
    assetSlug: 'auth',
    assetTier: 'TIER0_CRITICAL',
    actionId: 'create_bug_handoff',
    paramsJson: '{}',
    title: 'Fix CEF src IP fallback regex',
    severity: 'MEDIUM',
    confidence: 0.91,
    rcaSummary: 'Unparsed src=None produced false positive alert inside safe perimeter.',
    evidenceJson: '["finding-1"]',
    diffPreview: null,
    rollbackPlanJson: null,
    blastRadiusFlagsJson: '["TIER0_CRITICAL"]',
    status: 'PENDING_APPROVAL',
    snoozedUntil: null,
    createdAt: '2026-11-26T12:00:00Z',
    decidedAt: null,
    executedAt: null,
    verificationResultJson: null,
  },
];

describe('Otto AI SRE — Phase 1 UI, Avatar, Global Pill & Console Isolation', () => {
  it('OttoIcon scopes SVG linearGradient IDs uniquely across simultaneous renders', () => {
    const html = renderToStaticMarkup(
      <div>
        <OttoIcon state="IDLE" title="Otto Sidebar" />
        <OttoIcon state="THINKING" thinking title="Otto Header" />
        <OttoIcon state="PAUSED" title="Otto Paused" />
      </div>
    );
    const ids = Array.from(html.matchAll(/<linearGradient id="([^"]+)"/g)).map((m) => m[1]);
    expect(ids.length).toBe(12);
    expect(new Set(ids).size).toBe(12);
    expect(html).toContain('opacity-65');
  });

  it('TopLiveSyncBar renders Live Otto State Pill with active phase & model label', () => {
    const html = renderToStaticMarkup(
      <TopLiveSyncBar
        networkPosture="LAN_DIRECT"
        devRunningCount={0}
        totalAppCount={6}
        prodHealthyCount={6}
        lastSyncTime="12:00:00"
        isSyncing={false}
        onRefresh={vi.fn()}
        ottoLifecycle={SAMPLE_LIFECYCLE}
        onOpenOtto={vi.fn()}
        onInspectOttoTrace={vi.fn()}
        onToggleOttoKillSwitch={vi.fn()}
        onAbortOttoStep={vi.fn()}
      />
    );
    expect(html).toContain('data-testid="top-otto-state-pill"');
    expect(html).toContain('Otto: Thinking (Neon · high)');
  });

  it('SidebarRail renders Otto AI SRE nav entry with OttoIcon and pending approval badge', () => {
    const html = renderToStaticMarkup(
      <SidebarRail
        activeTab="agent"
        onSelectTab={vi.fn()}
        unhealthyCount={0}
        showAgentNav={true}
        ottoPhase="AWAITING_APPROVAL"
        ottoBadgeCount={2}
        ottoBadgeSeverity="warning"
      />
    );
    expect(html).toContain('Otto AI SRE');
    expect(html).toContain('>2<');
  });

  it('OttoAgentView renders Policy Matrix L4 invariants, Traces, Approvals, and Ask Otto cleanly without native <select>', () => {
    const policiesHtml = renderToStaticMarkup(
      <OttoAgentView
        apps={[]}
        status={SAMPLE_STATUS}
        policies={SAMPLE_POLICIES}
        l4Invariants={SAMPLE_L4}
        traces={SAMPLE_TRACES}
        proposals={SAMPLE_PROPOSALS}
        initialSubView="policies"
        initialSubViewNonce={1}
        onRefreshOtto={vi.fn().mockResolvedValue(undefined)}
        onToggleKillSwitch={vi.fn().mockResolvedValue(undefined)}
        onAbortStep={vi.fn().mockResolvedValue(undefined)}
        onResetCircuitBreaker={vi.fn().mockResolvedValue(undefined)}
        onUpdatePolicyMode={vi.fn().mockResolvedValue(undefined)}
        onDecideProposal={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(policiesHtml).toContain('Otto AI SRE');
    expect(policiesHtml).toContain('L4-01');
    expect(policiesHtml).toContain('L4-06');
    expect(policiesHtml).toContain('Zero Arbitrary Shell Execution');
    expect(policiesHtml).toContain('Global Kill-Switch');
    expect(policiesHtml).not.toContain('<select');

    const tracesHtml = renderToStaticMarkup(
      <OttoAgentView
        apps={[]}
        status={SAMPLE_STATUS}
        policies={SAMPLE_POLICIES}
        l4Invariants={SAMPLE_L4}
        traces={SAMPLE_TRACES}
        proposals={SAMPLE_PROPOSALS}
        initialSubView="traces"
        initialSubViewNonce={1}
        onRefreshOtto={vi.fn().mockResolvedValue(undefined)}
        onToggleKillSwitch={vi.fn().mockResolvedValue(undefined)}
        onAbortStep={vi.fn().mockResolvedValue(undefined)}
        onResetCircuitBreaker={vi.fn().mockResolvedValue(undefined)}
        onUpdatePolicyMode={vi.fn().mockResolvedValue(undefined)}
        onDecideProposal={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(tracesHtml).toContain('310 thought');
    expect(tracesHtml).toContain('Inspect Trace &amp; Thinking');

    const approvalsHtml = renderToStaticMarkup(
      <OttoAgentView
        apps={[]}
        status={SAMPLE_STATUS}
        policies={SAMPLE_POLICIES}
        l4Invariants={SAMPLE_L4}
        traces={SAMPLE_TRACES}
        proposals={SAMPLE_PROPOSALS}
        initialSubView="approvals"
        initialSubViewNonce={1}
        onRefreshOtto={vi.fn().mockResolvedValue(undefined)}
        onToggleKillSwitch={vi.fn().mockResolvedValue(undefined)}
        onAbortStep={vi.fn().mockResolvedValue(undefined)}
        onResetCircuitBreaker={vi.fn().mockResolvedValue(undefined)}
        onUpdatePolicyMode={vi.fn().mockResolvedValue(undefined)}
        onDecideProposal={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(approvalsHtml).toContain('DETECTION_DEFECT_SUSPECTED');
    expect(approvalsHtml).toContain('Approve &amp; Execute');
  });

  it('DietPiHardwareNetworkCard displays live Suricata SSH SYN budget and PriorityAttentionQueue renders Ask Otto CTA', () => {
    const topology = synthesizeTopology([], null, null);
    const cardHtml = renderToStaticMarkup(
      <DietPiHardwareNetworkCard topology={topology} suricataStatus={SAMPLE_STATUS.suricata} />
    );
    expect(cardHtml).toContain('sre-agent-wsh Forced-Command Gatekeeper');
    expect(cardHtml).toContain('Verified · Ed25519');
    expect(cardHtml).toContain('Nominal · 1 / 2 SYNs per 120s');

    const queueHtml = renderToStaticMarkup(
      <PriorityAttentionQueue
        isInitialSyncComplete={true}
        pendingAgentApprovalsCount={1}
        incidents={[
          {
            id: 'inc-1',
            domain: 'threat',
            domainLabel: 'Threat SOC',
            severity: 'warning',
            title: 'Unexplained inside-perimeter alert',
            detail: 'Possible roaming IP false positive',
            primaryAction: { kind: 'open_threat', label: 'Inspect Threat' },
          },
        ]}
        onAction={vi.fn()}
        onAskOtto={vi.fn()}
      />
    );
    expect(queueHtml).toContain('1 L3 APPROVAL');
    expect(queueHtml).toContain('Ask Otto');
  });

  it('Console dock policy keeps Otto background agent streams in quiet Tier C (zero focus steal)', () => {
    expect(
      shouldAutoOpenOnJobStart({
        tier: 'A',
        source: 'agent',
        mode: 'smart',
        jobId: 'agent-probe-1',
        dismissedIds: new Set(),
      })
    ).toBe(false);

    expect(
      shouldAutoOpenOnJobFinish({
        exitCode: 1,
        source: 'agent',
        mode: 'smart',
      })
    ).toBe(false);
  });

  it('OttoMarkdownRenderer renders headings, bold+code, italics, lists, code blocks, tables, blockquotes, and strips unsafe links', () => {
    const sampleMd = [
      '### 1. Threat & False-Positive Triage',
      '- **Contextualize Threat SOC Findings:** Evaluates *actual* exposure on `parakith.com` (`NOISE_SAFE_DROP`).',
      '- **`L2_AUTO` (Autonomous):** `create_bug_handoff` without mutating prod.',
      '',
      '*(Note: Your circuit breaker is `CLOSED` and `sre-agent-wsh` is standby.)*',
      '',
      '> **Policy Kernel Hard-Block (L4-06):** Never blocks protected IPs.',
      '',
      '```json',
      '{"verdict": "NOISE_SAFE_DROP"}',
      '```',
      '',
      '| Domain | Status |',
      '| --- | --- |',
      '| Auth | `HEALTHY` |',
      '',
      'Safe [Docs](https://wsh.panoramadr.com) and unsafe [XSS](javascript:alert(1)).',
    ].join('\n');

    const html = renderToStaticMarkup(<OttoMarkdownRenderer markdown={sampleMd} />);

    expect(html).toContain('<h4');
    expect(html).toContain('1. Threat &amp; False-Positive Triage');
    expect(html).toContain('<ul');
    expect(html).toContain('<strong');
    expect(html).toContain('<em');
    expect(html).toContain('<code');
    expect(html).toContain('NOISE_SAFE_DROP');
    expect(html).toContain('L2_AUTO');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<pre');
    expect(html).toContain('<table');
    expect(html).toContain('href="https://wsh.panoramadr.com"');
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('### 1.');
    expect(html).not.toContain('**Contextualize');
  });
});
