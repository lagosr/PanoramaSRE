import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DiscoveredApp, McpBridgeStatus } from '../types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: vi.fn(),
  revealItemInDir: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

import { ThemeProvider } from '../../context/ThemeContext';
import { BackupsRecoveryView } from '../../components/backups/BackupsRecoveryView';
import { SettingsView } from '../../components/settings/SettingsView';
import { McpBridgeBanner } from '../../components/local-dev/McpBridgeBanner';

const mockDbApp: DiscoveredApp = {
  manifest: {
    schemaVersion: 1,
    appId: 'spendy',
    slug: 'spendy',
    hostingTarget: 'wsh-docker',
    displayName: 'SpendyLedger',
    portalTitle: 'SpendyLedger',
    description: 'Finance Tracker',
    basePath: '/spendy',
    port: 3001,
    containerName: 'spendy-ledger',
    composeProject: 'spendy-ledger',
    remoteAppRoot: '/opt/spendy-ledger',
    dataVolume: 'spendy-ledger',
    localSqlitePath: 'data/spendy.sqlite',
    themeColor: 'amber',
    icon: 'DollarSign',
    hasDatabase: true,
    portalOrder: 2,
    roles: ['admin'],
    sre: {
      deployScript: '',
      dbScript: '',
      devCommand: '',
      healthEndpoint: '/api/health',
      manifestEndpoint: '/api/auth/manifest',
      testCommand: '',
      typecheckCommand: '',
      requiresAuthInDev: false,
      automatedBackupDefault: true,
      exposeInRemotePortal: true,
    },
  },
  workspacePath: 'c:\\test\\spendy',
  provenanceState: 'IN_SYNC',
};

describe('Phase 5: Backups, 2-Column Settings Overhaul & Cohesion', () => {
  it('BackupsRecoveryView renders clean 2-tab layout with semantic h1 and omits duplicate Latest Run inventory card', () => {
    const html = renderToStaticMarkup(
      <BackupsRecoveryView
        apps={[mockDbApp]}
        ledger={null}
        isLoading={false}
        onRefresh={vi.fn()}
        onTriggerFullGfsBackup={vi.fn()}
        onTriggerAppBackup={vi.fn()}
        onApplyLocalBackup={vi.fn()}
        onRestoreRemoteBackup={vi.fn()}
      />
    );

    expect(html).toContain('<h1');
    expect(html).toContain('Database Backups &amp; Disaster Recovery');
    expect(html).toContain('Snapshot &amp; Hydration Engine');
    expect(html).toContain('GFS Schedule &amp; Run History');
    expect(html).not.toContain('Suite Database Backup Inventory (Latest GFS Run)');
  });

  it('SettingsView renders 2-column vertical sub-nav across all 6 categories and Unified Console Dock Defaults on general', () => {
    const html = renderToStaticMarkup(
      <ThemeProvider initialTheme="dark">
        <SettingsView initialTab="general" />
      </ThemeProvider>
    );

    expect(html).toContain('<h1');
    expect(html).toContain('General &amp; Console');
    expect(html).toContain('AI, Credentials &amp; Connectors');
    expect(html).toContain('Notifications &amp; Gate');
    expect(html).toContain('Sync, Host &amp; Storage');
    expect(html).toContain('Application Logs');
    expect(html).toContain('About &amp; Provenance');
    expect(html).toContain('Unified Console Dock Defaults');
    expect(html).toContain('Default Auto-Open Mode');
    expect(html).toContain('Default Dock Placement');
  });

  it('SettingsView renders sre-agent-wsh connector seam on security, Hardening jump + VACUUM on sync, AGENT_AUDIT on logs, and Provenance on about', () => {
    const securityHtml = renderToStaticMarkup(
      <ThemeProvider initialTheme="dark">
        <SettingsView initialTab="security" />
      </ThemeProvider>
    );
    expect(securityHtml).toContain('sre-agent-wsh Ed25519 Forced-Command Gatekeeper Key');
    expect(securityHtml).not.toContain('Save Threat Intel Settings');

    const syncHtml = renderToStaticMarkup(
      <ThemeProvider initialTheme="dark">
        <SettingsView initialTab="sync" onNavigateToHardening={vi.fn()} />
      </ThemeProvider>
    );
    expect(syncHtml).toContain('Open WSH Hardening →');
    expect(syncHtml).toContain('Run VACUUM &amp; Truncate WAL');
    expect(syncHtml).toContain('Workstation Resource Guardrails');
    expect(syncHtml).not.toContain('Re-Apply WSH Firewall');

    const logsHtml = renderToStaticMarkup(
      <ThemeProvider initialTheme="dark">
        <SettingsView initialTab="logs" />
      </ThemeProvider>
    );
    expect(logsHtml).toContain('All Categories');
    expect(logsHtml).toContain('Copy Logs');
    expect(logsHtml).toContain('Pinned');

    const aboutHtml = renderToStaticMarkup(
      <ThemeProvider initialTheme="dark">
        <SettingsView initialTab="about" />
      </ThemeProvider>
    );
    expect(aboutHtml).toContain('PanoramaSRE Build Provenance');
    expect(aboutHtml).toContain('Suite Control Plane Alignment');
  });

  it('McpBridgeBanner renders reserved sre_agent_handoffs extensibility seam', () => {
    const mcpStatus: McpBridgeStatus = {
      isOnline: true,
      pipeName: '\\\\.\\pipe\\panorama-sre-mcp',
      instanceId: 'inst-1',
      pid: 4242,
      channel: 'dev',
      isPrimaryElected: true,
      activeConnections: 1,
      totalRequests: 12,
      securityAlerts: 0,
      lastAction: null,
      siblingInstances: 0,
    };

    const html = renderToStaticMarkup(<McpBridgeBanner status={mcpStatus} />);
    expect(html).toContain('sre_agent_handoffs');
    expect(html).toContain('Ready for AI Agent SRE');
  });
});
