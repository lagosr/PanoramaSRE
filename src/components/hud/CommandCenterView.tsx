import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { DiscoveredApp, ApplianceStatus, SslFleetSummary, BackupLedgerSummary, SecurityPostureInvariant } from '../../lib/types';
import { FleetAppCard } from './FleetAppCard';
import { ApplianceStatusStrip } from './ApplianceStatusStrip';
import { ReleaseCompositionDrawer } from './ReleaseCompositionDrawer';
import { ShieldAlert, HardDriveDownload, RefreshCw, AlertTriangle, ShieldCheck, Network } from 'lucide-react';

interface CommandCenterViewProps {
  apps: DiscoveredApp[];
  appliances: ApplianceStatus[];
  sslFleet?: SslFleetSummary | null;
  backupLedger?: BackupLedgerSummary | null;
  isLoading: boolean;
  onNavigateToBackups?: () => void;
  onTriggerFullGfsBackup?: () => void;
  securityViolationCount?: number;
  failingInvariants?: SecurityPostureInvariant[];
  onReapplyHardening?: () => void;
  onRunPenetrationAudit?: () => void;
  onNavigateToTopology?: () => void;
}

export function CommandCenterView({ 
  apps, 
  appliances, 
  sslFleet, 
  backupLedger,
  isLoading,
  onNavigateToBackups,
  onTriggerFullGfsBackup,
  securityViolationCount = 0,
  failingInvariants = [],
  onReapplyHardening,
  onRunPenetrationAudit,
  onNavigateToTopology,
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

  const unhealthyApps = apps.filter(
    (a) => a.health?.status !== 'healthy' || a.provenanceState === 'PROD_UNREACHABLE'
  );

  // Detect Automated Database Backup Failures (Red Flag Incident)
  const isLastBackupFailed = backupLedger?.last_run_status?.toLowerCase() === 'failed';
  const failedBackupApps = backupLedger?.latest_app_details.filter(
    (a) => a.status.toLowerCase() === 'failed'
  ) || [];
  const missedOrFailed7dPips = (backupLedger?.daily_pips_7d || []).filter(
    (p) => p.status !== 'Success'
  );
  const hasBackupIncident = (isLastBackupFailed && failedBackupApps.length > 0) || (backupLedger?.failed_runs_7d || 0) > 0;

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto w-full min-w-0 space-y-6 overflow-hidden">
      {/* Home Lab Appliances Status Banner */}
      <ApplianceStatusStrip appliances={appliances} sslFleet={sslFleet} />

      {/* Critical WSH Network & Container Security Incident Banner (Red Flag) */}
      {securityViolationCount > 0 && (
        <div className="rounded-xl border border-rose-500/80 bg-rose-50 dark:bg-rose-950/40 p-4 sm:p-5 shadow-[0_0_25px_rgba(244,63,94,0.15)] dark:shadow-[0_0_25px_rgba(244,63,94,0.35)] ring-1 ring-rose-500/50 space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-rose-500/20 border border-rose-500/50 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-6 h-6 text-rose-500 dark:text-rose-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500 text-white uppercase tracking-wider">
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
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Re-Apply Hardening</span>
                </button>
              )}
              {onRunPenetrationAudit && (
                <button
                  onClick={onRunPenetrationAudit}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-sm transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Run Penetration Audit</span>
                </button>
              )}
              {onNavigateToTopology && (
                <button
                  onClick={onNavigateToTopology}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-sm transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5"
                >
                  <Network className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Inspect Rules</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Critical Database Automated Backup Incident Banner (Red Flag) */}
      {hasBackupIncident && (
        <div className="rounded-xl border border-rose-500/80 bg-rose-50 dark:bg-rose-950/40 p-4 sm:p-5 shadow-[0_0_25px_rgba(244,63,94,0.15)] dark:shadow-[0_0_25px_rgba(244,63,94,0.35)] ring-1 ring-rose-500/50 space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-rose-500/20 border border-rose-500/50 flex items-center justify-center shrink-0">
                <HardDriveDownload className="w-6 h-6 text-rose-500 dark:text-rose-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500 text-white uppercase tracking-wider">
                    DISASTER RECOVERY ALERT
                  </span>
                  <span className="text-xs text-rose-600 dark:text-rose-400 font-mono">
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
                      .
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {onTriggerFullGfsBackup && (
                <button
                  onClick={onTriggerFullGfsBackup}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{isLastBackupFailed ? 'Retry Backup' : 'Run Backup Now'}</span>
                </button>
              )}
              {onNavigateToBackups && (
                <button
                  onClick={onNavigateToBackups}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-sm transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5"
                >
                  <span>Inspect Ledger</span>
                </button>
              )}
            </div>
          </div>

          {/* Root cause and diagnostic explanation box */}
          <div className="p-3 rounded-lg bg-white/80 dark:bg-slate-950/60 border border-rose-200 dark:border-rose-900/40 text-xs font-mono space-y-1">
            <div className="flex items-center gap-2 text-rose-800 dark:text-rose-300">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
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
        <div className="rounded-xl border border-rose-500/80 bg-rose-50 dark:bg-rose-950/40 p-4 sm:p-5 shadow-[0_0_25px_rgba(244,63,94,0.15)] dark:shadow-[0_0_25px_rgba(244,63,94,0.3)] ring-1 ring-rose-500/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-pulse">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-rose-500/20 border border-rose-500/50 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-6 h-6 text-rose-500 dark:text-rose-400" />
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
          <div className="flex items-center gap-2 shrink-0">
            {unhealthyApps.map((a) => (
              <button
                key={a.manifest.slug}
                onClick={() => setSelectedApp(a)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition-all whitespace-nowrap"
              >
                Inspect {a.manifest.displayName}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fleet Overview Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
            Panorama Suite Applications
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Real-time Git provenance drift, container health, and release orchestration
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs font-mono text-slate-400">
            {apps.length} Applications Registered
          </span>
        </div>
      </div>

      {/* Loading Skeleton or Cards Grid */}
      {isLoading && apps.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 w-full min-w-0">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 animate-pulse"
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
                onOpenApp={handleOpenApp}
                onInspectComposition={handleInspectComposition}
              />
            );
          })}
        </div>
      )}

      {/* Release Composition Inspector Drawer */}
      <ReleaseCompositionDrawer
        app={selectedApp}
        isOpen={!!selectedApp}
        onClose={() => setSelectedApp(null)}
      />
    </div>
  );
}
