import { describe, it, expect } from 'vitest';
import { auditFleetCrons, renderExpectedCronFile, sha256Utf8 } from '../cron-auditor';
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
