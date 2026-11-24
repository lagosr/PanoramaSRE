import { describe, it, expect } from 'vitest';
import {
  BOUNDARY_CANVAS_PAD,
  BOUNDARY_HIGH_LEVEL_WIDTH,
  BOUNDARY_INSPECTION_WIDTH,
  CORE_BOUNDARY_ZONE_IDS,
  buildTopologyBoundaryGraph,
  computeAutoBoundaryLayout,
  computeBoundaryCanvasBounds,
  computeBoundaryWireGeometries,
  getBoundaryCardWidth,
  getEffectiveBoundaryViewMode,
  mergeIncrementalBoundaryLayout,
  setBoundaryViewModeOverride,
  type BoundaryCardRect,
  type BoundaryCardViewMode,
  type BoundaryZoneId,
} from '../topology-boundary-layout';
import { synthesizeTopology } from '../topology-synthesizer';
import type { DiscoveredApp, WshSnapshot } from '../types';

function makeApp(
  slug: string,
  port: number,
  hostingTarget: 'wsh-docker' | 'wsh-docker-service' = 'wsh-docker'
): DiscoveredApp {
  return {
    manifest: {
      schemaVersion: 1,
      appId: slug,
      slug,
      displayName: slug === 'unifi-siem' ? 'UniFi SIEM Collector' : `App ${slug}`,
      portalTitle: slug,
      description: `${slug} service`,
      basePath: hostingTarget === 'wsh-docker' ? `/${slug}` : '',
      port,
      containerName: slug === 'unifi-siem' ? 'unifi-siem' : `panorama-${slug}`,
      composeProject: slug === 'unifi-siem' ? 'unifi-siem' : `panorama-${slug}`,
      remoteAppRoot: `/opt/${slug}`,
      dataVolume: hostingTarget === 'wsh-docker' ? `/var/data/${slug}` : '',
      localSqlitePath: '',
      themeColor: 'orange',
      icon: 'Shield',
      portalOrder: 1,
      roles: ['admin'],
      hostingTarget,
      service:
        hostingTarget === 'wsh-docker-service'
          ? {
              protocol: 'udp',
              bindIp: '172.25.25.5',
              networkName: 'unifi-siem-net',
              networkSubnet: '100.64.251.0/24',
              hostEnvPath: '/etc/panorama/unifi-siem.env',
              hostLogPath: '/var/data/unifi-siem/unifi-siem.log',
              optionalDeployment: true,
              requiresWshFirewall: true,
            }
          : undefined,
      sre: {
        deployScript: hostingTarget === 'wsh-docker-service' ? 'deploy-unifi-siem.ps1' : 'deploy-docker.ps1',
        dbScript: '',
        devCommand: '',
        healthEndpoint: '',
        manifestEndpoint: '',
        testCommand: '',
        typecheckCommand: '',
        requiresAuthInDev: false,
        automatedBackupDefault: false,
        exposeInRemotePortal: hostingTarget === 'wsh-docker',
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
      {
        Names: 'unifi-siem',
        State: 'running',
        Status: 'Up 1 hour',
        Ports: '172.25.25.5:5514->5514/udp',
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
    firewall_rules_raw: [
      '-N DOCKER-USER',
      '-A DOCKER-USER -d 10.0.0.0/8 -o eth0 -j DROP',
      '-A DOCKER-USER -d 172.16.0.0/12 -o eth0 -j DROP',
      '-A DOCKER-USER -d 192.168.0.0/16 -o eth0 -j DROP',
      '-A DOCKER-USER -i eth0 -p udp -m udp --dport 5514 -j DROP',
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

function rectsOverlap(a: BoundaryCardRect, b: BoundaryCardRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

describe('topology-boundary-layout', () => {
  it('resolves holistic vs per-zone boundary view overrides cleanly', () => {
    expect(getBoundaryCardWidth('high-level')).toBe(BOUNDARY_HIGH_LEVEL_WIDTH);
    expect(getBoundaryCardWidth('inspection')).toBe(BOUNDARY_INSPECTION_WIDTH);

    let overrides: Partial<Record<BoundaryZoneId, BoundaryCardViewMode>> = {};
    expect(getEffectiveBoundaryViewMode('edge', 'high-level', overrides)).toBe('high-level');

    overrides = setBoundaryViewModeOverride('edge', 'inspection', 'high-level', overrides);
    expect(getEffectiveBoundaryViewMode('edge', 'high-level', overrides)).toBe('inspection');
    expect(getEffectiveBoundaryViewMode('tunnel', 'high-level', overrides)).toBe('high-level');

    overrides = setBoundaryViewModeOverride('edge', 'high-level', 'high-level', overrides);
    expect(Object.keys(overrides)).toHaveLength(0);
  });

  it('builds core boundary graph, surfaces lan-services for wsh-docker-service, and gates blocked wires', () => {
    const apps = [makeApp('auth', 3000), makeApp('spendy', 3001), makeApp('unifi-siem', 5514, 'wsh-docker-service')];
    const snapshot = makeSnapshot();
    const topology = synthesizeTopology(apps, snapshot);

    const allowedOnly = buildTopologyBoundaryGraph(topology, {
      apps,
      snapshot,
      focusedRouteSlug: 'spendy',
      showBlockedBoundaries: false,
    });

    expect(allowedOnly.zones.map((z) => z.id)).toEqual([
      'edge',
      'tunnel',
      'host',
      'bridges',
      'containers',
      'storage',
      'lan-services',
    ]);
    expect(allowedOnly.connections.every((c) => !c.isBlockedBoundary)).toBe(true);
    expect(allowedOnly.connections.some((c) => c.id === 'host->lan-services')).toBe(true);
    expect(allowedOnly.connections.some((c) => c.protocolLabel.includes('127.0.0.1:3001'))).toBe(true);

    const withBlocked = buildTopologyBoundaryGraph(topology, {
      apps,
      snapshot,
      focusedRouteSlug: 'auth',
      showBlockedBoundaries: true,
    });
    const blockedConns = withBlocked.connections.filter((c) => c.isBlockedBoundary);
    expect(blockedConns.map((c) => c.id)).toEqual([
      'tunnel->host::blocked-admin',
      'tunnel->bridges::blocked-icc',
      'bridges->host::blocked-lan',
      'lan-services->bridges::blocked-icc',
    ]);

    const tunnelHostConns = withBlocked.connections.filter(
      (c) => c.sourceZoneId === 'tunnel' && c.destinationZoneId === 'host'
    );
    expect(tunnelHostConns).toHaveLength(2);
    expect(tunnelHostConns[0].siblingCount).toBe(2);
    expect(tunnelHostConns[1].siblingIndex).toBe(1);
  });

  it('arranges 6 boundary zones in a non-overlapping serpentine snake in both 3-col and 2-col widths', () => {
    const ids = [...CORE_BOUNDARY_ZONE_IDS];
    const highModes: Partial<Record<BoundaryZoneId, BoundaryCardViewMode>> = {};
    for (const id of ids) highModes[id] = 'high-level';

    const wideLayout = computeAutoBoundaryLayout(ids, 1650, highModes);
    // Row 1: edge < tunnel < host (left-to-right)
    expect(wideLayout.edge!.y).toBe(BOUNDARY_CANVAS_PAD);
    expect(wideLayout.tunnel!.x).toBeGreaterThan(wideLayout.edge!.x);
    expect(wideLayout.host!.x).toBeGreaterThan(wideLayout.tunnel!.x);
    // Row 2 serpentine: bridges (right) -> containers (mid) -> storage (left)
    expect(wideLayout.bridges!.y).toBeGreaterThan(wideLayout.host!.y);
    expect(wideLayout.containers!.x).toBeLessThan(wideLayout.bridges!.x);
    expect(wideLayout.storage!.x).toBeLessThan(wideLayout.containers!.x);
    expect(wideLayout.bridges!.x).toBe(wideLayout.host!.x);

    const rects: BoundaryCardRect[] = ids.map((id) => ({
      x: wideLayout[id]!.x,
      y: wideLayout[id]!.y,
      width: BOUNDARY_HIGH_LEVEL_WIDTH,
      height: 330,
    }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(rectsOverlap(rects[i], rects[j])).toBe(false);
      }
    }

    const inspectModes: Partial<Record<BoundaryZoneId, BoundaryCardViewMode>> = {};
    for (const id of ids) inspectModes[id] = 'inspection';
    const medLayout = computeAutoBoundaryLayout(ids, 1280, inspectModes);
    // 2 cols: Row 1 edge->tunnel, Row 2 bridges<-host
    expect(medLayout.tunnel!.x).toBeGreaterThan(medLayout.edge!.x);
    expect(medLayout.host!.y).toBeGreaterThan(medLayout.tunnel!.y);
    expect(medLayout.bridges!.x).toBeLessThan(medLayout.host!.x);
    expect(medLayout.containers!.y).toBeGreaterThan(medLayout.bridges!.y);
  });

  it('merges newly toggled zones without disturbing dragged coordinates and routes wires around obstacles', () => {
    const merged = mergeIncrementalBoundaryLayout(
      ['edge', 'tunnel', 'lan-services'],
      { edge: { x: 90, y: 80 }, tunnel: { x: 640, y: 80 } },
      1360,
      { edge: 'high-level', tunnel: 'high-level', 'lan-services': 'high-level' }
    );
    expect(merged.edge).toEqual({ x: 90, y: 80 });
    expect(merged.tunnel).toEqual({ x: 640, y: 80 });
    expect(merged['lan-services']!.y).toBeGreaterThan(80);

    const apps = [makeApp('auth', 3000), makeApp('unifi-siem', 5514, 'wsh-docker-service')];
    const snapshot = makeSnapshot();
    const topology = synthesizeTopology(apps, snapshot);
    const graph = buildTopologyBoundaryGraph(topology, {
      apps,
      snapshot,
      selectedZoneIds: ['tunnel', 'host', 'bridges'],
      showBlockedBoundaries: true,
    });

    // Place bridges directly between tunnel and host to force obstacle detour for tunnel->host wires
    const rects: Partial<Record<BoundaryZoneId, BoundaryCardRect>> = {
      tunnel: { x: 40, y: 120, width: 360, height: 320 },
      bridges: { x: 520, y: 120, width: 360, height: 320 },
      host: { x: 1000, y: 120, width: 360, height: 320 },
    };

    const geoms = computeBoundaryWireGeometries(graph.connections, rects, {
      'tunnel->host': { wireDx: 0, wireDy: 0, labelDx: 65, labelDy: -45 },
    });

    const allowed = geoms.find((g) => g.connection.id === 'tunnel->host');
    const blocked = geoms.find((g) => g.connection.id === 'tunnel->host::blocked-admin');
    expect(allowed).toBeDefined();
    expect(blocked).toBeDefined();
    expect(allowed!.pathD).toContain(' Q ');
    expect(allowed!.isManuallyAdjusted).toBe(true);
    expect(allowed!.tetherNeeded).toBe(true);
    expect(allowed!.anchorY).not.toBe(blocked!.anchorY);

    const bounds = computeBoundaryCanvasBounds(rects, geoms, 1000, 460);
    expect(bounds.width).toBeGreaterThanOrEqual(1456);
    expect(bounds.height).toBeGreaterThanOrEqual(536);
  });
});
