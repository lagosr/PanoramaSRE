import { DiscoveredApp } from '../../lib/types';
import { DevServerCard } from './DevServerCard';
import { Play, Square, Loader2 } from 'lucide-react';

interface LocalDevViewProps {
  apps: DiscoveredApp[];
  onStart: (appId: string, workspacePath: string, devCommand: string, port?: number) => void;
  onStartAuthAndApp: (appId: string, workspacePath: string, devCommand: string, port?: number) => void;
  onStop: (appId: string, port?: number) => void;
  onRestart: (appId: string, workspacePath: string, devCommand: string, port?: number) => void;
  onStartAll: () => void;
  onStopAll: () => void;
  isActionPending?: boolean;
  actionMessage?: string | null;
}

export function LocalDevView({
  apps,
  onStart,
  onStartAuthAndApp,
  onStop,
  onRestart,
  onStartAll,
  onStopAll,
  isActionPending = false,
  actionMessage = null,
}: LocalDevViewProps) {
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
    </div>
  );
}
