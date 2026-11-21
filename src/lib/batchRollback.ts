import {
  BatchPreDeploySnapshot,
  BatchSmokeAttributionResult,
  DiscoveredApp,
  SmokeCheckResult,
} from './types';

function matchAppForSmokeCheck(
  check: SmokeCheckResult,
  allApps: DiscoveredApp[]
): DiscoveredApp | null {
  const lowerName = (check.name || '').trim().toLowerCase();
  for (const app of allApps) {
    const displayPrefix = `${app.manifest.displayName.trim().toLowerCase()}:`;
    if (lowerName.startsWith(displayPrefix)) {
      return app;
    }
    const slugPrefix = `${app.manifest.slug.trim().toLowerCase()}:`;
    if (lowerName.startsWith(slugPrefix)) {
      return app;
    }
  }
  return null;
}

function isExternalOrSuiteCheck(check: SmokeCheckResult): boolean {
  const lowerName = (check.name || '').trim().toLowerCase();
  const lowerCat = (check.category || '').trim().toLowerCase();
  return (
    lowerName.startsWith('parakith') ||
    lowerName.startsWith('suite ') ||
    lowerName.startsWith('suite:') ||
    lowerCat === 'parakith edge' ||
    lowerCat === 'suite packages' ||
    lowerCat === 'host crons'
  );
}

/**
 * Deterministically attributes consolidated suite smoke failures back to deployed batch apps
 * using check prefixes (`<DisplayName>:` vs `Parakith ...` / `Suite ...`) and determines whether
 * targeted non-DB-migrated rollback is safe or operator confirmation is required.
 */
export function attributeBatchSmokeFailures(
  failedChecks: SmokeCheckResult[],
  allApps: DiscoveredApp[],
  deployedApps: DiscoveredApp[],
  preBatchSnapshots: Record<string, BatchPreDeploySnapshot>,
  autoRollbackEnabled: boolean
): BatchSmokeAttributionResult {
  const deployedSlugs = new Set(deployedApps.map((a) => a.manifest.slug.toLowerCase()));
  const implicatedSlugSet = new Set<string>();
  const nonBatchFailedChecks: SmokeCheckResult[] = [];
  const externalFailedChecks: SmokeCheckResult[] = [];
  const unattributableFailedChecks: SmokeCheckResult[] = [];

  for (const check of failedChecks) {
    const matchedApp = matchAppForSmokeCheck(check, allApps);
    if (matchedApp) {
      const slug = matchedApp.manifest.slug.toLowerCase();
      if (deployedSlugs.has(slug)) {
        implicatedSlugSet.add(slug);
      } else if (matchedApp.manifest.hostingTarget === 'cloudflare-pages') {
        externalFailedChecks.push(check);
      } else {
        nonBatchFailedChecks.push(check);
      }
      continue;
    }

    if (isExternalOrSuiteCheck(check)) {
      externalFailedChecks.push(check);
      continue;
    }

    unattributableFailedChecks.push(check);
  }

  const implicatedSnapshots = Array.from(implicatedSlugSet)
    .map((slug) => preBatchSnapshots[slug])
    .filter((snap): snap is BatchPreDeploySnapshot => Boolean(snap));

  // Prioritize PanoramaAuth IdP rollback first if implicated; remaining implicated apps in reverse deploy order.
  const rollbackPlan = [...implicatedSnapshots].sort((a, b) => {
    if (a.slug === 'auth' && b.slug !== 'auth') return -1;
    if (b.slug === 'auth' && a.slug !== 'auth') return 1;
    return b.deployOrderIndex - a.deployOrderIndex;
  });

  const implicatedBatchSlugs = rollbackPlan.map((s) => s.slug);
  const blockedByDbMigrationSlugs = rollbackPlan
    .filter((s) => s.hasDbMigration)
    .map((s) => s.slug);
  const missingTagSlugs = rollbackPlan
    .filter((s) => !s.preBatchTag || s.preBatchTag.trim().length === 0)
    .map((s) => s.slug);
  const idpFirstRollbackNeeded =
    implicatedSlugSet.has('auth') && implicatedBatchSlugs.length > 1;

  // Case C: strictly external or non-batch failure -> never roll back healthy batch containers
  if (
    implicatedBatchSlugs.length === 0 &&
    unattributableFailedChecks.length === 0 &&
    (externalFailedChecks.length > 0 || nonBatchFailedChecks.length > 0)
  ) {
    const extNames = [...externalFailedChecks, ...nonBatchFailedChecks]
      .map((c) => c.name)
      .join(', ');
    return {
      action: 'EXTERNAL_OR_NON_BATCH_FAILURE',
      implicatedBatchSlugs: [],
      rollbackPlan: [],
      idpFirstRollbackNeeded: false,
      blockedByDbMigrationSlugs: [],
      missingTagSlugs: [],
      nonBatchFailedChecks,
      externalFailedChecks,
      unattributableFailedChecks: [],
      summaryReason: `All deployed batch applications passed their checks. Failure isolated to external/non-batch target(s): ${extNames}. Zero batch rollbacks performed.`,
    };
  }

  // Case A: clean app-scoped batch failure(s), valid prior tags, zero DB_MIGRATION risk, auto-rollback enabled
  if (
    autoRollbackEnabled &&
    implicatedBatchSlugs.length > 0 &&
    blockedByDbMigrationSlugs.length === 0 &&
    missingTagSlugs.length === 0 &&
    unattributableFailedChecks.length === 0
  ) {
    const labelList = rollbackPlan.map((s) => `${s.displayName} (${s.preBatchTag})`).join(', ');
    return {
      action: 'TARGETED_AUTO_ROLLBACK',
      implicatedBatchSlugs,
      rollbackPlan,
      idpFirstRollbackNeeded,
      blockedByDbMigrationSlugs: [],
      missingTagSlugs: [],
      nonBatchFailedChecks,
      externalFailedChecks,
      unattributableFailedChecks: [],
      summaryReason: idpFirstRollbackNeeded
        ? `IdP-first targeted rollback: reverting ${labelList} while leaving healthy batch siblings untouched.`
        : `Targeted auto-rollback of implicated app(s): ${labelList}. Healthy batch siblings remain live.`,
    };
  }

  // Case B: DB_MIGRATION guard, missing pre-batch tag, ambiguous unattributable checks, or auto-rollback disabled
  const reasons: string[] = [];
  if (blockedByDbMigrationSlugs.length > 0) {
    reasons.push(
      `DB_MIGRATION detected on implicated app(s): ${blockedByDbMigrationSlugs.join(', ')} (automatic image downgrade blocked to protect SQLite schema)`
    );
  }
  if (missingTagSlugs.length > 0) {
    reasons.push(`missing pre-batch image tag for: ${missingTagSlugs.join(', ')}`);
  }
  if (unattributableFailedChecks.length > 0) {
    reasons.push(
      `unattributable check(s): ${unattributableFailedChecks.map((c) => c.name).join(', ')}`
    );
  }
  if (!autoRollbackEnabled && implicatedBatchSlugs.length > 0) {
    reasons.push('automatic rollback toggle was disabled for this batch');
  }
  if (reasons.length === 0) {
    reasons.push('manual smoke failure inspection required');
  }

  return {
    action: 'MANUAL_RECOVERY_REQUIRED',
    implicatedBatchSlugs,
    rollbackPlan,
    idpFirstRollbackNeeded,
    blockedByDbMigrationSlugs,
    missingTagSlugs,
    nonBatchFailedChecks,
    externalFailedChecks,
    unattributableFailedChecks,
    summaryReason: `Targeted auto-rollback paused: ${reasons.join('; ')}.`,
  };
}
