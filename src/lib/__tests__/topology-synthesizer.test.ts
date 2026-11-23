import { describe, it, expect } from 'vitest';
import { synthesizeTopology, compareTunnelVersions, computeTopologyBadges } from '../topology-synthesizer';
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
    expect(result.securityAudit.invariants).toHaveLength(9);
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

  it('computes warning and error badges across navigation bar and all topology sub-tabs', () => {
    const cleanSnapshot: WshSnapshot = {
      mode: '--fast',
      hostname: 'wsh-live',
      kernel: '6.6.20',
      uptime_secs: 100,
      dietpi_version: '9.3.0',
      dietpi_update_available: '',
      reboot_required: false,
      rpi_throttled: '0x0',
      services: { lighttpd: 'active', docker: 'active', ssh: 'active' },
      listening_ports: [80, 443, 3000, 3001],
      lighttpd_routes_raw: 'auth:3000,spendy:3001',
      containers: [
        { Names: 'panorama-auth', State: 'running', Ports: '127.0.0.1:3000->3000/tcp' },
        { Names: 'spendy-ledger', State: 'running', Ports: '127.0.0.1:3001->3001/tcp' },
      ],
      container_stats: [],
      images: [],
      cloudflared: {
        version_raw: 'cloudflared version 2026.10.7',
        recent_logs: '2026-11-13T10:00:00Z INF Registered tunnel connection',
      },
      apt_upgradable_raw: '',
      data_volumes_raw: '',
      docker_df: [],
      release_ledgers: {},
      network_interfaces: [{ ifname: 'eth0', flags: ['BROADCAST', 'MULTICAST', 'UP'], mtu: 1500, operstate: 'UP' }],
      firewall_rules_raw:
        '-N DOCKER-USER\n-A DOCKER-USER -d 10.0.0.0/8 -o eth0 -j DROP\n-A DOCKER-USER -d 172.16.0.0/12 -o eth0 -j DROP\n-A DOCKER-USER -d 192.168.0.0/16 -o eth0 -j DROP\n-N PANORAMA-INPUT\n-A PANORAMA-INPUT -i br-+ -p tcp -m tcp --dport 22 -j DROP\n',
    };

    const updateStatus: CloudflareTunnelVersionStatus = {
      runningVersion: '2026.10.7',
      runningRaw: 'cloudflared version 2026.10.7',
      latestVersion: '2026.11.0',
      isUpToDate: false,
      updateAvailable: true,
      checkedAtIso: '2026-11-13T20:00:00Z',
      checkedAtEpoch: 1794600000,
      source: 'github',
    };

    // 1. Update-only warning state
    const warningTopo = synthesizeTopology(mockApps, cleanSnapshot, updateStatus);
    const warningBadges = computeTopologyBadges(warningTopo, true);
    expect(warningBadges.errorCount).toBe(0);
    expect(warningBadges.updateCount).toBe(1);
    expect(warningBadges.totalCount).toBe(1);
    expect(warningBadges.severity).toBe('warning');
    expect(warningBadges.tabs.tunnel).toEqual({ count: 1, severity: 'warning' });
    expect(warningBadges.tabs.visual).toEqual({ count: 1, severity: 'warning' });
    expect(warningBadges.tabs.matrix.count).toBe(0);
    expect(warningBadges.tabs.hardware.count).toBe(0);
    expect(warningBadges.tabs.rules.count).toBe(0);

    // 2. Multi-subpage error state (unhealthy route + tunnel ERR + eth0 DOWN + 0.0.0.0 violation)
    const brokenSnapshot: WshSnapshot = {
      ...cleanSnapshot,
      containers: [
        { Names: 'panorama-auth', State: 'running', Ports: '127.0.0.1:3000->3000/tcp' },
        { Names: 'spendy-ledger', State: 'exited', Ports: '0.0.0.0:3001->3001/tcp' },
      ],
      cloudflared: {
        version_raw: 'cloudflared version 2026.10.7',
        recent_logs: '2026-11-13T10:00:00Z ERR failed to connect to edge',
      },
      network_interfaces: [{ ifname: 'eth0', flags: ['BROADCAST', 'MULTICAST'], mtu: 1500, operstate: 'DOWN' }],
    };

    const errorTopo = synthesizeTopology(mockApps, brokenSnapshot, updateStatus);
    const errorBadges = computeTopologyBadges(errorTopo, true);
    expect(errorBadges.severity).toBe('error');
    expect(errorBadges.tabs.matrix).toEqual({ count: 1, severity: 'error' });
    expect(errorBadges.tabs.hardware).toEqual({ count: 2, severity: 'error' }); // eth0 DOWN + zeroBindViolation
    expect(errorBadges.tabs.tunnel).toEqual({ count: 2, severity: 'error' }); // tunnel error + update
    expect(errorBadges.tabs.rules.count).toBeGreaterThan(0);
    expect(errorBadges.tabs.rules.severity).toBe('error');
    expect(errorBadges.tabs.visual.severity).toBe('error');
    expect(errorBadges.totalCount).toBeGreaterThan(2);

    // 3. No snapshot yet -> suppresses false snapshot errors, retains cached tunnel update warning
    const preSnapshotTopo = synthesizeTopology(mockApps, null, updateStatus);
    const preSnapshotBadges = computeTopologyBadges(preSnapshotTopo, false);
    expect(preSnapshotBadges.errorCount).toBe(0);
    expect(preSnapshotBadges.updateCount).toBe(1);
    expect(preSnapshotBadges.severity).toBe('warning');
    expect(preSnapshotBadges.tabs.matrix.count).toBe(0);
    expect(preSnapshotBadges.tabs.hardware.count).toBe(0);
    expect(preSnapshotBadges.tabs.rules.count).toBe(0);
    expect(preSnapshotBadges.tabs.tunnel).toEqual({ count: 1, severity: 'warning' });
  });

  it('excludes cloudflare-pages apps from WSH Lighttpd routes and container alerts', () => {
    const cleanSnapshot: WshSnapshot = {
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
        { Names: 'panorama-auth', State: 'running', Ports: '127.0.0.1:3000->3000/tcp' },
        { Names: 'spendy-ledger', State: 'running', Ports: '127.0.0.1:3001->3001/tcp' },
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
      network_interfaces: [{ ifname: 'eth0', flags: ['BROADCAST', 'MULTICAST'], mtu: 1500, operstate: 'UP' }],
    };

    const withEdgeApp: DiscoveredApp[] = [
      ...mockApps,
      {
        manifest: {
          schemaVersion: 1,
          appId: 'parakith-site',
          slug: 'parakith',
          hostingTarget: 'cloudflare-pages',
          displayName: 'ParakithSite',
          portalTitle: 'Parakith LLC',
          description: 'Cloudflare Pages site',
          basePath: '/',
          port: 3500,
          containerName: '',
          composeProject: '',
          remoteAppRoot: '',
          dataVolume: '',
          localSqlitePath: '',
          themeColor: 'slate',
          icon: 'ShieldCheck',
          portalOrder: 99,
          roles: ['admin'],
          cloudflare: {
            pagesProject: 'parakith-site',
            primaryUrl: 'https://www.parakith.com',
            domains: ['parakith.com', 'www.parakith.com'],
          },
          sre: {
            deployScript: './deploy-cloudflare-pages.ps1',
            dbScript: '',
            devCommand: 'npm run dev',
            previewCommand: 'npm run preview',
            healthEndpoint: '/api/health',
            healthAuthMode: 'hmac-sha256-stealth',
            testCommand: 'npm test',
            typecheckCommand: 'npm run typecheck',
            requiresAuthInDev: false,
            automatedBackupDefault: false,
            exposeInRemotePortal: false,
          },
        },
        workspacePath: 'c:\\test\\parakith',
        provenanceState: 'IN_SYNC',
      },
    ];

    const topo = synthesizeTopology(withEdgeApp, cleanSnapshot);
    expect(topo.routes).toHaveLength(2);
    expect(topo.routes.some((r) => r.slug === 'parakith')).toBe(false);
    const badges = computeTopologyBadges(topo, true);
    expect(badges.tabs.matrix.count).toBe(0);
    expect(badges.errorCount).toBe(0);
  });

  it('synthesizes CGNAT 100.64.x.0/24 fallback subnets and dynamic SEC-02/SEC-08 audit targets for new apps', () => {
    const futureApps: DiscoveredApp[] = [
      ...mockApps,
      {
        ...mockApps[1],
        manifest: {
          ...mockApps[1].manifest,
          appId: 'future',
          slug: 'future',
          displayName: 'FutureSolar',
          portalTitle: 'Future Solar',
          basePath: '/future',
          port: 3012,
          containerName: 'future-solar',
        },
        workspacePath: 'c:\\test\\future',
      },
    ];

    const topo = synthesizeTopology(futureApps, null);
    const futureRoute = topo.routes.find((r) => r.slug === 'future');
    expect(futureRoute).toBeDefined();
    expect(futureRoute?.bridgeSubnet).toMatch(/^100\.64\./);
    expect(futureRoute?.bridgeSubnet).not.toMatch(/^172\.24\./);

    const sec02 = topo.securityAudit.invariants.find((i) => i.id === 'SEC-02');
    expect(sec02?.commandSnippet).toContain('3012');

    const sec08 = topo.securityAudit.invariants.find((i) => i.id === 'SEC-08');
    expect(sec08?.evidence).toContain('FutureSolar');
  });

  it('validates SEC-09 UniFi SIEM collector isolation when absent, hardened, and misconfigured', () => {
    const baseSnapshot: WshSnapshot = {
      mode: '--fast',
      hostname: 'wsh',
      kernel: '6.6.20',
      uptime_secs: 1000,
      dietpi_version: '9.9.0',
      dietpi_update_available: '',
      reboot_required: false,
      rpi_throttled: '0x0',
      services: { lighttpd: 'active', docker: 'active', ssh: 'active' },
      listening_ports: [80, 443, 3000],
      listening_sockets_raw: 'tcp LISTEN 127.0.0.1:3000',
      lighttpd_routes_raw: 'auth:3000',
      containers: [],
      container_stats: [],
      docker_networks: [],
      images: [],
      cloudflared: { version_raw: '2026.10.7', recent_logs: '' },
      apt_upgradable_raw: '',
      data_volumes_raw: '',
      docker_df: [],
      release_ledgers: {},
      firewall_rules_raw:
        '-N DOCKER-USER\n-A DOCKER-USER -d 10.0.0.0/8 -o eth0 -j DROP\n-A DOCKER-USER -d 172.16.0.0/12 -o eth0 -j DROP\n-A DOCKER-USER -d 192.168.0.0/16 -o eth0 -j DROP\n-N PANORAMA-INPUT\n',
    };

    // 1. Optional collector absent -> SEC-09 PASS
    const absentTopo = synthesizeTopology(mockApps, baseSnapshot);
    expect(absentTopo.securityAudit.invariants.find((i) => i.id === 'SEC-09')?.status).toBe('PASS');

    // 2. Deployed and hardened -> SEC-09 PASS
    const hardenedSnapshot: WshSnapshot = {
      ...baseSnapshot,
      containers: [
        {
          Names: 'unifi-siem',
          State: 'running',
          Status: 'Up 1 hour',
          Ports: '172.25.25.5:5514->5514/udp',
        },
      ],
      docker_networks: [
        {
          Id: 'net-unifi-siem',
          Name: 'unifi-siem-net',
          Scope: 'local',
          Driver: 'bridge',
          IPAM: { Config: [{ Subnet: '100.64.251.0/24' }] },
        },
      ],
      firewall_rules_raw:
        baseSnapshot.firewall_rules_raw +
        '-A DOCKER-USER -i eth0 -p udp -m udp --dport 5514 -j DROP\n',
    };
    const hardenedTopo = synthesizeTopology(mockApps, hardenedSnapshot);
    expect(hardenedTopo.securityAudit.invariants.find((i) => i.id === 'SEC-09')?.status).toBe('PASS');

    // 3. Misconfigured wildcard bind (0.0.0.0:5514) -> SEC-09 FAIL
    const insecureSnapshot: WshSnapshot = {
      ...hardenedSnapshot,
      containers: [
        {
          Names: 'unifi-siem',
          State: 'running',
          Status: 'Up 1 hour',
          Ports: '0.0.0.0:5514->5514/udp',
        },
      ],
    };
    const insecureTopo = synthesizeTopology(mockApps, insecureSnapshot);
    expect(insecureTopo.securityAudit.invariants.find((i) => i.id === 'SEC-09')?.status).toBe('FAIL');
  });
});
