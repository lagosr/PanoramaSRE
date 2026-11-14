import { useState } from 'react';
import { DiscoveredApp, McpBridgeStatus, TerminalTab } from '../../lib/types';
import { DevServerCard } from './DevServerCard';
import { McpBridgeBanner } from './McpBridgeBanner';
import { WorkStreamContainer } from '../ui/WorkStreamContainer';
import { Play, Square, Loader2 } from 'lucide-react';

interface LocalDevViewProps {
  apps: DiscoveredApp[];
  mcpStatus?: McpBridgeStatus | null;
  terminalTabs?: TerminalTab[];
  onStart: (appId: string, workspacePath: string, devCommand: string, port?: number) => void;
  onStartAuthAndApp: (appId: string, workspacePath: string, devCommand: string, port?: number) => void;
  onStop: (appId: string, port?: number) => void;
  onRestart: (appId: string, workspacePath: string, devCommand: string, port?: number) => void;
  onStartAll: () => void;
  onStopAll: () => void;
  onOpenInBottomConsole?: (tabId?: string) => void;
  onAbortJob?: (id: string) => void;
  onClearTab?: (id: string) => void;
  isActionPending?: boolean;
  actionMessage?: string | null;
}

export function LocalDevView({
  apps,
  mcpStatus,
  terminalTabs = [],
  onStart,
  onStartAuthAndApp,
  onStop,
  onRestart,
  onStartAll,
  onStopAll,
  onOpenInBottomConsole,
  onAbortJob,
  onClearTab,
  isActionPending = false,
  actionMessage = null,
}: LocalDevViewProps) {
  const [appSlugFilter, setAppSlugFilter] = useState<string>('all');
  const runningCount = apps.filter(
    (a) => a.devServer?.status === 'RUNNING_MANAGED' || a.devServer?.status === 'RUNNING_EXTERNAL'
  ).length;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Dev Server Supervisor Header */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Local Dev Server Supervisor
              </h2>
              {isActionPending && (
                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 animate-pulse">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{actionMessage || 'Executing action...'}</span>
                </div>
              )}
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              Launch, inspect, and supervise local development processes and SQLite databases
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              {runningCount} / {apps.length} Dev Servers Active
            </span>

            <button
              onClick={onStartAll}
              disabled={isActionPending}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors shadow-sm ${
                isActionPending
                  ? 'bg-slate-700 cursor-not-allowed opacity-60'
                  : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
              title="Start all dev servers (auth started first)"
            >
              {isActionPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>Start All</span>
            </button>

            {runningCount > 0 && (
              <button
                onClick={onStopAll}
                disabled={isActionPending}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                  isActionPending
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700 cursor-not-allowed'
                    : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30'
                }`}
                title="Stop all currently running dev servers"
              >
                {isActionPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5 fill-current" />}
                <span>Stop All</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Agent MCP Bridge Status Banner */}
      {mcpStatus && <McpBridgeBanner status={mcpStatus} />}

      {/* Grid of Dev Server Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {apps.map((app) => (
          <DevServerCard
            key={app.manifest.slug}
            app={app}
            onStart={onStart}
            onStartAuthAndApp={onStartAuthAndApp}
            onStop={onStop}
            onRestart={onRestart}
            isActionPending={isActionPending}
          />
        ))}
      </div>

      {/* Position 4: Boot-Until-Ready Local Dev Stream Container */}
      <WorkStreamContainer
        pageScope="local-dev"
        tabs={terminalTabs}
        appSlugFilter={appSlugFilter}
        title="Local Dev Startup & Stop Work Stream"
        description="Captures boot stdout/stderr until the Next.js server reports Ready/listening (steady-state runtime logs discarded thereafter)."
        emptyHint="Start, restart, or stop any managed dev server (via UI or MCP) to inspect startup diagnostics here."
        headerExtra={
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAppSlugFilter('all')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold border transition-colors whitespace-nowrap flex-shrink-0 ${
                appSlugFilter === 'all'
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              All Apps
            </button>
            {apps.map((app) => {
              const selected = appSlugFilter === app.manifest.appId;
              return (
                <button
                  key={app.manifest.appId}
                  type="button"
                  onClick={() => setAppSlugFilter(app.manifest.appId)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold border transition-colors whitespace-nowrap flex-shrink-0 ${
                    selected
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {app.manifest.displayName}
                </button>
              );
            })}
          </div>
        }
        onOpenInBottomConsole={onOpenInBottomConsole}
        onAbortJob={onAbortJob}
        onClearTab={onClearTab}
      />
    </div>
  );
}
