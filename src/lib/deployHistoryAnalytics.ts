import { getAppTelemetryTargets } from './buildTelemetry';
import { formatLocalIsoDate, parseUtcDate } from './formatters';
import { DeployTelemetryRunRecord, DiscoveredApp, LocalDockerDiskUsage } from './types';

export type TelemetryTimeRange = '7d' | '14d' | '30d' | 'all';

export interface TelemetryFilterOptions {
  appSlug: string; // 'all' or slug
  range: TelemetryTimeRange;
  posture: string; // 'all' | 'cached' | 'warm' | 'cold' | 'static' | 'legacy'
  includeLegacy: boolean;
  nowMs?: number;
}

export interface TelemetryKpiSummary {
  totalRuns: number;
  succeededRuns: number;
  failedRuns: number;
  medianWallSec: number | null;
  avgWallSec: number | null;
  avgBuildSec: number | null;
  avgNonBuildSec: number | null;
  nonBuildSharePct: number | null;
  depsHitRatePct: number | null;
  arm64HitRatePct: number | null;
  avgContextKb: number | null;
  warningCount: number;
}

export interface TrendChartPoint {
  key: string;
  label: string;
  timestampMs: number;
  wallSec: number;
  buildSec: number;
  posture: string;
  engineVersion: string | null;
  failed: boolean;
  runCount: number;
  runId?: string;
  appName?: string;
}

export interface AppTelemetryMatrixRow {
  slug: string;
  displayName: string;
  runCount: number;
  avgWallSec: number | null;
  avgBuildCachedSec: number | null;
  avgBuildWarmSec: number | null;
  avgBuildColdSec: number | null;
  avgNonBuildSec: number | null;
  avgTypecheckSec: number | null;
  avgContextKb: number | null;
  maxContextKb: number;
  contextBudgetPct: number | null;
  depsHitRatePct: number | null;
  latestStatus: string;
  warningCount: number;
}

export interface StageWaterfallRow {
  slug: string;
  displayName: string;
  runCount: number;
  avgTotalWallSec: number;
  typecheckSec: number;
  bumpSec: number;
  depsSec: number;
  nextBuildSec: number;
  exportTailSec: number;
  uploadSec: number;
  snapshotSec: number;
  swapSec: number;
  verifySec: number;
  smokeSec: number;
  cronFinalizeSec: number;
  untrackedNonDockerSec: number;
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return round1(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return round1((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return round1(sorted[mid]);
}

export interface TelemetryActionableAlert {
  id: string;
  kind: 'failed_deploy' | 'build_warning' | 'cache_high';
  severity: 'error' | 'warning';
  appSlug?: string;
  appName: string;
  title: string;
  detail: string;
  startedAt?: string;
  consoleSessionId?: string | null;
  warnings: string[];
}

export function isLegacyRun(run: DeployTelemetryRunRecord): boolean {
  const posture = (run.cache_posture || '').toLowerCase().trim();
  if (posture === 'legacy') return true;
  if (posture === 'static') return false;
  if (!run.engine_version) return true;
  return /^0\.[0-3]\./.test(run.engine_version.trim());
}

export const BUILDKIT_RECLAIMABLE_WARN_BYTES = 35_000_000_000; // 35 GB reclaimable
export const BUILDKIT_TOTAL_WARN_BYTES = 100_000_000_000; // 100 GB total (7-app shared layer steady state)

export function isBuildKitCacheHigh(dockerDiskUsage?: LocalDockerDiskUsage | null): boolean {
  const totalBytes = dockerDiskUsage?.build_cache?.size_bytes ?? 0;
  const reclaimableBytes = dockerDiskUsage?.build_cache?.reclaimable_bytes ?? 0;
  return (
    reclaimableBytes >= BUILDKIT_RECLAIMABLE_WARN_BYTES ||
    totalBytes >= BUILDKIT_TOTAL_WARN_BYTES
  );
}

export function computeActionableTelemetryAlerts(params: {
  apps: DiscoveredApp[];
  runs: DeployTelemetryRunRecord[];
  dockerDiskUsage?: LocalDockerDiskUsage | null;
  dismissedIds?: Iterable<string>;
}): TelemetryActionableAlert[] {
  const dismissedSet = new Set(params.dismissedIds || []);
  const alerts: TelemetryActionableAlert[] = [];

  for (const app of params.apps) {
    const slug = app.manifest.slug.toLowerCase();
    const displayName = app.manifest.displayName || app.manifest.slug;

    const appNonLegacyRuns = params.runs
      .filter((r) => r.app_slug.toLowerCase() === slug && !isLegacyRun(r))
      .sort(
        (a, b) =>
          (parseUtcDate(b.started_at)?.getTime() ?? 0) -
          (parseUtcDate(a.started_at)?.getTime() ?? 0)
      );
    const latestRun = appNonLegacyRuns[0];

    if (latestRun) {
      const exitFailed =
        typeof latestRun.exit_code === 'number' && latestRun.exit_code !== 0;
      const statusFailed = latestRun.status === 'FAILED';
      const warnings = Array.isArray(latestRun.warnings) ? latestRun.warnings : [];

      if (statusFailed || exitFailed) {
        const alertId = `run:${latestRun.id}`;
        if (!dismissedSet.has(alertId)) {
          alerts.push({
            id: alertId,
            kind: 'failed_deploy',
            severity: 'error',
            appSlug: slug,
            appName: displayName,
            title: `${displayName} latest deploy failed (exit ${latestRun.exit_code ?? 'error'})`,
            detail:
              warnings[0] ||
              `Run ${latestRun.id} (${latestRun.cache_posture}) exited with status ${latestRun.status || 'FAILED'}. Inspect log or re-deploy in Releases & Drift.`,
            startedAt: latestRun.started_at,
            consoleSessionId: latestRun.console_session_id,
            warnings,
          });
        }
        continue;
      }

      if (
        (latestRun.status && latestRun.status !== 'OPTIMAL') ||
        warnings.length > 0
      ) {
        const alertId = `run:${latestRun.id}`;
        if (!dismissedSet.has(alertId)) {
          alerts.push({
            id: alertId,
            kind: 'build_warning',
            severity: latestRun.status === 'WARN_CEILING' ? 'error' : 'warning',
            appSlug: slug,
            appName: displayName,
            title: `${displayName} reported ${latestRun.status || 'BUILD_WARNING'}`,
            detail:
              warnings[0] ||
              `Latest ${latestRun.cache_posture} build completed with ${latestRun.wall_duration_sec ?? '—'}s wall time and non-optimal budget/regression status.`,
            startedAt: latestRun.started_at,
            consoleSessionId: latestRun.console_session_id,
            warnings,
          });
        }
      }
      continue;
    }

    const bt =
      app.health?.release?.build_telemetry || app.composition?.local_build_telemetry;
    if (bt && (bt.status !== 'OPTIMAL' || (bt.warnings?.length || 0) > 0)) {
      const alertId = `manifest:${slug}:${bt.status}`;
      if (!dismissedSet.has(alertId)) {
        const warnings = Array.isArray(bt.warnings) ? bt.warnings : [];
        alerts.push({
          id: alertId,
          kind: 'build_warning',
          severity: bt.status === 'WARN_CEILING' ? 'error' : 'warning',
          appSlug: slug,
          appName: displayName,
          title: `${displayName} reported ${bt.status}`,
          detail:
            warnings[0] ||
            `Latest recorded build telemetry flagged ${bt.status} (${bt.total_duration_sec}s ${bt.cache_posture}).`,
          warnings,
        });
      }
    }
  }

  if (isBuildKitCacheHigh(params.dockerDiskUsage)) {
    const alertId = 'cache:high-threshold';
    if (!dismissedSet.has(alertId)) {
      const totalGb = ((params.dockerDiskUsage?.build_cache?.size_bytes ?? 0) / 1_000_000_000).toFixed(1);
      const reclaimGb = (
        (params.dockerDiskUsage?.build_cache?.reclaimable_bytes ?? 0) / 1_000_000_000
      ).toFixed(1);
      alerts.push({
        id: alertId,
        kind: 'cache_high',
        severity: 'warning',
        appName: 'Local BuildKit Cache',
        title: `Local BuildKit cache (${totalGb} GB total, ${reclaimGb} GB reclaimable) exceeds budget`,
        detail:
          'Prune BuildKit cache layers unused for more than 3 days (72h) to reclaim disk space while preserving recent warm caches.',
        warnings: [],
      });
    }
  }

  return alerts.sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === 'error' ? -1 : 1;
  });
}

export function filterDeployRuns(
  runs: DeployTelemetryRunRecord[],
  options: TelemetryFilterOptions
): DeployTelemetryRunRecord[] {
  const nowMs = options.nowMs ?? Date.now();
  const cutoffMs =
    options.range === '7d'
      ? nowMs - 7 * 86_400_000
      : options.range === '14d'
      ? nowMs - 14 * 86_400_000
      : options.range === '30d'
      ? nowMs - 30 * 86_400_000
      : 0;

  return runs.filter((r) => {
    if (options.appSlug !== 'all' && r.app_slug.toLowerCase() !== options.appSlug.toLowerCase()) {
      return false;
    }
    if (!options.includeLegacy && isLegacyRun(r)) {
      return false;
    }
    if (options.posture !== 'all' && r.cache_posture.toLowerCase() !== options.posture.toLowerCase()) {
      return false;
    }
    if (cutoffMs > 0) {
      const parsed = parseUtcDate(r.started_at);
      if (!parsed || parsed.getTime() < cutoffMs) {
        return false;
      }
    }
    return true;
  });
}

export function computeTelemetryKpis(runs: DeployTelemetryRunRecord[]): TelemetryKpiSummary {
  const totalRuns = runs.length;
  const succeededRuns = runs.filter((r) => r.exit_code === 0).length;
  const failedRuns = runs.filter((r) => typeof r.exit_code === 'number' && r.exit_code !== 0).length;

  const walls = runs
    .map((r) => r.wall_duration_sec)
    .filter((v): v is number => typeof v === 'number' && v > 0);
  const builds = runs
    .map((r) => r.build_total_sec)
    .filter((v): v is number => typeof v === 'number' && v >= 0);

  const pairedNonBuild: number[] = [];
  for (const r of runs) {
    if (typeof r.wall_duration_sec === 'number' && typeof r.build_total_sec === 'number') {
      pairedNonBuild.push(Math.max(0, r.wall_duration_sec - r.build_total_sec));
    }
  }

  const avgWallSec = avg(walls);
  const avgBuildSec = avg(builds);
  const avgNonBuildSec = avg(pairedNonBuild);
  const nonBuildSharePct =
    avgWallSec && avgWallSec > 0 && avgNonBuildSec !== null
      ? Math.round((avgNonBuildSec / avgWallSec) * 100)
      : null;

  const depsKnown = runs.filter((r) => typeof r.deps_cache_hit === 'boolean');
  const depsHits = depsKnown.filter((r) => r.deps_cache_hit === true).length;
  const depsHitRatePct =
    depsKnown.length > 0 ? Math.round((depsHits / depsKnown.length) * 100) : null;

  const arm64Known = runs.filter((r) => typeof r.arm64_natives_cache_hit === 'boolean');
  const arm64Hits = arm64Known.filter((r) => r.arm64_natives_cache_hit === true).length;
  const arm64HitRatePct =
    arm64Known.length > 0 ? Math.round((arm64Hits / arm64Known.length) * 100) : null;

  const contexts = runs
    .map((r) => r.context_transfer_kb)
    .filter((v): v is number => typeof v === 'number' && v > 0);

  const warningCount = runs.filter(
    (r) => (r.warnings && r.warnings.length > 0) || (r.status && r.status !== 'OPTIMAL')
  ).length;

  return {
    totalRuns,
    succeededRuns,
    failedRuns,
    medianWallSec: median(walls),
    avgWallSec,
    avgBuildSec,
    avgNonBuildSec,
    nonBuildSharePct,
    depsHitRatePct,
    arm64HitRatePct,
    avgContextKb: avg(contexts),
    warningCount,
  };
}

export function buildTrendSeries(
  runs: DeployTelemetryRunRecord[],
  mode: 'daily' | 'per-run'
): TrendChartPoint[] {
  const chronological = [...runs].sort((a, b) => {
    const ta = parseUtcDate(a.started_at)?.getTime() ?? 0;
    const tb = parseUtcDate(b.started_at)?.getTime() ?? 0;
    return ta - tb;
  });

  if (mode === 'per-run') {
    return chronological.map((r) => {
      const ts = parseUtcDate(r.started_at)?.getTime() ?? 0;
      const dateStr = formatLocalIsoDate(r.started_at);
      const shortDate = dateStr !== 'N/A' ? dateStr.slice(5) : r.started_at.slice(5, 10);
      return {
        key: r.id,
        label: `${shortDate} ${r.app_slug}`,
        timestampMs: ts,
        wallSec: round1(r.wall_duration_sec ?? 0),
        buildSec: round1(r.build_total_sec ?? 0),
        posture: r.cache_posture,
        engineVersion: r.engine_version ?? null,
        failed: typeof r.exit_code === 'number' && r.exit_code !== 0,
        runCount: 1,
        runId: r.id,
        appName: r.app_name,
      };
    });
  }

  const byDay = new Map<string, DeployTelemetryRunRecord[]>();
  for (const r of chronological) {
    const dayKey = formatLocalIsoDate(r.started_at);
    const key = dayKey !== 'N/A' ? dayKey : r.started_at.slice(0, 10);
    const list = byDay.get(key) || [];
    list.push(r);
    byDay.set(key, list);
  }

  const points: TrendChartPoint[] = [];
  for (const [dayKey, dayRuns] of byDay.entries()) {
    const walls = dayRuns
      .map((r) => r.wall_duration_sec)
      .filter((v): v is number => typeof v === 'number' && v >= 0);
    const builds = dayRuns
      .map((r) => r.build_total_sec)
      .filter((v): v is number => typeof v === 'number' && v >= 0);
    const ts = parseUtcDate(dayRuns[0].started_at)?.getTime() ?? 0;
    const hasFail = dayRuns.some((r) => typeof r.exit_code === 'number' && r.exit_code !== 0);
    const versions = dayRuns.map((r) => r.engine_version).filter(Boolean) as string[];
    const latestVer = versions.length > 0 ? versions[versions.length - 1] : null;
    points.push({
      key: dayKey,
      label: dayKey.slice(5),
      timestampMs: ts,
      wallSec: avg(walls) ?? 0,
      buildSec: avg(builds) ?? 0,
      posture: hasFail ? 'mixed' : dayRuns[dayRuns.length - 1].cache_posture,
      engineVersion: latestVer,
      failed: hasFail,
      runCount: dayRuns.length,
    });
  }
  return points;
}

export function buildAppMatrix(
  runs: DeployTelemetryRunRecord[],
  apps: DiscoveredApp[]
): AppTelemetryMatrixRow[] {
  const bySlug = new Map<string, DeployTelemetryRunRecord[]>();
  for (const r of runs) {
    const slug = r.app_slug.toLowerCase();
    const list = bySlug.get(slug) || [];
    list.push(r);
    bySlug.set(slug, list);
  }

  const rows: AppTelemetryMatrixRow[] = [];
  for (const [slug, appRuns] of bySlug.entries()) {
    const appMeta = apps.find((a) => a.manifest.slug.toLowerCase() === slug);
    const displayName = appMeta?.manifest.displayName || appRuns[0]?.app_name || slug;
    const targets = getAppTelemetryTargets(
      appMeta?.manifest.containerName || slug,
      'warm'
    );

    const walls = appRuns
      .map((r) => r.wall_duration_sec)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    const cachedBuilds = appRuns
      .filter((r) => r.cache_posture === 'cached' && typeof r.build_total_sec === 'number')
      .map((r) => r.build_total_sec as number);
    const warmBuilds = appRuns
      .filter((r) => r.cache_posture === 'warm' && typeof r.build_total_sec === 'number')
      .map((r) => r.build_total_sec as number);
    const coldBuilds = appRuns
      .filter((r) => r.cache_posture === 'cold' && typeof r.build_total_sec === 'number')
      .map((r) => r.build_total_sec as number);
    const nonBuilds = appRuns
      .filter((r) => typeof r.wall_duration_sec === 'number' && typeof r.build_total_sec === 'number')
      .map((r) => Math.max(0, (r.wall_duration_sec as number) - (r.build_total_sec as number)));
    const typechecks = appRuns
      .map((r) => r.host_typecheck_sec)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    const contexts = appRuns
      .map((r) => r.context_transfer_kb)
      .filter((v): v is number => typeof v === 'number' && v > 0);

    const depsKnown = appRuns.filter((r) => typeof r.deps_cache_hit === 'boolean');
    const depsHitRatePct =
      depsKnown.length > 0
        ? Math.round((depsKnown.filter((r) => r.deps_cache_hit === true).length / depsKnown.length) * 100)
        : null;

    const sortedLatest = [...appRuns].sort((a, b) => {
      const ta = parseUtcDate(a.started_at)?.getTime() ?? 0;
      const tb = parseUtcDate(b.started_at)?.getTime() ?? 0;
      return tb - ta;
    });

    const avgContextKb = avg(contexts);
    rows.push({
      slug,
      displayName,
      runCount: appRuns.length,
      avgWallSec: avg(walls),
      avgBuildCachedSec: avg(cachedBuilds),
      avgBuildWarmSec: avg(warmBuilds),
      avgBuildColdSec: avg(coldBuilds),
      avgNonBuildSec: avg(nonBuilds),
      avgTypecheckSec: avg(typechecks),
      avgContextKb,
      maxContextKb: targets.maxContextKB,
      contextBudgetPct:
        avgContextKb !== null && targets.maxContextKB > 0
          ? Math.round((avgContextKb / targets.maxContextKB) * 100)
          : null,
      depsHitRatePct,
      latestStatus: sortedLatest[0]?.status || 'OPTIMAL',
      warningCount: appRuns.filter((r) => (r.warnings?.length || 0) > 0 || (r.status && r.status !== 'OPTIMAL')).length,
    });
  }

  return rows.sort((a, b) => (b.avgWallSec ?? 0) - (a.avgWallSec ?? 0));
}

export function buildStageWaterfall(
  runs: DeployTelemetryRunRecord[],
  apps: DiscoveredApp[]
): StageWaterfallRow[] {
  const bySlug = new Map<string, DeployTelemetryRunRecord[]>();
  for (const r of runs) {
    if (typeof r.wall_duration_sec !== 'number' || r.wall_duration_sec <= 0) continue;
    const slug = r.app_slug.toLowerCase();
    const list = bySlug.get(slug) || [];
    list.push(r);
    bySlug.set(slug, list);
  }

  const out: StageWaterfallRow[] = [];
  for (const [slug, appRuns] of bySlug.entries()) {
    const appMeta = apps.find((a) => a.manifest.slug.toLowerCase() === slug);
    const displayName = appMeta?.manifest.displayName || appRuns[0]?.app_name || slug;

    const mean = (picker: (r: DeployTelemetryRunRecord) => number | null | undefined): number => {
      const vals = appRuns.map(picker).filter((v): v is number => typeof v === 'number' && v >= 0);
      if (vals.length === 0) return 0;
      return round1(vals.reduce((a, b) => a + b, 0) / vals.length);
    };

    const avgTotalWallSec = mean((r) => r.wall_duration_sec);
    const typecheckSec = mean((r) => r.host_typecheck_sec);
    const bumpSec = mean((r) => r.semver_bump_sec);
    const depsSec = mean((r) => r.deps_stage_sec);
    const nextBuildSec = mean((r) => r.next_build_sec);
    const avgBuildTotal = mean((r) => r.build_total_sec);
    const exportTailSec =
      mean((r) =>
        typeof r.export_tar_sec === 'number' || typeof r.arm64_natives_sec === 'number'
          ? (r.export_tar_sec ?? 0) + (r.arm64_natives_sec ?? 0)
          : null
      ) || Math.max(0, round1(avgBuildTotal - depsSec - nextBuildSec));

    const uploadSec = mean((r) => r.stage4_upload_sec);
    const snapshotSec = mean((r) => r.stage5_snapshot_sec);
    const swapSec = mean((r) => r.stage5_swap_sec);
    const verifySec = mean((r) => r.stage5_verify_sec);
    const smokeSec = mean((r) => r.stage5_smoke_sec);
    const cronFinalizeSec = mean((r) => {
      const sum =
        (r.stage5_cron_sec ?? 0) +
        (r.stage5_finalize_sec ?? 0) +
        (r.stage5_manifest_sync_sec ?? 0) +
        (r.stage3_preflight_sec ?? 0);
      return sum > 0 ? sum : null;
    });

    const accountedSec =
      typecheckSec +
      bumpSec +
      depsSec +
      nextBuildSec +
      exportTailSec +
      uploadSec +
      snapshotSec +
      swapSec +
      verifySec +
      smokeSec +
      cronFinalizeSec;

    const untrackedNonDockerSec = Math.max(0, round1(avgTotalWallSec - accountedSec));

    out.push({
      slug,
      displayName,
      runCount: appRuns.length,
      avgTotalWallSec,
      typecheckSec,
      bumpSec,
      depsSec,
      nextBuildSec,
      exportTailSec,
      uploadSec,
      snapshotSec,
      swapSec,
      verifySec,
      smokeSec,
      cronFinalizeSec,
      untrackedNonDockerSec,
    });
  }

  return out.sort((a, b) => b.avgTotalWallSec - a.avgTotalWallSec);
}
