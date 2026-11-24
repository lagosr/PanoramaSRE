import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BatchSmokeFailureReport, DiscoveredApp } from '../types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

import { ReleasePipelineView } from '../../components/releases/ReleasePipelineView';

function makeWshApp(overrides: Partial<DiscoveredApp> = {}): DiscoveredApp {
  return {
    manifest: {
      schemaVersion: 1,
      appId: 'spendy',
      slug: 'spendy',
      hostingTarget: 'wsh-docker',
      displayName: 'SpendyLedger',
      portalTitle: 'SpendyLedger',
      description: 'Personal finance',
      basePath: '/spendy',
      port: 3001,
      containerName: 'spendy-ledger',
      composeProject: 'spendy-ledger',
      remoteAppRoot: '/opt/spendy-ledger',
      dataVolume: '/var/data/spendy-ledger',
      localSqlitePath: 'data/spendy.sqlite',
      themeColor: 'amber',
      icon: 'Wallet',
      portalOrder: 2,
      roles: ['admin'],
      sre: {
        deployScript: './deploy-docker.ps1',
        dbScript: './db-manager.ps1',
        devCommand: 'npm run dev',
        healthEndpoint: '/spendy/api/health',
        testCommand: 'npm test',
        typecheckCommand: 'npx tsc --noEmit',
        requiresAuthInDev: true,
        automatedBackupDefault: true,
        exposeInRemotePortal: true,
      },
    },
    workspacePath: 'c:\\projects\\SpendyLedger',
    provenanceState: 'AHEAD',
    health: {
      status: 'healthy',
      version: '1.2.3',
      deployed_at: '2026-11-24T10:00:00Z',
      database: 'ok',
      release: {
        release_id: 'rel-spendy-1',
        semver: '1.2.3',
        commit_sha: 'abc1234567890',
        commit_short: 'abc1234',
        commit_subject: 'release: v1.2.3',
        branch: 'main',
        dirty: false,
        deployed_at: '2026-11-24T10:00:00Z',
        image_tag: '1.2.3-abc1234',
        build_telemetry: {
          profile: 'nextjs-standalone',
          total_duration_sec: 38,
          host_typecheck_sec: 4,
          deps_stage_sec: 0,
          next_build_sec: 22,
          turbopack_compile_sec: 16,
          next_typecheck_sec: 0,
          page_data_sec: 2,
          arm64_natives_sec: 2,
          arm64_natives_cache_hit: true,
          export_tar_sec: 3,
          context_transfer_kb: 164,
          deps_cache_hit: true,
          cache_posture: 'warm',
          types_prevalidated: true,
          elf_verified_count: 2,
          status: 'OPTIMAL',
          warnings: [],
        },
      },
    },
    composition: {
      app_id: 'spendy',
      state: 'AHEAD',
      local_head_sha: 'def5678901234',
      local_head_short: 'def5678',
      local_branch: 'main',
      local_dirty: false,
      dirty_files: [],
      prod_sha: 'abc1234567890',
      prod_release_id: 'rel-spendy-1',
      prod_dirty: false,
      ahead_count: 2,
      behind_count: 0,
      undeployed_commits: [
        { sha: 'def5678', subject: 'feat: budget rollover', author: 'Rodrigo', committed_at: '2026-11-24T11:00:00Z' },
      ],
      changed_files_since_prod: [{ status: 'M', path: 'src/app/page.tsx' }],
      blast_radius_badges: [],
      new_env_keys: [],
      recent_candidates: [],
    },
    ...overrides,
  };
}

function makeEdgeApp(): DiscoveredApp {
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
      port: 3006,
      containerName: '',
      composeProject: '',
      remoteAppRoot: '',
      dataVolume: '',
      localSqlitePath: '',
      themeColor: 'slate',
      icon: 'Globe',
      portalOrder: 6,
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
    provenanceState: 'IN_SYNC',
    health: { status: 'healthy', version: '1.0.0', deployed_at: '2026-11-24T09:00:00Z', database: 'd1' },
  };
}

function makeServiceApp(): DiscoveredApp {
  return {
    manifest: {
      schemaVersion: 1,
      appId: 'unifi-siem',
      slug: 'unifi-siem',
      hostingTarget: 'wsh-docker-service',
      displayName: 'UniFi SIEM Collector',
      portalTitle: 'UniFi SIEM Collector',
      description: 'UDP Syslog collector',
      basePath: '',
      port: 5514,
      containerName: 'unifi-siem',
      composeProject: 'unifi-siem',
      remoteAppRoot: '/opt/unifi-siem',
      dataVolume: '/var/data/unifi-siem',
      localSqlitePath: '',
      themeColor: 'amber',
      icon: 'ShieldAlert',
      portalOrder: 95,
      roles: ['admin'],
      service: {
        protocol: 'udp',
        bindIp: '172.25.25.5',
        networkName: 'unifi-siem-net',
        networkSubnet: '100.64.251.0/24',
        optionalDeployment: true,
        requiresWshFirewall: true,
      },
      sre: {
        deployScript: 'deploy-unifi-siem.ps1',
        dbScript: '',
        devCommand: '',
        healthEndpoint: '',
        healthCheckMode: 'docker-container',
        testCommand: 'npx vitest run',
        typecheckCommand: 'npx tsc --noEmit',
        requiresAuthInDev: false,
        automatedBackupDefault: false,
        exposeInRemotePortal: false,
      },
    },
    workspacePath: 'c:\\projects\\PanoramaDrSuite\\tools\\unifi-siem',
    provenanceState: 'IN_SYNC',
    health: { status: 'healthy', version: '1.0.0', deployed_at: '2026-11-24T08:00:00Z', database: 'none' },
  };
}

describe('Phase 3 ReleasePipelineView Master-Detail Control Tower', () => {
  it('renders Master Fleet Rail, slim BuildEfficiencyStrip without duplicate telemetry block, and side-by-side Deploy/Rollback for WSH apps', () => {
    const html = renderToStaticMarkup(
      <ReleasePipelineView
        apps={[makeWshApp(), makeEdgeApp(), makeServiceApp()]}
        selectedAppSlug="spendy"
        onTriggerDeploy={vi.fn()}
        onTriggerDeployAll={vi.fn()}
        onTriggerRollback={vi.fn()}
        onOpenTelemetry={vi.fn()}
      />
    );

    expect(html).toContain('Releases &amp; Drift Control Tower');
    expect(html).toContain('Fleet Targets');
    expect(html).toContain('Select All Behind (1)');
    expect(html).toContain('SpendyLedger');
    expect(html).toContain('ParakithSite');
    expect(html).toContain('EDGE');
    expect(html).toContain('UniFi SIEM Collector');
    expect(html).toContain('SVC');

    // Slim 1-row efficiency strip replaces legacy 290-line card
    expect(html).toContain('Build Efficiency');
    expect(html).toContain('Full Telemetry &amp; Trends →');
    expect(html).toContain('Deps CACHED');
    expect(html).toContain('2 ELF 0xb7');
    expect(html).not.toContain('Total Build vs Target');
    expect(html).not.toContain('Build Regression &amp; Budget Warnings');

    // Above-the-fold Deploy + Instant Rollback grid
    expect(html).toContain('Buildx &amp; Deploy to Production (deploy-docker.ps1)');
    expect(html).toContain('Instant Rollback Panel');
    expect(html).not.toContain('<WorkStreamContainer');
    expect(html.toLowerCase()).not.toContain('<select');
  });

  it('renders Service Lifecycle & Prerequisites and hides BuildEfficiencyStrip for wsh-docker-service', () => {
    const html = renderToStaticMarkup(
      <ReleasePipelineView
        apps={[makeWshApp(), makeServiceApp()]}
        selectedAppSlug="unifi-siem"
        onTriggerDeploy={vi.fn()}
        onTriggerDeployAll={vi.fn()}
        onTriggerRollback={vi.fn()}
        onTriggerServiceAction={vi.fn()}
      />
    );

    expect(html).toContain('Active WSH Service Container');
    expect(html).toContain('Service Lifecycle &amp; Network Prerequisites');
    expect(html).toContain('Verify Local (-VerifyLocal)');
    expect(html).not.toContain('Build Efficiency');
  });

  it('renders Batch Smoke Failure Attribution panel when batchSmokeFailureReport is present', () => {
    const report: BatchSmokeFailureReport = {
      triggeredAt: '2026-11-24T11:30:00Z',
      triggeredBy: 'deploy:batch:spendy',
      failedChecks: [{ name: 'Spendy Health', category: 'API', passed: false, durationMs: 45, detail: '502 Bad Gateway' }],
      deployedApps: [
        { slug: 'spendy', displayName: 'SpendyLedger', preBatchTag: '1.2.2-0001111', hasDbMigration: false, deployOrderIndex: 0 },
      ],
      attribution: {
        action: 'TARGETED_AUTO_ROLLBACK',
        implicatedBatchSlugs: ['spendy'],
        rollbackPlan: [
          { slug: 'spendy', displayName: 'SpendyLedger', preBatchTag: '1.2.2-0001111', hasDbMigration: false, deployOrderIndex: 0 },
        ],
        idpFirstRollbackNeeded: false,
        blockedByDbMigrationSlugs: [],
        missingTagSlugs: [],
        nonBatchFailedChecks: [],
        externalFailedChecks: [],
        unattributableFailedChecks: [],
        summaryReason: 'Spendy Health assertion failed immediately following deploy.',
      },
      autoRollbackAttempted: false,
    };

    const html = renderToStaticMarkup(
      <ReleasePipelineView
        apps={[makeWshApp()]}
        selectedAppSlug="spendy"
        batchSmokeFailureReport={report}
        onRollbackBatchTargets={vi.fn()}
        onTriggerDeploy={vi.fn()}
        onTriggerDeployAll={vi.fn()}
        onTriggerRollback={vi.fn()}
      />
    );

    expect(html).toContain('Batch Smoke Gate Failure &amp; Targeted Recovery');
    expect(html).toContain('Rollback Implicated Only (1)');
  });
});
