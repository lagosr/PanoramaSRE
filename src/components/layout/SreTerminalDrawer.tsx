import React, { useState, useEffect, useRef } from 'react';
import { Terminal as TerminalIcon, X, Maximize2, Minimize2, Trash2, StopCircle } from 'lucide-react';

export interface TerminalTab {
  id: string;
  title: string;
  lines: string[];
  isRunning: boolean;
  exitCode?: number;
}

interface SreTerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  tabs: TerminalTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onClearTab: (id: string) => void;
  onAbortJob: (id: string) => void;
}

export const SreTerminalDrawer: React.FC<SreTerminalDrawerProps> = ({
  isOpen,
  onClose,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onClearTab,
  onAbortJob,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
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
      className={`fixed bottom-0 left-0 right-0 z-40 bg-[#050b14] border-t border-slate-800 flex flex-col shadow-2xl transition-all duration-200 ${
        isExpanded ? 'h-3/4' : 'h-80'
      }`}
    >
      {/* Header Bar */}
      <div className="h-10 bg-slate-950 border-b border-slate-800 flex items-center justify-between px-3">
        {/* Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto">
          <TerminalIcon className="w-4 h-4 text-emerald-400 mr-2 shrink-0" />
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                className={`flex items-center space-x-2 px-3 py-1 rounded text-xs cursor-pointer border transition-colors ${
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
                  className="hover:text-red-400"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Window controls */}
        <div className="flex items-center space-x-2">
          {activeTab?.isRunning && (
            <button
              onClick={() => onAbortJob(activeTab.id)}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 text-xs transition-colors"
              title="Abort Running Process"
            >
              <StopCircle className="w-3.5 h-3.5" />
              <span>Abort</span>
            </button>
          )}
          {activeTab && (
            <button
              onClick={() => onClearTab(activeTab.id)}
              className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
              title="Clear Terminal Output"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
            title={isExpanded ? 'Restore' : 'Maximize'}
          >
            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
            title="Close Drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div
        ref={scrollRef}
        className="flex-1 p-4 font-mono text-xs text-emerald-400 overflow-y-auto space-y-0.5 selection:bg-emerald-500/30 selection:text-emerald-200 select-text"
      >
        {activeTab && activeTab.lines.length > 0 ? (
          activeTab.lines.map((line, idx) => (
            <div key={idx} className="whitespace-pre-wrap break-all leading-relaxed">
              {line}
            </div>
          ))
        ) : (
          <div className="text-slate-600 italic">No output in stream.</div>
        )}
      </div>
    </div>
  );
};
