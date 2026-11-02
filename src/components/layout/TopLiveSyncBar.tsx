import { NetworkPosture } from '../../lib/types';

interface TopLiveSyncBarProps {
  networkPosture: NetworkPosture;
  devRunningCount: number;
  totalAppCount: number;
  prodHealthyCount: number;
  lastSyncTime: string | null;
  isSyncing: boolean;
  onRefresh: () => void;
}

export function TopLiveSyncBar({
  networkPosture,
  devRunningCount,
  totalAppCount,
  prodHealthyCount,
  lastSyncTime,
  isSyncing,
  onRefresh,
}: TopLiveSyncBarProps) {
  return (
    <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md px-6 flex items-center justify-between gap-3 z-10 select-none">
      {/* Left: Network Posture Indicator & Fleet Counters */}
      <div className="flex items-center gap-2.5 sm:gap-3 shrink-0 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          {networkPosture === 'LAN_DIRECT' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 whitespace-nowrap">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              LAN DIRECT (172.20.20.9)
            </span>
          )}
          {networkPosture === 'WAN_CLOUDFLARE' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 whitespace-nowrap">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              WAN (Cloudflare)
            </span>
          )}
          {networkPosture === 'OFFLINE' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30 whitespace-nowrap">
              <span className="w-2 h-2 rounded-full bg-rose-400"></span>
              HOST OFFLINE
            </span>
          )}
        </div>

        {/* Dev Servers Compact Counter */}
        <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 border-l border-slate-200 dark:border-slate-800 pl-3 shrink-0 whitespace-nowrap">
          <span>Dev:</span>
          <span className={`font-mono font-medium ${devRunningCount === totalAppCount ? 'text-emerald-400' : devRunningCount > 0 ? 'text-amber-300' : 'text-slate-400'}`}>
            {devRunningCount}/{totalAppCount} running
          </span>
        </div>

        {/* Production Fleet Health Compact Counter */}
        <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-400 border-l border-slate-200 dark:border-slate-800 pl-3 shrink-0 whitespace-nowrap">
          <span>Prod:</span>
          <span className="inline-flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${prodHealthyCount === totalAppCount ? 'bg-emerald-400' : 'bg-rose-400 animate-pulse'}`} />
            <span className={`font-mono font-medium ${prodHealthyCount === totalAppCount ? 'text-emerald-400' : 'text-rose-400'}`}>
              {prodHealthyCount}/{totalAppCount} healthy
            </span>
          </span>
        </div>
      </div>

      {/* Right: Sync Status & Manual Refresh */}
      <div className="flex items-center gap-3">
        {lastSyncTime && (
          <span className="text-xs text-slate-400 hidden md:inline">
            Last sync: <span className="font-mono text-slate-300">{lastSyncTime}</span>
          </span>
        )}

        <button
          onClick={onRefresh}
          disabled={isSyncing}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors whitespace-nowrap ${
            isSyncing ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          <svg
            className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
          {isSyncing ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>
    </header>
  );
}
