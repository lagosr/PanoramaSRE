import { describe, it, expect } from 'vitest';
import { renderPortalHtml } from '../portal-generator';
import { AppManifest } from '../types';

describe('portal-generator', () => {
  const dummyApps: AppManifest[] = [
    {
      schemaVersion: 1,
      appId: 'auth',
      slug: 'auth',
      displayName: 'PanoramaAuth',
      portalTitle: 'Panorama Auth',
      description: 'Identity Provider',
      basePath: '/auth',
      port: 3000,
      containerName: 'panorama-auth',
      composeProject: 'panorama-auth',
      remoteAppRoot: '/var/data/auth',
      dataVolume: '/var/data/auth/data',
      localSqlitePath: 'data/auth.sqlite',
      themeColor: 'emerald',
      icon: 'Shield',
      portalOrder: 1,
      roles: ['admin'],
      sre: {
        deployScript: './deploy-docker.ps1',
        dbScript: './db-manager.ps1',
        devCommand: 'npm run dev',
        healthEndpoint: '/auth/api/health',
        manifestEndpoint: '/auth/api/auth/manifest',
        testCommand: 'npm test',
        typecheckCommand: 'npx tsc --noEmit',
        requiresAuthInDev: false,
        automatedBackupDefault: true,
        exposeInRemotePortal: true,
      },
    },
  ];

  it('replaces cards and probes within markers', () => {
    const inputHtml = `
      <!-- PANORAMA_APP_CARDS_START -->
      <!-- old card -->
      <!-- PANORAMA_APP_CARDS_END -->
      <script>
      /* PANORAMA_APP_PROBES_START */
      /* old probe */
      /* PANORAMA_APP_PROBES_END */
      </script>
    `;

    const result = renderPortalHtml(inputHtml, dummyApps, 'local');
    expect(result).toContain('Panorama Auth');
    expect(result).toContain("id: 'auth'");
    expect(result).not.toContain('old card');
  });

  it('excludes cloudflare-pages apps from generated WSH portal cards and probes', () => {
    const mixedApps: AppManifest[] = [
      ...dummyApps,
      {
        schemaVersion: 1,
        appId: 'parakith-site',
        slug: 'parakith',
        hostingTarget: 'cloudflare-pages',
        displayName: 'ParakithSite',
        portalTitle: 'Parakith LLC',
        description: 'Public compliance website hosted on Cloudflare Pages',
        basePath: '/',
        port: 3500,
        containerName: '',
        composeProject: '',
        remoteAppRoot: '',
        dataVolume: '',
        localSqlitePath: '',
        themeColor: 'slate',
        icon: 'ShieldCheck',
        portalOrder: 99,
        roles: ['admin'],
        cloudflare: {
          pagesProject: 'parakith-site',
          primaryUrl: 'https://www.parakith.com',
          domains: ['parakith.com', 'www.parakith.com'],
        },
        sre: {
          deployScript: './deploy-cloudflare-pages.ps1',
          dbScript: '',
          devCommand: 'npm run dev',
          previewCommand: 'npm run preview',
          healthEndpoint: '/api/health',
          healthAuthMode: 'hmac-sha256-stealth',
          testCommand: 'npm test',
          typecheckCommand: 'npm run typecheck',
          requiresAuthInDev: false,
          automatedBackupDefault: false,
          exposeInRemotePortal: false,
        },
      },
    ];

    const inputHtml = `
      <!-- PANORAMA_APP_CARDS_START -->
      <!-- PANORAMA_APP_CARDS_END -->
      <script>
      /* PANORAMA_APP_PROBES_START */
      /* PANORAMA_APP_PROBES_END */
      </script>
    `;

    const result = renderPortalHtml(inputHtml, mixedApps, 'remote');
    expect(result).toContain('Panorama Auth');
    expect(result).not.toContain('Parakith LLC');
    expect(result).not.toContain("id: 'parakith-site'");
  });

  it('renders Zap icon SVG and green-theme class for EnergyAnalyzer', () => {
    const energyApp: AppManifest = {
      ...dummyApps[0],
      appId: 'energy',
      slug: 'energy',
      displayName: 'EnergyAnalyzer',
      portalTitle: 'Energy Analyzer',
      basePath: '/energy',
      port: 3005,
      containerName: 'energy-analyzer',
      themeColor: 'green',
      icon: 'Zap',
      portalOrder: 6,
      sre: {
        ...dummyApps[0].sre,
        healthEndpoint: '/energy/api/health',
      },
    };
    const inputHtml = `
      <!-- PANORAMA_APP_CARDS_START -->
      <!-- PANORAMA_APP_CARDS_END -->
      <script>
      /* PANORAMA_APP_PROBES_START */
      /* PANORAMA_APP_PROBES_END */
      </script>
    `;
    const result = renderPortalHtml(inputHtml, [energyApp], 'local');
    expect(result).toContain('green-theme');
    expect(result).toContain('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>');
    expect(result).toContain('/energy/api/health');
  });
});
