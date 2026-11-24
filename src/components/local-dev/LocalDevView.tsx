import { DiscoveredApp, McpBridgeStatus, TerminalTab } from '../../lib/types';
import { DevServerCard } from './DevServerCard';
import { McpBridgeBanner } from './McpBridgeBanner';
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
  onStart,
  onStartAuthAndApp,
  onStop,
  onRestart,
  onStartAll,
  onStopAll,
  isActionPending = false,
  actionMessage = null,
}: LocalDevViewProps) {
  const devApps = apps.filter(
    (a) =>
      a.manifest.hostingTarget !== 'wsh-docker-service' &&
      Boolean(a.manifest.sre.devCommand?.trim())
  );
  const runningCount = devApps.filter(
    (a) => a.devServer?.status === 'RUNNING_MANAGED' || a.devServer?.status === 'RUNNING_EXTERNAL'
  ).length;

  return (
    <div className="p-6 w-full min-w-0 max-w-[1920px] mx-auto space-y-6">
      {/* Dev Server Supervisor Header */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                Local Dev Server Supervisor
              </h1>
              {isActionPending && (
                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 animate-pulse">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{actionMessage || 'Executing action...'}</span>
                </div>
              )}
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
              Launch, inspect, and supervise local development processes and SQLite databases
            </p>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 tabular-nums whitespace-nowrap">
              <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400"></span>
              {runningCount} / {devApps.length} Dev Servers Active
            </span>

            <button
              onClick={onStartAll}
              disabled={isActionPending}
              className="btn-primary text-xs flex items-center gap-1.5"
              title="Start all dev servers (auth started first)"
            >
              {isActionPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>Start All</span>
            </button>

            {runningCount > 0 && (
              <button
                onClick={onStopAll}
                disabled={isActionPending}
                className="btn-danger text-xs flex items-center gap-1.5"
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
        {devApps.map((app) => (
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
    </div>
  );
}
