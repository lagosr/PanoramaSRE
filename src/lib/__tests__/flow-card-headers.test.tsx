import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NetworkBoundaryCanvas } from '../../components/topology/NetworkBoundaryCanvas';
import { UnifiZoneFlowExplorer } from '../../components/security/UnifiZoneFlowExplorer';
import { UnifiVlanZbfPanel } from '../../components/security/UnifiVlanZbfPanel';
import { synthesizeTopology } from '../topology-synthesizer';
import { buildZbfMatrix } from '../unifi-zbf';
import type {
  DiscoveredApp,
  UnifiPolicyDto,
  UnifiTopologySnapshotDto,
  UnifiZoneDto,
  WshSnapshot,
} from '../types';

function makeApp(slug: string, port: number): DiscoveredApp {
  return {
    manifest: {
      schemaVersion: 1,
      appId: slug,
      slug,
      displayName: `App ${slug}`,
      portalTitle: slug,
      description: `${slug} service`,
      basePath: `/${slug}`,
      port,
      containerName: `panorama-${slug}`,
      composeProject: `panorama-${slug}`,
      remoteAppRoot: `/opt/${slug}`,
      dataVolume: `/var/data/${slug}`,
      localSqlitePath: '',
      themeColor: 'orange',
      icon: 'Shield',
      portalOrder: 1,
      roles: ['admin'],
      hostingTarget: 'wsh-docker',
      sre: {
        deployScript: 'deploy-docker.ps1',
        dbScript: '',
        devCommand: '',
        healthEndpoint: '',
        manifestEndpoint: '',
        testCommand: '',
        typecheckCommand: '',
        requiresAuthInDev: false,
        automatedBackupDefault: false,
        exposeInRemotePortal: true,
      },
    },
    workspacePath: `c:\\test\\${slug}`,
    provenanceState: 'IN_SYNC',
    health: { status: 'healthy' },
  };
}

function makeSnapshot(): WshSnapshot {
  return {
    mode: '--fast',
    hostname: 'wsh',
    kernel: '6.6.20+rpt-rpi-v8',
    uptime_secs: 12000,
    dietpi_version: '9.8.0',
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
        Status: 'Up 2 days',
        Ports: '127.0.0.1:3000->3000/tcp',
      },
      {
        Names: 'spendy-ledger',
        State: 'running',
        Status: 'Up 2 days',
        Ports: '127.0.0.1:3001->3001/tcp',
      },
    ],
    container_stats: [],
    images: [],
    cloudflared: {
      version_raw: 'cloudflared version 2026.11.2',
      recent_logs: 'Registered tunnel connection',
    },
    apt_upgradable_raw: '',
    data_volumes_raw: '',
    docker_df: [],
    release_ledgers: {},
    firewall_rules_raw: [
      '-N DOCKER-USER',
      '-A DOCKER-USER -d 10.0.0.0/8 -o eth0 -j DROP',
      '-A DOCKER-USER -d 172.16.0.0/12 -o eth0 -j DROP',
      '-A DOCKER-USER -d 192.168.0.0/16 -o eth0 -j DROP',
      '-N PANORAMA-INPUT',
      '-A PANORAMA-INPUT -i br-+ -p tcp -m tcp --dport 22 -j DROP',
    ].join('\n'),
    network_interfaces: [
      {
        ifname: 'eth0',
        flags: ['UP'],
        mtu: 1500,
        operstate: 'UP',
        addr_info: [{ family: 'inet', local: '172.25.25.5', prefixlen: 24, scope: 'global' }],
      },
    ],
  };
}

function makeZone(
  id: string,
  name: string,
  origin: 'USER_DEFINED' | 'SYSTEM_DEFINED',
  vlanIds: number[]
): UnifiZoneDto {
  return {
    id,
    name,
    origin,
    networkIds: vlanIds.map((vid) => `net-${vid}`),
    networkNames: vlanIds.map((vid) => `${name} ${vid}`),
    vlanIds,
    clientCount: 4,
  };
}

function makePolicy(
  id: string,
  srcId: string,
  dstId: string,
  name: string,
  action = 'ALLOW'
): UnifiPolicyDto {
  return {
    id,
    name,
    action,
    enabled: true,
    description: null,
    index: 10000,
    origin: 'USER_DEFINED',
    sourceZoneId: srcId,
    destinationZoneId: dstId,
    allowReturnTraffic: true,
    hasSourceFilter: false,
    sourceFilterSummary: null,
    hasDestinationFilter: false,
    destinationFilterSummary: null,
    protocol: 'TCP',
    connectionStates: [],
    loggingEnabled: false,
    scheduleMode: 'ALWAYS',
  };
}

describe('Flow diagram card headers remain unclipped', () => {
  it('renders full non-truncated card headings in NetworkBoundaryCanvas (Topology page)', () => {
    const apps = [makeApp('auth', 3000), makeApp('spendy', 3001)];
    const snapshot = makeSnapshot();
    const topology = synthesizeTopology(apps, snapshot);

    const html = renderToStaticMarkup(
      <NetworkBoundaryCanvas
        topology={topology}
        selectedRouteSlug={null}
        onSelectRouteSlug={() => {}}
        onOpenInspector={() => {}}
        apps={apps}
        snapshot={snapshot}
      />
    );

    const expectedNames = [
      'WAN &amp; Cloudflare Edge',
      'Cloudflare Tunnel (cloudflared)',
      'DietPi Host &amp; Lighttpd',
      'Docker Engine &amp; CGNAT Bridges',
      'App Container Enclaves',
      'Persistent Storage Plane',
    ];

    const h4Matches = [...html.matchAll(/<h4\b([^>]*)>(.*?)<\/h4>/g)];
    expect(h4Matches.length).toBeGreaterThanOrEqual(expectedNames.length);

    for (const expectedName of expectedNames) {
      const match = h4Matches.find((m) => m[2] === expectedName);
      expect(match).toBeDefined();
      expect(match![1]).not.toContain('truncate');
      expect(match![1]).toContain('break-words');
    }

    expect(html).toContain('0 Open WAN Ports');
    expect(html).toContain('High-Level');
    expect(html).toContain('Inspect');
  });

  it('renders full non-truncated zone headings and VLAN badges in UnifiZoneFlowExplorer (Threat page)', () => {
    const zones: UnifiZoneDto[] = [
      makeZone('z-iot', 'Untrusted & IoT systems', 'USER_DEFINED', [300, 20]),
      makeZone('z-compute', 'Compute systems', 'USER_DEFINED', [500]),
      makeZone('z-adult', 'Adult', 'USER_DEFINED', [1620]),
    ];
    const policies: UnifiPolicyDto[] = [
      makePolicy('p1', 'z-adult', 'z-compute', 'Allow Adult Web Apps to WSH'),
      makePolicy('p2', 'z-iot', 'z-compute', 'Block IoT to Compute', 'BLOCK'),
    ];
    const topology: UnifiTopologySnapshotDto = {
      baseUrl: 'https://ui.panoramadr.com',
      appVersion: '11.0.104',
      capturedAt: '2026-11-24T16:00:00Z',
      sites: [{ id: 'site-1', name: 'Default' }],
      devices: [],
      clients: [],
      policies,
      networks: [
        {
          id: 'net-300',
          name: 'IoT Safe Systems',
          vlanId: 300,
          enabled: true,
          isDefault: false,
          zoneId: 'z-iot',
          zoneName: 'Untrusted & IoT systems',
          subnetCidr: '10.10.20.0/24',
          gatewayIp: '10.10.20.1',
          isolationEnabled: true,
          internetAccessEnabled: true,
          mdnsForwardingEnabled: false,
          origin: 'USER_DEFINED',
          clientCount: 10,
        },
        {
          id: 'net-20',
          name: 'Untrusted',
          vlanId: 20,
          enabled: true,
          isDefault: false,
          zoneId: 'z-iot',
          zoneName: 'Untrusted & IoT systems',
          subnetCidr: '10.10.50.0/24',
          gatewayIp: '10.10.50.1',
          isolationEnabled: true,
          internetAccessEnabled: true,
          mdnsForwardingEnabled: false,
          origin: 'USER_DEFINED',
          clientCount: 5,
        },
        {
          id: 'net-500',
          name: 'Compute Systems',
          vlanId: 500,
          enabled: true,
          isDefault: false,
          zoneId: 'z-compute',
          zoneName: 'Compute systems',
          subnetCidr: '172.25.25.0/24',
          gatewayIp: '172.25.25.1',
          isolationEnabled: false,
          internetAccessEnabled: true,
          mdnsForwardingEnabled: false,
          origin: 'USER_DEFINED',
          clientCount: 1,
        },
        {
          id: 'net-1620',
          name: 'Adult Secure',
          vlanId: 1620,
          enabled: true,
          isDefault: false,
          zoneId: 'z-adult',
          zoneName: 'Adult',
          subnetCidr: '172.16.200.0/24',
          gatewayIp: '172.16.200.1',
          isolationEnabled: false,
          internetAccessEnabled: true,
          mdnsForwardingEnabled: false,
          origin: 'USER_DEFINED',
          clientCount: 7,
        },
      ],
      zones,
    };

    const matrix = buildZbfMatrix(zones, policies, { activeOnly: true });

    const html = renderToStaticMarkup(
      <UnifiZoneFlowExplorer
        topology={topology}
        matrix={matrix}
        initialSelectedZoneIds={['z-iot', 'z-compute', 'z-adult']}
      />
    );

    const h4Matches = [...html.matchAll(/<h4\b([^>]*)>(.*?)<\/h4>/g)];
    for (const expectedName of [
      'Untrusted &amp; IoT systems',
      'Compute systems',
      'Adult',
    ]) {
      const match = h4Matches.find((m) => m[2] === expectedName);
      expect(match).toBeDefined();
      expect(match![1]).not.toContain('truncate');
      expect(match![1]).toContain('break-words');
    }

    expect(html).toContain('VLAN 300');
    expect(html).toContain('VLAN 20');
    expect(html).toContain('VLAN 500');
    expect(html).toContain('VLAN 1620');
    expect(html).toContain('High-Level');
    expect(html).toContain('Inspect');

    // Also ensure UnifiVlanZbfPanel compiles and mounts the explorer cleanly
    const panelHtml = renderToStaticMarkup(
      <UnifiVlanZbfPanel
        topology={topology}
        isLoading={false}
        error={null}
        selectedVlanFilter="ALL"
        onSelectVlanFilter={() => {}}
        onRefresh={() => {}}
        onOpenUnifiFirewall={() => {}}
      />
    );
    expect(panelHtml).toContain('Untrusted &amp; IoT systems');
  });
});
