import React, { useState, useMemo } from 'react';
import { SegmentedControl, ToggleSwitch } from '@lagosr/panorama-ui-kit';
import { CustomSelect } from '../ui/CustomSelect';
import {
  DeployTelemetryRunRecord,
  DiscoveredApp,
  LocalDockerDiskUsage,
  TerminalTab,
} from '../../lib/types';
import {
  TelemetryTimeRange,
  buildAppMatrix,
  buildStageWaterfall,
  buildTrendSeries,
  computeTelemetryKpis,
  filterDeployRuns,
} from '../../lib/deployHistoryAnalytics';
import { DeployTrendChart } from './DeployTrendChart';
import { StageWaterfallChart } from './StageWaterfallChart';
import { formatLocalDateTime, formatRelativeTime } from '../../lib/formatters';
import {
  BarChart3,
  Clock,
  Container,
  HardDrive,
  RefreshCw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Terminal,
  Gauge,
  Cpu,
} from 'lucide-react';

interface BuildTelemetryViewProps {
  apps: DiscoveredApp[];
  runs: DeployTelemetryRunRecord[];
  dockerDiskUsage: LocalDockerDiskUsage | null;
  terminalTabs: TerminalTab[];
  selectedAppSlug?: string;
  onSelectAppSlug?: (slug: string) => void;
  isRefreshing?: boolean;
  isPruningCache?: boolean;
  onRefresh: () => void;
  onPruneBuildKitCache: () => void;
  onInspectConsoleSession?: (sessionId: string) => void;
}

function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

export const BuildTelemetryView: React.FC<BuildTelemetryViewProps> = ({
  apps,
  runs,
  dockerDiskUsage,
  terminalTabs,
  selectedAppSlug: controlledAppSlug,
  onSelectAppSlug,
  isRefreshing = false,
  isPruningCache = false,
  onRefresh,
  onPruneBuildKitCache,
  onInspectConsoleSession,
}) => {
  const [localAppSlug, setLocalAppSlug] = useState<string>('all');
  const [range, setRange] = useState<TelemetryTimeRange>('14d');
  const [posture, setPosture] = useState<string>('all');
  const [includeLegacy, setIncludeLegacy] = useState<boolean>(false);
  const [trendMode, setTrendMode] = useState<'daily' | 'per-run'>('daily');
  const [ledgerFilter, setLedgerFilter] = useState<'all' | 'warnings' | 'failures'>('all');

  const activeAppSlug = controlledAppSlug || localAppSlug;
  const handleAppChange = (val: string) => {
    setLocalAppSlug(val);
    onSelectAppSlug?.(val);
  };

  const appOptions = useMemo(() => {
    const opts = [{ value: 'all', label: `All Suite Apps (${apps.length})` }];
    const seen = new Set<string>(['all']);
    for (const a of apps) {
      const slug = a.manifest.slug.toLowerCase();
      if (!seen.has(slug)) {
        seen.add(slug);
        opts.push({ value: slug, label: a.manifest.displayName });
      }
    }
    for (const r of runs) {
      const slug = r.app_slug.toLowerCase();
      if (!seen.has(slug)) {
        seen.add(slug);
        opts.push({ value: slug, label: r.app_name || slug });
      }
    }
    return opts;
  }, [apps, runs]);

  const filteredRuns = useMemo(
    () =>
      filterDeployRuns(runs, {
        appSlug: activeAppSlug,
        range,
        posture,
        includeLegacy,
      }),
    [runs, activeAppSlug, range, posture, includeLegacy]
  );

  const kpis = useMemo(() => computeTelemetryKpis(filteredRuns), [filteredRuns]);
  const trendPoints = useMemo(() => buildTrendSeries(filteredRuns, trendMode), [filteredRuns, trendMode]);
  const appMatrix = useMemo(() => buildAppMatrix(filteredRuns, apps), [filteredRuns, apps]);
  const waterfallRows = useMemo(() => buildStageWaterfall(filteredRuns, apps), [filteredRuns, apps]);

  const ledgerRuns = useMemo(() => {
    return filteredRuns
      .filter((r) => {
        if (ledgerFilter === 'warnings') {
          return (r.warnings && r.warnings.length > 0) || (r.status && r.status !== 'OPTIMAL');
        }
        if (ledgerFilter === 'failures') {
          return typeof r.exit_code === 'number' && r.exit_code !== 0;
        }
        return true;
      })
      .slice(0, 60);
  }, [filteredRuns, ledgerFilter]);

  const tabIdSet = useMemo(() => new Set(terminalTabs.map((t) => t.id)), [terminalTabs]);

  const buildCacheGb = (dockerDiskUsage?.build_cache.size_bytes ?? 0) / 1_000_000_000;
  const cacheHighAlert = buildCacheGb >= 40;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header & Filter Toolbar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
              <BarChart3 className="w-6 h-6 text-[var(--color-brand-text)]" />
              <span>Build &amp; Deploy Telemetry</span>
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Durable historical deploy timings across GUI &amp; CLI releases, end-to-end stage waterfalls, context budgets, and BuildKit disk usage.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="btn-secondary text-xs flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Syncing...' : 'Refresh Telemetry'}</span>
            </button>

            <button
              type="button"
              onClick={onPruneBuildKitCache}
              disabled={isPruningCache}
              className="btn-tonal text-xs flex items-center gap-1.5"
              title="Reclaim BuildKit layers older than 14 days (336h) while preserving recent caches"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isPruningCache ? 'Pruning Cache...' : 'Prune Stale BuildKit Cache (>14d)'}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
          <div className="w-56">
            <CustomSelect
              value={activeAppSlug}
              options={appOptions}
              onChange={handleAppChange}
              placeholder="Filter app..."
            />
          </div>

          <SegmentedControl
            size="sm"
            activeVariant="brand"
            value={range}
            onChange={(v) => setRange(v as TelemetryTimeRange)}
            options={[
              { value: '7d', label: '7d' },
              { value: '14d', label: '14d' },
              { value: '30d', label: '30d' },
              { value: 'all', label: 'All' },
            ]}
          />

          <div className="w-44">
            <CustomSelect
              value={posture}
              options={[
                { value: 'all', label: 'All Postures' },
                { value: 'cached', label: 'Cached' },
                { value: 'warm', label: 'Warm' },
                { value: 'cold', label: 'Cold' },
                { value: 'static', label: 'Static / Edge' },
                { value: 'legacy', label: 'Legacy (<v0.4)' },
              ]}
              onChange={setPosture}
            />
          </div>

          <ToggleSwitch
            size="sm"
            checked={includeLegacy}
            onChange={setIncludeLegacy}
            label="Include legacy pre-v0.4 runs"
          />
        </div>
      </div>

      {/* Executive KPI Strip (5 solid cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold uppercase tracking-wide text-[10px]">Wall Deploy Time</span>
            <Clock className="w-4 h-4 text-orange-500" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {kpis.medianWallSec !== null ? `${kpis.medianWallSec}s` : '—'}
          </div>
          <p className="text-[11px] font-mono text-slate-500 mt-1 tabular-nums">
            Median • Avg: {kpis.avgWallSec !== null ? `${kpis.avgWallSec}s` : '—'} ({kpis.totalRuns} runs)
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold uppercase tracking-wide text-[10px]">Build vs Non-Build</span>
            <Container className="w-4 h-4 text-sky-500" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {kpis.avgBuildSec !== null ? `${kpis.avgBuildSec}s` : '—'}
          </div>
          <p className="text-[11px] font-mono text-slate-500 mt-1 tabular-nums">
            Non-Docker: {kpis.avgNonBuildSec !== null ? `${kpis.avgNonBuildSec}s` : '—'}
            {kpis.nonBuildSharePct !== null ? ` (${kpis.nonBuildSharePct}%)` : ''}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold uppercase tracking-wide text-[10px]">Cache Hit Rate</span>
            <Cpu className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {kpis.depsHitRatePct !== null ? `${kpis.depsHitRatePct}%` : '—'}
          </div>
          <p className="text-[11px] font-mono text-slate-500 mt-1 tabular-nums">
            Deps hit • ARM64: {kpis.arm64HitRatePct !== null ? `${kpis.arm64HitRatePct}%` : '—'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold uppercase tracking-wide text-[10px]">Warnings &amp; Context</span>
            <Gauge className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {kpis.warningCount}
            <span className="text-sm font-normal text-slate-500 ml-1">
              warn{kpis.warningCount === 1 ? '' : 's'}
            </span>
          </div>
          <p className="text-[11px] font-mono text-slate-500 mt-1 tabular-nums">
            Avg Context: {kpis.avgContextKb !== null ? `${kpis.avgContextKb} KB` : '—'} • Fails: {kpis.failedRuns}
          </p>
        </div>

        <div
          className={`rounded-xl border p-4 shadow-sm bg-white dark:bg-slate-900 ${
            cacheHighAlert
              ? 'border-amber-500/50 dark:border-amber-500/40'
              : 'border-slate-200 dark:border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold uppercase tracking-wide text-[10px]">Local BuildKit Cache</span>
            <HardDrive className={`w-4 h-4 ${cacheHighAlert ? 'text-amber-500' : 'text-indigo-500'}`} />
          </div>
          <div
            className={`mt-2 text-2xl font-bold font-mono tabular-nums ${
              cacheHighAlert
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {dockerDiskUsage?.error ? 'N/A' : formatBytes(dockerDiskUsage?.build_cache.size_bytes)}
          </div>
          <p className="text-[11px] font-mono text-slate-500 mt-1 tabular-nums truncate">
            {dockerDiskUsage?.error
              ? dockerDiskUsage.error
              : `Reclaimable: ${formatBytes(dockerDiskUsage?.build_cache.reclaimable_bytes)} • Img: ${formatBytes(dockerDiskUsage?.images.size_bytes)}`}
          </p>
        </div>
      </div>

      {/* Historical Performance Trend Chart */}
      <DeployTrendChart
        points={trendPoints}
        mode={trendMode}
        onModeChange={setTrendMode}
        onSelectRun={(runId) => {
          if (tabIdSet.has(runId) && onInspectConsoleSession) {
            onInspectConsoleSession(runId);
          }
        }}
      />

      {/* End-to-End Stage Waterfall */}
      <StageWaterfallChart
        rows={waterfallRows}
        onSelectApp={(slug) => handleAppChange(activeAppSlug === slug ? 'all' : slug)}
      />

      {/* Per-App Performance & Context Budget Matrix */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Per-Application Performance &amp; Build Context Budget Matrix
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Click any application row to filter charts and ledger below.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase font-sans text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-3">Application</th>
                <th className="py-2 px-2 text-right">Runs</th>
                <th className="py-2 px-2 text-right">Avg Wall</th>
                <th className="py-2 px-2 text-right">Cached</th>
                <th className="py-2 px-2 text-right">Warm</th>
                <th className="py-2 px-2 text-right">Cold</th>
                <th className="py-2 px-2 text-right">Non-Build</th>
                <th className="py-2 px-2 text-right">Typecheck</th>
                <th className="py-2 px-3 min-w-[150px]">Context / Budget</th>
                <th className="py-2 px-2 text-right">Deps Hit</th>
                <th className="py-2 pl-2 text-right">Latest Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {appMatrix.map((row) => {
                const budgetPct = Math.min(100, row.contextBudgetPct ?? 0);
                const overBudget = (row.contextBudgetPct ?? 0) > 100;
                return (
                  <tr
                    key={row.slug}
                    onClick={() => handleAppChange(activeAppSlug === row.slug ? 'all' : row.slug)}
                    className={`cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-950/70 ${
                      activeAppSlug === row.slug ? 'bg-amber-500/10' : ''
                    }`}
                  >
                    <td className="py-2.5 pr-3 font-sans font-semibold text-slate-900 dark:text-slate-100">
                      {row.displayName}
                    </td>
                    <td className="py-2.5 px-2 text-right text-slate-600 dark:text-slate-400">{row.runCount}</td>
                    <td className="py-2.5 px-2 text-right font-bold text-slate-900 dark:text-slate-100">
                      {row.avgWallSec !== null ? `${row.avgWallSec}s` : '—'}
                    </td>
                    <td className="py-2.5 px-2 text-right text-cyan-600 dark:text-cyan-400">
                      {row.avgBuildCachedSec !== null ? `${row.avgBuildCachedSec}s` : '—'}
                    </td>
                    <td className="py-2.5 px-2 text-right text-emerald-600 dark:text-emerald-400">
                      {row.avgBuildWarmSec !== null ? `${row.avgBuildWarmSec}s` : '—'}
                    </td>
                    <td className="py-2.5 px-2 text-right text-amber-600 dark:text-amber-400">
                      {row.avgBuildColdSec !== null ? `${row.avgBuildColdSec}s` : '—'}
                    </td>
                    <td className="py-2.5 px-2 text-right text-slate-700 dark:text-slate-300">
                      {row.avgNonBuildSec !== null ? `${row.avgNonBuildSec}s` : '—'}
                    </td>
                    <td className="py-2.5 px-2 text-right text-slate-700 dark:text-slate-300">
                      {row.avgTypecheckSec !== null ? `${row.avgTypecheckSec}s` : '—'}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center justify-between text-[10px] mb-1">
                        <span>{row.avgContextKb !== null ? `${row.avgContextKb} KB` : '—'}</span>
                        <span className="text-slate-500">≤{row.maxContextKb} KB</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          style={{ width: `${budgetPct}%` }}
                          className={`h-full rounded-full ${
                            overBudget
                              ? 'bg-rose-500'
                              : budgetPct > 75
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                          }`}
                        />
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-right text-slate-700 dark:text-slate-300">
                      {row.depsHitRatePct !== null ? `${row.depsHitRatePct}%` : '—'}
                    </td>
                    <td className="py-2.5 pl-2 text-right">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          row.latestStatus === 'OPTIMAL'
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                            : row.latestStatus === 'WARN_CEILING' || row.latestStatus === 'FAILED'
                            ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30'
                            : 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30'
                        }`}
                      >
                        {row.latestStatus}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {appMatrix.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-500 font-sans">
                    No applications recorded for the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Runs & Warnings Ledger */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Recent Deploy Runs &amp; Warnings Ledger ({ledgerRuns.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Durable audit trail preserved beyond console tab cleanup and 28-day session purging.
            </p>
          </div>

          <SegmentedControl
            size="sm"
            activeVariant="brand"
            value={ledgerFilter}
            onChange={(v) => setLedgerFilter(v as 'all' | 'warnings' | 'failures')}
            options={[
              { value: 'all', label: 'All Runs' },
              { value: 'warnings', label: 'Warnings' },
              { value: 'failures', label: 'Failures' },
            ]}
          />
        </div>

        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1 custom-scrollbar">
          {ledgerRuns.map((run) => {
            const canInspect = Boolean(
              run.console_session_id &&
                tabIdSet.has(run.console_session_id) &&
                onInspectConsoleSession
            );
            const hasWarnings = (run.warnings?.length || 0) > 0;
            const isFail = typeof run.exit_code === 'number' && run.exit_code !== 0;

            return (
              <div
                key={run.id}
                className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col gap-2 text-xs font-mono tabular-nums"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    {isFail ? (
                      <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
                    ) : hasWarnings || run.status !== 'OPTIMAL' ? (
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    )}
                    <span className="font-sans font-bold text-slate-900 dark:text-slate-100">
                      {run.app_name}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] uppercase bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {run.cache_posture}
                    </span>
                    {run.engine_version && (
                      <span className="text-[11px] text-slate-500">v{run.engine_version}</span>
                    )}
                    {run.release_id && (
                      <span className="text-[11px] text-slate-600 dark:text-slate-400 truncate max-w-[200px]">
                        {run.release_id}
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500">
                      {run.source}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <span className="text-slate-900 dark:text-slate-100 font-bold">
                      Wall: {run.wall_duration_sec ?? '—'}s
                    </span>
                    <span className="text-sky-600 dark:text-sky-400">
                      Build: {run.build_total_sec ?? '—'}s
                    </span>
                    <span className="text-slate-500" title={formatLocalDateTime(run.started_at)}>
                      {formatRelativeTime(run.started_at)}
                    </span>
                    {canInspect && (
                      <button
                        type="button"
                        onClick={() => onInspectConsoleSession?.(run.console_session_id!)}
                        className="btn-secondary text-[11px] py-1 px-2.5 flex items-center gap-1"
                      >
                        <Terminal className="w-3 h-3" />
                        <span>Inspect Log</span>
                      </button>
                    )}
                  </div>
                </div>

                {hasWarnings && (
                  <div className="pl-6 space-y-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                    {run.warnings.map((w, idx) => (
                      <p key={idx}>• {w}</p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {ledgerRuns.length === 0 && (
            <div className="py-8 text-center text-xs text-slate-500 font-mono">
              No runs match this ledger filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
