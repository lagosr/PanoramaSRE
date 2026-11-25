import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DiscoveredApp } from '../types';
import {
  BatchDeployModal,
  buildInitialOrderedBatchApps,
  reorderBatchApps,
} from '../../components/releases/BatchDeployModal';

function makeDockerApp(slug: string, displayName: string, port: number): DiscoveredApp {
  return {
    manifest: {
      schemaVersion: 1,
      appId: slug,
      slug,
      hostingTarget: 'wsh-docker',
      displayName,
      portalTitle: displayName,
      description: `${displayName} service`,
      basePath: `/${slug}`,
      port,
      containerName: `${slug}-app`,
      composeProject: `${slug}-app`,
      remoteAppRoot: `/opt/${slug}`,
      dataVolume: `/var/data/${slug}`,
      localSqlitePath: `data/${slug}.sqlite`,
      themeColor: 'indigo',
      icon: 'Server',
      portalOrder: port - 2999,
      roles: ['admin'],
      sre: {
        deployScript: './deploy-docker.ps1',
        dbScript: './db-manager.ps1',
        devCommand: 'npm run dev',
        healthEndpoint: `/${slug}/api/health`,
        testCommand: 'npm test',
        typecheckCommand: 'npx tsc --noEmit',
        requiresAuthInDev: slug !== 'auth',
        automatedBackupDefault: true,
        exposeInRemotePortal: true,
      },
    },
    workspacePath: `c:\\projects\\${displayName}`,
    provenanceState: 'AHEAD',
    health: { status: 'healthy', version: '1.0.0', deployed_at: '2026-11-24T10:00:00Z', database: 'ok' },
    composition: {
      app_id: slug,
      state: 'AHEAD',
      local_head_sha: 'def567890',
      local_head_short: 'def5678',
      local_branch: 'main',
      local_dirty: false,
      dirty_files: [],
      prod_sha: 'abc123456',
      prod_release_id: '1.0.0-abc1234',
      prod_dirty: false,
      ahead_count: 1,
      behind_count: 0,
      undeployed_commits: [],
      changed_files_since_prod: [],
      blast_radius_badges: [],
      new_env_keys: [],
      recent_candidates: [],
    },
  };
}

describe('Custom Batch Deployment Ordering', () => {
  const sampleApps = [
    makeDockerApp('spendy', 'SpendyLedger', 3001),
    makeDockerApp('auth', 'PanoramaAuth', 3000),
    makeDockerApp('basket', 'TastyBasket', 3004),
    makeDockerApp('energy', 'EnergyAnalyzer', 3005),
  ];

  it('defaults to PanoramaAuth first when no initialSelectedSlugs order is provided', () => {
    const ordered = buildInitialOrderedBatchApps(sampleApps);
    expect(ordered.map((a) => a.manifest.slug)).toEqual(['auth', 'spendy', 'basket', 'energy']);
  });

  it('preserves user-selected custom order from the Fleet Targets rail ahead of remaining apps', () => {
    const ordered = buildInitialOrderedBatchApps(sampleApps, ['basket', 'spendy', 'auth']);
    expect(ordered.map((a) => a.manifest.slug)).toEqual(['basket', 'spendy', 'auth', 'energy']);
  });

  it('reorders items cleanly for drag-and-drop and up/down controls', () => {
    const defaultOrdered = buildInitialOrderedBatchApps(sampleApps);
    const movedUp = reorderBatchApps(defaultOrdered, 2, 0);
    expect(movedUp.map((a) => a.manifest.slug)).toEqual(['basket', 'auth', 'spendy', 'energy']);

    // Out-of-bounds moves are safe no-ops
    expect(reorderBatchApps(defaultOrdered, 0, -1).map((a) => a.manifest.slug)).toEqual([
      'auth',
      'spendy',
      'basket',
      'energy',
    ]);
  });

  it('renders custom execution order preview and Reset Order control inside BatchDeployModal', () => {
    const html = renderToStaticMarkup(
      <BatchDeployModal
        isOpen={true}
        apps={sampleApps}
        initialSelectedSlugs={['basket', 'spendy', 'auth']}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(html).toContain('data-testid="batch-execution-order-preview"');
    expect(html).toContain('1. TastyBasket');
    expect(html).toContain('2. SpendyLedger');
    expect(html).toContain('3. PanoramaAuth');
    expect(html).toContain('Reset Order');

    const basketIdx = html.indexOf('1. TastyBasket');
    const spendyIdx = html.indexOf('2. SpendyLedger');
    const authIdx = html.indexOf('3. PanoramaAuth');
    expect(basketIdx).toBeGreaterThan(-1);
    expect(spendyIdx).toBeGreaterThan(basketIdx);
    expect(authIdx).toBeGreaterThan(spendyIdx);
  });
});
