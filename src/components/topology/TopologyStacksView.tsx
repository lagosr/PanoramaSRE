import { useState, useMemo } from 'react';
import {
  Network,
  Server,
  Layers,
  Sliders,
  Cloud,
  Zap,
} from 'lucide-react';
import { WshSnapshot, DiscoveredApp, TerminalTab, CloudflareTunnelVersionStatus } from '../../lib/types';
import {
  synthesizeTopology,
  TopologyRouteItem,
  IngressHop,
} from '../../lib/topology-synthesizer';
import { buildRemoteSshCommand } from '../../lib/script-adapters';
import { NetworkBoundaryCanvas } from './NetworkBoundaryCanvas';
import { LighttpdRoutingMatrix } from './LighttpdRoutingMatrix';
import { DietPiHardwareNetworkCard } from './DietPiHardwareNetworkCard';
import { CloudflareTunnelTopologyCard } from './CloudflareTunnelTopologyCard';
import { DockerNetworkRulesAdvisor } from './DockerNetworkRulesAdvisor';
import { DockerNetworkInspectorDrawer } from './DockerNetworkInspectorDrawer';
import { WorkStreamContainer } from '../ui/WorkStreamContainer';

interface TopologyStacksViewProps {
  snapshot: WshSnapshot | null;
  apps?: DiscoveredApp[];
  terminalTabs?: TerminalTab[];
  tunnelVersionStatus?: CloudflareTunnelVersionStatus | null;
  isCheckingTunnelVersion?: boolean;
  isLoading?: boolean;
  onRefresh?: () => void;
  onRunAuditCommand?: (label: string, cmd: string, args: string[]) => void;
  onTriggerTunnelAction?: (action: 'status' | 'check_update' | 'update' | 'update_force') => void;
  onRunPenetrationAudit?: () => void;
  onReapplyHardening?: () => void;
  onOpenInBottomConsole?: (tabId?: string) => void;
  onAbortJob?: (id: string) => void;
  onClearTab?: (id: string) => void;
}

export function TopologyStacksView({
  snapshot,
  apps = [],
  terminalTabs = [],
  tunnelVersionStatus = null,
  isCheckingTunnelVersion = false,
  isLoading = false,
  onRefresh,
  onRunAuditCommand,
  onTriggerTunnelAction,
  onRunPenetrationAudit,
  onReapplyHardening,
  onOpenInBottomConsole,
  onAbortJob,
  onClearTab,
}: TopologyStacksViewProps) {
  const [activeTab, setActiveTab] = useState<'visual' | 'matrix' | 'hardware' | 'tunnel' | 'rules'>('visual');
  const [selectedRouteSlug, setSelectedRouteSlug] = useState<string | null>(null);

  // Inspector Drawer State
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [drawerRoute, setDrawerRoute] = useState<TopologyRouteItem | null>(null);
  const [drawerHop, setDrawerHop] = useState<IngressHop | null>(null);

  // Synthesize deterministic topology model
  const topology = useMemo(
    () => synthesizeTopology(apps, snapshot, tunnelVersionStatus),
    [apps, snapshot, tunnelVersionStatus]
  );

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
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Banner & Cockpit Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <Network className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              Network Topology, Lighttpd Proxy & Container Stacks
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1 font-mono">
            Interactive multi-zone ingress mapping, DietPi hardware networking, and Docker boundary rules
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-xs font-mono">
          <button
            onClick={() => setActiveTab('visual')}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'visual'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-emerald-500" />
            Visual Boundary Map
          </button>

          <button
            onClick={() => setActiveTab('matrix')}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'matrix'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Server className="w-3.5 h-3.5 text-sky-500" />
            Proxy Routing Table
          </button>

          <button
            onClick={() => setActiveTab('hardware')}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'hardware'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-purple-500" />
            DietPi Hardware
          </button>

          <button
            onClick={() => setActiveTab('tunnel')}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'tunnel'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Cloud className="w-3.5 h-3.5 text-indigo-500" />
            Cloudflare Tunnel
            {topology.cloudflared.updateAvailable && (
              <span
                className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"
                title="Cloudflare Tunnel update available"
              />
            )}
          </button>

          <button
            onClick={() => setActiveTab('rules')}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'rules'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5 text-amber-500" />
            Security & Rules Advisor
            {topology.securityAudit.securityViolationCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            )}
          </button>
        </div>
      </div>

      {/* Main View Area */}
      {activeTab === 'visual' && (
        <NetworkBoundaryCanvas
          topology={topology}
          selectedRouteSlug={selectedRouteSlug}
          onSelectRouteSlug={setSelectedRouteSlug}
          onOpenInspector={handleOpenInspector}
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

      {activeTab === 'hardware' && (
        <DietPiHardwareNetworkCard topology={topology} onRefresh={onRefresh} />
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

      {activeTab === 'rules' && (
        <DockerNetworkRulesAdvisor
          topology={topology}
          onRunAuditCommand={onRunAuditCommand}
          onRunPenetrationAudit={onRunPenetrationAudit}
          onReapplyHardening={onReapplyHardening}
        />
      )}

      {/* Position 3: Standardized Network Topology, Tunnel & Security Stream Container */}
      <WorkStreamContainer
        pageScope="topology"
        tabs={terminalTabs}
        title="Network Topology, Tunnel & Firewall Execution Stream"
        description="Streams Test Hop diagnostics, Cloudflare Tunnel updates/checks, penetration audits, hardening runs, and manual host refreshes."
        emptyHint="Run Test Hop, Cloudflare Tunnel actions, Penetration Audit, Re-Apply Hardening, or Refresh Snapshot above to stream output here."
        onOpenInBottomConsole={onOpenInBottomConsole}
        onAbortJob={onAbortJob}
        onClearTab={onClearTab}
      />

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
