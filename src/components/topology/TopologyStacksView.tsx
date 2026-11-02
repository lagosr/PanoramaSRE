import { WshSnapshot } from '../../lib/types';
import { Network, Server, Layers, ArrowRight } from 'lucide-react';

interface TopologyStacksViewProps {
  snapshot: WshSnapshot | null;
  isLoading?: boolean;
}

export function TopologyStacksView({ snapshot }: TopologyStacksViewProps) {
  const routes = (snapshot?.lighttpd_routes_raw || '')
    .split(',')
    .filter((r) => r.includes(':'))
    .map((r) => {
      const [slug, port] = r.split(':');
      return { slug, port };
    });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Network className="w-5 h-5 text-emerald-400" />
          Network Topology, Lighttpd Proxy & Container Stacks
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Real-time mapping of public subpath routing to internal host ports and active Docker containers
        </p>
      </div>

      {/* Network Edge to Container Flow */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm mb-4">
          End-to-End Ingress Path
        </h3>
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          <div className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-300">
            Client Browser (LAN/WAN)
          </div>
          <ArrowRight className="w-4 h-4 text-emerald-400" />
          <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            Lighttpd (:443 Reverse Proxy)
          </div>
          <ArrowRight className="w-4 h-4 text-emerald-400" />
          <div className="px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400">
            Docker Container (:3000 - :3004)
          </div>
          <ArrowRight className="w-4 h-4 text-emerald-400" />
          <div className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-300">
            SQLite WAL (/var/data/&lt;app&gt;)
          </div>
        </div>
      </div>

      {/* Lighttpd Proxy Routes Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
          <Server className="w-4 h-4 text-emerald-400" />
          Lighttpd Proxy Routing Rules ({routes.length})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500">
                <th className="pb-2">Subpath Prefix</th>
                <th className="pb-2">Proxy Target Port</th>
                <th className="pb-2">Public Canonical URL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {routes.map((rt, idx) => (
                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2 text-emerald-400 font-semibold">/{rt.slug}</td>
                  <td className="py-2 text-slate-300">127.0.0.1:{rt.port}</td>
                  <td className="py-2 text-slate-400">https://wsh.panoramadr.com/{rt.slug}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Running Docker Containers */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
          <Layers className="w-4 h-4 text-emerald-400" />
          Active Docker Containers ({snapshot?.containers?.length || 0})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500">
                <th className="pb-2">Container Name</th>
                <th className="pb-2">Image</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Ports</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {(snapshot?.containers || []).map((c, idx) => (
                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2 text-emerald-400 font-semibold">{c.Names || c.ID}</td>
                  <td className="py-2 text-slate-400 truncate max-w-xs">{c.Image}</td>
                  <td className="py-2 text-slate-300">{c.Status}</td>
                  <td className="py-2 text-slate-400">{c.Ports || 'Host'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
