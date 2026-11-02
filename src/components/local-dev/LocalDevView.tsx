import { DiscoveredApp } from '../../lib/types';
import { DevServerCard } from './DevServerCard';

interface LocalDevViewProps {
  apps: DiscoveredApp[];
  onStart: (appId: string, workspacePath: string, devCommand: string) => void;
  onStartAuthAndApp: (appId: string, workspacePath: string, devCommand: string) => void;
  onStop: (appId: string) => void;
  onRestart: (appId: string, workspacePath: string, devCommand: string) => void;
}

export function LocalDevView({
  apps,
  onStart,
  onStartAuthAndApp,
  onStop,
  onRestart,
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

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              {runningCount} / {apps.length} Dev Servers Active
            </span>
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
