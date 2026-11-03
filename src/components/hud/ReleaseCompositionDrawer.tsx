import { DiscoveredApp } from '../../lib/types';
import { ProvenanceBadge } from '../ui/ProvenanceBadge';

interface ReleaseCompositionDrawerProps {
  app: DiscoveredApp | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ReleaseCompositionDrawer({ app, isOpen, onClose }: ReleaseCompositionDrawerProps) {
  if (!isOpen || !app) return null;

  const comp = app.composition;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold">
              {app.manifest.displayName.substring(0, 2).toUpperCase()}
            </div>
            <div>
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">
                {app.manifest.displayName} Drift Inspection
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <ProvenanceBadge
                  state={app.provenanceState}
                  aheadCount={comp?.ahead_count}
                  behindCount={comp?.behind_count}
                />
                <span className="text-xs text-slate-400 font-mono">
                  {comp?.local_branch}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Comparison Cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <p className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">Live on WSH</p>
              <p className="font-mono text-sm text-slate-900 dark:text-slate-200 font-medium truncate">
                {comp?.prod_release_id || 'Unreachable'}
              </p>
              <p className="text-[11px] text-slate-500 font-mono truncate mt-0.5">
                SHA: {comp?.prod_sha ? comp.prod_sha.substring(0, 7) : 'None'}
              </p>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <p className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">Local Workspace HEAD</p>
              <p className="font-mono text-sm text-slate-900 dark:text-slate-200 font-medium truncate">
                {comp?.local_branch} @ {comp?.local_head_short}
              </p>
              <p className="text-[11px] text-slate-500 font-mono truncate mt-0.5">
                Dirty: {comp?.local_dirty ? 'Yes (uncommitted files)' : 'Clean'}
              </p>
            </div>
          </div>

          {/* Blast Radius Flags */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Blast Radius Analysis
            </h4>
            {comp && comp.blast_radius_badges.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {comp.blast_radius_badges.map((b) => (
                  <span
                    key={b}
                    className="px-2.5 py-1 rounded-md text-xs font-mono font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30"
                  >
                    {b}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">No structural blast-radius flags detected.</p>
            )}
          </div>

          {/* Env Contract Diff */}
          {comp && comp.new_env_keys.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-rose-400 mb-2">
                New Environment Keys Required (+{comp.new_env_keys.length})
              </h4>
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 font-mono text-xs text-rose-300 space-y-1">
                {comp.new_env_keys.map((k) => (
                  <div key={k}>+ {k}</div>
                ))}
              </div>
            </div>
          )}

          {/* Undeployed Commits */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Undeployed Commits ({comp?.undeployed_commits.length ?? 0})
            </h4>
            {comp && comp.undeployed_commits.length > 0 ? (
              <div className="space-y-2">
                {comp.undeployed_commits.map((c) => (
                  <div
                    key={c.sha}
                    className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 text-xs"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">{c.sha}</span>
                      <span className="text-slate-500 text-[11px]">{c.author}</span>
                    </div>
                    <p className="text-slate-800 dark:text-slate-300">{c.subject}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">No undeployed commits pending.</p>
            )}
          </div>

          {/* Changed Files Since Prod */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Modified Files Since Prod ({comp?.changed_files_since_prod.length ?? 0})
            </h4>
            {comp && comp.changed_files_since_prod.length > 0 ? (
              <div className="rounded-lg bg-slate-900 dark:bg-[#050b14] border border-slate-200 dark:border-slate-800 p-3 font-mono text-xs text-emerald-600 dark:text-emerald-400 max-h-48 overflow-y-auto space-y-1">
                {comp.changed_files_since_prod.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-amber-500 dark:text-amber-400 font-semibold">{f.status}</span>
                    <span className="truncate text-slate-700 dark:text-slate-300">{f.path}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">No files modified since live production tag.</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
