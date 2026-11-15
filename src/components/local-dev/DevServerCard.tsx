import { useState } from 'react';
import { DiscoveredApp } from '../../lib/types';

interface DevServerCardProps {
  app: DiscoveredApp;
  onStart: (appId: string, workspacePath: string, devCommand: string, port?: number) => void;
  onStartAuthAndApp: (appId: string, workspacePath: string, devCommand: string, port?: number) => void;
  onStop: (appId: string, port?: number) => void;
  onRestart: (appId: string, workspacePath: string, devCommand: string, port?: number) => void;
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
  const [devMode, setDevMode] = useState<'dev' | 'preview'>('dev');
  const dev = app.devServer;
  const isManaged = dev?.status === 'RUNNING_MANAGED';
  const isExternal = dev?.status === 'RUNNING_EXTERNAL';
  const isRunning = isManaged || isExternal;
  const hasPreviewMode = Boolean(app.manifest.sre.previewCommand);
  const activeDevCommand =
    devMode === 'preview' && app.manifest.sre.previewCommand
      ? app.manifest.sre.previewCommand
      : app.manifest.sre.devCommand;
  const cleanBasePath = app.manifest.basePath === '/' ? '' : app.manifest.basePath;
  const normalizedHref = dev?.local_url || `http://localhost:${app.manifest.port}${cleanBasePath}`;
  const isEdgePages = app.manifest.hostingTarget === 'cloudflare-pages';

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
                href={normalizedHref}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-emerald-500 hover:text-emerald-400 font-mono hover:underline truncate block"
              >
                :{app.manifest.port}{cleanBasePath || '/'}
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
            <span className="text-slate-500 shrink-0">{isEdgePages ? 'Local D1:' : 'Local SQLite:'}</span>
            <span className="text-slate-800 dark:text-slate-300 truncate">
              {dev?.sqlite_size_bytes ? formatBytes(dev.sqlite_size_bytes) : 'Not found'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 shrink-0">PRAGMA user_version:</span>
            <span className="text-slate-800 dark:text-slate-300 truncate">
              {dev?.sqlite_user_version !== null && dev?.sqlite_user_version !== undefined
                ? `v${dev.sqlite_user_version}`
                : 'None'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 shrink-0">Command:</span>
            <span className="text-slate-600 dark:text-slate-400 truncate text-right">
              {activeDevCommand}
            </span>
          </div>
          {hasPreviewMode && (
            <div className="pt-1.5 flex items-center justify-between gap-2 border-t border-slate-200/70 dark:border-slate-800/70 font-sans">
              <span className="text-[11px] text-slate-500">Runtime Mode:</span>
              <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5">
                <button
                  type="button"
                  onClick={() => setDevMode('dev')}
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    devMode === 'dev'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  UI Dev
                </button>
                <button
                  type="button"
                  onClick={() => setDevMode('preview')}
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    devMode === 'preview'
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Edge + D1
                </button>
              </div>
            </div>
          )}
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
                  activeDevCommand,
                  app.manifest.port
                )
              }
              disabled={isActionPending}
              className="flex-1 py-1.5 px-3 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors whitespace-nowrap text-center"
            >
              Start
            </button>
            {app.manifest.slug !== 'auth' && app.manifest.sre.requiresAuthInDev !== false && (
              <button
                onClick={() =>
                  onStartAuthAndApp(
                    app.manifest.appId,
                    app.workspacePath,
                    activeDevCommand,
                    app.manifest.port
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
                  activeDevCommand,
                  app.manifest.port
                )
              }
              disabled={isActionPending}
              className="flex-1 py-1.5 px-3 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap"
            >
              Restart
            </button>
            <button
              onClick={() => onStop(app.manifest.appId, app.manifest.port)}
              disabled={isActionPending}
              className="py-1.5 px-3 rounded-lg text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30 transition-colors whitespace-nowrap"
            >
              Stop
            </button>
          </>
        )}

        {isExternal && (
          <div className="flex items-center gap-2 w-full">
            <span className="flex-1 text-xs text-amber-600 dark:text-amber-400 italic truncate" title="Running via external shell or prior session">
              External / Prior Run
            </span>
            <button
              onClick={() =>
                onRestart(
                  app.manifest.appId,
                  app.workspacePath,
                  activeDevCommand,
                  app.manifest.port
                )
              }
              disabled={isActionPending}
              className="py-1.5 px-2.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap"
            >
              Restart
            </button>
            <button
              onClick={() => onStop(app.manifest.appId, app.manifest.port)}
              disabled={isActionPending}
              className="py-1.5 px-2.5 rounded-lg text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30 transition-colors whitespace-nowrap"
            >
              Stop
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
