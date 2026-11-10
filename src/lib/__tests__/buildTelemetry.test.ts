import { describe, it, expect } from 'vitest';
import {
  getAppTelemetryTargets,
  resolveActiveBuildTelemetry,
  evaluateBuildHealthBadge,
} from '../buildTelemetry';
import { BuildTelemetry, ReleaseInfo, AppCompositionReport } from '../types';

function makeTelemetry(overrides: Partial<BuildTelemetry> = {}): BuildTelemetry {
  return {
    profile: 'nextjs-standalone',
    cache_posture: 'warm',
    status: 'OPTIMAL',
    total_duration_sec: 28.4,
    host_typecheck_sec: 3.5,
    types_prevalidated: true,
    context_transfer_kb: 380,
    deps_stage_sec: 0,
    deps_cache_hit: true,
    next_build_sec: 21.2,
    turbopack_compile_sec: 12.1,
    next_typecheck_sec: 0,
    page_data_sec: 1.9,
    arm64_natives_sec: 0,
    arm64_natives_cache_hit: true,
    elf_verified_count: 2,
    export_tar_sec: 3.7,
    baseline_duration_sec: 27.5,
    delta_sec: 0.9,
    regression_pct: 3.3,
    warnings: [],
    ...overrides,
  };
}

describe('buildTelemetry utilities', () => {
  it('resolves heuristic targets accurately across all 6 suite applications', () => {
    const biomedWarm = getAppTelemetryTargets('biomed-maven', 'warm');
    expect(biomedWarm.targetWarmSec).toBe(35);
    expect(biomedWarm.targetColdSec).toBe(75);
    expect(biomedWarm.maxCeilingSec).toBe(120);
    expect(biomedWarm.regressionThresholdPct).toBe(10);
    expect(biomedWarm.maxContextKB).toBe(2048);

    const spendyWarm = getAppTelemetryTargets('spendyledger', 'warm');
    expect(spendyWarm.targetWarmSec).toBe(45);
    expect(spendyWarm.targetColdSec).toBe(90);
    expect(spendyWarm.maxContextKB).toBe(6500);

    const authCold = getAppTelemetryTargets('panorama-auth', 'cold');
    expect(authCold.targetWarmSec).toBe(45);
    expect(authCold.activeTargetSec).toBe(90);
    expect(authCold.maxContextKB).toBe(2048);

    const resWarm = getAppTelemetryTargets('panorama-resources', 'warm');
    expect(resWarm.targetWarmSec).toBe(15);
    expect(resWarm.targetColdSec).toBe(30);
    expect(resWarm.maxCeilingSec).toBe(60);
    expect(resWarm.maxContextKB).toBe(1024);
  });

  it('prefers live production build_telemetry and falls back to local_build_telemetry', () => {
    const liveTel = makeTelemetry({ total_duration_sec: 26.2 });
    const localTel = makeTelemetry({ total_duration_sec: 31.0 });

    const prodRel = {
      release_id: '1.0.0+abc',
      semver: '1.0.0',
      image_tag: '1.0.0-abc',
      commit_sha: 'abc',
      commit_short: 'abc',
      commit_subject: 'test',
      branch: 'main',
      dirty: false,
      deployed_at: '2026-11-10T00:00:00Z',
      build_telemetry: liveTel,
    } as ReleaseInfo;

    const comp = {
      local_build_telemetry: localTel,
    } as unknown as AppCompositionReport;

    const r1 = resolveActiveBuildTelemetry(prodRel, comp);
    expect(r1.source).toBe('LIVE_PROD');
    expect(r1.telemetry?.total_duration_sec).toBe(26.2);

    const r2 = resolveActiveBuildTelemetry(null, comp);
    expect(r2.source).toBe('LOCAL_MANIFEST');
    expect(r2.telemetry?.total_duration_sec).toBe(31.0);

    const r3 = resolveActiveBuildTelemetry(null, null);
    expect(r3.source).toBe('NONE');
    expect(r3.telemetry).toBeNull();
  });

  it('evaluates OPTIMAL badge when warm build is within budget and <10% over baseline', () => {
    const tel = makeTelemetry({ total_duration_sec: 28.4 });
    const badge = evaluateBuildHealthBadge(tel, 'biomed-maven');

    expect(badge.status).toBe('OPTIMAL');
    expect(badge.tone).toBe('emerald');
    expect(badge.shortLabel).toBe('28.4s • WARM');
    expect(badge.warnings).toHaveLength(0);
  });

  it('evaluates WARN_REGRESSION when duration increases by >10% over same-posture baseline', () => {
    const tel = makeTelemetry({
      status: 'OPTIMAL',
      total_duration_sec: 33.0,
      baseline_duration_sec: 26.0,
      delta_sec: 7.0,
      regression_pct: 26.9,
    });
    const badge = evaluateBuildHealthBadge(tel, 'biomed-maven');

    expect(badge.status).toBe('WARN_REGRESSION');
    expect(badge.tone).toBe('amber');
    expect(badge.shortLabel).toContain('+26.9%');
    expect(badge.warnings.length).toBeGreaterThan(0);
  });

  it('evaluates WARN_BUDGET when build exceeds target budget or context size limit', () => {
    const tel = makeTelemetry({
      status: 'OPTIMAL',
      total_duration_sec: 42.0,
      baseline_duration_sec: null,
      delta_sec: null,
      regression_pct: null,
    });
    const badge = evaluateBuildHealthBadge(tel, 'tasty-basket');

    expect(badge.status).toBe('WARN_BUDGET');
    expect(badge.tone).toBe('amber');
    expect(badge.shortLabel).toContain('BUDGET');
  });

  it('evaluates WARN_CEILING when build breaches hard ceiling', () => {
    const tel = makeTelemetry({
      total_duration_sec: 135.0,
    });
    const badge = evaluateBuildHealthBadge(tel, 'water-analyzer');

    expect(badge.status).toBe('WARN_CEILING');
    expect(badge.tone).toBe('rose');
    expect(badge.shortLabel).toContain('CEILING');
  });

  it('returns AWAITING_TELEMETRY fallback with armed targets when telemetry is null', () => {
    const badge = evaluateBuildHealthBadge(null, 'spendyledger');

    expect(badge.status).toBe('AWAITING_TELEMETRY');
    expect(badge.tone).toBe('slate');
    expect(badge.targetSec).toBe(45);
    expect(badge.shortLabel).toBe('Target ≤45s');
  });
});
