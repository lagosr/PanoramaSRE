import React from 'react';
import { Terminal, ChevronUp, ChevronDown, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { TerminalTab } from './SreTerminalDrawer';

interface BottomStatusBarProps {
  actionFeedback: {
    message: string;
    type: 'pending' | 'success' | 'error';
  } | null;
  tabs: TerminalTab[];
  activeTabId: string;
  isDrawerOpen: boolean;
  onToggleDrawer: () => void;
}

export const BottomStatusBar: React.FC<BottomStatusBarProps> = ({
  actionFeedback,
  tabs,
  isDrawerOpen,
  onToggleDrawer,
}) => {
  const runningJobsCount = tabs.filter((t) => t.isRunning).length;

  return (
    <footer className="h-8 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 px-3 flex items-center justify-between text-xs font-mono select-none z-50 shrink-0">
      {/* Left: Action status & live indicators */}
      <div className="flex items-center space-x-2 min-w-0 flex-1 mr-4">
        {actionFeedback ? (
          <div className="flex items-center space-x-1.5 truncate">
            {actionFeedback.type === 'pending' && (
              <Loader2 className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 animate-spin shrink-0" />
            )}
            {actionFeedback.type === 'success' && (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />
            )}
            {actionFeedback.type === 'error' && (
              <AlertCircle className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400 shrink-0" />
            )}
            <span
              className={`truncate font-medium ${
                actionFeedback.type === 'error'
                  ? 'text-rose-600 dark:text-rose-400'
                  : actionFeedback.type === 'pending'
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-slate-800 dark:text-slate-200'
              }`}
            >
              {actionFeedback.message}
            </span>
          </div>
        ) : (
          <div className="flex items-center space-x-2 text-slate-500 dark:text-slate-400 truncate">
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
            isDrawerOpen
              ? 'bg-slate-100 dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-emerald-600 dark:text-emerald-400'
              : runningJobsCount > 0
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20'
              : 'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900'
          }`}
          title={isDrawerOpen ? 'Hide Terminal Console (Ctrl+` or click)' : 'Open Terminal Console'}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>Console</span>
          {tabs.length > 0 && (
            <span
              className={`px-1 rounded-full text-[10px] font-bold ${
                runningJobsCount > 0 ? 'bg-emerald-500 text-black animate-pulse' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              {runningJobsCount > 0 ? runningJobsCount : tabs.length}
            </span>
          )}
          {isDrawerOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
      </div>
    </footer>
  );
};
