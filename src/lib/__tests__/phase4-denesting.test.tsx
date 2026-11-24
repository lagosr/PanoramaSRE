import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { synthesizeTopology, computeTopologyBadges } from '../topology-synthesizer';
import type { DiscoveredApp, LanClientBaselineRow, WshSnapshot } from '../types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}));

import { TopologyStacksView } from '../../components/topology/TopologyStacksView';
import { DietPiHostView } from '../../components/dietpi/DietPiHostView';
import { UnifiVlanZbfPanel } from '../../components/security/UnifiVlanZbfPanel';
import { ThreatIntelView } from '../../components/security/ThreatIntelView';

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
    health: { status: 'healthy' },
  },
];

const brokenHardeningSnapshot: WshSnapshot = {
  mode: '--fast',
  hostname: 'wsh-test',
  kernel: '6.6.20+rpt-rpi-v8',
  uptime_secs: 42000,
  dietpi_version: '9.3.0',
  dietpi_update_available: '',
  reboot_required: false,
  rpi_throttled: '0x0',
  services: { lighttpd: 'active', docker: 'active', ssh: 'active', cron: 'active' },
  listening_ports: [80, 443, 3000],
  lighttpd_routes_raw: 'auth:3000',
  containers: [
    { Names: 'panorama-auth', State: 'running', Ports: '0.0.0.0:3000->3000/tcp' },
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
    '-N DOCKER-USER\n-A DOCKER-USER -d 10.0.0.0/8 -o eth0 -j DROP\n-N PANORAMA-INPUT\n',
  network_interfaces: [
    { ifname: 'eth0', flags: ['BROADCAST', 'MULTICAST'], mtu: 1500, operstate: 'UP' },
  ],
};

describe('Phase 4: Security & Network De-Nesting', () => {
  it('TopologyStacksView focuses on 3 ingress tabs with cross-links and excludes DietPi Hardware & Rules Advisor', () => {
    const html = renderToStaticMarkup(
      <TopologyStacksView
        snapshot={null}
        apps={mockApps}
        onNavigateToUnifi={vi.fn()}
        onNavigateToHardening={vi.fn()}
        onNavigateToDietPiInterfaces={vi.fn()}
      />
    );

    expect(html).toContain('Topology &amp; Ingress');
    expect(html).toContain('Visual Boundary Map');
    expect(html).toContain('Lighttpd Proxy Matrix');
    expect(html).toContain('Cloudflare Tunnel');
    expect(html).toContain('UniFi VLANs &amp; ZBF →');
    expect(html).toContain('WSH Hardening →');
    expect(html).toContain('Host Interfaces →');
    expect(html).not.toContain('DietPi Hardware');
    expect(html).not.toContain('Security &amp; Rules Advisor');
  });

  it('DietPiHostView renders 3 tabs and mounts DietPiHardwareNetworkCard with Gatekeeper & Suricata seams on interfaces tab', () => {
    const html = renderToStaticMarkup(
      <DietPiHostView
        snapshot={null}
        apps={mockApps}
        subTab="interfaces"
        isLoading={false}
        onRefresh={vi.fn()}
        onTriggerAction={vi.fn()}
        onTriggerReboot={vi.fn()}
        onNavigateToTopology={vi.fn()}
        onNavigateToHardening={vi.fn()}
      />
    );

    expect(html).toContain('Host &amp; APT Packages');
    expect(html).toContain('Host Interfaces &amp; Sockets');
    expect(html).toContain('Scheduled Crons &amp; Heartbeats');
    expect(html).toContain('DietPi Bare-Metal Host &amp; Hardware Network Stack');
    expect(html).toContain('sre-agent-wsh Forced-Command Gatekeeper');
    expect(html).toContain('Suricata SSH SYN Budget');
    expect(html).toContain('Open WSH Hardening →');
  });

  it('UnifiVlanZbfPanel exposes flat 5th LAN Device Baseline tab with owner-verified MAC table', () => {
    const lanClients: LanClientBaselineRow[] = [
      {
        macAddress: 'AA:BB:CC:DD:EE:FF',
        label: 'Workstation',
        hostname: 'workstation-1',
        ipAddress: '172.25.25.10',
        networkVlan: 'Compute (VLAN 500)',
        ouiVendor: 'Apple',
        firstSeenAt: '2026-11-24T12:00:00Z',
        lastSeenAt: '2026-11-24T14:50:00Z',
        isTrusted: true,
      },
    ];

    const html = renderToStaticMarkup(
      <UnifiVlanZbfPanel
        topology={null}
        isLoading={false}
        error={null}
        selectedVlanFilter="ALL"
        onSelectVlanFilter={vi.fn()}
        onRefresh={vi.fn()}
        onOpenUnifiFirewall={vi.fn()}
        lanClients={lanClients}
        onToggleLanTrust={vi.fn()}
        initialTab="baseline"
        onTrustAllBaseline={vi.fn()}
      />
    );

    expect(html).toContain('Zone Flow Explorer');
    expect(html).toContain('ZBF Matrix');
    expect(html).toContain('VLAN Directory');
    expect(html).toContain('Custom Rules');
    expect(html).toContain('LAN Device Baseline');
    expect(html).toContain('UniFi LAN Device Baseline (1 / 1 Trusted)');
    expect(html).toContain('AA:BB:CC:DD:EE:FF');
    expect(html).toContain('Trust All Initial Baseline');
  });

  it('ThreatIntelView renders persistent 4-card Context Ribbon & Related Surfaces without embedded UniFi or LAN Baseline panels', () => {
    const html = renderToStaticMarkup(
      <ThreatIntelView
        latestDetail={null}
        runs={[]}
        settings={null}
        isRunningAudit={false}
        onRunAuditNow={vi.fn()}
        onEscalateRunToCarbon={vi.fn()}
        onSelectRunId={vi.fn()}
        onRefreshAll={vi.fn()}
        onNavigateToSettings={vi.fn()}
        onNavigateToHardening={vi.fn()}
        onNavigateToUnifiZbf={vi.fn()}
        hardeningPassingCount={9}
        hardeningTotalCount={9}
        securityViolationCount={0}
      />
    );

    expect(html).toContain('360° Threat &amp; Zero Trust SOC');
    expect(html).toContain('Cloudflare Edge');
    expect(html).toContain('Zero Trust &amp; Tunnel');
    expect(html).toContain('Internal UniFi &amp; WSH');
    expect(html).toContain('9/9 PASS');
    expect(html).toContain('Triage &amp; AI Brief');
    expect(html).toContain('External Perimeter (CF)');
    expect(html).toContain('Internal Events (UniFi &amp; WSH)');
    expect(html).toContain('Related Security &amp; Network Surfaces');
    expect(html).not.toContain('UniFi VLANs &amp; Zone-Based Firewall Segmentation');
    expect(html).not.toContain('What does trusting a device mean?');
  });

  it('computeTopologyBadges isolates ingress alerts from WSH Hardening invariant violations', () => {
    const topo = synthesizeTopology(mockApps, brokenHardeningSnapshot, null);
    const badges = computeTopologyBadges(topo, true);

    expect(badges.tabs.rules.count).toBeGreaterThan(0);
    expect(badges.totalCount).toBeGreaterThan(0);
    expect(badges.ingressErrorCount).toBe(0);
    expect(badges.ingressTotalCount).toBe(0);
    expect(badges.ingressSeverity).toBeNull();
  });
});
