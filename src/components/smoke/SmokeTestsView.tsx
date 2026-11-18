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
  MessageSquare,
  ChevronDown,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { SmokeTestRun, TerminalTab } from '../../lib/types';
import { parseUtcDate } from '../../lib/formatters';
import { filterTabsForScope, getTabFinishedDetails } from '../../lib/stream-utils';
import { WorkStreamContainer } from '../ui/WorkStreamContainer';
import { SegmentedControl } from '@lagosr/panorama-ui-kit';

interface SmokeTestsViewProps {
  runs: SmokeTestRun[];
  isRunning: boolean;
  streamLines?: string[];
  terminalTabs?: TerminalTab[];
  onRunNow: (forceSms?: boolean) => void;
  onRefreshHistory: () => void;
  onRegisterOsSchedule: () => void;
  onOpenInBottomConsole?: (tabId?: string) => void;
  onAbortJob?: (tabId: string) => void;
  onClearTab?: (tabId: string) => void;
  scheduleSlots?: string[];
  lastError?: string | null;
}

function formatRunTimestamp(iso: string): string {
  const d = parseUtcDate(iso);
  if (!d) return iso;
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

export function getRunE2eSmsInfo(run: SmokeTestRun): { status: 'passed' | 'failed'; detail: string } | null {
  const smsCheck = run.results?.find((r) => r.name.includes('E2E SMS Delivery'));
  if (!smsCheck) return null;
  if (!smsCheck.passed) {
    return { status: 'failed', detail: smsCheck.detail };
  }
  const trimmed = smsCheck.detail.trim();
  if (/^skipped\b/i.test(trimmed)) {
    return null;
  }
  if (trimmed.includes('out=SM') && trimmed.includes('-> in=SM')) {
    return { status: 'passed', detail: smsCheck.detail };
  }
  return null;
}

const SMOKE_UTILITY_TITLE_REGEX = /^(reload smoke test history|register .* smoke schedule)/i;
const MIN_VALID_EPOCH_MS = 1_600_000_000_000;
const MAX_SMOKE_DURATION_MS = 300_000;
const MAX_FINISH_DRIFT_MS = 30_000;
const START_CLOCK_TOLERANCE_MS = 2_500;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function isUtilitySmokeTab(tab: TerminalTab): boolean {
  return (
    tab.id.startsWith('smoke-refresh-') ||
    tab.id.startsWith('smoke-schedule-') ||
    SMOKE_UTILITY_TITLE_REGEX.test(tab.title.trim())
  );
}

/**
 * Extracts the smoke test trigger label (e.g. "mcp-agent", "sre-scheduled:08:00")
 * from a smoke-scoped stream session, excluding non-suite utility tabs.
 */
export function extractSmokeTabTrigger(tab: TerminalTab): string | null {
  if (isUtilitySmokeTab(tab)) {
    return null;
  }

  const titleMatch = tab.title.trim().match(/^Smoke Tests \((.+)\)$/i);
  if (titleMatch?.[1]) {
    return titleMatch[1].trim();
  }

  const headLines = (tab.lines || []).slice(0, 10);
  for (const line of headLines) {
    const bracketMatch = line.match(/\[trigger=([^\]]+)\]/);
    if (bracketMatch?.[1]) {
      return bracketMatch[1].trim();
    }
    const parenMatch = line.match(/\(trigger=([^)]+)\)/);
    if (parenMatch?.[1]) {
      return parenMatch[1].trim();
    }
  }

  return null;
}

/**
 * Returns true if the stream tab represents an actual Production Smoke Suite execution
 * rather than a UI utility action (such as history reload or OS schedule registration).
 */
export function isSmokeSuiteStreamTab(tab: TerminalTab): boolean {
  if (isUtilitySmokeTab(tab)) {
    return false;
  }
  return extractSmokeTabTrigger(tab) !== null || tab.id.startsWith('smoke-');
}

function getTabStartEpochMs(tab: TerminalTab): number | null {
  const epochMatch = tab.id.match(/(?:^|-)(\d{13})$/);
  if (epochMatch?.[1]) {
    const parsedEpoch = Number(epochMatch[1]);
    if (Number.isFinite(parsedEpoch) && parsedEpoch > MIN_VALID_EPOCH_MS) {
      return parsedEpoch;
    }
  }
  return parseUtcDate(tab.createdAt)?.getTime() ?? null;
}

function getRunEndEpochMs(run: SmokeTestRun): number | null {
  const tsMs = parseUtcDate(run.timestamp)?.getTime();
  if (tsMs !== undefined && !Number.isNaN(tsMs)) {
    return tsMs;
  }
  const idMatch = run.id.match(/^smoke_(\d{13})$/);
  if (idMatch?.[1]) {
    const parsedEpoch = Number(idMatch[1]);
    if (Number.isFinite(parsedEpoch)) {
      return parsedEpoch;
    }
  }
  return null;
}

/**
 * Deterministically builds a 1-to-1 bidirectional mapping between historical smoke test
 * runs (`smoke-history.jsonl`) and captured console stream sessions (`sre.sqlite`).
 */
export function correlateSmokeRunsAndStreams(
  runs: SmokeTestRun[],
  scopedTabs: TerminalTab[]
): { runToTabId: Map<string, string>; tabToRunId: Map<string, string> } {
  const runToTabId = new Map<string, string>();
  const tabToRunId = new Map<string, string>();

  const suiteTabs = scopedTabs.filter((t) => !t.isRunning && isSmokeSuiteStreamTab(t));
  if (runs.length === 0 || suiteTabs.length === 0) {
    return { runToTabId, tabToRunId };
  }

  interface CandidateMatch {
    runId: string;
    tabId: string;
    scoreMs: number;
    runEndMs: number;
  }

  const tabMeta = suiteTabs.map((tab) => {
    const trig = extractSmokeTabTrigger(tab);
    const startMs = getTabStartEpochMs(tab);
    const finishedMs = parseUtcDate(tab.finishedAt)?.getTime() ?? null;
    const fallbackMs = getTabFinishedDetails(tab).timestampMs;
    const endMs = finishedMs ?? (fallbackMs > 0 ? fallbackMs : null);
    return { tab, trig, startMs, endMs };
  });

  const candidates: CandidateMatch[] = [];

  for (const run of runs) {
    const runEndMs = getRunEndEpochMs(run);
    if (runEndMs === null) continue;

    for (const { tab, trig, startMs, endMs } of tabMeta) {
      if (trig && trig !== run.triggeredBy) {
        continue;
      }

      if (startMs !== null) {
        const elapsedSinceStart = runEndMs - startMs;
        if (elapsedSinceStart < -START_CLOCK_TOLERANCE_MS || elapsedSinceStart > MAX_SMOKE_DURATION_MS) {
          continue;
        }
      }

      if (endMs !== null && Math.abs(endMs - runEndMs) > MAX_FINISH_DRIFT_MS) {
        continue;
      }

      const scoreMs =
        endMs !== null
          ? Math.abs(endMs - runEndMs)
          : Math.abs(runEndMs - (startMs ?? runEndMs));

      candidates.push({
        runId: run.id,
        tabId: tab.id,
        scoreMs,
        runEndMs,
      });
    }
  }

  candidates.sort((a, b) => {
    if (a.scoreMs !== b.scoreMs) {
      return a.scoreMs - b.scoreMs;
    }
    return b.runEndMs - a.runEndMs;
  });

  for (const candidate of candidates) {
    if (runToTabId.has(candidate.runId) || tabToRunId.has(candidate.tabId)) {
      continue;
    }
    runToTabId.set(candidate.runId, candidate.tabId);
    tabToRunId.set(candidate.tabId, candidate.runId);
  }

  return { runToTabId, tabToRunId };
}

/**
 * Computes the target history filter tab and 1-based page index needed to make
 * `targetRunId` visible in the Recent Runs list when selected from a stream session.
 */
export function resolveRunSelectionView(
  runs: SmokeTestRun[],
  targetRunId: string,
  currentHistoryMode: 'last10' | 'last7days',
  pageSize = 10,
  nowMs = Date.now()
): { historyMode: 'last10' | 'last7days'; currentPage: number } | null {
  const overallIndex = runs.findIndex((r) => r.id === targetRunId);
  if (overallIndex === -1) {
    return null;
  }

  if (currentHistoryMode === 'last10' && overallIndex < pageSize) {
    return { historyMode: 'last10', currentPage: 1 };
  }

  const sevenDaysAgoMs = nowMs - SEVEN_DAYS_MS;
  const recent7d = runs.filter((r) => {
    const ts = parseUtcDate(r.timestamp)?.getTime() ?? NaN;
    return !Number.isNaN(ts) && ts >= sevenDaysAgoMs;
  });
  const idx7d = recent7d.findIndex((r) => r.id === targetRunId);
  const currentPage =
    idx7d >= 0
      ? Math.floor(idx7d / pageSize) + 1
      : Math.floor(recent7d.length / pageSize) + 1;

  return {
    historyMode: 'last7days',
    currentPage,
  };
}

/**
 * Resolves the effective controlled selection and unmatched contextual hints
 * for the WorkStreamContainer anchored to SmokeTestsView.
 */
export function resolveEffectiveSmokeStreamState(params: {
  selectedRun: SmokeTestRun | null;
  scopedTabs: TerminalTab[];
  runToTabId: Map<string, string>;
  manualTabOverrideId: string | null;
}): {
  selectedTabId: string | null;
  unmatchedSelectionMessage: string | null;
  unmatchedSelectPlaceholder: string | undefined;
} {
  const { selectedRun, scopedTabs, runToTabId, manualTabOverrideId } = params;

  const runningTab = scopedTabs.find((t) => t.isRunning) ?? null;
  if (runningTab) {
    return {
      selectedTabId: runningTab.id,
      unmatchedSelectionMessage: null,
      unmatchedSelectPlaceholder: undefined,
    };
  }

  if (manualTabOverrideId && scopedTabs.some((t) => t.id === manualTabOverrideId)) {
    return {
      selectedTabId: manualTabOverrideId,
      unmatchedSelectionMessage: null,
      unmatchedSelectPlaceholder: undefined,
    };
  }

  if (!selectedRun) {
    return {
      selectedTabId: scopedTabs[0]?.id ?? null,
      unmatchedSelectionMessage: null,
      unmatchedSelectPlaceholder: undefined,
    };
  }

  const matchedTabId = runToTabId.get(selectedRun.id) ?? null;
  if (matchedTabId && scopedTabs.some((t) => t.id === matchedTabId)) {
    return {
      selectedTabId: matchedTabId,
      unmatchedSelectionMessage: null,
      unmatchedSelectPlaceholder: undefined,
    };
  }

  if (selectedRun.triggeredBy.startsWith('deploy:')) {
    return {
      selectedTabId: null,
      unmatchedSelectPlaceholder: `Ran in Release Pipeline (${selectedRun.triggeredBy})`,
      unmatchedSelectionMessage: `Executed as post-deploy gate (${selectedRun.triggeredBy}) — full container build & smoke output lives in Releases & Drift. Select any session on the right to inspect standalone smoke streams.`,
    };
  }

  return {
    selectedTabId: null,
    unmatchedSelectPlaceholder: 'No stream captured for selected run',
    unmatchedSelectionMessage: `No standalone console stream was captured for ${formatRunTimestamp(
      selectedRun.timestamp
    )} (${selectedRun.triggeredBy}). Select any session on the right to inspect captured streams.`,
  };
}

export const SmokeTestsView: React.FC<SmokeTestsViewProps> = ({
  runs,
  isRunning,
  terminalTabs = [],
  onRunNow,
  onRefreshHistory,
  onRegisterOsSchedule,
  onOpenInBottomConsole,
  onAbortJob,
  onClearTab,
  scheduleSlots = ['08:00', '13:00', '17:00', '22:00'],
  lastError,
}) => {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [manualTabOverrideId, setManualTabOverrideId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isRunDropdownOpen, setIsRunDropdownOpen] = useState<boolean>(false);
  const [historyMode, setHistoryMode] = useState<'last10' | 'last7days'>('last10');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const PAGE_SIZE = 10;
  const prevRunningTabIdRef = useRef<string | null>(null);

  const scopedSmokeTabs = useMemo(
    () => filterTabsForScope(terminalTabs, 'smoke'),
    [terminalTabs]
  );

  const { runToTabId, tabToRunId } = useMemo(
    () => correlateSmokeRunsAndStreams(runs, scopedSmokeTabs),
    [runs, scopedSmokeTabs]
  );

  const selectedRun = useMemo(() => {
    if (runs.length === 0) return null;
    if (selectedRunId) {
      const match = runs.find((r) => r.id === selectedRunId);
      if (match) return match;
    }
    return runs[0];
  }, [runs, selectedRunId]);

  const effectiveStream = useMemo(
    () =>
      resolveEffectiveSmokeStreamState({
        selectedRun,
        scopedTabs: scopedSmokeTabs,
        runToTabId,
        manualTabOverrideId,
      }),
    [selectedRun, scopedSmokeTabs, runToTabId, manualTabOverrideId]
  );

  useEffect(() => {
    const runningTab = scopedSmokeTabs.find((t) => t.isRunning) ?? null;
    const runningId = runningTab?.id ?? null;
    if (runningId && runningId !== prevRunningTabIdRef.current) {
      setManualTabOverrideId(runningId);
      if (runningTab && isSmokeSuiteStreamTab(runningTab)) {
        setSelectedRunId(null);
        setCurrentPage(1);
      }
    }
    prevRunningTabIdRef.current = runningId;
  }, [scopedSmokeTabs]);

  useEffect(() => {
    if (!manualTabOverrideId) return;
    const overrideTab = scopedSmokeTabs.find((t) => t.id === manualTabOverrideId);
    if (!overrideTab) {
      setManualTabOverrideId(null);
      return;
    }
    if (!overrideTab.isRunning && tabToRunId.has(manualTabOverrideId)) {
      const matchedRunId = tabToRunId.get(manualTabOverrideId)!;
      setSelectedRunId(matchedRunId);
      setManualTabOverrideId(null);
    }
  }, [manualTabOverrideId, scopedSmokeTabs, tabToRunId]);

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
      return runs.slice(0, PAGE_SIZE);
    }
    const sevenDaysAgoMs = Date.now() - SEVEN_DAYS_MS;
    const recent = runs.filter((r) => {
      const ts = parseUtcDate(r.timestamp)?.getTime() ?? NaN;
      return !Number.isNaN(ts) && ts >= sevenDaysAgoMs;
    });
    if (selectedRunId && !recent.some((r) => r.id === selectedRunId)) {
      const explicitRun = runs.find((r) => r.id === selectedRunId);
      if (explicitRun) {
        return [...recent, explicitRun];
      }
    }
    return recent;
  }, [runs, historyMode, selectedRunId]);

  const handleSelectRun = (run: SmokeTestRun) => {
    setSelectedRunId(run.id);
    setManualTabOverrideId(null);
    if (categoryFilter !== 'all' && !run.results.some((r) => r.category === categoryFilter)) {
      setCategoryFilter('all');
    }
  };

  const handleSelectStreamTab = (tabId: string) => {
    const matchedRunId = tabToRunId.get(tabId);
    if (matchedRunId) {
      const matchedRun = runs.find((r) => r.id === matchedRunId);
      if (matchedRun) {
        setSelectedRunId(matchedRun.id);
        setManualTabOverrideId(null);
        if (categoryFilter !== 'all' && !matchedRun.results.some((r) => r.category === categoryFilter)) {
          setCategoryFilter('all');
        }
        const nextView = resolveRunSelectionView(runs, matchedRun.id, historyMode, PAGE_SIZE);
        if (nextView) {
          if (nextView.historyMode !== historyMode) {
            setHistoryMode(nextView.historyMode);
          }
          if (nextView.currentPage !== currentPage) {
            setCurrentPage(nextView.currentPage);
          }
        }
        return;
      }
    }
    setManualTabOverrideId(tabId);
  };

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
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <FlaskConical className="w-6 h-6 text-[var(--color-brand-text)]" />
            Production Smoke Tests
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Automated end-to-end verification of suite health, live outbound notification gate, .env conformance, SSO/JWKS, and Zero-Trust API guards. Runs 4x daily ({scheduleSlots.join(', ')}) and on every deploy.
          </p>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
          <button
            onClick={onRefreshHistory}
            disabled={isRunning}
            className="btn-secondary text-xs inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            onClick={onRegisterOsSchedule}
            disabled={isRunning}
            title="Register 4x/day Windows Task Scheduler job (08:00, 13:00, 17:00, 22:00)"
            className="btn-secondary text-xs inline-flex items-center gap-1.5"
          >
            <CalendarClock className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
            Sync OS Schedule
          </button>
          <div className="relative inline-flex items-stretch">
            <button
              type="button"
              onClick={() => onRunNow(false)}
              disabled={isRunning}
              title="Run smoke suite (smart-gated: reuses recent live SMS if auth/spendy/basket unchanged within 8h)"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 min-h-[44px] sm:min-h-[38px] rounded-l-xl text-xs font-semibold bg-[var(--color-brand)] hover:bg-[var(--color-brand-hover)] text-[var(--color-on-brand)] shadow-sm whitespace-nowrap flex-shrink-0 transition-colors cursor-pointer disabled:opacity-50"
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
              className="inline-flex items-center justify-center w-8 min-h-[44px] sm:min-h-[38px] rounded-r-xl text-xs font-semibold bg-[var(--color-brand)] hover:bg-[var(--color-brand-hover)] text-[var(--color-on-brand)] border-l border-black/15 dark:border-white/15 shadow-sm transition-colors cursor-pointer disabled:opacity-50 shrink-0"
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
                  <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Smoke Suite Actions
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsRunDropdownOpen(false);
                      onRunNow(false);
                    }}
                    className="w-full px-3 py-2 text-xs flex items-center gap-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 text-[var(--color-brand-text)] shrink-0" />
                    <div className="text-left">
                      <div className="font-semibold">Run Smoke Suite</div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">
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
                    <Sparkles className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
                    <div className="text-left">
                      <div className="font-semibold flex items-center gap-1.5">
                        <MessageSquare className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                        Force Live E2E SMS
                      </div>
                      <div className="text-[10px] text-emerald-700/80 dark:text-emerald-400/80">
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
        <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-xs text-rose-700 dark:text-rose-200">
          <span className="font-semibold">Smoke Runner Error:</span> {lastError}
        </div>
      )}

      {/* KPI Summary Cards (Position 2) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
          <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">Latest Status</div>
          <div className="mt-2 flex items-center gap-2">
            {latestAllPass === null ? (
              <span className="text-lg font-bold text-slate-500 dark:text-slate-400">No Runs Yet</span>
            ) : latestAllPass ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400">ALL PASS</span>
              </>
            ) : (
              <>
                <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                <span className="text-lg font-bold text-rose-700 dark:text-rose-400">{latestRun?.failed} FAILING</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
            {latestRun ? `${latestRun.passed}/${latestRun.total} checks passed` : 'Click Run Smoke Tests'}
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
          <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">Last Execution</div>
          <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
            {latestRun ? formatRunTimestamp(latestRun.timestamp) : '—'}
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
            Trigger: <span className="text-slate-800 dark:text-slate-300 font-mono">{latestRun?.triggeredBy || '—'}</span>
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
          <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">4x Daily Schedule</div>
          <div className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Clock className="w-4 h-4 text-[var(--color-brand-text)]" />
            <span>{getNextScheduleSlot(scheduleSlots)}</span>
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 font-mono">{scheduleSlots.join(' • ')}</div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
          <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">Deploy Gate</div>
          <div className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="w-4 h-4" />
            <span>Auto-Revert Armed</span>
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">Failed smoke gate reverts container</div>
        </div>
      </div>

      {/* Main Split (Position 3): Run History (Left) + Check Breakdown (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Recent Runs */}
        <div className="lg:col-span-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider tabular-nums">
              Recent Runs ({filteredRuns.length})
            </h2>
            <SegmentedControl<'last10' | 'last7days'>
              activeVariant="brand"
              size="sm"
              value={historyMode}
              onChange={(val) => {
                setHistoryMode(val);
                setCurrentPage(1);
                if (val === 'last10' && selectedRunId && !runs.slice(0, PAGE_SIZE).some((r) => r.id === selectedRunId)) {
                  setSelectedRunId(null);
                  setManualTabOverrideId(null);
                }
              }}
              options={[
                { value: 'last10', label: 'Last 10' },
                { value: 'last7days', label: 'Last 7 Days' },
              ]}
            />
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[520px] overflow-y-auto flex-1">
            {filteredRuns.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-600 dark:text-slate-400">
                {runs.length === 0
                  ? 'No smoke test runs recorded yet.'
                  : 'No smoke test runs recorded in the last 7 days.'}
              </div>
            ) : (
              paginatedRuns.map((run) => {
                const isSelected = selectedRun?.id === run.id;
                const ok = run.failed === 0;
                const e2eSms = getRunE2eSmsInfo(run);
                return (
                  <button
                    key={run.id}
                    onClick={() => handleSelectRun(run)}
                    className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--color-brand-subtle)] border-l-2 border-[var(--color-brand)]'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${
                          ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
                        }`}
                      >
                        {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                        {run.passed}/{run.total} Passed
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {e2eSms && (
                          <span
                            title={e2eSms.detail}
                            className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap ${
                              e2eSms.status === 'passed'
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                                : 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/40'
                            }`}
                          >
                            <MessageSquare className="w-2.5 h-2.5" />
                            {e2eSms.status === 'passed' ? 'E2E SMS' : 'E2E SMS FAIL'}
                          </span>
                        )}
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {run.triggeredBy}
                        </span>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 tabular-nums">{formatRunTimestamp(run.timestamp)}</div>
                  </button>
                );
              })
            )}
          </div>
          {filteredRuns.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
              <span className="font-mono">
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredRuns.length)} of{' '}
                {filteredRuns.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-0.5 px-2.5 py-1 min-h-[32px] rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Prev
                </button>
                <span className="px-2 font-mono text-slate-700 dark:text-slate-300">
                  {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-0.5 px-2.5 py-1 min-h-[32px] rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Selected Run Checks */}
        <div className="lg:col-span-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider tabular-nums">
                Check Results {selectedRun ? `• ${formatRunTimestamp(selectedRun.timestamp)}` : ''}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2.5 py-1 min-h-[32px] rounded-lg text-[11px] font-medium capitalize cursor-pointer transition-colors ${
                    categoryFilter === cat
                      ? 'bg-[var(--color-brand)] text-[var(--color-on-brand)] shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[520px] overflow-y-auto">
            {!selectedRun ? (
              <div className="p-8 text-center text-xs text-slate-600 dark:text-slate-400">
                Select or run a smoke test to inspect individual assertions.
              </div>
            ) : (
              filteredChecks.map((chk, idx) => (
                <div key={`${chk.name}-${idx}`} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {chk.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">{chk.name}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          {chk.category}
                        </span>
                      </div>
                      <p
                        className={`text-[11px] mt-0.5 break-words ${
                          chk.passed ? 'text-slate-600 dark:text-slate-400' : 'text-rose-700 dark:text-rose-300 font-medium'
                        }`}
                      >
                        {chk.detail}
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap shrink-0 tabular-nums">
                    {chk.durationMs}ms
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Position 4 (Page Bottom): Standardized Work Stream Container */}
      <WorkStreamContainer
        pageScope="smoke"
        title="Smoke Test Execution Stream"
        description="Live verification output for Production Smoke Tests, OS task scheduling, and MCP-triggered runs."
        tabs={terminalTabs}
        selectedTabId={effectiveStream.selectedTabId}
        onSelectTab={handleSelectStreamTab}
        unmatchedSelectionMessage={effectiveStream.unmatchedSelectionMessage}
        unmatchedSelectPlaceholder={effectiveStream.unmatchedSelectPlaceholder}
        onOpenInBottomConsole={onOpenInBottomConsole}
        onAbortJob={onAbortJob}
        onClearTab={onClearTab}
        emptyHint="Run the Production Smoke Suite, Sync OS Schedule, or Refresh History to inspect output."
      />
    </div>
  );
};
