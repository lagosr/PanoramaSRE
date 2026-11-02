import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BackupLedgerSummary, BackupRecord, DiscoveredApp, LocalBackupArchive } from '../../lib/types';
import { CustomSelect } from '../ui/CustomSelect';
import { ConfirmDangerModal } from '../ui/ConfirmDangerModal';
import { 
  HardDrive, 
  CheckCircle2, 
  XCircle, 
  RefreshCw, 
  Archive, 
  Layers, 
  Clock, 
  ChevronDown, 
  ChevronRight, 
  Trash2, 
  DownloadCloud, 
  Server, 
  Laptop, 
  FileArchive, 
  Activity 
} from 'lucide-react';

interface BackupsRecoveryViewProps {
  apps: DiscoveredApp[];
  ledger: BackupLedgerSummary | null;
  isLoading: boolean;
  onRefresh: () => void;
  onTriggerFullGfsBackup: () => void;
  onTriggerAppBackup: (app: DiscoveredApp) => void;
  onApplyLocalBackup: (app: DiscoveredApp, archivePath: string) => void;
  onRestoreRemoteBackup: (app: DiscoveredApp, archivePath: string) => void;
  isApplying?: boolean;
}

export function BackupsRecoveryView({
  apps,
  ledger,
  isLoading,
  onRefresh,
  onTriggerFullGfsBackup,
  onTriggerAppBackup,
  onApplyLocalBackup,
  onRestoreRemoteBackup,
  isApplying = false,
}: BackupsRecoveryViewProps) {
  // Filter only applications backed by a database (exclude static resources or stateless microservices)
  const dbApps = apps.filter((a) => a.manifest.hasDatabase !== false);
  const [expandedRunIdx, setExpandedRunIdx] = useState<number | null>(null);
  const [selectedAppId, setSelectedAppId] = useState<string>(dbApps[0]?.manifest.appId || '');
  const [archives, setArchives] = useState<LocalBackupArchive[]>([]);
  const [isScanningArchives, setIsScanningArchives] = useState<boolean>(false);
  const [backupDir, setBackupDir] = useState<string>('');

  // Target archive modals
  const [pendingLocalApplyArchive, setPendingLocalApplyArchive] = useState<LocalBackupArchive | null>(null);
  const [pendingRemoteRestoreArchive, setPendingRemoteRestoreArchive] = useState<LocalBackupArchive | null>(null);

  // Sync selectedAppId if apps populate
  useEffect(() => {
    if (!selectedAppId && dbApps.length > 0) {
      setSelectedAppId(dbApps[0].manifest.appId);
    }
  }, [dbApps, selectedAppId]);

  const selectedApp = dbApps.find((a) => a.manifest.appId === selectedAppId) || dbApps[0];

  // Scan archives for selected app
  const scanArchives = () => {
    if (!selectedApp) return;
    setIsScanningArchives(true);
    invoke<{ backup_dir: string; archives: LocalBackupArchive[] }>('scan_local_backups', {
      workspacePath: selectedApp.workspacePath,
    })
      .then((res) => {
        setArchives(res.archives);
        setBackupDir(res.backup_dir);
      })
      .catch((err) => {
        console.error('[PanoramaSRE] Failed to scan archives:', err);
      })
      .finally(() => {
        setIsScanningArchives(false);
      });
  };

  useEffect(() => {
    scanArchives();
  }, [selectedApp?.manifest.appId]);

  const formatBytes = (bytes: number | null | undefined) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const toggleRunExpand = (idx: number) => {
    setExpandedRunIdx((prev) => (prev === idx ? null : idx));
  };

  const appOptions = dbApps.map((a) => ({
    value: a.manifest.appId,
    label: `${a.manifest.displayName} (Port ${a.manifest.port})`,
  }));

  const liveSchemaVersion = selectedApp?.devServer?.sqlite_user_version ?? 1;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-emerald-400" />
            Backups & Disaster Recovery Management
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Single control plane to inspect snapshots, trigger GFS runs, and apply backups to Local Dev or Production
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => {
              onRefresh();
              scanArchives();
            }}
            disabled={isLoading || isScanningArchives}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading || isScanningArchives ? 'animate-spin' : ''}`} />
            Refresh All
          </button>
          <button
            onClick={onTriggerFullGfsBackup}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
          >
            <Archive className="w-3.5 h-3.5" />
            Trigger Full GFS Backup
          </button>
        </div>
      </div>

      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Total Recorded GFS Runs</p>
          <p className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1 font-mono">
            {ledger?.total_runs || 0}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5 truncate font-mono">
            {ledger?.ledger_source_path ? ledger.ledger_source_path.split('\\').pop() : 'backup_history.json'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Successful GFS Executions</p>
          <p className="text-xl font-bold text-emerald-400 mt-1 font-mono">
            {ledger?.successful_runs || 0}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">Automated nightly snapshots</p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Failed / Retried Runs</p>
          <p className="text-xl font-bold text-rose-400 mt-1 font-mono">
            {ledger?.failed_runs || 0}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">Zero corruption events</p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Last GFS Execution</p>
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1 truncate font-mono">
            {ledger?.last_run_timestamp || 'Never'}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {ledger?.last_run_status === 'Success' ? (
              <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Success
              </span>
            ) : (
              <span className="text-xs text-slate-400 font-semibold">
                {ledger?.last_run_status || 'Pending'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 1: UNIFIED BACKUP RESTORATION & HYDRATION PANEL */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Laptop className="w-5 h-5 text-emerald-400" />
              Application Backup Management & Hydration Engine
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Select an application to inspect its available archives and restore data to either Local Development or Production.
            </p>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="w-64">
              <CustomSelect
                value={selectedAppId}
                onChange={setSelectedAppId}
                options={appOptions}
              />
            </div>

            <button
              onClick={() => selectedApp && onTriggerAppBackup(selectedApp)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 whitespace-nowrap transition-colors"
            >
              <DownloadCloud className="w-3.5 h-3.5 text-emerald-400" />
              Capture Remote Snapshot
            </button>
          </div>
        </div>

        {/* Directory & Environment Banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-50 dark:bg-slate-950/60 p-3 rounded-lg border border-slate-100 dark:border-slate-800/80 font-mono">
          <div className="flex items-center gap-2 text-slate-400 truncate max-w-xl">
            <FileArchive className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-slate-300 font-semibold">Backup Directory:</span>
            <span className="truncate">{backupDir || 'Resolving...'}</span>
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span>
              Local SQLite PRAGMA:{' '}
              <span className="text-emerald-400 font-bold">
                {selectedApp?.devServer?.sqlite_user_version !== undefined && selectedApp?.devServer?.sqlite_user_version !== null
                  ? `v${selectedApp.devServer.sqlite_user_version}`
                  : 'N/A'}
              </span>
            </span>
            <span>
              Archives Found: <span className="text-slate-200 font-bold">{archives.length}</span>
            </span>
          </div>
        </div>

        {/* Archives Table with Date column & Dual Apply Options */}
        {isScanningArchives ? (
          <div className="flex flex-col items-center justify-center py-12 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950/40 text-slate-400 space-y-3">
            <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
            <p className="text-xs font-mono font-medium">Scanning backup archives for {selectedApp?.manifest.displayName}...</p>
            <p className="text-[11px] text-slate-500">Checking Google Drive storage and archive health snapshots</p>
          </div>
        ) : archives.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg text-slate-500 text-xs font-mono">
            No backup archives (.tar.gz) found for this application.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500">
                  <th className="pb-2.5">Date of Backup</th>
                  <th className="pb-2.5">Archive Filename</th>
                  <th className="pb-2.5">Schema</th>
                  <th className="pb-2.5">Size</th>
                  <th className="pb-2.5">Verified Health</th>
                  <th className="pb-2.5 text-right">Hydration Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {archives.map((archive) => {
                  const isSchemaMismatch = archive.schema_version !== liveSchemaVersion;
                  const health = archive.health_snapshot;
                  const isHealthy = health?.status === 'healthy';

                  return (
                    <tr key={archive.file_name} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      {/* Date of Backup Column */}
                      <td className="py-3 text-slate-200 font-semibold whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                          <span>{archive.date_str}</span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-normal block pl-3">
                          {archive.timestamp_str.split(' ')[1] || ''}
                        </span>
                      </td>

                      {/* Archive Filename */}
                      <td className="py-3 text-slate-300 truncate max-w-xs" title={archive.full_path}>
                        {archive.file_name}
                      </td>

                      {/* Schema Version */}
                      <td className="py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                            isSchemaMismatch
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-300'
                          }`}
                        >
                          v{archive.schema_version}
                        </span>
                      </td>

                      {/* Size */}
                      <td className="py-3 text-slate-400">{formatBytes(archive.size_bytes)}</td>

                      {/* Health Snapshot */}
                      <td className="py-3">
                        {health ? (
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                isHealthy
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              }`}
                            >
                              <Activity className="w-3 h-3" />
                              {String(health.version || 'v?')} ({String(health.status || 'unknown')})
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-600 text-[11px] italic">No snapshot</span>
                        )}
                      </td>

                      {/* Actions: Apply to Local OR Restore to Production */}
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Apply to Local Dev */}
                          <button
                            onClick={() => setPendingLocalApplyArchive(archive)}
                            disabled={isApplying}
                            className="px-2.5 py-1 rounded text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center gap-1 shadow-sm whitespace-nowrap"
                            title="Extract snapshot to local development SQLite database"
                          >
                            <Laptop className="w-3 h-3" />
                            Apply to Local Dev
                          </button>

                          {/* Restore to Remote Production */}
                          <button
                            onClick={() => setPendingRemoteRestoreArchive(archive)}
                            disabled={isApplying}
                            className="px-2.5 py-1 rounded text-xs font-semibold bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800/80 transition-colors flex items-center gap-1 shadow-sm whitespace-nowrap"
                            title="Upload and restore archive directly into production container"
                          >
                            <Server className="w-3 h-3" />
                            Restore to Production
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION 2: PARTICIPANT APPLICATIONS BACKUP INVENTORY (LATEST GFS RUN) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            Suite Participants Backup Inventory (Latest GFS Run)
          </h3>
          <span className="text-xs text-slate-500 font-mono">
            {ledger?.latest_app_details?.length || 0} Registered Suite Applications
          </span>
        </div>

        {(!ledger?.latest_app_details || ledger.latest_app_details.length === 0) ? (
          <div className="text-center py-8 text-xs text-slate-500 font-mono">
            No per-application archive telemetry found in the latest backup run.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500">
                  <th className="pb-2">Date of Backup</th>
                  <th className="pb-2">Application</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Archive File</th>
                  <th className="pb-2">Archive Size</th>
                  <th className="pb-2">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {ledger.latest_app_details.map((app) => {
                  const runDate = ledger.last_run_timestamp ? ledger.last_run_timestamp.split('T')[0] : 'N/A';
                  return (
                    <tr key={app.app_name} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 text-slate-400 whitespace-nowrap">{runDate}</td>
                      <td className="py-2.5 text-slate-200 font-semibold flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        {app.app_name}
                      </td>
                      <td className="py-2.5">
                        {app.status === 'Success' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3" /> Success
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            <XCircle className="w-3 h-3" /> {app.status}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-slate-300 font-mono truncate max-w-xs">
                        {app.file || 'N/A'}
                      </td>
                      <td className="py-2.5 text-slate-400 font-mono">
                        {formatBytes(app.size_bytes)}
                      </td>
                      <td className="py-2.5 text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        {app.duration_seconds !== null && app.duration_seconds !== undefined
                          ? `${app.duration_seconds.toFixed(1)}s`
                          : 'N/A'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION 3: RECENT GFS AUDIT HISTORY LEDGER */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
          Recent GFS Automated Backup Runs & Retention History
        </h3>

        {(!ledger?.recent_records || ledger.recent_records.length === 0) ? (
          <div className="text-center py-8 text-xs text-slate-500 font-mono">
            No backup history ledger found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-3 w-8"></th>
                  <th className="py-2.5 px-3 font-semibold">Date of Backup</th>
                  <th className="py-2.5 px-3 font-semibold">Time (UTC)</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 px-3 font-semibold">Type</th>
                  <th className="py-2.5 px-3 font-semibold">Apps Covered</th>
                  <th className="py-2.5 px-3 font-semibold">Total Archive Size</th>
                  <th className="py-2.5 px-3 font-semibold">Destination</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {ledger.recent_records.map((r: BackupRecord, idx: number) => {
                  const isExpanded = expandedRunIdx === idx;
                  const hasDetails = (r.app_details && r.app_details.length > 0) || (r.pruned_files && Object.keys(r.pruned_files).length > 0);
                  const dateOnly = r.timestamp ? r.timestamp.split('T')[0] : 'N/A';
                  const timeOnly = r.timestamp && r.timestamp.includes('T') ? r.timestamp.split('T')[1].replace('Z', '') + ' UTC' : (r.timestamp || 'N/A');

                  return (
                    <React.Fragment key={idx}>
                      <tr
                        onClick={() => hasDetails && toggleRunExpand(idx)}
                        className={`transition-colors ${
                          hasDetails ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40' : ''
                        } ${isExpanded ? 'bg-slate-800/30' : ''}`}
                      >
                        <td className="py-3 px-3 text-slate-500 text-center">
                          {hasDetails ? (
                            isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-emerald-400 inline" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 inline text-slate-400" />
                            )
                          ) : null}
                        </td>
                        <td className="py-3 px-3 text-slate-300 font-medium whitespace-nowrap">{dateOnly}</td>
                        <td className="py-3 px-3 text-slate-400 font-mono whitespace-nowrap">{timeOnly}</td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          {r.status === 'Success' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              <CheckCircle2 className="w-3 h-3" /> Success
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                              <XCircle className="w-3 h-3" /> Failed
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-slate-400 whitespace-nowrap">{r.run_type || 'Automated'}</td>
                        <td className="py-3 px-3 text-slate-300 whitespace-nowrap font-semibold">{r.total_apps} apps</td>
                        <td className="py-3 px-3 text-slate-400 font-mono whitespace-nowrap">{formatBytes(r.total_size_bytes)}</td>
                        <td className="py-3 px-3 text-slate-500 truncate max-w-xs">{r.destination}</td>
                      </tr>

                      {/* Collapsible Details Row */}
                      {isExpanded && (
                        <tr className="bg-slate-950/40 border-t border-b border-slate-800">
                          <td colSpan={8} className="p-4">
                            <div className="space-y-4">
                              {r.app_details && r.app_details.length > 0 && (
                                <div className="space-y-2">
                                  <p className="text-[11px] font-semibold uppercase text-slate-400 tracking-wider">
                                    Application Archives for this Run
                                  </p>
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                    {r.app_details.map((ad) => (
                                      <div
                                        key={ad.app_name}
                                        className="p-2.5 rounded-lg border border-slate-800 bg-slate-900/60 text-xs flex items-center justify-between"
                                      >
                                        <div>
                                          <p className="font-semibold text-slate-200">{ad.app_name}</p>
                                          <p className="text-[11px] text-slate-400 truncate max-w-[180px]">
                                            {ad.file || 'No archive file'}
                                          </p>
                                        </div>
                                        <div className="text-right">
                                          <span className="text-slate-300 font-mono">{formatBytes(ad.size_bytes)}</span>
                                          {ad.duration_seconds !== null && ad.duration_seconds !== undefined && (
                                            <p className="text-[10px] text-slate-500">{ad.duration_seconds.toFixed(1)}s</p>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {r.pruned_files && Object.keys(r.pruned_files).length > 0 && (
                                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                                  <p className="text-[11px] font-semibold uppercase text-amber-400 tracking-wider flex items-center gap-1.5">
                                    <Trash2 className="w-3 h-3 text-amber-400" />
                                    GFS Pruning Actions (Expired Daily Snapshots Reclaimed)
                                  </p>
                                  <div className="space-y-1">
                                    {Object.entries(r.pruned_files).map(([app, files]) => (
                                      <div key={app} className="text-xs text-slate-400">
                                        <span className="text-slate-300 font-semibold">{app}:</span>{' '}
                                        <span className="font-mono text-[11px] text-slate-500">
                                          {files.join(', ')}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL 1: Confirm Apply to Local Dev */}
      <ConfirmDangerModal
        isOpen={pendingLocalApplyArchive !== null}
        onCancel={() => setPendingLocalApplyArchive(null)}
        onConfirm={() => {
          if (pendingLocalApplyArchive && selectedApp) {
            onApplyLocalBackup(selectedApp, pendingLocalApplyArchive.full_path);
            setPendingLocalApplyArchive(null);
          }
        }}
        title={`Apply Backup to Local Dev: ${selectedApp?.manifest.displayName}`}
        description={`This will terminate any running dev process for ${selectedApp?.manifest.displayName}, back up the existing database to a .bak file, and overwrite the local SQLite database using archive "${pendingLocalApplyArchive?.file_name}".`}
        confirmWord="APPLY LOCAL"
        confirmLabel="Apply Local Snapshot"
        isProcessing={isApplying}
      />

      {/* MODAL 2: Confirm Restore to Remote Production */}
      <ConfirmDangerModal
        isOpen={pendingRemoteRestoreArchive !== null}
        onCancel={() => setPendingRemoteRestoreArchive(null)}
        onConfirm={() => {
          if (pendingRemoteRestoreArchive && selectedApp) {
            onRestoreRemoteBackup(selectedApp, pendingRemoteRestoreArchive.full_path);
            setPendingRemoteRestoreArchive(null);
          }
        }}
        title={`RESTORE TO PRODUCTION: ${selectedApp?.manifest.displayName}`}
        description={`CRITICAL WARNING: This will overwrite the live production SQLite database on WSH for ${selectedApp?.manifest.displayName} using snapshot "${pendingRemoteRestoreArchive?.file_name}" via db-manager.ps1 RestoreRemote.`}
        confirmWord="RESTORE PROD"
        confirmLabel="Overwrite Production Database"
        isProcessing={isApplying}
      />
    </div>
  );
}
