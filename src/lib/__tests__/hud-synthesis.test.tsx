import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildHudIncidentQueue,
  buildHudScorecard,
  countAptUpgradable,
  formatUptimeCompact,
  getNextSmokeScheduleSlot,
  type HudSynthesisInput,
} from '../hud-synthesis';
import type {
  ApplianceStatus,
  BackupLedgerSummary,
  DiscoveredApp,
  FleetCronAuditSummary,
  OptInComplianceSnapshot,
  SmokeTestRun,
  SslFleetSummary,
  WshSnapshot,
} from '../types';

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}));

import { CommandCenterView } from '../../components/hud/CommandCenterView';

function makeHttpApp(overrides: Partial<DiscoveredApp> = {}): DiscoveredApp {
  return {
    manifest: {
      schemaVersion: 1,
      appId: 'spendy',
      slug: 'spendy',
      hostingTarget: 'wsh-docker',
      displayName: 'SpendyLedger',
      portalTitle: 'SpendyLedger',
      description: 'Personal finance',
      basePath: '/spendy',
      port: 3001,
      containerName: 'spendy-ledger',
      composeProject: 'spendy-ledger',
      remoteAppRoot: '/opt/spendy-ledger',
      dataVolume: '/var/data/spendy-ledger',
      localSqlitePath: 'data/spendy.sqlite',
      themeColor: 'amber',
      icon: 'Wallet',
      portalOrder: 2,
      roles: ['admin'],
      sre: {
        deployScript: './deploy-docker.ps1',
        dbScript: './db-manager.ps1',
        devCommand: 'npm run dev',
        healthEndpoint: '/spendy/api/health',
        testCommand: 'npm test',
        typecheckCommand: 'npx tsc --noEmit',
        requiresAuthInDev: true,
        automatedBackupDefault: true,
        exposeInRemotePortal: true,
      },
    },
    workspacePath: 'c:\\projects\\SpendyLedger',
    provenanceState: 'IN_SYNC',
    health: {
      status: 'healthy',
      version: '1.2.3',
      deployed_at: '2026-11-24T10:00:00Z',
      database: 'ok',
    },
    latencyMs: 14,
    ...overrides,
  };
}

function makeAppliances(): ApplianceStatus[] {
  return [
    { key: 'ui', name: 'UniFi CloudKey', host: 'ui.panoramadr.com', status: 'ONLINE', http_code: 200, latency_ms: 4 },
    { key: 'protect', name: 'UniFi Protect', host: 'protect.panoramadr.com', status: 'ONLINE', http_code: 200, latency_ms: 6 },
    { key: 'ha', name: 'Home Assistant', host: 'ha.panoramadr.com', status: 'ONLINE', http_code: 200, latency_ms: 5 },
    { key: 'genmon', name: 'Generator Monitor', host: 'genmon.panoramadr.com', status: 'ONLINE', http_code: 200, latency_ms: 8 },
  ];
}

function makeWshSnapshot(overrides: Partial<WshSnapshot> = {}): WshSnapshot {
  return {
    mode: '--fast',
    hostname: 'wsh',
    kernel: '6.12.20',
    uptime_secs: 93720,
    dietpi_version: '9.8.0',
    dietpi_update_available: '',
    reboot_required: false,
    rpi_throttled: '0x0',
    services: { lighttpd: 'active', docker: 'active', ssh: 'active', cron: 'active' },
    listening_ports: [22, 443],
    lighttpd_routes_raw: '',
    containers: [
      { ID: 'c1', Image: 'cloudflare/cloudflared', Names: '/cloudflared', State: 'running', Status: 'Up 2d' },
    ],
    container_stats: [],
    images: [],
    cloudflared: { version_raw: 'cloudflared version 2026.10.6' },
    apt_upgradable_raw: '',
    data_volumes_raw: '',
    docker_df: [],
    release_ledgers: {},
    ...overrides,
  };
}

function makeBackupLedger(overrides: Partial<BackupLedgerSummary> = {}): BackupLedgerSummary {
  return {
    history_file_exists: true,
    ledger_source_path: 'GFS',
    total_runs: 10,
    successful_runs: 10,
    failed_runs: 0,
    runs_7d: 7,
    successful_runs_7d: 7,
    failed_runs_7d: 0,
    daily_pips_7d: [
      { day_label: 'Mon', date: '2026-11-23', status: 'Success', run_count: 1 },
      { day_label: 'Tue', date: '2026-11-24', status: 'Success', run_count: 1 },
    ],
    total_pruned_count: 0,
    last_run_timestamp: '2026-11-24T09:00:00Z',
    last_run_status: 'Success',
    latest_app_details: [
      {
        app_name: 'spendy',
        status: 'Success',
        file: 'spendy.sqlite.gz',
        size_bytes: 1024,
        duration_seconds: 1.2,
      },
    ],
    recent_records: [],
    ...overrides,
  };
}

function makeSslFleet(overrides: Partial<SslFleetSummary> = {}): SslFleetSummary {
  return {
    probed_at: '2026-11-24T10:00:00Z',
    total_domains: 7,
    healthy_count: 7,
    expiring_soon_count: 0,
    critical_count: 0,
    drift_count: 0,
    min_days_remaining: 64,
    items: [],
    ...overrides,
  };
}

function makeBaseInput(overrides: Partial<HudSynthesisInput> = {}): HudSynthesisInput {
  return {
    apps: [makeHttpApp()],
    appliances: makeAppliances(),
    wshSnapshot: makeWshSnapshot(),
    sslFleet: makeSslFleet(),
    backupLedger: makeBackupLedger(),
    isBackupIncidentDismissed: false,
    optInSnapshot: {
      totalCount: 42,
      consentedCount: 40,
      declinedCount: 2,
      last7dCount: 5,
      unreadCount: 0,
      maxId: 42,
      lastSeenId: 42,
      databaseName: 'parakith-opt-ins',
      records: [],
    } satisfies OptInComplianceSnapshot,
    cronSummary: {
      cronServiceActive: true,
      cronServiceStatus: 'active',
      inSyncCount: 5,
      attentionCount: 0,
      apps: [],
      unmanagedCronFiles: [],
    } satisfies FleetCronAuditSummary,
    smokeRuns: [
      {
        id: 'smoke-1',
        timestamp: '2026-11-24T08:00:00Z',
        targetUrl: 'https://wsh.panoramadr.com',
        triggeredBy: 'sre-scheduled:08:00',
        envOnly: false,
        total: 28,
        passed: 28,
        failed: 0,
        results: [],
      } as SmokeTestRun,
    ],
    threatAlertCount: 0,
    threatAlertSeverity: null,
    securityViolationCount: 0,
    failingInvariants: [],
    hardeningPassingCount: 9,
    hardeningTotalCount: 9,
    isInitialSyncComplete: true,
    networkPosture: 'LAN_DIRECT',
    ...overrides,
  };
}

describe('hud-synthesis', () => {
  it('formats compact uptimes, APT counts, and next smoke schedule slot', () => {
    expect(formatUptimeCompact(undefined)).toBe('--');
    expect(formatUptimeCompact(1800)).toBe('30m');
    expect(formatUptimeCompact(93720)).toBe('1d 2h');
    expect(countAptUpgradable('Listing...\nopenssl/stable 3.0\ncurl/stable 8.0\n')).toBe(2);
    expect(
      getNextSmokeScheduleSlot(['08:00', '13:00', '17:00', '22:00'], new Date('2026-11-24T10:15:00'))
    ).toBe('Today 13:00');
    expect(
      getNextSmokeScheduleSlot(['08:00', '13:00', '17:00', '22:00'], new Date('2026-11-24T23:00:00'))
    ).toBe('Tomorrow 08:00');
  });

  describe('buildHudIncidentQueue', () => {
    it('suppresses all incidents before initial sync completes', () => {
      const incidents = buildHudIncidentQueue(
        makeBaseInput({
          isInitialSyncComplete: false,
          securityViolationCount: 2,
          apps: [makeHttpApp({ health: undefined, provenanceState: 'PROD_UNREACHABLE' })],
        })
      );
      expect(incidents).toEqual([]);
    });

    it('returns empty array when all 7 domains are nominal', () => {
      expect(buildHudIncidentQueue(makeBaseInput())).toEqual([]);
    });

    it('collects multi-domain incidents and ranks critical before warning', () => {
      const incidents = buildHudIncidentQueue(
        makeBaseInput({
          wshSnapshot: makeWshSnapshot({ reboot_required: true }),
          sslFleet: makeSslFleet({ expiring_soon_count: 1, min_days_remaining: 18 }),
          threatAlertCount: 2,
          threatAlertSeverity: 'warning',
          smokeRuns: [
            {
              id: 'smoke-bad',
              timestamp: '2026-11-24T13:00:00Z',
              targetUrl: 'https://wsh.panoramadr.com',
              triggeredBy: 'sre-manual',
              envOnly: false,
              total: 28,
              passed: 26,
              failed: 2,
              results: [],
            },
          ],
          securityViolationCount: 1,
          failingInvariants: [
            {
              id: 'SEC-03',
              title: 'Loopback Port Bind',
              category: 'PORT',
              status: 'FAIL',
              details: 'Bound to 0.0.0.0',
              remediation: 'Bind 127.0.0.1',
            },
          ],
        })
      );

      expect(incidents.length).toBe(5);
      // First two should be critical (hardening + smoke) before warnings
      expect(incidents[0].severity).toBe('critical');
      expect(incidents[1].severity).toBe('critical');
      expect(incidents[2].severity).toBe('warning');
      expect(incidents.some((i) => i.domain === 'ssl')).toBe(true);
      expect(incidents.some((i) => i.domain === 'dietpi')).toBe(true);
      expect(incidents.some((i) => i.domain === 'threat')).toBe(true);
    });

    it('surfaces Today Protected label when today backup succeeded but 7d had a failure, and hides when dismissed', () => {
      const ledger = makeBackupLedger({
        failed_runs_7d: 1,
        daily_pips_7d: [
          { day_label: 'Mon', date: '2026-11-23', status: 'Failed', run_count: 1 },
          { day_label: 'Tue', date: '2026-11-24', status: 'Success', run_count: 1 },
        ],
      });

      const active = buildHudIncidentQueue(makeBaseInput({ backupLedger: ledger }));
      expect(active).toHaveLength(1);
      expect(active[0].todayProtectedLabel).toBe('Today Protected (2026-11-24)');
      expect(active[0].primaryAction.kind).toBe('open_backups');

      const dismissed = buildHudIncidentQueue(
        makeBaseInput({ backupLedger: ledger, isBackupIncidentDismissed: true })
      );
      expect(dismissed).toEqual([]);
    });
  });

  describe('buildHudScorecard', () => {
    it('always returns 6 symmetric cards in nominal and syncing states', () => {
      const syncingCards = buildHudScorecard(
        makeBaseInput({ isInitialSyncComplete: false })
      );
      expect(syncingCards).toHaveLength(6);
      expect(syncingCards.slice(0, 5).every((c) => c.tone === 'syncing')).toBe(true);

      const nominalCards = buildHudScorecard(makeBaseInput());
      expect(nominalCards.map((c) => c.id)).toEqual([
        'fleet',
        'security',
        'host',
        'network',
        'pki-dr',
        'smoke-compliance',
      ]);
      expect(nominalCards.every((c) => c.tone === 'healthy')).toBe(true);
      expect(nominalCards[0].headline).toBe('1/1 UP');
      expect(nominalCards[4].headline).toBe('100% GFS (7d)');
      expect(nominalCards[5].headline).toBe('28/28 PASS');
    });
  });

  describe('CommandCenterView Phase 2 SSR rendering', () => {
    it('renders nominal bar, 6 scorecard tiles, and Deploy All Behind CTA with zero native select tags', () => {
      const html = renderToStaticMarkup(
        <CommandCenterView
          apps={[
            makeHttpApp({ provenanceState: 'AHEAD', composition: {
              app_id: 'spendy',
              state: 'AHEAD',
              local_head_sha: 'aaa1111',
              local_head_short: 'aaa1111',
              local_branch: 'main',
              local_dirty: false,
              dirty_files: [],
              prod_sha: 'bbb2222',
              prod_release_id: 'rel-1',
              prod_dirty: false,
              ahead_count: 2,
              behind_count: 0,
              undeployed_commits: [],
              changed_files_since_prod: [],
              blast_radius_badges: [],
              new_env_keys: [],
              recent_candidates: [],
            } }),
          ]}
          appliances={makeAppliances()}
          wshSnapshot={makeWshSnapshot()}
          sslFleet={makeSslFleet()}
          backupLedger={makeBackupLedger()}
          smokeRuns={makeBaseInput().smokeRuns}
          isLoading={false}
          isInitialSyncComplete={true}
          onTriggerDeployAll={vi.fn()}
          onNavigateToRelease={vi.fn()}
        />
      );

      expect(html).toContain('All 7 SRE Domains Nominal');
      expect(html).toContain('Production Fleet');
      expect(html).toContain('Threat &amp; Hardening');
      expect(html).toContain('DietPi WSH Host');
      expect(html).toContain('Network &amp; Tunnel');
      expect(html).toContain('PKI &amp; Backups DR');
      expect(html).toContain('Smoke &amp; Compliance');
      expect(html).toContain('Deploy All Behind (1)');
      expect(html.toLowerCase()).not.toContain('<select');
    });

    it('renders Priority Attention Queue when incidents exist', () => {
      const html = renderToStaticMarkup(
        <CommandCenterView
          apps={[makeHttpApp({ health: undefined, provenanceState: 'PROD_UNREACHABLE' })]}
          appliances={makeAppliances()}
          wshSnapshot={makeWshSnapshot({ reboot_required: true })}
          sslFleet={makeSslFleet()}
          backupLedger={makeBackupLedger()}
          isLoading={false}
          isInitialSyncComplete={true}
        />
      );

      expect(html).toContain('Priority Attention Queue');
      expect(html).toContain('1 Production Application Unhealthy');
      expect(html).toContain('DietPi WSH Kernel / Library Reboot Required');
    });
  });
});
