import { DiscoveredApp } from '../../lib/types';
import { ProvenanceBadge } from '../ui/ProvenanceBadge';

interface FleetAppCardProps {
  app: DiscoveredApp;
  onOpenApp: (url: string) => void;
  onInspectComposition: (app: DiscoveredApp) => void;
}

export function FleetAppCard({ app, onOpenApp, onInspectComposition }: FleetAppCardProps) {
  const isHealthy = app.health?.status === 'healthy';
  const release = app.health?.release;
  const latency = app.latencyMs ?? 0;

  return (
    <article className="flex flex-col justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition-all w-full min-w-0 overflow-hidden">
      <div className="min-w-0">
        {/* Card Header: Icon, Title, Status & Provenance */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-base shrink-0">
              {app.manifest.displayName.substring(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm truncate">
                {app.manifest.displayName}
              </h3>
              <p className="text-xs text-slate-500 font-mono truncate">
                Port {app.manifest.port} • {app.manifest.basePath}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <ProvenanceBadge
              state={app.provenanceState}
              aheadCount={app.composition?.ahead_count}
              behindCount={app.composition?.behind_count}
            />
            {app.health && (
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  isHealthy
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-rose-500/10 text-rose-400'
                }`}
              >
                {latency}ms
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 mb-4">
          {app.manifest.description || 'No description provided.'}
        </p>

        {/* Release & Live Deployment Telemetry */}
        <div className="rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80 p-3 mb-4 space-y-1.5 text-xs min-w-0 overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 shrink-0">Live Release:</span>
            <span className="font-mono text-slate-800 dark:text-slate-200 truncate text-right">
              {release ? release.release_id : app.health?.version ? `v${app.health.version} (Legacy)` : 'Unreachable'}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 shrink-0">Local HEAD:</span>
            <span className="font-mono text-slate-800 dark:text-slate-200 truncate text-right">
              {app.composition ? `${app.composition.local_branch} @ ${app.composition.local_head_short}` : 'Scanning...'}
            </span>
          </div>

          {app.composition && app.composition.blast_radius_badges.length > 0 && (
            <div className="pt-1.5 flex flex-wrap gap-1 border-t border-slate-200/50 dark:border-slate-800/50">
              {app.composition.blast_radius_badges.map((badge) => (
                <span
                  key={badge}
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30"
                >
                  {badge}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
        <button
          onClick={() => onInspectComposition(app)}
          className="flex-1 py-1.5 px-3 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap"
        >
          Inspect Drift
        </button>
        <button
          onClick={() =>
            onOpenApp(`https://wsh.panoramadr.com${app.manifest.basePath}`)
          }
          className="py-1.5 px-3 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors whitespace-nowrap flex items-center gap-1"
        >
          <span>Open</span>
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
          </svg>
        </button>
      </div>
    </article>
  );
}
