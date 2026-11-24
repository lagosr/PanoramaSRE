import type { DiscoveredApp, SecurityPostureInvariant, WshSnapshot } from './types';
import type { IngressHop, SynthesizedTopology } from './topology-synthesizer';

export type BoundaryZoneId =
  | 'edge'
  | 'tunnel'
  | 'host'
  | 'bridges'
  | 'containers'
  | 'storage'
  | 'lan-services';

export type BoundaryCardViewMode = 'high-level' | 'inspection';

export type BoundaryWireVerdict =
  | 'VERIFIED'
  | 'TUNNEL'
  | 'PINHOLE'
  | 'BLOCKED'
  | 'WARNING';

export interface BoundaryCardPosition {
  x: number;
  y: number;
}

export interface BoundaryCardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoundaryWireManualAdjustment {
  wireDx: number;
  wireDy: number;
  labelDx: number;
  labelDy: number;
}

export interface BoundaryRuleItem {
  id: string;
  title: string;
  action: 'ALLOW' | 'TUNNEL' | 'PINHOLE' | 'BLOCK' | 'WARN';
  direction: 'OUT' | 'IN' | 'LOCAL';
  peerZoneId?: BoundaryZoneId;
  peerZoneName?: string;
  detail: string;
  protocol?: string;
  evidence?: string;
  invariantId?: SecurityPostureInvariant['id'];
  status: 'pass' | 'warn' | 'fail';
}

export interface BoundaryEntityItem {
  id: string;
  name: string;
  subtitle?: string;
  primaryAddress?: string;
  secondaryAddress?: string;
  badge?: string;
  status: 'healthy' | 'warning' | 'neutral';
  routeSlug?: string;
  hop?: IngressHop | null;
}

export type BoundaryAccentKey =
  | 'indigo'
  | 'teal'
  | 'emerald'
  | 'sky'
  | 'amber'
  | 'lime'
  | 'orange';

export interface BoundaryZoneNode {
  id: BoundaryZoneId;
  order: number;
  name: string;
  shortName: string;
  badgeLabel: string;
  accentKey: BoundaryAccentKey;
  metadataAddresses: string[];
  metadataSummary: string;
  rules: BoundaryRuleItem[];
  entities: BoundaryEntityItem[];
  entityKindLabel: string;
  entitySearchable: boolean;
  isHealthy: boolean;
  warningCount: number;
}

export interface BoundaryConnection {
  id: string;
  sourceZoneId: BoundaryZoneId;
  destinationZoneId: BoundaryZoneId;
  sourceZoneName: string;
  destinationZoneName: string;
  verdict: BoundaryWireVerdict;
  shortLabel: string;
  protocolLabel: string;
  summary: string;
  detail: string;
  rules: BoundaryRuleItem[];
  isBlockedBoundary: boolean;
  routeSlug?: string | null;
  hop?: IngressHop | null;
  hasOppositeWire: boolean;
  siblingIndex: number;
  siblingCount: number;
}

export interface BoundaryWireGeometry {
  connection: BoundaryConnection;
  pathD: string;
  anchorX: number;
  anchorY: number;
  labelX: number;
  labelY: number;
  tetherNeeded: boolean;
  isManuallyAdjusted: boolean;
}

export interface TopologyBoundaryGraph {
  zones: BoundaryZoneNode[];
  connections: BoundaryConnection[];
}

export const BOUNDARY_ZONE_ORDER: readonly BoundaryZoneId[] = [
  'edge',
  'tunnel',
  'host',
  'bridges',
  'containers',
  'storage',
  'lan-services',
];

export const CORE_BOUNDARY_ZONE_IDS: readonly BoundaryZoneId[] = [
  'edge',
  'tunnel',
  'host',
  'bridges',
  'containers',
  'storage',
];

export const HOST_DOCKER_PRESET_ZONE_IDS: readonly BoundaryZoneId[] = [
  'host',
  'bridges',
  'containers',
  'storage',
];

export const BOUNDARY_HIGH_LEVEL_WIDTH = 360;
export const BOUNDARY_INSPECTION_WIDTH = 520;
export const BOUNDARY_ESTIMATED_HIGH_LEVEL_HEIGHT = 360;
export const BOUNDARY_ESTIMATED_INSPECTION_HEIGHT = 580;
export const BOUNDARY_CANVAS_PAD = 44;
export const BOUNDARY_GUTTER_X = 240;
export const BOUNDARY_GUTTER_Y = 144;

const PILL_HALF_WIDTH = 120;
const PILL_HALF_HEIGHT = 16;
const PILL_COLLISION_WIDTH = 244;
const PILL_COLLISION_HEIGHT = 34;

export function getBoundaryCardWidth(mode: BoundaryCardViewMode): number {
  return mode === 'high-level'
    ? BOUNDARY_HIGH_LEVEL_WIDTH
    : BOUNDARY_INSPECTION_WIDTH;
}

export function getEffectiveBoundaryViewMode(
  zoneId: BoundaryZoneId,
  globalMode: BoundaryCardViewMode,
  overrides: Partial<Record<BoundaryZoneId, BoundaryCardViewMode>>
): BoundaryCardViewMode {
  return overrides[zoneId] ?? globalMode;
}

export function setBoundaryViewModeOverride(
  zoneId: BoundaryZoneId,
  mode: BoundaryCardViewMode,
  globalMode: BoundaryCardViewMode,
  prev: Partial<Record<BoundaryZoneId, BoundaryCardViewMode>>
): Partial<Record<BoundaryZoneId, BoundaryCardViewMode>> {
  const next = { ...prev };
  if (mode === globalMode) {
    delete next[zoneId];
  } else {
    next[zoneId] = mode;
  }
  return next;
}

export function clampBoundaryCardPosition(
  pos: BoundaryCardPosition
): BoundaryCardPosition {
  return {
    x: Math.max(16, Math.round(pos.x)),
    y: Math.max(16, Math.round(pos.y)),
  };
}

function estimateCardHeight(
  zoneId: BoundaryZoneId,
  mode: BoundaryCardViewMode,
  measuredHeights?: Partial<Record<BoundaryZoneId, number>>
): number {
  const measured = measuredHeights?.[zoneId];
  if (typeof measured === 'number' && Number.isFinite(measured) && measured > 0) {
    return measured;
  }
  return mode === 'high-level'
    ? BOUNDARY_ESTIMATED_HIGH_LEVEL_HEIGHT
    : BOUNDARY_ESTIMATED_INSPECTION_HEIGHT;
}

function pickPrimaryLanIp(topology: SynthesizedTopology): string {
  for (const iface of topology.host.physicalInterfaces) {
    const v4 = (iface.addr_info ?? []).find(
      (a) => a.family === 'inet' && a.local && !a.local.startsWith('127.')
    );
    if (v4?.local) return v4.local;
  }
  return '172.25.25.5';
}

function invariantStatus(
  inv?: SecurityPostureInvariant
): 'pass' | 'warn' | 'fail' {
  if (!inv) return 'pass';
  if (inv.status === 'FAIL') return 'fail';
  if (inv.status === 'WARN') return 'warn';
  return 'pass';
}

function findInvariant(
  topology: SynthesizedTopology,
  id: SecurityPostureInvariant['id']
): SecurityPostureInvariant | undefined {
  return topology.securityAudit.invariants.find((i) => i.id === id);
}

/**
 * Synthesizes perimeter boundary zones and directional flow/blocked wires
 * from live WSH snapshots, security posture invariants, and discovered apps.
 */
export function buildTopologyBoundaryGraph(
  topology: SynthesizedTopology,
  options: {
    apps?: DiscoveredApp[];
    snapshot?: WshSnapshot | null;
    selectedZoneIds?: BoundaryZoneId[];
    focusedRouteSlug?: string | null;
    showBlockedBoundaries?: boolean;
    focusedRouteOnly?: boolean;
  } = {}
): TopologyBoundaryGraph {
  const apps = options.apps ?? [];
  const snapshot = options.snapshot ?? null;
  const focusedRoute = options.focusedRouteSlug
    ? topology.routes.find((r) => r.slug === options.focusedRouteSlug) ?? null
    : null;
  const focusedTrace = focusedRoute
    ? topology.ingressTraces[focusedRoute.slug] ?? []
    : [];

  const visibleRoutes =
    options.focusedRouteOnly && focusedRoute ? [focusedRoute] : topology.routes;

  const serviceApps = apps.filter(
    (a) => a.manifest.hostingTarget === 'wsh-docker-service'
  );
  const siemContainer = (snapshot?.containers ?? []).find((c) =>
    (c.Names || c.ID || '').toLowerCase().includes('unifi-siem')
  );
  const hasLanServices = serviceApps.length > 0 || Boolean(siemContainer);

  const lanIp = pickPrimaryLanIp(topology);

  const sec01 = findInvariant(topology, 'SEC-01');
  const sec02 = findInvariant(topology, 'SEC-02');
  const sec03 = findInvariant(topology, 'SEC-03');
  const sec04 = findInvariant(topology, 'SEC-04');
  const sec05 = findInvariant(topology, 'SEC-05');
  const sec06 = findInvariant(topology, 'SEC-06');
  const sec07 = findInvariant(topology, 'SEC-07');
  const sec08 = findInvariant(topology, 'SEC-08');
  const sec09 = findInvariant(topology, 'SEC-09');

  const countFailures = (...rules: BoundaryRuleItem[]): number =>
    rules.filter((r) => r.status !== 'pass').length;

  // 1. WAN & Cloudflare Edge
  const edgeRules: BoundaryRuleItem[] = [
    {
      id: 'edge-tunnel-quic',
      title: 'Anycast Edge → Outbound QUIC Tunnel',
      action: 'TUNNEL',
      direction: 'OUT',
      peerZoneId: 'tunnel',
      peerZoneName: 'CF Tunnel',
      protocol: 'HTTPS / HTTP/3 → QUIC UDP 7844',
      detail: focusedRoute
        ? `Public ${focusedRoute.canonicalUrl} traffic enters Cloudflare Anycast PoPs over TLS 1.3 and egresses strictly through cloudflared's persistent QUIC tunnel (0 open inbound WAN ports).`
        : `All ${topology.routes.length} public web routes traverse Cloudflare Anycast TLS 1.3 and enter via outbound cloudflared QUIC tunnel (0 open inbound WAN ports).`,
      status: 'pass',
    },
    {
      id: 'edge-zero-trust',
      title: 'Zero Inbound Router NAT & Origin Shield',
      action: 'ALLOW',
      direction: 'LOCAL',
      protocol: 'TLS 1.3 / Full (Strict)',
      detail:
        'Home WAN router maintains zero port-forwarding rules; origin exposure is limited strictly to Cloudflare Tunnel ingress.',
      status: 'pass',
    },
  ];
  const edgeEntities: BoundaryEntityItem[] = visibleRoutes.map((rt) => ({
    id: `edge-${rt.slug}`,
    name: `/${rt.slug}`,
    subtitle: rt.app?.manifest.displayName || rt.containerName,
    primaryAddress: rt.canonicalUrl.replace(/^https?:\/\//, ''),
    badge: `:${rt.port}`,
    status: rt.isHealthy ? 'healthy' : 'warning',
    routeSlug: rt.slug,
    hop: topology.ingressTraces[rt.slug]?.[1] ?? null,
  }));

  const edgeZone: BoundaryZoneNode = {
    id: 'edge',
    order: 0,
    name: 'WAN & Cloudflare Edge',
    shortName: 'WAN Edge',
    badgeLabel: '0 Open WAN Ports',
    accentKey: 'indigo',
    metadataAddresses: ['wsh.panoramadr.com'],
    metadataSummary: `TLS 1.3 · ${topology.routes.length} routes`,
    rules: edgeRules,
    entities: edgeEntities,
    entityKindLabel: 'Public Endpoints',
    entitySearchable: edgeEntities.length > 3,
    isHealthy: true,
    warningCount: 0,
  };

  // 2. Cloudflare Tunnel
  const cfHealthOk = topology.cloudflared.isHealthy;
  const cfStatus: 'pass' | 'warn' | 'fail' = !cfHealthOk
    ? 'fail'
    : topology.cloudflared.updateAvailable
      ? 'warn'
      : 'pass';
  const tunnelRules: BoundaryRuleItem[] = [
    {
      id: 'tunnel-in-edge',
      title: 'Inbound Tunnel Stream from Cloudflare PoPs',
      action: 'TUNNEL',
      direction: 'IN',
      peerZoneId: 'edge',
      peerZoneName: 'WAN Edge',
      protocol: 'QUIC UDP/7844',
      detail:
        'cloudflared initiates outbound authenticated connections to Cloudflare edge PoPs; zero listening WAN sockets exist on the Pi.',
      status: cfStatus,
    },
    {
      id: 'tunnel-out-host-443',
      title: 'Allowed Egress to Host Lighttpd :443',
      action: 'PINHOLE',
      direction: 'OUT',
      peerZoneId: 'host',
      peerZoneName: 'DietPi Host',
      protocol: 'TCP/443 (host-gateway)',
      detail:
        'PANORAMA-INPUT permits traffic from cf-egress-net (100.64.250.0/24) strictly to host Lighttpd HTTPS :443 and public DNS/Cloudflare PoPs.',
      evidence: sec04?.evidence,
      invariantId: 'SEC-04',
      status: invariantStatus(sec04),
    },
    {
      id: 'tunnel-sec05',
      title: sec05?.title || 'Dedicated Bridge Isolation (cf-egress-net)',
      action: 'ALLOW',
      direction: 'LOCAL',
      protocol: 'cap_drop: ALL · read_only',
      detail:
        sec05?.details ||
        'cloudflared runs inside isolated cf-egress-net bridge (100.64.250.0/24) with no host network privilege.',
      evidence: sec05?.evidence,
      invariantId: 'SEC-05',
      status: invariantStatus(sec05),
    },
    {
      id: 'tunnel-block-admin',
      title: 'Block SSH :22 & Cockpit :9442 from Tunnel',
      action: 'BLOCK',
      direction: 'OUT',
      peerZoneId: 'host',
      peerZoneName: 'DietPi Host',
      protocol: 'TCP 22, 9442 DROP',
      detail:
        'PANORAMA-INPUT explicitly drops admin control-plane ports (22, 9442) from Docker bridges so tunnel compromises cannot reach host shell.',
      evidence: sec04?.evidence,
      invariantId: 'SEC-04',
      status: invariantStatus(sec04),
    },
    {
      id: 'tunnel-block-bridges',
      title: 'Block Direct Tunnel → App Bridge Access',
      action: 'BLOCK',
      direction: 'OUT',
      peerZoneId: 'bridges',
      peerZoneName: 'Docker Bridges',
      protocol: 'DOCKER-USER DROP',
      detail:
        'Inter-bridge routing between cf-egress-net (100.64.250.0/24) and per-app CGNAT subnets is dropped in kernel Netfilter.',
      evidence: sec02?.evidence,
      invariantId: 'SEC-02',
      status: invariantStatus(sec02),
    },
  ];
  const tunnelZone: BoundaryZoneNode = {
    id: 'tunnel',
    order: 1,
    name: 'Cloudflare Tunnel (cloudflared)',
    shortName: 'CF Tunnel',
    badgeLabel: topology.cloudflared.runningVersion || 'cloudflared',
    accentKey: 'teal',
    metadataAddresses: ['100.64.250.0/24', '100.64.250.2'],
    metadataSummary: 'cf-egress-net',
    rules: tunnelRules,
    entities: [
      {
        id: 'cloudflared-daemon',
        name: 'cloudflared',
        subtitle: topology.cloudflared.ingressTarget,
        primaryAddress: '100.64.250.2',
        secondaryAddress: '100.64.250.0/24',
        badge: topology.cloudflared.updateAvailable
          ? 'Update Available'
          : cfHealthOk
            ? 'Connected'
            : 'Check Logs',
        status: !cfHealthOk || topology.cloudflared.updateAvailable ? 'warning' : 'healthy',
        hop: focusedTrace[2] ?? null,
      },
    ],
    entityKindLabel: 'Tunnel Container',
    entitySearchable: false,
    isHealthy: cfHealthOk && countFailures(...tunnelRules) === 0,
    warningCount: countFailures(...tunnelRules),
  };

  // 3. DietPi Host & Lighttpd Proxy
  const hostRules: BoundaryRuleItem[] = [
    {
      id: 'host-in-443',
      title: 'Terminate TLS :443 & Route Subpaths (Lighttpd)',
      action: 'PINHOLE',
      direction: 'IN',
      peerZoneId: 'tunnel',
      peerZoneName: 'CF Tunnel',
      protocol: 'HTTPS :443 → ^/<slug>',
      detail: focusedRoute
        ? `Matches ^/${focusedRoute.slug} and dispatches strictly over 127.0.0.1:${focusedRoute.port} (max body ${Math.round(focusedRoute.maxRequestSizeKb / 1024)}MB).`
        : `Lighttpd serves TLS :443 via Dynamic Portal and routes ${topology.routes.length} subpaths strictly to 127.0.0.1 loopback sockets.`,
      evidence: sec06?.evidence,
      invariantId: 'SEC-06',
      status: invariantStatus(sec06),
    },
    {
      id: 'host-out-bridges',
      title: 'Forward Loopback Ports to Container NAT',
      action: 'PINHOLE',
      direction: 'OUT',
      peerZoneId: 'bridges',
      peerZoneName: 'Docker Bridges',
      protocol: '127.0.0.1:3000-4000',
      detail:
        sec03?.details ||
        'Every web container port publishes exclusively to 127.0.0.1 (zero 0.0.0.0 wildcard bindings on eth0).',
      evidence: sec03?.evidence,
      invariantId: 'SEC-03',
      status: invariantStatus(sec03),
    },
    {
      id: 'host-block-admin-in',
      title: sec04?.title || 'Drop Host Control Plane Access from Bridges',
      action: 'BLOCK',
      direction: 'IN',
      peerZoneId: 'tunnel',
      peerZoneName: 'CF Tunnel',
      protocol: 'TCP 22, 9442 DROP',
      detail:
        sec04?.details ||
        'PANORAMA-INPUT blocks SSH (:22) and Cockpit (:9442) from Docker bridges and CGNAT 100.64.0.0/16.',
      evidence: sec04?.evidence,
      invariantId: 'SEC-04',
      status: invariantStatus(sec04),
    },
  ];
  if (hasLanServices) {
    hostRules.push({
      id: 'host-out-lan-services',
      title: 'Lock eth0 UDP/5514 Ingress to UniFi Allowlist',
      action: 'PINHOLE',
      direction: 'OUT',
      peerZoneId: 'lan-services',
      peerZoneName: 'LAN Services',
      protocol: 'eth0 172.25.25.5:5514/udp',
      detail:
        sec09?.details ||
        'DOCKER-USER accepts UDP/5514 strictly from CloudKey/Gateway allowlist (172.25.25.1, 10.10.1.1, 10.10.1.2) and drops all other LAN sources.',
      evidence: sec09?.evidence,
      invariantId: 'SEC-09',
      status: invariantStatus(sec09),
    });
  }
  const hostEntities: BoundaryEntityItem[] = visibleRoutes.map((rt) => ({
    id: `host-rt-${rt.slug}`,
    name: `^/${rt.slug}`,
    subtitle: `${rt.containerName} • ${rt.isLoopbackOnly ? 'Loopback only' : 'CHECK BIND'}`,
    primaryAddress: `127.0.0.1:${rt.port}`,
    badge: rt.isHealthy ? `:${rt.port}` : 'WARN',
    status: rt.isHealthy ? 'healthy' : 'warning',
    routeSlug: rt.slug,
    hop: topology.ingressTraces[rt.slug]?.[3] ?? null,
  }));

  const hostZone: BoundaryZoneNode = {
    id: 'host',
    order: 2,
    name: 'DietPi Host & Lighttpd',
    shortName: 'DietPi Host',
    badgeLabel: `${topology.host.hostname} · :443`,
    accentKey: 'emerald',
    metadataAddresses: [lanIp, '127.0.0.1'],
    metadataSummary: `DietPi ${topology.host.dietpiVersion}`,
    rules: hostRules,
    entities: hostEntities,
    entityKindLabel: 'Lighttpd Routes',
    entitySearchable: hostEntities.length > 3,
    isHealthy:
      countFailures(...hostRules) === 0 &&
      topology.securityAudit.zeroBindViolations.length === 0,
    warningCount:
      countFailures(...hostRules) + topology.securityAudit.zeroBindViolations.length,
  };

  // 4. Docker Engine & CGNAT Bridges
  const bridgeRules: BoundaryRuleItem[] = [
    {
      id: 'bridges-in-host',
      title: 'Kernel Netfilter DNAT from 127.0.0.1 Sockets',
      action: 'PINHOLE',
      direction: 'IN',
      peerZoneId: 'host',
      peerZoneName: 'DietPi Host',
      protocol: 'PREROUTING / DOCKER DNAT',
      detail: focusedRoute
        ? `Maps loopback 127.0.0.1:${focusedRoute.port} into bridge ${focusedRoute.bridgeSubnet} -> ${focusedRoute.containerIp}:${focusedRoute.port}.`
        : `Isolates ${topology.routes.length} web stacks into dedicated 100.64.x.0/24 bridges with ICC disabled.`,
      evidence: sec01?.evidence,
      invariantId: 'SEC-01',
      status: invariantStatus(sec01),
    },
    {
      id: 'bridges-out-containers',
      title: sec01?.title || 'Per-App CGNAT Bridge Pool (100.64.0.0/16)',
      action: 'ALLOW',
      direction: 'OUT',
      peerZoneId: 'containers',
      peerZoneName: 'Containers',
      protocol: 'veth <-> br-*',
      detail:
        sec01?.details ||
        'Every container bridge allocates from 100.64.0.0/16 (/24 per stack) avoiding collisions with UniFi LAN VLANs.',
      evidence: sec01?.evidence,
      invariantId: 'SEC-01',
      status: invariantStatus(sec01),
    },
    {
      id: 'bridges-block-lan',
      title: sec02?.title || 'Block RFC1918 LAN & Gateway Egress',
      action: 'BLOCK',
      direction: 'OUT',
      peerZoneId: 'host',
      peerZoneName: 'DietPi Host',
      protocol: '10/8, 172.16/12, 192.168/16 DROP',
      detail:
        sec02?.details ||
        'DOCKER-USER blocks lateral movement from Docker bridges into physical LAN subnets and UniFi Gateway Pro management.',
      evidence: sec07?.evidence || sec02?.evidence,
      invariantId: 'SEC-02',
      status:
        invariantStatus(sec02) !== 'pass'
          ? invariantStatus(sec02)
          : invariantStatus(sec07),
    },
  ];

  const bridgeEntities: BoundaryEntityItem[] = [];
  const seenBridges = new Set<string>();
  for (const rt of visibleRoutes) {
    seenBridges.add(rt.bridgeSubnet);
    bridgeEntities.push({
      id: `br-route-${rt.slug}`,
      name: `br-${rt.slug}`,
      subtitle: `${rt.containerName} -> :${rt.port}`,
      primaryAddress: rt.bridgeSubnet,
      secondaryAddress: rt.containerIp,
      badge: `/${rt.slug}`,
      status: rt.isHealthy ? 'healthy' : 'warning',
      routeSlug: rt.slug,
      hop: topology.ingressTraces[rt.slug]?.[5] ?? null,
    });
  }
  if (!options.focusedRouteOnly) {
    for (const net of topology.docker.networks) {
      if (net.Name === 'host' || net.Name === 'none' || net.Name === 'bridge') {
        continue;
      }
      const subnet = net.IPAM?.Config?.[0]?.Subnet || '';
      if (!subnet || seenBridges.has(subnet)) continue;
      seenBridges.add(subnet);
      const containerCount = net.Containers ? Object.keys(net.Containers).length : 0;
      bridgeEntities.push({
        id: `br-net-${net.Name}`,
        name: net.Name,
        subtitle: `${net.Driver} bridge • ${containerCount} endpoint(s)`,
        primaryAddress: subnet,
        badge: subnet.startsWith('100.64.') ? 'CGNAT' : 'CHECK',
        status: subnet.startsWith('100.64.') ? 'healthy' : 'warning',
      });
    }
  }

  const bridgesZone: BoundaryZoneNode = {
    id: 'bridges',
    order: 3,
    name: 'Docker Engine & CGNAT Bridges',
    shortName: 'Docker Bridges',
    badgeLabel: `${bridgeEntities.length} Bridges`,
    accentKey: 'sky',
    metadataAddresses: ['100.64.0.0/16'],
    metadataSummary: `Audit ${topology.securityAudit.score}/100`,
    rules: bridgeRules,
    entities: bridgeEntities,
    entityKindLabel: 'Bridge Subnets',
    entitySearchable: bridgeEntities.length > 3,
    isHealthy: countFailures(...bridgeRules) === 0,
    warningCount: countFailures(...bridgeRules),
  };

  // 5. App Container Enclaves
  const runningRoutesCount = visibleRoutes.filter((r) => r.isHealthy).length;
  const zeroBindFailed = topology.securityAudit.zeroBindViolations.length > 0;
  const containerRules: BoundaryRuleItem[] = [
    {
      id: 'containers-in-bridges',
      title: 'Isolated veth Namespace Ingress',
      action: 'ALLOW',
      direction: 'IN',
      peerZoneId: 'bridges',
      peerZoneName: 'Docker Bridges',
      protocol: 'veth -> eth0',
      detail: focusedRoute
        ? `Container ${focusedRoute.containerName} listens on ${focusedRoute.containerIp}:${focusedRoute.port} inside its dedicated network namespace.`
        : `${runningRoutesCount}/${visibleRoutes.length} app containers active with ${topology.securityAudit.loopbackSecuredCount} loopback-pinned host ports.`,
      status: zeroBindFailed || runningRoutesCount < visibleRoutes.length ? 'warn' : 'pass',
    },
    {
      id: 'containers-sec08',
      title: sec08?.title || 'Non-Root USER nextjs & cap_drop: ALL',
      action: 'ALLOW',
      direction: 'LOCAL',
      protocol: 'no-new-privileges: true',
      detail:
        sec08?.details ||
        'All suite containers drop Linux capabilities, block privilege escalation, and run non-root (nextjs / UID 1000).',
      evidence: sec08?.evidence,
      invariantId: 'SEC-08',
      status: invariantStatus(sec08),
    },
    {
      id: 'containers-out-storage',
      title: 'Strict Persistent Bind-Mount Data Plane',
      action: 'ALLOW',
      direction: 'OUT',
      peerZoneId: 'storage',
      peerZoneName: 'Storage Plane',
      protocol: 'Bind /app/data (WAL)',
      detail:
        'Containers write stateful SQLite databases solely to per-app host bind mounts under /var/data/*.',
      status: 'pass',
    },
  ];
  const containerEntities: BoundaryEntityItem[] = visibleRoutes.map((rt) => ({
    id: `ctr-${rt.slug}`,
    name: rt.containerName,
    subtitle: rt.app?.manifest.displayName || `/${rt.slug}`,
    primaryAddress: `${rt.containerIp}:${rt.port}`,
    secondaryAddress: `127.0.0.1:${rt.port}`,
    badge: rt.containerStatus.toUpperCase(),
    status: rt.isHealthy ? 'healthy' : 'warning',
    routeSlug: rt.slug,
    hop: topology.ingressTraces[rt.slug]?.[6] ?? null,
  }));

  const containersZone: BoundaryZoneNode = {
    id: 'containers',
    order: 4,
    name: 'App Container Enclaves',
    shortName: 'Containers',
    badgeLabel: `${runningRoutesCount}/${visibleRoutes.length} Running`,
    accentKey: 'amber',
    metadataAddresses: focusedRoute
      ? [focusedRoute.containerIp, `127.0.0.1:${focusedRoute.port}`]
      : [`${visibleRoutes.length} enclaves`],
    metadataSummary: 'cap_drop: ALL',
    rules: containerRules,
    entities: containerEntities,
    entityKindLabel: 'Container Enclaves',
    entitySearchable: containerEntities.length > 3,
    isHealthy:
      !zeroBindFailed &&
      countFailures(...containerRules) === 0 &&
      runningRoutesCount === visibleRoutes.length,
    warningCount:
      countFailures(...containerRules) +
      visibleRoutes.filter((r) => !r.isHealthy).length,
  };

  // 6. Persistent Storage Data Plane
  const storageRules: BoundaryRuleItem[] = [
    {
      id: 'storage-in-containers',
      title: 'Per-App Host Bind-Mounted SQLite Volumes',
      action: 'ALLOW',
      direction: 'IN',
      peerZoneId: 'containers',
      peerZoneName: 'Containers',
      protocol: 'SQLite WAL + GFS Backups',
      detail: focusedRoute
        ? `${focusedRoute.slug}.sqlite persisted on host volume with PRAGMA journal_mode=WAL and nightly encrypted DR backups.`
        : `Each enclave owns an isolated /var/data/<app>/data mount in WAL mode with zero cross-app SQLite sharing.`,
      status: 'pass',
    },
  ];
  if (hasLanServices) {
    storageRules.push({
      id: 'storage-in-siem',
      title: 'Bounded SIEM CEF NDJSON Rotation',
      action: 'ALLOW',
      direction: 'IN',
      peerZoneId: 'lan-services',
      peerZoneName: 'LAN Services',
      protocol: '0640 UID 1000 · 50MB Cap',
      detail:
        'unifi-siem rotates NDJSON files at 10MB × 5 files inside /var/data/unifi-siem/unifi-siem.log with no write access to app DBs.',
      status: 'pass',
    });
  }

  const storageEntities: BoundaryEntityItem[] = visibleRoutes.map((rt) => {
    const volPath = rt.app?.manifest.dataVolume || `/var/data/${rt.containerName}/data`;
    return {
      id: `vol-${rt.slug}`,
      name: `${rt.slug}.sqlite`,
      subtitle: `${volPath} -> /app/data`,
      primaryAddress: volPath,
      badge: 'WAL',
      status: rt.isHealthy ? 'healthy' : 'warning',
      routeSlug: rt.slug,
      hop:
        topology.ingressTraces[rt.slug]?.[
          Math.max(0, (topology.ingressTraces[rt.slug]?.length ?? 1) - 1)
        ] ?? null,
    };
  });
  if (hasLanServices && !options.focusedRouteOnly) {
    const firstSvc = serviceApps[0];
    const logPath =
      firstSvc?.manifest.service?.hostLogPath || '/var/data/unifi-siem/unifi-siem.log';
    storageEntities.push({
      id: 'vol-unifi-siem',
      name: 'unifi-siem.log',
      subtitle: `${logPath} (10MB × 5)`,
      primaryAddress: logPath,
      badge: 'NDJSON',
      status: siemContainer?.State?.toLowerCase() === 'running' ? 'healthy' : 'neutral',
    });
  }

  const storageZone: BoundaryZoneNode = {
    id: 'storage',
    order: 5,
    name: 'Persistent Storage Plane',
    shortName: 'Storage Plane',
    badgeLabel: `${storageEntities.length} Volumes`,
    accentKey: 'lime',
    metadataAddresses: ['/var/data'],
    metadataSummary: 'SQLite WAL + NDJSON',
    rules: storageRules,
    entities: storageEntities,
    entityKindLabel: 'Host Bind Mounts',
    entitySearchable: storageEntities.length > 3,
    isHealthy: true,
    warningCount: 0,
  };

  const zones: BoundaryZoneNode[] = [
    edgeZone,
    tunnelZone,
    hostZone,
    bridgesZone,
    containersZone,
    storageZone,
  ];

  // 7. Optional LAN Headless Services (e.g. unifi-siem)
  if (hasLanServices) {
    const firstSvc = serviceApps[0];
    const svcBindIp = firstSvc?.manifest.service?.bindIp || '172.25.25.5';
    const svcPort = firstSvc?.manifest.port || 5514;
    const svcProto = (firstSvc?.manifest.service?.protocol || 'udp').toUpperCase();
    const svcNetName = firstSvc?.manifest.service?.networkName || 'unifi-siem-net';
    const svcSubnet = firstSvc?.manifest.service?.networkSubnet || '100.64.251.0/24';
    const svcLogPath =
      firstSvc?.manifest.service?.hostLogPath || '/var/data/unifi-siem/unifi-siem.log';
    const isRunning =
      siemContainer?.State?.toLowerCase() === 'running' ||
      firstSvc?.health?.status === 'healthy';
    const isDeployed = Boolean(siemContainer) || firstSvc?.health?.status === 'healthy';

    const lanSvcRules: BoundaryRuleItem[] = [
      {
        id: 'lan-svc-in-host',
        title: sec09?.title || 'UDP/5514 Strict UniFi Allowlist Lock',
        action: 'PINHOLE',
        direction: 'IN',
        peerZoneId: 'host',
        peerZoneName: 'DietPi Host',
        protocol: `${svcBindIp}:${svcPort}/${svcProto}`,
        detail:
          sec09?.details ||
          'DOCKER-USER permits UDP/5514 exclusively from 172.25.25.1, 10.10.1.1, and 10.10.1.2; container also drops non-allowlisted packets before CEF parsing.',
        evidence: sec09?.evidence,
        invariantId: 'SEC-09',
        status: invariantStatus(sec09),
      },
      {
        id: 'lan-svc-out-storage',
        title: 'Write Parsed CEF Stream to /var/data/unifi-siem',
        action: 'ALLOW',
        direction: 'OUT',
        peerZoneId: 'storage',
        peerZoneName: 'Storage Plane',
        protocol: 'read_only rootfs · 96m mem',
        detail: `Appends structured CEF NDJSON lines into ${svcLogPath} with bounded 50MB log rotation.`,
        status: 'pass',
      },
      {
        id: 'lan-svc-block-bridges',
        title: 'Block Cross-Bridge Access to Web App Containers',
        action: 'BLOCK',
        direction: 'OUT',
        peerZoneId: 'bridges',
        peerZoneName: 'Docker Bridges',
        protocol: 'DOCKER-USER DROP',
        detail: `${svcNetName} (${svcSubnet}) cannot communicate with any web application bridge or physical LAN host.`,
        status: 'pass',
      },
    ];

    const lanEntities: BoundaryEntityItem[] =
      serviceApps.length > 0
        ? serviceApps.map((svc) => {
            const sIp = svc.manifest.service?.bindIp || '172.25.25.5';
            const sProto = svc.manifest.service?.protocol || 'udp';
            const running =
              svc.health?.status === 'healthy' || Boolean(siemContainer && isRunning);
            return {
              id: `svc-${svc.manifest.slug}`,
              name: svc.manifest.displayName || svc.manifest.slug,
              subtitle: `${svc.manifest.containerName} • ${sProto.toUpperCase()} • ${svc.manifest.service?.networkName || svcNetName}`,
              primaryAddress: `${sIp}:${svc.manifest.port}`,
              secondaryAddress: svc.manifest.service?.networkSubnet || svcSubnet,
              badge: running
                ? 'RUNNING'
                : svc.health?.status === 'not_deployed' && !siemContainer
                  ? 'OPTIONAL'
                  : 'STOPPED',
              status: running ? 'healthy' : isDeployed ? 'warning' : 'neutral',
            };
          })
        : [
            {
              id: 'svc-unifi-siem',
              name: siemContainer?.Names?.replace(/^\//, '') || 'unifi-siem',
              subtitle: `Headless UDP Collector • ${svcNetName}`,
              primaryAddress: `${svcBindIp}:${svcPort}`,
              secondaryAddress: svcSubnet,
              badge: isRunning ? 'RUNNING' : 'STOPPED',
              status: isRunning ? 'healthy' : 'warning',
            },
          ];

    zones.push({
      id: 'lan-services',
      order: 6,
      name: 'LAN Headless Services',
      shortName: 'LAN Services',
      badgeLabel: isRunning ? 'Running' : isDeployed ? 'Stopped' : 'Optional',
      accentKey: 'orange',
      metadataAddresses: [`${svcBindIp}:${svcPort}`, svcSubnet],
      metadataSummary: `${svcProto} · DOCKER-USER Locked`,
      rules: lanSvcRules,
      entities: lanEntities,
      entityKindLabel: 'Headless Services',
      entitySearchable: lanEntities.length > 3,
      isHealthy: (!isDeployed || isRunning) && countFailures(...lanSvcRules) === 0,
      warningCount: countFailures(...lanSvcRules),
    });
  }

  // Build Directed Connections among currently active zones
  const selectedSet = new Set<BoundaryZoneId>(
    options.selectedZoneIds && options.selectedZoneIds.length > 0
      ? options.selectedZoneIds
      : zones.map((z) => z.id)
  );
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const rawConnections: Omit<
    BoundaryConnection,
    'hasOppositeWire' | 'siblingIndex' | 'siblingCount'
  >[] = [];

  const pushConn = (
    conn: Omit<
      BoundaryConnection,
      'hasOppositeWire' | 'siblingIndex' | 'siblingCount'
    >
  ) => {
    if (!selectedSet.has(conn.sourceZoneId) || !selectedSet.has(conn.destinationZoneId)) {
      return;
    }
    rawConnections.push(conn);
  };

  pushConn({
    id: 'edge->tunnel',
    sourceZoneId: 'edge',
    destinationZoneId: 'tunnel',
    sourceZoneName: edgeZone.shortName,
    destinationZoneName: tunnelZone.shortName,
    verdict: 'TUNNEL',
    shortLabel: 'TUNNEL',
    protocolLabel: 'QUIC UDP/7844',
    summary: 'Outbound encrypted QUIC tunnel to Cloudflare Edge PoPs (0 inbound ports).',
    detail: edgeRules[0].detail,
    rules: [edgeRules[0], tunnelRules[0]],
    isBlockedBoundary: false,
    routeSlug: focusedRoute?.slug ?? null,
    hop: focusedTrace[2] ?? null,
  });

  pushConn({
    id: 'tunnel->host',
    sourceZoneId: 'tunnel',
    destinationZoneId: 'host',
    sourceZoneName: tunnelZone.shortName,
    destinationZoneName: hostZone.shortName,
    verdict: invariantStatus(sec04) === 'pass' ? 'PINHOLE' : 'WARNING',
    shortLabel: 'PINHOLE',
    protocolLabel: focusedRoute
      ? `:443 ^/${focusedRoute.slug}`
      : 'HTTPS :443 Only',
    summary:
      'cloudflared forwards validated HTTPS requests strictly to host Lighttpd :443.',
    detail: tunnelRules[1].detail,
    rules: [tunnelRules[1], hostRules[0]],
    isBlockedBoundary: false,
    routeSlug: focusedRoute?.slug ?? null,
    hop: focusedTrace[3] ?? null,
  });

  pushConn({
    id: 'host->bridges',
    sourceZoneId: 'host',
    destinationZoneId: 'bridges',
    sourceZoneName: hostZone.shortName,
    destinationZoneName: bridgesZone.shortName,
    verdict: zeroBindFailed ? 'WARNING' : 'PINHOLE',
    shortLabel: zeroBindFailed ? 'WARN' : 'PINHOLE',
    protocolLabel: focusedRoute
      ? `127.0.0.1:${focusedRoute.port}`
      : '127.0.0.1 Loopback',
    summary: focusedRoute
      ? `Lighttpd proxies /${focusedRoute.slug} via 127.0.0.1:${focusedRoute.port} into ${focusedRoute.bridgeSubnet}.`
      : `Lighttpd proxies ${topology.routes.length} subpaths strictly over 127.0.0.1 loopback sockets into 100.64.0.0/16 NAT bridges.`,
    detail: hostRules[1].detail,
    rules: [hostRules[1], bridgeRules[0]],
    isBlockedBoundary: false,
    routeSlug: focusedRoute?.slug ?? null,
    hop: focusedTrace[5] ?? null,
  });

  pushConn({
    id: 'bridges->containers',
    sourceZoneId: 'bridges',
    destinationZoneId: 'containers',
    sourceZoneName: bridgesZone.shortName,
    destinationZoneName: containersZone.shortName,
    verdict:
      containersZone.isHealthy && bridgesZone.isHealthy ? 'VERIFIED' : 'WARNING',
    shortLabel: 'VERIFIED',
    protocolLabel: focusedRoute
      ? `${focusedRoute.containerIp}:${focusedRoute.port}`
      : `veth → ${runningRoutesCount}/${visibleRoutes.length}`,
    summary: focusedRoute
      ? `Bridge DNAT delivers isolated veth traffic to ${focusedRoute.containerName} (${focusedRoute.containerIp}:${focusedRoute.port}).`
      : `Per-app CGNAT /24 bridges route isolated veth frames into hardened Next.js containers.`,
    detail: bridgeRules[1].detail,
    rules: [bridgeRules[1], containerRules[0], containerRules[1]],
    isBlockedBoundary: false,
    routeSlug: focusedRoute?.slug ?? null,
    hop: focusedTrace[6] ?? null,
  });

  pushConn({
    id: 'containers->storage',
    sourceZoneId: 'containers',
    destinationZoneId: 'storage',
    sourceZoneName: containersZone.shortName,
    destinationZoneName: storageZone.shortName,
    verdict: 'VERIFIED',
    shortLabel: 'VERIFIED',
    protocolLabel: focusedRoute
      ? `${focusedRoute.slug}.sqlite WAL`
      : 'SQLite WAL Mounts',
    summary: focusedRoute
      ? `${focusedRoute.containerName} persists ${focusedRoute.slug}.sqlite over isolated host bind mount.`
      : `Isolated container enclaves persist SQLite WAL databases under per-app /var/data volumes.`,
    detail: containerRules[2].detail,
    rules: [containerRules[2], storageRules[0]],
    isBlockedBoundary: false,
    routeSlug: focusedRoute?.slug ?? null,
    hop: focusedTrace[Math.max(0, focusedTrace.length - 1)] ?? null,
  });

  const lanSvcZone = zoneById.get('lan-services');
  if (lanSvcZone) {
    pushConn({
      id: 'host->lan-services',
      sourceZoneId: 'host',
      destinationZoneId: 'lan-services',
      sourceZoneName: hostZone.shortName,
      destinationZoneName: lanSvcZone.shortName,
      verdict: invariantStatus(sec09) === 'pass' ? 'PINHOLE' : 'WARNING',
      shortLabel: 'PINHOLE',
      protocolLabel: `${serviceApps[0]?.manifest.service?.bindIp || '172.25.25.5'}:${serviceApps[0]?.manifest.port || 5514}/udp`,
      summary:
        'eth0 UDP/5514 pinhole restricted by DOCKER-USER allowlist + fail-closed collector IP check.',
      detail: lanSvcZone.rules[0].detail,
      rules: [lanSvcZone.rules[0]],
      isBlockedBoundary: false,
      routeSlug: null,
      hop: null,
    });

    pushConn({
      id: 'lan-services->storage',
      sourceZoneId: 'lan-services',
      destinationZoneId: 'storage',
      sourceZoneName: lanSvcZone.shortName,
      destinationZoneName: storageZone.shortName,
      verdict: 'VERIFIED',
      shortLabel: 'VERIFIED',
      protocolLabel: 'NDJSON 50MB Cap',
      summary:
        'Read-only collector container appends rotated CEF telemetry into /var/data/unifi-siem/unifi-siem.log.',
      detail: lanSvcZone.rules[1].detail,
      rules: [lanSvcZone.rules[1], storageRules[storageRules.length - 1]],
      isBlockedBoundary: false,
      routeSlug: null,
      hop: null,
    });
  }

  if (options.showBlockedBoundaries) {
    pushConn({
      id: 'tunnel->host::blocked-admin',
      sourceZoneId: 'tunnel',
      destinationZoneId: 'host',
      sourceZoneName: tunnelZone.shortName,
      destinationZoneName: hostZone.shortName,
      verdict: 'BLOCKED',
      shortLabel: 'BLOCKED',
      protocolLabel: 'SSH :22 · :9442',
      summary:
        'PANORAMA-INPUT drops host SSH (:22) and Cockpit (:9442) probes originating from Docker tunnel bridges.',
      detail: tunnelRules[3].detail,
      rules: [tunnelRules[3], hostRules[2]],
      isBlockedBoundary: true,
      routeSlug: null,
      hop: null,
    });

    pushConn({
      id: 'tunnel->bridges::blocked-icc',
      sourceZoneId: 'tunnel',
      destinationZoneId: 'bridges',
      sourceZoneName: tunnelZone.shortName,
      destinationZoneName: bridgesZone.shortName,
      verdict: 'BLOCKED',
      shortLabel: 'BLOCKED',
      protocolLabel: 'Inter-Bridge DROP',
      summary:
        'DOCKER-USER prevents cloudflared bridge (100.64.250.0/24) from directly dialing backend container bridges.',
      detail: tunnelRules[4].detail,
      rules: [tunnelRules[4]],
      isBlockedBoundary: true,
      routeSlug: null,
      hop: null,
    });

    pushConn({
      id: 'bridges->host::blocked-lan',
      sourceZoneId: 'bridges',
      destinationZoneId: 'host',
      sourceZoneName: bridgesZone.shortName,
      destinationZoneName: hostZone.shortName,
      verdict: 'BLOCKED',
      shortLabel: 'BLOCKED',
      protocolLabel: 'RFC1918 LAN DROP',
      summary:
        'DOCKER-USER + UniFi ZBF drop container egress to RFC1918 LAN VLANs and Gateway Pro control ports.',
      detail: bridgeRules[2].detail,
      rules: [bridgeRules[2]],
      isBlockedBoundary: true,
      routeSlug: null,
      hop: null,
    });

    if (lanSvcZone) {
      pushConn({
        id: 'lan-services->bridges::blocked-icc',
        sourceZoneId: 'lan-services',
        destinationZoneId: 'bridges',
        sourceZoneName: lanSvcZone.shortName,
        destinationZoneName: bridgesZone.shortName,
        verdict: 'BLOCKED',
        shortLabel: 'BLOCKED',
        protocolLabel: 'Cross-Bridge DROP',
        summary:
          'unifi-siem-net (100.64.251.0/24) is isolated in Netfilter from all web app container bridges.',
        detail: lanSvcZone.rules[2].detail,
        rules: [lanSvcZone.rules[2]],
        isBlockedBoundary: true,
        routeSlug: null,
        hop: null,
      });
    }
  }

  // Group siblings between identical unordered pairs to fan parallel/opposite wires cleanly
  const byPairKey = new Map<string, number[]>();
  rawConnections.forEach((c, idx) => {
    const key =
      c.sourceZoneId < c.destinationZoneId
        ? `${c.sourceZoneId}::${c.destinationZoneId}`
        : `${c.destinationZoneId}::${c.sourceZoneId}`;
    const arr = byPairKey.get(key) ?? [];
    arr.push(idx);
    byPairKey.set(key, arr);
  });

  const connections: BoundaryConnection[] = rawConnections.map((c, idx) => {
    const key =
      c.sourceZoneId < c.destinationZoneId
        ? `${c.sourceZoneId}::${c.destinationZoneId}`
        : `${c.destinationZoneId}::${c.sourceZoneId}`;
    const pairIndices = byPairKey.get(key) ?? [idx];
    const siblingIndex = pairIndices.indexOf(idx);
    const siblingCount = pairIndices.length;
    const hasOppositeWire = pairIndices.some((otherIdx) => {
      const other = rawConnections[otherIdx];
      return (
        other.sourceZoneId === c.destinationZoneId &&
        other.destinationZoneId === c.sourceZoneId
      );
    });

    return {
      ...c,
      hasOppositeWire,
      siblingIndex,
      siblingCount,
    };
  });

  return { zones, connections };
}

/**
 * Arranges selected perimeter zones into a zero-crossing serpentine grid:
 * even rows progress left-to-right, odd rows progress right-to-left so
 * consecutive boundary hops sit immediately adjacent across row transitions.
 */
export function computeAutoBoundaryLayout(
  zoneIds: BoundaryZoneId[],
  availableWidth: number,
  viewModeByZoneId: Partial<Record<BoundaryZoneId, BoundaryCardViewMode>>,
  measuredHeights?: Partial<Record<BoundaryZoneId, number>>
): Partial<Record<BoundaryZoneId, BoundaryCardPosition>> {
  if (zoneIds.length === 0) return {};

  const ordered = [...zoneIds].sort(
    (a, b) => BOUNDARY_ZONE_ORDER.indexOf(a) - BOUNDARY_ZONE_ORDER.indexOf(b)
  );
  const safeWidth = Math.max(
    BOUNDARY_INSPECTION_WIDTH + BOUNDARY_CANVAS_PAD * 2,
    Math.round(availableWidth > 0 ? availableWidth : 1360)
  );

  const getDim = (id: BoundaryZoneId) => {
    const mode = viewModeByZoneId[id] ?? 'high-level';
    return {
      id,
      mode,
      width: getBoundaryCardWidth(mode),
      height: estimateCardHeight(id, mode, measuredHeights),
    };
  };

  if (ordered.length === 1) {
    const d = getDim(ordered[0]);
    const x = Math.max(BOUNDARY_CANVAS_PAD, Math.round((safeWidth - d.width) / 2));
    return { [d.id]: clampBoundaryCardPosition({ x, y: BOUNDARY_CANVAS_PAD }) };
  }

  // Pack rows cleanly: 1 col on narrow mobile (<820px), 3 cols on wide high-level (>=1500px), else 2-col serpentine
  const rows: Array<{
    items: Array<ReturnType<typeof getDim>>;
    rowWidth: number;
    rowHeight: number;
  }> = [];

  let current: Array<ReturnType<typeof getDim>> = [];
  let currentW = 0;
  let currentMaxH = 0;

  for (const id of ordered) {
    const item = getDim(id);
    const nextW =
      current.length === 0 ? item.width : currentW + BOUNDARY_GUTTER_X + item.width;
    const allHighLevel =
      current.every((c) => c.mode === 'high-level') && item.mode === 'high-level';
    const targetCols =
      safeWidth < 820 ? 1 : allHighLevel && safeWidth >= 1500 ? 3 : 2;
    const widthExceededForThird =
      targetCols === 3 &&
      current.length >= 2 &&
      BOUNDARY_CANVAS_PAD * 2 + nextW > safeWidth;

    if (
      current.length > 0 &&
      (current.length >= targetCols || widthExceededForThird)
    ) {
      rows.push({
        items: current,
        rowWidth: currentW,
        rowHeight: currentMaxH,
      });
      current = [item];
      currentW = item.width;
      currentMaxH = item.height;
    } else {
      current.push(item);
      currentW = nextW;
      currentMaxH = Math.max(currentMaxH, item.height);
    }
  }
  if (current.length > 0) {
    rows.push({
      items: current,
      rowWidth: currentW,
      rowHeight: currentMaxH,
    });
  }

  // Serpentine placement: reverse odd rows so consecutive pipeline steps stay directly connected
  const positions: Partial<Record<BoundaryZoneId, BoundaryCardPosition>> = {};
  let cursorY = BOUNDARY_CANVAS_PAD;

  rows.forEach((row, rowIdx) => {
    const startX = Math.max(
      BOUNDARY_CANVAS_PAD,
      Math.round((safeWidth - row.rowWidth) / 2)
    );
    const sequence = rowIdx % 2 === 1 ? [...row.items].reverse() : row.items;
    let cursorX = startX;
    for (const item of sequence) {
      positions[item.id] = clampBoundaryCardPosition({ x: cursorX, y: cursorY });
      cursorX += item.width + BOUNDARY_GUTTER_X;
    }
    cursorY += row.rowHeight + BOUNDARY_GUTTER_Y;
  });

  return positions;
}

export function mergeIncrementalBoundaryLayout(
  zoneIds: BoundaryZoneId[],
  existingPositions: Partial<Record<BoundaryZoneId, BoundaryCardPosition>>,
  availableWidth: number,
  viewModeByZoneId: Partial<Record<BoundaryZoneId, BoundaryCardViewMode>>,
  measuredHeights?: Partial<Record<BoundaryZoneId, number>>
): Partial<Record<BoundaryZoneId, BoundaryCardPosition>> {
  const next: Partial<Record<BoundaryZoneId, BoundaryCardPosition>> = {};
  const missing: BoundaryZoneId[] = [];
  let maxBottom = 0;
  let keptCount = 0;

  for (const id of zoneIds) {
    const existing = existingPositions[id];
    if (existing && Number.isFinite(existing.x) && Number.isFinite(existing.y)) {
      const clamped = clampBoundaryCardPosition(existing);
      next[id] = clamped;
      const mode = viewModeByZoneId[id] ?? 'high-level';
      const h = estimateCardHeight(id, mode, measuredHeights);
      maxBottom = Math.max(maxBottom, clamped.y + h);
      keptCount += 1;
    } else {
      missing.push(id);
    }
  }

  if (missing.length === 0) return next;

  const added = computeAutoBoundaryLayout(
    missing,
    availableWidth,
    viewModeByZoneId,
    measuredHeights
  );
  const offsetY = keptCount === 0 ? 0 : maxBottom + BOUNDARY_GUTTER_Y - BOUNDARY_CANVAS_PAD;

  for (const id of missing) {
    const pos = added[id] ?? { x: BOUNDARY_CANVAS_PAD, y: BOUNDARY_CANVAS_PAD };
    next[id] = clampBoundaryCardPosition({
      x: pos.x,
      y: pos.y + offsetY,
    });
  }

  return next;
}

function pointInsideRect(
  px: number,
  py: number,
  r: BoundaryCardRect,
  pad: number
): boolean {
  return (
    px >= r.x - pad &&
    px <= r.x + r.width + pad &&
    py >= r.y - pad &&
    py <= r.y + r.height + pad
  );
}

function pillOverlapsRect(
  lx: number,
  ly: number,
  r: BoundaryCardRect,
  pad: number
): boolean {
  return (
    lx + PILL_HALF_WIDTH > r.x - pad &&
    lx - PILL_HALF_WIDTH < r.x + r.width + pad &&
    ly + PILL_HALF_HEIGHT > r.y - pad &&
    ly - PILL_HALF_HEIGHT < r.y + r.height + pad
  );
}

function pillsCollide(ax: number, ay: number, bx: number, by: number): boolean {
  return (
    Math.abs(ax - bx) < PILL_COLLISION_WIDTH &&
    Math.abs(ay - by) < PILL_COLLISION_HEIGHT
  );
}

function evalCubic(
  t: number,
  sx: number,
  sy: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  ex: number,
  ey: number
): { x: number; y: number } {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * sx + 3 * mt2 * t * c1x + 3 * mt * t2 * c2x + t2 * t * ex,
    y: mt2 * mt * sy + 3 * mt2 * t * c1y + 3 * mt * t2 * c2y + t2 * t * ey,
  };
}

function evalQuadratic(
  t: number,
  sx: number,
  sy: number,
  qx: number,
  qy: number,
  ex: number,
  ey: number
): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: mt * mt * sx + 2 * mt * t * qx + t * t * ex,
    y: mt * mt * sy + 2 * mt * t * qy + t * t * ey,
  };
}

/**
 * Computes obstacle-aware SVG curves, midpoint handles, parallel wire lane offsets,
 * and collision-free pill positions for boundary flow connections.
 */
export function computeBoundaryWireGeometries(
  connections: BoundaryConnection[],
  rectsByZoneId: Partial<Record<BoundaryZoneId, BoundaryCardRect>>,
  adjustmentsByConnectionId?: Record<string, BoundaryWireManualAdjustment>
): BoundaryWireGeometry[] {
  const allRects = Object.values(rectsByZoneId).filter(
    (r): r is BoundaryCardRect => Boolean(r && r.width > 0 && r.height > 0)
  );
  const rawResults: Array<BoundaryWireGeometry & { hasManualLabel: boolean }> = [];
  const placedPills: Array<{ x: number; y: number }> = [];
  let detourStaggerCount = 0;

  for (const conn of connections) {
    const sRect = rectsByZoneId[conn.sourceZoneId];
    const dRect = rectsByZoneId[conn.destinationZoneId];
    if (!sRect || !dRect || sRect.width <= 0 || dRect.width <= 0) {
      continue;
    }

    const sCenterX = sRect.x + sRect.width / 2;
    const sCenterY = sRect.y + sRect.height / 2;
    const dCenterX = dRect.x + dRect.width / 2;
    const dCenterY = dRect.y + dRect.height / 2;

    const dx = dCenterX - sCenterX;
    const dy = dCenterY - sCenterY;
    const dist = Math.hypot(dx, dy);
    if (!Number.isFinite(dist) || dist < 1) continue;

    const horizontalPrimary = Math.abs(dx) * 0.85 >= Math.abs(dy);
    let x1 = sCenterX;
    let y1 = sCenterY;
    let x2 = dCenterX;
    let y2 = dCenterY;
    let tx1 = 0;
    let ty1 = 0;
    let tx2 = 0;
    let ty2 = 0;

    if (horizontalPrimary) {
      if (dx >= 0) {
        x1 = sRect.x + sRect.width;
        x2 = dRect.x;
        tx1 = 1;
        tx2 = -1;
      } else {
        x1 = sRect.x;
        x2 = dRect.x + dRect.width;
        tx1 = -1;
        tx2 = 1;
      }
      y1 = sCenterY;
      y2 = dCenterY;
    } else {
      if (dy >= 0) {
        y1 = sRect.y + sRect.height;
        y2 = dRect.y;
        ty1 = 1;
        ty2 = -1;
      } else {
        y1 = sRect.y;
        y2 = dRect.y + dRect.height;
        ty1 = -1;
        ty2 = 1;
      }
      x1 = sCenterX;
      x2 = dCenterX;
    }

    const edgeDx = x2 - x1;
    const edgeDy = y2 - y1;
    const edgeDist = Math.max(1, Math.hypot(edgeDx, edgeDy));
    const nx = -edgeDy / edgeDist;
    const ny = edgeDx / edgeDist;

    // Symmetrical multi-lane fan so same-direction & opposite-direction sibling wires never overlap
    const laneSlot =
      conn.siblingCount > 1
        ? conn.siblingIndex - (conn.siblingCount - 1) / 2
        : 0;
    const laneOffset = laneSlot * 24;
    const archBoost = laneSlot * 26;

    const sx = x1 + nx * laneOffset;
    const sy = y1 + ny * laneOffset;
    const ex = x2 + nx * laneOffset;
    const ey = y2 + ny * laneOffset;

    const curveHandle = Math.max(46, Math.min(130, edgeDist * 0.42));
    const c1x = sx + tx1 * curveHandle + nx * archBoost;
    const c1y = sy + ty1 * curveHandle + ny * archBoost;
    const c2x = ex + tx2 * curveHandle + nx * archBoost;
    const c2y = ey + ty2 * curveHandle + ny * archBoost;

    const baseMid = evalCubic(0.5, sx, sy, c1x, c1y, c2x, c2y, ex, ey);
    if (!Number.isFinite(baseMid.x) || !Number.isFinite(baseMid.y)) continue;

    const adj = adjustmentsByConnectionId?.[conn.id];
    const wireDx = adj?.wireDx ?? 0;
    const wireDy = adj?.wireDy ?? 0;
    const labelDx = adj?.labelDx ?? 0;
    const labelDy = adj?.labelDy ?? 0;
    const hasManualWire = wireDx !== 0 || wireDy !== 0;
    const hasManualLabel = labelDx !== 0 || labelDy !== 0;

    let pathD = '';
    let anchorX = baseMid.x;
    let anchorY = baseMid.y;
    let sampleCurve: (t: number) => { x: number; y: number } = (t) =>
      evalCubic(t, sx, sy, c1x, c1y, c2x, c2y, ex, ey);

    if (hasManualWire) {
      anchorX = Math.max(24, baseMid.x + wireDx);
      anchorY = Math.max(24, baseMid.y + wireDy);
      const qx = 2 * anchorX - 0.5 * (sx + ex);
      const qy = 2 * anchorY - 0.5 * (sy + ey);
      pathD = `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`;
      sampleCurve = (t) => evalQuadratic(t, sx, sy, qx, qy, ex, ey);
    } else {
      const otherRects = Object.entries(rectsByZoneId)
        .filter(
          ([zId, r]) =>
            Boolean(r) &&
            zId !== conn.sourceZoneId &&
            zId !== conn.destinationZoneId &&
            (r as BoundaryCardRect).width > 0 &&
            (r as BoundaryCardRect).height > 0
        )
        .map(([, r]) => r as BoundaryCardRect);

      const blockers: BoundaryCardRect[] = [];
      for (const r of otherRects) {
        let hit = false;
        for (let step = 3; step <= 17; step += 1) {
          const pt = evalCubic(step / 20, sx, sy, c1x, c1y, c2x, c2y, ex, ey);
          if (pointInsideRect(pt.x, pt.y, r, 18)) {
            hit = true;
            break;
          }
        }
        if (hit) blockers.push(r);
      }

      if (blockers.length > 0) {
        const minX = Math.min(...blockers.map((r) => r.x));
        const minY = Math.min(...blockers.map((r) => r.y));
        const maxX = Math.max(...blockers.map((r) => r.x + r.width));
        const maxY = Math.max(...blockers.map((r) => r.y + r.height));
        const stagger =
          detourStaggerCount * 32 + Math.abs(Math.round(laneSlot * 24));
        detourStaggerCount += 1;

        let detourX = baseMid.x;
        let detourY = baseMid.y;

        if (horizontalPrimary) {
          const aboveY = Math.max(28, minY - 46 - stagger);
          const belowY = maxY + 46 + stagger;
          const midY = (sy + ey) / 2;
          const pickAbove =
            minY >= 96 && Math.abs(aboveY - midY) <= Math.abs(belowY - midY);
          detourX = Math.max(28, minX + (maxX - minX) / 2);
          detourY = pickAbove ? aboveY : belowY;
        } else {
          const leftX = Math.max(28, minX - 48 - stagger);
          const rightX = maxX + 48 + stagger;
          const midX = (sx + ex) / 2;
          const pickLeft =
            minX >= 110 && Math.abs(leftX - midX) <= Math.abs(rightX - midX);
          detourX = pickLeft ? leftX : rightX;
          detourY = Math.max(28, minY + (maxY - minY) / 2);
        }

        anchorX = detourX;
        anchorY = detourY;
        const qx = 2 * detourX - 0.5 * (sx + ex);
        const qy = 2 * detourY - 0.5 * (sy + ey);
        pathD = `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`;
        sampleCurve = (t) => evalQuadratic(t, sx, sy, qx, qy, ex, ey);
      } else {
        pathD = `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`;
      }
    }

    let labelX = anchorX;
    let labelY = anchorY;

    if (hasManualLabel) {
      labelX = Math.max(90, anchorX + labelDx);
      labelY = Math.max(20, anchorY + labelDy);
    } else {
      const candidates: Array<{ x: number; y: number }> = [
        { x: anchorX, y: anchorY },
      ];
      for (const t of [0.42, 0.58, 0.34, 0.66, 0.26, 0.74]) {
        candidates.push(sampleCurve(t));
      }
      candidates.push(
        { x: anchorX + nx * 36, y: anchorY + ny * 36 },
        { x: anchorX - nx * 36, y: anchorY - ny * 36 },
        { x: anchorX, y: Math.max(22, anchorY - 40) },
        { x: anchorX, y: anchorY + 40 }
      );

      let bestScore = Infinity;
      let bestPoint = candidates[0];
      for (const cand of candidates) {
        const cx = Math.max(90, cand.x);
        const cy = Math.max(20, cand.y);
        let score = Math.hypot(cx - anchorX, cy - anchorY) * 0.5;
        for (const r of allRects) {
          if (pillOverlapsRect(cx, cy, r, 12)) {
            score += 10000;
          }
        }
        for (const p of placedPills) {
          if (pillsCollide(cx, cy, p.x, p.y)) {
            score += 500;
          }
        }
        if (score < bestScore) {
          bestScore = score;
          bestPoint = { x: cx, y: cy };
        }
      }
      labelX = bestPoint.x;
      labelY = bestPoint.y;
    }

    placedPills.push({ x: labelX, y: labelY });

    rawResults.push({
      connection: conn,
      pathD,
      anchorX,
      anchorY,
      labelX,
      labelY,
      tetherNeeded: false,
      isManuallyAdjusted: hasManualWire || hasManualLabel,
      hasManualLabel,
    });
  }

  for (let pass = 0; pass < 6; pass += 1) {
    let moved = false;
    for (let i = 0; i < rawResults.length; i += 1) {
      for (let j = i + 1; j < rawResults.length; j += 1) {
        const a = rawResults[i];
        const b = rawResults[j];
        if (!pillsCollide(a.labelX, a.labelY, b.labelX, b.labelY)) {
          continue;
        }
        const deltaY = Math.abs(b.labelY - a.labelY);
        const overlapY = PILL_COLLISION_HEIGHT - deltaY;
        if (!a.hasManualLabel && !b.hasManualLabel) {
          const push = overlapY / 2 + 2;
          if (a.labelY <= b.labelY) {
            a.labelY = Math.max(20, a.labelY - push);
            b.labelY += push;
          } else {
            b.labelY = Math.max(20, b.labelY - push);
            a.labelY += push;
          }
          moved = true;
        } else if (!a.hasManualLabel) {
          a.labelY =
            a.labelY <= b.labelY
              ? Math.max(20, b.labelY - PILL_COLLISION_HEIGHT - 2)
              : b.labelY + PILL_COLLISION_HEIGHT + 2;
          moved = true;
        } else if (!b.hasManualLabel) {
          b.labelY =
            b.labelY <= a.labelY
              ? Math.max(20, a.labelY - PILL_COLLISION_HEIGHT - 2)
              : a.labelY + PILL_COLLISION_HEIGHT + 2;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  return rawResults.map(({ hasManualLabel: _ignored, ...geom }) => ({
    ...geom,
    tetherNeeded:
      Math.hypot(geom.labelX - geom.anchorX, geom.labelY - geom.anchorY) > 14,
  }));
}

export function computeBoundaryCanvasBounds(
  rectsByZoneId: Partial<Record<BoundaryZoneId, BoundaryCardRect>>,
  geometries: BoundaryWireGeometry[],
  minWidth: number,
  minHeight = 460
): { width: number; height: number } {
  let maxRight = Math.max(minWidth, 320);
  let maxBottom = Math.max(minHeight, 320);

  for (const rect of Object.values(rectsByZoneId)) {
    if (!rect) continue;
    maxRight = Math.max(maxRight, rect.x + rect.width + 96);
    maxBottom = Math.max(maxBottom, rect.y + rect.height + 96);
  }

  for (const geom of geometries) {
    maxRight = Math.max(maxRight, geom.anchorX + 96, geom.labelX + 148);
    maxBottom = Math.max(maxBottom, geom.anchorY + 64, geom.labelY + 48);
  }

  return {
    width: Math.ceil(maxRight),
    height: Math.ceil(maxBottom),
  };
}
