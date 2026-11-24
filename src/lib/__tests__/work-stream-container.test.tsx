import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { computeIsNearBottom } from '../../hooks/useSmartAutoScroll';
import { filterTabsForScope, inferPageScopeFromJob } from '../stream-utils';
import { NavSectionId, SmokeTestRun, TerminalTab } from '../types';
import {
  getStreamStatusMeta,
  shouldAutoExpandStream,
  WorkStreamContainer,
} from '../../components/ui/WorkStreamContainer';
import {
  correlateSmokeRunsAndStreams,
  extractSmokeTabTrigger,
  isSmokeSuiteStreamTab,
  resolveEffectiveSmokeStreamState,
  resolveRunSelectionView,
  SmokeTestsView,
} from '../../components/smoke/SmokeTestsView';
import { SslProgressInline } from '../../components/edge/SslProgressInline';

describe('Smart Auto-Scroll & Stream Routing Utilities', () => {
  it('detects near-bottom scroll pin state accurately within the 32px threshold', () => {
    expect(computeIsNearBottom(500, 800, 270)).toBe(true); // 30px <= 32px
    expect(computeIsNearBottom(498, 800, 270)).toBe(true); // exact 32px boundary
    expect(computeIsNearBottom(497, 800, 270)).toBe(false); // 33px > 32px (scrolled upward)
    expect(computeIsNearBottom(0, 100, 240)).toBe(true); // short viewport
  });

  it('infers all 9 page scopes deterministically and honors explicit pageScope override', () => {
    const cases: Array<[string, NavSectionId]> = [
      ['hud-sync-1', 'hud'],
      ['dev-spendy-1', 'local-dev'],
      ['deploy-biomed-1', 'releases'],
      ['rollback-water-1', 'releases'],
      ['cf-tunnel-restart-1', 'topology'],
      ['audit-penetration-1', 'topology'],
      ['reboot-wsh-1', 'dietpi'],
      ['ssl-renew-1', 'edge'],
      ['gfs-backup-1', 'backups'],
      ['smoke-1', 'smoke'],
      ['unifi-siem-test-1', 'settings'],
      ['settings-op-1', 'settings'],
    ];

    for (const [id, expected] of cases) {
      expect(inferPageScopeFromJob(id)).toBe(expected);
    }

    // Explicit pageScope always wins over ID heuristic (e.g., HUD triggering backup/hardening)
    expect(inferPageScopeFromJob('gfs-backup-1', 'hud')).toBe('hud');
    expect(inferPageScopeFromJob('reapply-hardening-1', 'topology')).toBe('topology');
  });

  it('filters stream tabs by pageScope and optional appSlugFilter', () => {
    const tabs: TerminalTab[] = [
      {
        id: 'deploy-spendy-1',
        title: 'Deploy: SpendyLedger',
        lines: ['Building SpendyLedger...'],
        isRunning: false,
        exitCode: 0,
        pageScope: 'releases',
        appSlug: 'spendy',
      },
      {
        id: 'deploy-biomed-1',
        title: 'Deploy: BiomedMaven',
        lines: ['Building BiomedMaven...'],
        isRunning: true,
        pageScope: 'releases',
        appSlug: 'biomed',
      },
      {
        id: 'smoke-1',
        title: 'Smoke Tests (sre-manual)',
        lines: ['[PASS] All checks ok'],
        isRunning: false,
        exitCode: 0,
        pageScope: 'smoke',
      },
    ];

    const biomedOnly = filterTabsForScope(tabs, 'releases', 'biomed');
    expect(biomedOnly).toHaveLength(1);
    expect(biomedOnly[0].id).toBe('deploy-biomed-1');

    const smokeOnly = filterTabsForScope(tabs, 'smoke');
    expect(smokeOnly).toHaveLength(1);
    expect(smokeOnly[0].id).toBe('smoke-1');
  });
});

describe('WorkStreamContainer Rest/Active Behavior & Markup', () => {
  it('classifies stream status metadata and auto-expand transitions accurately', () => {
    expect(getStreamStatusMeta(null).state).toBe('idle');
    expect(getStreamStatusMeta(null).label).toBe('STANDBY');

    expect(
      getStreamStatusMeta({
        id: 'j1',
        title: 'Build',
        lines: [],
        isRunning: true,
      }).state
    ).toBe('running');

    expect(
      getStreamStatusMeta({
        id: 'j2',
        title: 'Build',
        lines: ['done'],
        isRunning: false,
        exitCode: 0,
      }).label
    ).toContain('EXIT 0');

    expect(
      getStreamStatusMeta({
        id: 'j3',
        title: 'Build',
        lines: ['boom'],
        isRunning: false,
        exitCode: 2,
      }).label
    ).toBe('FAILED (EXIT 2)');

    expect(shouldAutoExpandStream(false, true, null, 'j1')).toBe(true);
    expect(shouldAutoExpandStream(true, true, 'j1', 'j2')).toBe(true);
    expect(shouldAutoExpandStream(true, false, 'j1', null)).toBe(false);
    expect(shouldAutoExpandStream(false, false, 'j1', 'j1')).toBe(false);
  });

  it('renders Rest state with anchored controls but hides stream log viewport', () => {
    const completedTab: TerminalTab = {
      id: 'smoke-100',
      title: 'Smoke Tests (sre-manual)',
      lines: ['[PASS] Gateway OK'],
      isRunning: false,
      exitCode: 0,
      pageScope: 'smoke',
      createdAt: '2026-11-13T10:00:00Z',
      finishedAt: '2026-11-13T10:00:05Z',
    };

    const html = renderToStaticMarkup(
      <WorkStreamContainer
        pageScope="smoke"
        title="Smoke Test Execution Stream"
        tabs={[completedTab]}
        onOpenInBottomConsole={() => {}}
      />
    );

    expect(html).toContain('data-stream-state="rest"');
    expect(html).toContain('Smoke Test Execution Stream');
    expect(html).toContain('Copy Output');
    expect(html).toContain('Bottom Console');
    expect(html).toContain('Show Stream');
    expect(html).not.toContain('role="log"');
    expect(html.toLowerCase()).not.toContain('<select');
  });

  it('renders Active state automatically when a job is running and includes progressSlot without native select', () => {
    const runningTab: TerminalTab = {
      id: 'deploy-biomed-200',
      title: 'Deploy: BiomedMaven',
      lines: ['\x1b[32m[PASS] TypeScript pre-check\x1b[0m', 'Building Docker layers...'],
      isRunning: true,
      pageScope: 'releases',
      source: 'ui',
      appSlug: 'biomed',
      abortable: true,
      createdAt: '2026-11-13T10:05:00Z',
    };

    const html = renderToStaticMarkup(
      <WorkStreamContainer
        pageScope="releases"
        appSlugFilter="biomed"
        title="Release & Rollback Stream"
        tabs={[runningTab]}
        progressSlot={<div data-testid="stage-stepper">Stage 2 of 6: Docker Buildx</div>}
        onOpenInBottomConsole={() => {}}
        onAbortJob={() => {}}
        onClearTab={() => {}}
      />
    );

    expect(html).toContain('data-stream-state="active"');
    expect(html).toContain('role="log"');
    expect(html).toContain('Collapse');
    expect(html).toContain('Pinned');
    expect(html).toContain('Abort');
    expect(html).toContain('Stage 2 of 6: Docker Buildx');
    expect(html.replace(/<[^>]+>/g, '')).toContain('[PASS] TypeScript pre-check');
    expect(html).toContain('Building Docker layers...');
    expect(html).not.toContain('\x1b');
    expect(html.toLowerCase()).not.toContain('<select');
  });

  it('guards Edge PKI progressSlot against showing ACME device checklist on probe/sync runs', () => {
    const probeTab: TerminalTab = {
      id: 'ssl-probe-123',
      title: 'Re-probe 7-Domain SSL Fleet',
      lines: ['[PASS] SSL fleet dual-probe verification completed.'],
      isRunning: false,
      exitCode: 0,
      pageScope: 'edge',
    };

    const probeHtml = renderToStaticMarkup(
      <WorkStreamContainer
        pageScope="edge"
        title="PKI Certificate Issuance & Fleet Deployment Stream"
        tabs={[probeTab]}
        defaultExpandedOnMount={true}
        progressSlot={(tab) =>
          tab && tab.id.startsWith('ssl-renew-') ? <SslProgressInline activeJob={tab} /> : null
        }
      />
    );
    expect(probeHtml).toContain('Re-probe 7-Domain SSL Fleet');
    expect(probeHtml).not.toContain('Device Deployment Checklist');
    expect(probeHtml).not.toContain('STAGE 1 OF 4');

    const renewTab: TerminalTab = {
      id: 'ssl-renew-124',
      title: 'SSL Fleet Renewal',
      lines: ['Initiating Cloudflare DNS-01 challenge...'],
      isRunning: true,
      pageScope: 'edge',
    };

    const renewHtml = renderToStaticMarkup(
      <WorkStreamContainer
        pageScope="edge"
        title="PKI Certificate Issuance & Fleet Deployment Stream"
        tabs={[renewTab]}
        progressSlot={(tab) =>
          tab && tab.id.startsWith('ssl-renew-') ? <SslProgressInline activeJob={tab} /> : null
        }
      />
    );
    expect(renewHtml).toContain('Checklist');
    expect(renewHtml).toContain('ACME DNS-01');
  });
});

describe('SmokeTestsView <-> WorkStreamContainer Bidirectional Sync', () => {
  const buildRun = (
    id: string,
    timestamp: string,
    triggeredBy: string,
    passed = 32,
    total = 32
  ): SmokeTestRun => ({
    id,
    timestamp,
    targetUrl: 'https://wsh.panoramadr.com',
    triggeredBy,
    envOnly: false,
    total,
    passed,
    failed: total - passed,
    results: [
      {
        name: 'PanoramaAuth: /api/health',
        category: 'Health',
        passed: true,
        durationMs: 120,
        detail: 'v1.0.6 (production)',
      },
    ],
  });

  it('correlates smoke runs and streams 1-to-1 across triggers, SQLite UTC strings, and rapid consecutive runs', () => {
    // 2026-11-15T15:00:04.526Z headless scheduled run (no stream)
    // 2026-11-15T15:00:44.552Z UI/scheduled run (has stream)
    // 2026-11-15T15:27:46.336Z mcp-agent run (has stream)
    // Two rapid back-to-back sre-manual runs 6 seconds apart
    const runMcp = buildRun('smoke_1794756466336', '2026-11-15T15:27:46.336Z', 'mcp-agent');
    const runSchedUi = buildRun('smoke_1794754844552', '2026-11-15T15:00:44.552Z', 'sre-scheduled:08:00');
    const runSchedHeadless = buildRun('smoke_1794754804526', '2026-11-15T15:00:04.526Z', 'scheduled');
    const runDeploy = buildRun('smoke_1794719250322', '2026-11-15T05:07:30.322Z', 'deploy:res');
    const runBridgedSched = buildRun('smoke_1794700010000', '2026-11-14T23:46:50.000Z', 'scheduled');

    const runManual2 = buildRun('smoke_1794541878080', '2026-11-13T03:51:18.080Z', 'sre-manual');
    const runManual1 = buildRun('smoke_1794541872277', '2026-11-13T03:51:12.277Z', 'sre-manual');

    const tabs: TerminalTab[] = [
      {
        id: 'smoke-refresh-1794756500000',
        title: 'Reload Smoke Test History',
        lines: ['[PASS] Smoke test run history refreshed.'],
        isRunning: false,
        exitCode: 0,
        pageScope: 'smoke',
        createdAt: '2026-11-15 15:28:20',
        finishedAt: '2026-11-15 15:28:20',
      },
      {
        id: 'smoke-schedule-1794756490000',
        title: 'Register 4x/Day Smoke Schedule',
        lines: ['Task registered.'],
        isRunning: false,
        exitCode: 0,
        pageScope: 'smoke',
        createdAt: '2026-11-15 15:28:10',
        finishedAt: '2026-11-15 15:28:11',
      },
      {
        id: 'smoke-mcp-agent-1794756464175',
        title: 'Smoke Tests (mcp-agent)',
        lines: ['[PanoramaSRE] AI Agent triggered Production Smoke Suite (mcp-agent)...'],
        isRunning: false,
        exitCode: 0,
        pageScope: 'smoke',
        source: 'mcp',
        createdAt: '2026-11-15 15:27:44',
        finishedAt: '2026-11-15 15:27:46',
      },
      {
        id: 'smoke-1794754841636',
        title: 'Smoke Tests (sre-scheduled:08:00)',
        lines: ['=== PanoramaDrSuite Smoke Test [trigger=sre-scheduled:08:00] ==='],
        isRunning: false,
        exitCode: 0,
        pageScope: 'smoke',
        source: 'scheduled',
        createdAt: '2026-11-15 15:00:41',
        finishedAt: '2026-11-15 15:00:44',
      },
      {
        id: 'smoke-scheduled-1794700008000',
        title: 'Smoke Tests (scheduled)',
        lines: ['[PanoramaSRE] OS Scheduled Task triggered Production Smoke Suite (scheduled)...'],
        isRunning: false,
        exitCode: 0,
        pageScope: 'smoke',
        source: 'scheduled',
        createdAt: '2026-11-14 23:46:48',
        finishedAt: '2026-11-14 23:46:50',
      },
      {
        id: 'smoke-1794541877297',
        title: 'Smoke Tests (sre-manual)',
        lines: ['Summary: 32/32 passed'],
        isRunning: false,
        exitCode: 0,
        pageScope: 'smoke',
        createdAt: '2026-11-13 03:51:17',
        finishedAt: '2026-11-13 03:51:18',
      },
      {
        id: 'smoke-1794541871341',
        title: 'Smoke Tests (sre-manual)',
        lines: ['Summary: 32/32 passed'],
        isRunning: false,
        exitCode: 0,
        pageScope: 'smoke',
        createdAt: '2026-11-13 03:51:11',
        finishedAt: '2026-11-13 03:51:12',
      },
    ];

    expect(isSmokeSuiteStreamTab(tabs[0])).toBe(false);
    expect(isSmokeSuiteStreamTab(tabs[1])).toBe(false);
    expect(extractSmokeTabTrigger(tabs[0])).toBeNull();
    expect(extractSmokeTabTrigger(tabs[2])).toBe('mcp-agent');

    const { runToTabId, tabToRunId } = correlateSmokeRunsAndStreams(
      [runMcp, runSchedUi, runSchedHeadless, runDeploy, runBridgedSched, runManual2, runManual1],
      tabs
    );

    expect(runToTabId.get(runMcp.id)).toBe('smoke-mcp-agent-1794756464175');
    expect(tabToRunId.get('smoke-mcp-agent-1794756464175')).toBe(runMcp.id);

    expect(runToTabId.get(runSchedUi.id)).toBe('smoke-1794754841636');
    expect(runToTabId.get(runSchedHeadless.id)).toBeUndefined();
    expect(runToTabId.get(runDeploy.id)).toBeUndefined();

    expect(runToTabId.get(runBridgedSched.id)).toBe('smoke-scheduled-1794700008000');

    // Back-to-back rapid manual runs stay 1-to-1 without swapping
    expect(runToTabId.get(runManual2.id)).toBe('smoke-1794541877297');
    expect(runToTabId.get(runManual1.id)).toBe('smoke-1794541871341');
    expect(tabToRunId.has('smoke-refresh-1794756500000')).toBe(false);
  });

  it('computes history mode and page index when selecting a run from the stream dropdown', () => {
    const nowMs = Date.parse('2026-11-15T16:00:00Z');
    const runs: SmokeTestRun[] = Array.from({ length: 18 }, (_, idx) => ({
      id: `smoke_${idx}`,
      timestamp:
        idx < 16
          ? new Date(nowMs - idx * 3_600_000).toISOString()
          : new Date(nowMs - (idx + 200) * 3_600_000).toISOString(), // > 7 days old for idx 16, 17
      targetUrl: 'https://wsh.panoramadr.com',
      triggeredBy: 'mcp-agent',
      envOnly: false,
      total: 32,
      passed: 32,
      failed: 0,
      results: [],
    }));

    expect(resolveRunSelectionView(runs, 'smoke_3', 'last10', 10, nowMs)).toEqual({
      historyMode: 'last10',
      currentPage: 1,
    });

    // Item at index 14 is outside Last 10, so switches to Last 7 Days page 2
    expect(resolveRunSelectionView(runs, 'smoke_14', 'last10', 10, nowMs)).toEqual({
      historyMode: 'last7days',
      currentPage: 2,
    });

    // Item older than 7 days lands on appended extra page cleanly
    expect(resolveRunSelectionView(runs, 'smoke_16', 'last10', 10, nowMs)).toEqual({
      historyMode: 'last7days',
      currentPage: 2,
    });

    expect(resolveRunSelectionView(runs, 'missing_id', 'last10', 10, nowMs)).toBeNull();
  });

  it('resolves controlled stream selection priority and renders synchronized SmokeTestsView & WorkStreamContainer markup', () => {
    const runMcp = buildRun('smoke_1794756466336', '2026-11-15T15:27:46.336Z', 'mcp-agent');
    const runSchedUi = buildRun('smoke_1794754844552', '2026-11-15T15:00:44.552Z', 'sre-scheduled:08:00');
    const runHeadless = buildRun('smoke_1794754804526', '2026-11-15T15:00:04.526Z', 'scheduled');
    const runDeploy = buildRun('smoke_1794719250322', '2026-11-15T05:07:30.322Z', 'deploy:res');

    const tabs: TerminalTab[] = [
      {
        id: 'smoke-1794754841636',
        title: 'Smoke Tests (sre-scheduled:08:00)',
        lines: ['SCHEDULED_MARKER_LINE'],
        isRunning: false,
        exitCode: 0,
        pageScope: 'smoke',
        source: 'scheduled',
        createdAt: '2026-11-15 15:00:41',
        finishedAt: '2026-11-15 15:00:44',
      },
      {
        id: 'smoke-mcp-agent-1794756464175',
        title: 'Smoke Tests (mcp-agent)',
        lines: ['MCP_MARKER_LINE'],
        isRunning: false,
        exitCode: 0,
        pageScope: 'smoke',
        source: 'mcp',
        createdAt: '2026-11-15 15:27:44',
        finishedAt: '2026-11-15 15:27:46',
      },
      {
        id: 'smoke-refresh-1794756500000',
        title: 'Reload Smoke Test History',
        lines: ['REFRESH_MARKER_LINE'],
        isRunning: false,
        exitCode: 0,
        pageScope: 'smoke',
        createdAt: '2026-11-15 15:28:20',
        finishedAt: '2026-11-15 15:28:20',
      },
    ];

    const { runToTabId } = correlateSmokeRunsAndStreams(
      [runMcp, runSchedUi, runHeadless, runDeploy],
      tabs
    );

    // Controlled selection matches the specific run even when an unrelated tab is first in sorted order
    const mcpState = resolveEffectiveSmokeStreamState({
      selectedRun: runMcp,
      scopedTabs: tabs,
      runToTabId,
      manualTabOverrideId: null,
    });
    expect(mcpState.selectedTabId).toBe('smoke-mcp-agent-1794756464175');

    // Utility tab manual override stays selected without clearing selectedRun
    const refreshOverrideState = resolveEffectiveSmokeStreamState({
      selectedRun: runMcp,
      scopedTabs: tabs,
      runToTabId,
      manualTabOverrideId: 'smoke-refresh-1794756500000',
    });
    expect(refreshOverrideState.selectedTabId).toBe('smoke-refresh-1794756500000');

    // Running tab always takes top priority over historical selection
    const runningTab: TerminalTab = {
      id: 'smoke-1794757000000',
      title: 'Smoke Tests (sre-manual)',
      lines: ['LIVE_LINE'],
      isRunning: true,
      pageScope: 'smoke',
    };
    const liveState = resolveEffectiveSmokeStreamState({
      selectedRun: runSchedUi,
      scopedTabs: [runningTab, ...tabs],
      runToTabId,
      manualTabOverrideId: null,
    });
    expect(liveState.selectedTabId).toBe('smoke-1794757000000');

    // Deploy run shows Release Pipeline message & no stream content hijack
    const deployState = resolveEffectiveSmokeStreamState({
      selectedRun: runDeploy,
      scopedTabs: tabs,
      runToTabId,
      manualTabOverrideId: null,
    });
    expect(deployState.selectedTabId).toBeNull();
    expect(deployState.unmatchedSelectPlaceholder).toContain('deploy:res');

    // Headless run shows no-stream message cleanly in controlled WorkStreamContainer
    const headlessState = resolveEffectiveSmokeStreamState({
      selectedRun: runHeadless,
      scopedTabs: tabs,
      runToTabId,
      manualTabOverrideId: null,
    });
    expect(headlessState.selectedTabId).toBeNull();

    const unmatchedHtml = renderToStaticMarkup(
      <WorkStreamContainer
        pageScope="smoke"
        title="Smoke Test Execution Stream"
        tabs={tabs}
        selectedTabId={headlessState.selectedTabId}
        unmatchedSelectionMessage={headlessState.unmatchedSelectionMessage}
        unmatchedSelectPlaceholder={headlessState.unmatchedSelectPlaceholder}
        defaultExpandedOnMount={true}
      />
    );
    expect(unmatchedHtml).toContain('No stream captured for selected run');
    expect(unmatchedHtml).toContain('STANDBY');
    expect(unmatchedHtml).not.toContain('SCHEDULED_MARKER_LINE');
    expect(unmatchedHtml).not.toContain('MCP_MARKER_LINE');
    expect(unmatchedHtml.toLowerCase()).not.toContain('<select');

    // Even though `tabs[0]` is sre-scheduled:08:00 and a utility tab is newer in finishedAt,
    // SmokeTestsView's initial selectedRun (runMcp) synchronizes WorkStreamContainer to Smoke Tests (mcp-agent)
    const viewHtml = renderToStaticMarkup(
      <SmokeTestsView
        runs={[runMcp, runSchedUi, runHeadless, runDeploy]}
        isRunning={false}
        terminalTabs={tabs}
        onRunNow={() => {}}
        onRefreshHistory={() => {}}
        onRegisterOsSchedule={() => {}}
      />
    );
    expect(viewHtml).toContain('Smoke Tests (mcp-agent)');
    expect(viewHtml).toContain('>mcp</span>');
    expect(viewHtml).not.toContain('Smoke Tests (sre-scheduled:08:00)');
    expect(viewHtml).not.toContain('No stream captured for selected run');
    expect(viewHtml.toLowerCase()).not.toContain('<select');
  });
});
