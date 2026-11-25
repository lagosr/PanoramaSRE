import React from 'react';
import { ExternalLink, Globe, Server } from 'lucide-react';
import {
  AppBackupDetail,
  BackupLedgerSummary,
  DiscoveredApp,
  NetworkPosture,
  OptInComplianceSnapshot,
  getAppOperationalHealth,
  isAppCritical,
  isAppDeployCandidate,
} from '../../lib/types';
import { ProvenanceBadge } from '../ui/ProvenanceBadge';

interface FleetAppTableProps {
  apps: DiscoveredApp[];
  backupLedger?: BackupLedgerSummary | null;
  optInSnapshot?: OptInComplianceSnapshot | null;
  isInitialSyncComplete?: boolean;
  networkPosture?: NetworkPosture;
  onOpenApp: (url: string) => void;
  onInspectComposition: (app: DiscoveredApp) => void;
  onNavigateToRelease?: (slug: string) => void;
  onNavigateToOptIns?: () => void;
}

function findBackupDetail(
  backupLedger: BackupLedgerSummary | null | undefined,
  app: DiscoveredApp
): AppBackupDetail | undefined {
  return backupLedger?.latest_app_details.find(
    (b) =>
      b.app_name.toLowerCase() === app.manifest.displayName.toLowerCase() ||
      b.app_name.toLowerCase() === app.manifest.appId.toLowerCase() ||
      b.app_name.toLowerCase() === app.manifest.slug.toLowerCase()
  );
}

export const FleetAppTable: React.FC<FleetAppTableProps> = ({
  apps,
  backupLedger,
  optInSnapshot,
  isInitialSyncComplete = true,
  networkPosture = 'LAN_DIRECT',
  onOpenApp,
  onInspectComposition,
  onNavigateToRelease,
  onNavigateToOptIns,
}) => {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <th className="py-3 px-4">Application</th>
              <th className="py-3 px-3">Health</th>
              <th className="py-3 px-3">Provenance</th>
              <th className="py-3 px-3">Live Release</th>
              <th className="py-3 px-3">Local HEAD</th>
              <th className="py-3 px-3">DR / Compliance</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {apps.map((app) => {
              const isEdgePages = app.manifest.hostingTarget === 'cloudflare-pages';
              const isWshService = app.manifest.hostingTarget === 'wsh-docker-service';
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
              const deployCandidate = isInitialSyncComplete && isAppDeployCandidate(app);
              const aheadCount = app.composition?.ahead_count ?? 0;
              const release = app.health?.release;
              const backupStatus = findBackupDetail(backupLedger, app);
              const isBackupFailed =
                isInitialSyncComplete &&
                !isEdgePages &&
                !isWshService &&
                backupStatus?.status?.toLowerCase() === 'failed';
              const appPublicUrl = isEdgePages
                ? app.manifest.cloudflare?.primaryUrl || 'https://www.parakith.com'
                : `https://wsh.panoramadr.com${app.manifest.basePath}`;

              return (
                <tr
                  key={app.manifest.slug}
                  className={
                    isCritical
                      ? 'bg-rose-50/70 dark:bg-rose-950/20'
                      : deployCandidate
                      ? 'bg-amber-50/70 dark:bg-amber-500/[0.08] hover:bg-amber-100/60 dark:hover:bg-amber-500/15 border-l-4 border-l-amber-500'
                      : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors'
                  }
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {app.manifest.displayName}
                      </span>
                      {isEdgePages && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 whitespace-nowrap">
                          <Globe className="w-2.5 h-2.5" />
                          EDGE
                        </span>
                      )}
                      {isWshService && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 whitespace-nowrap">
                          <Server className="w-2.5 h-2.5" />
                          SVC
                        </span>
                      )}
                      <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        :{app.manifest.port}
                      </span>
                    </div>
                  </td>

                  <td className="py-3 px-3 whitespace-nowrap">
                    {isPendingSync ? (
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-semibold">
                        SYNCING
                      </span>
                    ) : isTelemetryUnavailable ? (
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-semibold">
                        {networkPosture === 'WAN_CLOUDFLARE' ? 'LAN ONLY' : 'NO DATA'}
                      </span>
                    ) : isOptionalNotDeployed ? (
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-semibold">
                        NOT DEPLOYED
                      </span>
                    ) : (
                      <span
                        className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-semibold tabular-nums ${
                          isHealthy
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                            : 'bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-500/40'
                        }`}
                      >
                        {isHealthy
                          ? isWshService
                            ? 'RUNNING'
                            : `${app.latencyMs ?? 0}ms`
                          : app.health
                          ? isWshService
                            ? 'STOPPED'
                            : 'FAIL'
                          : 'OFFLINE'}
                      </span>
                    )}
                  </td>

                  <td className="py-3 px-3 whitespace-nowrap">
                    <ProvenanceBadge
                      state={isPendingSync ? 'UNKNOWN' : app.provenanceState}
                      aheadCount={app.composition?.ahead_count}
                      behindCount={app.composition?.behind_count}
                    />
                  </td>

                  <td className="py-3 px-3 font-mono text-slate-800 dark:text-slate-200 max-w-[200px] truncate">
                    {isPendingSync
                      ? 'Checking...'
                      : isTelemetryUnavailable
                      ? networkPosture === 'WAN_CLOUDFLARE'
                        ? 'LAN Telemetry Req'
                        : 'Unavailable'
                      : isWshService
                      ? isOptionalNotDeployed
                        ? 'Optional'
                        : app.health?.deployed_at || 'Deployed'
                      : release
                      ? release.release_id
                      : app.health?.version
                      ? `v${app.health.version}`
                      : 'Unreachable'}
                  </td>

                  <td className="py-3 px-3 font-mono text-slate-600 dark:text-slate-400 max-w-[170px] truncate">
                    {app.composition
                      ? `${app.composition.local_branch} @ ${app.composition.local_head_short}`
                      : 'Scanning...'}
                  </td>

                  <td className="py-3 px-3 whitespace-nowrap font-mono tabular-nums">
                    {isEdgePages && optInSnapshot ? (
                      onNavigateToOptIns ? (
                        <button
                          type="button"
                          onClick={onNavigateToOptIns}
                          className="text-emerald-700 dark:text-emerald-400 hover:underline font-semibold cursor-pointer"
                        >
                          {optInSnapshot.totalCount} Opt-Ins
                        </button>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                          {optInSnapshot.totalCount} Opt-Ins
                        </span>
                      )
                    ) : !isEdgePages && !isWshService && backupStatus ? (
                      <span
                        className={`font-semibold ${
                          isBackupFailed
                            ? 'text-rose-700 dark:text-rose-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {isBackupFailed ? 'Backup Failed' : 'GFS OK'}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>

                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1.5">
                      {deployCandidate && onNavigateToRelease && (
                        <button
                          type="button"
                          onClick={() => onNavigateToRelease(app.manifest.slug)}
                          className="btn-primary text-[11px] py-1 px-2.5 min-h-[32px] whitespace-nowrap flex-shrink-0"
                        >
                          <span>Deploy{aheadCount > 0 ? ` (${aheadCount})` : ''} →</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onInspectComposition(app)}
                        className="btn-secondary text-[11px] py-1 px-2.5 min-h-[32px] whitespace-nowrap flex-shrink-0"
                      >
                        Inspect Drift
                      </button>
                      {!isWshService && (
                        <button
                          type="button"
                          onClick={() => onOpenApp(appPublicUrl)}
                          className="btn-ghost text-[11px] py-1 px-2 min-h-[32px] whitespace-nowrap flex-shrink-0"
                          title={`Open ${appPublicUrl}`}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
