import React, { useState, useEffect, useRef } from 'react';
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
  ChevronDown
} from 'lucide-react';
import { formatConsoleLine } from './ConsoleColorizer';

export interface TerminalTab {
  id: string;
  title: string;
  lines: string[];
  isRunning: boolean;
  exitCode?: number;
}

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
  eventsHistory,
  onClearEvents,
  runningJobsCount,
  onToggleDrawer,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeMainSection, setActiveMainSection] = useState<'console' | 'events'>('console');
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // Auto-scroll to bottom on new lines in console
  useEffect(() => {
    if (activeMainSection === 'console' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeTab?.lines.length, activeMainSection]);

  // When drawer is closed, render only the bottom status bar trigger
  if (!isOpen) {
    return (
      <footer className="h-8 bg-slate-950 border-t border-slate-800 px-3 flex items-center justify-between text-xs font-mono select-none z-50 shrink-0">
        {/* Left: Host indicator + action status */}
        <div className="flex items-center space-x-3 min-w-0 flex-1 mr-4">
          <div className="flex items-center space-x-1.5 shrink-0 bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-slate-300">
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse shrink-0" />
            <span className="text-[11px] font-semibold">wsh.panoramadr.com</span>
            <span className="text-[10px] text-slate-500">(LAN Direct)</span>
          </div>

          {actionFeedback ? (
            <div className="flex items-center space-x-1.5 truncate">
              {actionFeedback.type === 'pending' && (
                <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin shrink-0" />
              )}
              {actionFeedback.type === 'success' && (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              )}
              {actionFeedback.type === 'error' && (
                <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              )}
              <span
                className={`truncate font-medium ${
                  actionFeedback.type === 'error'
                    ? 'text-rose-400'
                    : actionFeedback.type === 'pending'
                    ? 'text-emerald-300'
                    : 'text-slate-200'
                }`}
              >
                {actionFeedback.message}
              </span>
            </div>
          ) : (
            <div className="flex items-center space-x-2 text-slate-500 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80" />
              <span className="truncate">Ready • SRE Telemetry Active</span>
            </div>
          )}
        </div>

        {/* Right: Drawer toggle trigger */}
        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={onToggleDrawer}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded transition-colors text-xs font-medium border ${
              runningJobsCount > 0
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
            title="Open Console & Events (Ctrl+` or click)"
          >
            <TerminalIcon className="w-3.5 h-3.5" />
            <span>Console & Events</span>
            {tabs.length > 0 && (
              <span
                className={`px-1 rounded-full text-[10px] font-bold ${
                  runningJobsCount > 0 ? 'bg-emerald-500 text-black animate-pulse' : 'bg-slate-800 text-slate-300'
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

  // When drawer is OPEN: Flush attached to bottom-0 with NO GAP
  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 bg-[#050b14] border-t border-slate-800 flex flex-col shadow-2xl transition-all duration-200 select-none ${
        isExpanded ? 'h-full' : 'h-88'
      }`}
    >
      {/* Top Main Section Switcher & Window Control Bar */}
      <div className="h-10 bg-slate-950 border-b border-slate-800 flex items-center justify-between px-3 shrink-0 gap-3">
        {/* Left: Primary Section Tabs (Terminal Console vs Notification & Events) */}
        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={() => setActiveMainSection('console')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              activeMainSection === 'console'
                ? 'bg-slate-900 border-emerald-500/40 text-emerald-400 shadow-sm'
                : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <TerminalIcon className="w-3.5 h-3.5" />
            <span>Console Stream</span>
            {tabs.length > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                runningJobsCount > 0 ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
              }`}>
                {tabs.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveMainSection('events')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              activeMainSection === 'events'
                ? 'bg-slate-900 border-amber-500/40 text-amber-400 shadow-sm'
                : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Events & Notifications</span>
            {eventsHistory.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
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
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : actionFeedback.type === 'error'
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                : 'bg-slate-900 border-slate-700 text-slate-200'
            }`}
            title={actionFeedback.message}
          >
            {actionFeedback.type === 'pending' && (
              <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin shrink-0" />
            )}
            {actionFeedback.type === 'success' && (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            )}
            {actionFeedback.type === 'error' && (
              <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            )}
            <span className="truncate">{actionFeedback.message}</span>
          </div>
        )}

        {/* Right: Host Badge & Global Window Controls */}
        <div className="flex items-center space-x-2 shrink-0">
          <div className="hidden lg:flex items-center space-x-1.5 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>wsh.panoramadr.com</span>
          </div>

          {activeMainSection === 'console' && tabs.length > 0 && (
            <button
              onClick={onPurgeAllTabs}
              className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 transition-colors"
              title="Delete all console tabs and purge from database"
            >
              <span>Purge All</span>
            </button>
          )}

          {activeMainSection === 'events' && eventsHistory.length > 0 && (
            <button
              onClick={onClearEvents}
              className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-700/60 transition-colors"
              title="Clear event history log"
            >
              <span>Clear Events</span>
            </button>
          )}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title={isExpanded ? 'Restore' : 'Maximize'}
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title="Close Panel (X)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Sub-Header for Console Stream Tabs */}
      {activeMainSection === 'console' && (
        <div className="h-8 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between px-3 shrink-0">
          <div className="flex items-center space-x-1 overflow-x-auto min-w-0 flex-1">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  onClick={() => onSelectTab(tab.id)}
                  className={`flex items-center space-x-2 px-2.5 py-0.5 rounded text-xs cursor-pointer border transition-colors shrink-0 ${
                    isActive
                      ? 'bg-slate-900 border-slate-700 text-emerald-400 font-medium'
                      : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
                  }`}
                >
                  {tab.isRunning && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />}
                  <span className="truncate max-w-[150px]">{tab.title}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                    className="hover:text-red-400 text-slate-500 hover:bg-slate-800 p-0.5 rounded"
                    title="Close tab"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex items-center space-x-1.5 shrink-0 pl-2">
            {activeTab?.isRunning && (
              <button
                onClick={() => onAbortJob(activeTab.id)}
                className="flex items-center space-x-1 px-2 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 text-[11px] font-mono transition-colors"
                title="Abort Running Process"
              >
                <StopCircle className="w-3 h-3" />
                <span>Abort</span>
              </button>
            )}

            {activeTab && (
              <button
                onClick={() => onClearTab(activeTab.id)}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
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
        <div
          ref={scrollRef}
          className="flex-1 p-4 font-mono text-xs overflow-y-auto space-y-0.5 selection:bg-emerald-500/30 selection:text-emerald-200 select-text bg-[#050b14]"
        >
          {activeTab && activeTab.lines.length > 0 ? (
            activeTab.lines.map((line, idx) => (
              <div key={idx} className="whitespace-pre-wrap break-all leading-relaxed">
                {formatConsoleLine(line)}
              </div>
            ))
          ) : (
            <div className="text-slate-600 italic">No output in stream.</div>
          )}
        </div>
      ) : (
        /* Events & Notifications Ledger Viewport */
        <div className="flex-1 p-4 font-mono text-xs overflow-y-auto space-y-2 select-text bg-[#050b14]">
          {eventsHistory.length > 0 ? (
            eventsHistory.map((ev) => (
              <div
                key={ev.id}
                className={`p-3 rounded-lg border flex items-start gap-3 transition-colors ${
                  ev.type === 'error'
                    ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                    : ev.type === 'pending'
                    ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                    : ev.type === 'success'
                    ? 'bg-slate-900 border-slate-800 text-slate-200'
                    : 'bg-slate-900/60 border-slate-800 text-slate-300'
                }`}
              >
                <div className="shrink-0 mt-0.5">
                  {ev.type === 'pending' && <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />}
                  {ev.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  {ev.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400" />}
                  {ev.type === 'info' && <Bell className="w-4 h-4 text-cyan-400" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-semibold text-slate-200 truncate">{ev.message}</span>
                      {ev.type === 'success' && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider shrink-0">
                          Complete
                        </span>
                      )}
                      {ev.type === 'pending' && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-wider shrink-0 animate-pulse">
                          In Progress
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 shrink-0 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {ev.timestamp}
                    </span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-slate-600 italic text-center p-8">No notifications or events recorded yet.</div>
          )}
        </div>
      )}
    </div>
  );
};
