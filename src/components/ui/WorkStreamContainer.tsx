import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Terminal,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ArrowDownToLine,
  Trash2,
  OctagonX,
  PanelBottom,
  Pin,
  Loader2,
  CheckCircle2,
  XCircle,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { CustomSelect, SelectOption } from './CustomSelect';
import { NavSectionId, TerminalTab } from '../../lib/types';
import {
  filterTabsForScope,
  PAGE_SCOPE_BADGE_LABELS,
} from '../../lib/stream-utils';
import { formatConsoleLine, stripAnsiCodes } from '../layout/ConsoleColorizer';
import { useSmartAutoScroll } from '../../hooks/useSmartAutoScroll';
import { formatLocalTime, formatRelativeTime } from '../../lib/formatters';

export interface StreamStatusMeta {
  state: 'idle' | 'running' | 'completed' | 'failed';
  label: string;
  badgeClass: string;
}

/**
 * Pure status classifier for the anchored work-stream card header and badges.
 */
export function getStreamStatusMeta(activeTab: TerminalTab | null): StreamStatusMeta {
  if (!activeTab) {
    return {
      state: 'idle',
      label: 'STANDBY',
      badgeClass:
        'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    };
  }

  if (activeTab.isRunning) {
    return {
      state: 'running',
      label: 'RUNNING',
      badgeClass:
        'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35',
    };
  }

  const isFailed = activeTab.exitCode !== undefined && activeTab.exitCode !== 0;
  if (isFailed) {
    return {
      state: 'failed',
      label: `FAILED (EXIT ${activeTab.exitCode})`,
      badgeClass:
        'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30',
    };
  }

  return {
    state: 'completed',
    label: activeTab.exitCode === 0 ? 'EXIT 0 • READY' : 'COMPLETED',
    badgeClass:
      'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  };
}

/**
 * Pure transition guard deciding when a scoped work stream automatically opens
 * into Active state. Only opens when a job transitions into running; completed
 * or failed sessions remain expanded until explicitly collapsed by the user.
 */
export function shouldAutoExpandStream(
  prevIsRunning: boolean,
  nextIsRunning: boolean,
  prevSessionId: string | null,
  nextSessionId: string | null
): boolean {
  return nextIsRunning && (!prevIsRunning || prevSessionId !== nextSessionId);
}

export interface WorkStreamContainerProps {
  pageScope: NavSectionId;
  tabs: TerminalTab[];
  title: string;
  description?: string;
  emptyHint?: string;
  appSlugFilter?: string;
  headerExtra?: React.ReactNode;
  progressSlot?:
    | React.ReactNode
    | ((activeTab: TerminalTab | null, scopedTabs: TerminalTab[]) => React.ReactNode);
  onOpenInBottomConsole?: (tabId?: string) => void;
  onAbortJob?: (tabId: string) => void;
  onClearTab?: (tabId: string) => void;
  defaultExpandedOnMount?: boolean;
  expandRequest?: { tabId?: string; nonce: number } | null;
  className?: string;
}

export const WorkStreamContainer: React.FC<WorkStreamContainerProps> = ({
  pageScope,
  tabs,
  title,
  description,
  emptyHint,
  appSlugFilter,
  headerExtra,
  progressSlot,
  onOpenInBottomConsole,
  onAbortJob,
  onClearTab,
  defaultExpandedOnMount = false,
  expandRequest = null,
  className = '',
}) => {
  const scopedTabs = useMemo(
    () => filterTabsForScope(tabs, pageScope, appSlugFilter),
    [tabs, pageScope, appSlugFilter]
  );

  const runningScopedTab = useMemo(
    () => scopedTabs.find((tab) => tab.isRunning) ?? null,
    [scopedTabs]
  );

  const [selectedTabId, setSelectedTabId] = useState<string | null>(
    () => runningScopedTab?.id ?? scopedTabs[0]?.id ?? null
  );
  const [isExpanded, setIsExpanded] = useState<boolean>(
    () => Boolean(defaultExpandedOnMount) || Boolean(runningScopedTab)
  );
  const [isTall, setIsTall] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRunningStateRef = useRef<{ isRunning: boolean; id: string | null }>({
    isRunning: Boolean(runningScopedTab),
    id: runningScopedTab?.id ?? null,
  });

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!expandRequest) return;
    if (expandRequest.tabId && scopedTabs.some((t) => t.id === expandRequest.tabId)) {
      setSelectedTabId(expandRequest.tabId);
    }
    setIsExpanded(true);
  }, [expandRequest?.nonce]);

  // Synchronize selected session & auto-expand when a new job starts streaming
  useEffect(() => {
    const currentRunning = scopedTabs.find((t) => t.isRunning) ?? null;
    const prev = prevRunningStateRef.current;

    if (
      shouldAutoExpandStream(
        prev.isRunning,
        Boolean(currentRunning),
        prev.id,
        currentRunning?.id ?? null
      )
    ) {
      if (currentRunning) {
        setSelectedTabId(currentRunning.id);
      }
      setIsExpanded(true);
    }

    prevRunningStateRef.current = {
      isRunning: Boolean(currentRunning),
      id: currentRunning?.id ?? null,
    };

    setSelectedTabId((prevSelected) => {
      if (prevSelected && scopedTabs.some((t) => t.id === prevSelected)) {
        return prevSelected;
      }
      return currentRunning?.id ?? scopedTabs[0]?.id ?? null;
    });
  }, [scopedTabs]);

  const activeTab = useMemo(() => {
    if (scopedTabs.length === 0) return null;
    return scopedTabs.find((t) => t.id === selectedTabId) ?? scopedTabs[0];
  }, [scopedTabs, selectedTabId]);

  const {
    containerRef,
    isPinned,
    unseenCount,
    handleScroll,
    pinToBottom,
  } = useSmartAutoScroll({
    lineCount: activeTab?.lines.length ?? 0,
    isActive: isExpanded,
    sessionKey: activeTab?.id,
  });

  const handleCopyOutput = useCallback(async () => {
    if (!activeTab || activeTab.lines.length === 0) return;
    const plainText = stripAnsiCodes(activeTab.lines.join('\n'));
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Clipboard copy failed:', err);
    }
  }, [activeTab]);

  const statusMeta = getStreamStatusMeta(activeTab);
  const scopeBadgeLabel = PAGE_SCOPE_BADGE_LABELS[pageScope] || pageScope.toUpperCase();

  const sessionOptions: SelectOption[] = useMemo(
    () =>
      scopedTabs.map((tab) => {
        const prefix = tab.isRunning ? '[LIVE] ' : '';
        const sourceTag =
          tab.source && tab.source !== 'ui' ? ` • ${tab.source.toUpperCase()}` : '';
        return {
          value: tab.id,
          label: `${prefix}${tab.title}`,
          description: `${tab.lines.length} lines${sourceTag}${
            tab.finishedAt || tab.createdAt
              ? ` • ${formatLocalTime(tab.finishedAt || tab.createdAt)}`
              : ''
          }`,
        };
      }),
    [scopedTabs]
  );

  const resolvedProgressSlot = useMemo(() => {
    if (!progressSlot) return null;
    return typeof progressSlot === 'function'
      ? progressSlot(activeTab, scopedTabs)
      : progressSlot;
  }, [progressSlot, activeTab, scopedTabs]);

  const helperCaption =
    emptyHint ||
    description ||
    'Real-time execution telemetry anchored to this workspace. Full history always streams to the Bottom Console.';

  const timestampDisplay = activeTab?.finishedAt || activeTab?.createdAt;

  return (
    <section
      aria-label={title}
      data-stream-scope={pageScope}
      data-stream-state={isExpanded ? 'active' : 'rest'}
      className={`rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden transition-colors ${className}`}
    >
      {/* Anchored Header (Always visible in both Rest & Active states) */}
      <div className="px-4 py-3.5 sm:px-5 flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          {/* Left Identity & Status Metadata */}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-emerald-600 dark:text-emerald-400 shrink-0">
                <Terminal className="w-3.5 h-3.5" />
              </span>

              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                {title}
              </h3>

              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold tracking-wider uppercase bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                {scopeBadgeLabel}
              </span>

              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${statusMeta.badgeClass}`}
              >
                {statusMeta.state === 'running' ? (
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                ) : statusMeta.state === 'failed' ? (
                  <XCircle className="w-3 h-3 shrink-0" />
                ) : statusMeta.state === 'completed' ? (
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
                )}
                <span>{statusMeta.label}</span>
              </span>

              {activeTab?.source && activeTab.source !== 'ui' && (
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/25">
                  {activeTab.source}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              {activeTab ? (
                <>
                  <span className="font-medium text-slate-700 dark:text-slate-300 truncate max-w-md">
                    {activeTab.title}
                  </span>
                  <span className="font-mono text-[11px]">
                    {activeTab.lines.length} {activeTab.lines.length === 1 ? 'line' : 'lines'}
                  </span>
                  {timestampDisplay && (
                    <span
                      className="font-mono text-[11px]"
                      title={formatLocalTime(timestampDisplay)}
                    >
                      {formatRelativeTime(timestampDisplay)}
                    </span>
                  )}
                  {scopedTabs.length > 1 && (
                    <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
                      ({scopedTabs.length} sessions)
                    </span>
                  )}
                </>
              ) : (
                <span>{helperCaption}</span>
              )}
            </div>
          </div>

          {/* Right Controls Bar (Guaranteed non-wrapping buttons & zero native <select>) */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
            {scopedTabs.length > 0 && (
              <div className="w-56 sm:w-64 shrink-0">
                <CustomSelect
                  value={activeTab?.id ?? ''}
                  options={sessionOptions}
                  onChange={(val) => setSelectedTabId(val)}
                  placeholder="Select stream session..."
                />
              </div>
            )}

            <button
              type="button"
              onClick={handleCopyOutput}
              disabled={!activeTab || activeTab.lines.length === 0}
              className={`min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors inline-flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 ${
                copied
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 disabled:opacity-45 disabled:pointer-events-none'
              }`}
              title="Copy ANSI-stripped output to clipboard for debugging"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 shrink-0" />
                  <span>Copy Output</span>
                </>
              )}
            </button>

            {onOpenInBottomConsole && (
              <button
                type="button"
                onClick={() => onOpenInBottomConsole(activeTab?.id)}
                className="min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                title="Open this workspace stream in the global Bottom Console backstop"
              >
                <PanelBottom className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />
                <span>Bottom Console</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              aria-expanded={isExpanded}
              className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors inline-flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 ${
                isExpanded
                  ? 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 shadow-xs'
              }`}
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                  <span>Collapse</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                  <span>Show Stream</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Optional per-page filter pills or contextual badges */}
        {headerExtra && <div className="pt-1">{headerExtra}</div>}
      </div>

      {/* Active State Surface (Strictly omitted in Rest state) */}
      {isExpanded && (
        <div className="border-t border-slate-200 dark:border-slate-800">
          {/* Optional structured progress/stage visualizer (Release Pipeline / SSL Matrix) */}
          {resolvedProgressSlot && (
            <div className="px-4 py-3.5 sm:px-5 bg-slate-50/70 dark:bg-slate-950/40 border-b border-slate-200 dark:border-slate-800">
              {resolvedProgressSlot}
            </div>
          )}

          {/* Active Stream Controls Toolbar */}
          <div className="px-4 py-2 bg-slate-100/90 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-600 dark:text-slate-400">
              <span>{description || 'Structured output work stream'}</span>
            </div>

            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <button
                type="button"
                onClick={pinToBottom}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors inline-flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 ${
                  isPinned
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35'
                    : 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40 hover:bg-amber-500/25'
                }`}
                title={
                  isPinned
                    ? 'Auto-scroll pinned to newest output lines (scroll up anytime to pause)'
                    : 'Scroll paused — click to re-pin to the bottom of stream'
                }
              >
                {isPinned ? (
                  <>
                    <Pin className="w-3 h-3 shrink-0" />
                    <span>Pinned</span>
                  </>
                ) : (
                  <>
                    <ArrowDownToLine className="w-3 h-3 shrink-0" />
                    <span>
                      Pin to Bottom{unseenCount > 0 ? ` (${unseenCount})` : ''}
                    </span>
                  </>
                )}
              </button>

              {activeTab?.isRunning && activeTab.abortable !== false && onAbortJob && (
                <button
                  type="button"
                  onClick={() => onAbortJob(activeTab.id)}
                  className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-700 dark:text-rose-300 border border-rose-500/35 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                  title="Abort running command process"
                >
                  <OctagonX className="w-3 h-3 shrink-0" />
                  <span>Abort</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsTall((prev) => !prev)}
                className="px-2 py-1 rounded-md text-[11px] font-medium bg-white dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors inline-flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                title={isTall ? 'Switch to compact stream height' : 'Expand stream viewport height'}
              >
                {isTall ? (
                  <>
                    <Minimize2 className="w-3 h-3 shrink-0" />
                    <span>Compact</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3 h-3 shrink-0" />
                    <span>Tall</span>
                  </>
                )}
              </button>

              {activeTab && !activeTab.isRunning && onClearTab && (
                <button
                  type="button"
                  onClick={() => onClearTab(activeTab.id)}
                  className="px-2 py-1 rounded-md text-[11px] font-medium bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 border border-slate-200 dark:border-slate-700 transition-colors inline-flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                  title="Remove completed session from inline stream tabs (remains in historical DB log)"
                >
                  <Trash2 className="w-3 h-3 shrink-0" />
                  <span>Clear</span>
                </button>
              )}
            </div>
          </div>

          {/* Relative Viewport Frame for Smart-Pinned Stream + Floating Jump Pill */}
          <div className="relative bg-slate-50 dark:bg-[#050b14]">
            <div
              ref={containerRef}
              onScroll={handleScroll}
              role="log"
              aria-live="polite"
              className={`${
                isTall ? 'max-h-[520px]' : 'max-h-[300px]'
              } min-h-[160px] overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed select-text space-y-0.5`}
            >
              {activeTab && activeTab.lines.length > 0 ? (
                activeTab.lines.map((line, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 hover:bg-slate-200/40 dark:hover:bg-slate-900/60 px-1 -mx-1 rounded"
                  >
                    <span className="w-8 shrink-0 text-right select-none text-[10px] text-slate-400 dark:text-slate-600 pt-0.5">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                      {formatConsoleLine(line)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-xs font-mono text-slate-500 dark:text-slate-400">
                  {activeTab?.isRunning
                    ? 'Process running — awaiting stdout/stderr lines...'
                    : 'No output captured for this workspace yet. Trigger an action above to stream live execution logs here.'}
                </div>
              )}
            </div>

            {/* Floating Pin-to-Bottom Pill when user intentionally scrolls up */}
            {!isPinned && activeTab && activeTab.lines.length > 0 && (
              <button
                type="button"
                onClick={pinToBottom}
                className="absolute bottom-3 right-4 z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg border border-emerald-400/50 transition-all whitespace-nowrap flex-shrink-0"
              >
                <ArrowDownToLine className="w-3.5 h-3.5 shrink-0" />
                <span>Pin to Bottom</span>
                {unseenCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-white/20 text-[10px] font-mono">
                    {unseenCount} new
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
