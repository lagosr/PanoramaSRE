import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DiscoveredApp, LocalBackupArchive } from '../../lib/types';
import { CustomSelect } from '../ui/CustomSelect';
import { ConfirmDangerModal } from '../ui/ConfirmDangerModal';

interface LocalBackupHydratorPanelProps {
  apps: DiscoveredApp[];
  onTriggerBackupPull: (app: DiscoveredApp) => void;
  onApplyLocalBackup: (app: DiscoveredApp, archivePath: string) => void;
  isApplying?: boolean;
}

export function LocalBackupHydratorPanel({
  apps,
  onTriggerBackupPull,
  onApplyLocalBackup,
  isApplying = false,
}: LocalBackupHydratorPanelProps) {
  const [selectedAppId, setSelectedAppId] = useState<string>(
    apps[0]?.manifest.appId || ''
  );
  const [archives, setArchives] = useState<LocalBackupArchive[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [pendingApplyArchive, setPendingApplyArchive] = useState<LocalBackupArchive | null>(null);

  // Sync selectedAppId if apps load after initial render
  useEffect(() => {
    if (!selectedAppId && apps.length > 0) {
      setSelectedAppId(apps[0].manifest.appId);
    }
  }, [apps, selectedAppId]);

  const selectedApp = apps.find((a) => a.manifest.appId === selectedAppId) || apps[0];

  useEffect(() => {
    if (!selectedApp) return;

    let isMounted = true;
    setIsLoading(true);

    invoke<{ backup_dir: string; archives: LocalBackupArchive[] }>('scan_local_backups', {
      workspacePath: selectedApp.workspacePath,
    })
      .then((res) => {
        if (isMounted) {
          setArchives(res.archives);
        }
      })
      .catch((err) => {
        console.error('Failed to scan backups:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedApp]);

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const appOptions = apps.map((a) => ({
    value: a.manifest.appId,
    label: `${a.manifest.displayName} (Port ${a.manifest.port})`,
  }));

  const liveSchemaVersion = selectedApp?.devServer?.sqlite_user_version ?? 1;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Interactive Backup-to-Local (ApplyLocal) Hydrator
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Safely stops locking dev processes, extracts remote SQLite snapshots, and restarts local dev.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="w-60">
            <CustomSelect
              value={selectedAppId}
              onChange={setSelectedAppId}
              options={appOptions}
            />
          </div>

          <button
            onClick={() => selectedApp && onTriggerBackupPull(selectedApp)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors whitespace-nowrap shadow-sm"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Pull Fresh Prod Backup
          </button>
        </div>
      </div>

      {/* Archives Table */}
      {isLoading ? (
        <div className="py-12 text-center text-xs text-slate-500">
          Scanning local backup archives...
        </div>
      ) : archives.length === 0 ? (
        <div className="py-12 text-center rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-8">
          <p className="text-sm font-medium text-slate-300">No backup archives found locally</p>
          <p className="text-xs text-slate-500 mt-1">
            Click &quot;Pull Fresh Prod Backup&quot; to download a live snapshot from WSH.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-400 font-mono uppercase text-[10px]">
                <th className="py-3 px-4">Archive Filename</th>
                <th className="py-3 px-4">Backup Date & Time</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Size</th>
                <th className="py-3 px-4">Schema Match</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
              {archives.map((arc) => {
                const isSchemaMatch = arc.schema_version === liveSchemaVersion;
                return (
                  <tr
                    key={arc.file_name}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3 px-4 font-medium text-slate-200">
                      {arc.file_name}
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      {arc.timestamp_str}
                    </td>
                    <td className="py-3 px-4">
                      {arc.is_auto_gfs ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                          AUTO GFS
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">
                          MANUAL
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      {formatBytes(arc.size_bytes)}
                    </td>
                    <td className="py-3 px-4">
                      {isSchemaMatch ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          v{arc.schema_version} MATCH
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          v{arc.schema_version} (DEV v{liveSchemaVersion})
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => setPendingApplyArchive(arc)}
                        disabled={isApplying}
                        className="px-3 py-1 rounded text-xs font-medium bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition-colors"
                      >
                        Apply Local
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmation Modal before ApplyLocal destructive overwrite */}
      <ConfirmDangerModal
        isOpen={pendingApplyArchive !== null}
        title="Apply Local Database Snapshot?"
        description={`Are you sure you want to replace your local development SQLite database for "${selectedApp?.manifest.displayName}" with "${pendingApplyArchive?.file_name}"? Existing local data will be backed up to .bak files before applying.`}
        confirmLabel="Apply & Restart Dev"
        onConfirm={() => {
          if (selectedApp && pendingApplyArchive) {
            onApplyLocalBackup(selectedApp, pendingApplyArchive.full_path);
            setPendingApplyArchive(null);
          }
        }}
        onCancel={() => setPendingApplyArchive(null)}
      />
    </div>
  );
}
