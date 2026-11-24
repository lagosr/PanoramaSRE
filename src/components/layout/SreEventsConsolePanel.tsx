import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Terminal as TerminalIcon,
  X,
  Trash2,
  StopCircle,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Bell,
  Clock,
  Radio,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Search,
  ListFilter,
  Pin,
  ArrowDownToLine,
  PanelBottom,
  PanelRight,
  ExternalLink,
} from 'lucide-react';
import { formatConsoleLine, stripAnsiCodes } from './ConsoleColorizer';
import {
  ConsoleAutoOpenMode,
  ConsoleDockSide,
  ConsoleScopeMode,
  NavSectionId,
  NetworkPosture,
  TerminalTab,
} from '../../lib/types';
import {
  getTabCategory,
  getTabFinishedDetails,
  PAGE_SCOPE_BADGE_LABELS,
  inferPageScopeFromJob,
} from '../../lib/stream-utils';
import {
  computeVisibleDockTabs,
  getLastMeaningfulLine,
} from '../../lib/console-dock-policy';
import { useSmartAutoScroll } from '../../hooks/useSmartAutoScroll';

export type { TerminalTab };
export { getTabFinishedDetails };

export interface SystemEventItem {
  id: string;
  timestamp: string;
  message: string;
  type: 'pending' | 'success' | 'error' | 'info';
}

export interface ConsoleActionFeedback {
  message: string;
  type: 'pending' | 'success' | 'error';
}

function getPostureDisplayLabel(posture: NetworkPosture): {
  label: string;
  dotClass: string;
} {
  switch (posture) {
    case 'LAN_DIRECT':
      return {
        label: 'LAN Direct',
        dotClass: 'text-emerald-500 dark:text-emerald-400 animate-pulse',
      };
    case 'WAN_CLOUDFLARE':
      return {
        label: 'WAN Cloudflare',
        dotClass: 'text-amber-500 dark:text-amber-400',
      };
    case 'OFFLINE':
    default:
      return {
        label: 'Host Offline',
        dotClass: 'text-rose-500 dark:text-rose-400',
      };
  }
}

interface ConsoleFooterTickerProps {
  isOpen: boolean;
  networkPosture: NetworkPosture;
  tabs: TerminalTab[];
  runningJobsCount: number;
  autoOpenMode: ConsoleAutoOpenMode;
  unreadFailureTabId?: string | null;
  actionFeedback?: ConsoleActionFeedback | null;
  onClearFeedback?: () => void;
  onToggleDrawer: () => void;
  onAbortJob: (id: string) => void;
  onInspectUnreadFailure?: (tabId: string) => void;
}

/**
 * Permanent 36px full-width bottom status bar & Live Activity Ticker.
 * Surfaces running CLI pipelines quietly for Tier B/C jobs and elevates
 * Tier D non-zero failures without stealing focus unless allowed by auto-open policy.
 */
export const ConsoleFooterTicker: React.FC<ConsoleFooterTickerProps> = ({
  isOpen,
  networkPosture,
  tabs,
  runningJobsCount,
  autoOpenMode,
  unreadFailureTabId,
  actionFeedback,
  onClearFeedback,
  onToggleDrawer,
  onAbortJob,
  onInspectUnreadFailure,
}) => {
  const postureMeta = getPostureDisplayLabel(networkPosture);
  const activeRunningTab = useMemo(() => tabs.find((t) => t.isRunning) ?? null, [tabs]);
  const unreadFailureTab = useMemo(
    () => (unreadFailureTabId ? tabs.find((t) => t.id === unreadFailureTabId) ?? null : null),
    [tabs, unreadFailureTabId]
  );

  const runningScope = activeRunningTab
    ? PAGE_SCOPE_BADGE_LABELS[
        inferPageScopeFromJob(activeRunningTab.id, activeRunningTab.pageScope, activeRunningTab.title)
      ]
    : null;
  const runningPreview = activeRunningTab ? getLastMeaningfulLine(activeRunningTab.lines) : '';

  const failureScope = unreadFailureTab
    ? PAGE_SCOPE_BADGE_LABELS[
        inferPageScopeFromJob(unreadFailureTab.id, unreadFailureTab.pageScope, unreadFailureTab.title)
      ]
    : null;

  const isErrorHighlight = !isOpen && Boolean(unreadFailureTab);
  const autoOpenLabel =
    autoOpenMode === 'smart'
      ? 'Smart'
      : autoOpenMode === 'errors'
      ? 'Errors Only'
      : 'Manual';

  return (
    <footer
      className={`h-9 border-t px-3 flex items-center justify-between gap-3 text-xs font-mono select-none z-50 shrink-0 transition-colors ${
        isErrorHighlight
          ? 'bg-rose-50 dark:bg-rose-950/70 border-rose-500/60'
          : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800'
      }`}
    >
      {/* Left: Truthful WSH Host Posture + Live Activity Ticker */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <div className="flex items-center gap-1.5 shrink-0 bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300">
          <Radio className={`w-3 h-3 shrink-0 ${postureMeta.dotClass}`} />
          <span className="text-[11px] font-semibold">wsh.panoramadr.com</span>
          <span className="hidden sm:inline text-[10px] text-slate-500 dark:text-slate-400">
            ({postureMeta.label})
          </span>
        </div>

        {isErrorHighlight && unreadFailureTab ? (
          <div className="flex items-center gap-1.5 min-w-0 truncate text-rose-800 dark:text-rose-200 font-semibold">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
            <span className="px-1.5 py-0.2 rounded bg-rose-500/20 border border-rose-500/40 text-[10px] font-bold shrink-0">
              {failureScope}
            </span>
            <span className="truncate text-[11px]">
              {unreadFailureTab.title} exited with code {unreadFailureTab.exitCode ?? 1}
            </span>
          </div>
        ) : activeRunningTab ? (
          <div className="flex items-center gap-1.5 min-w-0 truncate">
            <Loader2 className="w-3.5 h-3.5 text-[var(--color-brand-text)] animate-spin shrink-0" />
            <span className="px-1.5 py-0.2 rounded bg-[var(--color-brand-subtle)] border border-[var(--color-brand-ring)] text-[var(--color-brand-text)] text-[10px] font-bold shrink-0">
              {runningScope}
            </span>
            <span className="font-semibold text-slate-800 dark:text-slate-200 text-[11px] shrink-0">
              {activeRunningTab.title}
            </span>
            {runningPreview && (
              <span className="hidden md:inline truncate text-[11px] text-slate-500 dark:text-slate-400">
                · {runningPreview}
              </span>
            )}
          </div>
        ) : actionFeedback ? (
          <div className="flex items-center gap-1.5 min-w-0 truncate">
            {actionFeedback.type === 'pending' && (
              <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin shrink-0" />
            )}
            {actionFeedback.type === 'success' && (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            )}
            {actionFeedback.type === 'error' && (
              <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
            )}
            <span className="truncate text-slate-700 dark:text-slate-300 text-[11px]">
              {actionFeedback.message}
            </span>
            {onClearFeedback && (
              <button
                type="button"
                onClick={onClearFeedback}
                className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors shrink-0 cursor-pointer"
                title="Dismiss message"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ) : (
          <span className="text-slate-500 dark:text-slate-400 text-[11px] truncate">
            Live Activity Ticker: Ready · 0 running jobs
          </span>
        )}
      </div>

      {/* Right: Quick Abort, Auto-Open Policy Badge, Inspect / Toggle Dock */}
      <div className="flex items-center gap-2 shrink-0">
        {!isOpen && activeRunningTab && activeRunningTab.abortable !== false && (
          <button
            type="button"
            onClick={() => onAbortJob(activeRunningTab.id)}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-700 dark:text-rose-300 border border-rose-500/40 text-[10px] font-bold cursor-pointer"
            title={`Abort running job: ${activeRunningTab.title}`}
          >
            <StopCircle className="w-3 h-3" />
            <span>Abort</span>
          </button>
        )}

        <span
          className="hidden lg:inline text-[10px] text-slate-500 dark:text-slate-400"
          title="Keyboard shortcut: Ctrl+`"
        >
          Auto-open: {autoOpenLabel} · Ctrl+`
        </span>

        {isErrorHighlight && unreadFailureTab && onInspectUnreadFailure ? (
          <button
            type="button"
            onClick={() => onInspectUnreadFailure(unreadFailureTab.id)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer shadow-xs"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Inspect Error</span>
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleDrawer}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors text-xs font-medium border cursor-pointer ${
              isOpen
                ? 'bg-[var(--color-brand-subtle)] border-[var(--color-brand-ring)] text-[var(--color-brand-text)] font-semibold'
                : runningJobsCount > 0
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20'
                : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-[var(--color-brand)]'
            }`}
            title="Toggle Unified Output Console Dock (Ctrl+`)"
          >
            <TerminalIcon className="w-3.5 h-3.5" />
            <span>{isOpen ? 'Collapse Console' : 'Unified Console'}</span>
            {tabs.length > 0 && (
              <span
                className={`px-1.5 rounded-full text-[10px] font-bold tabular-nums ${
                  runningJobsCount > 0
                    ? 'bg-emerald-500 text-slate-950 animate-pulse'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {runningJobsCount > 0 ? runningJobsCount : tabs.length}
              </span>
            )}
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </footer>
  );
};

interface SreEventsConsolePanelProps {
  isOpen: boolean;
  onClose: () => void;
  tabs: TerminalTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onClearTab: (id: string) => void;
  onPurgeAllTabs: () => void;
  onAbortJob: (id: string) => void;
  actionFeedback?: ConsoleActionFeedback | null;
  onClearFeedback?: () => void;
  eventsHistory: SystemEventItem[];
  onClearEvents: () => void;
  runningJobsCount: number;
  networkPosture?: NetworkPosture;
  activePageScope?: NavSectionId;
  dockSide?: ConsoleDockSide;
  onChangeDockSide?: (side: ConsoleDockSide) => void;
  canDockRight?: boolean;
  dockHeight?: number;
  onChangeDockHeight?: (px: number) => void;
  dockWidth?: number;
  onChangeDockWidth?: (px: number) => void;
  autoOpenMode?: ConsoleAutoOpenMode;
  onChangeAutoOpenMode?: (mode: ConsoleAutoOpenMode) => void;
  scopeMode?: ConsoleScopeMode;
  onChangeScopeMode?: (mode: ConsoleScopeMode) => void;
  unreadFailureTabId?: string | null;
  onOpenFullSystemLogs?: () => void;
}

export const SreEventsConsolePanel: React.FC<SreEventsConsolePanelProps> = ({
  isOpen,
  onClose,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onClearTab,
  onPurgeAllTabs,
  onAbortJob,
  actionFeedback: _actionFeedback,
  onClearFeedback: _onClearFeedback,
  eventsHistory,
  onClearEvents,
  runningJobsCount: _runningJobsCount,
  networkPosture = 'LAN_DIRECT',
  activePageScope = 'hud',
  dockSide = 'bottom',
  onChangeDockSide,
  canDockRight = true,
  dockHeight = 320,
  onChangeDockHeight,
  dockWidth = 500,
  onChangeDockWidth,
  autoOpenMode = 'smart',
  onChangeAutoOpenMode,
  scopeMode = 'page',
  onChangeScopeMode,
  unreadFailureTabId = null,
  onOpenFullSystemLogs,
}) => {
  const [activeMainSection, setActiveMainSection] = useState<'console' | 'events'>('console');
  const [copiedState, setCopiedState] = useState(false);
  const [eventsCopiedState, setEventsCopiedState] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [inLogFilter, setInLogFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'success' | 'failed'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isDraggingResize, setIsDraggingResize] = useState(false);

  const pickerDropdownRef = useRef<HTMLDivElement>(null);

  const visibleTabs = useMemo(
    () =>
      computeVisibleDockTabs({
        tabs,
        activePageScope,
        scopeMode,
        unreadFailureTabId,
      }),
    [tabs, activePageScope, scopeMode, unreadFailureTabId]
  );

  const activeTab =
    visibleTabs.find((t) => t.id === activeTabId) ||
    visibleTabs[0] ||
    tabs.find((t) => t.id === activeTabId) ||
    tabs[0];

  const pageScopeCount = useMemo(
    () =>
      computeVisibleDockTabs({
        tabs,
        activePageScope,
        scopeMode: 'page',
        unreadFailureTabId,
      }).length,
    [tabs, activePageScope, unreadFailureTabId]
  );

  const {
    containerRef: scrollRef,
    isPinned,
    unseenCount,
    handleScroll: handleConsoleScroll,
    pinToBottom,
  } = useSmartAutoScroll({
    lineCount: activeTab?.lines.length ?? 0,
    isActive: isOpen && activeMainSection === 'console',
    sessionKey: activeTab?.id,
  });

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pickerDropdownRef.current && !pickerDropdownRef.current.contains(event.target as Node)) {
        setIsPickerOpen(false);
      }
    }
    if (isPickerOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isPickerOpen]);

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    tabs.forEach((t) => set.add(getTabCategory(t.title)));
    return Array.from(set);
  }, [tabs]);

  const sortedAllTabs = useMemo(() => {
    return [...tabs].sort((a, b) => {
      if (a.isRunning && !b.isRunning) return -1;
      if (!a.isRunning && b.isRunning) return 1;
      const timeA = getTabFinishedDetails(a).timestampMs;
      const timeB = getTabFinishedDetails(b).timestampMs;
      return timeB - timeA;
    });
  }, [tabs]);

  const filteredPickerTabs = useMemo(() => {
    const pool = scopeMode === 'page' ? visibleTabs : sortedAllTabs;
    return pool.filter((t) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!t.title.toLowerCase().includes(q) && !t.id.toLowerCase().includes(q)) return false;
      }
      if (statusFilter === 'running' && !t.isRunning) return false;
      if (statusFilter === 'failed' && (t.isRunning || t.exitCode === 0)) return false;
      if (statusFilter === 'success' && (t.isRunning || t.exitCode !== 0)) return false;
      if (categoryFilter !== 'all' && getTabCategory(t.title) !== categoryFilter) return false;
      return true;
    });
  }, [scopeMode, visibleTabs, sortedAllTabs, searchQuery, statusFilter, categoryFilter]);

  const filteredLines = useMemo(() => {
    const rawLines = activeTab?.lines || [];
    const q = inLogFilter.trim().toLowerCase();
    return rawLines
      .map((line, index) => ({ line, num: String(index + 1).padStart(3, '0') }))
      .filter((entry) => !q || stripAnsiCodes(entry.line).toLowerCase().includes(q));
  }, [activeTab?.lines, inLogFilter]);

  if (!isOpen) return null;

  const isRightDock = dockSide === 'right' && canDockRight;
  const activeScopeLabel = PAGE_SCOPE_BADGE_LABELS[activePageScope] || 'HUD';
  const postureLabel = getPostureDisplayLabel(networkPosture).label;

  const handleStartResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingResize(true);
    const startY = e.clientY;
    const startX = e.clientX;
    const initialH = dockHeight;
    const initialW = dockWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (isRightDock && onChangeDockWidth) {
        const maxW = Math.round(window.innerWidth * 0.6);
        const nextW = Math.max(360, Math.min(maxW, initialW + (startX - moveEvent.clientX)));
        onChangeDockWidth(nextW);
      } else if (!isRightDock && onChangeDockHeight) {
        const maxH = Math.round(window.innerHeight * 0.8);
        const nextH = Math.max(180, Math.min(maxH, initialH + (startY - moveEvent.clientY)));
        onChangeDockHeight(nextH);
      }
    };

    const onMouseUp = () => {
      setIsDraggingResize(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const applySizePreset = (preset: 'S' | 'M' | 'Full') => {
    if (isRightDock && onChangeDockWidth) {
      if (preset === 'S') onChangeDockWidth(380);
      else if (preset === 'M') onChangeDockWidth(520);
      else onChangeDockWidth(Math.round(window.innerWidth * 0.58));
    } else if (onChangeDockHeight) {
      if (preset === 'S') onChangeDockHeight(220);
      else if (preset === 'M') onChangeDockHeight(340);
      else onChangeDockHeight(Math.round(window.innerHeight * 0.76));
    }
  };

  return (
    <div
      style={isRightDock ? { width: `${dockWidth}px` } : { height: `${dockHeight}px` }}
      className={`bg-white dark:bg-[#050b14] flex ${
        isRightDock ? 'flex-row border-l h-full' : 'flex-col border-t w-full'
      } border-slate-200 dark:border-slate-800 shadow-2xl select-none shrink-0 relative z-40 min-h-0 min-w-0`}
    >
      {/* Draggable Resize Handle */}
      <div
        onMouseDown={handleStartResize}
        title={isRightDock ? 'Drag to resize console width' : 'Drag to resize console height'}
        className={`${
          isRightDock
            ? 'w-1.5 h-full cursor-ew-resize border-r border-slate-200 dark:border-slate-800'
            : 'h-1.5 w-full cursor-ns-resize border-b border-slate-200 dark:border-slate-800 flex items-center justify-center'
        } shrink-0 transition-colors ${
          isDraggingResize
            ? 'bg-[var(--color-brand)]'
            : 'bg-slate-100 dark:bg-slate-900 hover:bg-[var(--color-brand)]/60'
        }`}
      >
        {!isRightDock && (
          <span className="w-12 h-0.5 rounded-full bg-slate-400 dark:bg-slate-600" />
        )}
      </div>

      {/* Main Dock Inner Column */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Top Control Bar: Primary Section Tabs, Scope Filter, Auto-Open Policy, Geometry Controls */}
        <div className="min-h-[42px] py-1 px-3 bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
          {/* Left: Console vs Events + This Page / All Suite Toggle */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveMainSection('console')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  activeMainSection === 'console'
                    ? 'bg-white dark:bg-slate-900 border-[var(--color-brand-ring)] text-[var(--color-brand-text)] shadow-xs'
                    : 'bg-transparent border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <TerminalIcon className="w-3.5 h-3.5" />
                <span>Console</span>
                {tabs.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold tabular-nums bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {tabs.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveMainSection('events')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  activeMainSection === 'events'
                    ? 'bg-white dark:bg-slate-900 border-amber-500/40 text-amber-800 dark:text-amber-300 shadow-xs'
                    : 'bg-transparent border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Bell className="w-3.5 h-3.5" />
                <span>Events</span>
                {eventsHistory.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold tabular-nums bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30">
                    {eventsHistory.length}
                  </span>
                )}
              </button>
            </div>

            {activeMainSection === 'console' && onChangeScopeMode && (
              <div className="inline-flex p-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] font-mono">
                <button
                  type="button"
                  onClick={() => onChangeScopeMode('page')}
                  className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                    scopeMode === 'page'
                      ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)] font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                  title="Filter streams to the current view (running jobs remain pinned)"
                >
                  This Page ({activeScopeLabel}·{pageScopeCount})
                </button>
                <button
                  type="button"
                  onClick={() => onChangeScopeMode('all')}
                  className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                    scopeMode === 'all'
                      ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)] font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                  title="Show streams across all PanoramaSRE views chronologically"
                >
                  All Suite ({tabs.length})
                </button>
              </div>
            )}
          </div>

          {/* Right: Auto-Open Mode Override, Size Presets, Bottom/Right Split Toggle, Close */}
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            {onChangeAutoOpenMode && (
              <div
                className="inline-flex items-center p-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] font-mono"
                title="Control when Unified Console opens automatically"
              >
                <span className="px-1.5 text-slate-500 dark:text-slate-400 hidden sm:inline">
                  Auto-open:
                </span>
                {(
                  [
                    { id: 'smart', label: 'Smart' },
                    { id: 'errors', label: 'Errors' },
                    { id: 'manual', label: 'Manual' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onChangeAutoOpenMode(opt.id)}
                    className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                      autoOpenMode === opt.id
                        ? 'bg-[var(--color-brand)] text-[var(--color-on-brand)] font-bold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            <div className="hidden md:inline-flex p-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] font-mono">
              {(['S', 'M', 'Full'] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applySizePreset(preset)}
                  className="px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  title={`Resize dock preset: ${preset}`}
                >
                  {preset}
                </button>
              ))}
            </div>

            {onChangeDockSide && (
              <div className="inline-flex p-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] font-mono">
                <button
                  type="button"
                  onClick={() => onChangeDockSide('bottom')}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded cursor-pointer ${
                    !isRightDock
                      ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-bold'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                  title="Dock Console at Bottom"
                >
                  <PanelBottom className="w-3 h-3" />
                  <span className="hidden xl:inline">Bottom</span>
                </button>
                <button
                  type="button"
                  disabled={!canDockRight}
                  onClick={() => onChangeDockSide('right')}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${
                    !canDockRight
                      ? 'opacity-40 cursor-not-allowed text-slate-400'
                      : 'cursor-pointer'
                  } ${
                    isRightDock
                      ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-bold'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                  title={
                    canDockRight
                      ? 'Dock Console on Right Split (auto-collapses sidebar under 1600px)'
                      : 'Right split dock requires at least 1280px window width'
                  }
                >
                  <PanelRight className="w-3 h-3" />
                  <span className="hidden xl:inline">Right</span>
                </button>
              </div>
            )}

            <span className="hidden 2xl:inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] font-mono text-slate-600 dark:text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>{postureLabel}</span>
            </span>

            {activeMainSection === 'console' && tabs.length > 0 && (
              <button
                type="button"
                onClick={onPurgeAllTabs}
                className="px-2 py-0.5 rounded text-[10px] font-mono text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 border border-rose-300 dark:border-rose-500/20 transition-colors cursor-pointer"
                title="Delete all console tabs and purge from SQLite"
              >
                Purge
              </button>
            )}

            {activeMainSection === 'events' && eventsHistory.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={async () => {
                    const text = eventsHistory
                      .map((ev) => `[${ev.timestamp}] [${ev.type.toUpperCase()}] ${stripAnsiCodes(ev.message)}`)
                      .join('\n');
                    try {
                      await navigator.clipboard.writeText(text);
                      setEventsCopiedState(true);
                      setTimeout(() => setEventsCopiedState(false), 2000);
                    } catch {
                      // ignore clipboard failure
                    }
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  {eventsCopiedState ? (
                    <Check className="w-3 h-3 text-emerald-500" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{eventsCopiedState ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  type="button"
                  onClick={onClearEvents}
                  className="px-2 py-0.5 rounded text-[10px] font-mono text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  Clear
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors cursor-pointer"
              title="Collapse Console Dock (Ctrl+`)"
              aria-label="Collapse Console Dock"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Row 2: Scoped Session Picker + Quick Session Tabs + Pin/Copy/Abort/Clear/Filter */}
        {activeMainSection === 'console' && (
          <div className="min-h-[36px] py-1 px-3 bg-slate-50 dark:bg-slate-950/90 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0 relative">
            {/* Stream Hub Selector Dropdown */}
            <div className="relative shrink-0" ref={pickerDropdownRef}>
              <button
                type="button"
                onClick={() => setIsPickerOpen(!isPickerOpen)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  isPickerOpen
                    ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-800 dark:text-emerald-300'
                    : 'bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200'
                }`}
                title="Browse console streams with search and category filtering"
              >
                <ListFilter className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="truncate max-w-[180px]">
                  {activeTab ? activeTab.title : 'Select Stream'}
                </span>
                <span className="px-1.5 rounded-full text-[10px] font-mono bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 tabular-nums">
                  {filteredPickerTabs.length}
                </span>
                <ChevronDown
                  className={`w-3 h-3 text-slate-500 transition-transform ${
                    isPickerOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isPickerOpen && (
                <div className="absolute top-9 left-0 z-50 w-96 max-w-[90vw] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-3 flex flex-col space-y-2.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search streams by title or ID..."
                      className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-mono text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-[var(--color-brand)]"
                      autoFocus
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                    {(['all', 'running', 'failed', 'success'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setStatusFilter(st)}
                        className={`px-2 py-0.5 rounded capitalize cursor-pointer ${
                          statusFilter === st
                            ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/40 font-bold'
                            : 'bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-400 border border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>

                  {availableCategories.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono pt-1 border-t border-slate-200 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setCategoryFilter('all')}
                        className={`px-1.5 py-0.5 rounded cursor-pointer ${
                          categoryFilter === 'all'
                            ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/40 font-semibold'
                            : 'bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        All
                      </button>
                      {availableCategories.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setCategoryFilter(c)}
                          className={`px-1.5 py-0.5 rounded truncate max-w-[120px] cursor-pointer ${
                            categoryFilter === c
                              ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/40 font-semibold'
                              : 'bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800'
                          }`}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="max-h-64 overflow-y-auto space-y-1 custom-scrollbar pr-1">
                    {filteredPickerTabs.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-500 italic">
                        No matching streams in current scope.
                      </div>
                    ) : (
                      filteredPickerTabs.map((tab) => {
                        const isSelected = tab.id === activeTab?.id;
                        const category = getTabCategory(tab.title);
                        const finishDetails = getTabFinishedDetails(tab);
                        return (
                          <div
                            key={tab.id}
                            onClick={() => {
                              onSelectTab(tab.id);
                              setIsPickerOpen(false);
                            }}
                            className={`p-2 rounded-lg border cursor-pointer transition-all flex items-center justify-between gap-2 ${
                              isSelected
                                ? 'bg-emerald-500/5 dark:bg-slate-950 border-emerald-500/50'
                                : 'bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {tab.isRunning ? (
                                <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin shrink-0" />
                              ) : tab.exitCode === 0 ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              ) : tab.exitCode !== undefined && tab.exitCode !== 0 ? (
                                <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                              ) : (
                                <TerminalIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              )}
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
                                    {PAGE_SCOPE_BADGE_LABELS[inferPageScopeFromJob(tab.id, tab.pageScope, tab.title)]}
                                  </span>
                                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                                    {tab.title}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono mt-0.5 tabular-nums">
                                  <span>{category}</span>
                                  <span>•</span>
                                  <span>{tab.lines.length} lines</span>
                                  <span>•</span>
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-2.5 h-2.5" />
                                    <span>{finishDetails.label}</span>
                                  </span>
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onCloseTab(tab.id);
                              }}
                              className="p-1 rounded text-slate-400 hover:text-rose-500 cursor-pointer shrink-0"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Scoped Quick Session Pills */}
            <div className="flex items-center gap-1 overflow-x-auto min-w-0 flex-1 custom-scrollbar">
              {visibleTabs.slice(0, 5).map((tab) => {
                const isActive = tab.id === activeTab?.id;
                const scopeBadge =
                  PAGE_SCOPE_BADGE_LABELS[inferPageScopeFromJob(tab.id, tab.pageScope, tab.title)];
                return (
                  <div
                    key={tab.id}
                    onClick={() => onSelectTab(tab.id)}
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs cursor-pointer border transition-colors shrink-0 ${
                      isActive
                        ? 'bg-white dark:bg-slate-900 border-[var(--color-brand-ring)] text-[var(--color-brand-text)] font-semibold shadow-xs'
                        : 'bg-transparent border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-900'
                    }`}
                    title={tab.title}
                  >
                    {tab.isRunning && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                    )}
                    <span className="text-[9px] font-mono font-bold uppercase text-slate-500 dark:text-slate-400">
                      {scopeBadge}
                    </span>
                    <span className="truncate max-w-[140px]">{tab.title}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseTab(tab.id);
                      }}
                      className="text-slate-400 hover:text-rose-500 p-0.5 rounded cursor-pointer"
                      title="Close stream"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Terminal Toolbar: Pin, Copy, Abort, Clear, In-Log Filter */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={pinToBottom}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-mono border transition-colors whitespace-nowrap cursor-pointer ${
                  isPinned
                    ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-500/15 border-amber-500/40 text-amber-800 dark:text-amber-300'
                }`}
              >
                {isPinned ? (
                  <>
                    <Pin className="w-3 h-3 shrink-0" />
                    <span>Pinned</span>
                  </>
                ) : (
                  <>
                    <ArrowDownToLine className="w-3 h-3 shrink-0" />
                    <span>Pin{unseenCount > 0 ? ` (${unseenCount} new)` : ''}</span>
                  </>
                )}
              </button>

              {activeTab && activeTab.lines.length > 0 && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(stripAnsiCodes(activeTab.lines.join('\n')));
                      setCopiedState(true);
                      setTimeout(() => setCopiedState(false), 2000);
                    } catch {
                      // ignore clipboard error
                    }
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-mono bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 cursor-pointer"
                  title="Copy ANSI-stripped output"
                >
                  {copiedState ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-500" />
                      <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              )}

              {activeTab?.isRunning && activeTab.abortable !== false && (
                <button
                  type="button"
                  onClick={() => onAbortJob(activeTab.id)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/40 hover:bg-rose-500/25 text-[11px] font-mono font-semibold cursor-pointer"
                  title="Abort Running Process"
                >
                  <StopCircle className="w-3 h-3" />
                  <span>Abort</span>
                </button>
              )}

              {activeTab && (
                <button
                  type="button"
                  onClick={() => onClearTab(activeTab.id)}
                  className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer"
                  title="Clear current tab"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}

              <div className="relative hidden sm:block">
                <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={inLogFilter}
                  onChange={(e) => setInLogFilter(e.target.value)}
                  placeholder="Filter lines..."
                  className="w-28 lg:w-36 pl-6 pr-2 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-[var(--color-brand)]"
                />
              </div>
            </div>
          </div>
        )}

        {/* Main Body Viewport */}
        {activeMainSection === 'console' ? (
          <div className="relative flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-[#050b14]">
            <div
              ref={scrollRef}
              onScroll={handleConsoleScroll}
              className="flex-1 p-3.5 font-mono text-xs overflow-y-auto space-y-0.5 selection:bg-emerald-500/20 dark:selection:bg-emerald-500/30 select-text"
            >
              {activeTab && filteredLines.length > 0 ? (
                filteredLines.map(({ line, num }) => (
                  <div key={num} className="flex items-start gap-3 leading-relaxed">
                    <span className="text-[11px] text-slate-400 dark:text-slate-600 select-none tabular-nums w-8 text-right shrink-0">
                      {num}
                    </span>
                    <div className="whitespace-pre-wrap break-all flex-1 min-w-0">
                      {formatConsoleLine(line)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-slate-500 dark:text-slate-400 italic py-4">
                  {activeTab && activeTab.lines.length > 0
                    ? `No lines matching "${inLogFilter}".`
                    : scopeMode === 'page' && visibleTabs.length === 0
                    ? `No streams recorded for ${activeScopeLabel} yet — switch to "All Suite" or launch an action.`
                    : 'No output in stream.'}
                </div>
              )}
            </div>

            {!isPinned && activeTab && activeTab.lines.length > 0 && (
              <button
                type="button"
                onClick={pinToBottom}
                className="absolute bottom-3 right-4 z-10 inline-flex items-center gap-1.5 min-h-[34px] px-3 py-1 rounded-full text-xs font-semibold bg-[var(--color-brand)] hover:bg-[var(--color-brand-hover)] text-[var(--color-on-brand)] shadow-lg cursor-pointer"
              >
                <ArrowDownToLine className="w-3.5 h-3.5 shrink-0" />
                <span>Pin to Bottom</span>
                {unseenCount > 0 && (
                  <span className="px-1.5 rounded-full bg-black/15 text-[10px] font-mono tabular-nums">
                    {unseenCount} new
                  </span>
                )}
              </button>
            )}
          </div>
        ) : (
          <div className="flex-1 p-4 font-mono text-xs overflow-y-auto space-y-2.5 select-text bg-slate-50 dark:bg-[#050b14]">
            <div className="flex items-center justify-between gap-2 pb-1">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Session Event Feed ({eventsHistory.length})
              </span>
              {onOpenFullSystemLogs && (
                <button
                  type="button"
                  onClick={onOpenFullSystemLogs}
                  className="inline-flex items-center gap-1 text-xs font-sans font-semibold text-[var(--color-brand-text)] hover:underline cursor-pointer"
                >
                  <span>Open Full System Logs (sre.sqlite)</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              )}
            </div>
            {eventsHistory.length > 0 ? (
              eventsHistory.map((ev) => (
                <div
                  key={ev.id}
                  className={`p-3 rounded-xl border flex items-start gap-3 ${
                    ev.type === 'error'
                      ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 text-rose-800 dark:text-rose-300'
                      : ev.type === 'pending'
                      ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-800 dark:text-amber-300'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                  }`}
                >
                  <div className="shrink-0 mt-0.5">
                    {ev.type === 'pending' && <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />}
                    {ev.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                    {ev.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-500" />}
                    {ev.type === 'info' && <Bell className="w-4 h-4 text-sky-500" />}
                  </div>
                  <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                    <span className="font-semibold truncate">{ev.message}</span>
                    <span className="text-[10px] text-slate-500 shrink-0 flex items-center gap-1 tabular-nums">
                      <Clock className="w-2.5 h-2.5" />
                      {ev.timestamp}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-slate-500 dark:text-slate-400 italic text-center p-8">
                No notifications or events recorded yet.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
