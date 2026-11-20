import { useState } from 'react';
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Play,
  FileCode2,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  Terminal,
} from 'lucide-react';
import { BottomSheetModal, ConfirmModal, StatusBadge } from '@lagosr/panorama-ui-kit';
import type {
  AppCronAuditReport,
  CronAuditStatus,
  DiscoveredApp,
  FleetCronAuditSummary,
} from '../../lib/types';

export interface CronActionRequest {
  type: 'sync-all' | 'sync-app' | 'dry-run' | 'test-run';
  app?: DiscoveredApp;
  jobId?: string;
}

interface CronManagerPanelProps {
  summary: FleetCronAuditSummary;
  hasSnapshot: boolean;
  isBusy: boolean;
  onTriggerCronAction: (req: CronActionRequest) => void;
}

function getStatusBadgeProps(status: CronAuditStatus): {
  label: string;
  variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' | 'accent';
  pulse?: boolean;
} {
  switch (status) {
    case 'IN_SYNC':
      return { label: 'IN SYNC', variant: 'success' };
    case 'LEGACY_UNMIGRATED':
      return { label: 'LEGACY CRON ACTIVE', variant: 'info' };
    case 'DRIFTED':
      return { label: 'DRIFTED', variant: 'warning' };
    case 'MISSING':
      return { label: 'MISSING ON WSH', variant: 'danger' };
    case 'INVALID_FORMAT':
      return { label: 'FORMAT / PERM ERROR', variant: 'danger' };
    case 'DAEMON_DOWN':
      return { label: 'DAEMON DOWN', variant: 'danger', pulse: true };
    default:
      return { label: 'AWAITING SNAPSHOT', variant: 'neutral' };
  }
}

function getCronConfirmCopy(
  req: CronActionRequest,
  appCount: number
): { title: string; message: string; confirmText: string } {
  if (req.type === 'sync-all') {
    return {
      title: 'Sync All Suite Host Crons on WSH?',
      message: `Synchronizes /etc/cron.d/panorama-* and /opt/*/scripts/*.sh (0700 LF) across ${appCount} suite app(s) on wsh.panoramadr.com, and atomically removes declared legacy /etc/cron.d/ files.`,
      confirmText: 'Sync All Suite Crons',
    };
  }
  if (req.type === 'test-run') {
    const appName = req.app?.manifest.displayName || 'Application';
    const job = req.app?.manifest.sre?.cronJobs?.find((j) => j.id === req.jobId);
    const scriptRel = job?.script || req.jobId || 'heartbeat script';
    return {
      title: `Execute Host Cron Script (${req.jobId}) on WSH?`,
      message: `Runs ${appName} (${scriptRel}) immediately over SSH on wsh.panoramadr.com under the host script's idempotency/schedule guard.`,
      confirmText: 'Run on WSH',
    };
  }
  const slug = req.app?.manifest.slug || 'app';
  const appName = req.app?.manifest.displayName || 'Application';
  return {
    title: `Sync Host Crons for ${appName}?`,
    message: `Uploads normalized LF script(s) (chmod 0700), writes /etc/cron.d/panorama-${slug} (0644 root:root), and removes declared legacy cron files on wsh.panoramadr.com.`,
    confirmText: 'Sync Host Crons',
  };
}

export function CronManagerPanel({
  summary,
  hasSnapshot,
  isBusy,
  onTriggerCronAction,
}: CronManagerPanelProps) {
  const [inspectedReport, setInspectedReport] = useState<AppCronAuditReport | null>(null);
  const [showSystemFiles, setShowSystemFiles] = useState(false);
  const [pendingAction, setPendingAction] = useState<CronActionRequest | null>(null);

  const requestCronAction = (req: CronActionRequest) => {
    if (req.type === 'dry-run') {
      onTriggerCronAction(req);
      return;
    }
    setPendingAction(req);
  };

  const confirmCopy = pendingAction ? getCronConfirmCopy(pendingAction, summary.apps.length) : null;

  return (
    <div className="space-y-5">
      {/* Fleet Cron Header Card */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-[var(--color-brand-text)]" />
              Declarative Host Cron Jobs (/etc/cron.d/panorama-*)
            </h3>
            <StatusBadge
              label={
                !hasSnapshot
                  ? 'PROBING CRON...'
                  : summary.cronServiceActive
                  ? 'cron daemon: active'
                  : `cron daemon: ${summary.cronServiceStatus}`
              }
              variant={!hasSnapshot ? 'neutral' : summary.cronServiceActive ? 'success' : 'danger'}
              pulse={hasSnapshot && !summary.cronServiceActive}
            />
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
            {summary.apps.length} suite app{summary.apps.length === 1 ? '' : 's'} declaring 15-minute heartbeats &bull;{' '}
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
              {summary.inSyncCount} IN SYNC
            </span>
            {summary.attentionCount > 0 && (
              <>
                {' '}
                &bull;{' '}
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  {summary.attentionCount} need sync / migration
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
          <button
            type="button"
            disabled={isBusy || summary.apps.length === 0}
            onClick={() => requestCronAction({ type: 'sync-all' })}
            className="btn-primary text-xs py-1.5 px-3.5"
            title="Sync all declarative scripts & /etc/cron.d/panorama-* files and remove declared legacy files"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
            <span>Sync All Suite Crons</span>
          </button>
        </div>
      </div>

      {/* Empty state if no manifests declare cronJobs */}
      {summary.apps.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center text-xs text-slate-600 dark:text-slate-400 font-mono">
          No suite applications declare <span className="font-semibold">sre.cronJobs</span> in{' '}
          <span className="font-semibold">panorama.app.json</span>.
        </div>
      ) : (
        <div className="space-y-4">
          {summary.apps.map((report) => {
            const badge = getStatusBadgeProps(report.status);
            const firstEnabledJob = report.jobs.find((j) => j.job.enabled !== false);

            return (
              <div
                key={report.slug}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4"
              >
                {/* App Header */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                        {report.displayName}
                      </span>
                      <code className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-300">
                        /etc/cron.d/{report.expectedCronFileName}
                      </code>
                      <StatusBadge label={badge.label} variant={badge.variant} pulse={badge.pulse} />
                    </div>
                    <p className="text-[11px] font-mono text-slate-600 dark:text-slate-400 tabular-nums truncate">
                      Root: {report.remoteAppRoot} &bull; Live mode:{' '}
                      {report.liveCronFile
                        ? `${report.liveCronFile.mode} (${report.liveCronFile.owner})`
                        : 'not present'}
                    </p>
                  </div>

                  {/* Per-App Actions */}
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setInspectedReport(report)}
                      className="btn-secondary text-xs py-1.5 px-3"
                    >
                      <FileCode2 className="w-3.5 h-3.5 text-[var(--color-accent-text)]" />
                      <span>Inspect Crontab</span>
                    </button>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => requestCronAction({ type: 'dry-run', app: report.app })}
                      className="btn-secondary text-xs py-1.5 px-3"
                      title="Preview /etc/cron.d content and script SHA-256 hashes locally without SSH writes"
                    >
                      <span>Dry-Run (-Test)</span>
                    </button>

                    {firstEnabledJob && (
                      <button
                        type="button"
                        disabled={isBusy || report.status === 'MISSING' || !firstEnabledJob.scriptExistsOnWsh}
                        onClick={() =>
                          requestCronAction({
                            type: 'test-run',
                            app: report.app,
                            jobId: firstEnabledJob.job.id,
                          })
                        }
                        className="btn-accent text-xs py-1.5 px-3"
                        title={`Execute ${firstEnabledJob.remoteScriptPath} once on WSH with schedule guard`}
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Test Run Heartbeat</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => requestCronAction({ type: 'sync-app', app: report.app })}
                      className="btn-primary text-xs py-1.5 px-3"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                      <span>Sync Crons</span>
                    </button>
                  </div>
                </div>

                {/* Issues Callout (if any) */}
                {report.issues.length > 0 && (
                  <div className="rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
                    {report.issues.map((issue, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <span>{issue}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Declared Jobs Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                        <th className="pb-2 pr-3">Job</th>
                        <th className="pb-2 pr-3">Schedule</th>
                        <th className="pb-2 pr-3">Script & Args</th>
                        <th className="pb-2 pr-3">WSH Validation</th>
                        <th className="pb-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {report.jobs.map((jr) => (
                        <tr key={jr.job.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 pr-3 align-top">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 font-mono">
                              {jr.job.id}
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-slate-400 max-w-xs">
                              {jr.job.description}
                            </div>
                          </td>
                          <td className="py-2.5 pr-3 align-top font-mono tabular-nums whitespace-nowrap text-slate-800 dark:text-slate-200">
                            <div>{jr.job.schedule}</div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400">
                              {jr.job.shell || '/bin/sh'}
                            </div>
                          </td>
                          <td className="py-2.5 pr-3 align-top font-mono text-[11px]">
                            <div className="text-slate-800 dark:text-slate-200">
                              {jr.remoteScriptPath}
                              {jr.job.args && jr.job.args.length > 0 ? ` ${jr.job.args.join(' ')}` : ''}
                            </div>
                            {jr.lastRunLine && (
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-md mt-0.5">
                                Last: {jr.lastRunLine}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 pr-3 align-top">
                            {!hasSnapshot ? (
                              <span className="text-[11px] font-mono text-slate-500">Pending probe</span>
                            ) : !jr.scriptExistsOnWsh ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-mono text-rose-700 dark:text-rose-400">
                                <XCircle className="w-3.5 h-3.5" />
                                Missing on WSH
                              </span>
                            ) : (
                              <div className="flex flex-wrap gap-1 font-mono text-[10px] tabular-nums">
                                <span
                                  className={`px-1.5 py-0.5 rounded border ${
                                    jr.permissionsOk
                                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                                      : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
                                  }`}
                                >
                                  mode:{jr.liveScript?.mode || '?'}
                                </span>
                                <span
                                  className={`px-1.5 py-0.5 rounded border ${
                                    jr.crlfClean
                                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                                      : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30'
                                  }`}
                                >
                                  {jr.crlfClean ? 'LF' : 'CRLF'}
                                </span>
                                <span
                                  className={`px-1.5 py-0.5 rounded border ${
                                    jr.syntaxOk
                                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                                      : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30'
                                  }`}
                                >
                                  {jr.syntaxOk ? 'syntax:ok' : 'syntax:err'}
                                </span>
                                <span
                                  className={`px-1.5 py-0.5 rounded border ${
                                    jr.shaMatch
                                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                                      : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
                                  }`}
                                >
                                  {jr.shaMatch ? 'sha:match' : 'sha:drift'}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 align-top text-right">
                            <button
                              type="button"
                              disabled={isBusy || jr.job.enabled === false || !jr.scriptExistsOnWsh}
                              onClick={() =>
                                requestCronAction({
                                  type: 'test-run',
                                  app: report.app,
                                  jobId: jr.job.id,
                                })
                              }
                              className="btn-ghost text-[11px] py-1 px-2"
                              title={`Run ${jr.job.id} now`}
                            >
                              <Play className="w-3 h-3" />
                              <span>Run</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Collapsible Unmanaged / OS System /etc/cron.d/ Files */}
      {summary.unmanagedCronFiles.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <button
            type="button"
            onClick={() => setShowSystemFiles((prev) => !prev)}
            className="w-full flex items-center justify-between text-left text-xs font-mono text-slate-600 dark:text-slate-400"
          >
            <span className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-300">
              {showSystemFiles ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Unmanaged / OS System /etc/cron.d/ Files ({summary.unmanagedCronFiles.length})
            </span>
            <span>Preserved untouched during sync</span>
          </button>

          {showSystemFiles && (
            <div className="mt-3 space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
              {summary.unmanagedCronFiles.map((f) => (
                <div
                  key={f.name}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-600 dark:text-slate-400"
                >
                  <span className="font-semibold text-slate-800 dark:text-slate-200">/etc/cron.d/{f.name}</span>
                  <span className="tabular-nums">
                    {f.mode} ({f.owner}) &bull; sha256:{f.content_sha256.slice(0, 12)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Inspect Crontab Modal (Material 3 Solid Surface + Adaptive Monospace Viewers) */}
      <BottomSheetModal
        isOpen={inspectedReport !== null}
        onClose={() => setInspectedReport(null)}
        title={inspectedReport ? `Crontab Inspector — ${inspectedReport.displayName}` : 'Crontab Inspector'}
        subtitle={inspectedReport ? `/etc/cron.d/${inspectedReport.expectedCronFileName}` : undefined}
        icon={<Terminal className="w-5 h-5 text-[var(--color-brand-text)]" />}
        maxWidthClass="max-w-3xl"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            {inspectedReport && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  const app = inspectedReport.app;
                  setInspectedReport(null);
                  requestCronAction({ type: 'sync-app', app });
                }}
                className="btn-primary text-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Sync Now</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setInspectedReport(null)}
              className="btn-secondary text-xs"
            >
              Close
            </button>
          </div>
        }
      >
        {inspectedReport && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200">
                  <span>Expected SSOT (/etc/cron.d/{inspectedReport.expectedCronFileName})</span>
                  <span className="font-mono tabular-nums text-[10px] text-slate-500">
                    sha:{inspectedReport.expectedCronSha256.slice(0, 10)}
                  </span>
                </div>
                <pre className="p-3 rounded-xl bg-slate-50 dark:bg-[#050b14] border border-slate-200/90 dark:border-slate-800 shadow-inner text-emerald-900 dark:text-emerald-400 font-mono text-xs overflow-x-auto whitespace-pre-wrap break-all">
                  {inspectedReport.expectedCronContent}
                </pre>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200">
                  <span>Live on WSH</span>
                  <span className="font-mono tabular-nums text-[10px] text-slate-500">
                    {inspectedReport.liveCronFile
                      ? `${inspectedReport.liveCronFile.mode} • sha:${inspectedReport.liveCronFile.content_sha256.slice(0, 10)}`
                      : 'Absent'}
                  </span>
                </div>
                <pre className="p-3 rounded-xl bg-slate-50 dark:bg-[#050b14] border border-slate-200/90 dark:border-slate-800 shadow-inner text-emerald-900 dark:text-emerald-400 font-mono text-xs overflow-x-auto whitespace-pre-wrap break-all min-h-[120px]">
                  {inspectedReport.liveCronFile
                    ? inspectedReport.liveCronFile.content_raw
                    : '# Not yet installed on WSH.\n# Click "Sync Now" to provision atomically.'}
                </pre>
              </div>
            </div>

            {inspectedReport.liveLegacyFiles.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  <ShieldAlert className="w-4 h-4" />
                  <span>Legacy /etc/cron.d/ Files Pending Atomic Cleanup</span>
                </div>
                {inspectedReport.liveLegacyFiles.map((lf) => (
                  <pre
                    key={lf.name}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-[#050b14] border border-amber-300 dark:border-amber-500/40 text-amber-900 dark:text-amber-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap break-all"
                  >
                    {`# /etc/cron.d/${lf.name} (${lf.mode} ${lf.owner})\n${lf.content_raw}`}
                  </pre>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Recent Scrubbed Host Cron Execution Logs</span>
              </div>
              <pre className="p-3 rounded-xl bg-slate-50 dark:bg-[#050b14] border border-slate-200/90 dark:border-slate-800 shadow-inner text-emerald-900 dark:text-emerald-400 font-mono text-xs overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
                {inspectedReport.recentLogLines.length > 0
                  ? inspectedReport.recentLogLines.join('\n')
                  : 'No recent cron log entries matched this application in the last 30 journalctl lines.'}
              </pre>
            </div>
          </div>
        )}
      </BottomSheetModal>

      {/* Confirmation Gate for WSH SSH Cron Mutations & Live Remote Script Execution */}
      <ConfirmModal
        isOpen={pendingAction !== null && confirmCopy !== null}
        title={confirmCopy?.title || 'Confirm Host Cron Action'}
        message={confirmCopy?.message || ''}
        confirmText={confirmCopy?.confirmText || 'Proceed'}
        cancelText="Cancel"
        variant="warning"
        isLoading={isBusy}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          if (!pendingAction) return;
          const action = pendingAction;
          setPendingAction(null);
          onTriggerCronAction(action);
        }}
      />
    </div>
  );
}
