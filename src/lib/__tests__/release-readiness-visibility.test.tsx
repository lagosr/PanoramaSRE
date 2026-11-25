import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DiscoveredApp } from '../types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

import { ReleasePipelineView } from '../../components/releases/ReleasePipelineView';
import { FleetAppCard } from '../../components/hud/FleetAppCard';
import { FleetAppTable } from '../../components/hud/FleetAppTable';

function makeInSyncWshApp(): DiscoveredApp {
  return {
    manifest: {
      schemaVersion: 1,
      appId: 'auth',
      slug: 'auth',
      hostingTarget: 'wsh-docker',
      displayName: 'PanoramaAuth',
      portalTitle: 'PanoramaAuth',
      description: 'Identity provider',
      basePath: '/auth',
      port: 3000,
      containerName: 'panorama-auth',
      composeProject: 'panorama-auth',
      remoteAppRoot: '/opt/panorama-auth',
      dataVolume: '/var/data/panorama-auth',
      localSqlitePath: 'data/auth.sqlite',
      themeColor: 'purple',
      icon: 'Shield',
      portalOrder: 1,
      roles: ['admin'],
      sre: {
        deployScript: './deploy-docker.ps1',
        dbScript: './db-manager.ps1',
        devCommand: 'npm run dev',
        healthEndpoint: '/auth/api/health',
        testCommand: 'npm test',
        typecheckCommand: 'npx tsc --noEmit',
        requiresAuthInDev: false,
        automatedBackupDefault: true,
        exposeInRemotePortal: true,
      },
    },
    workspacePath: 'c:\\projects\\PanoramaAuth',
    provenanceState: 'IN_SYNC',
    health: { status: 'healthy', version: '1.0.11', deployed_at: '2026-11-24T10:00:00Z', database: 'ok' },
    composition: {
      app_id: 'auth',
      state: 'IN_SYNC',
      local_head_sha: '41e2c32abc',
      local_head_short: '41e2c32',
      local_branch: 'main',
      local_dirty: false,
      dirty_files: [],
      prod_sha: '41e2c32abc',
      prod_release_id: '1.0.11-41e2c32',
      prod_dirty: false,
      ahead_count: 0,
      behind_count: 0,
      undeployed_commits: [],
      changed_files_since_prod: [],
      blast_radius_badges: [],
      new_env_keys: [],
      recent_candidates: [],
    },
  };
}

function makeBehindEdgeApp(): DiscoveredApp {
  return {
    manifest: {
      schemaVersion: 1,
      appId: 'parakith',
      slug: 'parakith',
      hostingTarget: 'cloudflare-pages',
      displayName: 'ParakithSite',
      portalTitle: 'ParakithSite',
      description: 'Public Cloudflare Pages showcase',
      basePath: '',
      port: 3500,
      containerName: '',
      composeProject: '',
      remoteAppRoot: '',
      dataVolume: '',
      localSqlitePath: '',
      themeColor: 'slate',
      icon: 'Globe',
      portalOrder: 7,
      roles: ['admin'],
      cloudflare: {
        pagesProject: 'parakith-site',
        primaryUrl: 'https://www.parakith.com',
        domains: ['parakith.com'],
      },
      sre: {
        deployScript: 'deploy-cloudflare-pages.ps1',
        dbScript: '',
        devCommand: 'npm run dev',
        healthEndpoint: '/api/health',
        testCommand: 'npm test',
        typecheckCommand: 'npx tsc --noEmit',
        requiresAuthInDev: false,
        automatedBackupDefault: false,
        exposeInRemotePortal: false,
      },
    },
    workspacePath: 'c:\\projects\\ParakithSite',
    provenanceState: 'AHEAD',
    health: { status: 'healthy', version: '0.1.1', deployed_at: '2026-11-24T09:00:00Z', database: 'd1' },
    composition: {
      app_id: 'parakith',
      state: 'AHEAD',
      local_head_sha: '2e87701abc',
      local_head_short: '2e87701',
      local_branch: 'main',
      local_dirty: false,
      dirty_files: [],
      prod_sha: '1111111abc',
      prod_release_id: 'v0.1.1-1111111',
      prod_dirty: false,
      ahead_count: 1,
      behind_count: 0,
      undeployed_commits: [
        { sha: '2e87701', subject: 'fix: hero copy', author: 'Rodrigo', committed_at: '2026-11-24T12:00:00Z' },
      ],
      changed_files_since_prod: [{ status: 'M', path: 'src/app/page.tsx' }],
      blast_radius_badges: [],
      new_env_keys: [],
      recent_candidates: [],
    },
  };
}

describe('Release-ready & behind-target high-visibility indicators', () => {
  it('floats behind targets to the top of Fleet Targets rail, renders Releases Ready spotlight banner, and auto-selects first behind app', () => {
    const html = renderToStaticMarkup(
      <ReleasePipelineView
        apps={[makeInSyncWshApp(), makeBehindEdgeApp()]}
        onTriggerDeploy={vi.fn()}
        onTriggerDeployAll={vi.fn()}
        onTriggerRollback={vi.fn()}
      />
    );

    expect(html).toContain('data-testid="releases-behind-banner"');
    expect(html).toContain('1 Site Behind Production — Ready for Release');
    expect(html).toContain('READY +1');
    expect(html).toContain('RELEASE READY · +1');

    // In the Fleet Targets aside rail, ParakithSite must appear before PanoramaAuth
    const railStart = html.indexOf('aria-label="Fleet Targets Master Rail"');
    const railSection = html.slice(railStart);
    const parakithIdx = railSection.indexOf('ParakithSite');
    const authIdx = railSection.indexOf('PanoramaAuth');
    expect(parakithIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeGreaterThan(-1);
    expect(parakithIdx).toBeLessThan(authIdx);
  });

  it('highlights behind FleetAppCard with amber ring and RELEASE READY top banner', () => {
    const html = renderToStaticMarkup(
      <FleetAppCard
        app={makeBehindEdgeApp()}
        onOpenApp={vi.fn()}
        onInspectComposition={vi.fn()}
        onNavigateToRelease={vi.fn()}
      />
    );

    expect(html).toContain('data-testid="fleet-card-release-ready-parakith"');
    expect(html).toContain('RELEASE READY: 1 COMMIT AHEAD');
    expect(html).toContain('border-amber-500/75');
    expect(html).toContain('Deploy →');
  });

  it('highlights behind rows in FleetAppTable with amber left border', () => {
    const html = renderToStaticMarkup(
      <FleetAppTable
        apps={[makeInSyncWshApp(), makeBehindEdgeApp()]}
        onOpenApp={vi.fn()}
        onInspectComposition={vi.fn()}
        onNavigateToRelease={vi.fn()}
      />
    );

    expect(html).toContain('border-l-amber-500');
  });

  it('stacks releases-behind-banner vertically so 6+ behind target pills never crush banner heading text', () => {
    const sixBehind = [
      { ...makeInSyncWshApp(), provenanceState: 'AHEAD' as const, manifest: { ...makeInSyncWshApp().manifest, slug: 'auth', appId: 'auth', displayName: 'PanoramaAuth' } },
      { ...makeInSyncWshApp(), provenanceState: 'AHEAD' as const, manifest: { ...makeInSyncWshApp().manifest, slug: 'spendy', appId: 'spendy', displayName: 'SpendyLedger' } },
      { ...makeInSyncWshApp(), provenanceState: 'AHEAD' as const, manifest: { ...makeInSyncWshApp().manifest, slug: 'biomed', appId: 'biomed', displayName: 'BiomedMaven' } },
      { ...makeInSyncWshApp(), provenanceState: 'AHEAD' as const, manifest: { ...makeInSyncWshApp().manifest, slug: 'water', appId: 'water', displayName: 'WaterAnalyzer' } },
      { ...makeInSyncWshApp(), provenanceState: 'AHEAD' as const, manifest: { ...makeInSyncWshApp().manifest, slug: 'basket', appId: 'basket', displayName: 'TastyBasket' } },
      { ...makeInSyncWshApp(), provenanceState: 'AHEAD' as const, manifest: { ...makeInSyncWshApp().manifest, slug: 'energy', appId: 'energy', displayName: 'EnergyAnalyzer' } },
    ].map((app) => ({
      ...app,
      composition: {
        ...app.composition!,
        app_id: app.manifest.appId,
        state: 'AHEAD' as const,
        ahead_count: 1,
      },
    }));

    const html = renderToStaticMarkup(
      <ReleasePipelineView
        apps={sixBehind}
        onTriggerDeploy={vi.fn()}
        onTriggerDeployAll={vi.fn()}
        onTriggerRollback={vi.fn()}
      />
    );

    const bannerStart = html.indexOf('data-testid="releases-behind-banner"');
    const masterDetailStart = html.indexOf('<div class="flex flex-col lg:flex-row items-start gap-5');
    expect(bannerStart).toBeGreaterThan(-1);
    expect(masterDetailStart).toBeGreaterThan(bannerStart);

    const bannerHtml = html.slice(bannerStart, masterDetailStart);
    expect(bannerHtml).toContain('6 Sites Behind Production — Ready for Release');
    expect(bannerHtml).toContain('flex-col gap-3');
    expect(bannerHtml).not.toContain('lg:flex-row');
    expect(bannerHtml).toContain('flex-wrap items-center gap-2 w-full min-w-0');
    expect(bannerHtml).not.toContain('flex-wrap items-center gap-2 shrink-0');
  });
});
