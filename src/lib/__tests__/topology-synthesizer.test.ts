import { describe, it, expect } from 'vitest';
import { synthesizeTopology } from '../topology-synthesizer';
import { DiscoveredApp, WshSnapshot } from '../types';

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
    expect(result.cloudflared.networkMode).toBe('host');

    // Security audit
    expect(result.securityAudit.score).toBe(100);
    expect(result.securityAudit.zeroBindViolations).toHaveLength(0);

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
    };

    const result = synthesizeTopology(mockApps, mockSnapshot);
    expect(result.securityAudit.score).toBe(65);
    expect(result.securityAudit.zeroBindViolations).toHaveLength(1);
    expect(result.securityAudit.recommendations[0]).toContain('CRITICAL');
  });

  it('synthesizes route entries from discovered apps when snapshot has no routes', () => {
    const result = synthesizeTopology(mockApps, null);
    expect(result.routes).toHaveLength(2);
    expect(result.routes.map((r) => r.slug)).toEqual(['auth', 'spendy']);
    expect(result.routes.map((r) => r.port)).toEqual([3000, 3001]);
  });
});
