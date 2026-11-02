import { DiscoveredApp } from '../../lib/types';

interface DevServerCardProps {
  app: DiscoveredApp;
  onStart: (appId: string, workspacePath: string, devCommand: string) => void;
  onStartAuthAndApp: (appId: string, workspacePath: string, devCommand: string) => void;
  onStop: (appId: string) => void;
  onRestart: (appId: string, workspacePath: string, devCommand: string) => void;
  isActionPending?: boolean;
}

export function DevServerCard({
  app,
  onStart,
  onStartAuthAndApp,
  onStop,
  onRestart,
  isActionPending = false,
}: DevServerCardProps) {
  const dev = app.devServer;
  const isManaged = dev?.status === 'RUNNING_MANAGED';
  const isExternal = dev?.status === 'RUNNING_EXTERNAL';
  const isRunning = isManaged || isExternal;

  const formatBytes = (bytes: number | null | undefined) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="flex flex-col justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition-all overflow-hidden min-w-0">
      <div className="min-w-0">
        {/* Header: Title, URL, Port, and Status Badge */}
        <div className="flex items-start justify-between gap-2 mb-3 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-sm shrink-0">
              {app.manifest.displayName.substring(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm truncate">
                {app.manifest.displayName}
              </h3>
              <a
                href={dev?.local_url || `http://localhost:${app.manifest.port}${app.manifest.basePath}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-emerald-500 hover:text-emerald-400 font-mono hover:underline truncate block"
              >
                :{app.manifest.port}{app.manifest.basePath}
              </a>
            </div>
          </div>

          <div className="shrink-0">
            {isManaged && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                MANAGED
              </span>
            )}
            {isExternal && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30 whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                EXTERNAL
              </span>
            )}
            {!isRunning && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/30 whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                STOPPED
              </span>
            )}
          </div>
        </div>

        {/* Database & Workspace Metrics */}
        <div className="rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80 p-3 mb-4 space-y-1.5 text-xs font-mono">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 shrink-0">Local SQLite:</span>
            <span className="text-slate-300 truncate">
              {dev?.sqlite_size_bytes ? formatBytes(dev.sqlite_size_bytes) : 'Not found'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 shrink-0">PRAGMA user_version:</span>
            <span className="text-slate-300 truncate">
              {dev?.sqlite_user_version !== null && dev?.sqlite_user_version !== undefined
                ? `v${dev.sqlite_user_version}`
                : 'None'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 shrink-0">Command:</span>
            <span className="text-slate-400 truncate text-right">
              {app.manifest.sre.devCommand}
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
        {!isRunning && (
          <>
            <button
              onClick={() =>
                onStart(
                  app.manifest.appId,
                  app.workspacePath,
                  app.manifest.sre.devCommand
                )
              }
              disabled={isActionPending}
              className="flex-1 py-1.5 px-3 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors whitespace-nowrap text-center"
            >
              Start
            </button>
            {app.manifest.slug !== 'auth' && (
              <button
                onClick={() =>
                  onStartAuthAndApp(
                    app.manifest.appId,
                    app.workspacePath,
                    app.manifest.sre.devCommand
                  )
                }
                disabled={isActionPending}
                className="flex-1 py-1.5 px-2.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap text-center"
              >
                Start Auth + App
              </button>
            )}
          </>
        )}

        {isManaged && (
          <>
            <button
              onClick={() =>
                onRestart(
                  app.manifest.appId,
                  app.workspacePath,
                  app.manifest.sre.devCommand
                )
              }
              disabled={isActionPending}
              className="flex-1 py-1.5 px-3 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap"
            >
              Restart
            </button>
            <button
              onClick={() => onStop(app.manifest.appId)}
              disabled={isActionPending}
              className="py-1.5 px-3 rounded-lg text-xs font-medium bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 transition-colors whitespace-nowrap"
            >
              Stop
            </button>
          </>
        )}

        {isExternal && (
          <div className="w-full text-center py-1 text-xs text-amber-400 italic">
            Running via external shell (e.g. terminal / VSCode)
          </div>
        )}
      </div>
    </div>
  );
}
