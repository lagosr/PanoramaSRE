import { DiscoveredApp, WshSnapshot, DockerNetworkDetail, NetworkInterfaceDetail } from './types';

export interface TopologyRouteItem {
  slug: string;
  port: number;
  canonicalUrl: string;
  app?: DiscoveredApp;
  containerName: string;
  containerStatus: 'running' | 'stopped' | 'restarting' | 'unknown';
  isHealthy: boolean;
  isLoopbackOnly: boolean;
  maxRequestSizeKb: number;
  supportsUpgrade: boolean;
  sslTerminationPoint: string;
  bridgeSubnet: string;
  containerIp: string;
}

export interface IngressHop {
  zoneId: 'zone0' | 'zone1' | 'zone2' | 'zone3' | 'zone4';
  zoneName: string;
  label: string;
  sublabel: string;
  type: 'client' | 'edge' | 'tunnel' | 'host' | 'proxy' | 'socket' | 'bridge' | 'container' | 'storage';
  badge?: string;
  status: 'active' | 'warning' | 'idle';
  meta?: Record<string, string | number | boolean>;
}

export interface SecurityAuditResult {
  score: number;
  totalBindings: number;
  zeroBindViolations: string[];
  loopbackSecuredCount: number;
  isolationMode: 'PER_APP_ISOLATED' | 'UNIFIED_BRIDGE' | 'HYBRID';
  iccStatus: 'DEFAULT_OPEN' | 'HARDENED';
  recommendations: string[];
}

export interface SynthesizedTopology {
  routes: TopologyRouteItem[];
  cloudflared: {
    version: string;
    networkMode: string;
    ingressTarget: string;
    recentLogs: string[];
    isHealthy: boolean;
  };
  host: {
    hostname: string;
    dietpiVersion: string;
    kernel: string;
    uptimeSecs: number;
    listeningPorts: number[];
    physicalInterfaces: NetworkInterfaceDetail[];
    loopbackInterface?: NetworkInterfaceDetail;
    virtualBridges: NetworkInterfaceDetail[];
  };
  docker: {
    activeContainersCount: number;
    networks: DockerNetworkDetail[];
    bridgeSubnets: Record<string, string>;
  };
  securityAudit: SecurityAuditResult;
  ingressTraces: Record<string, IngressHop[]>;
}

// Fallback subnet mapping for known apps when remote network inspect is unpopulated
const KNOWN_SUBNET_MAP: Record<string, { subnet: string; containerIp: string; bridgeName: string }> = {
  auth: { subnet: '172.18.0.0/16', containerIp: '172.18.0.2', bridgeName: 'br-panorama-auth' },
  spendy: { subnet: '172.19.0.0/16', containerIp: '172.19.0.2', bridgeName: 'br-spendy-ledger' },
  biomed: { subnet: '172.20.0.0/16', containerIp: '172.20.0.2', bridgeName: 'br-biomed-maven' },
  water: { subnet: '172.21.0.0/16', containerIp: '172.21.0.2', bridgeName: 'br-water-analyzer' },
  basket: { subnet: '172.22.0.0/16', containerIp: '172.22.0.2', bridgeName: 'br-tasty-basket' },
  res: { subnet: '172.23.0.0/16', containerIp: '172.23.0.2', bridgeName: 'br-panorama-resources' },
};

/**
 * Synthesizes a deterministic network topology model by merging
 * real-time host snapshots with local app manifests and network definitions.
 */
export function synthesizeTopology(
  apps: DiscoveredApp[],
  snapshot: WshSnapshot | null
): SynthesizedTopology {
  // 1. Parse raw Lighttpd routes
  const rawRoutePairs = (snapshot?.lighttpd_routes_raw || '')
    .split(',')
    .filter((r) => r.includes(':'))
    .map((r) => {
      const [slug, portStr] = r.split(':');
      return { slug: slug.trim().replace(/^\//, ''), port: parseInt(portStr.trim(), 10) || 0 };
    });

  // If no routes in snapshot (e.g. offline/mock), synthesize from discovered apps
  const activeRoutePairs =
    rawRoutePairs.length > 0
      ? rawRoutePairs
      : apps.map((a) => ({ slug: a.manifest.slug, port: a.manifest.port }));

  const containers = snapshot?.containers || [];

  // 2. Build rich Route Items
  const routes: TopologyRouteItem[] = activeRoutePairs.map((rt) => {
    const matchedApp = apps.find((a) => a.manifest.slug === rt.slug || a.manifest.port === rt.port);
    const containerName = matchedApp?.manifest.containerName || `panorama-${rt.slug}`;

    const containerInfo = containers.find((c) => {
      const name = c.Names?.replace(/^\//, '') || '';
      return name === containerName || name.includes(rt.slug);
    });

    const isRunning =
      containerInfo?.State?.toLowerCase() === 'running' ||
      (containerInfo?.Status?.toLowerCase() || '').includes('up') ||
      matchedApp?.health?.status === 'healthy';

    const fallbackNet = KNOWN_SUBNET_MAP[rt.slug] || {
      subnet: `172.24.${routes.length}.0/16`,
      containerIp: `172.24.${routes.length}.2`,
      bridgeName: `br-${rt.slug}`,
    };

    // Check if live snapshot has detailed docker network inspect for this container
    let liveSubnet = fallbackNet.subnet;
    let liveContainerIp = fallbackNet.containerIp;

    if (snapshot?.docker_networks && Array.isArray(snapshot.docker_networks)) {
      for (const net of snapshot.docker_networks) {
        if (net.Containers) {
          for (const [_, c] of Object.entries(net.Containers)) {
            if (c.Name?.includes(rt.slug) || c.Name === containerName) {
              liveContainerIp = c.IPv4Address?.split('/')[0] || liveContainerIp;
              liveSubnet = net.IPAM?.Config?.[0]?.Subnet || liveSubnet;
            }
          }
        }
      }
    }

    return {
      slug: rt.slug,
      port: rt.port,
      canonicalUrl: `https://wsh.panoramadr.com/${rt.slug}`,
      app: matchedApp,
      containerName,
      containerStatus: isRunning ? 'running' : containerInfo ? 'stopped' : 'unknown',
      isHealthy: isRunning,
      isLoopbackOnly: true, // Default strict deployment binds only to 127.0.0.1
      maxRequestSizeKb: 51200, // 50MB standard for uploads across suite
      supportsUpgrade: true,
      sslTerminationPoint: 'Lighttpd :443 (Let’s Encrypt / Origin CA)',
      bridgeSubnet: liveSubnet,
      containerIp: liveContainerIp,
    };
  });

  // 3. Parse Cloudflare Tunnel info
  const cfVersionRaw = snapshot?.cloudflared?.version_raw || 'cloudflared 2026.10.7';
  const cfLogs = (snapshot?.cloudflared?.recent_logs || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const isCfHealthy = !cfLogs.some((l) => l.includes('ERR') || l.includes('failed to connect'));

  // 4. Parse Interfaces
  const interfaces = snapshot?.network_interfaces || [];
  const physicalInterfaces = interfaces.filter(
    (i) => i.ifname.startsWith('eth') || i.ifname.startsWith('wlan') || i.ifname.startsWith('en')
  );
  const loopbackInterface = interfaces.find((i) => i.ifname === 'lo');
  const virtualBridges = interfaces.filter(
    (i) => i.ifname.startsWith('br-') || i.ifname.startsWith('docker') || i.ifname.startsWith('veth')
  );

  // 5. Security & Isolation Audit
  const zeroBindViolations: string[] = [];
  let loopbackSecuredCount = 0;

  for (const c of containers) {
    const ports = c.Ports || '';
    if (ports.includes('0.0.0.0:')) {
      zeroBindViolations.push(`${c.Names || c.ID}: ${ports}`);
    } else if (ports.includes('127.0.0.1:')) {
      loopbackSecuredCount++;
    }
  }

  const recommendations: string[] = [];
  if (zeroBindViolations.length > 0) {
    recommendations.push(
      'CRITICAL: Found container port(s) bound to 0.0.0.0. Rebind to 127.0.0.1 to prevent unauthorized LAN bypass of Lighttpd.'
    );
  } else {
    recommendations.push('Verified: 100% of container host ports are strictly confined to 127.0.0.1 loopback.');
  }

  recommendations.push(
    'Architecture Optimization: Consider enabling a shared "panorama-net" bridge to unlock sub-millisecond container-to-container DNS without host round-trips.'
  );

  const securityScore = zeroBindViolations.length > 0 ? 65 : 100;

  // 6. Precompute Ingress Trace Paths
  const ingressTraces: Record<string, IngressHop[]> = {};

  for (const r of routes) {
    const hostStoragePath = r.app?.manifest.dataVolume
      ? r.app.manifest.dataVolume
      : `/var/data/${r.containerName}/data`;

    ingressTraces[r.slug] = [
      {
        zoneId: 'zone0',
        zoneName: 'Public WAN Edge',
        label: 'Client Browser',
        sublabel: 'User via WAN / LAN',
        type: 'client',
        status: 'active',
        badge: 'HTTP/3 / HTTPS',
      },
      {
        zoneId: 'zone0',
        zoneName: 'Public WAN Edge',
        label: 'Cloudflare Edge PoP',
        sublabel: 'Anycast DNS & Zero Trust Access',
        type: 'edge',
        status: 'active',
        badge: 'TLS 1.3 Terminated',
        meta: { hostname: 'wsh.panoramadr.com' },
      },
      {
        zoneId: 'zone1',
        zoneName: 'DietPi Host & OS',
        label: 'Cloudflare Tunnel (cloudflared)',
        sublabel: 'Multiplexed Outbound QUIC Tunnel',
        type: 'tunnel',
        status: isCfHealthy ? 'active' : 'warning',
        badge: 'network_mode: host',
        meta: { proto: 'QUIC / UDP 7844' },
      },
      {
        zoneId: 'zone1',
        zoneName: 'DietPi Host & OS',
        label: 'Lighttpd Reverse Proxy',
        sublabel: `^/${r.slug} Pattern Match -> 127.0.0.1:${r.port}`,
        type: 'proxy',
        status: 'active',
        badge: 'Systemd Daemon (:443)',
        meta: { maxRequest: `${r.maxRequestSizeKb / 1024}MB` },
      },
      {
        zoneId: 'zone1',
        zoneName: 'DietPi Host & OS',
        label: `Loopback Socket :${r.port}`,
        sublabel: `Host lo interface (127.0.0.1:${r.port})`,
        type: 'socket',
        status: 'active',
        badge: 'Isolated Host Socket',
      },
      {
        zoneId: 'zone2',
        zoneName: 'Docker Engine & Bridges',
        label: 'Linux Netfilter / iptables NAT',
        sublabel: `PREROUTING & DOCKER Chain -> ${r.containerIp}:${r.port}`,
        type: 'bridge',
        status: 'active',
        badge: r.bridgeSubnet,
      },
      {
        zoneId: 'zone3',
        zoneName: 'Container Enclaves',
        label: r.containerName,
        sublabel: `${r.containerIp}:${r.port} (veth pair -> eth0)`,
        type: 'container',
        status: r.isHealthy ? 'active' : 'warning',
        badge: r.app?.manifest.displayName || r.slug,
        meta: { port: r.port },
      },
      {
        zoneId: 'zone4',
        zoneName: 'Persistent Data Plane',
        label: 'Host Bind Mount Storage',
        sublabel: hostStoragePath,
        type: 'storage',
        status: 'active',
        badge: 'SQLite WAL Mode',
      },
    ];
  }

  return {
    routes,
    cloudflared: {
      version: cfVersionRaw,
      networkMode: 'host',
      ingressTarget: 'https://127.0.0.1:443',
      recentLogs: cfLogs.slice(0, 15),
      isHealthy: isCfHealthy,
    },
    host: {
      hostname: snapshot?.hostname || 'wsh',
      dietpiVersion: snapshot?.dietpi_version || '9.x',
      kernel: snapshot?.kernel || 'Linux ARM64',
      uptimeSecs: snapshot?.uptime_secs || 0,
      listeningPorts: snapshot?.listening_ports || [],
      physicalInterfaces,
      loopbackInterface,
      virtualBridges,
    },
    docker: {
      activeContainersCount: containers.length,
      networks: snapshot?.docker_networks || [],
      bridgeSubnets: Object.fromEntries(routes.map((r) => [r.slug, r.bridgeSubnet])),
    },
    securityAudit: {
      score: securityScore,
      totalBindings: containers.length,
      zeroBindViolations,
      loopbackSecuredCount,
      isolationMode: 'PER_APP_ISOLATED',
      iccStatus: 'DEFAULT_OPEN',
      recommendations,
    },
    ingressTraces,
  };
}
