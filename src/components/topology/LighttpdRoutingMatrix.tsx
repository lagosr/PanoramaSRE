import React, { useState } from 'react';
import {
  Server,
  ShieldCheck,
  Search,
  Zap,
  Terminal,
  Copy,
  Check,
} from 'lucide-react';
import { TopologyRouteItem } from '../../lib/topology-synthesizer';

interface LighttpdRoutingMatrixProps {
  routes: TopologyRouteItem[];
  isLoading?: boolean;
  selectedRouteSlug: string | null;
  onSelectRouteSlug: (slug: string) => void;
  onRunTestHop?: (route: TopologyRouteItem) => void;
}

export const LighttpdRoutingMatrix: React.FC<LighttpdRoutingMatrixProps> = ({
  routes,
  isLoading = false,
  selectedRouteSlug,
  onSelectRouteSlug,
  onRunTestHop,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const filteredRoutes = routes.filter(
    (r) =>
      r.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.containerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.port.toString().includes(searchQuery)
  );

  const handleCopyUrl = (url: string, slug: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(url);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
      {/* Header and Filter Toolbar */}
      <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-950/30">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
              Lighttpd Reverse Proxy Routing Table
              <span className="px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                {routes.length} Active Rules
              </span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
              Inbound /etc/lighttpd/lighttpd.conf URL prefix mappings to 127.0.0.1 host ports
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter routes or ports..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-lg text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-48 sm:w-60 font-mono"
            />
          </div>
        </div>
      </div>

      {/* Routes Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-mono">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 bg-slate-50/30 dark:bg-slate-950/20 text-[11px] uppercase tracking-wider">
              <th className="py-3 px-4">Subpath Prefix</th>
              <th className="py-3 px-4">Proxy Target Socket</th>
              <th className="py-3 px-4">Upstream Container</th>
              <th className="py-3 px-4">Security & Scope</th>
              <th className="py-3 px-4">Canonical Public URL</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {filteredRoutes.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400 font-sans">
                  {isLoading
                    ? 'Querying reverse proxy routing table from WSH host...'
                    : 'No matching proxy routes discovered.'}
                </td>
              </tr>
            ) : (
              filteredRoutes.map((rt) => {
                const isSelected = selectedRouteSlug === rt.slug;
                return (
                  <tr
                    key={rt.slug}
                    onClick={() => onSelectRouteSlug(rt.slug)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-emerald-500/10 dark:bg-emerald-500/10'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    {/* Subpath Prefix */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                          /{rt.slug}
                        </span>
                        {isSelected && (
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 font-sans block">
                        {rt.app?.manifest.displayName || rt.slug}
                      </span>
                    </td>

                    {/* Target Loopback Socket */}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        127.0.0.1:{rt.port}
                      </div>
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" />
                        Loopback Confined
                      </span>
                    </td>

                    {/* Upstream Container */}
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-700 dark:text-slate-300">
                        {rt.containerName}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-semibold ${
                            rt.isHealthy
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              rt.isHealthy ? 'bg-emerald-500' : 'bg-amber-500'
                            }`}
                          />
                          {rt.containerStatus.toUpperCase()}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {rt.containerIp}
                        </span>
                      </div>
                    </td>

                    {/* Security & Proxy Flags */}
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px]">
                          SSL :443
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px]">
                          50MB Max
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px]">
                          WSS Upgrade
                        </span>
                      </div>
                    </td>

                    {/* Canonical Public URL */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-600 dark:text-slate-400 truncate max-w-xs">
                          {rt.canonicalUrl}
                        </span>
                        <button
                          onClick={(e) => handleCopyUrl(rt.canonicalUrl, rt.slug, e)}
                          title="Copy canonical URL"
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                        >
                          {copiedSlug === rt.slug ? (
                            <Check className="w-3 h-3 text-emerald-500" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {onRunTestHop && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRunTestHop(rt);
                            }}
                            title="Run local test hop against this socket"
                            className="px-2.5 py-1 rounded-lg text-xs font-sans font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors flex items-center gap-1"
                          >
                            <Terminal className="w-3 h-3 text-emerald-500" />
                            Test Hop
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectRouteSlug(rt.slug);
                          }}
                          className={`p-1.5 rounded-lg border transition-colors ${
                            isSelected
                              ? 'bg-emerald-500 text-white border-emerald-500'
                              : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 border-slate-200 dark:border-slate-700'
                          }`}
                          title="Trace this path on the topology canvas"
                        >
                          <Zap className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
