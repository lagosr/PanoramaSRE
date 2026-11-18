import { describe, it, expect } from 'vitest';
import { buildSyncAlertEvaluationInput } from '../pushover-payload';
import type {
  BackupLedgerSummary,
  CloudflareTunnelVersionStatus,
  DiscoveredApp,
  SmokeTestRun,
  SslFleetSummary,
  WshSnapshot,
} from '../types';

describe('buildSyncAlertEvaluationInput', () => {
  it('maps healthy, unhealthy, and unreachable suite apps accurately', () => {
    const mockApps: DiscoveredApp[] = [
      {
        manifest: {
          schemaVersion: 1,
          appId: 'auth',
          slug: 'auth',
          displayName: 'PanoramaAuth',
          portalTitle: 'PanoramaAuth',
          description: 'IdP',
          basePath: '/auth',
          port: 3000,
          containerName: 'panorama-auth',
          composeProject: 'panorama-auth',
          remoteAppRoot: '/var/data/panorama-auth',
          dataVolume: '/var/data/panorama-auth/data',
          localSqlitePath: 'data/auth.sqlite',
          themeColor: 'indigo',
          icon: 'Shield',
          portalOrder: 1,
          roles: ['admin'],
          sre: {
            deployScript: './deploy-docker.ps1',
            dbScript: './db-manager.ps1',
            devCommand: 'npm run dev',
            healthEndpoint: '/auth/api/health',
            testCommand: 'npm test',
            typecheckCommand: 'npx tsc --noEmit',
            requiresAuthInDev: false,
            automatedBackupDefault: true,
            exposeInRemotePortal: true,
          },
        },
        workspacePath: 'C:\\Projects\\PanoramaAuth',
        health: { status: 'healthy' },
        provenanceState: 'IN_SYNC',
      },
      {
        manifest: {
          schemaVersion: 1,
          appId: 'biomed',
          slug: 'biomed',
          displayName: 'BiomedMaven',
          portalTitle: 'BiomedMaven',
          description: 'Labs',
          basePath: '/biomed',
          port: 3002,
          containerName: 'biomed-maven',
          composeProject: 'biomed-maven',
          remoteAppRoot: '/var/data/biomed-maven',
          dataVolume: '/var/data/biomed-maven/data',
          localSqlitePath: 'data/biomed.sqlite',
          themeColor: 'emerald',
          icon: 'Activity',
          portalOrder: 2,
          roles: ['admin'],
          sre: {
            deployScript: './deploy-docker.ps1',
            dbScript: './db-manager.ps1',
            devCommand: 'npm run dev',
            healthEndpoint: '/biomed/api/health',
            testCommand: 'npm test',
            typecheckCommand: 'npx tsc --noEmit',
            requiresAuthInDev: true,
            automatedBackupDefault: true,
            exposeInRemotePortal: true,
          },
        },
        workspacePath: 'C:\\Projects\\BiomedMaven',
        health: undefined,
        provenanceState: 'PROD_UNREACHABLE',
      },
    ];

    const dto = buildSyncAlertEvaluationInput({
      maintenanceSuppressed: false,
      apps: mockApps,
    });

    expect(dto.maintenanceSuppressed).toBe(false);
    expect(dto.apps).toHaveLength(2);
    expect(dto.apps?.[0]).toEqual({
      slug: 'auth',
      displayName: 'PanoramaAuth',
      basePath: '/auth',
      status: 'healthy',
      detail: null,
    });
    expect(dto.apps?.[1]).toEqual({
      slug: 'biomed',
      displayName: 'BiomedMaven',
      basePath: '/biomed',
      status: 'unreachable',
      detail: 'No /api/health response',
    });
  });

  it('normalizes WSH updates, tunnel version, SSL dual-probe, and dismissed backup incidents', () => {
    const wsh: WshSnapshot = {
      mode: '--fast',
      hostname: 'wsh',
      kernel: '6.12.20-rpt-rpi-2712',
      uptime_secs: 86400,
      dietpi_version: '9.8.0',
      dietpi_update_available: '9.9.0',
      reboot_required: true,
      rpi_throttled: '0x0',
      services: { lighttpd: 'active', docker: 'active', ssh: 'active' },
      listening_ports: [22, 443],
      lighttpd_routes_raw: '',
      containers: [],
      container_stats: [],
      images: [],
      cloudflared: { version_raw: 'cloudflared version 2026.10.6' },
      apt_upgradable_raw: 'docker-ce/bookworm 5:27.4.0 arm64 [upgradable from: 5:27.3.1]',
      data_volumes_raw: '',
      docker_df: [],
      release_ledgers: {},
    };

    const tunnel: CloudflareTunnelVersionStatus = {
      runningVersion: '2026.10.6',
      latestVersion: '2026.11.0',
      updateAvailable: true,
      releaseUrl: 'https://github.com/cloudflare/cloudflared/releases/tag/2026.11.0',
      checkedAtIso: '2026-11-18T05:00:00Z',
      checkedAtEpoch: 1794978000,
      source: 'github',
    };

    const sslFleet: SslFleetSummary = {
      total_domains: 1,
      healthy_count: 0,
      expiring_soon_count: 1,
      critical_count: 0,
      drift_count: 1,
      min_days_remaining: 21,
      items: [
        {
          device_key: 'Unifi_Cloud_Key_G2',
          display_name: 'UniFi CloudKey G2',
          domain: 'ui.panoramadr.com',
          deploy_target_type: 'SSH_SCP',
          drift_status: 'DRIFT_DETECTED',
          local_cert: {
            exists: true,
            domain: 'ui.panoramadr.com',
            subject: 'CN=ui.panoramadr.com',
            issuer: 'LetsEncrypt',
            thumbprint: 'AAA111',
            serial_number: '1',
            not_after: '2026-12-30T00:00:00Z',
            days_remaining: 42,
            status: 'HEALTHY',
          },
          live_cert: {
            reachable: true,
            latency_ms: 12,
            domain: 'ui.panoramadr.com',
            subject: 'CN=ui.panoramadr.com',
            issuer: 'LetsEncrypt',
            thumbprint: 'BBB222',
            serial_number: '2',
            not_after: '2026-12-09T00:00:00Z',
            days_remaining: 21,
            status: 'EXPIRING_SOON',
          },
        },
      ],
      probed_at: '2026-11-18T05:00:00Z',
    };

    const ledger: BackupLedgerSummary = {
      history_file_exists: true,
      ledger_source_path: 'backup_history.json',
      total_runs: 10,
      successful_runs: 9,
      failed_runs: 1,
      runs_7d: 7,
      successful_runs_7d: 6,
      failed_runs_7d: 1,
      daily_pips_7d: [],
      total_pruned_count: 0,
      last_run_timestamp: '2026-11-18T02:00:00Z',
      last_run_status: 'Failed',
      latest_app_details: [
        {
          app_name: 'BiomedMaven',
          status: 'Failed',
          file: null,
          size_bytes: null,
          duration_seconds: 1.2,
          error: 'SSH timeout',
        },
      ],
      recent_records: [],
    };

    const activeDto = buildSyncAlertEvaluationInput({
      maintenanceSuppressed: true,
      wshSnapshot: wsh,
      securityViolationCount: 1,
      failingInvariants: [
        {
          id: 'SEC-01',
          title: 'Loopback Binding',
          category: 'PORT',
          status: 'FAIL',
          details: '0.0.0.0 bind',
          remediation: 'Fix docker-compose',
        },
      ],
      tunnelVersion: tunnel,
      sslFleet,
      backupLedger: ledger,
      backupIncidentKey: '2026-11-18T02:00:00Z|Failed|1|',
      isBackupIncidentDismissed: false,
    });

    expect(activeDto.maintenanceSuppressed).toBe(true);
    expect(activeDto.wsh?.dietpiUpdateAvailable).toBe('9.9.0');
    expect(activeDto.wsh?.failingInvariants).toEqual(['SEC-01 Loopback Binding']);
    expect(activeDto.tunnelVersion?.updateAvailable).toBe(true);
    expect(activeDto.sslDomains?.[0]?.status).toBe('EXPIRING_SOON');
    expect(activeDto.sslDomains?.[0]?.driftStatus).toBe('DRIFT_DETECTED');
    expect(activeDto.backup?.incidentKey).toBe('2026-11-18T02:00:00Z|Failed|1|');
    expect(activeDto.backup?.failedApps).toEqual(['BiomedMaven']);

    // Dismissed backup incident clears incidentKey so Pushover does not fire
    const dismissedDto = buildSyncAlertEvaluationInput({
      backupLedger: ledger,
      backupIncidentKey: '2026-11-18T02:00:00Z|Failed|1|',
      isBackupIncidentDismissed: true,
    });
    expect(dismissedDto.backup?.incidentKey).toBeNull();
  });

  it('ignores envOnly smoke runs and extracts failing check summaries from full smoke runs', () => {
    const envOnlyRun: SmokeTestRun = {
      id: 'smk-env',
      timestamp: '2026-11-18T05:00:00Z',
      targetUrl: 'https://wsh.panoramadr.com',
      triggeredBy: 'manual',
      envOnly: true,
      total: 4,
      passed: 3,
      failed: 1,
      results: [{ name: 'Env Check', category: 'ENV', passed: false, durationMs: 5, detail: 'Missing key' }],
    };
    expect(buildSyncAlertEvaluationInput({ latestSmokeRun: envOnlyRun }).latestSmokeRun).toBeUndefined();

    const fullRun: SmokeTestRun = {
      ...envOnlyRun,
      id: 'smk-full-1',
      envOnly: false,
      results: [
        { name: 'PanoramaAuth Health', category: 'HEALTH', passed: true, durationMs: 42, detail: 'OK' },
        { name: 'BiomedMaven Health', category: 'HEALTH', passed: false, durationMs: 4001, detail: 'HTTP 502' },
      ],
    };
    const dto = buildSyncAlertEvaluationInput({ latestSmokeRun: fullRun });
    expect(dto.latestSmokeRun?.id).toBe('smk-full-1');
    expect(dto.latestSmokeRun?.failed).toBe(1);
    expect(dto.latestSmokeRun?.failedChecks).toEqual(['[HEALTH] BiomedMaven Health: HTTP 502']);
  });
});
