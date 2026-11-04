import React from 'react';
import { X, Network, Box, Shield, HardDrive, Terminal, ArrowRight, ExternalLink } from 'lucide-react';
import { TopologyRouteItem, IngressHop } from '../../lib/topology-synthesizer';

interface DockerNetworkInspectorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedRoute: TopologyRouteItem | null;
  activeHop: IngressHop | null;
  onRunTestHop?: (route: TopologyRouteItem) => void;
}

export const DockerNetworkInspectorDrawer: React.FC<DockerNetworkInspectorDrawerProps> = ({
  isOpen,
  onClose,
  selectedRoute,
  activeHop,
  onRunTestHop,
}) => {
  if (!isOpen || (!selectedRoute && !activeHop)) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-30 w-full max-w-xl bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col transition-all duration-300">
      {/* Drawer Header */}
      <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950/50">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            {activeHop ? <Network className="w-5 h-5" /> : <Box className="w-5 h-5" />}
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
              {activeHop ? activeHop.label : selectedRoute?.containerName}
            </h3>
            <p className="text-xs text-slate-500 font-mono">
              {activeHop ? `${activeHop.zoneName} · ${activeHop.badge || ''}` : `/${selectedRoute?.slug} (Port ${selectedRoute?.port})`}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Drawer Content */}
      <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
        {/* Route Overview Card (if selectedRoute) */}
        {selectedRoute && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50 dark:bg-slate-950/40 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700 dark:text-slate-300 text-sm">
                Container & Proxy Target
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  selectedRoute.isHealthy
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                }`}
              >
                {selectedRoute.containerStatus.toUpperCase()}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 font-mono text-slate-600 dark:text-slate-400">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase">Public Subpath</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">/{selectedRoute.slug}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase">Target Host Port</span>
                <span className="text-slate-900 dark:text-slate-100 font-semibold">127.0.0.1:{selectedRoute.port}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase">Bridge Subnet</span>
                <span>{selectedRoute.bridgeSubnet}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase">Container IP (eth0)</span>
                <span className="text-sky-600 dark:text-sky-400 font-semibold">{selectedRoute.containerIp}</span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <a
                href={selectedRoute.canonicalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400 font-medium hover:underline"
              >
                {selectedRoute.canonicalUrl}
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              {onRunTestHop && (
                <button
                  onClick={() => onRunTestHop(selectedRoute)}
                  className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center gap-1.5 shadow-sm transition-colors"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  Test Local Hop
                </button>
              )}
            </div>
          </div>
        )}

        {/* Active Hop Details Card (if activeHop clicked) */}
        {activeHop && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50 dark:bg-slate-950/40 space-y-3">
            <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-sm flex items-center gap-2">
              <ArrowRight className="w-4 h-4 text-emerald-500" />
              Boundary Transit Hop Details
            </h4>
            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b border-slate-200/50 dark:border-slate-800/50">
                <span className="text-slate-400">Boundary Zone:</span>
                <span className="font-mono text-slate-700 dark:text-slate-300 font-medium">{activeHop.zoneName}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/50 dark:border-slate-800/50">
                <span className="text-slate-400">Node Component:</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">{activeHop.label}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/50 dark:border-slate-800/50">
                <span className="text-slate-400">Operational Role:</span>
                <span className="text-slate-600 dark:text-slate-400">{activeHop.sublabel}</span>
              </div>
              {activeHop.badge && (
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Network Tag:</span>
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {activeHop.badge}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Security & Isolation Analysis */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-3">
          <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-sm flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-500" />
            Security & Boundary Protection
          </h4>
          <ul className="space-y-2 text-slate-600 dark:text-slate-400">
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              <span>
                <strong>Loopback Confined:</strong> Port binding is strictly configured as{' '}
                <code className="text-emerald-600 dark:text-emerald-400">127.0.0.1:{selectedRoute?.port || 'PORT'}</code>.
                Direct unauthenticated access from the physical LAN is completely blocked.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              <span>
                <strong>SSL Terminated at Lighttpd:</strong> Let's Encrypt / Cloudflare Origin CA certificate handles
                cryptographic verification prior to socket dispatch.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              <span>
                <strong>L2/L3 Bridge Isolation:</strong> Container runs in an isolated network namespace with its own
                virtual ethernet pair (`veth`) and private IP.
              </span>
            </li>
          </ul>
        </div>

        {/* Persistent Storage & Data Plane */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-3">
          <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-sm flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-emerald-500" />
            Storage & SQLite WAL Mount
          </h4>
          <div className="font-mono text-xs bg-[#050b14] text-emerald-400 p-3 rounded-lg border border-slate-800 space-y-1">
            <div># Host Bind Mount:</div>
            <div className="text-slate-300">
              {selectedRoute?.app?.manifest.dataVolume || `/var/data/${selectedRoute?.containerName}/data`}
            </div>
            <div className="text-slate-500 pt-1"># Container Target:</div>
            <div className="text-slate-300">/app/data</div>
            <div className="text-slate-500 pt-1"># Database & Mode:</div>
            <div className="text-emerald-300">
              {selectedRoute?.slug}.sqlite (PRAGMA journal_mode=WAL)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
