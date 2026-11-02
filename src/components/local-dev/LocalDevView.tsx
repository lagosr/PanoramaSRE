import { DiscoveredApp } from '../../lib/types';
import { DevServerCard } from './DevServerCard';
import { Play, Square } from 'lucide-react';

interface LocalDevViewProps {
  apps: DiscoveredApp[];
  onStart: (appId: string, workspacePath: string, devCommand: string) => void;
  onStartAuthAndApp: (appId: string, workspacePath: string, devCommand: string) => void;
  onStop: (appId: string, port?: number) => void;
  onRestart: (appId: string, workspacePath: string, devCommand: string, port?: number) => void;
  onStartAll: () => void;
  onStopAll: () => void;
}

export function LocalDevView({
  apps,
  onStart,
  onStartAuthAndApp,
  onStop,
  onRestart,
  onStartAll,
  onStopAll,
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
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Local Dev Server Supervisor
            </h2>
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow-sm"
              title="Start all dev servers (auth started first)"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Start All</span>
            </button>

            {runningCount > 0 && (
              <button
                onClick={onStopAll}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 transition-colors"
                title="Stop all currently running dev servers"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
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
          />
        ))}
      </div>
    </div>
  );
}
