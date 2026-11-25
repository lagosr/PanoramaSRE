import React, { useState } from 'react';
import { StageWaterfallRow } from '../../lib/deployHistoryAnalytics';
import { Layers } from 'lucide-react';

interface StageWaterfallChartProps {
  rows: StageWaterfallRow[];
  onSelectApp?: (slug: string) => void;
}

interface StageSegmentDef {
  key: keyof Pick<
    StageWaterfallRow,
    | 'typecheckSec'
    | 'bumpSec'
    | 'depsSec'
    | 'nextBuildSec'
    | 'exportTailSec'
    | 'uploadSec'
    | 'snapshotSec'
    | 'swapSec'
    | 'verifySec'
    | 'smokeSec'
    | 'cronFinalizeSec'
    | 'untrackedNonDockerSec'
  >;
  label: string;
  colorClass: string;
  dotClass: string;
}

const SEGMENTS: StageSegmentDef[] = [
  { key: 'typecheckSec', label: 'S1 Typecheck', colorClass: 'bg-cyan-500', dotClass: 'bg-cyan-500' },
  { key: 'bumpSec', label: 'SemVer Bump', colorClass: 'bg-teal-500', dotClass: 'bg-teal-500' },
  { key: 'depsSec', label: 'S2 Deps', colorClass: 'bg-amber-500', dotClass: 'bg-amber-500' },
  { key: 'nextBuildSec', label: 'S2 Next Build', colorClass: 'bg-emerald-500', dotClass: 'bg-emerald-500' },
  { key: 'exportTailSec', label: 'S2 Export/ELF', colorClass: 'bg-indigo-500', dotClass: 'bg-indigo-500' },
  { key: 'uploadSec', label: 'S4 Upload', colorClass: 'bg-sky-500', dotClass: 'bg-sky-500' },
  { key: 'snapshotSec', label: 'S5 DB Snap', colorClass: 'bg-violet-500', dotClass: 'bg-violet-500' },
  { key: 'swapSec', label: 'S5 Swap', colorClass: 'bg-orange-500', dotClass: 'bg-orange-500' },
  { key: 'verifySec', label: 'S5 Verify', colorClass: 'bg-lime-500', dotClass: 'bg-lime-500' },
  { key: 'smokeSec', label: 'Smoke Gate', colorClass: 'bg-rose-500', dotClass: 'bg-rose-500' },
  { key: 'cronFinalizeSec', label: 'Cron/Finalize', colorClass: 'bg-fuchsia-500', dotClass: 'bg-fuchsia-500' },
  { key: 'untrackedNonDockerSec', label: 'Non-Docker Overhead', colorClass: 'bg-slate-400 dark:bg-slate-600', dotClass: 'bg-slate-400 dark:bg-slate-600' },
];

export const StageWaterfallChart: React.FC<StageWaterfallChartProps> = ({ rows, onSelectApp }) => {
  const [hoveredRowSlug, setHoveredRowSlug] = useState<string | null>(null);

  const maxTotal = rows.reduce((m, r) => Math.max(m, r.avgTotalWallSec), 1);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Layers className="w-4 h-4 text-[var(--color-brand-text)]" />
            <span>Average End-to-End Stage Waterfall by Application</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Proportional stage breakdown showing where seconds are spent across Typecheck, Buildx, SCP Upload, DB Snapshot, Swap, Verify & Smoke.
          </p>
        </div>
      </div>

      {/* Color Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-3">
        {SEGMENTS.map((seg) => (
          <span key={seg.key} className="inline-flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-xs ${seg.dotClass}`} />
            {seg.label}
          </span>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="h-32 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 flex items-center justify-center text-xs text-slate-500 font-mono">
          No stage waterfall data available for active filters.
        </div>
      ) : (
        <div className="space-y-1">
          {rows.map((row) => {
            const widthPct = Math.max(8, Math.round((row.avgTotalWallSec / maxTotal) * 100));
            const totalForSegments = Math.max(
              0.1,
              SEGMENTS.reduce((sum, s) => sum + (row[s.key] || 0), 0)
            );
            const isHovered = hoveredRowSlug === row.slug;

            return (
              <div
                key={row.slug}
                onMouseEnter={() => setHoveredRowSlug(row.slug)}
                onMouseLeave={() => setHoveredRowSlug((prev) => (prev === row.slug ? null : prev))}
                onClick={() => onSelectApp?.(row.slug)}
                className="group cursor-pointer rounded-lg p-2 -mx-2 border border-transparent hover:border-slate-200 dark:hover:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-950/70 transition-colors"
              >
                <div className="flex items-center justify-between text-xs font-mono mb-1.5 tabular-nums">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-sans font-semibold text-slate-900 dark:text-slate-100">
                      {row.displayName}
                    </span>
                    <span className="text-[11px] text-slate-500">({row.runCount} runs)</span>
                  </div>
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    Avg {row.avgTotalWallSec}s
                  </span>
                </div>

                <div className="w-full h-4 rounded-md bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 overflow-hidden flex">
                  <div style={{ width: `${widthPct}%` }} className="h-full flex overflow-hidden">
                    {SEGMENTS.map((seg) => {
                      const val = row[seg.key] || 0;
                      if (val <= 0) return null;
                      const segPct = (val / totalForSegments) * 100;
                      return (
                        <div
                          key={seg.key}
                          style={{ width: `${segPct}%` }}
                          className={`${seg.colorClass} h-full border-r border-white/20 dark:border-slate-950/30 last:border-r-0`}
                          title={`${seg.label}: ${val}s`}
                        />
                      );
                    })}
                  </div>
                </div>

                <div
                  data-testid={`stage-waterfall-row-meta-${row.slug}`}
                  className={`mt-1.5 h-[36px] overflow-hidden flex flex-wrap content-start items-center gap-x-3 gap-y-0.5 text-[10px] leading-4 font-mono tabular-nums transition-opacity duration-150 ${
                    isHovered
                      ? 'opacity-100 text-slate-600 dark:text-slate-400'
                      : 'opacity-0 pointer-events-none select-none'
                  }`}
                  aria-hidden={!isHovered}
                >
                  {SEGMENTS.map((seg) => {
                    const val = row[seg.key] || 0;
                    if (val <= 0) return null;
                    return (
                      <span key={seg.key} className="inline-flex items-center gap-1 whitespace-nowrap">
                        <span className={`w-1.5 h-1.5 rounded-full ${seg.dotClass}`} />
                        {seg.label}: <strong className="text-slate-800 dark:text-slate-200">{val}s</strong>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
