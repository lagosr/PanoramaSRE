import React, { useMemo, useState } from 'react';
import { SegmentedControl } from '@lagosr/panorama-ui-kit';
import {
  AlertTriangle,
  CheckSquare,
  Eye,
  Globe,
  Layers,
  Loader2,
  Rocket,
  Server,
  Square,
} from 'lucide-react';
import {
  DiscoveredApp,
  NetworkPosture,
  TerminalTab,
  getAppOperationalHealth,
  isAppCritical,
  isAppDeployCandidate,
} from '../../lib/types';
import {
  evaluateBuildHealthBadge,
  resolveActiveBuildTelemetry,
} from '../../lib/buildTelemetry';

interface ReleaseFleetRailProps {
  apps: DiscoveredApp[];
  selectedSlug: string;
  onSelectApp: (slug: string) => void;
  batchSelectedSlugs: Set<string>;
  onToggleBatchSlug: (slug: string) => void;
  onSelectAllBehindBatch: () => void;
  onClearBatchSelection: () => void;
  onOpenBatchDeploy: () => void;
  onInspectApp: (app: DiscoveredApp) => void;
  getAppDeployJob: (slug: string) => TerminalTab | undefined;
  isInitialSyncComplete: boolean;
  networkPosture: NetworkPosture;
  isDeployingAll?: boolean;
}

export const ReleaseFleetRail: React.FC<ReleaseFleetRailProps> = ({
  apps,
  selectedSlug,
  onSelectApp,
  batchSelectedSlugs,
  onToggleBatchSlug,
  onSelectAllBehindBatch,
  onClearBatchSelection,
  onOpenBatchDeploy,
  onInspectApp,
  getAppDeployJob,
  isInitialSyncComplete,
  networkPosture,
  isDeployingAll = false,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'behind'>('all');

  const behindCount = useMemo(
    () => (isInitialSyncComplete ? apps.filter(isAppDeployCandidate).length : 0),
    [apps, isInitialSyncComplete]
  );

  const behindWshCount = useMemo(() => {
    if (!isInitialSyncComplete) return 0;
    return apps.filter(
      (a) =>
        (!a.manifest.hostingTarget || a.manifest.hostingTarget === 'wsh-docker') &&
        isAppDeployCandidate(a)
    ).length;
  }, [apps, isInitialSyncComplete]);

  const filteredApps = useMemo(() => {
    if (filterMode === 'all' || !isInitialSyncComplete) return apps;
    return apps.filter(isAppDeployCandidate);
  }, [apps, filterMode, isInitialSyncComplete]);

  return (
    <aside
      aria-label="Fleet Targets Master Rail"
      className="w-full lg:w-[292px] xl:w-[312px] shrink-0 lg:sticky lg:top-4 self-start rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden flex flex-col"
    >
      {/* Rail Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100 truncate">
              Fleet Targets
            </h2>
          </div>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
            {isInitialSyncComplete ? `${behindCount} behind` : 'Syncing...'}
          </span>
        </div>

        <SegmentedControl<'all' | 'behind'>
          activeVariant="brand"
          size="sm"
          value={filterMode}
          onChange={setFilterMode}
          options={[
            { value: 'all', label: `All (${apps.length})` },
            { value: 'behind', label: `Behind (${behindCount})` },
          ]}
        />
      </div>

      {/* Scrollable Fleet Roster */}
      <div className="max-h-[calc(100vh-300px)] overflow-y-auto divide-y divide-slate-200/70 dark:divide-slate-800/80">
        {filteredApps.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            All fleet targets are synchronized cleanly.
          </div>
        ) : (
          filteredApps.map((app) => {
            const comp = app.composition;
            const hostingTarget = app.manifest.hostingTarget;
            const isWshDocker = !hostingTarget || hostingTarget === 'wsh-docker';
            const isEdge = hostingTarget === 'cloudflare-pages';
            const isService = hostingTarget === 'wsh-docker-service';
            const opHealth = getAppOperationalHealth(app, {
              isInitialSyncComplete,
              networkPosture,
            });
            const isPendingSync = opHealth === 'pending_sync';
            const isTelemetryUnavailable = opHealth === 'telemetry_unavailable';
            const isOptionalNotDeployed = opHealth === 'optional_not_deployed';
            const isHealthy = opHealth === 'healthy';
            const isCritical = isAppCritical(app, {
              isInitialSyncComplete,
              networkPosture,
            });
            const undeployedCount = comp?.undeployed_commits?.length || 0;
            const isLocalDirty = Boolean(comp?.local_dirty);
            const needsDeploy =
              undeployedCount > 0 ||
              isLocalDirty ||
              comp?.state === 'AHEAD' ||
              comp?.state === 'LOCAL_WIP' ||
              app.provenanceState === 'DIRTY_PROD' ||
              app.provenanceState === 'DIVERGED';
            const isWipOnly = !isCritical && undeployedCount === 0 && isLocalDirty;
            const isDeploying = Boolean(getAppDeployJob(app.manifest.slug));
            const isSelected = selectedSlug === app.manifest.slug;
            const isChecked = batchSelectedSlugs.has(app.manifest.slug);
            const appIdent =
              app.manifest.containerName || app.manifest.slug || app.manifest.appId;
            const telResolved = resolveActiveBuildTelemetry(app.health?.release, comp);
            const buildBadge = evaluateBuildHealthBadge(telResolved.telemetry, appIdent);

            return (
              <div
                key={app.manifest.slug}
                onClick={() => onSelectApp(app.manifest.slug)}
                className={`px-3.5 py-2.5 cursor-pointer transition-colors border-l-2 ${
                  isSelected
                    ? 'border-l-[var(--color-brand)] bg-slate-50 dark:bg-slate-800/60'
                    : isCritical
                    ? 'border-l-rose-500 bg-rose-50/40 dark:bg-rose-950/15 hover:bg-rose-50/70 dark:hover:bg-rose-950/30'
                    : 'border-l-transparent hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    {isWshDocker ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleBatchSlug(app.manifest.slug);
                        }}
                        className="mt-0.5 text-slate-400 hover:text-[var(--color-brand-text)] shrink-0 cursor-pointer"
                        title={`Include ${app.manifest.displayName} in batch deploy`}
                        aria-label={`Select ${app.manifest.displayName} for batch deploy`}
                      >
                        {isChecked ? (
                          <CheckSquare className="w-4 h-4 text-[var(--color-brand-text)]" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    ) : (
                      <span
                        className="mt-0.5 w-4 h-4 shrink-0 inline-flex items-center justify-center text-slate-400"
                        title={isEdge ? 'Cloudflare Pages Target' : 'WSH Background Service'}
                      >
                        {isEdge ? (
                          <Globe className="w-3.5 h-3.5 text-sky-500" />
                        ) : (
                          <Server className="w-3.5 h-3.5 text-amber-500" />
                        )}
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            isHealthy
                              ? 'bg-emerald-500'
                              : isPendingSync
                              ? 'bg-slate-400 animate-pulse'
                              : isTelemetryUnavailable || isOptionalNotDeployed
                              ? 'bg-slate-400'
                              : 'bg-rose-500 animate-ping'
                          }`}
                        />
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                          {app.manifest.displayName}
                        </span>
                        {isEdge && (
                          <span className="px-1 py-0.2 rounded text-[9px] font-mono font-bold bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 shrink-0">
                            EDGE
                          </span>
                        )}
                        {isService && (
                          <span className="px-1 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 shrink-0">
                            SVC
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500 dark:text-slate-400 tabular-nums mt-0.5 truncate">
                        <span>
                          {isService
                            ? `:${app.manifest.port}/${app.manifest.service?.protocol || 'udp'}`
                            : app.health?.release?.semver ||
                              app.health?.version ||
                              `:${app.manifest.port}`}
                        </span>
                        <span>•</span>
                        <span className="truncate">{buildBadge.shortLabel}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {isPendingSync ? (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        SYNC
                      </span>
                    ) : isTelemetryUnavailable ? (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        {networkPosture === 'WAN_CLOUDFLARE' ? 'LAN' : 'N/A'}
                      </span>
                    ) : isOptionalNotDeployed ? (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        IDLE
                      </span>
                    ) : isCritical ? (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/40 inline-flex items-center gap-0.5">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        {isService ? 'STOP' : 'DOWN'}
                      </span>
                    ) : isDeploying ? (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 inline-flex items-center gap-0.5">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        LIVE
                      </span>
                    ) : isWipOnly ? (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40">
                        WIP
                      </span>
                    ) : needsDeploy ? (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/40 tabular-nums">
                        +{undeployedCount}
                        {isLocalDirty ? '*' : ''}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25">
                        {isService ? 'RUN' : 'OK'}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onInspectApp(app);
                      }}
                      className="text-[10px] font-mono text-slate-500 hover:text-[var(--color-brand-text)] inline-flex items-center gap-0.5 cursor-pointer"
                      title={`Inspect diff & provenance for ${app.manifest.displayName}`}
                    >
                      <Eye className="w-2.5 h-2.5" />
                      <span>Diff</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Rail Sticky Footer: Batch Orchestration Shortcuts */}
      <div className="px-3.5 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-center justify-between gap-2">
        {batchSelectedSlugs.size > 0 ? (
          <>
            <button
              type="button"
              disabled={isDeployingAll}
              onClick={onOpenBatchDeploy}
              className="btn-primary text-xs py-1.5 px-3 flex-1 justify-center whitespace-nowrap"
            >
              <Rocket className="w-3.5 h-3.5" />
              <span>Batch Deploy ({batchSelectedSlugs.size})</span>
            </button>
            <button
              type="button"
              onClick={onClearBatchSelection}
              className="btn-ghost text-xs py-1.5 px-2.5 whitespace-nowrap"
            >
              Clear
            </button>
          </>
        ) : behindWshCount > 0 ? (
          <button
            type="button"
            onClick={onSelectAllBehindBatch}
            className="btn-tonal text-xs py-1.5 px-3 w-full justify-center whitespace-nowrap"
          >
            Select All Behind ({behindWshCount})
          </button>
        ) : (
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 w-full text-center">
            Select apps to batch deploy
          </span>
        )}
      </div>
    </aside>
  );
};
