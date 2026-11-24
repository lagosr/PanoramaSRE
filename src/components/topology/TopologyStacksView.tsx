import { useState, useMemo, useEffect } from 'react';
import {
  Network,
  Server,
  Cloud,
  Zap,
  Shield,
  Waypoints,
} from 'lucide-react';
import { WshSnapshot, DiscoveredApp, TerminalTab, CloudflareTunnelVersionStatus } from '../../lib/types';
import {
  synthesizeTopology,
  computeTopologyBadges,
  TopologyRouteItem,
  IngressHop,
  TopologyTabBadge,
} from '../../lib/topology-synthesizer';
import { buildRemoteSshCommand } from '../../lib/script-adapters';
import { NetworkBoundaryCanvas } from './NetworkBoundaryCanvas';
import { LighttpdRoutingMatrix } from './LighttpdRoutingMatrix';
import { CloudflareTunnelTopologyCard } from './CloudflareTunnelTopologyCard';
import { DockerNetworkInspectorDrawer } from './DockerNetworkInspectorDrawer';

export type TopologyIngressTab = 'visual' | 'matrix' | 'tunnel';

interface TopologyStacksViewProps {
  snapshot: WshSnapshot | null;
  apps?: DiscoveredApp[];
  terminalTabs?: TerminalTab[];
  tunnelVersionStatus?: CloudflareTunnelVersionStatus | null;
  isCheckingTunnelVersion?: boolean;
  isLoading?: boolean;
  initialTab?: TopologyIngressTab;
  initialTabNonce?: number;
  onRefresh?: () => void;
  onRunAuditCommand?: (label: string, cmd: string, args: string[]) => void;
  onTriggerTunnelAction?: (action: 'status' | 'check_update' | 'update' | 'update_force') => void;
  onNavigateToUnifi?: () => void;
  onNavigateToHardening?: () => void;
  onNavigateToDietPiInterfaces?: () => void;
  onOpenInBottomConsole?: (tabId?: string) => void;
  onAbortJob?: (id: string) => void;
  onClearTab?: (id: string) => void;
}

export function TopologyStacksView({
  snapshot,
  apps = [],
  tunnelVersionStatus = null,
  isCheckingTunnelVersion = false,
  isLoading = false,
  initialTab,
  initialTabNonce = 0,
  onRunAuditCommand,
  onTriggerTunnelAction,
  onNavigateToUnifi,
  onNavigateToHardening,
  onNavigateToDietPiInterfaces,
}: TopologyStacksViewProps) {
  const [activeTab, setActiveTab] = useState<TopologyIngressTab>(initialTab ?? 'visual');
  const [selectedRouteSlug, setSelectedRouteSlug] = useState<string | null>(null);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab, initialTabNonce]);

  // Inspector Drawer State
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [drawerRoute, setDrawerRoute] = useState<TopologyRouteItem | null>(null);
  const [drawerHop, setDrawerHop] = useState<IngressHop | null>(null);

  // Synthesize deterministic topology model
  const topology = useMemo(
    () => synthesizeTopology(apps, snapshot, tunnelVersionStatus),
    [apps, snapshot, tunnelVersionStatus]
  );

  const badgeSummary = useMemo(
    () => computeTopologyBadges(topology, snapshot !== null),
    [topology, snapshot]
  );

  const renderTabBadge = (badge: TopologyTabBadge) => {
    if (badge.count <= 0) return null;
    return (
      <span
        className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold whitespace-nowrap flex-shrink-0 ${
          badge.severity === 'error'
            ? 'bg-rose-500 text-white animate-pulse'
            : 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40'
        }`}
      >
        {badge.count}
      </span>
    );
  };

  const handleOpenInspector = (route: TopologyRouteItem | null, hop: IngressHop | null) => {
    setDrawerRoute(route);
    setDrawerHop(hop);
    setIsInspectorOpen(true);
  };

  const handleRunTestHop = (route: TopologyRouteItem) => {
    if (onRunAuditCommand) {
      const endpoint = `${route.app?.manifest.basePath || `/${route.slug}`}/api/health`;
      const bashCmd = `curl -i -s -w "\\n[METRICS] HTTP: %{http_code} | Latency: %{time_total}s | DNS: %{time_namelookup}s | Connect: %{time_connect}s\\n" http://127.0.0.1:${route.port}${endpoint}`;
      const sshSpec = buildRemoteSshCommand(bashCmd);
      onRunAuditCommand(
        `Test Hop: /${route.slug}`,
        sshSpec.command,
        sshSpec.args
      );
    }
  };

  return (
    <div className="p-6 w-full min-w-0 max-w-[1920px] mx-auto space-y-6">
      {/* Top Banner & Cockpit Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)] border border-[var(--color-brand-ring)] shrink-0">
              <Network className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 tracking-tight">
              Topology &amp; Ingress
            </h1>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 font-mono">
            Interactive multi-zone ingress mapping, Lighttpd reverse proxy routes, and Cloudflare QUIC tunnel
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Contextual Cross-Links */}
          <div className="flex flex-wrap items-center gap-2">
            {onNavigateToUnifi && (
              <button
                type="button"
                onClick={onNavigateToUnifi}
                className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <Waypoints className="w-3.5 h-3.5" />
                <span>UniFi VLANs &amp; ZBF →</span>
              </button>
            )}
            {onNavigateToHardening && (
              <button
                type="button"
                onClick={onNavigateToHardening}
                className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>WSH Hardening →</span>
              </button>
            )}
            {onNavigateToDietPiInterfaces && (
              <button
                type="button"
                onClick={onNavigateToDietPiInterfaces}
                className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <Server className="w-3.5 h-3.5" />
                <span>Host Interfaces →</span>
              </button>
            )}
          </div>

          {/* Focused 3-Tab Switcher */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono">
            <button
              type="button"
              onClick={() => setActiveTab('visual')}
              className={`px-3 py-1.5 min-h-[36px] rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 cursor-pointer ${
                activeTab === 'visual'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-[var(--color-brand-text)]" />
              Visual Boundary Map
              {renderTabBadge(badgeSummary.tabs.visual)}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('matrix')}
              className={`px-3 py-1.5 min-h-[36px] rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 cursor-pointer ${
                activeTab === 'matrix'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Server className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              Lighttpd Proxy Matrix
              {renderTabBadge(badgeSummary.tabs.matrix)}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('tunnel')}
              className={`px-3 py-1.5 min-h-[36px] rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 cursor-pointer ${
                activeTab === 'tunnel'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Cloud className="w-3.5 h-3.5 text-[var(--color-accent-text)]" />
              Cloudflare Tunnel
              {renderTabBadge(badgeSummary.tabs.tunnel)}
            </button>
          </div>
        </div>
      </div>

      {/* Main View Area */}
      {activeTab === 'visual' && (
        <NetworkBoundaryCanvas
          topology={topology}
          selectedRouteSlug={selectedRouteSlug}
          onSelectRouteSlug={setSelectedRouteSlug}
          onOpenInspector={handleOpenInspector}
          apps={apps}
          snapshot={snapshot}
          onRunTestHop={handleRunTestHop}
        />
      )}

      {activeTab === 'matrix' && (
        <LighttpdRoutingMatrix
          routes={topology.routes}
          isLoading={isLoading}
          selectedRouteSlug={selectedRouteSlug}
          onSelectRouteSlug={(slug) => {
            setSelectedRouteSlug(slug);
            const found = topology.routes.find((r) => r.slug === slug);
            if (found) handleOpenInspector(found, null);
          }}
          onRunTestHop={handleRunTestHop}
        />
      )}

      {activeTab === 'tunnel' && (
        <CloudflareTunnelTopologyCard
          topology={topology}
          snapshot={snapshot}
          tunnelVersion={tunnelVersionStatus}
          isCheckingVersion={isCheckingTunnelVersion}
          onTriggerTunnelAction={onTriggerTunnelAction}
        />
      )}

      {/* Inspector Slide-Out Drawer */}
      <DockerNetworkInspectorDrawer
        isOpen={isInspectorOpen}
        onClose={() => setIsInspectorOpen(false)}
        selectedRoute={drawerRoute}
        activeHop={drawerHop}
        onRunTestHop={handleRunTestHop}
      />
    </div>
  );
}
