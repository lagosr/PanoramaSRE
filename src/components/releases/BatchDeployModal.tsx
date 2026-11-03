import React, { useState, useEffect, useRef } from 'react';
import { DiscoveredApp } from '../../lib/types';
import { 
  Rocket, 
  X, 
  ArrowUp, 
  ArrowDown, 
  CheckSquare, 
  Square, 
  Layers, 
  Info,
  Lock
} from 'lucide-react';
import { CustomSelect, SelectOption } from '../ui/CustomSelect';

export interface BatchDeployOptions {
  selectedApps: DiscoveredApp[];
  bumpVersion: string;
  allowDirty: boolean;
}

interface BatchDeployModalProps {
  isOpen: boolean;
  apps: DiscoveredApp[];
  onConfirm: (options: BatchDeployOptions) => void;
  onCancel: () => void;
  isProcessing?: boolean;
}

const BUMP_OPTIONS: SelectOption[] = [
  { value: 'none', label: 'none (Keep Current SemVer)', description: 'Deploy HEAD without changing package.json version' },
  { value: 'patch', label: 'patch (0.0.+1)', description: 'Bug fixes and minor patches' },
  { value: 'minor', label: 'minor (0.+1.0)', description: 'Backwards-compatible features and improvements' },
  { value: 'major', label: 'major (+1.0.0)', description: 'Breaking changes and major architectural updates' },
];

export const BatchDeployModal: React.FC<BatchDeployModalProps> = ({
  isOpen,
  apps,
  onConfirm,
  onCancel,
  isProcessing = false,
}) => {
  // Maintain ordered list of all apps
  const [orderedApps, setOrderedApps] = useState<DiscoveredApp[]>([]);
  // Set of selected app slugs
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [bumpVersion, setBumpVersion] = useState<string>('none');
  const [allowDirty, setAllowDirty] = useState<boolean>(false);
  const [confirmText, setConfirmText] = useState<string>('');

  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      // First time the modal opens: initialize state
      wasOpenRef.current = true;
      const initialSorted = [
        ...apps.filter((a) => a.manifest.slug === 'auth'),
        ...apps.filter((a) => a.manifest.slug !== 'auth'),
      ];
      setOrderedApps(initialSorted);

      const drifted = apps.filter(
        (a) =>
          (a.composition?.undeployed_commits?.length || 0) > 0 ||
          (a.composition?.ahead_count || 0) > 0 ||
          a.composition?.local_dirty ||
          a.provenanceState === 'AHEAD' ||
          a.provenanceState === 'DIRTY_PROD' ||
          a.provenanceState === 'DIVERGED'
      );
      if (drifted.length > 0) {
        setSelectedSlugs(new Set(drifted.map((a) => a.manifest.slug)));
      } else {
        setSelectedSlugs(new Set(apps.map((a) => a.manifest.slug)));
      }
      setConfirmText('');
    } else if (!isOpen && wasOpenRef.current) {
      // Modal closed: reset open flag
      wasOpenRef.current = false;
    } else if (isOpen && wasOpenRef.current) {
      // Modal remains open, but `apps` prop updated (e.g. periodic ping):
      // Update app data inside orderedApps preserving custom sequence
      setOrderedApps((prev) => {
        const updated = prev.map((oldApp) => {
          const fresh = apps.find((a) => a.manifest.slug === oldApp.manifest.slug);
          return fresh || oldApp;
        });
        const existingSlugs = new Set(prev.map((a) => a.manifest.slug));
        const newlyAdded = apps.filter((a) => !existingSlugs.has(a.manifest.slug));
        return [...updated, ...newlyAdded];
      });
      // CRITICAL: Preserve user's checkboxes and confirmText without disruption
    }
  }, [isOpen, apps]);

  if (!isOpen) return null;

  // Toggle selection for an app
  const toggleAppSelection = (slug: string) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedSlugs(new Set(apps.map((a) => a.manifest.slug)));
  };

  const selectNone = () => {
    setSelectedSlugs(new Set());
  };

  const selectOnlyDrifted = () => {
    const drifted = apps.filter(
      (a) =>
        (a.composition?.undeployed_commits?.length || 0) > 0 ||
        (a.composition?.ahead_count || 0) > 0 ||
        a.composition?.local_dirty ||
        a.provenanceState === 'AHEAD' ||
        a.provenanceState === 'DIRTY_PROD' ||
        a.provenanceState === 'DIVERGED'
    );
    setSelectedSlugs(new Set(drifted.map((a) => a.manifest.slug)));
  };

  // Reordering helpers
  const moveApp = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= orderedApps.length) return;

    const next = [...orderedApps];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    setOrderedApps(next);
  };

  // The active deployment execution queue: only selected apps, in their chosen sequence
  const executionQueue = orderedApps.filter((a) => selectedSlugs.has(a.manifest.slug));
  const isConfirmed = confirmText.trim().toUpperCase() === 'DEPLOY';

  const handleStartDeployment = () => {
    if (executionQueue.length === 0 || !isConfirmed || isProcessing) return;
    onConfirm({
      selectedApps: executionQueue,
      bumpVersion,
      allowDirty,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-6 relative flex flex-col max-h-[92vh] overflow-hidden">
        {/* Close Button */}
        <button
          onClick={onCancel}
          disabled={isProcessing}
          className="absolute top-5 right-5 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 text-emerald-400 mb-2 shrink-0">
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">
              Orchestrate Batch Suite Deployment
            </h3>
            <p className="text-xs text-slate-400 font-mono">
              Customize target selection and execution sequence
            </p>
          </div>
        </div>

        {/* Top Quick Actions Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-slate-800 shrink-0 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-mono">Select:</span>
            <button
              type="button"
              onClick={selectAll}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            >
              All ({apps.length})
            </button>
            <button
              type="button"
              onClick={selectOnlyDrifted}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 transition-colors"
            >
              Undeployed Drift Only
            </button>
            <button
              type="button"
              onClick={selectNone}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors"
            >
              Clear
            </button>
          </div>

          <span className="font-mono text-emerald-400 font-semibold">
            {executionQueue.length} of {apps.length} selected for deployment
          </span>
        </div>

        {/* Reorderable Application Execution List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar my-4 space-y-2 pr-1">
          {orderedApps.map((app, idx) => {
            const isSelected = selectedSlugs.has(app.manifest.slug);
            const isAuth = app.manifest.slug === 'auth';
            const undeployedCount = app.composition?.undeployed_commits?.length || 0;
            const hasDrift = undeployedCount > 0 || app.composition?.local_dirty;
            const queuePosition = executionQueue.findIndex((a) => a.manifest.slug === app.manifest.slug);

            return (
              <div
                key={app.manifest.slug}
                className={`p-3 rounded-lg border transition-all flex items-center justify-between gap-3 ${
                  isSelected
                    ? 'bg-slate-950/80 border-emerald-500/40 shadow-sm'
                    : 'bg-slate-950/30 border-slate-800/60 opacity-60'
                }`}
              >
                {/* Left: Checkbox + Priority Step Pill */}
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => toggleAppSelection(app.manifest.slug)}
                    className="text-slate-400 hover:text-emerald-400 shrink-0"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <Square className="w-5 h-5" />
                    )}
                  </button>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-100 text-sm truncate">
                        {app.manifest.displayName}
                      </span>
                      {isAuth && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
                          <Lock className="w-2.5 h-2.5" />
                          Central IdP
                        </span>
                      )}
                      {hasDrift && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          {undeployedCount} commits behind
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-mono truncate">
                      Port {app.manifest.port} • {app.manifest.basePath} • Live: {app.health?.release?.semver || app.health?.version || 'v1.0.0'}
                    </p>
                  </div>
                </div>

                {/* Right: Step Position & Order Reorder Buttons */}
                <div className="flex items-center gap-2 shrink-0">
                  {isSelected && (
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      Step {queuePosition + 1}
                    </span>
                  )}

                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={idx === 0 || isProcessing}
                      onClick={() => moveApp(idx, 'up')}
                      className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100 disabled:opacity-20 disabled:hover:bg-transparent"
                      title="Move earlier in deployment order"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === orderedApps.length - 1 || isProcessing}
                      onClick={() => moveApp(idx, 'down')}
                      className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100 disabled:opacity-20 disabled:hover:bg-transparent"
                      title="Move later in deployment order"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Global Pipeline Parameters (SemVer Bump & Dirty Tree) */}
        <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800/80 space-y-3 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 flex-1">
              <span className="text-slate-400 whitespace-nowrap">SemVer Bump:</span>
              <div className="w-full sm:w-64">
                <CustomSelect
                  value={bumpVersion}
                  options={BUMP_OPTIONS}
                  onChange={(val) => setBumpVersion(val)}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-slate-400 text-xs">
              <input
                type="checkbox"
                checked={allowDirty}
                onChange={(e) => setAllowDirty(e.target.checked)}
                disabled={isProcessing}
                className="rounded border-slate-700 text-emerald-500 focus:ring-0"
              />
              <span>Allow dirty git tree</span>
            </label>
          </div>

          {/* Safety & Order Warning */}
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Info className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Deployments execute sequentially. If any application fails post-deployment verification, the circuit-breaker halts all subsequent steps immediately.
            </span>
          </div>
        </div>

        {/* Confirmation Guard & Footer */}
        <div className="pt-4 border-t border-slate-800 mt-3 space-y-3 shrink-0">
          <div className="flex items-center gap-3">
            <label className="text-xs font-mono text-slate-400 whitespace-nowrap">
              Type <span className="text-emerald-400 font-bold">DEPLOY</span> to confirm:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={isProcessing || executionQueue.length === 0}
              placeholder="DEPLOY"
              className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isProcessing}
              className="px-4 py-2 text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleStartDeployment}
              disabled={!isConfirmed || executionQueue.length === 0 || isProcessing}
              className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg shadow-lg transition-all flex items-center gap-2"
            >
              <Rocket className="w-4 h-4" />
              <span>
                {isProcessing
                  ? 'Initiating Deployment...'
                  : `Initiate Deployment (${executionQueue.length} App${executionQueue.length > 1 ? 's' : ''})`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
