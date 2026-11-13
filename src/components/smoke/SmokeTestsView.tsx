import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  FlaskConical,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  CalendarClock,
  ShieldCheck,
  Terminal,
  MessageSquare,
  ChevronDown,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { SmokeTestRun } from '../../lib/types';
import { formatConsoleLine } from '../layout/ConsoleColorizer';

interface SmokeTestsViewProps {
  runs: SmokeTestRun[];
  isRunning: boolean;
  streamLines?: string[];
  onRunNow: (forceSms?: boolean) => void;
  onRefreshHistory: () => void;
  onRegisterOsSchedule: () => void;
  scheduleSlots?: string[];
  lastError?: string | null;
}

function formatRunTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getNextScheduleSlot(slots: string[]): string {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  for (const slot of slots) {
    const [h, m] = slot.split(':').map((n) => parseInt(n, 10));
    const slotMinutes = h * 60 + m;
    if (slotMinutes > currentMinutes) {
      return `Today at ${slot}`;
    }
  }
  return `Tomorrow at ${slots[0] || '08:00'}`;
}

export const SmokeTestsView: React.FC<SmokeTestsViewProps> = ({
  runs,
  isRunning,
  streamLines = [],
  onRunNow,
  onRefreshHistory,
  onRegisterOsSchedule,
  scheduleSlots = ['08:00', '13:00', '17:00', '22:00'],
  lastError,
}) => {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isRunDropdownOpen, setIsRunDropdownOpen] = useState<boolean>(false);
  const [historyMode, setHistoryMode] = useState<'last10' | 'last7days'>('last10');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const PAGE_SIZE = 10;
  const consoleEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [streamLines.length, isRunning]);

  const selectedRun = useMemo(() => {
    if (runs.length === 0) return null;
    if (selectedRunId) {
      const match = runs.find((r) => r.id === selectedRunId);
      if (match) return match;
    }
    return runs[0];
  }, [runs, selectedRunId]);

  const categories = useMemo(() => {
    if (!selectedRun) return ['all'];
    const set = new Set(selectedRun.results.map((r) => r.category));
    return ['all', ...Array.from(set)];
  }, [selectedRun]);

  const filteredChecks = useMemo(() => {
    if (!selectedRun) return [];
    if (categoryFilter === 'all') return selectedRun.results;
    return selectedRun.results.filter((r) => r.category === categoryFilter);
  }, [selectedRun, categoryFilter]);

  const filteredRuns = useMemo(() => {
    if (historyMode === 'last10') {
      return runs.slice(0, 10);
    }
    const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return runs.filter((r) => {
      const ts = new Date(r.timestamp).getTime();
      return !Number.isNaN(ts) && ts >= sevenDaysAgoMs;
    });
  }, [runs, historyMode]);

  const totalPages = Math.max(1, Math.ceil(filteredRuns.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRuns = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredRuns.slice(start, start + PAGE_SIZE);
  }, [filteredRuns, safePage]);

  const latestRun = runs[0] || null;
  const latestAllPass = latestRun ? latestRun.failed === 0 : null;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2.5">
            <FlaskConical className="w-6 h-6 text-indigo-400" />
            Production Smoke Tests
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Automated end-to-end verification of suite health, live outbound notification gate, .env conformance, SSO/JWKS, and Zero-Trust API guards. Runs 4x daily ({scheduleSlots.join(', ')}) and on every deploy.
          </p>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
          <button
            onClick={onRefreshHistory}
            disabled={isRunning}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 whitespace-nowrap flex-shrink-0 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            onClick={onRegisterOsSchedule}
            disabled={isRunning}
            title="Register 4x/day Windows Task Scheduler job (08:00, 13:00, 17:00, 22:00)"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 whitespace-nowrap flex-shrink-0 transition-colors cursor-pointer"
          >
            <CalendarClock className="w-3.5 h-3.5 text-amber-400" />
            Sync OS Schedule
          </button>
          <div className="relative inline-flex items-stretch">
            <button
              type="button"
              onClick={() => onRunNow(false)}
              disabled={isRunning}
              title="Run smoke suite (smart-gated: reuses recent live SMS if auth/spendy/basket unchanged within 8h)"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-l-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 whitespace-nowrap flex-shrink-0 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isRunning ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              {isRunning ? 'Running Smoke Suite...' : 'Run Smoke Tests'}
            </button>

            <button
              type="button"
              disabled={isRunning}
              onClick={(e) => {
                e.stopPropagation();
                setIsRunDropdownOpen((prev) => !prev);
              }}
              aria-label="Smoke Suite Run Options"
              title="More Smoke Suite Actions (Run Smoke Suite or Force Live E2E SMS)"
              className="inline-flex items-center justify-center w-7 rounded-r-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white border-l border-indigo-400/40 shadow-lg shadow-indigo-500/20 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {isRunDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setIsRunDropdownOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1.5 z-40 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl py-1 text-left animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                    Smoke Suite Actions
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsRunDropdownOpen(false);
                      onRunNow(false);
                    }}
                    className="w-full px-3 py-2 text-xs flex items-center gap-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <div className="text-left">
                      <div className="font-semibold">Run Smoke Suite</div>
                      <div className="text-[10px] text-slate-400">
                        Smart-gated (reuses recent SMS if unchanged)
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsRunDropdownOpen(false);
                      onRunNow(true);
                    }}
                    className="w-full px-3 py-2 text-xs flex items-center gap-2.5 hover:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 transition-colors border-t border-slate-100 dark:border-slate-800 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <div className="text-left">
                      <div className="font-semibold flex items-center gap-1.5">
                        <MessageSquare className="w-3 h-3 text-emerald-400" />
                        Force Live E2E SMS
                      </div>
                      <div className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80">
                        Bypass cooldown &amp; send Twilio SMS ($0.0166)
                      </div>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {lastError && (
        <div className="rounded-xl bg-rose-950/60 border border-rose-500/40 px-4 py-3 text-xs text-rose-200">
          <span className="font-semibold">Smoke Runner Error:</span> {lastError}
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Latest Status</div>
          <div className="mt-2 flex items-center gap-2">
            {latestAllPass === null ? (
              <span className="text-lg font-bold text-slate-400">No Runs Yet</span>
            ) : latestAllPass ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span className="text-lg font-bold text-emerald-400">ALL PASS</span>
              </>
            ) : (
              <>
                <XCircle className="w-5 h-5 text-rose-400" />
                <span className="text-lg font-bold text-rose-400">{latestRun?.failed} FAILING</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {latestRun ? `${latestRun.passed}/${latestRun.total} checks passed` : 'Click Run Smoke Tests'}
          </div>
        </div>

        <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Last Execution</div>
          <div className="mt-2 text-sm font-semibold text-slate-100 truncate">
            {latestRun ? formatRunTimestamp(latestRun.timestamp) : '—'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Trigger: <span className="text-slate-300 font-mono">{latestRun?.triggeredBy || '—'}</span>
          </div>
        </div>

        <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">4x Daily Schedule</div>
          <div className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-slate-100">
            <Clock className="w-4 h-4 text-indigo-400" />
            <span>{getNextScheduleSlot(scheduleSlots)}</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono">{scheduleSlots.join(' • ')}</div>
        </div>

        <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Deploy Gate</div>
          <div className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-emerald-300">
            <ShieldCheck className="w-4 h-4" />
            <span>Auto-Revert Armed</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Failed smoke gate reverts container</div>
        </div>
      </div>

      {/* Live Execution Telemetry Console */}
      {(isRunning || streamLines.length > 0) && (
        <div className="rounded-xl bg-[#050b14] border border-slate-800 overflow-hidden shadow-xl">
          <div className="px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                Live Execution Telemetry Stream
              </span>
              {isRunning && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
                  STREAMING
                </span>
              )}
            </div>
            <span className="text-[11px] font-mono text-slate-500">{streamLines.length} lines</span>
          </div>
          <div className="p-4 max-h-64 overflow-y-auto font-mono text-xs space-y-1">
            {streamLines.map((line, idx) => (
              <div key={idx} className="leading-relaxed whitespace-pre-wrap break-all">
                {formatConsoleLine(line)}
              </div>
            ))}
            <div ref={consoleEndRef} />
          </div>
        </div>
      )}

      {/* Main Split: Run History (Left) + Check Breakdown (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Recent Runs */}
        <div className="lg:col-span-4 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
              Recent Runs ({filteredRuns.length})
            </h2>
            <div className="inline-flex items-center rounded-lg bg-slate-800 p-0.5 border border-slate-700/80">
              <button
                type="button"
                onClick={() => {
                  setHistoryMode('last10');
                  setCurrentPage(1);
                }}
                className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  historyMode === 'last10'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Last 10
              </button>
              <button
                type="button"
                onClick={() => {
                  setHistoryMode('last7days');
                  setCurrentPage(1);
                }}
                className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  historyMode === 'last7days'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Last 7 Days
              </button>
            </div>
          </div>
          <div className="divide-y divide-slate-800/70 max-h-[520px] overflow-y-auto flex-1">
            {filteredRuns.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                {runs.length === 0
                  ? 'No smoke test runs recorded yet.'
                  : 'No smoke test runs recorded in the last 7 days.'}
              </div>
            ) : (
              paginatedRuns.map((run) => {
                const isSelected = selectedRun?.id === run.id;
                const ok = run.failed === 0;
                return (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                      isSelected ? 'bg-indigo-600/15 border-l-2 border-indigo-400' : 'hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-semibold ${
                          ok ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                        {run.passed}/{run.total} Passed
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                        {run.triggeredBy}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">{formatRunTimestamp(run.timestamp)}</div>
                  </button>
                );
              })
            )}
          </div>
          {filteredRuns.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span className="font-mono">
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredRuns.length)} of{' '}
                {filteredRuns.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-0.5 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Prev
                </button>
                <span className="px-2 font-mono text-slate-300">
                  {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-0.5 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Selected Run Checks */}
        <div className="lg:col-span-8 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                Check Results {selectedRun ? `• ${formatRunTimestamp(selectedRun.timestamp)}` : ''}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2 py-1 rounded text-[11px] font-medium capitalize cursor-pointer transition-colors ${
                    categoryFilter === cat
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-800/70 max-h-[520px] overflow-y-auto">
            {!selectedRun ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Select or run a smoke test to inspect individual assertions.
              </div>
            ) : (
              filteredChecks.map((chk, idx) => (
                <div key={`${chk.name}-${idx}`} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {chk.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-slate-100">{chk.name}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                          {chk.category}
                        </span>
                      </div>
                      <p
                        className={`text-[11px] mt-0.5 break-words ${
                          chk.passed ? 'text-slate-400' : 'text-rose-300 font-medium'
                        }`}
                      >
                        {chk.detail}
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap shrink-0">
                    {chk.durationMs}ms
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
