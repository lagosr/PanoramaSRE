import { describe, it, expect } from 'vitest';
import {
  auditFleetCrons,
  computeDietPiBadges,
  mergeLocalManifestRefresh,
  normalizeDiscoveredManifest,
  renderExpectedCronFile,
  sha256Utf8,
  type RawDiscoveredSuiteApp,
} from '../cron-auditor';
import { buildCronSyncCommand } from '../script-adapters';
import type { DiscoveredApp, WshSnapshot } from '../types';

function makeApp(overrides?: Partial<DiscoveredApp['manifest']['sre']>): DiscoveredApp {
  const scriptSha = sha256Utf8('#!/bin/sh\necho ok\n');
  return {
    manifest: {
      schemaVersion: 1,
      appId: 'energy',
      slug: 'energy',
      hostingTarget: 'wsh-docker',
      displayName: 'EnergyAnalyzer',
      portalTitle: 'EnergyAnalyzer',
      description: 'Energy analyzer',
      basePath: '/energy',
      port: 3005,
      containerName: 'energy-analyzer',
      composeProject: 'energy-analyzer',
      remoteAppRoot: '/opt/energy-analyzer',
      dataVolume: '/var/data/energy-analyzer/data',
      localSqlitePath: 'data/energy.sqlite',
      themeColor: 'green',
      icon: 'Zap',
      portalOrder: 11,
      roles: ['admin'],
      sre: {
        deployScript: 'deploy-docker.ps1',
        dbScript: 'db-manager.ps1',
        devCommand: 'npm run dev',
        healthEndpoint: '/energy/api/health',
        testCommand: 'npm test',
        typecheckCommand: 'npx tsc --noEmit',
        requiresAuthInDev: true,
        automatedBackupDefault: true,
        exposeInRemotePortal: true,
        cronJobs: [
          {
            id: 'heartbeat',
            description: '15m heartbeat',
            schedule: '*/15 * * * *',
            script: 'scripts/cron-heartbeat.sh',
            args: [],
            shell: '/bin/sh',
            user: 'root',
            logRedirect: '> /dev/null 2>&1',
            enabled: true,
            localScriptExists: true,
            localScriptSha256: scriptSha,
          },
        ],
        cronLegacyFiles: ['energy-legacy'],
        ...overrides,
      },
    },
    workspacePath: 'C:\\Users\\rodrigo\\Documents\\AG Projects\\EnergyAnalyzer',
    provenanceState: 'IN_SYNC',
  };
}

function makeSnapshot(app: DiscoveredApp, overrides?: Partial<WshSnapshot>): WshSnapshot {
  const rendered = renderExpectedCronFile(app);
  const job = app.manifest.sre.cronJobs![0];
  return {
    mode: '--fast',
    hostname: 'wsh',
    kernel: '6.12',
    uptime_secs: 500,
    dietpi_version: '9.11.0',
    dietpi_update_available: '',
    reboot_required: false,
    rpi_throttled: '0x0',
    services: { lighttpd: 'active', docker: 'active', ssh: 'active', cron: 'active' },
    listening_ports: [443],
    lighttpd_routes_raw: '',
    containers: [],
    container_stats: [],
    images: [],
    cloudflared: {},
    apt_upgradable_raw: '',
    data_volumes_raw: '',
    docker_df: [],
    release_ledgers: {},
    cron_telemetry: {
      cron_d_files: [
        {
          name: 'e2scrub_all',
          mode: '644',
          owner: 'root:root',
          has_crlf: false,
          ends_with_newline: true,
          content_sha256: 'abc',
          content_raw: '10 3 * * * root /sbin/e2scrub_all\n',
        },
        {
          name: rendered.cronFileName,
          mode: '644',
          owner: 'root:root',
          has_crlf: false,
          ends_with_newline: true,
          content_sha256: rendered.contentSha256,
          content_raw: rendered.content,
        },
      ],
      app_scripts: [
        {
          app_dir: 'energy-analyzer',
          script_name: 'cron-heartbeat.sh',
          path: '/opt/energy-analyzer/scripts/cron-heartbeat.sh',
          mode: '700',
          owner: 'root:root',
          has_crlf: false,
          sha256: job.localScriptSha256!,
          syntax_ok: true,
        },
      ],
      recent_runs_raw:
        '2026-11-19T20:00:01-07:00 wsh CRON[100]: (root) CMD (/opt/energy-analyzer/scripts/cron-heartbeat.sh > /dev/null 2>&1)',
    },
    ...overrides,
  };
}

describe('cron-auditor', () => {
  it('computes LF SHA-256 identically and renders expected /etc/cron.d/panorama-<slug>', () => {
    const app = makeApp();
    const rendered = renderExpectedCronFile(app);
    expect(rendered.cronFileName).toBe('panorama-energy');
    expect(rendered.content.endsWith('\n')).toBe(true);
    expect(rendered.content.includes('\r')).toBe(false);
    expect(rendered.content).toContain('# Managed by PanoramaDeployEngine - DO NOT EDIT MANUALLY');
    expect(rendered.content).toContain('SHELL=/bin/sh');
    expect(rendered.content).toContain('*/15 * * * * root /opt/energy-analyzer/scripts/cron-heartbeat.sh > /dev/null 2>&1');
  });

  it('reports IN_SYNC and isolates system files into unmanagedCronFiles when everything matches', () => {
    const app = makeApp();
    const snap = makeSnapshot(app);
    const summary = auditFleetCrons([app], snap);

    expect(summary.cronServiceActive).toBe(true);
    expect(summary.inSyncCount).toBe(1);
    expect(summary.attentionCount).toBe(0);
    expect(summary.apps[0].status).toBe('IN_SYNC');
    expect(summary.apps[0].jobs[0].lastRunLine).toContain('/opt/energy-analyzer/scripts/cron-heartbeat.sh');
    expect(summary.unmanagedCronFiles.map((f) => f.name)).toEqual(['e2scrub_all']);
  });

  it('reports MISSING when managed cron file and script are absent', () => {
    const app = makeApp();
    const snap = makeSnapshot(app, {
      cron_telemetry: { cron_d_files: [], app_scripts: [], recent_runs_raw: '' },
    });
    const summary = auditFleetCrons([app], snap);
    expect(summary.apps[0].status).toBe('MISSING');
    expect(summary.attentionCount).toBe(1);
  });

  it('reports LEGACY_UNMIGRATED when legacy cron file is active instead of panorama-<slug>', () => {
    const app = makeApp();
    const snap = makeSnapshot(app);
    snap.cron_telemetry!.cron_d_files = [
      {
        name: 'energy-legacy',
        mode: '644',
        owner: 'root:root',
        has_crlf: false,
        ends_with_newline: true,
        content_sha256: 'legacy',
        content_raw: '*/15 * * * * root /opt/energy-analyzer/scripts/cron-heartbeat.sh\n',
      },
    ];
    const summary = auditFleetCrons([app], snap);
    expect(summary.apps[0].status).toBe('LEGACY_UNMIGRATED');
  });

  it('reports DRIFTED when remote script SHA-256 differs from local repository', () => {
    const app = makeApp();
    const snap = makeSnapshot(app);
    snap.cron_telemetry!.app_scripts[0].sha256 = 'deadbeef'.repeat(8);
    const summary = auditFleetCrons([app], snap);
    expect(summary.apps[0].status).toBe('DRIFTED');
    expect(summary.apps[0].jobs[0].shaMatch).toBe(false);
  });

  it('reports INVALID_FORMAT on CRLF, missing trailing newline, or bad script syntax', () => {
    const app = makeApp();
    const snap = makeSnapshot(app);
    snap.cron_telemetry!.cron_d_files[1].ends_with_newline = false;
    snap.cron_telemetry!.app_scripts[0].syntax_ok = false;
    const summary = auditFleetCrons([app], snap);
    expect(summary.apps[0].status).toBe('INVALID_FORMAT');
    expect(summary.apps[0].issues.some((i) => i.includes('trailing LF newline'))).toBe(true);
    expect(summary.apps[0].issues.some((i) => i.includes('syntax validation'))).toBe(true);
  });

  it('reports DAEMON_DOWN when host cron service is inactive', () => {
    const app = makeApp();
    const snap = makeSnapshot(app, { services: { lighttpd: 'active', docker: 'active', ssh: 'active', cron: 'inactive' } });
    const summary = auditFleetCrons([app], snap);
    expect(summary.apps[0].status).toBe('DAEMON_DOWN');
    expect(summary.cronServiceActive).toBe(false);
  });

  it('builds WshRemoteMutation vs None Invoke-CronSync commands accurately', () => {
    const syncCmd = buildCronSyncCommand('C:\\Users\\rodrigo\\Documents\\AG Projects', { allApps: true });
    expect(syncCmd.lockType).toBe('WshRemoteMutation');
    expect(syncCmd.args).toContain('-AllApps');
    expect(syncCmd.scriptPath).toContain('PanoramaDeployEngine\\engine\\Invoke-CronSync.ps1');

    const dryRunCmd = buildCronSyncCommand('C:\\Users\\rodrigo\\Documents\\AG Projects', {
      appPath: 'C:\\Users\\rodrigo\\Documents\\AG Projects\\EnergyAnalyzer',
      testMode: true,
    });
    expect(dryRunCmd.lockType).toBe('None');
    expect(dryRunCmd.args).toContain('-Test');
    expect(dryRunCmd.args).toContain('-AppPath');

    const testRunCmd = buildCronSyncCommand('C:\\Users\\rodrigo\\Documents\\AG Projects', {
      appPath: 'C:\\Users\\rodrigo\\Documents\\AG Projects\\EnergyAnalyzer',
      testRunJobId: 'heartbeat',
    });
    expect(testRunCmd.lockType).toBe('WshRemoteMutation');
    expect(testRunCmd.args).toContain('-TestRunJobId');
    expect(testRunCmd.args).toContain('heartbeat');

    expect(() =>
      buildCronSyncCommand('C:\\Users\\rodrigo\\Documents\\AG Projects', {
        appPath: 'C:\\Users\\rodrigo\\Documents\\AG Projects\\EnergyAnalyzer',
        testRunJobId: 'heartbeat; rm -rf /',
      })
    ).toThrow(/Invalid cron job ID/);
  });
});

describe('computeDietPiBadges', () => {
  it('returns zeroed neutral badges before the initial WSH snapshot loads', () => {
    const app = makeApp();
    const summary = auditFleetCrons([app], null);
    const badges = computeDietPiBadges(null, summary);
    expect(badges.totalCount).toBe(0);
    expect(badges.severity).toBeNull();
    expect(badges.tabs.host).toEqual({ count: 0, severity: null });
    expect(badges.tabs.crons).toEqual({ count: 0, severity: null });
  });

  it('surfaces pending cron updates on both SidebarRail and Scheduled Crons tab even when APT is clean', () => {
    const app = makeApp();
    const snap = makeSnapshot(app);
    snap.cron_telemetry!.cron_d_files = [];
    const summary = auditFleetCrons([app], snap);
    const badges = computeDietPiBadges(snap, summary);

    expect(badges.tabs.host).toEqual({ count: 0, severity: null });
    expect(badges.tabs.crons).toEqual({ count: 1, severity: 'warning' });
    expect(badges.totalCount).toBe(1);
    expect(badges.severity).toBe('warning');
  });

  it('combines APT/OS update counts with cron attention counts into DietPi sidebar totalCount', () => {
    const app = makeApp();
    const snap = makeSnapshot(app, {
      apt_upgradable_raw: 'Listing...\ncurl/stable 8.0\ngit/stable 2.40\n',
      dietpi_update_available: 'v9.10.0',
    });
    snap.cron_telemetry!.app_scripts[0].sha256 = 'deadbeef'.repeat(8);
    const summary = auditFleetCrons([app], snap);
    const badges = computeDietPiBadges(snap, summary);

    expect(badges.tabs.host).toEqual({ count: 3, severity: 'warning' });
    expect(badges.tabs.crons).toEqual({ count: 1, severity: 'warning' });
    expect(badges.totalCount).toBe(4);
    expect(badges.severity).toBe('warning');
  });

  it('escalates badge severity to error when cron daemon is down or reboot is required', () => {
    const app = makeApp();
    const snap = makeSnapshot(app, {
      services: { lighttpd: 'active', docker: 'active', ssh: 'active', cron: 'inactive' },
    });
    const summary = auditFleetCrons([app], snap);
    const cronErrorBadges = computeDietPiBadges(snap, summary);
    expect(cronErrorBadges.tabs.crons.severity).toBe('error');
    expect(cronErrorBadges.severity).toBe('error');

    const okSnap = makeSnapshot(app, { reboot_required: true });
    const okSummary = auditFleetCrons([app], okSnap);
    const rebootBadges = computeDietPiBadges(okSnap, okSummary);
    expect(rebootBadges.tabs.host).toEqual({ count: 1, severity: 'error' });
    expect(rebootBadges.tabs.crons).toEqual({ count: 0, severity: null });
    expect(rebootBadges.totalCount).toBe(1);
    expect(rebootBadges.severity).toBe('error');
  });

  it('clears all badges once crons are IN_SYNC and host packages are current', () => {
    const app = makeApp();
    const snap = makeSnapshot(app);
    const summary = auditFleetCrons([app], snap);
    const badges = computeDietPiBadges(snap, summary);
    expect(badges.totalCount).toBe(0);
    expect(badges.severity).toBeNull();
    expect(badges.tabs.host).toEqual({ count: 0, severity: null });
    expect(badges.tabs.crons).toEqual({ count: 0, severity: null });
  });
});

function makeRawDiscovered(app: DiscoveredApp, shaOverride?: string, scheduleOverride?: string): RawDiscoveredSuiteApp {
  return {
    workspace_path: app.workspacePath,
    manifest_path: `${app.workspacePath}\\panorama.app.json`,
    manifest: {
      schemaVersion: 1,
      app_id: app.manifest.appId,
      slug: app.manifest.slug,
      hostingTarget: app.manifest.hostingTarget,
      display_name: app.manifest.displayName,
      portal_title: app.manifest.portalTitle,
      description: app.manifest.description,
      base_path: app.manifest.basePath,
      port: app.manifest.port,
      container_name: app.manifest.containerName,
      remote_app_root: app.manifest.remoteAppRoot,
      data_volume: app.manifest.dataVolume,
      local_sqlite_path: app.manifest.localSqlitePath,
      theme_color: app.manifest.themeColor,
      icon: app.manifest.icon,
      hasDatabase: true,
      portalOrder: app.manifest.portalOrder,
      sre: {
        ...app.manifest.sre,
        cronJobs: (app.manifest.sre.cronJobs || []).map((job, idx) =>
          idx === 0
            ? {
                ...job,
                schedule: scheduleOverride ?? job.schedule,
                localScriptSha256: shaOverride ?? job.localScriptSha256,
              }
            : job
        ),
      },
    },
  };
}

describe('mergeLocalManifestRefresh & normalizeDiscoveredManifest', () => {
  it('detects local script SHA-256 changes into DRIFTED + cron badges while preserving live telemetry', () => {
    const initialApp = makeApp();
    initialApp.health = { status: 'healthy', version: '0.1.1' };
    initialApp.provenanceState = 'IN_SYNC';
    initialApp.latencyMs = 42;
    initialApp.devServer = {
      app_id: 'energy',
      port: 3005,
      status: 'RUNNING_MANAGED',
      pid: 1234,
      base_path: '/energy',
      local_url: 'http://127.0.0.1:3005/energy',
      sqlite_path: 'data/energy.sqlite',
      sqlite_size_bytes: 4096,
      sqlite_user_version: 4,
    };
    const snap = makeSnapshot(initialApp);
    expect(auditFleetCrons([initialApp], snap).apps[0].status).toBe('IN_SYNC');

    const updatedSha = sha256Utf8('#!/bin/sh\necho updated\n');
    const raw = makeRawDiscovered(initialApp, updatedSha);
    const refreshedApps = mergeLocalManifestRefresh([initialApp], [raw]);

    expect(refreshedApps).toHaveLength(1);
    const refreshed = refreshedApps[0];
    expect(refreshed.health).toEqual(initialApp.health);
    expect(refreshed.provenanceState).toBe('IN_SYNC');
    expect(refreshed.latencyMs).toBe(42);
    expect(refreshed.devServer).toEqual(initialApp.devServer);
    expect(refreshed.manifest.sre.cronJobs?.[0].localScriptSha256).toBe(updatedSha);

    const summary = auditFleetCrons(refreshedApps, snap);
    expect(summary.apps[0].status).toBe('DRIFTED');
    expect(summary.apps[0].jobs[0].shaMatch).toBe(false);

    const badges = computeDietPiBadges(snap, summary);
    expect(badges.tabs.crons).toEqual({ count: 1, severity: 'warning' });
    expect(badges.totalCount).toBe(1);
  });

  it('updates expectedCronContent and triggers DRIFTED when local cron schedule changes', () => {
    const initialApp = makeApp();
    const snap = makeSnapshot(initialApp);
    const raw = makeRawDiscovered(initialApp, undefined, '*/5 * * * *');
    const refreshedApps = mergeLocalManifestRefresh([initialApp], [raw]);

    const summary = auditFleetCrons(refreshedApps, snap);
    expect(summary.apps[0].expectedCronContent).toContain('*/5 * * * * root /opt/energy-analyzer/scripts/cron-heartbeat.sh');
    expect(summary.apps[0].status).toBe('DRIFTED');
  });

  it('handles empty discovery payloads safely and initializes newly discovered apps cleanly', () => {
    const existingApp = makeApp();
    const existingList = [existingApp];
    expect(mergeLocalManifestRefresh(existingList, [])).toBe(existingList);

    const normalized = normalizeDiscoveredManifest({
      slug: 'spendy',
      display_name: 'SpendyLedger',
      base_path: '/spendy',
      port: 3001,
    });
    expect(normalized.appId).toBe('spendy');
    expect(normalized.remoteAppRoot).toBe('/var/data/spendy');

    const added = mergeLocalManifestRefresh(existingList, [
      {
        workspace_path: 'C:\\Users\\rodrigo\\Documents\\AG Projects\\SpendyLedger',
        manifest_path: 'C:\\Users\\rodrigo\\Documents\\AG Projects\\SpendyLedger\\panorama.app.json',
        manifest: {
          app_id: 'spendy',
          slug: 'spendy',
          display_name: 'SpendyLedger',
          base_path: '/spendy',
          port: 3001,
        },
      },
    ]);
    expect(added).toHaveLength(1);
    expect(added[0].provenanceState).toBe('UNKNOWN');
    expect(added[0].latencyMs).toBe(0);
    expect(added[0].manifest.appId).toBe('spendy');
  });
});
