import React, { useState, useEffect, useRef } from 'react';
import {
  DiscoveredApp,
  NetworkPosture,
  isAppCritical,
  isAppDeployCandidate,
} from '../../lib/types';
import {
  Rocket,
  X,
  ArrowUp,
  ArrowDown,
  GripVertical,
  RotateCcw,
  CheckSquare,
  Square,
  Layers,
  Info,
  Lock,
  AlertTriangle,
} from 'lucide-react';
import { CustomSelect, SelectOption } from '../ui/CustomSelect';
import { ToggleSwitch } from '@lagosr/panorama-ui-kit';

export function buildInitialOrderedBatchApps(
  deployableApps: DiscoveredApp[],
  initialSelectedSlugs?: string[]
): DiscoveredApp[] {
  const bySlug = new Map(deployableApps.map((a) => [a.manifest.slug, a]));
  const explicitOrdered: DiscoveredApp[] = [];
  const seen = new Set<string>();

  if (initialSelectedSlugs && initialSelectedSlugs.length > 0) {
    for (const slug of initialSelectedSlugs) {
      const match = bySlug.get(slug);
      if (match && !seen.has(slug)) {
        explicitOrdered.push(match);
        seen.add(slug);
      }
    }
  }

  const remaining = deployableApps.filter((a) => !seen.has(a.manifest.slug));
  const remainingSorted = [
    ...remaining.filter((a) => a.manifest.slug === 'auth'),
    ...remaining.filter((a) => a.manifest.slug !== 'auth'),
  ];

  return [...explicitOrdered, ...remainingSorted];
}

export function reorderBatchApps(
  list: DiscoveredApp[],
  fromIndex: number,
  toIndex: number
): DiscoveredApp[] {
  if (
    fromIndex < 0 ||
    fromIndex >= list.length ||
    toIndex < 0 ||
    toIndex >= list.length ||
    fromIndex === toIndex
  ) {
    return list;
  }
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export interface BatchDeployOptions {
  selectedApps: DiscoveredApp[];
  bumpVersion: string;
  allowDirty: boolean;
  autoRollbackOnSmokeFailure: boolean;
}

interface BatchDeployModalProps {
  isOpen: boolean;
  apps: DiscoveredApp[];
  initialSelectedSlugs?: string[];
  onConfirm: (options: BatchDeployOptions) => void;
  onCancel: () => void;
  isProcessing?: boolean;
  isInitialSyncComplete?: boolean;
  networkPosture?: NetworkPosture;
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
  initialSelectedSlugs,
  onConfirm,
  onCancel,
  isProcessing = false,
  isInitialSyncComplete = true,
  networkPosture,
}) => {
  // Maintain ordered list of all apps
  const [orderedApps, setOrderedApps] = useState<DiscoveredApp[]>(() => {
    const deployableApps = apps.filter(
      (a) => !a.manifest.hostingTarget || a.manifest.hostingTarget === 'wsh-docker'
    );
    return buildInitialOrderedBatchApps(deployableApps, initialSelectedSlugs);
  });
  // Set of selected app slugs
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(() => {
    const deployableApps = apps.filter(
      (a) => !a.manifest.hostingTarget || a.manifest.hostingTarget === 'wsh-docker'
    );
    const allowedSet = new Set(deployableApps.map((a) => a.manifest.slug));
    const explicitInitial = (initialSelectedSlugs || []).filter((slug) => allowedSet.has(slug));
    if (explicitInitial.length > 0) return new Set(explicitInitial);
    const drifted = deployableApps.filter(isAppDeployCandidate);
    if (drifted.length > 0) return new Set(drifted.map((a) => a.manifest.slug));
    return new Set(deployableApps.map((a) => a.manifest.slug));
  });
  const [bumpVersion, setBumpVersion] = useState<string>('none');
  const [allowDirty, setAllowDirty] = useState<boolean>(false);
  const [autoRollbackOnSmokeFailure, setAutoRollbackOnSmokeFailure] = useState<boolean>(true);
  const [confirmText, setConfirmText] = useState<string>('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const wasOpenRef = useRef(false);

  const wshApps = apps.filter(
    (a) => !a.manifest.hostingTarget || a.manifest.hostingTarget === 'wsh-docker'
  );

  useEffect(() => {
    const deployableApps = apps.filter(
      (a) => !a.manifest.hostingTarget || a.manifest.hostingTarget === 'wsh-docker'
    );
    if (isOpen && !wasOpenRef.current) {
      // First time the modal opens: initialize state preserving any custom pre-selected order
      wasOpenRef.current = true;
      setOrderedApps(buildInitialOrderedBatchApps(deployableApps, initialSelectedSlugs));

      const allowedSet = new Set(deployableApps.map((a) => a.manifest.slug));
      const explicitInitial = (initialSelectedSlugs || []).filter((slug) =>
        allowedSet.has(slug)
      );
      if (explicitInitial.length > 0) {
        setSelectedSlugs(new Set(explicitInitial));
      } else {
        const drifted = deployableApps.filter(isAppDeployCandidate);
        if (drifted.length > 0) {
          setSelectedSlugs(new Set(drifted.map((a) => a.manifest.slug)));
        } else {
          setSelectedSlugs(new Set(deployableApps.map((a) => a.manifest.slug)));
        }
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
          const fresh = deployableApps.find((a) => a.manifest.slug === oldApp.manifest.slug);
          return fresh || oldApp;
        });
        const existingSlugs = new Set(prev.map((a) => a.manifest.slug));
        const newlyAdded = deployableApps.filter((a) => !existingSlugs.has(a.manifest.slug));
        return [...updated, ...newlyAdded];
      });
      // CRITICAL: Preserve user's checkboxes and confirmText without disruption
    }
  }, [isOpen, apps, initialSelectedSlugs]);

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
    setSelectedSlugs(new Set(wshApps.map((a) => a.manifest.slug)));
  };

  const selectNone = () => {
    setSelectedSlugs(new Set());
  };

  const selectOnlyDrifted = () => {
    const drifted = wshApps.filter(isAppDeployCandidate);
    setSelectedSlugs(new Set(drifted.map((a) => a.manifest.slug)));
  };

  // Reordering helpers
  const moveApp = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    setOrderedApps((prev) => reorderBatchApps(prev, index, targetIndex));
  };

  const handleResetDefaultOrder = () => {
    setOrderedApps((prev) => buildInitialOrderedBatchApps(prev));
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
      autoRollbackOnSmokeFailure,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6 relative flex flex-col max-h-[92vh] overflow-hidden">
        {/* Close Button */}
        <button
          onClick={onCancel}
          disabled={isProcessing}
          aria-label="Close modal"
          className="absolute top-4 right-4 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 text-[var(--color-brand-text)] mb-2 shrink-0">
          <div className="p-2.5 bg-[var(--color-brand-subtle)] border border-[var(--color-brand-ring)] rounded-xl">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Orchestrate Batch Suite Deployment
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">
              Customize target selection and execution sequence
            </p>
          </div>
        </div>

        {/* Top Quick Actions Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-slate-200 dark:border-slate-800 shrink-0 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 dark:text-slate-400 font-mono">Select:</span>
            <button
              type="button"
              onClick={selectAll}
              className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
            >
              All ({wshApps.length})
            </button>
            <button
              type="button"
              onClick={selectOnlyDrifted}
              className="px-2 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 transition-colors cursor-pointer"
            >
              Undeployed Drift Only
            </button>
            <button
              type="button"
              onClick={selectNone}
              className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 transition-colors cursor-pointer"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleResetDefaultOrder}
              disabled={isProcessing}
              className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors inline-flex items-center gap-1 cursor-pointer disabled:opacity-40"
              title="Reset sequence to PanoramaAuth first followed by remaining targets"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Order</span>
            </button>
          </div>

          <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">
            {executionQueue.length} of {wshApps.length} selected for deployment
          </span>
        </div>

        {/* Live Custom Execution Sequence Strip */}
        {executionQueue.length > 0 && (
          <div
            data-testid="batch-execution-order-preview"
            className="mt-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shrink-0 flex flex-wrap items-center gap-1.5 text-[11px] font-mono tabular-nums"
          >
            <span className="text-slate-500 dark:text-slate-400 font-semibold mr-1">
              Execution Order:
            </span>
            {executionQueue.map((app, qIdx) => (
              <React.Fragment key={`exec-seq-${app.manifest.slug}`}>
                {qIdx > 0 && <span className="text-slate-400">→</span>}
                <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-emerald-500/40 text-slate-900 dark:text-slate-100 font-semibold">
                  {qIdx + 1}. {app.manifest.displayName}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Reorderable Application Execution List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar my-3 space-y-2 pr-1">
          {orderedApps.map((app, idx) => {
            const isSelected = selectedSlugs.has(app.manifest.slug);
            const isAuth = app.manifest.slug === 'auth';
            const undeployedCount = app.composition?.undeployed_commits?.length || 0;
            const hasDrift = undeployedCount > 0 || app.composition?.local_dirty;
            const isCritical = isAppCritical(app, { isInitialSyncComplete, networkPosture });
            const queuePosition = executionQueue.findIndex((a) => a.manifest.slug === app.manifest.slug);
            const isDragTarget = dragOverIndex === idx && dragIndex !== null && dragIndex !== idx;

            return (
              <div
                key={app.manifest.slug}
                draggable={!isProcessing}
                onDragStart={() => setDragIndex(idx)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverIndex !== idx) setDragOverIndex(idx);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null && dragIndex !== idx) {
                    setOrderedApps((prev) => reorderBatchApps(prev, dragIndex, idx));
                  }
                  setDragIndex(null);
                  setDragOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDragOverIndex(null);
                }}
                className={`p-3 rounded-lg border transition-all flex items-center justify-between gap-3 ${
                  isDragTarget
                    ? 'border-[var(--color-brand)] ring-2 ring-[var(--color-brand)] bg-slate-50 dark:bg-slate-900'
                    : isSelected
                    ? 'bg-slate-50 dark:bg-slate-950/80 border-emerald-500/40 shadow-sm'
                    : 'bg-slate-50/50 dark:bg-slate-950/30 border-slate-200 dark:border-slate-800/60 opacity-60'
                } ${dragIndex === idx ? 'opacity-50' : ''}`}
              >
                {/* Left: Drag Handle + Checkbox + App Metadata */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`text-slate-400 shrink-0 ${isProcessing ? 'opacity-30' : 'cursor-grab active:cursor-grabbing hover:text-slate-600 dark:hover:text-slate-200'}`}
                    title="Drag to reorder deployment sequence"
                    aria-hidden="true"
                  >
                    <GripVertical className="w-4 h-4" />
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleAppSelection(app.manifest.slug)}
                    className="text-slate-400 hover:text-emerald-500 dark:hover:text-emerald-400 shrink-0 cursor-pointer"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Square className="w-5 h-5" />
                    )}
                  </button>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-slate-100 text-sm truncate">
                        {app.manifest.displayName}
                      </span>
                      {isAuth && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
                          <Lock className="w-2.5 h-2.5" />
                          Central IdP
                        </span>
                      )}
                      {isCritical && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/40 flex items-center gap-1">
                          <AlertTriangle className="w-2.5 h-2.5 text-rose-500" />
                          Unhealthy / Must Deploy
                        </span>
                      )}
                      {!isCritical && hasDrift && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30">
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
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                      Step {queuePosition + 1}
                    </span>
                  )}

                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={idx === 0 || isProcessing}
                      onClick={() => moveApp(idx, 'up')}
                      className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 disabled:opacity-20 disabled:hover:bg-transparent"
                      title="Move earlier in deployment order"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === orderedApps.length - 1 || isProcessing}
                      onClick={() => moveApp(idx, 'down')}
                      className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 disabled:opacity-20 disabled:hover:bg-transparent"
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
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 flex-1">
              <span className="text-slate-600 dark:text-slate-400 whitespace-nowrap">SemVer Bump:</span>
              <div className="w-full sm:w-64">
                <CustomSelect
                  value={bumpVersion}
                  options={BUMP_OPTIONS}
                  onChange={(val) => setBumpVersion(val)}
                />
              </div>
            </div>

            <ToggleSwitch
              size="sm"
              checked={allowDirty}
              onChange={setAllowDirty}
              disabled={isProcessing}
              label="Allow dirty git tree"
            />
          </div>

          {executionQueue.length > 1 && (
            <div className="pt-1 border-t border-slate-200/70 dark:border-slate-800/70">
              <ToggleSwitch
                size="sm"
                checked={autoRollbackOnSmokeFailure}
                onChange={setAutoRollbackOnSmokeFailure}
                disabled={isProcessing}
                label="Auto-rollback implicated app(s) on final suite smoke failure (skips DB_MIGRATION apps)"
              />
            </div>
          )}

          {/* Safety & Order Warning */}
          <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
            <Info className="w-4 h-4 text-[var(--color-brand-text)] shrink-0 mt-0.5" />
            <span>
              Deployments execute sequentially with per-app swap/health verification &amp; instant revert. Multi-app batches run one consolidated suite smoke gate at completion and isolate failing app(s) for targeted rollback.
            </span>
          </div>
        </div>

        {/* Confirmation Guard & Footer */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 mt-3 space-y-3 shrink-0">
          <div className="flex items-center gap-3">
            <label className="text-xs font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
              Type <span className="text-[var(--color-brand-text)] font-bold">DEPLOY</span> to confirm:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={isProcessing || executionQueue.length === 0}
              placeholder="DEPLOY"
              className="flex-1 px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-slate-100 focus:border-[var(--color-brand)] focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isProcessing}
              className="btn-secondary text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleStartDeployment}
              disabled={!isConfirmed || executionQueue.length === 0 || isProcessing}
              className="btn-primary text-xs font-bold flex items-center gap-2"
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
