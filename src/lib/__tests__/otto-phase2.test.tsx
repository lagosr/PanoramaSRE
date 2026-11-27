import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AlertsInboxDrawer } from '../../components/layout/AlertsInboxDrawer';
import { PriorityAttentionQueue } from '../../components/hud/PriorityAttentionQueue';
import { FleetAppCard } from '../../components/hud/FleetAppCard';
import { ReleaseFleetRail } from '../../components/releases/ReleaseFleetRail';
import { ReleasePipelineView } from '../../components/releases/ReleasePipelineView';
import { OttoAgentView } from '../../components/agent/OttoAgentView';
import { SmokeTestsView } from '../../components/smoke/SmokeTestsView';
import { BuildTelemetryView } from '../../components/telemetry/BuildTelemetryView';
import { DietPiHostView } from '../../components/dietpi/DietPiHostView';
import { BackupsRecoveryView } from '../../components/backups/BackupsRecoveryView';
import { SettingsView } from '../../components/settings/SettingsView';
import { ThemeProvider } from '../../context/ThemeContext';
import { shouldAutoOpenOnJobStart, shouldAutoOpenOnJobFinish } from '../console-dock-policy';
import type {
  BackupLedgerSummary,
  DiscoveredApp,
  OttoL4Invariant,
  OttoLifecycleSnapshot,
  OttoPolicyRow,
  OttoProposalRow,
  OttoSoakSessionRow,
  OttoStatusDto,
  OttoTraceRunRow,
  SmokeTestRun,
  WshSnapshot,
} from '../types';
import type { TelemetryActionableAlert } from '../deployHistoryAnalytics';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: vi.fn(),
  revealItemInDir: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

const MOCK_APP: DiscoveredApp = {
  manifest: {
    schemaVersion: 1,
    appId: 'spendy',
    slug: 'spendy',
    hostingTarget: 'wsh-docker',
    displayName: 'SpendyLedger',
    portalTitle: 'SpendyLedger',
    description: 'Finance Tracker',
    basePath: '/spendy',
    port: 3001,
    containerName: 'spendy-ledger',
    composeProject: 'spendy-ledger',
    remoteAppRoot: '/opt/spendy-ledger',
    dataVolume: 'spendy-ledger',
    localSqlitePath: 'data/spendy.sqlite',
    themeColor: 'amber',
    icon: 'DollarSign',
    hasDatabase: true,
    portalOrder: 2,
    roles: ['admin'],
    sre: {
      deployScript: './deploy-docker.ps1',
      dbScript: './db-manager.ps1',
      devCommand: 'npm run dev',
      healthEndpoint: '/api/health',
      manifestEndpoint: '/api/auth/manifest',
      testCommand: 'npm test',
      typecheckCommand: 'npx tsc --noEmit',
      requiresAuthInDev: true,
      automatedBackupDefault: true,
      exposeInRemotePortal: true,
    },
  },
  workspacePath: 'c:\\test\\spendy',
  provenanceState: 'IN_SYNC',
  health: {
    status: 'unhealthy',
    database: 'connected',
    version: '1.2.3',
  },
};

const ACTIVE_SOAK: OttoSoakSessionRow = {
  id: 'soak-spendy-1',
  appSlug: 'spendy',
  hostingTarget: 'wsh-docker',
  releaseId: 'v1.2.3+abc1234',
  previousImageTag: 'v1.2.2-prev',
  hasDbMigration: false,
  startedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  endsAt: new Date(Date.now() + 12 * 60_000).toISOString(),
  status: 'SOAKING',
  samplesJson: JSON.stringify([
    { timestamp: new Date().toISOString(), healthy: true, latencyMs: 42, detail: 'healthy' },
  ]),
  traceRunId: 'trace-soak-1',
  updatedAt: new Date().toISOString(),
};

const SAMPLE_LIFECYCLE: OttoLifecycleSnapshot = {
  state: 'VERIFYING',
  phaseLabel: 'Otto: Soaking (1)',
  activeModel: null,
  thinkingLevel: null,
  currentTarget: 'spendy',
  summary: 'Monitoring 15m post-deploy soak window',
  startedAt: new Date().toISOString(),
  traceRunId: 'trace-soak-1',
  canAbort: false,
  killSwitchActive: false,
  circuitBreakerState: 'CLOSED',
  pendingApprovalsCount: 1,
  activeSoaksCount: 1,
  dailyT1Calls: 1,
  dailyT2Calls: 0,
  droppedNoise24hCount: 5,
};

const SAMPLE_STATUS: OttoStatusDto = {
  lifecycle: SAMPLE_LIFECYCLE,
  agentState: {
    killSwitchActive: false,
    circuitBreakerState: 'CLOSED',
    trippedReason: null,
    trippedAt: null,
    consecutiveFailures: 0,
    dailyT1Calls: 1,
    dailyT2Calls: 0,
    budgetDateUtc: '2026-11-26',
    droppedNoise24hCount: 5,
    updatedAt: '2026-11-26T12:00:00Z',
  },
  suricata: {
    usedLast120s: 0,
    maxPer120s: 2,
    windowSecs: 120,
    remaining: 2,
    nextSlotInSecs: 0,
    gatekeeperKeyPath: 'C:\\Users\\rodrigo\\.ssh\\sre-agent-wsh',
    gatekeeperKeyExists: true,
    gatekeeperVerified: true,
    lastProbeAt: '2026-11-26T12:00:00Z',
    lastProbeDetail: 'Gatekeeper probe-snapshot OK',
  },
  geminiConfigured: true,
  defaultTier1Model: 'gemini-4-hydrogen',
  defaultTier2Model: 'gemini-4-neon',
  dailyT2Cap: 6,
};

const SAMPLE_POLICIES: OttoPolicyRow[] = [
  {
    actionId: 'rollback_n3_db_safe',
    domain: 'HEAL',
    label: 'DB-Safe N-3 Rollback',
    description: 'Reverts Tier-1 container if DB_MIGRATION == false.',
    assetTier: 'TIER1_CHILD_APP',
    mode: 'SHADOW',
    maxAllowedMode: 'L2_AUTO',
    cooldownSecs: 3600,
    shadowRunsCount: 10,
    shadowAgreedCount: 10,
    promotedAt: null,
    updatedAt: '2026-11-26T12:00:00Z',
  },
];

const SAMPLE_L4: OttoL4Invariant[] = [
  {
    id: 'L4-02',
    category: 'Database Safety',
    title: 'Zero Autonomous Production DB Mutation',
    detail: 'Never auto-rolls back when DB_MIGRATION is set.',
  },
];

const SAMPLE_PROPOSALS: OttoProposalRow[] = [
  {
    id: 'prop-l3-1',
    traceRunId: 'trace-soak-1',
    domain: 'HEAL',
    classification: 'RELIABILITY',
    assetSlug: 'spendy',
    assetTier: 'TIER1_CHILD_APP',
    actionId: 'rollback_n3_db_safe',
    paramsJson: '{"previousTag":"v1.2.2-prev","hasDbMigration":true}',
    title: 'Soak Regression: Review Rollback for spendy',
    severity: 'HIGH',
    confidence: 0.94,
    rcaSummary: 'Release carries DB_MIGRATION — auto-rollback blocked by Policy Kernel.',
    evidenceJson: '["probe-fail-1","probe-fail-2"]',
    diffPreview: null,
    rollbackPlanJson: '{"previousTag":"v1.2.2-prev"}',
    blastRadiusFlagsJson: '["DB_MIGRATION"]',
    status: 'PENDING_APPROVAL',
    snoozedUntil: null,
    createdAt: '2026-11-26T12:05:00Z',
    decidedAt: null,
    executedAt: null,
    verificationResultJson: null,
  },
  {
    id: 'prop-shadow-1',
    traceRunId: 'trace-soak-1',
    domain: 'HEAL',
    classification: 'RELIABILITY',
    assetSlug: 'biomed',
    assetTier: 'TIER1_CHILD_APP',
    actionId: 'restart_container',
    paramsJson: '{"containerName":"biomed-maven"}',
    title: '[SHADOW] Restart container biomed-maven',
    severity: 'MEDIUM',
    confidence: 0.89,
    rcaSummary: 'Simulated single-container restart under Shadow Mode.',
    evidenceJson: '[]',
    diffPreview: null,
    rollbackPlanJson: null,
    blastRadiusFlagsJson: '["SHADOW_DRY_RUN"]',
    status: 'SHADOW_LOGGED',
    snoozedUntil: null,
    createdAt: '2026-11-26T12:04:00Z',
    decidedAt: null,
    executedAt: null,
    verificationResultJson: null,
  },
];

const SAMPLE_TRACES: OttoTraceRunRow[] = [
  {
    id: 'trace-soak-1',
    triggerKind: 'SOAK',
    domain: 'HEAL',
    assetSlug: 'spendy',
    finalState: 'COMPLETED',
    modelUsed: null,
    thinkingLevel: null,
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    durationMs: 120,
    outcomeSummary: 'Soak escalated due to DB_MIGRATION guard',
    errorText: null,
    startedAt: '2026-11-26T12:00:00Z',
    completedAt: '2026-11-26T12:05:00Z',
  },
];

describe('Otto AI SRE — Phase 2 Soak Engine, Approval Queue, Pushover & Cross-Tab Ask Otto', () => {
  it('AlertsInboxDrawer places Pending L3 Otto Approvals above 7-domain Active Incidents', () => {
    const html = renderToStaticMarkup(
      <AlertsInboxDrawer
        isOpen={true}
        onClose={vi.fn()}
        pendingOttoProposals={[SAMPLE_PROPOSALS[0]]}
        onOpenOttoApprovals={vi.fn()}
        onSnoozeOttoProposal={vi.fn()}
        onAskOttoProposal={vi.fn()}
        alerts={[
          {
            id: 'alert-backups',
            domain: 'Backups & DR',
            severity: 'critical',
            title: '1 GFS Backup Failure',
            detail: 'Nightly run failed',
            actionLabel: 'Open Backups',
            onAction: vi.fn(),
          },
        ]}
      />
    );

    expect(html).toContain('data-testid="alerts-drawer-otto-approvals"');
    expect(html).toContain('Pending L3 Otto Approvals (1)');
    expect(html).toContain('Soak Regression: Review Rollback for spendy');
    const ottoIdx = html.indexOf('alerts-drawer-otto-approvals');
    const incidentIdx = html.indexOf('1 GFS Backup Failure');
    expect(ottoIdx).toBeGreaterThan(-1);
    expect(incidentIdx).toBeGreaterThan(ottoIdx);
  });

  it('PriorityAttentionQueue renders clickable L3 APPROVALS pill, real approval rows with accurate count, and FleetAppCard renders SOAKING badge + Ask Otto on unhealthy cards', () => {
    const queueHtml = renderToStaticMarkup(
      <PriorityAttentionQueue
        isInitialSyncComplete={true}
        pendingAgentApprovalsCount={1}
        pendingOttoProposals={[SAMPLE_PROPOSALS[0]]}
        onOpenOttoApprovals={vi.fn()}
        onAskOtto={vi.fn()}
        incidents={[]}
        onAction={vi.fn()}
      />
    );
    expect(queueHtml).toContain('1 L3 APPROVAL');
    expect(queueHtml).toContain('Collapse (1)');
    expect(queueHtml).toContain('data-testid="hud-queue-otto-approval-prop-l3-1"');
    expect(queueHtml).toContain('Soak Regression: Review Rollback for spendy');
    expect(queueHtml).toContain('Review &amp; Approve →');
    expect(queueHtml).not.toContain('Expand (0)');

    const summaryFallbackHtml = renderToStaticMarkup(
      <PriorityAttentionQueue
        isInitialSyncComplete={true}
        pendingAgentApprovalsCount={2}
        onOpenOttoApprovals={vi.fn()}
        incidents={[]}
        onAction={vi.fn()}
      />
    );
    expect(summaryFallbackHtml).toContain('2 L3 APPROVALS');
    expect(summaryFallbackHtml).toContain('Collapse (2)');
    expect(summaryFallbackHtml).toContain('data-testid="hud-queue-otto-approval-summary"');

    const cardHtml = renderToStaticMarkup(
      <FleetAppCard
        app={MOCK_APP}
        isInitialSyncComplete={true}
        networkPosture="LAN_DIRECT"
        agentBadge={{ kind: 'soaking', label: 'SOAKING 12m' }}
        onOpenApp={vi.fn()}
        onInspectComposition={vi.fn()}
        onAskOtto={vi.fn()}
      />
    );
    expect(cardHtml).toContain('SOAKING 12m');
    expect(cardHtml).toContain('Ask Otto');
  });

  it('ReleaseFleetRail & ReleasePipelineView render active 15m Post-Deploy Soak Banner and SOAK pill', () => {
    const railHtml = renderToStaticMarkup(
      <ReleaseFleetRail
        apps={[MOCK_APP]}
        selectedSlug="spendy"
        onSelectApp={vi.fn()}
        batchSelectedOrder={[]}
        onToggleBatchSlug={vi.fn()}
        onSelectAllBehindBatch={vi.fn()}
        onClearBatchSelection={vi.fn()}
        onOpenBatchDeploy={vi.fn()}
        onInspectApp={vi.fn()}
        getAppDeployJob={() => undefined}
        isInitialSyncComplete={true}
        networkPosture="LAN_DIRECT"
        ottoSoaks={[ACTIVE_SOAK]}
      />
    );
    expect(railHtml).toContain('data-testid="rail-soak-badge-spendy"');
    expect(railHtml).toContain('SOAK');

    const pipelineHtml = renderToStaticMarkup(
      <ReleasePipelineView
        apps={[MOCK_APP]}
        selectedAppSlug="spendy"
        onTriggerDeploy={vi.fn()}
        onTriggerDeployAll={vi.fn()}
        onTriggerRollback={vi.fn()}
        ottoSoaks={[ACTIVE_SOAK]}
        onCancelSoak={vi.fn()}
        onAskOtto={vi.fn()}
      />
    );
    expect(pipelineHtml).toContain('data-testid="release-soak-banner"');
    expect(pipelineHtml).toContain('Otto 15m Post-Deploy Soak');
    expect(pipelineHtml).toContain('DB-Safe N-3 Eligible');
    expect(pipelineHtml).toContain('Cancel Soak');
    expect(pipelineHtml).toContain('Ask Otto');
  });

  it('OttoAgentView renders Active Soak Sessions, Shadow Graduation Tracker, Full Approval Queue, and zero native <select>', () => {
    const tracesHtml = renderToStaticMarkup(
      <OttoAgentView
        apps={[MOCK_APP]}
        status={SAMPLE_STATUS}
        policies={SAMPLE_POLICIES}
        l4Invariants={SAMPLE_L4}
        traces={SAMPLE_TRACES}
        proposals={SAMPLE_PROPOSALS}
        soaks={[ACTIVE_SOAK]}
        initialSubView="traces"
        initialSubViewNonce={1}
        onRefreshOtto={vi.fn().mockResolvedValue(undefined)}
        onToggleKillSwitch={vi.fn().mockResolvedValue(undefined)}
        onAbortStep={vi.fn().mockResolvedValue(undefined)}
        onResetCircuitBreaker={vi.fn().mockResolvedValue(undefined)}
        onUpdatePolicyMode={vi.fn().mockResolvedValue(undefined)}
        onDecideProposal={vi.fn().mockResolvedValue(undefined)}
        onCancelSoak={vi.fn().mockResolvedValue(undefined)}
        onEvaluateSteadyState={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(tracesHtml).toContain('Post-Deployment 15m Soak Sessions (1 Active)');
    expect(tracesHtml).toContain('Agree (+1)');
    expect(tracesHtml).toContain('Sweep Health &amp; Hygiene');
    expect(tracesHtml).not.toContain('<select');

    const approvalsHtml = renderToStaticMarkup(
      <OttoAgentView
        apps={[MOCK_APP]}
        status={SAMPLE_STATUS}
        policies={SAMPLE_POLICIES}
        l4Invariants={SAMPLE_L4}
        traces={SAMPLE_TRACES}
        proposals={SAMPLE_PROPOSALS}
        soaks={[ACTIVE_SOAK]}
        initialSubView="approvals"
        initialSubViewNonce={1}
        onRefreshOtto={vi.fn().mockResolvedValue(undefined)}
        onToggleKillSwitch={vi.fn().mockResolvedValue(undefined)}
        onAbortStep={vi.fn().mockResolvedValue(undefined)}
        onResetCircuitBreaker={vi.fn().mockResolvedValue(undefined)}
        onUpdatePolicyMode={vi.fn().mockResolvedValue(undefined)}
        onDecideProposal={vi.fn().mockResolvedValue(undefined)}
        onQueueBuildKitPruneProposal={vi.fn().mockResolvedValue(undefined)}
        onAskOtto={vi.fn()}
      />
    );
    expect(approvalsHtml).toContain('Approve &amp; Execute');
    expect(approvalsHtml).toContain('Stage Local BuildKit Prune (L3)');
    expect(approvalsHtml).toContain('Snooze 24h');
    expect(approvalsHtml).not.toContain('<select');

    const policiesHtml = renderToStaticMarkup(
      <OttoAgentView
        apps={[MOCK_APP]}
        status={SAMPLE_STATUS}
        policies={SAMPLE_POLICIES}
        l4Invariants={SAMPLE_L4}
        traces={SAMPLE_TRACES}
        proposals={SAMPLE_PROPOSALS}
        soaks={[ACTIVE_SOAK]}
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
    expect(policiesHtml).toContain('Ready for L2');
    expect(policiesHtml).toContain('100%');
  });

  it('SmokeTestsView, BuildTelemetryView, DietPiHostView, and BackupsRecoveryView expose contextual Ask Otto triggers', () => {
    const failedSmokeRun: SmokeTestRun = {
      id: 'smoke_1700000000000',
      timestamp: '2026-11-26T12:00:00Z',
      targetUrl: 'https://wsh.panoramadr.com',
      triggeredBy: 'sre-manual',
      envOnly: false,
      total: 41,
      passed: 40,
      failed: 1,
      results: [
        {
          name: 'SpendyLedger /api/health',
          category: 'health',
          passed: false,
          detail: 'HTTP 502 Bad Gateway',
          durationMs: 120,
        },
      ],
    };
    const smokeHtml = renderToStaticMarkup(
      <SmokeTestsView
        runs={[failedSmokeRun]}
        isRunning={false}
        onRunNow={vi.fn()}
        onRefreshHistory={vi.fn()}
        onRegisterOsSchedule={vi.fn()}
        onAskOtto={vi.fn()}
      />
    );
    expect(smokeHtml).toContain('data-testid="smoke-ask-otto-btn"');

    const telemetryAlert: TelemetryActionableAlert = {
      id: 'cache-high-1',
      kind: 'cache_high',
      severity: 'warning',
      appName: 'Local Docker BuildKit',
      title: 'Local BuildKit Cache High (42 GB reclaimable)',
      detail: 'Exceeds 35 GB threshold.',
      warnings: ['Prune recommended'],
    };
    const telemetryHtml = renderToStaticMarkup(
      <BuildTelemetryView
        apps={[MOCK_APP]}
        runs={[]}
        dockerDiskUsage={null}
        terminalTabs={[]}
        onRefresh={vi.fn()}
        onPruneBuildKitCache={vi.fn()}
        actionableAlerts={[telemetryAlert]}
        onAskOtto={vi.fn()}
      />
    );
    expect(telemetryHtml).toContain('data-testid="telemetry-ask-otto-cache-high-1"');

    const wshSnap = {
      hostname: 'wsh',
      dietpi_version: 'v9.10',
      kernel: '6.6.51',
      uptime_secs: 86400,
      reboot_required: true,
      rpi_throttled: '0x0',
      apt_upgradable_raw: 'openssl/stable 3.0.15 arm64 [upgradable from: 3.0.14]',
      services: { lighttpd: 'active', docker: 'active', cron: 'active', ssh: 'active' },
      containers: [],
      disk_root: '',
      memory: '',
      firewall: {
        iptables_panorama_input: '',
        iptables_docker_user: '',
        docker_networks_json: '',
      },
      cloudflared: null,
      crontabs: {},
    } as unknown as WshSnapshot;
    const dietpiHtml = renderToStaticMarkup(
      <DietPiHostView
        snapshot={wshSnap}
        apps={[MOCK_APP]}
        isLoading={false}
        onRefresh={vi.fn()}
        onTriggerAction={vi.fn()}
        onTriggerReboot={vi.fn()}
        onAskOtto={vi.fn()}
      />
    );
    expect(dietpiHtml).toContain('data-testid="dietpi-apt-ask-otto-btn"');
    expect(dietpiHtml).toContain('Ask Otto');

    const failedLedger: BackupLedgerSummary = {
      history_file_exists: true,
      ledger_source_path: 'c:\\test\\history.json',
      total_runs: 10,
      successful_runs: 9,
      failed_runs: 1,
      last_run_timestamp: '2026-11-26T04:00:00Z',
      last_run_status: 'Failed',
      runs_7d: 7,
      successful_runs_7d: 6,
      failed_runs_7d: 1,
      daily_pips_7d: [
        { date: '2026-11-26', day_label: 'Thu', status: 'Failed', run_count: 1 },
      ],
      total_pruned_count: 0,
      pruned_per_app: {},
      latest_app_details: [
        {
          app_name: 'SpendyLedger',
          status: 'Failed',
          error: 'SSH timeout',
          file: '',
          size_bytes: 0,
          duration_seconds: 12,
        },
      ],
      recent_records: [],
    };
    const backupsHtml = renderToStaticMarkup(
      <BackupsRecoveryView
        apps={[MOCK_APP]}
        ledger={failedLedger}
        isLoading={false}
        isInitialSyncComplete={true}
        onRefresh={vi.fn()}
        onTriggerFullGfsBackup={vi.fn()}
        onTriggerAppBackup={vi.fn()}
        onApplyLocalBackup={vi.fn()}
        onRestoreRemoteBackup={vi.fn()}
        onAskOtto={vi.fn()}
      />
    );
    expect(backupsHtml).toContain('data-testid="backups-ask-otto-btn"');
  });

  it('Unified Output Console Dock separates quiet L2 background agent streams from human-clicked L3 approvals', () => {
    // Background L2 autonomous action -> source='agent', stays quietly in Tier C
    expect(
      shouldAutoOpenOnJobStart({
        tier: 'C',
        source: 'agent',
        mode: 'smart',
        jobId: 'otto-l2-1',
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

    // Human-clicked L3 Approval Execute -> source='ui', tier='A', auto-opens Console Dock
    expect(
      shouldAutoOpenOnJobStart({
        tier: 'A',
        source: 'ui',
        mode: 'smart',
        jobId: 'otto-l3-1',
        dismissedIds: new Set(),
      })
    ).toBe(true);
  });

  it('SettingsView Notifications tab renders activated Phase 2 Otto Pushover category toggles', () => {
    const html = renderToStaticMarkup(
      <ThemeProvider initialTheme="dark">
        <SettingsView initialTab="notifications" />
      </ThemeProvider>
    );
    expect(html).toContain('Otto AI SRE Notification Channels');
    expect(html).toContain('L2 Auto-Actions Digest');
    expect(html).toContain('L3 Approvals Required');
    expect(html).toContain('Circuit Breaker &amp; Cascade');
  });
});
