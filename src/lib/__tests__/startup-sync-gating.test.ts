import { describe, it, expect } from 'vitest';
import {
  DiscoveredApp,
  WshSnapshot,
  getAppOperationalHealth,
  isAppCritical,
  isAppDeployCandidate,
  isAppEvaluableForFleetCount,
  isAppUnhealthy,
  reconcileServiceAppsFromSnapshot,
} from '../types';
import { buildSyncAlertEvaluationInput } from '../pushover-payload';

function makeHttpApp(overrides: Partial<DiscoveredApp> = {}): DiscoveredApp {
  return {
    manifest: {
      schemaVersion: 1,
      appId: 'spendy',
      slug: 'spendy',
      hostingTarget: 'wsh-docker',
      displayName: 'SpendyLedger',
      portalTitle: 'SpendyLedger',
      description: 'Finance tracker',
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
    ...overrides,
  };
}

function makeWshServiceApp(
  overrides: Partial<DiscoveredApp> = {},
  optionalDeployment = true
): DiscoveredApp {
  return {
    manifest: {
      schemaVersion: 1,
      appId: 'unifi-siem',
      slug: 'unifi-siem',
      hostingTarget: 'wsh-docker-service',
      displayName: 'UniFi SIEM Collector',
      portalTitle: 'UniFi SIEM Collector',
      description: 'Hardened UDP Syslog ingestor',
      basePath: '',
      port: 5514,
      containerName: 'unifi-siem',
      composeProject: 'unifi-siem',
      remoteAppRoot: '/opt/unifi-siem',
      dataVolume: '/var/data/unifi-siem',
      localSqlitePath: '',
      themeColor: 'amber',
      icon: 'ShieldAlert',
      portalOrder: 95,
      roles: ['admin'],
      service: {
        protocol: 'udp',
        bindIp: '172.25.25.5',
        networkName: 'unifi-siem-net',
        networkSubnet: '100.64.251.0/24',
        optionalDeployment,
      },
      sre: {
        deployScript: 'deploy-unifi-siem.ps1',
        dbScript: '',
        devCommand: '',
        healthEndpoint: '',
        healthCheckMode: 'docker-container',
        testCommand: 'npx vitest run',
        typecheckCommand: 'npx tsc --noEmit',
        requiresAuthInDev: false,
        automatedBackupDefault: false,
        exposeInRemotePortal: false,
      },
    },
    workspacePath: 'c:\\projects\\PanoramaDrSuite\\tools\\unifi-siem',
    provenanceState: 'UNKNOWN',
    ...overrides,
  };
}

function makeSnapshot(containers: Array<{ Names: string; State: string; Status: string }>): WshSnapshot {
  return {
    mode: '--fast',
    hostname: 'wsh',
    kernel: '6.12.20',
    uptime_secs: 1200,
    dietpi_version: '9.8.0',
    dietpi_update_available: '',
    reboot_required: false,
    rpi_throttled: '0x0',
    services: { lighttpd: 'active', docker: 'active', ssh: 'active' },
    listening_ports: [22, 443],
    lighttpd_routes_raw: '',
    containers: containers.map((c, idx) => ({
      ID: `cid-${idx}`,
      Image: 'panorama/unifi-siem:latest',
      Names: c.Names,
      State: c.State,
      Status: c.Status,
      Ports: '172.25.25.5:5514->5514/udp',
    })),
    container_stats: [],
    images: [],
    cloudflared: { version_raw: 'cloudflared version 2026.10.6' },
    apt_upgradable_raw: '',
    data_volumes_raw: '',
    docker_df: [],
    release_ledgers: {},
  };
}

describe('Startup sync gating and operational health evaluation', () => {
  describe('Pre-sync window (isInitialSyncComplete: false)', () => {
    it('keeps unprobed wsh-docker-service apps in pending_sync without unhealthy/critical flags', () => {
      const siem = makeWshServiceApp({ health: undefined, provenanceState: 'UNKNOWN' });
      const opts = { isInitialSyncComplete: false, networkPosture: 'LAN_DIRECT' as const };

      expect(getAppOperationalHealth(siem, opts)).toBe('pending_sync');
      expect(isAppUnhealthy(siem, opts)).toBe(false);
      expect(isAppCritical(siem, opts)).toBe(false);
      expect(isAppEvaluableForFleetCount(siem, opts)).toBe(false);
    });

    it('keeps unprobed HTTP apps in pending_sync while allowing already-healthy HTTP apps', () => {
      const opts = { isInitialSyncComplete: false, networkPosture: 'LAN_DIRECT' as const };
      const pendingHttp = makeHttpApp({ health: undefined, provenanceState: 'UNKNOWN' });
      const healthyHttp = makeHttpApp({ health: { status: 'healthy' }, provenanceState: 'IN_SYNC' });

      expect(getAppOperationalHealth(pendingHttp, opts)).toBe('pending_sync');
      expect(isAppUnhealthy(pendingHttp, opts)).toBe(false);
      expect(isAppCritical(pendingHttp, opts)).toBe(false);
      expect(isAppEvaluableForFleetCount(pendingHttp, opts)).toBe(false);

      expect(getAppOperationalHealth(healthyHttp, opts)).toBe('healthy');
      expect(isAppUnhealthy(healthyHttp, opts)).toBe(false);
      expect(isAppCritical(healthyHttp, opts)).toBe(false);
      expect(isAppEvaluableForFleetCount(healthyHttp, opts)).toBe(true);
    });
  });

  describe('WSH snapshot reconciliation and post-sync classification', () => {
    it('clears PROD_UNREACHABLE from Rust git composition when WSH snapshot is unavailable', () => {
      const rawSiem = makeWshServiceApp({
        health: undefined,
        provenanceState: 'PROD_UNREACHABLE',
        composition: {
          app_id: 'unifi-siem',
          state: 'PROD_UNREACHABLE',
          local_head_sha: 'abc1234',
          local_head_short: 'abc1234',
          local_branch: 'main',
          local_dirty: false,
          dirty_files: [],
          prod_sha: null,
          prod_release_id: null,
          prod_dirty: false,
          ahead_count: 0,
          behind_count: 0,
          undeployed_commits: [],
          changed_files_since_prod: [],
          blast_radius_badges: [],
          new_env_keys: [],
          recent_candidates: [],
        },
      });
      const dirtySiem = makeWshServiceApp({
        health: undefined,
        provenanceState: 'PROD_UNREACHABLE',
        composition: {
          app_id: 'unifi-siem',
          state: 'PROD_UNREACHABLE',
          local_head_sha: 'def5678',
          local_head_short: 'def5678',
          local_branch: 'main',
          local_dirty: true,
          dirty_files: [],
          prod_sha: null,
          prod_release_id: null,
          prod_dirty: false,
          ahead_count: 0,
          behind_count: 0,
          undeployed_commits: [],
          changed_files_since_prod: [],
          blast_radius_badges: [],
          new_env_keys: [],
          recent_candidates: [],
        },
      });

      const [reconciledClean, reconciledDirty] = reconcileServiceAppsFromSnapshot(
        [rawSiem, dirtySiem],
        null
      );

      expect(reconciledClean.health).toBeUndefined();
      expect(reconciledClean.provenanceState).toBe('UNKNOWN');
      expect(reconciledDirty.provenanceState).toBe('LOCAL_WIP');
    });

    it('reconciles running, exited, optional not_deployed, and mandatory not_deployed services accurately', () => {
      const runningSnap = makeSnapshot([
        { Names: '/unifi-siem', State: 'running', Status: 'Up 3 hours (healthy)' },
      ]);
      const [runningApp] = reconcileServiceAppsFromSnapshot([makeWshServiceApp()], runningSnap);
      expect(getAppOperationalHealth(runningApp, { isInitialSyncComplete: true })).toBe('healthy');
      expect(runningApp.provenanceState).toBe('IN_SYNC');
      expect(isAppUnhealthy(runningApp)).toBe(false);
      expect(isAppDeployCandidate(runningApp)).toBe(false);

      const stoppedSnap = makeSnapshot([
        { Names: '/unifi-siem', State: 'exited', Status: 'Exited (1) 5 minutes ago' },
      ]);
      const [stoppedApp] = reconcileServiceAppsFromSnapshot([makeWshServiceApp()], stoppedSnap);
      expect(getAppOperationalHealth(stoppedApp, { isInitialSyncComplete: true })).toBe('unhealthy');
      expect(stoppedApp.provenanceState).toBe('PROD_UNREACHABLE');
      expect(isAppUnhealthy(stoppedApp)).toBe(true);
      expect(isAppCritical(stoppedApp)).toBe(true);
      expect(isAppDeployCandidate(stoppedApp)).toBe(true);
      expect(isAppEvaluableForFleetCount(stoppedApp)).toBe(true);

      const emptySnap = makeSnapshot([]);
      const [optionalMissing, mandatoryMissing] = reconcileServiceAppsFromSnapshot(
        [makeWshServiceApp({}, true), makeWshServiceApp({}, false)],
        emptySnap
      );

      expect(getAppOperationalHealth(optionalMissing)).toBe('optional_not_deployed');
      expect(isAppUnhealthy(optionalMissing)).toBe(false);
      expect(isAppCritical(optionalMissing)).toBe(false);
      expect(isAppDeployCandidate(optionalMissing)).toBe(false);
      expect(isAppEvaluableForFleetCount(optionalMissing)).toBe(false);

      expect(getAppOperationalHealth(mandatoryMissing)).toBe('unhealthy');
      expect(isAppUnhealthy(mandatoryMissing)).toBe(true);
      expect(isAppCritical(mandatoryMissing)).toBe(true);
      expect(isAppDeployCandidate(mandatoryMissing)).toBe(true);
      expect(isAppEvaluableForFleetCount(mandatoryMissing)).toBe(true);
    });

    it('treats missing WSH service telemetry on WAN_CLOUDFLARE as telemetry_unavailable and suppresses false Pushover alerts', () => {
      const wanService = makeWshServiceApp({ health: undefined, provenanceState: 'UNKNOWN' });
      const opts = { isInitialSyncComplete: true, networkPosture: 'WAN_CLOUDFLARE' as const };

      expect(getAppOperationalHealth(wanService, opts)).toBe('telemetry_unavailable');
      expect(isAppUnhealthy(wanService, opts)).toBe(false);
      expect(isAppCritical(wanService, opts)).toBe(false);
      expect(isAppDeployCandidate(wanService)).toBe(false);
      expect(isAppEvaluableForFleetCount(wanService, opts)).toBe(false);

      const httpApp = makeHttpApp({ health: { status: 'healthy' }, provenanceState: 'IN_SYNC' });
      const pushoverDto = buildSyncAlertEvaluationInput({
        apps: [httpApp, wanService],
      });
      expect(pushoverDto.apps?.map((a) => a.slug)).toEqual(['spendy']);
    });

    it('flags unreachable, unhealthy, and DIRTY_PROD HTTP apps accurately', () => {
      const unreachableHttp = makeHttpApp({
        health: undefined,
        provenanceState: 'PROD_UNREACHABLE',
      });
      const unhealthyHttp = makeHttpApp({
        health: { status: 'unhealthy' },
        provenanceState: 'IN_SYNC',
      });
      const dirtyProdHttp = makeHttpApp({
        health: { status: 'healthy' },
        provenanceState: 'DIRTY_PROD',
      });

      expect(getAppOperationalHealth(unreachableHttp)).toBe('unhealthy');
      expect(isAppUnhealthy(unreachableHttp)).toBe(true);
      expect(isAppCritical(unreachableHttp)).toBe(true);
      expect(isAppDeployCandidate(unreachableHttp)).toBe(true);
      expect(isAppEvaluableForFleetCount(unreachableHttp)).toBe(true);

      expect(getAppOperationalHealth(unhealthyHttp)).toBe('unhealthy');
      expect(isAppUnhealthy(unhealthyHttp)).toBe(true);
      expect(isAppCritical(unhealthyHttp)).toBe(true);
      expect(isAppDeployCandidate(unhealthyHttp)).toBe(true);

      expect(getAppOperationalHealth(dirtyProdHttp)).toBe('healthy');
      expect(isAppUnhealthy(dirtyProdHttp)).toBe(false);
      expect(isAppCritical(dirtyProdHttp)).toBe(true);
      expect(isAppDeployCandidate(dirtyProdHttp)).toBe(true);

      const dto = buildSyncAlertEvaluationInput({
        apps: [unreachableHttp, unhealthyHttp],
      });
      expect(dto.apps?.map((a) => a.status)).toEqual(['unreachable', 'unhealthy']);
    });
  });
});
