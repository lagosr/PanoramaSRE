import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { DiscoveredApp } from '../../lib/types';
import { ProvenanceBadge } from '../ui/ProvenanceBadge';
import { BlastRadiusBadge } from '../ui/BlastRadiusBadge';
import {
  resolveActiveBuildTelemetry,
  evaluateBuildHealthBadge,
  getAppTelemetryTargets,
} from '../../lib/buildTelemetry';

interface ReleaseCompositionDrawerProps {
  app: DiscoveredApp | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ReleaseCompositionDrawer({ app, isOpen, onClose }: ReleaseCompositionDrawerProps) {
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

  if (!isOpen || !app) return null;

  const comp = app.composition;
  const appIdent = app.manifest.containerName || app.manifest.slug || app.manifest.appId;
  const resolvedTel = resolveActiveBuildTelemetry(app.health?.release, comp);
  const telBadge = evaluateBuildHealthBadge(resolvedTel.telemetry, appIdent);
  const telTargets = getAppTelemetryTargets(appIdent, telBadge.cachePosture);

  const content = (
    <div
      className="fixed inset-0 z-[70] flex justify-end bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
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
            title="Close inspection (Esc)"
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

          {/* Build Telemetry & Efficiency Snapshot */}
          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Build Telemetry ({resolvedTel.source === 'LIVE_PROD' ? 'Live Prod' : resolvedTel.source === 'LOCAL_MANIFEST' ? 'Local Manifest' : 'Armed Targets'})
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                  telBadge.tone === 'emerald'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                    : telBadge.tone === 'amber'
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                    : telBadge.tone === 'rose'
                    ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30'
                    : 'bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                }`}
              >
                {telBadge.label}
              </span>
            </div>
            {resolvedTel.telemetry ? (
              <div className="grid grid-cols-3 gap-2 text-[11px] font-mono text-slate-600 dark:text-slate-300 pt-1">
                <div>
                  <span className="text-slate-400 block text-[10px]">Total / Target</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {resolvedTel.telemetry.total_duration_sec}s / ≤{telTargets.activeTargetSec}s
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Deps Cache / ELF</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {resolvedTel.telemetry.deps_cache_hit ? 'HIT' : 'MISS'} • {resolvedTel.telemetry.elf_verified_count} .node
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Context Transfer</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {resolvedTel.telemetry.context_transfer_kb} KB
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                Warm Target: ≤{telTargets.targetWarmSec}s • Cold Target: ≤{telTargets.targetColdSec}s • Regression Warn: +{telTargets.regressionThresholdPct}%
              </p>
            )}
          </div>

          {/* Blast Radius Flags */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Blast Radius Analysis
            </h4>
            {comp && comp.blast_radius_badges.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {comp.blast_radius_badges.map((b) => (
                  <BlastRadiusBadge key={b} badge={b} size="md" />
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

          {/* Uncommitted Working Tree Files */}
          {comp && comp.dirty_files && comp.dirty_files.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-500 dark:text-amber-400 mb-2">
                Uncommitted Working Tree Files ({comp.dirty_files.length})
              </h4>
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 font-mono text-xs max-h-48 overflow-y-auto space-y-1">
                {comp.dirty_files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-amber-600 dark:text-amber-400 font-semibold w-5 shrink-0">{f.status}</span>
                    <span className="truncate text-slate-800 dark:text-slate-200">{f.path}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

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

        {/* Footer with generous above-the-fold clearance and prominent action buttons */}
        <div className="p-4 sm:p-5 pb-6 sm:pb-8 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
            Press <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">Esc</kbd> or click outside to dismiss
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition-colors ml-auto flex items-center gap-2"
          >
            <span>Close Inspection</span>
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
