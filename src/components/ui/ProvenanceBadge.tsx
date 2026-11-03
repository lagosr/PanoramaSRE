interface ProvenanceBadgeProps {
  state: 'IN_SYNC' | 'AHEAD' | 'LOCAL_WIP' | 'DIRTY_PROD' | 'DIVERGED' | 'LEGACY_UNSTAMPED' | 'PROD_UNREACHABLE' | 'UNKNOWN';
  aheadCount?: number;
  behindCount?: number;
}

export function ProvenanceBadge({ state, aheadCount = 0, behindCount = 0 }: ProvenanceBadgeProps) {
  switch (state) {
    case 'IN_SYNC':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border border-emerald-500/30 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400"></span>
          IN SYNC
        </span>
      );
    case 'AHEAD':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-900 dark:text-amber-300 border border-amber-500/30 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 animate-pulse"></span>
          BEHIND BY {aheadCount}
        </span>
      );
    case 'LOCAL_WIP':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-900 dark:text-amber-300 border border-amber-500/30 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400"></span>
          LOCAL WIP
        </span>
      );
    case 'DIRTY_PROD':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.2)] whitespace-nowrap animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-600 dark:bg-rose-400 animate-ping"></span>
          DIRTY PROD
        </span>
      );
    case 'DIVERGED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/15 text-purple-900 dark:text-purple-300 border border-purple-500/30 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-600 dark:bg-purple-400"></span>
          DIVERGED ({behindCount} behind)
        </span>
      );
    case 'LEGACY_UNSTAMPED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-200/70 dark:bg-slate-500/10 text-slate-700 dark:text-slate-400 border border-slate-300 dark:border-slate-500/30 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-500 dark:bg-slate-400"></span>
          UNSTAMPED
        </span>
      );
    case 'PROD_UNREACHABLE':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.2)] whitespace-nowrap animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-600 dark:bg-rose-400 animate-ping"></span>
          UNREACHABLE
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-200/70 dark:bg-slate-500/10 text-slate-700 dark:text-slate-400 border border-slate-300 dark:border-slate-500/30 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-500 dark:bg-slate-400"></span>
          CHECKING...
        </span>
      );
  }
}
