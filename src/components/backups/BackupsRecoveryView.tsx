import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { BackupLedgerSummary, BackupRecord, DiscoveredApp, LocalBackupArchive, GfsTiersBreakdown, BackupScanResult, TerminalTab } from '../../lib/types';
import { formatLocalDate, formatLocalTime, formatLocalIsoDate, formatLocalDateTime } from '../../lib/formatters';
import { CustomSelect } from '../ui/CustomSelect';
import { ConfirmDangerModal } from '../ui/ConfirmDangerModal';
import { SegmentedControl } from '@lagosr/panorama-ui-kit';
import {
  HardDrive,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Archive,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Trash2,
  DownloadCloud,
  Server,
  Laptop,
  Activity,
  FolderOpen,
  ExternalLink,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';

export type BackupsSubTab = 'hydration' | 'history';

interface BackupsRecoveryViewProps {
  apps: DiscoveredApp[];
  ledger: BackupLedgerSummary | null;
  terminalTabs?: TerminalTab[];
  isLoading: boolean;
  onRefresh: () => void;
  onTriggerFullGfsBackup: () => void;
  onTriggerAppBackup: (app: DiscoveredApp) => void;
  onApplyLocalBackup: (app: DiscoveredApp, archivePath: string) => void;
  onRestoreRemoteBackup: (app: DiscoveredApp, archivePath: string) => void;
  onOpenInBottomConsole?: (tabId?: string) => void;
  onAbortJob?: (tabId: string) => void;
  onClearTab?: (tabId: string) => void;
  isApplying?: boolean;
  isInitialSyncComplete?: boolean;
  isIncidentDismissed?: boolean;
  onDismissIncident?: () => void;
}

interface TablePaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  itemName?: string;
}

function TablePagination({
  currentPage,
  totalItems,
  pageSize = 10,
  onPageChange,
  itemName = 'items',
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(totalItems, currentPage * pageSize);

  if (totalItems <= pageSize) {
    return (
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50/50 dark:bg-slate-950/40 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 font-mono">
        <span>Showing all {totalItems} {itemName}</span>
        <span className="text-slate-400">Page 1 of 1</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50/50 dark:bg-slate-950/40 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 font-mono flex-wrap gap-2">
      <div>
        Showing <span className="font-semibold text-slate-900 dark:text-slate-200">{startItem}–{endItem}</span> of <span className="font-semibold text-slate-900 dark:text-slate-200">{totalItems}</span> {itemName}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1 cursor-pointer"
          title="Previous Page"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>Prev</span>
        </button>

        {totalPages <= 6 ? (
          <div className="flex items-center gap-1 px-1 tabular-nums">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
              <button
                key={pageNum}
                onClick={() => onPageChange(pageNum)}
                className={`w-7 h-7 rounded-lg text-xs font-semibold flex items-center justify-center transition-colors cursor-pointer ${
                  pageNum === currentPage
                    ? 'bg-[var(--color-brand)] text-[var(--color-on-brand)] shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                {pageNum}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-xs text-slate-600 dark:text-slate-400 font-medium px-2 tabular-nums">
            Page <span className="font-bold text-slate-900 dark:text-slate-100">{currentPage}</span> of <span className="font-bold text-slate-900 dark:text-slate-100">{totalPages}</span>
          </span>
        )}

        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          className="px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1 cursor-pointer"
          title="Next Page"
        >
          <span>Next</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
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
  isInitialSyncComplete = true,
  isIncidentDismissed = false,
  onDismissIncident,
}: BackupsRecoveryViewProps) {
  // Filter only DietPi WSH applications backed by an operational SQLite database (exclude Cloudflare Pages & headless services)
  const dbApps = apps.filter(
    (a) =>
      a.manifest.hasDatabase !== false &&
      a.manifest.hostingTarget !== 'cloudflare-pages' &&
      a.manifest.hostingTarget !== 'wsh-docker-service'
  );
  const [activeTab, setActiveTab] = useState<BackupsSubTab>('hydration');
  const [expandedRunIdx, setExpandedRunIdx] = useState<number | null>(0);
  const [selectedAppId, setSelectedAppId] = useState<string>(dbApps[0]?.manifest.appId || '');
  const [archives, setArchives] = useState<LocalBackupArchive[]>([]);
  const [selectedArchiveName, setSelectedArchiveName] = useState<string | null>(null);
  const [gfsBreakdown, setGfsBreakdown] = useState<GfsTiersBreakdown | null>(null);
  const [suiteRetentionMap, setSuiteRetentionMap] = useState<Record<string, GfsTiersBreakdown>>({});
  const [carouselIndex, setCarouselIndex] = useState<number>(0);
  const [isScanningArchives, setIsScanningArchives] = useState<boolean>(false);
  const [backupDir, setBackupDir] = useState<string>('');

  // Target archive modals
  const [pendingLocalApplyArchive, setPendingLocalApplyArchive] = useState<LocalBackupArchive | null>(null);
  const [pendingRemoteRestoreArchive, setPendingRemoteRestoreArchive] = useState<LocalBackupArchive | null>(null);

  // Table Pagination States (Max 10 rows per page)
  const [archivesPage, setArchivesPage] = useState<number>(1);
  const [historyPage, setHistoryPage] = useState<number>(1);
  const PAGE_SIZE = 10;

  useEffect(() => {
    if (archives.length === 0) {
      setSelectedArchiveName(null);
      return;
    }
    if (!selectedArchiveName || !archives.some((a) => a.file_name === selectedArchiveName)) {
      setSelectedArchiveName(archives[0].file_name);
    }
  }, [archives, selectedArchiveName]);

  // Reset archives pagination when switching apps
  useEffect(() => {
    setArchivesPage(1);
  }, [selectedAppId]);

  // Sync selectedAppId if apps populate
  useEffect(() => {
    if (!selectedAppId && dbApps.length > 0) {
      setSelectedAppId(dbApps[0].manifest.appId);
    }
  }, [dbApps, selectedAppId]);

  const selectedApp = dbApps.find((a) => a.manifest.appId === selectedAppId) || dbApps[0];

  // Carousel items: all dbApps plus an All Databases Suite Total slide
  const carouselItems = [
    ...dbApps.map((a) => ({
      id: a.manifest.appId,
      displayName: a.manifest.displayName,
      port: a.manifest.port,
      isSuiteTotal: false,
    })),
    {
      id: '__suite_total__',
      displayName: 'All Databases (Suite Total)',
      port: undefined,
      isSuiteTotal: true,
    },
  ];

  // Keep carousel index aligned with dropdown selection
  useEffect(() => {
    const idx = carouselItems.findIndex((item) => item.id === selectedAppId);
    if (idx !== -1) {
      setCarouselIndex(idx);
    }
  }, [selectedAppId]);

  // Scan archives for selected app AND all other dbApps in parallel
  const scanAllArchives = () => {
    if (!selectedApp) return;
    setIsScanningArchives(true);

    invoke<BackupScanResult>('scan_local_backups', {
      workspacePath: selectedApp.workspacePath,
    })
      .then((res) => {
        setArchives(res.archives);
        setBackupDir(res.backup_dir);
        setGfsBreakdown(res.gfs_breakdown);
        setSuiteRetentionMap((prev) => ({
          ...prev,
          [selectedApp.manifest.appId]: res.gfs_breakdown,
        }));
      })
      .catch((err) => {
        console.error('[PanoramaSRE] Failed to scan archives for active app:', err);
      })
      .finally(() => {
        setIsScanningArchives(false);
      });

    // Concurrently fetch breakdown for all other dbApps in background
    Promise.all(
      dbApps
        .filter((a) => a.manifest.appId !== selectedApp.manifest.appId)
        .map(async (app) => {
          try {
            const res = await invoke<BackupScanResult>('scan_local_backups', {
              workspacePath: app.workspacePath,
            });
            return { id: app.manifest.appId, breakdown: res.gfs_breakdown };
          } catch {
            return null;
          }
        })
    ).then((results) => {
      const map: Record<string, GfsTiersBreakdown> = {};
      results.forEach((r) => {
        if (r) map[r.id] = r.breakdown;
      });
      setSuiteRetentionMap((prev) => ({ ...prev, ...map }));
    });
  };

  useEffect(() => {
    scanAllArchives();
  }, [selectedApp?.manifest.appId, ledger]);

  const handlePrevApp = () => {
    if (carouselItems.length === 0) return;
    const newIdx = (carouselIndex - 1 + carouselItems.length) % carouselItems.length;
    setCarouselIndex(newIdx);
    const target = carouselItems[newIdx];
    if (target && !target.isSuiteTotal) {
      setSelectedAppId(target.id);
    }
  };

  const handleNextApp = () => {
    if (carouselItems.length === 0) return;
    const newIdx = (carouselIndex + 1) % carouselItems.length;
    setCarouselIndex(newIdx);
    const target = carouselItems[newIdx];
    if (target && !target.isSuiteTotal) {
      setSelectedAppId(target.id);
    }
  };

  const currentSlide = carouselItems[carouselIndex] || carouselItems[0];
  const suiteTotalBreakdown: GfsTiersBreakdown = Object.values(suiteRetentionMap).reduce(
    (acc, val) => ({
      daily_count: acc.daily_count + val.daily_count,
      weekly_count: acc.weekly_count + val.weekly_count,
      monthly_count: acc.monthly_count + val.monthly_count,
      total_archives: acc.total_archives + val.total_archives,
    }),
    { daily_count: 0, weekly_count: 0, monthly_count: 0, total_archives: 0 }
  );

  const currentBreakdown: GfsTiersBreakdown = currentSlide?.isSuiteTotal
    ? suiteTotalBreakdown
    : (suiteRetentionMap[currentSlide?.id] || (currentSlide?.id === selectedAppId ? gfsBreakdown : null) || {
        daily_count: 0,
        weekly_count: 0,
        monthly_count: 0,
        total_archives: 0,
      });

  const currentPrunedCount: number = currentSlide?.isSuiteTotal
    ? (ledger?.total_pruned_count || 0)
    : (ledger?.pruned_per_app?.[currentSlide?.displayName] || 0);

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

  const historyRecords = ledger?.recent_records || [];
  const selectedArchive =
    archives.find((a) => a.file_name === selectedArchiveName) || archives[0] || null;

  // Clamp pagination pages if data length changes
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(archives.length / PAGE_SIZE));
    if (archivesPage > maxPage) setArchivesPage(maxPage);
  }, [archives.length, archivesPage]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(historyRecords.length / PAGE_SIZE));
    if (historyPage > maxPage) setHistoryPage(maxPage);
  }, [historyRecords.length, historyPage]);

  // Sliced data for tables (capped to 10 rows max per page)
  const paginatedArchives = archives.slice(
    (archivesPage - 1) * PAGE_SIZE,
    archivesPage * PAGE_SIZE
  );
  const paginatedHistory = historyRecords.slice(
    (historyPage - 1) * PAGE_SIZE,
    historyPage * PAGE_SIZE
  );

  const appOptions = dbApps.map((a) => ({
    value: a.manifest.appId,
    label: `${a.manifest.displayName} (Port ${a.manifest.port})`,
  }));

  const liveSchemaVersion = selectedApp?.devServer?.sqlite_user_version ?? 1;

  return (
    <div className="p-6 w-full min-w-0 max-w-[1920px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 tracking-tight">
            <HardDrive className="w-5 h-5 text-[var(--color-brand-text)] shrink-0" />
            <span className="truncate">Database Backups &amp; Disaster Recovery</span>
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 line-clamp-1 sm:line-clamp-none">
            Single control plane to inspect SQLite database snapshots, trigger automated GFS runs, and hydrate data across environments
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap shrink-0">
          <button
            onClick={() => {
              onRefresh();
              scanAllArchives();
            }}
            disabled={isLoading || isScanningArchives}
            className="btn-secondary text-xs flex items-center gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading || isScanningArchives ? 'animate-spin' : ''}`} />
            Refresh All
          </button>
          <button
            onClick={onTriggerFullGfsBackup}
            className="btn-primary text-xs flex items-center gap-2"
          >
            <Archive className="w-3.5 h-3.5" />
            Trigger Full GFS DB Backup
          </button>
        </div>
      </div>

      {/* Critical Automated Backup Incident Alert Banner */}
      {isInitialSyncComplete && !isIncidentDismissed && (ledger?.last_run_status?.toLowerCase() === 'failed' || (ledger?.failed_runs_7d || 0) > 0) && (() => {
        const isLastFailed = ledger?.last_run_status?.toLowerCase() === 'failed';
        const dailyPips = ledger?.daily_pips_7d || [];
        const todayPip = dailyPips.length > 0 ? dailyPips[dailyPips.length - 1] : undefined;
        const todayAlreadySucceeded = todayPip?.status === 'Success' && !isLastFailed;
        const isActionableNow = isLastFailed || (todayPip !== undefined && todayPip.status !== 'Success');
        const missedOrFailedDays = dailyPips.filter((p) => p.status !== 'Success');
        return (
          <div className="rounded-2xl border border-rose-300 dark:border-rose-500/80 bg-rose-50 dark:bg-rose-950/40 p-5 shadow-sm ring-1 ring-rose-500/30 space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start sm:items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/40 flex items-center justify-center shrink-0">
                  <XCircle className="w-6 h-6 text-rose-600 dark:text-rose-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-rose-700 dark:bg-rose-600 text-white uppercase tracking-wider">
                      {isActionableNow ? 'CRITICAL DR INCIDENT' : '7-DAY SLA GAP'}
                    </span>
                    <span className="text-xs text-rose-700 dark:text-rose-400 font-mono tabular-nums">
                      {isLastFailed
                        ? (ledger?.last_run_timestamp ? formatLocalDateTime(ledger.last_run_timestamp) : 'Latest Automated Run')
                        : '7-Day Rolling GFS Window'}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-rose-900 dark:text-rose-100 mt-1">
                    {isLastFailed
                      ? 'Automated Database Backup Run Failed'
                      : `Missed or Failed Daily Backup Run (${ledger?.failed_runs_7d} of ${ledger?.runs_7d || 7} Days Failed)`}
                  </h3>
                  <p className="text-xs text-rose-800 dark:text-rose-300 mt-0.5">
                    {isLastFailed
                      ? 'The automated nightly database backup run failed. Immediate remediation is required to ensure database snapshot integrity.'
                      : todayAlreadySucceeded
                      ? `A past scheduled daily GFS run was missed, but today's snapshot (${todayPip?.date}) has already succeeded. Running another backup today will not backfill a past calendar date.`
                      : 'Today\'s scheduled daily GFS backup has not completed yet. Run the backup now to protect today\'s database snapshots.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">
                {isActionableNow ? (
                  <button
                    onClick={onTriggerFullGfsBackup}
                    disabled={isLoading}
                    className="btn-danger text-xs flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                    <span>{isLastFailed ? 'Retry Full GFS Backup Now' : 'Run Today\'s GFS Backup Now'}</span>
                  </button>
                ) : (
                  <span
                    className="px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 whitespace-nowrap flex items-center gap-1.5 tabular-nums"
                    title="Today's GFS backup snapshot is already captured and verified. No manual backup action is needed today."
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Today&apos;s Snapshot Verified ({todayPip?.date}) • No Action Needed</span>
                  </span>
                )}
                {onDismissIncident && (
                  <button
                    onClick={onDismissIncident}
                    className="px-3 py-2 min-h-[36px] rounded-xl text-xs font-semibold bg-white dark:bg-slate-900 hover:bg-rose-50 dark:hover:bg-slate-800 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-700/70 transition-all whitespace-nowrap flex-shrink-0 cursor-pointer"
                    title="Dismiss this backup incident from the UI until a new failure occurs"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </div>

            {/* Root cause and failure details */}
            <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 text-xs font-mono space-y-2">
              <div className="flex items-center gap-2 text-rose-800 dark:text-rose-300 font-semibold">
                <AlertTriangle className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
                <span className="text-slate-900 dark:text-white">Failure Root Cause Diagnosis:</span>
                <span className="text-rose-900 dark:text-rose-200 font-normal">
                  {isLastFailed
                    ? 'Automated night backup job failed during remote execution.'
                    : `Daily scheduled backup missed or failed on: ${missedOrFailedDays.map((d) => `${d.day_label} (${d.date}: ${d.status === 'NoRun' ? 'Missed Run' : 'Failed'})`).join(', ')}.${todayAlreadySucceeded ? ' Past window has elapsed; current state is protected.' : ''}`}
                </span>
              </div>

              {isLastFailed && ledger.latest_app_details.some((a) => a.status.toLowerCase() === 'failed') && (
                <div className="space-y-1.5 pt-1 border-t border-rose-200 dark:border-rose-900/50">
                  <p className="text-[11px] font-semibold text-rose-800 dark:text-rose-300 uppercase tracking-wider">Failed Application Details:</p>
                  {ledger.latest_app_details.filter((a) => a.status.toLowerCase() === 'failed').map((app) => (
                    <div key={app.app_name} className="text-[11px] bg-rose-100/80 dark:bg-rose-950/40 p-2 rounded-lg border border-rose-200 dark:border-rose-900/40">
                      <span className="font-semibold text-rose-900 dark:text-rose-200">{app.app_name}: </span>
                      <span className="text-slate-700 dark:text-slate-300 break-all">{app.error || 'Execution failed with exit code 1'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-4">
        {/* Card 1: 7-Day Backup Reliability */}
        <div className={`rounded-2xl border p-4 shadow-sm transition-all flex flex-col justify-between min-h-[175px] ${
          (ledger?.failed_runs_7d || 0) > 0
            ? 'border-rose-300 dark:border-rose-500/60 bg-rose-50 dark:bg-rose-950/20'
            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
        }`}>
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider truncate">7-Day Reliability</p>
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 tabular-nums ${
                (ledger?.failed_runs_7d || 0) > 0
                  ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/30'
                  : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
              }`}>
                {(ledger?.failed_runs_7d || 0) === 0 ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <AlertTriangle className="w-3 h-3 shrink-0" />}
                <span>{(ledger?.failed_runs_7d || 0) === 0 ? 'Healthy' : `${ledger?.failed_runs_7d} Failed`}</span>
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className={`text-2xl font-bold font-mono tabular-nums ${
                (ledger?.failed_runs_7d || 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
              }`}>
                {ledger?.runs_7d ? `${Math.round(((ledger.successful_runs_7d || 0) / ledger.runs_7d) * 100)}%` : '100%'}
              </span>
              <span className="text-xs text-slate-600 dark:text-slate-400 font-mono truncate tabular-nums">
                ({ledger?.successful_runs_7d || 0}/{ledger?.runs_7d || 0} runs)
              </span>
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 shrink-0">
              {ledger?.daily_pips_7d && ledger.daily_pips_7d.length > 0 ? (
                ledger.daily_pips_7d.map((pip) => (
                  <div
                    key={pip.date}
                    title={`${pip.day_label} (${pip.date}): ${pip.status === 'Success' ? 'Successful GFS Run' : pip.status === 'Failed' ? 'Failed GFS Run' : 'Missed GFS Run (Failed)'}`}
                    className="flex flex-col items-center gap-0.5 group cursor-default"
                  >
                    <span className={`w-2.5 h-2.5 rounded-full transition-transform group-hover:scale-125 ${
                      pip.status === 'Success'
                        ? 'bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.4)]'
                        : 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.4)]'
                    }`} />
                    <span className={`text-[9px] font-mono leading-none ${pip.status === 'Success' ? 'text-slate-500 dark:text-slate-400' : 'text-rose-600 dark:text-rose-400 font-bold'}`}>{pip.day_label[0]}</span>
                  </div>
                ))
              ) : (
                <span className="text-[11px] text-slate-500 dark:text-slate-400">No recent runs</span>
              )}
            </div>
            <span className="text-[11px] text-slate-600 dark:text-slate-400 font-mono text-right whitespace-nowrap shrink-0 tabular-nums">
              {(ledger?.failed_runs_7d || 0) > 0
                ? `${ledger?.failed_runs_7d} failed`
                : '0 failed'}
            </span>
          </div>
        </div>

        {/* Card 2: On-Disk GFS Retention Tiers with App Carousel */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm flex flex-col justify-between min-h-[175px]">
          <div>
            {/* Top row: Title and Carousel < 1/6 > Controls */}
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider truncate">GFS Retention</p>
              
              <div className="flex items-center gap-1 shrink-0 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700">
                <button
                  onClick={handlePrevApp}
                  title="Previous application"
                  className="p-1.5 rounded hover:bg-white dark:hover:bg-slate-700 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-mono font-semibold px-1 text-slate-700 dark:text-slate-300 select-none tabular-nums">
                  {carouselIndex + 1}/{carouselItems.length}
                </span>
                <button
                  onClick={handleNextApp}
                  title="Next application"
                  className="p-1.5 rounded hover:bg-white dark:hover:bg-slate-700 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Dedicated App Name Bar with full prominence */}
            <div className="flex items-center gap-1.5 min-w-0 mt-2">
              <span className={`w-2 h-2 rounded-full shrink-0 ${currentSlide?.isSuiteTotal ? 'bg-sky-500' : 'bg-[var(--color-brand)]'}`} />
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate font-mono" title={currentSlide?.displayName}>
                {currentSlide?.displayName}
              </span>
              {currentSlide?.port && (
                <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 shrink-0 tabular-nums">
                  :{currentSlide.port}
                </span>
              )}
            </div>

            {/* Active Snapshots Counter */}
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100 tabular-nums">
                {currentBreakdown.total_archives}
              </span>
              <span className="text-xs text-slate-600 dark:text-slate-400 font-mono truncate">active archives</span>
            </div>
          </div>

          {/* 3 Tier Boxes with Perfect Vertical Alignment */}
          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <div className="grid grid-cols-3 gap-1.5 text-center font-mono">
              {/* Daily Box */}
              <div className="bg-slate-50 dark:bg-slate-950 py-1.5 px-1 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col justify-between min-w-0">
                <div>
                  <span className="block text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-tight truncate leading-none">Daily</span>
                  <span className="block text-[9px] text-slate-500 dark:text-slate-400 leading-none mt-1">&le;7d</span>
                </div>
                <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">
                  {currentBreakdown.daily_count}
                </span>
              </div>

              {/* Weekly Box */}
              <div className="bg-slate-50 dark:bg-slate-950 py-1.5 px-1 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col justify-between min-w-0">
                <div>
                  <span className="block text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-tight truncate leading-none">Weekly</span>
                  <span className="block text-[9px] text-slate-500 dark:text-slate-400 leading-none mt-1">&le;30d</span>
                </div>
                <span className="text-sm font-bold text-sky-700 dark:text-sky-400 mt-1 tabular-nums">
                  {currentBreakdown.weekly_count}
                </span>
              </div>

              {/* Monthly Box */}
              <div className="bg-slate-50 dark:bg-slate-950 py-1.5 px-1 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col justify-between min-w-0">
                <div>
                  <span className="block text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-tight truncate leading-none">Monthly</span>
                  <span className="block text-[9px] text-slate-500 dark:text-slate-400 leading-none mt-1">&gt;30d</span>
                </div>
                <span className="text-sm font-bold text-violet-700 dark:text-violet-400 mt-1 tabular-nums">
                  {currentBreakdown.monthly_count}
                </span>
              </div>
            </div>

            {/* Bottom Pruned Counter */}
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-600 dark:text-slate-400">
              <span className="truncate flex items-center gap-1 tabular-nums">
                <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{currentPrunedCount}</span> pruned
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0">
                {currentSlide?.isSuiteTotal ? 'Suite' : 'Active'}
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: Last Automated GFS Run */}
        <div className={`rounded-2xl border p-4 shadow-sm transition-all flex flex-col justify-between min-h-[175px] ${
          ledger?.last_run_status === 'Failed'
            ? 'border-rose-300 dark:border-rose-500/60 bg-rose-50 dark:bg-rose-950/20'
            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
        }`}>
          <div>
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider truncate">Latest GFS Run</p>
            <div className="mt-2">
              <p className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono leading-tight tabular-nums">
                {ledger?.last_run_timestamp ? formatLocalDate(ledger.last_run_timestamp) : 'Never'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5 tabular-nums">
                {ledger?.last_run_timestamp ? formatLocalTime(ledger.last_run_timestamp) : ''}
              </p>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-1 text-[11px] font-mono">
            <div className="flex items-center gap-1.5 shrink-0">
              {ledger?.last_run_status === 'Success' ? (
                <span className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Success
                </span>
              ) : ledger?.last_run_status === 'Failed' ? (
                <span className="text-rose-700 dark:text-rose-400 font-bold flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5 shrink-0 text-rose-600 dark:text-rose-500" /> Failed
                </span>
              ) : (
                <span className="text-slate-600 dark:text-slate-400 font-semibold">
                  {ledger?.last_run_status || 'Pending'}
                </span>
              )}
            </div>
            <span className="text-slate-600 dark:text-slate-400 whitespace-nowrap shrink-0 tabular-nums">
              {ledger?.latest_app_details?.length || 0} Apps Protected
            </span>
          </div>
        </div>

        {/* Card 4: Lifetime Execution Ledger */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm flex flex-col justify-between min-h-[175px]">
          <div>
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider truncate">Lifetime Ledger</p>
            <div className="flex items-baseline gap-1.5 mt-2">
              <span className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 tabular-nums">
                {ledger?.total_runs || 0}
              </span>
              <span className="text-xs text-slate-600 dark:text-slate-400 font-mono">total runs</span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-1 text-[11px] font-mono">
            <div className="flex items-center gap-2 shrink-0 tabular-nums">
              <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{ledger?.successful_runs || 0} OK</span>
              <span className="text-slate-400">•</span>
              <span className="text-slate-600 dark:text-slate-400" title="Historical retries / remediated failures">
                {ledger?.failed_runs || 0} Past
              </span>
            </div>
            <button
              onClick={async () => {
                if (ledger?.ledger_source_path) {
                  try {
                    await revealItemInDir(ledger.ledger_source_path);
                  } catch (err) {
                    console.warn('Failed to reveal ledger file:', err);
                  }
                }
              }}
              disabled={!ledger?.ledger_source_path}
              className="text-slate-600 dark:text-slate-400 hover:text-[var(--color-brand-text)] hover:underline cursor-pointer flex items-center gap-1 shrink-0 disabled:cursor-default"
              title={`Click to reveal ledger in folder: ${ledger?.ledger_source_path || ''}`}
            >
              <span>History</span>
              <ExternalLink className="w-2.5 h-2.5 shrink-0 text-slate-500" />
            </button>
          </div>
        </div>
      </div>

      {/* Clean 2-Tab Navigation Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<BackupsSubTab>
          activeVariant="brand"
          value={activeTab}
          onChange={setActiveTab}
          options={[
            {
              value: 'hydration',
              label: 'Snapshot & Hydration Engine',
              badge: <span className="tabular-nums font-mono">{archives.length}</span>,
            },
            {
              value: 'history',
              label: 'GFS Schedule & Run History',
              badge: <span className="tabular-nums font-mono">{historyRecords.length}</span>,
            },
          ]}
        />
      </div>

      {/* TAB 1: SNAPSHOT & HYDRATION ENGINE */}
      {activeTab === 'hydration' && (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-sm space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Laptop className="w-5 h-5 text-[var(--color-brand-text)] shrink-0" />
              <span>SQLite Database Snapshot & Hydration Engine</span>
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Select a database-backed application to inspect its available SQLite archives (.tar.gz) and restore data to Local Dev or Production (binaries and source code remain in Git).
            </p>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full lg:w-auto shrink-0">
            <div className="w-full sm:w-64 min-w-[200px]">
              <CustomSelect
                value={selectedAppId}
                onChange={setSelectedAppId}
                options={appOptions}
              />
            </div>

            <button
              onClick={() => selectedApp && onTriggerAppBackup(selectedApp)}
              className="btn-secondary text-xs flex items-center gap-2 shrink-0"
            >
              <DownloadCloud className="w-3.5 h-3.5 text-[var(--color-brand-text)]" />
              Capture Remote Snapshot
            </button>
          </div>
        </div>

        {/* Directory & Environment Banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 font-mono">
          <button
            onClick={async () => {
              if (backupDir) {
                try {
                  await invoke('open_in_file_manager', { path: backupDir });
                } catch (invokeErr) {
                  console.warn('Native open_in_file_manager failed, falling back to openPath:', invokeErr);
                  try {
                    await openPath(backupDir);
                  } catch (err) {
                    console.error('Failed to open backup directory:', err);
                  }
                }
              }
            }}
            disabled={!backupDir}
            className="flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:text-[var(--color-brand-text)] transition-colors group cursor-pointer truncate max-w-xl text-left disabled:cursor-default"
            title="Click to open directory in File Explorer"
          >
            <FolderOpen className="w-4 h-4 text-[var(--color-brand-text)] shrink-0 group-hover:scale-110 transition-transform" />
            <span className="text-slate-900 dark:text-slate-100 font-semibold shrink-0">Backup Directory:</span>
            <span className="truncate underline decoration-dotted decoration-slate-400 dark:decoration-slate-600 underline-offset-4 group-hover:decoration-[var(--color-brand)]">
              {backupDir || 'Resolving...'}
            </span>
            <ExternalLink className="w-3.5 h-3.5 text-slate-500 shrink-0 group-hover:text-[var(--color-brand-text)]" />
          </button>
          <div className="flex items-center gap-4 text-slate-600 dark:text-slate-400 tabular-nums">
            <span>
              Local SQLite PRAGMA:{' '}
              <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                {selectedApp?.devServer?.sqlite_user_version !== undefined && selectedApp?.devServer?.sqlite_user_version !== null
                  ? `v${selectedApp.devServer.sqlite_user_version}`
                  : 'N/A'}
              </span>
            </span>
            <span>
              Archives Found: <span className="text-slate-900 dark:text-slate-100 font-bold">{archives.length}</span>
            </span>
          </div>
        </div>

        {/* Pre-Restore Safety Comparison Strip (Selected Snapshot vs Live Target DB) */}
        {selectedArchive && selectedApp && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center text-xs tabular-nums">
            <div className="lg:col-span-5 space-y-1 min-w-0">
              <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Selected Snapshot Artifact
              </div>
              <div className="font-mono font-bold text-slate-900 dark:text-slate-100 truncate" title={selectedArchive.file_name}>
                {selectedArchive.file_name}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                <span>{formatLocalDateTime(selectedArchive.timestamp_str)}</span>
                <span>•</span>
                <span>{formatBytes(selectedArchive.size_bytes)}</span>
                <span>•</span>
                <span>Tier: {selectedArchive.gfs_tier || 'Daily'}</span>
                <span>•</span>
                <span>Schema v{selectedArchive.schema_version}</span>
              </div>
            </div>

            <div className="lg:col-span-4 space-y-1 min-w-0 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 pt-2.5 lg:pt-0 lg:pl-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Live Target Comparison
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                    selectedArchive.schema_version === liveSchemaVersion
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
                  }`}
                >
                  {selectedArchive.schema_version === liveSchemaVersion ? 'Schema Match' : 'Schema Mismatch'}
                </span>
              </div>
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                {selectedApp.manifest.displayName}{' '}
                <span className="font-mono text-[11px] font-normal text-slate-500">
                  (:{selectedApp.manifest.port})
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                <span>
                  Local DB:{' '}
                  {selectedApp.devServer?.sqlite_size_bytes
                    ? formatBytes(selectedApp.devServer.sqlite_size_bytes)
                    : 'Not probed'}
                </span>
                <span>•</span>
                <span>Local PRAGMA v{liveSchemaVersion}</span>
              </div>
            </div>

            <div className="lg:col-span-3 flex flex-col sm:flex-row lg:flex-col xl:flex-row items-stretch sm:items-center lg:items-stretch xl:items-center justify-end gap-2 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 pt-2.5 lg:pt-0 lg:pl-4">
              <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 flex items-center gap-1 xl:hidden">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>.bak created locally; PROD typed gate</span>
              </div>
              <button
                type="button"
                onClick={() => setPendingLocalApplyArchive(selectedArchive)}
                disabled={isApplying}
                className="btn-primary text-xs flex items-center justify-center gap-1 whitespace-nowrap flex-shrink-0"
              >
                <Laptop className="w-3.5 h-3.5" />
                <span>Apply Local</span>
              </button>
              <button
                type="button"
                onClick={() => setPendingRemoteRestoreArchive(selectedArchive)}
                disabled={isApplying}
                className="btn-danger text-xs flex items-center justify-center gap-1 whitespace-nowrap flex-shrink-0"
              >
                <Server className="w-3.5 h-3.5" />
                <span>Restore Prod</span>
              </button>
            </div>
          </div>
        )}

        {/* Archives Table with Date column & Dual Apply Options */}
        {isScanningArchives ? (
          <div className="flex flex-col items-center justify-center py-12 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 space-y-3">
            <RefreshCw className="w-6 h-6 animate-spin text-[var(--color-brand-text)]" />
            <p className="text-xs font-mono font-medium">Scanning backup archives for {selectedApp?.manifest.displayName}...</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Checking Google Drive storage and archive health snapshots</p>
          </div>
        ) : archives.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-slate-600 dark:text-slate-400 text-xs font-mono">
            No backup archives (.tar.gz) found for this application.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs font-mono min-w-[700px]">
              <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">Date of Backup</th>
                  <th className="py-2.5 px-3 font-semibold">Archive Filename</th>
                  <th className="py-2.5 px-3 font-semibold">GFS Tier</th>
                  <th className="py-2.5 px-3 font-semibold">Schema</th>
                  <th className="py-2.5 px-3 font-semibold">Size</th>
                  <th className="py-2.5 px-3 font-semibold">Verified Health</th>
                  <th className="py-2.5 px-3 text-right font-semibold">Hydration Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedArchives.map((archive) => {
                  const isSchemaMismatch = archive.schema_version !== liveSchemaVersion;
                  const health = archive.health_snapshot;
                  const isHealthy = health?.status === 'healthy';

                  const isSelectedArchive = selectedArchive?.file_name === archive.file_name;

                  return (
                    <tr
                      key={archive.file_name}
                      onClick={() => setSelectedArchiveName(archive.file_name)}
                      className={`cursor-pointer transition-colors ${
                        isSelectedArchive
                          ? 'bg-[var(--color-brand-subtle)]/40 hover:bg-[var(--color-brand-subtle)]/60'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      {/* Date of Backup Column (Local Time) */}
                      <td className="py-3 px-3 text-slate-900 dark:text-slate-200 font-semibold whitespace-nowrap tabular-nums">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400"></span>
                          <span>{formatLocalIsoDate(archive.timestamp_str)}</span>
                        </div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal block pl-3">
                          {formatLocalTime(archive.timestamp_str)}
                        </span>
                      </td>

                      {/* Archive Filename with Reveal in Explorer */}
                      <td className="py-3 px-3 text-slate-700 dark:text-slate-300 max-w-xs">
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await revealItemInDir(archive.full_path);
                            } catch (err) {
                              console.warn('Failed to reveal archive file:', err);
                            }
                          }}
                          className="truncate block hover:text-[var(--color-brand-text)] hover:underline cursor-pointer text-left w-full"
                          title={`Click to reveal file in folder: ${archive.full_path}`}
                        >
                          {archive.file_name}
                        </button>
                      </td>

                      {/* GFS Tier Column */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold font-mono ${
                            archive.gfs_tier === 'Daily'
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                              : archive.gfs_tier === 'Weekly'
                              ? 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/30'
                              : 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border border-violet-500/30'
                          }`}
                        >
                          {archive.gfs_tier || 'Daily'}
                        </span>
                      </td>

                      {/* Schema Version */}
                      <td className="py-3 px-3 whitespace-nowrap tabular-nums">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                            isSchemaMismatch
                              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          v{archive.schema_version}
                        </span>
                      </td>

                      {/* Size */}
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-400 font-mono whitespace-nowrap tabular-nums">{formatBytes(archive.size_bytes)}</td>

                      {/* Health Snapshot */}
                      <td className="py-3 px-3 whitespace-nowrap tabular-nums">
                        {health ? (
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                isHealthy
                                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                                  : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/30'
                              }`}
                            >
                              <Activity className="w-3 h-3" />
                              {String(health.version || 'v?')} ({String(health.status || 'unknown')})
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-500 text-[11px] italic">No snapshot</span>
                        )}
                      </td>

                      {/* Actions: Apply to Local OR Restore to Production */}
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-2 flex-nowrap">
                          {/* Apply to Local Dev */}
                          <button
                            onClick={() => setPendingLocalApplyArchive(archive)}
                            disabled={isApplying}
                            className="btn-primary text-xs flex items-center gap-1"
                            title="Extract snapshot to local development SQLite database"
                          >
                            <Laptop className="w-3.5 h-3.5" />
                            Apply to Local Dev
                          </button>

                          {/* Restore to Remote Production */}
                          <button
                            onClick={() => setPendingRemoteRestoreArchive(archive)}
                            disabled={isApplying}
                            className="btn-danger text-xs flex items-center gap-1"
                            title="Upload and restore archive directly into production container"
                          >
                            <Server className="w-3.5 h-3.5" />
                            Restore to Production
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {/* Fixed-height stabilization spacer rows when table paginates */}
                {archives.length > PAGE_SIZE && Array.from({ length: Math.max(0, PAGE_SIZE - paginatedArchives.length) }).map((_, i) => (
                  <tr key={`spacer-arch-${i}`} className="pointer-events-none select-none invisible" aria-hidden="true">
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full"></span>
                        <span>0000-00-00</span>
                      </div>
                      <span className="text-[10px] block pl-3">00:00:00 AM</span>
                    </td>
                    <td className="py-3 px-3 max-w-xs truncate">spacer-placeholder.tar.gz</td>
                    <td className="py-3 px-3 whitespace-nowrap"><span className="inline-block px-2 py-0.5 rounded text-[10px]">Daily</span></td>
                    <td className="py-3 px-3 whitespace-nowrap"><span className="inline-block px-2 py-0.5 rounded text-[11px]">v0</span></td>
                    <td className="py-3 px-3 whitespace-nowrap font-mono">000.0 KB</td>
                    <td className="py-3 px-3 whitespace-nowrap"><span className="inline-flex items-center px-1.5 py-0.5 text-[10px]">v0 (healthy)</span></td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="px-2.5 py-1 text-xs">Apply to Local Dev</span>
                        <span className="px-2.5 py-1 text-xs">Restore to Production</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination
              currentPage={archivesPage}
              totalItems={archives.length}
              pageSize={PAGE_SIZE}
              onPageChange={setArchivesPage}
              itemName="archives"
            />
          </div>
        )}
      </div>
      )}

      {/* TAB 2: UNIFIED GFS SCHEDULE & RUN HISTORY LEDGER (Latest Run Pre-Expanded) */}
      {activeTab === 'history' && (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
              GFS Automated Database Backup Runs &amp; Retention History
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Expand any run to inspect per-application archive status, duration, error diagnostics, and GFS pruning logs (latest run pre-expanded).
            </p>
          </div>
          <span className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
            {ledger?.latest_app_details?.length || 0} Registered Databases
          </span>
        </div>

        {(!ledger?.recent_records || ledger.recent_records.length === 0) ? (
          <div className="text-center py-8 text-xs text-slate-600 dark:text-slate-400 font-mono">
            No backup history ledger found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs font-mono min-w-[700px]">
              <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-3 w-8"></th>
                  <th className="py-2.5 px-3 font-semibold">Date of Backup</th>
                  <th className="py-2.5 px-3 font-semibold">Time (Local)</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 px-3 font-semibold">Type</th>
                  <th className="py-2.5 px-3 font-semibold">Databases Covered</th>
                  <th className="py-2.5 px-3 font-semibold">Total Archive Size</th>
                  <th className="py-2.5 px-3 font-semibold">Destination</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedHistory.map((r: BackupRecord, idx: number) => {
                  const globalIdx = (historyPage - 1) * PAGE_SIZE + idx;
                  const isExpanded = expandedRunIdx === globalIdx;
                  const hasDetails = (r.app_details && r.app_details.length > 0) || (r.pruned_files && Object.keys(r.pruned_files).length > 0);
                  const dateOnly = formatLocalIsoDate(r.timestamp);
                  const timeOnly = formatLocalTime(r.timestamp);

                  return (
                    <React.Fragment key={r.timestamp ? `${r.timestamp}_${globalIdx}` : globalIdx}>
                      <tr
                        onClick={() => hasDetails && toggleRunExpand(globalIdx)}
                        className={`transition-colors ${
                          hasDetails ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40' : ''
                        } ${isExpanded ? 'bg-slate-100 dark:bg-slate-800/60' : ''}`}
                      >
                        <td className="py-3 px-3 text-slate-500 text-center">
                          {hasDetails ? (
                            isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-[var(--color-brand-text)] inline" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 inline text-slate-500 dark:text-slate-400" />
                            )
                          ) : null}
                        </td>
                        <td className="py-3 px-3 text-slate-800 dark:text-slate-200 font-medium whitespace-nowrap tabular-nums">{dateOnly}</td>
                        <td className="py-3 px-3 text-slate-600 dark:text-slate-400 font-mono whitespace-nowrap tabular-nums">{timeOnly}</td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          {r.status === 'Success' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                              <CheckCircle2 className="w-3 h-3" /> Success
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/30">
                              <XCircle className="w-3 h-3" /> Failed
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{r.run_type || 'Automated'}</td>
                        <td className="py-3 px-3 text-slate-800 dark:text-slate-300 whitespace-nowrap font-semibold tabular-nums">{r.total_apps} apps</td>
                        <td className="py-3 px-3 text-slate-600 dark:text-slate-400 font-mono whitespace-nowrap tabular-nums">{formatBytes(r.total_size_bytes)}</td>
                        <td className="py-3 px-3 text-slate-600 dark:text-slate-400 truncate max-w-xs">{r.destination}</td>
                      </tr>

                      {/* Collapsible Details Row */}
                      {isExpanded && (
                        <tr className="bg-slate-50 dark:bg-slate-950 border-t border-b border-slate-200 dark:border-slate-800">
                          <td colSpan={8} className="p-4">
                            <div className="space-y-4">
                              {r.app_details && r.app_details.length > 0 && (
                                <div className="space-y-2">
                                  <p className="text-[11px] font-semibold uppercase text-slate-600 dark:text-slate-400 tracking-wider">
                                    Application Archives for this Run
                                  </p>
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                    {r.app_details.map((ad) => (
                                      <div
                                        key={ad.app_name}
                                        className={`p-2.5 rounded-xl border text-xs flex flex-col justify-between gap-1.5 ${
                                          ad.status.toLowerCase() === 'failed'
                                            ? 'border-rose-300 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/30'
                                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                                        }`}
                                      >
                                        <div className="flex items-center justify-between">
                                          <div>
                                            <p className="font-semibold text-slate-900 dark:text-slate-200">{ad.app_name}</p>
                                            <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate max-w-[180px]">
                                              {ad.file || (
                                                <span className="text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1">
                                                  <XCircle className="w-2.5 h-2.5 inline" /> Failed
                                                </span>
                                              )}
                                            </p>
                                          </div>
                                          <div className="text-right tabular-nums">
                                            <span className="text-slate-700 dark:text-slate-300 font-mono">{formatBytes(ad.size_bytes)}</span>
                                            {ad.duration_seconds !== null && ad.duration_seconds !== undefined && (
                                              <p className="text-[10px] text-slate-500 dark:text-slate-400">{ad.duration_seconds.toFixed(1)}s</p>
                                            )}
                                          </div>
                                        </div>
                                        {ad.error && (
                                          <div className="p-1.5 rounded bg-rose-100/80 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-900/60 text-[10px] text-rose-800 dark:text-rose-300 font-mono break-all whitespace-pre-wrap">
                                            <span className="font-bold text-rose-600 dark:text-rose-400">Error: </span>
                                            {ad.error}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {r.pruned_files && Object.keys(r.pruned_files).length > 0 && (
                                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                                  <p className="text-[11px] font-semibold uppercase text-amber-700 dark:text-amber-400 tracking-wider flex items-center gap-1.5">
                                    <Trash2 className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                    GFS Pruning Actions (Expired Daily Snapshots Reclaimed)
                                  </p>
                                  <div className="space-y-1">
                                    {Object.entries(r.pruned_files).map(([app, files]) => (
                                      <div key={app} className="text-xs text-slate-700 dark:text-slate-300">
                                        <span className="text-slate-900 dark:text-slate-100 font-semibold">{app}:</span>{' '}
                                        <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
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

                {/* Fixed-height stabilization spacer rows when table paginates */}
                {historyRecords.length > PAGE_SIZE && Array.from({ length: Math.max(0, PAGE_SIZE - paginatedHistory.length) }).map((_, i) => (
                  <tr key={`spacer-hist-${i}`} className="pointer-events-none select-none invisible" aria-hidden="true">
                    <td className="py-3 px-3 text-center w-8"></td>
                    <td className="py-3 px-3 font-medium whitespace-nowrap">0000-00-00</td>
                    <td className="py-3 px-3 font-mono whitespace-nowrap">00:00:00 AM</td>
                    <td className="py-3 px-3 whitespace-nowrap"><span className="inline-flex items-center px-2 py-0.5 text-[11px]">Success</span></td>
                    <td className="py-3 px-3 whitespace-nowrap">Automated</td>
                    <td className="py-3 px-3 whitespace-nowrap font-semibold">0 apps</td>
                    <td className="py-3 px-3 font-mono whitespace-nowrap">000.0 KB</td>
                    <td className="py-3 px-3 truncate max-w-xs">Destination</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination
              currentPage={historyPage}
              totalItems={historyRecords.length}
              pageSize={PAGE_SIZE}
              onPageChange={setHistoryPage}
              itemName="runs"
            />
          </div>
        )}
      </div>
      )}

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
