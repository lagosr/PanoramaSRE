import React, { useEffect } from 'react';
import { X, Network, Box, Shield, HardDrive, Terminal, ArrowRight, ExternalLink } from 'lucide-react';
import { TopologyRouteItem, IngressHop } from '../../lib/topology-synthesizer';
import { CopyableValue } from '../ui/CopyableValue';

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
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || (!selectedRoute && !activeHop)) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex justify-end bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col transition-all duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)] border border-[var(--color-brand-ring)]">
              {activeHop ? <Network className="w-5 h-5" /> : <Box className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                {activeHop ? activeHop.label : selectedRoute?.containerName}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                {activeHop ? `${activeHop.zoneName} · ${activeHop.badge || ''}` : `/${selectedRoute?.slug} (Port ${selectedRoute?.port})`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close inspector"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {/* Route Overview Card (if selectedRoute) */}
          {selectedRoute && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50 dark:bg-slate-950 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                  Container & Proxy Target
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    selectedRoute.isHealthy
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-800 dark:text-amber-400 border border-amber-500/30'
                  }`}
                >
                  {selectedRoute.containerStatus.toUpperCase()}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                <div>
                  <span className="text-slate-600 dark:text-slate-400 block text-[10px] uppercase">Public Subpath</span>
                  <span className="font-semibold text-[var(--color-brand-text)]">/{selectedRoute.slug}</span>
                </div>
                <div>
                  <span className="text-slate-600 dark:text-slate-400 block text-[10px] uppercase">Target Host Port</span>
                  <span className="text-slate-900 dark:text-slate-100 font-semibold">
                    <CopyableValue value={`127.0.0.1:${selectedRoute.port}`} label="host socket" />
                  </span>
                </div>
                <div>
                  <span className="text-slate-600 dark:text-slate-400 block text-[10px] uppercase">Bridge Subnet</span>
                  <span>
                    <CopyableValue value={selectedRoute.bridgeSubnet} label="bridge subnet CIDR" />
                  </span>
                </div>
                <div>
                  <span className="text-slate-600 dark:text-slate-400 block text-[10px] uppercase">Container IP (eth0)</span>
                  <span className="text-sky-700 dark:text-sky-400 font-semibold">
                    <CopyableValue value={selectedRoute.containerIp} label="container IP" />
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <a
                  href={selectedRoute.canonicalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--color-accent-text)] font-medium hover:underline truncate"
                >
                  {selectedRoute.canonicalUrl}
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                </a>

                {onRunTestHop && (
                  <button
                    onClick={() => onRunTestHop(selectedRoute)}
                    className="btn-accent text-xs py-1.5 px-3"
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
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50 dark:bg-slate-950 space-y-3">
              <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-sm flex items-center gap-2">
                <ArrowRight className="w-4 h-4 text-[var(--color-brand-text)]" />
                Boundary Transit Hop Details
              </h4>
              <div className="space-y-2">
                <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-800">
                  <span className="text-slate-600 dark:text-slate-400">Boundary Zone:</span>
                  <span className="font-mono text-slate-800 dark:text-slate-300 font-medium">{activeHop.zoneName}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-800">
                  <span className="text-slate-600 dark:text-slate-400">Node Component:</span>
                  <span className="font-mono text-[var(--color-brand-text)] font-semibold">{activeHop.label}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-800">
                  <span className="text-slate-600 dark:text-slate-400">Operational Role:</span>
                  <span className="text-slate-600 dark:text-slate-400">{activeHop.sublabel}</span>
                </div>
                {activeHop.badge && (
                  <div className="flex justify-between py-1">
                    <span className="text-slate-600 dark:text-slate-400">Network Tag:</span>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {activeHop.badge}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Security & Isolation Analysis */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-3">
            <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-sm flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              Security & Boundary Protection
            </h4>
            <ul className="space-y-2 text-slate-600 dark:text-slate-400">
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓</span>
                <span>
                  <strong>Loopback Confined:</strong> Port binding is strictly configured as{' '}
                  <code className="text-emerald-700 dark:text-emerald-400 tabular-nums">127.0.0.1:{selectedRoute?.port || 'PORT'}</code>.
                  Direct unauthenticated access from the physical LAN is completely blocked.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓</span>
                <span>
                  <strong>SSL Terminated at Lighttpd:</strong> Let's Encrypt / Cloudflare Origin CA certificate handles
                  cryptographic verification prior to socket dispatch.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓</span>
                <span>
                  <strong>L2/L3 Bridge Isolation:</strong> Container runs in an isolated network namespace with its own
                  virtual ethernet pair (`veth`) and private IP.
                </span>
              </li>
            </ul>
          </div>

          {/* Persistent Storage & Data Plane */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-3">
            <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-sm flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-[var(--color-brand-text)]" />
              Storage & SQLite WAL Mount
            </h4>
            <div className="font-mono text-xs bg-slate-50 dark:bg-[#050b14] text-emerald-900 dark:text-emerald-400 p-3 rounded-xl border border-slate-200/90 dark:border-slate-800 space-y-1">
              <div className="text-slate-500 dark:text-slate-400"># Host Bind Mount:</div>
              <div className="text-slate-800 dark:text-slate-300">
                {selectedRoute?.app?.manifest.dataVolume || `/var/data/${selectedRoute?.containerName}/data`}
              </div>
              <div className="text-slate-500 dark:text-slate-400 pt-1"># Container Target:</div>
              <div className="text-slate-800 dark:text-slate-300">/app/data</div>
              <div className="text-slate-500 dark:text-slate-400 pt-1"># Database & Mode:</div>
              <div className="text-emerald-800 dark:text-emerald-300 font-semibold">
                {selectedRoute?.slug}.sqlite (PRAGMA journal_mode=WAL)
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
