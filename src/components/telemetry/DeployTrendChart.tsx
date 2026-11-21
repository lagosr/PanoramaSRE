import React, { useState } from 'react';
import { SegmentedControl } from '@lagosr/panorama-ui-kit';
import { TrendChartPoint } from '../../lib/deployHistoryAnalytics';
import { Activity, AlertTriangle } from 'lucide-react';

interface DeployTrendChartProps {
  points: TrendChartPoint[];
  mode: 'daily' | 'per-run';
  onModeChange: (mode: 'daily' | 'per-run') => void;
  warmTargetSec?: number;
  ceilingSec?: number;
  onSelectRun?: (runId: string) => void;
}

export const DeployTrendChart: React.FC<DeployTrendChartProps> = ({
  points,
  mode,
  onModeChange,
  warmTargetSec = 35,
  ceilingSec = 120,
  onSelectRun,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const width = 920;
  const height = 280;
  const pad = { top: 24, right: 24, bottom: 44, left: 50 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxObserved = points.reduce(
    (max, p) => Math.max(max, p.wallSec, p.buildSec),
    Math.max(warmTargetSec * 1.4, 40)
  );
  // Cap axis ceiling smoothly while preserving high spikes cleanly
  const yMax = Math.max(ceilingSec, Math.ceil((maxObserved * 1.12) / 20) * 20);

  const yFor = (sec: number): number => {
    const clamped = Math.max(0, Math.min(sec, yMax));
    return pad.top + plotH - (clamped / yMax) * plotH;
  };

  const xFor = (idx: number): number => {
    if (points.length <= 1) return pad.left + plotW / 2;
    return pad.left + (idx / (points.length - 1)) * plotW;
  };

  const stepW = points.length > 0 ? plotW / Math.max(points.length, 1) : plotW;
  const barW = Math.max(4, Math.min(26, stepW * 0.52));

  const yTicks = [0, Math.round(yMax * 0.25), Math.round(yMax * 0.5), Math.round(yMax * 0.75), yMax];

  const buildPolyline = points
    .map((p, i) => `${xFor(i).toFixed(1)},${yFor(p.buildSec).toFixed(1)}`)
    .join(' ');

  const wallPolyline = points
    .map((p, i) => `${xFor(i).toFixed(1)},${yFor(p.wallSec).toFixed(1)}`)
    .join(' ');

  const postureFill = (p: TrendChartPoint): string => {
    if (p.failed) return '#e11d48'; // rose-600
    switch (p.posture) {
      case 'cached':
        return '#06b6d4'; // cyan-500
      case 'warm':
        return '#10b981'; // emerald-500
      case 'cold':
        return '#f59e0b'; // amber-500
      case 'legacy':
        return '#64748b'; // slate-500
      default:
        return '#8b5cf6'; // violet-500
    }
  };

  const hovered = hoveredIdx !== null ? points[hoveredIdx] ?? null : null;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Activity className="w-4 h-4 text-[var(--color-brand-text)]" />
            <span>Historical Deployment Duration Trend (Wall-Clock vs Docker Build)</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Bars show total end-to-end deploy time; line tracks Stage 2 Docker build time so non-Docker overhead stands out immediately.
          </p>
        </div>

        <SegmentedControl
          size="sm"
          activeVariant="brand"
          value={mode}
          onChange={(v) => onModeChange(v as 'daily' | 'per-run')}
          options={[
            { value: 'daily', label: 'Daily Averages' },
            { value: 'per-run', label: 'Per-Run Timeline' },
          ]}
        />
      </div>

      {points.length === 0 ? (
        <div className="h-56 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 flex items-center justify-center text-xs text-slate-500 font-mono">
          No deployment runs match the active filters.
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto overflow-visible select-none"
            role="img"
            aria-label="Deployment duration trend chart"
          >
            {/* Horizontal grid & Y-axis labels */}
            {yTicks.map((tick) => {
              const y = yFor(tick);
              return (
                <g key={tick}>
                  <line
                    x1={pad.left}
                    y1={y}
                    x2={width - pad.right}
                    y2={y}
                    stroke="currentColor"
                    className="text-slate-200 dark:text-slate-800"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={pad.left - 8}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono tabular-nums"
                  >
                    {tick}s
                  </text>
                </g>
              );
            })}

            {/* Warm build target line */}
            {warmTargetSec <= yMax && (
              <g>
                <line
                  x1={pad.left}
                  y1={yFor(warmTargetSec)}
                  x2={width - pad.right}
                  y2={yFor(warmTargetSec)}
                  stroke="#10b981"
                  strokeWidth={1.25}
                  strokeDasharray="5 4"
                  opacity={0.75}
                />
                <text
                  x={width - pad.right}
                  y={yFor(warmTargetSec) - 4}
                  textAnchor="end"
                  className="fill-emerald-600 dark:fill-emerald-400 text-[10px] font-mono font-semibold"
                >
                  Warm Target ({warmTargetSec}s)
                </text>
              </g>
            )}

            {/* Hard ceiling reference line */}
            {ceilingSec <= yMax && (
              <g>
                <line
                  x1={pad.left}
                  y1={yFor(ceilingSec)}
                  x2={width - pad.right}
                  y2={yFor(ceilingSec)}
                  stroke="#f43f5e"
                  strokeWidth={1.25}
                  strokeDasharray="6 4"
                  opacity={0.65}
                />
                <text
                  x={width - pad.right}
                  y={yFor(ceilingSec) - 4}
                  textAnchor="end"
                  className="fill-rose-600 dark:fill-rose-400 text-[10px] font-mono font-semibold"
                >
                  Hard Ceiling ({ceilingSec}s)
                </text>
              </g>
            )}

            {/* Total wall-clock bars */}
            {points.map((p, idx) => {
              const cx = xFor(idx);
              const barY = yFor(p.wallSec);
              const barH = Math.max(2, pad.top + plotH - barY);
              const isHovered = hoveredIdx === idx;
              return (
                <g
                  key={p.key}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx((prev) => (prev === idx ? null : prev))}
                  onClick={() => {
                    if (p.runId && onSelectRun) onSelectRun(p.runId);
                  }}
                >
                  <rect
                    x={cx - barW / 2}
                    y={barY}
                    width={barW}
                    height={barH}
                    rx={3}
                    fill={p.failed ? '#f43f5e' : '#f97316'}
                    opacity={isHovered ? 0.45 : 0.24}
                  />
                  {/* Invisible wider hover hit area */}
                  <rect
                    x={cx - Math.max(barW, 14) / 2}
                    y={pad.top}
                    width={Math.max(barW, 14)}
                    height={plotH}
                    fill="transparent"
                  />
                </g>
              );
            })}

            {/* Wall-clock top trend line */}
            {points.length > 1 && (
              <polyline
                fill="none"
                stroke="#f97316"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={wallPolyline}
                opacity={0.85}
              />
            )}

            {/* Docker build duration overlay line */}
            {points.length > 1 && (
              <polyline
                fill="none"
                stroke="#0ea5e9"
                strokeWidth={2.25}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={buildPolyline}
              />
            )}

            {/* Posture-colored markers on Docker build line */}
            {points.map((p, idx) => {
              const cx = xFor(idx);
              const cyBuild = yFor(p.buildSec);
              const isHovered = hoveredIdx === idx;
              return (
                <circle
                  key={`${p.key}-dot`}
                  cx={cx}
                  cy={cyBuild}
                  r={isHovered ? 5.5 : 3.5}
                  fill={postureFill(p)}
                  stroke="white"
                  strokeWidth={1.5}
                  className="pointer-events-none"
                />
              );
            })}

            {/* Sparse X-axis labels */}
            {points.map((p, idx) => {
              const stride = Math.max(1, Math.ceil(points.length / 8));
              if (idx % stride !== 0 && idx !== points.length - 1) return null;
              const cx = xFor(idx);
              return (
                <text
                  key={`${p.key}-lbl`}
                  x={cx}
                  y={height - 12}
                  textAnchor="middle"
                  className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono"
                >
                  {p.label.length > 14 ? `${p.label.slice(0, 14)}…` : p.label}
                </text>
              );
            })}
          </svg>

          {/* Interactive Hover Readout */}
          <div className="mt-2 min-h-[38px] rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
            {hovered ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {hovered.appName ? `${hovered.appName} (${hovered.label})` : hovered.label}
                  </span>
                  {hovered.engineVersion && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      v{hovered.engineVersion}
                    </span>
                  )}
                  <span className="px-1.5 py-0.5 rounded text-[10px] uppercase bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {hovered.posture}
                  </span>
                  {hovered.failed && (
                    <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-bold">
                      <AlertTriangle className="w-3 h-3" /> FAILED
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <span className="text-orange-600 dark:text-orange-400 font-semibold">
                    Wall: {hovered.wallSec}s
                  </span>
                  <span className="text-sky-600 dark:text-sky-400 font-semibold">
                    Build: {hovered.buildSec}s
                  </span>
                  <span className="text-slate-600 dark:text-slate-400">
                    Overhead: {Math.max(0, Math.round((hovered.wallSec - hovered.buildSec) * 10) / 10)}s
                  </span>
                  {hovered.runCount > 1 && (
                    <span className="text-slate-500">({hovered.runCount} runs)</span>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-between w-full gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-orange-500/70" />
                    Wall-Clock Total
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-0.5 bg-sky-500" />
                    Docker Build
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-cyan-500" /> Cached
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" /> Warm
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500" /> Cold
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-slate-500" /> Legacy
                  </span>
                </div>
                <span>Hover any bar or point to inspect exact timings</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
