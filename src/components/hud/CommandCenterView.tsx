import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  DiscoveredApp,
  ApplianceStatus,
  SslFleetSummary,
  BackupLedgerSummary,
  SecurityPostureInvariant,
  TerminalTab,
  OptInComplianceSnapshot,
  FleetCronAuditSummary,
  NetworkPosture,
  isAppUnhealthy,
} from '../../lib/types';
import { FleetAppCard } from './FleetAppCard';
import { ApplianceStatusStrip } from './ApplianceStatusStrip';
import { ReleaseCompositionDrawer } from './ReleaseCompositionDrawer';
import { WorkStreamContainer } from '../ui/WorkStreamContainer';
import { ShieldAlert, HardDriveDownload, RefreshCw, AlertTriangle, ShieldCheck, Network, Clock } from 'lucide-react';

interface CommandCenterViewProps {
  apps: DiscoveredApp[];
  appliances: ApplianceStatus[];
  sslFleet?: SslFleetSummary | null;
  backupLedger?: BackupLedgerSummary | null;
  isBackupIncidentDismissed?: boolean;
  optInSnapshot?: OptInComplianceSnapshot | null;
  cronSummary?: FleetCronAuditSummary | null;
  terminalTabs?: TerminalTab[];
  isLoading: boolean;
  isInitialSyncComplete?: boolean;
  networkPosture?: NetworkPosture;
  onNavigateToBackups?: () => void;
  onNavigateToOptIns?: () => void;
  onNavigateToCrons?: () => void;
  onNavigateToRelease?: (slug: string) => void;
  onTriggerFullGfsBackup?: () => void;
  securityViolationCount?: number;
  failingInvariants?: SecurityPostureInvariant[];
  onReapplyHardening?: () => void;
  onRunPenetrationAudit?: () => void;
  onNavigateToTopology?: () => void;
  onOpenInBottomConsole?: (tabId?: string) => void;
  onAbortJob?: (id: string) => void;
  onClearTab?: (id: string) => void;
}

export function CommandCenterView({ 
  apps, 
  appliances, 
  sslFleet, 
  backupLedger,
  isBackupIncidentDismissed = false,
  optInSnapshot,
  cronSummary,
  terminalTabs = [],
  isLoading,
  isInitialSyncComplete = true,
  networkPosture = 'LAN_DIRECT',
  onNavigateToBackups,
  onNavigateToOptIns,
  onNavigateToCrons,
  onNavigateToRelease,
  onTriggerFullGfsBackup,
  securityViolationCount = 0,
  failingInvariants = [],
  onReapplyHardening,
  onRunPenetrationAudit,
  onNavigateToTopology,
  onOpenInBottomConsole,
  onAbortJob,
  onClearTab,
}: CommandCenterViewProps) {
  const [selectedApp, setSelectedApp] = useState<DiscoveredApp | null>(null);

  const handleOpenApp = async (url: string) => {
    try {
      await openUrl(url);
    } catch {
      window.open(url, '_blank');
    }
  };

  const handleInspectComposition = (app: DiscoveredApp) => {
    setSelectedApp(app);
  };

  const unhealthyApps = isInitialSyncComplete
    ? apps.filter((a) => isAppUnhealthy(a, { isInitialSyncComplete, networkPosture }))
    : [];

  // Detect Automated Database Backup Failures (Red Flag Incident)
  const isLastBackupFailed = backupLedger?.last_run_status?.toLowerCase() === 'failed';
  const failedBackupApps = backupLedger?.latest_app_details.filter(
    (a) => a.status.toLowerCase() === 'failed'
  ) || [];
  const dailyPips = backupLedger?.daily_pips_7d || [];
  const todayPip = dailyPips.length > 0 ? dailyPips[dailyPips.length - 1] : undefined;
  const isTodayActionable = isLastBackupFailed || (todayPip !== undefined && todayPip.status !== 'Success');
  const missedOrFailed7dPips = dailyPips.filter(
    (p) => p.status !== 'Success'
  );
  const hasBackupIncident =
    isInitialSyncComplete &&
    !isBackupIncidentDismissed &&
    ((isLastBackupFailed && failedBackupApps.length > 0) || (backupLedger?.failed_runs_7d || 0) > 0);

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-[1920px] mx-auto w-full min-w-0 space-y-6 overflow-hidden">
      {/* Home Lab Appliances Status Banner */}
      {isInitialSyncComplete && (
        <ApplianceStatusStrip appliances={appliances} sslFleet={sslFleet} />
      )}

      {/* Critical WSH Network & Container Security Incident Banner (Red Flag) */}
      {isInitialSyncComplete && securityViolationCount > 0 && (
        <div className="rounded-xl border border-rose-500/80 bg-rose-50 dark:bg-rose-950/40 p-4 sm:p-5 shadow-[0_0_25px_rgba(244,63,94,0.15)] dark:shadow-[0_0_25px_rgba(244,63,94,0.35)] ring-1 ring-rose-500/50 space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-rose-500/20 border border-rose-500/50 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-6 h-6 text-rose-500 dark:text-rose-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-700 dark:bg-rose-600 text-white uppercase tracking-wider">
                    SECURITY INCIDENT ALERT
                  </span>
                  <span className="text-xs text-rose-600 dark:text-rose-400 font-mono">
                    WSH Hardening Monitor
                  </span>
                </div>
                <h3 className="text-sm font-bold text-rose-900 dark:text-rose-200 tracking-wide mt-1">
                  CRITICAL: {securityViolationCount} NETWORK & CONTAINER SECURITY INVARIANT{securityViolationCount > 1 ? 'S' : ''} FAILED
                </h3>
                <p className="text-xs text-rose-800 dark:text-rose-300/90 mt-0.5">
                  Failing checks:{' '}
                  <span className="font-semibold text-rose-950 dark:text-white">
                    {failingInvariants.map((inv) => `${inv.id}: ${inv.title}`).join('; ')}
                  </span>
                  . Host perimeter or container containment is exposed.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {onReapplyHardening && (
                <button
                  onClick={onReapplyHardening}
                  className="btn-danger text-xs py-1.5 px-3.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Re-Apply Hardening</span>
                </button>
              )}
              {onRunPenetrationAudit && (
                <button
                  onClick={onRunPenetrationAudit}
                  className="btn-secondary text-xs py-1.5 px-3.5"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Run Penetration Audit</span>
                </button>
              )}
              {onNavigateToTopology && (
                <button
                  onClick={onNavigateToTopology}
                  className="btn-secondary text-xs py-1.5 px-3.5"
                >
                  <Network className="w-3.5 h-3.5 text-[var(--color-accent-text)]" />
                  <span>Inspect Rules</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Critical Database Automated Backup Incident Banner (Red Flag) */}
      {hasBackupIncident && (
        <div className="rounded-2xl border border-rose-500/80 bg-rose-50 dark:bg-rose-950/40 p-4 sm:p-5 shadow-[0_0_25px_rgba(244,63,94,0.15)] dark:shadow-[0_0_25px_rgba(244,63,94,0.35)] ring-1 ring-rose-500/50 space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-rose-500/20 border border-rose-500/50 flex items-center justify-center shrink-0">
                <HardDriveDownload className="w-6 h-6 text-rose-600 dark:text-rose-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-700 dark:bg-rose-600 text-white uppercase tracking-wider">
                    DISASTER RECOVERY ALERT
                  </span>
                  <span className="text-xs text-rose-700 dark:text-rose-400 font-mono">
                    {isLastBackupFailed
                      ? (backupLedger?.last_run_timestamp ? new Date(backupLedger.last_run_timestamp).toLocaleString() : 'Latest Run')
                      : '7-Day GFS Window'}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-rose-900 dark:text-rose-200 tracking-wide mt-1">
                  {isLastBackupFailed && failedBackupApps.length > 0
                    ? `AUTOMATED DATABASE BACKUP FAILED ACROSS ${failedBackupApps.length} APPS`
                    : `AUTOMATED DATABASE BACKUP MISSED OR FAILED (${backupLedger?.failed_runs_7d} OF ${backupLedger?.runs_7d || 7} DAYS)`}
                </h3>
                <p className="text-xs text-rose-800 dark:text-rose-300/90 mt-0.5">
                  {isLastBackupFailed && failedBackupApps.length > 0 ? (
                    <>
                      Automated night backup job failed for:{' '}
                      <span className="font-semibold text-rose-950 dark:text-white">
                        {failedBackupApps.map((a) => a.app_name).join(', ')}
                      </span>
                      . Production databases lack verified recent backup snapshots.
                    </>
                  ) : (
                    <>
                      Scheduled daily GFS backup was missed or failed on:{' '}
                      <span className="font-semibold text-rose-950 dark:text-white">
                        {missedOrFailed7dPips.map((p) => `${p.day_label} (${p.date})`).join(', ')}
                      </span>
                      {!isTodayActionable && todayPip ? ` (Today's snapshot ${todayPip.date} is verified; past day cannot be backfilled).` : '.'}
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {onTriggerFullGfsBackup && isTodayActionable && (
                <button
                  onClick={onTriggerFullGfsBackup}
                  className="btn-danger text-xs py-1.5 px-3.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{isLastBackupFailed ? 'Retry Backup' : 'Run Today\'s Backup'}</span>
                </button>
              )}
              {!isTodayActionable && todayPip && (
                <span className="px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 whitespace-nowrap">
                  Today Protected ({todayPip.date})
                </span>
              )}
              {onNavigateToBackups && (
                <button
                  onClick={onNavigateToBackups}
                  className="btn-secondary text-xs py-1.5 px-3.5"
                >
                  <span>Inspect Ledger</span>
                </button>
              )}
            </div>
          </div>

          {/* Root cause and diagnostic explanation box */}
          <div className="p-3 rounded-lg bg-white dark:bg-slate-950 border border-rose-200 dark:border-rose-900/40 text-xs font-mono space-y-1">
            <div className="flex items-center gap-2 text-rose-800 dark:text-rose-300">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="font-semibold text-slate-900 dark:text-white">Root Cause:</span>
              <span>
                {isLastBackupFailed
                  ? 'Automated night backup job failed during remote execution.'
                  : 'Workstation missed scheduled 02:00 AM GFS backup window (e.g. overnight OS reboot / Modern Standby).'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Critical Fleet Alert Banner (Red Flag) */}
      {unhealthyApps.length > 0 && (
        <div className="rounded-2xl border border-rose-500/80 bg-rose-50 dark:bg-rose-950/40 p-4 sm:p-5 shadow-[0_0_25px_rgba(244,63,94,0.15)] dark:shadow-[0_0_25px_rgba(244,63,94,0.3)] ring-1 ring-rose-500/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-pulse">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-rose-500/20 border border-rose-500/50 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-6 h-6 text-rose-600 dark:text-rose-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-rose-900 dark:text-rose-200 tracking-wide">
                CRITICAL FLEET INCIDENT DETECTED
              </h3>
              <p className="text-xs text-rose-800 dark:text-rose-300/90 mt-0.5">
                {unhealthyApps.length} application{unhealthyApps.length > 1 ? 's are' : ' is'} reporting unhealthy or unreachable in production:{' '}
                <span className="font-semibold text-rose-950 dark:text-white">
                  {unhealthyApps.map((a) => a.manifest.displayName).join(', ')}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {unhealthyApps.map((a) => (
              <button
                key={a.manifest.slug}
                onClick={() => setSelectedApp(a)}
                className="btn-danger text-xs py-1.5 px-3"
              >
                Inspect {a.manifest.displayName}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Host Scheduled Cron & Heartbeat Drift Alert */}
      {isInitialSyncComplete && cronSummary && cronSummary.attentionCount > 0 && (
        <div className="rounded-xl border border-amber-400/70 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5 text-amber-700 dark:text-amber-400" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-amber-950 dark:text-amber-200 tracking-wide">
                HOST CRON ATTENTION REQUIRED ({cronSummary.attentionCount}{' '}
                {cronSummary.attentionCount === 1 ? 'TARGET' : 'TARGETS'})
              </h3>
              <p className="text-xs text-amber-900 dark:text-amber-300/90 mt-0.5">
                {!cronSummary.cronServiceActive
                  ? `DietPi host cron daemon is '${cronSummary.cronServiceStatus}'.`
                  : `Pending sync/migration: ${cronSummary.apps
                      .filter((a) => a.status !== 'IN_SYNC')
                      .map((a) => `${a.displayName} (${a.status})`)
                      .join(', ')}.`}
              </p>
            </div>
          </div>
          {onNavigateToCrons && (
            <button
              type="button"
              onClick={onNavigateToCrons}
              className="btn-primary text-xs py-1.5 px-3.5"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Inspect & Sync Crons</span>
            </button>
          )}
        </div>
      )}

      {/* Fleet Overview Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
            Panorama Suite Applications
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Real-time Git provenance drift, container health, and release orchestration
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {!isInitialSyncComplete && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 whitespace-nowrap">
              <RefreshCw className="w-3 h-3 animate-spin text-[var(--color-brand-text)] shrink-0" />
              <span>Syncing initial telemetry...</span>
            </span>
          )}
          <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
            {apps.length} Applications Registered
          </span>
        </div>
      </div>

      {/* Loading Skeleton or Cards Grid */}
      {isLoading && apps.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 w-full min-w-0">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-64 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 w-full min-w-0">
          {apps.map((app) => {
            const appBackup = backupLedger?.latest_app_details.find(
              (b) =>
                b.app_name.toLowerCase() === app.manifest.displayName.toLowerCase() ||
                b.app_name.toLowerCase() === app.manifest.appId.toLowerCase() ||
                b.app_name.toLowerCase() === app.manifest.slug.toLowerCase()
            );

            return (
              <FleetAppCard
                key={app.manifest.slug}
                app={app}
                backupStatus={appBackup}
                optInSnapshot={
                  app.manifest.hostingTarget === 'cloudflare-pages' ? optInSnapshot : undefined
                }
                isInitialSyncComplete={isInitialSyncComplete}
                networkPosture={networkPosture}
                onOpenApp={handleOpenApp}
                onInspectComposition={handleInspectComposition}
                onNavigateToOptIns={onNavigateToOptIns}
                onNavigateToRelease={onNavigateToRelease}
              />
            );
          })}
        </div>
      )}

      {/* Position 4: Global Command HUD Operations Stream */}
      <WorkStreamContainer
        pageScope="hud"
        tabs={terminalTabs}
        title="Command HUD Remediation & Sync Stream"
        description="Streams incident remediation actions (hardening re-apply, penetration audit, backup retry) and manual Sync Now runs."
        emptyHint="Trigger a remediation action or click Sync Now in the top bar to stream progress here or inspect full suite history in the Bottom Console."
        onOpenInBottomConsole={onOpenInBottomConsole}
        onAbortJob={onAbortJob}
        onClearTab={onClearTab}
      />

      {/* Release Composition Inspector Drawer */}
      <ReleaseCompositionDrawer
        app={selectedApp}
        isOpen={!!selectedApp}
        onClose={() => setSelectedApp(null)}
      />
    </div>
  );
}
