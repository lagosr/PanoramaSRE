import { DiscoveredApp, AppBackupDetail, OptInComplianceSnapshot } from '../../lib/types';
import { ProvenanceBadge } from '../ui/ProvenanceBadge';
import { BlastRadiusBadge } from '../ui/BlastRadiusBadge';
import { AlertCircle, HardDriveDownload, XCircle, Globe, MessageSquare, Server } from 'lucide-react';

interface FleetAppCardProps {
  app: DiscoveredApp;
  backupStatus?: AppBackupDetail | null;
  optInSnapshot?: OptInComplianceSnapshot | null;
  onOpenApp: (url: string) => void;
  onInspectComposition: (app: DiscoveredApp) => void;
  onNavigateToOptIns?: () => void;
  onNavigateToRelease?: (slug: string) => void;
}

export function FleetAppCard({
  app,
  backupStatus,
  optInSnapshot,
  onOpenApp,
  onInspectComposition,
  onNavigateToOptIns,
  onNavigateToRelease,
}: FleetAppCardProps) {
  const isEdgePages = app.manifest.hostingTarget === 'cloudflare-pages';
  const isWshService = app.manifest.hostingTarget === 'wsh-docker-service';
  const isOptionalNotDeployed =
    isWshService &&
    Boolean(app.manifest.service?.optionalDeployment) &&
    app.health?.status === 'not_deployed';
  const appPublicUrl = isEdgePages
    ? app.manifest.cloudflare?.primaryUrl || 'https://www.parakith.com'
    : `https://wsh.panoramadr.com${app.manifest.basePath}`;
  const isHealthy = app.health?.status === 'healthy';
  const release = app.health?.release;
  const latency = app.latencyMs ?? 0;
  const isBackupFailed =
    !isEdgePages && !isWshService && backupStatus?.status?.toLowerCase() === 'failed';
  const isCritical =
    !isOptionalNotDeployed &&
    (!isHealthy || app.provenanceState === 'PROD_UNREACHABLE' || app.provenanceState === 'DIRTY_PROD');

  return (
    <article
      className={`flex flex-col justify-between rounded-2xl border p-5 transition-all w-full min-w-0 overflow-hidden relative ${
        isCritical
          ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-500/80 shadow-[0_0_24px_rgba(244,63,94,0.2)] ring-1 ring-rose-500/50'
          : isBackupFailed
          ? 'bg-rose-50 dark:bg-rose-950/20 border-rose-500/60 shadow-sm'
          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm hover:border-slate-300 dark:hover:border-slate-700'
      }`}
    >
      {/* Critical Unhealthy Banner if down */}
      {isCritical && (
        <div className="mb-3 px-3 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/40 flex items-center justify-between text-rose-800 dark:text-rose-200 text-xs font-semibold animate-pulse">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>CRITICAL ALERT: APPLICATION UNHEALTHY</span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider bg-rose-700 dark:bg-rose-600 px-1.5 py-0.5 rounded text-white">
            {app.health?.status || 'DOWN'}
          </span>
        </div>
      )}

      {/* Backup Failure Warning Banner if DB snapshot failed */}
      {!isCritical && isBackupFailed && (
        <div className="mb-3 px-3 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/40 flex items-center justify-between text-rose-800 dark:text-rose-200 text-xs font-semibold">
          <div className="flex items-center gap-1.5">
            <HardDriveDownload className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>DR ALERT: LATEST BACKUP FAILED</span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider bg-rose-700 dark:bg-rose-600 text-white px-1.5 py-0.5 rounded">
            FAILED
          </span>
        </div>
      )}

      <div className="min-w-0">
        {/* Card Header: Icon, Title, Status & Provenance */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-base shrink-0 border ${
                isCritical
                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-700 dark:text-rose-400'
                  : isBackupFailed
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-800 dark:text-amber-300'
                  : 'bg-[var(--color-brand-subtle)] border-[var(--color-brand-ring)] text-[var(--color-brand-text)]'
              }`}
            >
              {app.manifest.displayName.substring(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm truncate flex items-center gap-1.5">
                <span className="truncate">{app.manifest.displayName}</span>
                {isEdgePages && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 shrink-0">
                    <Globe className="w-2.5 h-2.5" />
                    EDGE • CF PAGES
                  </span>
                )}
                {isWshService && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 shrink-0">
                    <Server className="w-2.5 h-2.5" />
                    WSH SERVICE
                  </span>
                )}
                {isCritical && (
                  <span className="inline-block w-2 h-2 rounded-full bg-rose-500 animate-ping shrink-0" title="Unhealthy" />
                )}
                {isBackupFailed && !isCritical && (
                  <span className="inline-block w-2 h-2 rounded-full bg-rose-500 shrink-0" title="Backup Failed" />
                )}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums truncate">
                {isEdgePages
                  ? `Port ${app.manifest.port} (dev) • ${app.manifest.cloudflare?.domains?.[0] || 'Cloudflare Pages'}`
                  : isWshService
                  ? `${app.manifest.service?.bindIp || '172.25.25.5'}:${app.manifest.port}/${app.manifest.service?.protocol || 'udp'} • ${app.manifest.service?.networkName || app.manifest.composeProject}`
                  : `Port ${app.manifest.port} • ${app.manifest.basePath}`}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <ProvenanceBadge
              state={app.provenanceState}
              aheadCount={app.composition?.ahead_count}
              behindCount={app.composition?.behind_count}
            />
            {isOptionalNotDeployed ? (
              <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-semibold">
                NOT DEPLOYED
              </span>
            ) : app.health ? (
              <span
                className={`text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded font-semibold ${
                  isHealthy
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-500/40 animate-pulse'
                }`}
              >
                {isHealthy
                  ? isWshService
                    ? 'RUNNING'
                    : `${latency}ms`
                  : isWshService
                  ? 'STOPPED'
                  : 'FAIL'}
              </span>
            ) : (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-500/40 animate-pulse font-semibold">
                OFFLINE
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 mb-4">
          {app.manifest.description || 'No description provided.'}
        </p>

        {/* Release & Live Deployment Telemetry */}
        <div
          className={`rounded-xl border p-3 mb-4 space-y-1.5 text-xs min-w-0 overflow-hidden ${
            isCritical
              ? 'bg-rose-100/70 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800/60'
              : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-600 dark:text-slate-400 shrink-0">Live Release:</span>
            <span
              className={`font-mono truncate text-right font-medium ${
                isCritical ? 'text-rose-800 dark:text-rose-300' : 'text-slate-900 dark:text-slate-200'
              }`}
            >
              {isWshService
                ? isOptionalNotDeployed
                  ? 'Not Deployed (Optional)'
                  : app.health?.deployed_at || 'Deployed on WSH'
                : release
                ? release.release_id
                : app.health?.version
                ? `v${app.health.version} (Legacy)`
                : 'Unreachable'}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-600 dark:text-slate-400 shrink-0">Local HEAD:</span>
            <span className="font-mono text-slate-900 dark:text-slate-200 truncate text-right">
              {app.composition ? `${app.composition.local_branch} @ ${app.composition.local_head_short}` : 'Scanning...'}
            </span>
          </div>

          {!isEdgePages && !isWshService && backupStatus && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-600 dark:text-slate-400 shrink-0">DB Backup:</span>
              <span
                className={`font-mono truncate text-right text-[11px] font-semibold flex items-center gap-1 ${
                  isBackupFailed ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {isBackupFailed ? (
                  <>
                    <XCircle className="w-3 h-3 shrink-0 text-rose-600 dark:text-rose-400 inline" />
                    <span>Failed</span>
                  </>
                ) : (
                  <span>Success</span>
                )}
              </span>
            </div>
          )}

          {isEdgePages && optInSnapshot && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-600 dark:text-slate-400 shrink-0">SMS Opt-Ins (D1):</span>
              {onNavigateToOptIns ? (
                <button
                  type="button"
                  onClick={onNavigateToOptIns}
                  className="font-mono tabular-nums text-right text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1 truncate cursor-pointer"
                >
                  <MessageSquare className="w-3 h-3 shrink-0" />
                  <span>
                    {optInSnapshot.totalCount} total ({optInSnapshot.consentedCount} yes)
                  </span>
                </button>
              ) : (
                <span className="font-mono tabular-nums text-right text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 truncate">
                  {optInSnapshot.totalCount} total ({optInSnapshot.consentedCount} yes)
                </span>
              )}
            </div>
          )}

          {app.composition && app.composition.blast_radius_badges.length > 0 && (
            <div className="pt-1.5 flex flex-wrap gap-1 border-t border-slate-200 dark:border-slate-800">
              {app.composition.blast_radius_badges.map((badge) => (
                <BlastRadiusBadge key={badge} badge={badge} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
        <button
          onClick={() => onInspectComposition(app)}
          className="btn-secondary flex-1 py-1.5 px-3 text-xs"
        >
          Inspect Drift
        </button>
        {isWshService && onNavigateToRelease ? (
          <button
            type="button"
            onClick={() => onNavigateToRelease(app.manifest.slug)}
            className="btn-primary py-1.5 px-3 text-xs whitespace-nowrap flex-shrink-0"
          >
            <span>Manage Release</span>
          </button>
        ) : (
          <button
            onClick={() => onOpenApp(appPublicUrl)}
            className={`${isCritical ? 'btn-danger' : 'btn-primary'} py-1.5 px-3 text-xs`}
          >
            <span>Open</span>
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
            </svg>
          </button>
        )}
      </div>
    </article>
  );
}
