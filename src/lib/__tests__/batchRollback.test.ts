import { describe, it, expect } from 'vitest';
import { attributeBatchSmokeFailures } from '../batchRollback';
import { BatchPreDeploySnapshot, DiscoveredApp, SmokeCheckResult } from '../types';

function makeApp(
  slug: string,
  displayName: string,
  hostingTarget: 'wsh-docker' | 'cloudflare-pages' = 'wsh-docker'
): DiscoveredApp {
  return {
    manifest: {
      schemaVersion: 1,
      appId: slug,
      slug,
      displayName,
      portalTitle: displayName,
      description: displayName,
      basePath: hostingTarget === 'cloudflare-pages' ? '/' : `/${slug}`,
      port: 3000,
      hostingTarget,
      containerName: slug,
      composeProject: slug,
      remoteAppRoot: `/opt/${slug}`,
      dataVolume: `/var/data/${slug}/data`,
      localSqlitePath: 'data/app.sqlite',
      themeColor: 'blue',
      icon: 'Box',
      hasDatabase: true,
      portalOrder: 1,
      roles: ['admin'],
      sre: {
        deployScript: 'deploy-docker.ps1',
        dbScript: 'scripts/db-manager.ps1',
        devCommand: 'npm run dev',
        healthEndpoint: `/${slug}/api/health`,
        testCommand: 'npm test',
        typecheckCommand: 'npx tsc --noEmit',
        requiresAuthInDev: true,
        automatedBackupDefault: true,
        exposeInRemotePortal: true,
      },
    },
    workspacePath: `C:\\Projects\\${displayName}`,
    provenanceState: 'IN_SYNC',
  };
}

function failCheck(name: string, category = 'app-health'): SmokeCheckResult {
  return {
    name,
    category,
    passed: false,
    durationMs: 120,
    detail: 'HTTP 500',
  };
}

describe('attributeBatchSmokeFailures', () => {
  const authApp = makeApp('auth', 'PanoramaAuth');
  const spendyApp = makeApp('spendy', 'SpendyLedger');
  const basketApp = makeApp('basket', 'TastyBasket');
  const waterApp = makeApp('water', 'WaterAnalyzer');
  const parakithApp = makeApp('parakith', 'ParakithSite', 'cloudflare-pages');
  const allApps = [authApp, spendyApp, basketApp, waterApp, parakithApp];

  const snapshots: Record<string, BatchPreDeploySnapshot> = {
    auth: { slug: 'auth', displayName: 'PanoramaAuth', preBatchTag: '1.0.0-aaa', hasDbMigration: false, deployOrderIndex: 0 },
    spendy: { slug: 'spendy', displayName: 'SpendyLedger', preBatchTag: '1.1.0-bbb', hasDbMigration: false, deployOrderIndex: 1 },
    basket: { slug: 'basket', displayName: 'TastyBasket', preBatchTag: '1.2.0-ccc', hasDbMigration: false, deployOrderIndex: 2 },
  };
  const deployed = [authApp, spendyApp, basketApp];

  it('targets ONLY the implicated batch app for auto-rollback while leaving healthy siblings untouched', () => {
    const res = attributeBatchSmokeFailures(
      [failCheck('TastyBasket: Protected Route Zero-Trust')],
      allApps,
      deployed,
      snapshots,
      true
    );

    expect(res.action).toBe('TARGETED_AUTO_ROLLBACK');
    expect(res.implicatedBatchSlugs).toEqual(['basket']);
    expect(res.rollbackPlan.map((r) => r.preBatchTag)).toEqual(['1.2.0-ccc']);
    expect(res.idpFirstRollbackNeeded).toBe(false);
  });

  it('prioritizes PanoramaAuth first when IdP and child apps fail together', () => {
    const res = attributeBatchSmokeFailures(
      [
        failCheck('TastyBasket: Health Endpoint'),
        failCheck('PanoramaAuth: JWKS & OpenID Integrity'),
      ],
      allApps,
      deployed,
      snapshots,
      true
    );

    expect(res.action).toBe('TARGETED_AUTO_ROLLBACK');
    expect(res.idpFirstRollbackNeeded).toBe(true);
    expect(res.implicatedBatchSlugs).toEqual(['auth', 'basket']);
  });

  it('blocks automatic rollback and escalates to manual panel when DB_MIGRATION badge is present', () => {
    const migratedSnapshots: Record<string, BatchPreDeploySnapshot> = {
      ...snapshots,
      basket: { ...snapshots.basket, hasDbMigration: true },
    };

    const res = attributeBatchSmokeFailures(
      [failCheck('TastyBasket: Health Endpoint')],
      allApps,
      deployed,
      migratedSnapshots,
      true
    );

    expect(res.action).toBe('MANUAL_RECOVERY_REQUIRED');
    expect(res.blockedByDbMigrationSlugs).toEqual(['basket']);
    expect(res.rollbackPlan.map((r) => r.slug)).toEqual(['basket']);
  });

  it('performs zero batch rollbacks when failure is external (Parakith Edge or Suite Packages) or outside batch', () => {
    const resExternal = attributeBatchSmokeFailures(
      [
        failCheck('Parakith Edge: Stealth /api/health', 'Parakith Edge'),
        failCheck('Suite Host Crons: /etc/cron.d', 'Host Crons'),
        failCheck('WaterAnalyzer: Health Endpoint'),
      ],
      allApps,
      deployed,
      snapshots,
      true
    );

    expect(resExternal.action).toBe('EXTERNAL_OR_NON_BATCH_FAILURE');
    expect(resExternal.implicatedBatchSlugs).toEqual([]);
    expect(resExternal.externalFailedChecks).toHaveLength(2);
    expect(resExternal.nonBatchFailedChecks).toHaveLength(1);
  });

  it('requires manual recovery when an unattributable cross-suite check fails or toggle is OFF', () => {
    const ambiguous = attributeBatchSmokeFailures(
      [failCheck('Unknown Custom Check Without Prefix', 'custom')],
      allApps,
      deployed,
      snapshots,
      true
    );
    expect(ambiguous.action).toBe('MANUAL_RECOVERY_REQUIRED');
    expect(ambiguous.unattributableFailedChecks).toHaveLength(1);

    const toggleOff = attributeBatchSmokeFailures(
      [failCheck('SpendyLedger: Health Endpoint')],
      allApps,
      deployed,
      snapshots,
      false
    );
    expect(toggleOff.action).toBe('MANUAL_RECOVERY_REQUIRED');
    expect(toggleOff.implicatedBatchSlugs).toEqual(['spendy']);
  });
});
