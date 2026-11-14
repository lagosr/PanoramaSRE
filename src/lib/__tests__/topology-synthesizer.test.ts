import { describe, it, expect } from 'vitest';
import { synthesizeTopology, compareTunnelVersions } from '../topology-synthesizer';
import { DiscoveredApp, WshSnapshot, CloudflareTunnelVersionStatus } from '../types';

describe('synthesizeTopology', () => {
  const mockApps: DiscoveredApp[] = [
    {
      manifest: {
        schemaVersion: 1,
        appId: 'auth',
        slug: 'auth',
        displayName: 'PanoramaAuth',
        portalTitle: 'PanoramaAuth',
        description: 'Identity Provider',
        basePath: '/auth',
        port: 3000,
        containerName: 'panorama-auth',
        composeProject: 'panorama-auth',
        remoteAppRoot: '/opt/panorama-auth',
        dataVolume: 'panorama-auth',
        localSqlitePath: '',
        themeColor: '#0ea5e9',
        icon: 'Shield',
        portalOrder: 1,
        roles: ['admin'],
        sre: {
          deployScript: '',
          dbScript: '',
          devCommand: '',
          healthEndpoint: '/api/health',
          manifestEndpoint: '/api/auth/manifest',
          testCommand: '',
          typecheckCommand: '',
          requiresAuthInDev: false,
          automatedBackupDefault: true,
          exposeInRemotePortal: true,
        },
      },
      workspacePath: 'c:\\test\\auth',
      provenanceState: 'IN_SYNC',
      health: {
        status: 'healthy',
      },
    },
    {
      manifest: {
        schemaVersion: 1,
        appId: 'spendy',
        slug: 'spendy',
        displayName: 'SpendyLedger',
        portalTitle: 'SpendyLedger',
        description: 'Finance Tracker',
        basePath: '/spendy',
        port: 3001,
        containerName: 'spendy-ledger',
        composeProject: 'spendy-ledger',
        remoteAppRoot: '/opt/spendy-ledger',
        dataVolume: 'spendy-ledger',
        localSqlitePath: '',
        themeColor: '#10b981',
        icon: 'DollarSign',
        portalOrder: 2,
        roles: ['admin'],
        sre: {
          deployScript: '',
          dbScript: '',
          devCommand: '',
          healthEndpoint: '/api/health',
          manifestEndpoint: '/api/auth/manifest',
          testCommand: '',
          typecheckCommand: '',
          requiresAuthInDev: false,
          automatedBackupDefault: true,
          exposeInRemotePortal: true,
        },
      },
      workspacePath: 'c:\\test\\spendy',
      provenanceState: 'IN_SYNC',
    },
  ];

  it('correctly parses raw lighttpd route strings and associates with discovered apps', () => {
    const mockSnapshot: WshSnapshot = {
      mode: '--fast',
      hostname: 'wsh-test',
      kernel: '6.6.20+rpt-rpi-v8',
      uptime_secs: 42000,
      dietpi_version: '9.3.0',
      dietpi_update_available: '',
      reboot_required: false,
      rpi_throttled: '0x0',
      services: { lighttpd: 'active', docker: 'active', ssh: 'active' },
      listening_ports: [80, 443, 3000, 3001],
      lighttpd_routes_raw: 'auth:3000,spendy:3001',
      containers: [
        {
          Names: 'panorama-auth',
          State: 'running',
          Status: 'Up 4 days',
          Ports: '127.0.0.1:3000->3000/tcp',
        },
      ],
      container_stats: [],
      images: [],
      cloudflared: {
        version_raw: 'cloudflared version 2026.10.7',
        recent_logs: 'Registered tunnel connection',
      },
      apt_upgradable_raw: '',
      data_volumes_raw: '',
      docker_df: [],
      release_ledgers: {},
      firewall_rules_raw:
        '-N DOCKER-USER\n-A DOCKER-USER -d 10.0.0.0/8 -o eth0 -j DROP\n-A DOCKER-USER -d 172.16.0.0/12 -o eth0 -j DROP\n-A DOCKER-USER -d 192.168.0.0/16 -o eth0 -j DROP\n-N PANORAMA-INPUT\n-A PANORAMA-INPUT -i br-+ -p tcp -m tcp --dport 22 -j DROP\n',
    };

    const result = synthesizeTopology(mockApps, mockSnapshot);

    expect(result.routes).toHaveLength(2);
    expect(result.routes[0].slug).toBe('auth');
    expect(result.routes[0].port).toBe(3000);
    expect(result.routes[0].isHealthy).toBe(true);
    expect(result.routes[0].containerName).toBe('panorama-auth');

    expect(result.routes[1].slug).toBe('spendy');
    expect(result.routes[1].port).toBe(3001);

    expect(result.cloudflared.isHealthy).toBe(true);
    expect(result.cloudflared.networkMode).toBe('cf-egress-net (100.64.250.0/24)');

    // Security audit
    expect(result.securityAudit.score).toBe(100);
    expect(result.securityAudit.zeroBindViolations).toHaveLength(0);
    expect(result.securityAudit.invariants).toHaveLength(8);
    expect(result.securityAudit.securityViolationCount).toBe(0);

    // Ingress trace
    expect(result.ingressTraces['auth']).toBeDefined();
    expect(result.ingressTraces['auth'].length).toBe(8);
    expect(result.ingressTraces['auth'][0].label).toBe('Client Browser');
    expect(result.ingressTraces['auth'][7].type).toBe('storage');
  });

  it('detects 0.0.0.0 port binding violations in security audit', () => {
    const mockSnapshot: WshSnapshot = {
      mode: '--fast',
      hostname: 'wsh-insecure',
      kernel: '6.6.20',
      uptime_secs: 100,
      dietpi_version: '9.3.0',
      dietpi_update_available: '',
      reboot_required: false,
      rpi_throttled: '0x0',
      services: {},
      listening_ports: [3000],
      lighttpd_routes_raw: 'auth:3000',
      containers: [
        {
          Names: 'insecure-container',
          State: 'running',
          Ports: '0.0.0.0:3000->3000/tcp',
        },
      ],
      container_stats: [],
      images: [],
      cloudflared: {},
      apt_upgradable_raw: '',
      data_volumes_raw: '',
      docker_df: [],
      release_ledgers: {},
      firewall_rules_raw:
        '-N DOCKER-USER\n-A DOCKER-USER -d 10.0.0.0/8 -o eth0 -j DROP\n-A DOCKER-USER -d 172.16.0.0/12 -o eth0 -j DROP\n-A DOCKER-USER -d 192.168.0.0/16 -o eth0 -j DROP\n-N PANORAMA-INPUT\n-A PANORAMA-INPUT -i br-+ -p tcp -m tcp --dport 22 -j DROP\n',
    };

    const result = synthesizeTopology(mockApps, mockSnapshot);
    expect(result.securityAudit.score).toBe(85);
    expect(result.securityAudit.securityViolationCount).toBe(1);
    expect(result.securityAudit.zeroBindViolations).toHaveLength(1);
    expect(result.securityAudit.recommendations[0]).toContain('CRITICAL');
  });

  it('synthesizes route entries from discovered apps when snapshot has no routes', () => {
    const result = synthesizeTopology(mockApps, null);
    expect(result.routes).toHaveLength(2);
    expect(result.routes.map((r) => r.slug)).toEqual(['auth', 'spendy']);
    expect(result.routes.map((r) => r.port)).toEqual([3000, 3001]);
  });

  it('does not flag administrative portainer 9442/https binding as application zero-bind violation', () => {
    const mockSnapshot: WshSnapshot = {
      mode: '--fast',
      hostname: 'wsh-live',
      kernel: '6.6.20',
      uptime_secs: 100,
      dietpi_version: '9.3.0',
      dietpi_update_available: '',
      reboot_required: false,
      rpi_throttled: '0x0',
      services: { lighttpd: 'active', docker: 'active', ssh: 'active' },
      listening_ports: [80, 443, 3000, 3001, 9442],
      lighttpd_routes_raw: 'auth:3000,spendy:3001',
      containers: [
        {
          Names: 'panorama-auth',
          State: 'running',
          Ports: '127.0.0.1:3000->3000/tcp',
        },
        {
          Names: 'spendy-ledger',
          State: 'running',
          Ports: '127.0.0.1:3001->3001/tcp',
        },
        {
          Names: 'portainer',
          State: 'running',
          Ports: '8000/tcp, 9000/tcp, 0.0.0.0:9442->9443/tcp',
        },
      ],
      container_stats: [],
      images: [],
      cloudflared: {},
      apt_upgradable_raw: '',
      data_volumes_raw: '',
      docker_df: [],
      release_ledgers: {},
      firewall_rules_raw:
        '-N DOCKER-USER\n-A DOCKER-USER -d 10.0.0.0/8 -o eth0 -j DROP\n-A DOCKER-USER -d 172.16.0.0/12 -o eth0 -j DROP\n-A DOCKER-USER -d 192.168.0.0/16 -o eth0 -j DROP\n-N PANORAMA-INPUT\n-A PANORAMA-INPUT -i br-+ -p tcp -m tcp --dport 22 -j DROP\n',
    };

    const result = synthesizeTopology(mockApps, mockSnapshot);
    expect(result.securityAudit.score).toBe(100);
    expect(result.securityAudit.securityViolationCount).toBe(0);
    expect(result.securityAudit.zeroBindViolations).toHaveLength(0);
    const sec02 = result.securityAudit.invariants.find((i) => i.id === 'SEC-02');
    expect(sec02?.status).toBe('PASS');
    const sec04 = result.securityAudit.invariants.find((i) => i.id === 'SEC-04');
    expect(sec04?.status).toBe('PASS');
  });

  it('handles un-snapshotted initial state gracefully without raising false violations', () => {
    // When app starts before initial sync finishes, snapshot is null
    const result = synthesizeTopology(mockApps, null);
    expect(result.securityAudit.securityViolationCount).toBe(0);
    expect(result.securityAudit.score).toBe(100);
    const sec03 = result.securityAudit.invariants.find((i) => i.id === 'SEC-03');
    expect(sec03?.status).toBe('PASS');
    const sec04 = result.securityAudit.invariants.find((i) => i.id === 'SEC-04');
    expect(sec04?.status).toBe('PASS');
  });

  it('compares cloudflared CalVer versions numerically and evaluates upstream release delta dynamically', () => {
    expect(compareTunnelVersions('cloudflared version 2026.9.1', 'v2026.10.7')).toBe(-1);
    expect(compareTunnelVersions('2026.10.7', '2026.10.7')).toBe(0);
    expect(compareTunnelVersions('2026.11.0', '2026.10.7')).toBe(1);
    expect(compareTunnelVersions('cloudflared daemon', '2026.10.7')).toBeNull();

    const outdatedSnapshot: WshSnapshot = {
      mode: '--fast',
      hostname: 'wsh-live',
      kernel: '6.6.20',
      uptime_secs: 100,
      dietpi_version: '9.3.0',
      dietpi_update_available: '',
      reboot_required: false,
      rpi_throttled: '0x0',
      services: { lighttpd: 'active', docker: 'active', ssh: 'active' },
      listening_ports: [80, 443, 3000],
      lighttpd_routes_raw: 'auth:3000',
      containers: [],
      container_stats: [],
      images: [],
      cloudflared: {
        version_raw: 'cloudflared version 2026.10.7 (built 2026-10-15 UTC)',
        recent_logs: '',
      },
      apt_upgradable_raw: '',
      data_volumes_raw: '',
      docker_df: [],
      release_ledgers: {},
    };

    const tunnelStatus: CloudflareTunnelVersionStatus = {
      runningVersion: '2026.10.7',
      runningRaw: 'cloudflared version 2026.10.7',
      latestVersion: '2026.11.0',
      releaseUrl: 'https://github.com/cloudflare/cloudflared/releases/tag/2026.11.0',
      publishedAt: '2026-11-10T00:00:00Z',
      isUpToDate: false,
      updateAvailable: true,
      etag: 'W/"rel-2026-11-0"',
      checkedAtIso: '2026-11-13T20:00:00Z',
      checkedAtEpoch: 1794600000,
      source: 'github',
      error: null,
    };

    const staleResult = synthesizeTopology(mockApps, outdatedSnapshot, tunnelStatus);
    expect(staleResult.cloudflared.runningVersion).toBe('2026.10.7');
    expect(staleResult.cloudflared.latestVersion).toBe('2026.11.0');
    expect(staleResult.cloudflared.updateAvailable).toBe(true);
    expect(staleResult.cloudflared.isUpToDate).toBe(false);

    // Once snapshot reflects the upgraded version, topology clears updateAvailable even before next GitHub check
    const upgradedSnapshot: WshSnapshot = {
      ...outdatedSnapshot,
      cloudflared: {
        version_raw: 'cloudflared version 2026.11.0 (built 2026-11-10 UTC)',
        recent_logs: '',
      },
    };
    const upToDateResult = synthesizeTopology(mockApps, upgradedSnapshot, tunnelStatus);
    expect(upToDateResult.cloudflared.runningVersion).toBe('2026.11.0');
    expect(upToDateResult.cloudflared.latestVersion).toBe('2026.11.0');
    expect(upToDateResult.cloudflared.updateAvailable).toBe(false);
    expect(upToDateResult.cloudflared.isUpToDate).toBe(true);
  });
});
