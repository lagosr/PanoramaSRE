import React from 'react';
import { AlertTriangle, BarChart3, Container } from 'lucide-react';
import {
  evaluateBuildHealthBadge,
  getAppTelemetryTargets,
  resolveActiveBuildTelemetry,
} from '../../lib/buildTelemetry';

interface BuildEfficiencyStripProps {
  appSlug: string;
  resolvedTelemetry: ReturnType<typeof resolveActiveBuildTelemetry>;
  healthBadge: ReturnType<typeof evaluateBuildHealthBadge>;
  targets: ReturnType<typeof getAppTelemetryTargets>;
  onOpenTelemetry?: (slug: string) => void;
}

export const BuildEfficiencyStrip: React.FC<BuildEfficiencyStripProps> = ({
  appSlug,
  resolvedTelemetry,
  healthBadge,
  targets,
  onOpenTelemetry,
}) => {
  const telemetry = resolvedTelemetry.telemetry;

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2.5 shadow-sm flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2 min-w-0 text-xs font-mono tabular-nums">
        <span className="inline-flex items-center gap-1.5 text-slate-900 dark:text-slate-100 font-sans font-semibold">
          <Container className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
          <span>Build Efficiency</span>
        </span>

        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${
            healthBadge.tone === 'emerald'
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
              : healthBadge.tone === 'amber'
              ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40'
              : healthBadge.tone === 'rose'
              ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700'
          }`}
        >
          {healthBadge.label}
        </span>

        <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 whitespace-nowrap">
          {resolvedTelemetry.source === 'LIVE_PROD'
            ? 'LIVE PROD'
            : resolvedTelemetry.source === 'LOCAL_MANIFEST'
            ? 'LOCAL'
            : 'TARGETS'}
        </span>

        {telemetry ? (
          <>
            <span className="text-slate-700 dark:text-slate-300 whitespace-nowrap">
              {telemetry.total_duration_sec}s / ≤{targets.activeTargetSec}s{' '}
              <span className="uppercase text-slate-500 dark:text-slate-400">
                {telemetry.cache_posture}
              </span>
            </span>
            <span className="text-slate-300 dark:text-slate-700">•</span>
            <span
              className={`whitespace-nowrap ${
                telemetry.deps_cache_hit
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              Deps {telemetry.deps_cache_hit ? 'CACHED' : `${telemetry.deps_stage_sec}s`}
            </span>
            <span className="text-slate-300 dark:text-slate-700">•</span>
            <span className="text-slate-600 dark:text-slate-400 whitespace-nowrap">
              {telemetry.context_transfer_kb} KB
            </span>
            <span className="text-slate-300 dark:text-slate-700">•</span>
            <span className="text-slate-600 dark:text-slate-400 whitespace-nowrap">
              {telemetry.elf_verified_count} ELF 0xb7
            </span>
            {healthBadge.warnings.length > 0 && (
              <span
                title={healthBadge.warnings.join(' | ')}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/40 whitespace-nowrap"
              >
                <AlertTriangle className="w-3 h-3 shrink-0" />
                {healthBadge.warnings.length} warn
              </span>
            )}
          </>
        ) : (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Warm ≤{targets.targetWarmSec}s · Cold ≤{targets.targetColdSec}s · Context ≤
            {targets.maxContextKB} KB · ELF 0xb7 armed
          </span>
        )}
      </div>

      {onOpenTelemetry && (
        <button
          type="button"
          onClick={() => onOpenTelemetry(appSlug)}
          className="btn-secondary text-xs py-1 px-3 min-h-[34px] flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
        >
          <BarChart3 className="w-3.5 h-3.5 text-[var(--color-brand-text)]" />
          <span>Full Telemetry &amp; Trends →</span>
        </button>
      )}
    </div>
  );
};
