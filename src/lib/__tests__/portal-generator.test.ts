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
});
