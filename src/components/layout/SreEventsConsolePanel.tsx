import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Terminal as TerminalIcon, 
  X, 
  Maximize2, 
  Minimize2, 
  Trash2, 
  StopCircle, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Bell,
  Clock,
  Radio,
  ChevronDown,
  Copy,
  Check,
  Search,
  ListFilter,
  Pin,
  ArrowDownToLine
} from 'lucide-react';
import { formatConsoleLine, stripAnsiCodes } from './ConsoleColorizer';
import { TerminalTab } from '../../lib/types';
import {
  getTabCategory,
  getTabFinishedDetails,
  PAGE_SCOPE_BADGE_LABELS,
  inferPageScopeFromJob,
} from '../../lib/stream-utils';
import { useSmartAutoScroll } from '../../hooks/useSmartAutoScroll';

export type { TerminalTab };
export { getTabFinishedDetails };

export interface SystemEventItem {
  id: string;
  timestamp: string;
  message: string;
  type: 'pending' | 'success' | 'error' | 'info';
}

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
  actionFeedback?: {
    message: string;
    type: 'pending' | 'success' | 'error';
  } | null;
  onClearFeedback?: () => void;
  eventsHistory: SystemEventItem[];
  onClearEvents: () => void;
  runningJobsCount: number;
  onToggleDrawer: () => void;
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
  actionFeedback,
  onClearFeedback,
  eventsHistory,
  onClearEvents,
  runningJobsCount,
  onToggleDrawer,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeMainSection, setActiveMainSection] = useState<'console' | 'events'>('console');
  const [copiedState, setCopiedState] = useState(false);
  const [eventsCopiedState, setEventsCopiedState] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'success' | 'failed'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  
  const pickerDropdownRef = useRef<HTMLDivElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

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

  // Close picker dropdown on click outside
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

  // Derived categories from existing tabs
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    tabs.forEach((t) => set.add(getTabCategory(t.title)));
    return Array.from(set);
  }, [tabs]);

  // Sorted tabs: newest at the top, running processes prioritized
  const sortedTabs = useMemo(() => {
    return [...tabs].sort((a, b) => {
      if (a.isRunning && !b.isRunning) return -1;
      if (!a.isRunning && b.isRunning) return 1;
      const timeA = getTabFinishedDetails(a).timestampMs;
      const timeB = getTabFinishedDetails(b).timestampMs;
      return timeB - timeA;
    });
  }, [tabs]);

  // Filtered and searched tabs for the picker dropdown
  const filteredTabs = useMemo(() => {
    return sortedTabs.filter((t) => {
      // Search match
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = t.title.toLowerCase().includes(q);
        const matchesId = t.id.toLowerCase().includes(q);
        if (!matchesTitle && !matchesId) return false;
      }
      // Status filter
      if (statusFilter === 'running' && !t.isRunning) return false;
      if (statusFilter === 'failed' && (t.isRunning || t.exitCode === 0)) return false;
      if (statusFilter === 'success' && (t.isRunning || t.exitCode !== 0)) return false;
      // Category filter
      if (categoryFilter !== 'all' && getTabCategory(t.title) !== categoryFilter) return false;

      return true;
    });
  }, [sortedTabs, searchQuery, statusFilter, categoryFilter]);

  // When drawer is closed, render only the bottom status bar trigger
  if (!isOpen) {
    return (
      <footer className="h-8 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 px-3 flex items-center justify-between text-xs font-mono select-none z-50 shrink-0">
        {/* Left: Host indicator + action status */}
        <div className="flex items-center space-x-3 min-w-0 flex-1 mr-4">
          <div className="flex items-center space-x-1.5 shrink-0 bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300">
            <Radio className="w-3 h-3 text-emerald-500 dark:text-emerald-400 animate-pulse shrink-0" />
            <span className="text-[11px] font-semibold">wsh.panoramadr.com</span>
            <span className="text-[10px] text-slate-500">(LAN Direct)</span>
          </div>

          {actionFeedback ? (
            <div className="flex items-center space-x-1.5 truncate">
              {actionFeedback.type === 'pending' && (
                <Loader2 className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 animate-spin shrink-0" />
              )}
              {actionFeedback.type === 'success' && (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />
              )}
              {actionFeedback.type === 'error' && (
                <AlertCircle className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400 shrink-0" />
              )}
              <span className="truncate text-slate-700 dark:text-slate-300 text-[11px]">{actionFeedback.message}</span>
              {onClearFeedback && (
                <button
                  type="button"
                  onClick={onClearFeedback}
                  className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors shrink-0"
                  title="Dismiss message"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ) : (
            <span className="text-slate-500 dark:text-slate-400 text-[11px] truncate">Ready • SRE Telemetry Active</span>
          )}
        </div>

        {/* Right: Drawer toggle pill */}
        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={onToggleDrawer}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded transition-colors text-xs font-medium border ${
              runningJobsCount > 0
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20'
                : 'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900'
            }`}
            title="Open Console & Events (Ctrl+` or click)"
          >
            <TerminalIcon className="w-3.5 h-3.5" />
            <span>Console & Events</span>
            {tabs.length > 0 && (
              <span
                className={`px-1.5 rounded-full text-[10px] font-bold ${
                  runningJobsCount > 0 ? 'bg-emerald-500 text-black animate-pulse' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {runningJobsCount > 0 ? runningJobsCount : tabs.length}
              </span>
            )}
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </footer>
    );
  }

  // When drawer is OPEN: pushes the upper content naturally rather than rendering on top
  return (
    <div
      className={`bg-white dark:bg-[#050b14] border-t border-slate-200 dark:border-slate-800 flex flex-col shadow-2xl transition-all duration-200 select-none ${
        isExpanded ? 'fixed inset-0 z-[60] h-full' : 'shrink-0 h-88 w-full relative z-50'
      }`}
    >
      {/* Top Main Section Switcher & Window Control Bar */}
      <div className="h-10 bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-3 shrink-0 gap-3">
        {/* Left: Primary Section Tabs (Terminal Console vs Notification & Events) */}
        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={() => setActiveMainSection('console')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              activeMainSection === 'console'
                ? 'bg-white dark:bg-slate-900 border-emerald-600/40 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-400 shadow-sm'
                : 'bg-transparent border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-900/40'
            }`}
          >
            <TerminalIcon className="w-3.5 h-3.5" />
            <span>Console Stream</span>
            {tabs.length > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                runningJobsCount > 0
                  ? 'bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-400'
              }`}>
                {tabs.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveMainSection('events')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              activeMainSection === 'events'
                ? 'bg-white dark:bg-slate-900 border-amber-600/40 dark:border-amber-500/40 text-amber-700 dark:text-amber-400 shadow-sm'
                : 'bg-transparent border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-900/40'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Events & Notifications</span>
            {eventsHistory.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500/15 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                {eventsHistory.length}
              </span>
            )}
          </button>
        </div>

        {/* Center: Live Action Indicator Pill */}
        {actionFeedback && (
          <div
            className={`hidden md:flex items-center space-x-1.5 px-2.5 py-1 rounded text-xs border font-medium truncate max-w-sm ${
              actionFeedback.type === 'pending'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                : actionFeedback.type === 'error'
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
            }`}
            title={actionFeedback.message}
          >
            {actionFeedback.type === 'pending' && (
              <Loader2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 animate-spin shrink-0" />
            )}
            {actionFeedback.type === 'success' && (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            )}
            {actionFeedback.type === 'error' && (
              <AlertCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            <span className="truncate">{actionFeedback.message}</span>
            {onClearFeedback && (
              <button
                type="button"
                onClick={onClearFeedback}
                className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors shrink-0 ml-1"
                title="Dismiss message"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* Right: Host Badge & Global Window Controls */}
        <div className="flex items-center space-x-2 shrink-0">
          <div className="hidden lg:flex items-center space-x-1.5 px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
            <span>wsh.panoramadr.com</span>
          </div>

          {activeMainSection === 'console' && tabs.length > 0 && (
            <button
              onClick={onPurgeAllTabs}
              className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 border border-rose-300 dark:border-rose-500/20 transition-colors"
              title="Delete all console tabs and purge from database"
            >
              <span>Purge All</span>
            </button>
          )}

          {activeMainSection === 'events' && eventsHistory.length > 0 && (
            <div className="flex items-center space-x-1.5">
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
                  } catch (err) {
                    console.warn('Failed to copy events:', err);
                  }
                }}
                className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 transition-colors shadow-xs whitespace-nowrap flex-shrink-0"
                title="Copy events ledger to clipboard"
              >
                {eventsCopiedState ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-emerald-700 dark:text-emerald-400 font-semibold">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                    <span>Copy Events</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onClearEvents}
                className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700/60 transition-colors whitespace-nowrap flex-shrink-0"
                title="Clear event history log"
              >
                <span>Clear Events</span>
              </button>
            </div>
          )}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
            title={isExpanded ? 'Restore' : 'Maximize'}
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
            title="Close Panel (X)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Sub-Header for Console Stream Tabs with High-Density Selector */}
      {activeMainSection === 'console' && (
        <div className="h-8 bg-slate-50 dark:bg-slate-950/90 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-3 shrink-0 gap-2 relative">
          {/* High-Scale Stream Hub Selector Dropdown Button */}
          <div className="relative shrink-0" ref={pickerDropdownRef}>
            <button
              onClick={() => setIsPickerOpen(!isPickerOpen)}
              className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-semibold border transition-all ${
                isPickerOpen
                  ? 'bg-emerald-500/15 dark:bg-emerald-500/20 border-emerald-500/50 text-emerald-800 dark:text-emerald-300'
                  : 'bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200'
              }`}
              title="Browse all console streams with search and filtering"
            >
              <ListFilter className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="truncate max-w-[200px]">
                {activeTab ? activeTab.title : 'Select Stream'}
              </span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-400 ml-1">
                {tabs.length}
              </span>
              <ChevronDown className={`w-3 h-3 text-slate-500 dark:text-slate-400 transition-transform ${isPickerOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* High-Density Stream Hub Overlay (Handles 100s of streams) */}
            {isPickerOpen && (
              <div className="absolute top-8 left-0 z-50 w-96 max-w-[90vw] bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-3 flex flex-col space-y-2.5 animate-fadeIn">
                {/* Search Bar */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search streams by title or command..."
                    className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-mono text-slate-900 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50"
                    autoFocus
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Filter Pills Bar */}
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                  {(['all', 'running', 'failed', 'success'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`px-2 py-0.5 rounded capitalize transition-colors ${
                        statusFilter === st
                          ? 'bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-500/40 font-bold'
                          : 'bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>

                {/* Category Pills Bar */}
                {availableCategories.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono pt-1 border-t border-slate-200 dark:border-slate-900">
                    <span className="text-slate-500 text-[10px]">Category:</span>
                    <button
                      type="button"
                      onClick={() => setCategoryFilter('all')}
                      className={`px-1.5 py-0.5 rounded transition-colors ${
                        categoryFilter === 'all'
                          ? 'bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-500/40 font-semibold'
                          : 'bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      All
                    </button>
                    {availableCategories.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCategoryFilter(c)}
                        className={`px-1.5 py-0.5 rounded transition-colors truncate max-w-[120px] ${
                          categoryFilter === c
                            ? 'bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-500/40 font-semibold'
                            : 'bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-800'
                        }`}
                        title={c}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}

                {/* Stream Item List with Scroll Container */}
                <div className="max-h-64 overflow-y-auto space-y-1 custom-scrollbar pr-1">
                  {filteredTabs.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500 italic">
                      No matching console streams found.
                    </div>
                  ) : (
                    filteredTabs.map((tab) => {
                      const isSelected = tab.id === activeTabId;
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
                              ? 'bg-emerald-500/5 dark:bg-slate-900 border-emerald-500/50 shadow-sm'
                              : 'bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-900/60 border-slate-200 dark:border-slate-800/80'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {tab.isRunning ? (
                              <Loader2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 animate-spin shrink-0" />
                            ) : tab.exitCode === 0 ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            ) : tab.exitCode !== undefined && tab.exitCode !== 0 ? (
                              <AlertCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                            ) : (
                              <TerminalIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 shrink-0">
                                  {PAGE_SCOPE_BADGE_LABELS[inferPageScopeFromJob(tab.id, tab.pageScope, tab.title)]}
                                </span>
                                {tab.source && tab.source !== 'ui' && (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 shrink-0">
                                    {tab.source}
                                  </span>
                                )}
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                                  {tab.title}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500 font-mono mt-0.5">
                                <span className="text-slate-600 dark:text-slate-400">{category}</span>
                                <span>•</span>
                                <span>{tab.lines.length} lines</span>
                                <span>•</span>
                                <span className={tab.isRunning ? "text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1" : "text-slate-600 dark:text-slate-400 flex items-center gap-1"}>
                                  <Clock className="w-2.5 h-2.5 text-slate-400 dark:text-slate-500 shrink-0" />
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
                            className="p-1 rounded text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-200 dark:hover:bg-slate-800 shrink-0 transition-colors"
                            title="Close stream"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Footer Status in Dropdown */}
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                  <span>Showing {filteredTabs.length} of {tabs.length} streams</span>
                  {tabs.length > 0 && (
                    <button
                      onClick={() => {
                        onPurgeAllTabs();
                        setIsPickerOpen(false);
                      }}
                      className="text-rose-600 dark:text-rose-400 hover:underline"
                    >
                      Purge All
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Quick-Access Compact Strip (Shows Most Recent Active Streams with auto-scroll) */}
          <div className="flex items-center space-x-1 overflow-x-auto min-w-0 flex-1 custom-scrollbar">
            {tabs.slice(-3).map((tab) => {
              const isActive = tab.id === activeTabId;
              const scopeBadge =
                PAGE_SCOPE_BADGE_LABELS[inferPageScopeFromJob(tab.id, tab.pageScope, tab.title)];
              return (
                <div
                  key={tab.id}
                  onClick={() => onSelectTab(tab.id)}
                  className={`flex items-center space-x-1.5 px-2 py-0.5 rounded text-xs cursor-pointer border transition-colors shrink-0 ${
                    isActive
                      ? 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-emerald-700 dark:text-emerald-400 font-semibold shadow-xs'
                      : 'bg-transparent border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-900/40'
                  }`}
                  title={tab.title}
                >
                  {tab.isRunning && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-ping" />}
                  <span className="text-[9px] font-mono font-bold uppercase text-slate-500 dark:text-slate-400">
                    {scopeBadge}
                  </span>
                  <span className="truncate max-w-[130px]">{tab.title}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                    className="hover:text-rose-600 dark:hover:text-red-400 text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 p-0.5 rounded transition-colors"
                    title="Close tab"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Tab Actions: Pin, Copy, Abort, Clear */}
          <div className="flex items-center space-x-1.5 shrink-0 pl-2">
            <button
              type="button"
              onClick={pinToBottom}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono border transition-colors shadow-xs whitespace-nowrap flex-shrink-0 ${
                isPinned
                  ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-700 dark:text-emerald-300'
                  : 'bg-amber-500/15 border-amber-500/40 text-amber-800 dark:text-amber-300 hover:bg-amber-500/25'
              }`}
              title={
                isPinned
                  ? 'Auto-scroll pinned to newest output lines'
                  : 'Scroll paused — click to re-pin to bottom'
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
                  <span>Pin{unseenCount > 0 ? ` (${unseenCount})` : ''}</span>
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
                  } catch (err) {
                    console.warn('Failed to copy console lines:', err);
                  }
                }}
                className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 transition-colors shadow-xs whitespace-nowrap flex-shrink-0"
                title="Copy ANSI-stripped output from current tab to clipboard"
              >
                {copiedState ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-emerald-700 dark:text-emerald-400 font-semibold">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            )}

            {activeTab?.isRunning && activeTab.abortable !== false && (
              <button
                type="button"
                onClick={() => onAbortJob(activeTab.id)}
                className="flex items-center space-x-1 px-2 py-0.5 rounded bg-rose-500/15 dark:bg-red-500/20 text-rose-700 dark:text-red-400 hover:bg-rose-500/25 dark:hover:bg-red-500/30 text-[11px] font-mono transition-colors font-medium whitespace-nowrap flex-shrink-0"
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
                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors shrink-0"
                title="Clear current tab"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Body Viewport */}
      {activeMainSection === 'console' ? (
        <div className="relative flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-[#050b14]">
          <div
            ref={scrollRef}
            onScroll={handleConsoleScroll}
            className="flex-1 p-4 font-mono text-xs overflow-y-auto space-y-0.5 selection:bg-emerald-500/20 dark:selection:bg-emerald-500/30 selection:text-emerald-900 dark:selection:text-emerald-200 select-text bg-slate-50 dark:bg-[#050b14]"
          >
            {activeTab && activeTab.lines.length > 0 ? (
              activeTab.lines.map((line, idx) => (
                <div key={idx} className="whitespace-pre-wrap break-all leading-relaxed">
                  {formatConsoleLine(line)}
                </div>
              ))
            ) : (
              <div className="text-slate-500 dark:text-slate-600 italic">No output in stream.</div>
            )}
          </div>

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
      ) : (
        /* Events & Notifications Ledger Viewport */
        <div className="flex-1 p-4 font-mono text-xs overflow-y-auto space-y-2 select-text bg-slate-50 dark:bg-[#050b14]">
          {eventsHistory.length > 0 ? (
            eventsHistory.map((ev) => (
              <div
                key={ev.id}
                className={`p-3 rounded-lg border flex items-start gap-3 transition-colors ${
                  ev.type === 'error'
                    ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 text-rose-800 dark:text-rose-300'
                    : ev.type === 'pending'
                    ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-800 dark:text-amber-300'
                    : ev.type === 'success'
                    ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 shadow-xs'
                    : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300 shadow-xs'
                }`}
              >
                <div className="shrink-0 mt-0.5">
                  {ev.type === 'pending' && <Loader2 className="w-4 h-4 text-amber-600 dark:text-amber-400 animate-spin" />}
                  {ev.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                  {ev.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />}
                  {ev.type === 'info' && <Bell className="w-4 h-4 text-sky-600 dark:text-cyan-400" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-semibold text-slate-900 dark:text-slate-200 truncate">{ev.message}</span>
                      {ev.type === 'success' && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30 uppercase tracking-wider shrink-0">
                          Complete
                        </span>
                      )}
                      {ev.type === 'pending' && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-500/15 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/30 uppercase tracking-wider shrink-0 animate-pulse">
                          In Progress
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 shrink-0 flex items-center gap-1 font-mono">
                      <Clock className="w-2.5 h-2.5" />
                      {ev.timestamp}
                    </span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-slate-500 dark:text-slate-600 italic text-center p-8">No notifications or events recorded yet.</div>
          )}
        </div>
      )}
    </div>
  );
};
