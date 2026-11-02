interface ProvenanceBadgeProps {
  state: 'IN_SYNC' | 'AHEAD' | 'LOCAL_WIP' | 'DIRTY_PROD' | 'DIVERGED' | 'LEGACY_UNSTAMPED' | 'PROD_UNREACHABLE' | 'UNKNOWN';
  aheadCount?: number;
  behindCount?: number;
}

export function ProvenanceBadge({ state, aheadCount = 0, behindCount = 0 }: ProvenanceBadgeProps) {
  switch (state) {
    case 'IN_SYNC':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          IN SYNC
        </span>
      );
    case 'AHEAD':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
          AHEAD BY {aheadCount}
        </span>
      );
    case 'LOCAL_WIP':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
          LOCAL WIP
        </span>
      );
    case 'DIRTY_PROD':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping"></span>
          DIRTY PROD
        </span>
      );
    case 'DIVERGED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/30 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
          DIVERGED ({behindCount} behind)
        </span>
      );
    case 'LEGACY_UNSTAMPED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/30 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
          UNSTAMPED
        </span>
      );
    case 'PROD_UNREACHABLE':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-500/10 text-zinc-400 border border-zinc-500/30 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400"></span>
          UNREACHABLE
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/30 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
          CHECKING...
        </span>
      );
  }
}
