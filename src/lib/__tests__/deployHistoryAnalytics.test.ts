import { describe, it, expect } from 'vitest';
import {
  buildAppMatrix,
  buildStageWaterfall,
  buildTrendSeries,
  computeActionableTelemetryAlerts,
  computeTelemetryKpis,
  filterDeployRuns,
  isLegacyRun,
} from '../deployHistoryAnalytics';
import { DeployTelemetryRunRecord, DiscoveredApp } from '../types';

function makeRun(overrides: Partial<DeployTelemetryRunRecord> = {}): DeployTelemetryRunRecord {
  return {
    id: 'deploy-basket-1',
    console_session_id: 'deploy-basket-1',
    app_slug: 'basket',
    app_name: 'TastyBasket',
    started_at: '2026-11-21T12:00:00Z',
    finished_at: '2026-11-21T12:01:00Z',
    wall_duration_sec: 60.0,
    exit_code: 0,
    engine_version: '0.7.0',
    release_id: '1.0.9+abc',
    cache_posture: 'warm',
    status: 'OPTIMAL',
    host_typecheck_sec: 3.2,
    semver_bump_sec: 1.5,
    build_total_sec: 22.0,
    deps_stage_sec: 0,
    deps_cache_hit: true,
    next_build_sec: 18.0,
    arm64_natives_sec: 0,
    arm64_natives_cache_hit: true,
    export_tar_sec: 4.0,
    context_transfer_kb: 380,
    elf_verified_count: 2,
    stage3_preflight_sec: 1.2,
    stage4_upload_sec: 4.5,
    stage5_snapshot_sec: 1.8,
    stage5_swap_sec: 6.0,
    stage5_verify_sec: 2.1,
    stage5_smoke_sec: 12.0,
    stage5_finalize_sec: 2.5,
    stage5_cron_sec: 1.1,
    stage5_manifest_sync_sec: 0,
    bumped: true,
    ran_smoke: true,
    warnings: [],
    source: 'backfill',
    ...overrides,
  };
}

describe('deployHistoryAnalytics', () => {
  const nowMs = Date.parse('2026-11-21T18:00:00Z');

  it('filters by app, time window, posture, and legacy engine era', () => {
    const runs = [
      makeRun({ id: 'modern-1', app_slug: 'basket', engine_version: '0.6.1', cache_posture: 'warm', started_at: '2026-11-21T10:00:00Z' }),
      makeRun({ id: 'cached-1', app_slug: 'biomed', engine_version: '0.7.0', cache_posture: 'cached', started_at: '2026-11-20T10:00:00Z' }),
      makeRun({ id: 'legacy-1', app_slug: 'basket', engine_version: '0.3.2', cache_posture: 'legacy', started_at: '2026-11-18T10:00:00Z' }),
      makeRun({ id: 'old-40d', app_slug: 'biomed', engine_version: '0.4.0', cache_posture: 'cold', started_at: '2026-10-01T10:00:00Z' }),
    ];

    expect(isLegacyRun(runs[2])).toBe(true);
    expect(isLegacyRun(runs[0])).toBe(false);

    const modern14d = filterDeployRuns(runs, {
      appSlug: 'all',
      range: '14d',
      posture: 'all',
      includeLegacy: false,
      nowMs,
    });
    expect(modern14d.map((r) => r.id)).toEqual(['modern-1', 'cached-1']);

    const withLegacy = filterDeployRuns(runs, {
      appSlug: 'basket',
      range: '14d',
      posture: 'all',
      includeLegacy: true,
      nowMs,
    });
    expect(withLegacy.map((r) => r.id)).toEqual(['modern-1', 'legacy-1']);
  });

  it('computes accurate KPI median/avg wall, build vs non-build split, and cache hit rates', () => {
    const runs = [
      makeRun({ id: 'r1', wall_duration_sec: 40, build_total_sec: 20, deps_cache_hit: true, arm64_natives_cache_hit: true, context_transfer_kb: 300 }),
      makeRun({ id: 'r2', wall_duration_sec: 60, build_total_sec: 25, deps_cache_hit: true, arm64_natives_cache_hit: false, context_transfer_kb: 400, status: 'WARN_REGRESSION', warnings: ['regressed'] }),
      makeRun({ id: 'r3', wall_duration_sec: 110, build_total_sec: 75, deps_cache_hit: false, arm64_natives_cache_hit: false, context_transfer_kb: 500, exit_code: 1 }),
    ];

    const kpis = computeTelemetryKpis(runs);
    expect(kpis.totalRuns).toBe(3);
    expect(kpis.succeededRuns).toBe(2);
    expect(kpis.failedRuns).toBe(1);
    expect(kpis.medianWallSec).toBe(60);
    expect(kpis.avgWallSec).toBe(70);
    expect(kpis.avgBuildSec).toBe(40);
    expect(kpis.avgNonBuildSec).toBe(30);
    expect(kpis.nonBuildSharePct).toBe(43);
    expect(kpis.depsHitRatePct).toBe(67);
    expect(kpis.arm64HitRatePct).toBe(33);
    expect(kpis.avgContextKb).toBe(400);
    expect(kpis.warningCount).toBe(1);
  });

  it('aggregates daily and per-run trend points, app matrix, and stage waterfall deterministically', () => {
    const runs = [
      makeRun({ id: 'r1', app_slug: 'basket', app_name: 'TastyBasket', started_at: '2026-11-19T12:00:00Z', wall_duration_sec: 80, build_total_sec: 22, cache_posture: 'warm' }),
      makeRun({ id: 'r2', app_slug: 'basket', app_name: 'TastyBasket', started_at: '2026-11-19T16:00:00Z', wall_duration_sec: 50, build_total_sec: 6, cache_posture: 'cached' }),
      makeRun({ id: 'r3', app_slug: 'biomed', app_name: 'BiomedMaven', started_at: '2026-11-20T14:00:00Z', wall_duration_sec: 44, build_total_sec: 21, cache_posture: 'warm' }),
    ];

    const daily = buildTrendSeries(runs, 'daily');
    expect(daily).toHaveLength(2);
    expect(daily[0].wallSec).toBe(65);
    expect(daily[0].buildSec).toBe(14);
    expect(daily[0].runCount).toBe(2);

    const perRun = buildTrendSeries(runs, 'per-run');
    expect(perRun).toHaveLength(3);
    expect(perRun[1].posture).toBe('cached');

    const matrix = buildAppMatrix(runs, []);
    expect(matrix).toHaveLength(2);
    expect(matrix[0].slug).toBe('basket');
    expect(matrix[0].avgBuildCachedSec).toBe(6);
    expect(matrix[0].avgBuildWarmSec).toBe(22);

    const waterfall = buildStageWaterfall(runs, []);
    expect(waterfall[0].slug).toBe('basket');
    expect(waterfall[0].typecheckSec).toBe(3.2);
    expect(waterfall[0].smokeSec).toBe(12);
  });

  it('treats static edge deploys with null engine_version as non-legacy and computes actionable alerts', () => {
    const staticFailedRun = makeRun({
      id: 'deploy-parakith-fail',
      app_slug: 'parakith',
      app_name: 'ParakithSite',
      cache_posture: 'static',
      engine_version: null,
      status: 'FAILED',
      exit_code: 1,
      started_at: '2026-11-25 00:05:06',
    });

    expect(isLegacyRun(staticFailedRun)).toBe(false);

    const parakithApp = {
      manifest: { slug: 'parakith', displayName: 'ParakithSite' },
    } as unknown as DiscoveredApp;

    const alerts = computeActionableTelemetryAlerts({
      apps: [parakithApp],
      runs: [staticFailedRun],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('run:deploy-parakith-fail');
    expect(alerts[0].kind).toBe('failed_deploy');
    expect(alerts[0].severity).toBe('error');

    // Dismissing clears the specific failed run alert
    const afterDismiss = computeActionableTelemetryAlerts({
      apps: [parakithApp],
      runs: [staticFailedRun],
      dismissedIds: ['run:deploy-parakith-fail'],
    });
    expect(afterDismiss).toHaveLength(0);

    // A newer successful deploy supersedes the older failed run automatically
    const newerSuccessRun = makeRun({
      id: 'deploy-parakith-ok',
      app_slug: 'parakith',
      app_name: 'ParakithSite',
      cache_posture: 'static',
      engine_version: null,
      status: 'OPTIMAL',
      exit_code: 0,
      started_at: '2026-11-25 08:00:00',
    });
    const clearedByNewRun = computeActionableTelemetryAlerts({
      apps: [parakithApp],
      runs: [staticFailedRun, newerSuccessRun],
    });
    expect(clearedByNewRun).toHaveLength(0);

    // Healthy 7-app warm cache steady state (76.4 GB shared total, 21.4 GB reclaimable) triggers zero alerts
    const steadyAlerts = computeActionableTelemetryAlerts({
      apps: [parakithApp],
      runs: [newerSuccessRun],
      dockerDiskUsage: {
        images: { total_count: 0, active_count: 0, size_bytes: 0, reclaimable_bytes: 0 },
        containers: { total_count: 0, active_count: 0, size_bytes: 0, reclaimable_bytes: 0 },
        volumes: { total_count: 0, active_count: 0, size_bytes: 0, reclaimable_bytes: 0 },
        build_cache: {
          total_count: 919,
          active_count: 0,
          size_bytes: 76_420_000_000,
          reclaimable_bytes: 21_440_000_000,
        },
        captured_at: '2026-11-25T08:00:00Z',
      },
    });
    expect(steadyAlerts).toHaveLength(0);

    // Total BuildKit cache >= 100 GB triggers an actionable warning alert
    const totalHighAlerts = computeActionableTelemetryAlerts({
      apps: [parakithApp],
      runs: [newerSuccessRun],
      dockerDiskUsage: {
        images: { total_count: 0, active_count: 0, size_bytes: 0, reclaimable_bytes: 0 },
        containers: { total_count: 0, active_count: 0, size_bytes: 0, reclaimable_bytes: 0 },
        volumes: { total_count: 0, active_count: 0, size_bytes: 0, reclaimable_bytes: 0 },
        build_cache: {
          total_count: 1107,
          active_count: 0,
          size_bytes: 109_200_000_000,
          reclaimable_bytes: 21_440_000_000,
        },
        captured_at: '2026-11-25T08:00:00Z',
      },
    });
    expect(totalHighAlerts).toHaveLength(1);
    expect(totalHighAlerts[0].kind).toBe('cache_high');
    expect(totalHighAlerts[0].severity).toBe('warning');

    // Reclaimable BuildKit bloat >= 35 GB triggers an actionable warning alert even below 100 GB total
    const reclaimHighAlerts = computeActionableTelemetryAlerts({
      apps: [parakithApp],
      runs: [newerSuccessRun],
      dockerDiskUsage: {
        images: { total_count: 0, active_count: 0, size_bytes: 0, reclaimable_bytes: 0 },
        containers: { total_count: 0, active_count: 0, size_bytes: 0, reclaimable_bytes: 0 },
        volumes: { total_count: 0, active_count: 0, size_bytes: 0, reclaimable_bytes: 0 },
        build_cache: {
          total_count: 500,
          active_count: 0,
          size_bytes: 60_000_000_000,
          reclaimable_bytes: 36_000_000_000,
        },
        captured_at: '2026-11-25T08:00:00Z',
      },
    });
    expect(reclaimHighAlerts).toHaveLength(1);
    expect(reclaimHighAlerts[0].kind).toBe('cache_high');
    expect(reclaimHighAlerts[0].severity).toBe('warning');
  });
});
