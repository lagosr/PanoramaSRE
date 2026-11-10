import { AppCompositionReport, BuildTelemetry, BuildTelemetryStatus, ReleaseInfo } from './types';

export interface AppTelemetryTargets {
  targetWarmSec: number;
  targetColdSec: number;
  maxCeilingSec: number;
  regressionThresholdPct: number;
  maxContextKB: number;
  activeTargetSec: number;
}

export interface BuildHealthBadgeInfo {
  status: BuildTelemetryStatus | 'AWAITING_TELEMETRY';
  label: string;
  shortLabel: string;
  tone: 'emerald' | 'amber' | 'rose' | 'slate';
  durationSec: number | null;
  targetSec: number;
  cachePosture: 'warm' | 'cold';
  regressionPct: number | null;
  warnings: string[];
}

export interface ResolvedBuildTelemetry {
  telemetry: BuildTelemetry | null;
  source: 'LIVE_PROD' | 'LOCAL_MANIFEST' | 'NONE';
}

export function getAppTelemetryTargets(
  appIdOrSlug: string,
  posture: 'warm' | 'cold' = 'warm'
): AppTelemetryTargets {
  const key = (appIdOrSlug || '').toLowerCase().trim();

  if (key === 'res' || key === 'panorama-resources') {
    const targetWarmSec = 15;
    const targetColdSec = 30;
    return {
      targetWarmSec,
      targetColdSec,
      maxCeilingSec: 60,
      regressionThresholdPct: 10,
      maxContextKB: 1024,
      activeTargetSec: posture === 'cold' ? targetColdSec : targetWarmSec,
    };
  }

  if (key === 'spendy' || key === 'spendyledger' || key === 'spendy-ledger') {
    const targetWarmSec = 45;
    const targetColdSec = 90;
    return {
      targetWarmSec,
      targetColdSec,
      maxCeilingSec: 120,
      regressionThresholdPct: 10,
      maxContextKB: 6500,
      activeTargetSec: posture === 'cold' ? targetColdSec : targetWarmSec,
    };
  }

  if (key === 'auth' || key === 'panorama-auth' || key === 'panoramaauth') {
    const targetWarmSec = 45;
    const targetColdSec = 90;
    return {
      targetWarmSec,
      targetColdSec,
      maxCeilingSec: 120,
      regressionThresholdPct: 10,
      maxContextKB: 2048,
      activeTargetSec: posture === 'cold' ? targetColdSec : targetWarmSec,
    };
  }

  // Default Next.js applications: biomed-maven, tasty-basket, water-analyzer
  const targetWarmSec = 35;
  const targetColdSec = 75;
  return {
    targetWarmSec,
    targetColdSec,
    maxCeilingSec: 120,
    regressionThresholdPct: 10,
    maxContextKB: 2048,
    activeTargetSec: posture === 'cold' ? targetColdSec : targetWarmSec,
  };
}

export function resolveActiveBuildTelemetry(
  prodRelease?: ReleaseInfo | null,
  composition?: AppCompositionReport | null
): ResolvedBuildTelemetry {
  if (prodRelease?.build_telemetry && typeof prodRelease.build_telemetry.total_duration_sec === 'number') {
    return {
      telemetry: prodRelease.build_telemetry,
      source: 'LIVE_PROD',
    };
  }

  if (
    composition?.local_build_telemetry &&
    typeof composition.local_build_telemetry.total_duration_sec === 'number'
  ) {
    return {
      telemetry: composition.local_build_telemetry,
      source: 'LOCAL_MANIFEST',
    };
  }

  return {
    telemetry: null,
    source: 'NONE',
  };
}

export function evaluateBuildHealthBadge(
  telemetry: BuildTelemetry | null | undefined,
  appIdOrSlug: string
): BuildHealthBadgeInfo {
  const posture = telemetry?.cache_posture === 'cold' ? 'cold' : 'warm';
  const targets = getAppTelemetryTargets(appIdOrSlug, posture);

  if (!telemetry || typeof telemetry.total_duration_sec !== 'number') {
    return {
      status: 'AWAITING_TELEMETRY',
      label: `TARGETS ARMED (≤${targets.targetWarmSec}s warm)`,
      shortLabel: `Target ≤${targets.targetWarmSec}s`,
      tone: 'slate',
      durationSec: null,
      targetSec: targets.targetWarmSec,
      cachePosture: 'warm',
      regressionPct: null,
      warnings: [],
    };
  }

  const durationSec = Math.round(telemetry.total_duration_sec * 10) / 10;
  const deltaSec =
    typeof telemetry.delta_sec === 'number'
      ? telemetry.delta_sec
      : typeof telemetry.baseline_duration_sec === 'number' && telemetry.baseline_duration_sec > 0
      ? Math.round((durationSec - telemetry.baseline_duration_sec) * 10) / 10
      : null;

  const regressionPct =
    typeof telemetry.regression_pct === 'number'
      ? telemetry.regression_pct
      : typeof telemetry.baseline_duration_sec === 'number' &&
        telemetry.baseline_duration_sec > 0 &&
        deltaSec !== null
      ? Math.round((deltaSec / telemetry.baseline_duration_sec) * 1000) / 10
      : null;

  const warnings: string[] = Array.isArray(telemetry.warnings) ? [...telemetry.warnings] : [];
  let computedStatus: BuildTelemetryStatus = telemetry.status || 'OPTIMAL';

  const allowanceSec =
    Math.round(targets.activeTargetSec * (1 + targets.regressionThresholdPct / 100) * 10) / 10;

  if (telemetry.context_transfer_kb > targets.maxContextKB) {
    const msg = `Context transfer (${telemetry.context_transfer_kb} KB) exceeds budget (${targets.maxContextKB} KB).`;
    if (!warnings.some((w) => w.includes('context') || w.includes('Context'))) {
      warnings.push(msg);
    }
    if (computedStatus === 'OPTIMAL') computedStatus = 'WARN_BUDGET';
  }

  if (durationSec > allowanceSec) {
    const msg = `Build duration (${durationSec}s) exceeded ${posture} budget (${targets.activeTargetSec}s + ${targets.regressionThresholdPct}% = ${allowanceSec}s).`;
    if (!warnings.some((w) => w.includes('budget'))) {
      warnings.push(msg);
    }
    if (computedStatus === 'OPTIMAL') computedStatus = 'WARN_BUDGET';
  }

  if (
    regressionPct !== null &&
    regressionPct > targets.regressionThresholdPct &&
    (deltaSec === null || deltaSec >= 4.0)
  ) {
    const msg = `Build regressed by +${regressionPct}% over previous ${posture} baseline.`;
    if (!warnings.some((w) => w.includes('regressed'))) {
      warnings.push(msg);
    }
    if (computedStatus !== 'WARN_CEILING') {
      computedStatus = 'WARN_REGRESSION';
    }
  }

  if (durationSec > targets.maxCeilingSec || telemetry.status === 'WARN_CEILING') {
    const msg = `Build duration (${durationSec}s) breached hard ceiling (${targets.maxCeilingSec}s).`;
    if (!warnings.some((w) => w.includes('ceiling'))) {
      warnings.push(msg);
    }
    computedStatus = 'WARN_CEILING';
  }

  const postureUpper = posture.toUpperCase();

  if (computedStatus === 'WARN_CEILING') {
    return {
      status: 'WARN_CEILING',
      label: `CEILING BREACH (${durationSec}s > ${targets.maxCeilingSec}s)`,
      shortLabel: `${durationSec}s • CEILING ⚠️`,
      tone: 'rose',
      durationSec,
      targetSec: targets.activeTargetSec,
      cachePosture: posture,
      regressionPct,
      warnings,
    };
  }

  if (computedStatus === 'WARN_REGRESSION') {
    const regSuffix = regressionPct !== null && regressionPct > 0 ? `+${regressionPct}%` : 'CACHE MISS';
    return {
      status: 'WARN_REGRESSION',
      label: `REGRESSION (${regSuffix})`,
      shortLabel: `${durationSec}s • ${regSuffix} ⚠️`,
      tone: 'amber',
      durationSec,
      targetSec: targets.activeTargetSec,
      cachePosture: posture,
      regressionPct,
      warnings,
    };
  }

  if (computedStatus === 'WARN_BUDGET') {
    return {
      status: 'WARN_BUDGET',
      label: `BUDGET WARN (${durationSec}s / ≤${targets.activeTargetSec}s)`,
      shortLabel: `${durationSec}s • BUDGET ⚠️`,
      tone: 'amber',
      durationSec,
      targetSec: targets.activeTargetSec,
      cachePosture: posture,
      regressionPct,
      warnings,
    };
  }

  return {
    status: 'OPTIMAL',
    label: `OPTIMAL (${durationSec}s • ${postureUpper})`,
    shortLabel: `${durationSec}s • ${postureUpper}`,
    tone: 'emerald',
    durationSec,
    targetSec: targets.activeTargetSec,
    cachePosture: posture,
    regressionPct,
    warnings,
  };
}
