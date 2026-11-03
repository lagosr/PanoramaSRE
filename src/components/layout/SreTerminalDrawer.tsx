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
  Copy,
  Check 
} from 'lucide-react';
import { formatConsoleLine } from './ConsoleColorizer';

export interface TerminalTab {
  id: string;
  title: string;
  lines: string[];
  isRunning: boolean;
  exitCode?: number;
  createdAt?: string;
  finishedAt?: string;
}

interface SreTerminalDrawerProps {
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
}

export const SreTerminalDrawer: React.FC<SreTerminalDrawerProps> = ({
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
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedState, setCopiedState] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // Auto-scroll to bottom on new lines
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeTab?.lines.length]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed bottom-8 left-0 right-0 z-40 bg-white dark:bg-[#050b14] border-t border-slate-200 dark:border-slate-800 flex flex-col shadow-2xl transition-all duration-200 ${
        isExpanded ? 'h-[calc(100vh-8rem)]' : 'h-80'
      }`}
    >
      {/* Header Bar */}
      <div className="h-10 bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-3 select-none shrink-0 gap-2">
        {/* Left: Tab list & Activity Indicator Tab */}
        <div className="flex items-center space-x-1.5 overflow-x-auto min-w-0 flex-1">
          <TerminalIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mr-1 shrink-0" />
          
          {/* Notification / Activity Pill Tab at top of console */}
          {actionFeedback && (
            <div
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded text-xs border font-medium shrink-0 animate-fadeIn ${
                actionFeedback.type === 'pending'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                  : actionFeedback.type === 'error'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
              }`}
              title="Current SRE Operation State"
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
              <span className="truncate max-w-[200px]">{actionFeedback.message}</span>
            </div>
          )}

          {/* Process Output Tabs */}
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                className={`flex items-center space-x-2 px-3 py-1 rounded text-xs cursor-pointer border transition-colors shrink-0 ${
                  isActive
                    ? 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-emerald-700 dark:text-emerald-400 font-semibold shadow-xs'
                    : 'bg-transparent border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-900/40'
                }`}
              >
                {tab.isRunning && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-ping" />}
                <span className="truncate max-w-[150px]">{tab.title}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="hover:text-rose-600 dark:hover:text-red-400 text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 p-0.5 rounded transition-colors"
                  title="Close and delete tab"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Window controls */}
        <div className="flex items-center space-x-1.5 shrink-0">
          {activeTab && activeTab.lines.length > 0 && (
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(activeTab.lines.join('\n'));
                  setCopiedState(true);
                  setTimeout(() => setCopiedState(false), 2000);
                } catch (err) {
                  console.warn('Failed to copy console lines:', err);
                }
              }}
              className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 transition-colors shadow-xs"
              title="Copy all output from current tab to clipboard"
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

          {activeTab?.isRunning && (
            <button
              onClick={() => onAbortJob(activeTab.id)}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-rose-500/15 dark:bg-red-500/20 text-rose-700 dark:text-red-400 hover:bg-rose-500/25 dark:hover:bg-red-500/30 text-xs transition-colors font-medium"
              title="Abort Running Process"
            >
              <StopCircle className="w-3.5 h-3.5" />
              <span>Abort</span>
            </button>
          )}

          {activeTab && (
            <button
              onClick={() => onClearTab(activeTab.id)}
              className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
              title="Clear tab contents"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          {tabs.length > 0 && (
            <button
              onClick={onPurgeAllTabs}
              className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 border border-rose-300 dark:border-rose-500/20 transition-colors"
              title="Delete all console tabs and purge from database"
            >
              <span>Purge All</span>
            </button>
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
            title="Hide Console"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal Viewport with Syntax Colorization */}
      <div
        ref={scrollRef}
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
    </div>
  );
};
