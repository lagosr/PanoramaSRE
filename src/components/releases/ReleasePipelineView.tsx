import { useState } from 'react';
import { DiscoveredApp } from '../../lib/types';
import { GitBranch, Rocket, RotateCcw, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface ReleasePipelineViewProps {
  apps: DiscoveredApp[];
  onTriggerDeploy: (app: DiscoveredApp, bump: string, allowDirty: boolean) => void;
  onTriggerRollback: (app: DiscoveredApp, tag: string) => void;
}

export function ReleasePipelineView({ apps, onTriggerDeploy, onTriggerRollback }: ReleasePipelineViewProps) {
  const [selectedAppSlug, setSelectedAppSlug] = useState<string>(apps[0]?.manifest.slug || '');
  const [bumpVersion, setBumpVersion] = useState<string>('none');
  const [allowDirty, setAllowDirty] = useState<boolean>(false);
  const [rollbackTag, setRollbackTag] = useState<string>('');

  const selectedApp = apps.find((a) => a.manifest.slug === selectedAppSlug) || apps[0];
  const comp = selectedApp?.composition;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-emerald-400" />
          6-Stage Release Pipeline & Instant Rollback Engine
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Deploy cryptographic git-backed releases or execute sub-5-second container rollbacks
        </p>
      </div>

      {/* Target Application Selector */}
      <div className="flex flex-wrap items-center gap-2">
        {apps.map((app) => (
          <button
            key={app.manifest.slug}
            onClick={() => setSelectedAppSlug(app.manifest.slug)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              selectedApp?.manifest.slug === app.manifest.slug
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {app.manifest.displayName}
          </button>
        ))}
      </div>

      {selectedApp && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Release Composition Summary */}
          <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                  Release Composition: {selectedApp.manifest.displayName}
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  Local HEAD {comp?.local_head_short || 'unknown'} • Branch {comp?.local_branch || 'main'}
                </p>
              </div>

              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-mono">
                {comp?.state || 'IN_SYNC'}
              </span>
            </div>

            {/* Blast-Radius Badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Blast Radius:</span>
              {comp?.blast_radius_badges && comp.blast_radius_badges.length > 0 ? (
                comp.blast_radius_badges.map((b, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30"
                  >
                    {b}
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-400 font-mono">No sensitive boundaries detected</span>
              )}
            </div>

            {/* Undeployed Commits List */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400">
                Pending Commits ({comp?.undeployed_commits.length || 0}):
              </p>
              {comp?.undeployed_commits && comp.undeployed_commits.length > 0 ? (
                <div className="space-y-1.5 max-h-48 overflow-y-auto font-mono text-xs">
                  {comp.undeployed_commits.map((c, idx) => (
                    <div key={idx} className="p-2 rounded bg-slate-950 border border-slate-800 flex items-center justify-between">
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-emerald-400 font-semibold">{c.sha}</span>
                        <span className="text-slate-300 truncate">{c.subject}</span>
                      </div>
                      <span className="text-slate-500 text-[10px] shrink-0">{c.author}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80 text-center text-xs text-slate-500 font-mono flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Local working tree is clean and synchronized with production.
                </div>
              )}
            </div>

            {/* Deploy Trigger Form */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Stage 6: Orchestrate Production Deployment
              </h4>

              <div className="flex flex-wrap items-center gap-4 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">SemVer Bump:</span>
                  <select
                    value={bumpVersion}
                    onChange={(e) => setBumpVersion(e.target.value)}
                    className="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-200"
                  >
                    <option value="none">none (keep current)</option>
                    <option value="patch">patch (0.0.+1)</option>
                    <option value="minor">minor (0.+1.0)</option>
                    <option value="major">major (+1.0.0)</option>
                  </select>
                </div>

                <label className="flex items-center gap-2 cursor-pointer text-slate-400">
                  <input
                    type="checkbox"
                    checked={allowDirty}
                    onChange={(e) => setAllowDirty(e.target.checked)}
                    className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                  />
                  <span>Allow dirty uncommitted tree</span>
                </label>
              </div>

              <button
                onClick={() => onTriggerDeploy(selectedApp, bumpVersion, allowDirty)}
                className="w-full py-2.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all flex items-center justify-center gap-2 shadow-lg"
              >
                <Rocket className="w-4 h-4" />
                Buildx & Deploy to Production (deploy-docker.ps1)
              </button>
            </div>
          </div>

          {/* Instant Rollback Panel */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-rose-400" />
              Instant Rollback Panel
            </h3>
            <p className="text-xs text-slate-500">
              Instantly swaps the running WSH container to a previous N-3 cached image tag in under 5 seconds.
            </p>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-400">Rollback Target Tag:</label>
              <input
                type="text"
                placeholder="e.g. 0.4.0-7bae144"
                value={rollbackTag}
                onChange={(e) => setRollbackTag(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg text-xs font-mono bg-slate-950 border border-slate-800 text-slate-200 placeholder:text-slate-600"
              />
            </div>

            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-rose-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Schema Safety Gate
              </div>
              <p className="text-[11px] leading-relaxed">
                Rollbacks that downgrade SQLite schema versions are automatically blocked to prevent data corruption.
              </p>
            </div>

            <button
              onClick={() => onTriggerRollback(selectedApp, rollbackTag)}
              disabled={!rollbackTag.trim()}
              className="w-full py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Swap Container Tag Now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
