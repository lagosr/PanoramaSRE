import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { SidebarRail, NavItem } from './components/layout/SidebarRail';
import { TopLiveSyncBar } from './components/layout/TopLiveSyncBar';
import { SreTerminalDrawer, TerminalTab } from './components/layout/SreTerminalDrawer';
import { CommandCenterView } from './components/hud/CommandCenterView';
import { LocalDevView } from './components/local-dev/LocalDevView';
import { SettingsView } from './components/settings/SettingsView';
import { TopologyStacksView } from './components/topology/TopologyStacksView';
import { DietPiHostView } from './components/dietpi/DietPiHostView';
import { EdgePkiView } from './components/edge/EdgePkiView';
import { ReleasePipelineView } from './components/releases/ReleasePipelineView';
import { BackupsRecoveryView } from './components/backups/BackupsRecoveryView';
import {
  DiscoveredApp,
  NetworkPosture,
  ApplianceStatus,
  AppCompositionReport,
  AppHealth,
  DevServerInfo,
  WshSnapshot,
  BackupLedgerSummary,
  SslFleetSummary,
} from './lib/types';
import { buildSslCertCommand } from './lib/script-adapters';

const DEFAULT_APPLIANCES = [
  { key: 'ui', name: 'UniFi CloudKey', host: 'ui.panoramadr.com' },
  { key: 'protect', name: 'UniFi Protect UNVR', host: 'protect.panoramadr.com' },
  { key: 'ha', name: 'Home Assistant', host: 'ha.panoramadr.com' },
  { key: 'genmon', name: 'Generator Monitor', host: 'genmon.panoramadr.com' },
];

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavItem>('hud');
  const [apps, setApps] = useState<DiscoveredApp[]>([]);
  const [appliances, setAppliances] = useState<ApplianceStatus[]>([]);
  const [networkPosture, setNetworkPosture] = useState<NetworkPosture>('LAN_DIRECT');
  const [isManualSyncing, setIsManualSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [wshSnapshot, setWshSnapshot] = useState<WshSnapshot | null>(null);
  const [backupLedger, setBackupLedger] = useState<BackupLedgerSummary | null>(null);
  const [sslFleet, setSslFleet] = useState<SslFleetSummary | null>(null);
  const [isLoadingSsl, setIsLoadingSsl] = useState<boolean>(false);

  // Terminal Drawer State
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [activeTerminalTabId, setActiveTerminalTabId] = useState<string>('');
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  // Keep ref to current apps to update granular sub-properties without full component tree thrashing
  const appsRef = useRef<DiscoveredApp[]>([]);
  appsRef.current = apps;

  // Refresh Dev Server process states (lightweight TCP / PID check)
  const refreshDevServers = useCallback(async () => {
    const currentApps = appsRef.current;
    if (currentApps.length === 0) return;
    try {
      const appsPayload = currentApps.map((a) => ({
        appId: a.manifest.appId,
        port: a.manifest.port,
        basePath: a.manifest.basePath,
        workspacePath: a.workspacePath,
        localSqlitePath: a.manifest.localSqlitePath,
      }));
      const devStatuses = await invoke<DevServerInfo[]>('get_dev_servers_status', {
        apps: appsPayload,
      });

      setApps((prevApps) =>
        prevApps.map((app) => {
          const freshDev = devStatuses.find((d) => d.app_id === app.manifest.appId);
          if (JSON.stringify(freshDev) === JSON.stringify(app.devServer)) {
            return app;
          }
          return { ...app, devServer: freshDev };
        })
      );
    } catch (err) {
      console.warn('[PanoramaSRE] Dev server status check warning:', err);
    }
  }, []);

  // Refresh Home Lab Appliances status
  const refreshAppliances = useCallback(async () => {
    try {
      const applianceTuples = DEFAULT_APPLIANCES.map((a) => [a.key, a.name, a.host]);
      const applianceResults = await invoke<ApplianceStatus[]>('probe_appliances', {
        appliances: applianceTuples,
        timeoutMs: 2500,
      });
      setAppliances(applianceResults);
    } catch {
      // Ignore background appliance probe errors
    }
  }, []);

  // Refresh WSH Snapshot & Posture
  const refreshWshTelemetry = useCallback(async () => {
    try {
      const posture = await invoke<NetworkPosture>('detect_network_posture', {});
      setNetworkPosture(posture);

      if (posture === 'LAN_DIRECT') {
        const snap = await invoke<WshSnapshot>('fetch_wsh_snapshot', {
          mode: '--fast',
        });
        setWshSnapshot(snap);
      }
    } catch {
      // Ignore background WSH snapshot errors
    }
  }, []);

  // Refresh Backup Ledger
  const refreshBackupLedger = useCallback(async () => {
    try {
      const ledger = await invoke<BackupLedgerSummary>('read_backup_ledger', {});
      setBackupLedger(ledger);
    } catch (ledgerErr) {
      console.warn('[PanoramaSRE] Backup ledger warning:', ledgerErr);
    }
  }, []);

  // Refresh 5-Domain SSL Dual-Probe & Drift Status
  const refreshSslStatus = useCallback(async () => {
    setIsLoadingSsl(true);
    try {
      const summary = await invoke<SslFleetSummary>('get_ssl_fleet_status', {});
      setSslFleet(summary);
    } catch (sslErr) {
      console.warn('[PanoramaSRE] SSL fleet probe warning:', sslErr);
    } finally {
      setIsLoadingSsl(false);
    }
  }, []);

  // Full Initial App Discovery & Telemetry Probe
  const syncFullTelemetry = useCallback(async (isUserInitiated = false) => {
    if (isUserInitiated) {
      setIsManualSyncing(true);
    }
    try {
      // 1. Posture check
      const posture = await invoke<NetworkPosture>('detect_network_posture', {});
      setNetworkPosture(posture);

      // 2. Discover apps via panorama.app.json
      const rawDiscovered = await invoke<Array<{
        manifest: any;
        workspace_path: string;
        manifest_path: string;
      }>>('discover_suite_apps', {});

      // 3. For each discovered app, probe /api/health and compute git provenance
      const enrichedApps: DiscoveredApp[] = await Promise.all(
        rawDiscovered.map(async (item) => {
          const appManifest = {
            ...item.manifest,
            appId: item.manifest.app_id || item.manifest.slug,
            displayName: item.manifest.display_name,
            portalTitle: item.manifest.portal_title || item.manifest.display_name,
            basePath: item.manifest.base_path,
            containerName: item.manifest.container_name || item.manifest.slug,
            composeProject: item.manifest.slug,
            remoteAppRoot: item.manifest.remote_app_root || `/var/data/${item.manifest.slug}`,
            dataVolume: item.manifest.data_volume || `/var/data/${item.manifest.slug}/data`,
            localSqlitePath: item.manifest.local_sqlite_path || '',
            themeColor: item.manifest.theme_color || 'emerald',
            icon: item.manifest.icon || 'Layers',
            portalOrder: 1,
            roles: ['admin'],
            sre: {
              deployScript: './deploy-docker.ps1',
              dbScript: './db-manager.ps1',
              devCommand: 'npm run dev',
              healthEndpoint: `${item.manifest.base_path}/api/health`,
              manifestEndpoint: `${item.manifest.base_path}/api/auth/manifest`,
              testCommand: 'npm test',
              typecheckCommand: 'npx tsc --noEmit',
              requiresAuthInDev: false,
              automatedBackupDefault: true,
              exposeInRemotePortal: true,
            },
          };

          // Probe /api/health on WSH
          let probedHealth: AppHealth | undefined;
          let latencyMs = 0;
          try {
            const healthUrl = `https://wsh.panoramadr.com${item.manifest.base_path}/api/health`;
            const res = await invoke<{
              status: string;
              latency_ms: number;
              health: AppHealth | null;
            }>('probe_app_health', {
              appId: appManifest.appId,
              url: healthUrl,
              timeoutMs: 4000,
            });
            latencyMs = res.latency_ms;
            if (res.health) {
              probedHealth = res.health;
            }
          } catch {
            // Health probe fallback
          }

          // Compute Git Provenance Composition
          let comp: AppCompositionReport | undefined;
          try {
            const prodReleaseId = probedHealth?.release?.release_id || (probedHealth?.version ? `v${probedHealth.version}` : null);
            comp = await invoke<AppCompositionReport>('compute_app_composition', {
              appId: appManifest.appId,
              repoPath: item.workspace_path,
              prodSha: probedHealth?.release?.commit_sha || null,
              prodReleaseId,
              prodDirty: probedHealth?.release?.dirty || false,
            });
          } catch {
            // Repo check fallback
          }

          return {
            manifest: appManifest,
            workspacePath: item.workspace_path,
            health: probedHealth,
            provenanceState: comp ? comp.state : 'UNKNOWN',
            composition: comp,
            latencyMs,
          };
        })
      );

      // 4. Query Dev Servers Status
      try {
        const appsPayload = enrichedApps.map((a) => ({
          appId: a.manifest.appId,
          port: a.manifest.port,
          basePath: a.manifest.basePath,
          workspacePath: a.workspacePath,
          localSqlitePath: a.manifest.localSqlitePath,
        }));
        const devStatuses = await invoke<DevServerInfo[]>('get_dev_servers_status', {
          apps: appsPayload,
        });

        // Merge dev server status into apps
        for (const app of enrichedApps) {
          app.devServer = devStatuses.find((d) => d.app_id === app.manifest.appId);
        }
      } catch (err) {
        console.error('[PanoramaSRE] Dev servers probe error:', err);
      }

      setApps(enrichedApps);

      // 5. Probe Home Lab Appliances
      await refreshAppliances();

      // 6. Fetch WSH Host & Topology Snapshot (LAN Direct only)
      if (posture === 'LAN_DIRECT') {
        try {
          const snap = await invoke<WshSnapshot>('fetch_wsh_snapshot', {
            mode: '--fast',
          });
          setWshSnapshot(snap);
        } catch (snapErr) {
          console.warn('[PanoramaSRE] WSH snapshot warning:', snapErr);
        }
      }

      // 7. Fetch GFS Backup Ledger
      await refreshBackupLedger();

      // 8. Fetch 5-Domain SSL Dual-Probe Matrix
      await refreshSslStatus();

      setLastSyncTime(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('[PanoramaSRE] Full sync error:', err);
    } finally {
      if (isUserInitiated) {
        setIsManualSyncing(false);
      }
    }
  }, [refreshAppliances, refreshBackupLedger, refreshSslStatus]);

  // Initial sync on mount
  useEffect(() => {
    syncFullTelemetry(false);
  }, [syncFullTelemetry]);

  // Listen for background TelemetryScheduler ticks and update ONLY relevant tier data
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('sre://telemetry-tick', (event: any) => {
      const payload = event.payload;
      const tier = payload?.tier;

      // Tier 1 (every 15s): update dev servers and appliances without full page re-fetching
      if (tier === 1) {
        refreshDevServers();
        refreshAppliances();
      }

      // Tier 2 (every 60s): update WSH host telemetry, backup ledger & SSL dual-probes
      if (tier === 2) {
        refreshWshTelemetry();
        refreshBackupLedger();
        refreshSslStatus();
      }

      // Tier 3 (every 300s): update git composition & health probes
      if (tier === 3) {
        syncFullTelemetry(false);
      }
    }).then((unsub) => {
      unlisten = unsub;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [refreshDevServers, refreshAppliances, refreshWshTelemetry, refreshBackupLedger, refreshSslStatus, syncFullTelemetry]);

  // Dev Server Actions
  const handleStartDevServer = async (appId: string, workspacePath: string, devCommand: string) => {
    try {
      await invoke('start_dev_server', {
        appId,
        workspacePath,
        devCommand,
      });
      refreshDevServers();
    } catch (err) {
      console.error('Failed to start dev server:', err);
    }
  };

  const handleStartAuthAndApp = async (appId: string, workspacePath: string, devCommand: string) => {
    const authApp = apps.find((a) => a.manifest.slug === 'auth');
    if (authApp) {
      await handleStartDevServer(
        authApp.manifest.appId,
        authApp.workspacePath,
        authApp.manifest.sre.devCommand
      );
    }
    await handleStartDevServer(appId, workspacePath, devCommand);
  };

  const handleStopDevServer = async (appId: string, port?: number) => {
    try {
      await invoke('stop_dev_server', { appId, port });
      // Short delay to allow Windows process termination and port release
      setTimeout(() => refreshDevServers(), 600);
    } catch (err) {
      console.error('Failed to stop dev server:', err);
    }
  };

  const handleRestartDevServer = async (appId: string, workspacePath: string, devCommand: string, port?: number) => {
    try {
      await invoke('stop_dev_server', { appId, port });
      setTimeout(async () => {
        try {
          await invoke('start_dev_server', {
            appId,
            workspacePath,
            devCommand,
          });
          refreshDevServers();
        } catch (startErr) {
          console.error('Failed to start during restart:', startErr);
        }
      }, 700);
    } catch (err) {
      console.error('Failed to restart dev server:', err);
    }
  };

  const handleStartAllDevServers = async () => {
    // 1. Start auth first if present
    const authApp = apps.find((a) => a.manifest.slug === 'auth');
    if (authApp && authApp.devServer?.status !== 'RUNNING_MANAGED' && authApp.devServer?.status !== 'RUNNING_EXTERNAL') {
      try {
        await invoke('start_dev_server', {
          appId: authApp.manifest.appId,
          workspacePath: authApp.workspacePath,
          devCommand: authApp.manifest.sre.devCommand,
        });
      } catch (err) {
        console.warn('Failed to start auth dev server:', err);
      }
    }

    // 2. Start all other remaining child web servers in parallel
    const childApps = apps.filter((a) => a.manifest.slug !== 'auth');
    await Promise.all(
      childApps.map(async (child) => {
        if (child.devServer?.status !== 'RUNNING_MANAGED' && child.devServer?.status !== 'RUNNING_EXTERNAL') {
          try {
            await invoke('start_dev_server', {
              appId: child.manifest.appId,
              workspacePath: child.workspacePath,
              devCommand: child.manifest.sre.devCommand,
            });
          } catch (childErr) {
            console.warn(`Failed to start ${child.manifest.displayName}:`, childErr);
          }
        }
      })
    );

    setTimeout(() => refreshDevServers(), 1000);
  };

  const handleStopAllDevServers = async () => {
    await Promise.all(
      apps.map(async (app) => {
        try {
          await invoke('stop_dev_server', {
            appId: app.manifest.appId,
            port: app.manifest.port,
          });
        } catch (err) {
          console.warn(`Failed to stop ${app.manifest.displayName}:`, err);
        }
      })
    );
    setTimeout(() => refreshDevServers(), 800);
  };

  // Backup & Recovery Actions
  const handleTriggerAppBackup = (app: DiscoveredApp) => {
    const jobId = `backup-app-${app.manifest.slug}-${Date.now()}`;
    const newTab: TerminalTab = {
      id: jobId,
      title: `Snapshot: ${app.manifest.displayName}`,
      lines: [`[PanoramaSRE] Pulling remote SQLite backup for ${app.manifest.displayName}...`],
      isRunning: true,
    };
    setTerminalTabs((prev) => [...prev, newTab]);
    setActiveTerminalTabId(jobId);
    setIsDrawerOpen(true);

    invoke('run_process_stream', {
      jobId,
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', './db-manager.ps1', 'Backup'],
      workingDir: app.workspacePath,
      resourceLock: 'BACKUP_GFS_RUNNER',
    }).then(() => refreshBackupLedger());
  };

  const handleApplyLocalBackup = (app: DiscoveredApp, archivePath: string) => {
    const jobId = `apply-local-${app.manifest.slug}-${Date.now()}`;
    const newTab: TerminalTab = {
      id: jobId,
      title: `ApplyLocal: ${app.manifest.displayName}`,
      lines: [`[PanoramaSRE] Extracting ${archivePath.split('\\').pop()} to local SQLite...`],
      isRunning: true,
    };
    setTerminalTabs((prev) => [...prev, newTab]);
    setActiveTerminalTabId(jobId);
    setIsDrawerOpen(true);

    invoke('run_process_stream', {
      jobId,
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        './db-manager.ps1',
        'ApplyLocal',
        '-BackupFile',
        archivePath,
      ],
      workingDir: app.workspacePath,
      resourceLock: 'DEV_PROCESS_SPAWN',
    }).then(() => refreshDevServers());
  };

  const handleRestoreRemoteBackup = (app: DiscoveredApp, archivePath: string) => {
    const jobId = `restore-prod-${app.manifest.slug}-${Date.now()}`;
    const newTab: TerminalTab = {
      id: jobId,
      title: `RestoreProd: ${app.manifest.displayName}`,
      lines: [
        `[PanoramaSRE] INITIATING PRODUCTION DATABASE RESTORATION FOR ${app.manifest.displayName.toUpperCase()}...`,
        `Archive: ${archivePath}`,
      ],
      isRunning: true,
    };
    setTerminalTabs((prev) => [...prev, newTab]);
    setActiveTerminalTabId(jobId);
    setIsDrawerOpen(true);

    invoke('run_process_stream', {
      jobId,
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        './db-manager.ps1',
        'RestoreRemote',
        '-BackupFile',
        archivePath,
      ],
      workingDir: app.workspacePath,
      resourceLock: 'WSH_REMOTE_MUTATION',
    }).then(() => {
      syncFullTelemetry(false);
      refreshBackupLedger();
    });
  };

  // SSL Certificate Lifecycle Actions
  const handleTriggerSslRenewal = (options: {
    unattended?: boolean;
    forceRenewal?: boolean;
    deployTargets?: string[];
    targetDevice?: string;
  }) => {
    const suiteToolsPath = 'C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaDrSuite\\tools';
    const cmdSpec = buildSslCertCommand(suiteToolsPath, options);
    const jobId = `ssl-renew-${Date.now()}`;
    const title = options.targetDevice
      ? `Renew ${options.targetDevice} (${options.forceRenewal ? 'Force' : 'Smart'})`
      : options.forceRenewal
      ? 'Force Renew All SSL'
      : options.deployTargets && options.deployTargets.length > 0
      ? `Deploy SSL: ${options.deployTargets.join(', ')}`
      : 'Renew Due SSL (<30d)';

    const newTab: TerminalTab = {
      id: jobId,
      title,
      lines: [`[PanoramaSRE] Invoking ${cmdSpec.command} ${cmdSpec.args.join(' ')}...`],
      isRunning: true,
    };
    setTerminalTabs((prev) => [...prev, newTab]);
    setActiveTerminalTabId(jobId);
    setIsDrawerOpen(true);

    invoke('run_process_stream', {
      jobId,
      command: cmdSpec.command,
      args: cmdSpec.args,
      workingDir: cmdSpec.workingDir,
      resourceLock: 'WSH_REMOTE_MUTATION',
    }).then(() => refreshSslStatus());
  };

  // Terminal Drawer Action Handlers
  const handleAbortJob = async (id: string) => {
    try {
      await invoke('abort_process', { jobId: id });
    } catch (err) {
      console.error('Failed to abort process:', err);
    }
  };

  const handleCloseTab = (id: string) => {
    setTerminalTabs((prev) => prev.filter((t) => t.id !== id));
    if (activeTerminalTabId === id) {
      const remaining = terminalTabs.filter((t) => t.id !== id);
      if (remaining.length > 0) {
        setActiveTerminalTabId(remaining[0].id);
      } else {
        setIsDrawerOpen(false);
      }
    }
  };

  const handleClearTab = (id: string) => {
    setTerminalTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, lines: [] } : t))
    );
  };

  const devRunningCount = apps.filter(
    (a) => a.devServer?.status === 'RUNNING_MANAGED' || a.devServer?.status === 'RUNNING_EXTERNAL'
  ).length;

  const unhealthyCount = apps.filter((a) => a.health && a.health.status !== 'healthy').length;

  return (
    <div className="flex h-screen w-screen bg-[#050b14] text-slate-100 overflow-hidden font-sans">
      <SidebarRail
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        devRunningCount={devRunningCount}
        unhealthyCount={unhealthyCount}
      />

      <main className="flex-1 flex flex-col h-full overflow-hidden">
        <TopLiveSyncBar
          networkPosture={networkPosture}
          devRunningCount={devRunningCount}
          totalAppCount={apps.length}
          lastSyncTime={lastSyncTime}
          isSyncing={isManualSyncing}
          onRefresh={() => syncFullTelemetry(true)}
        />

        <div className="flex-1 overflow-y-auto">
          {activeTab === 'hud' && (
            <CommandCenterView
              apps={apps}
              appliances={appliances}
              sslFleet={sslFleet}
              isLoading={apps.length === 0}
            />
          )}

          {activeTab === 'local-dev' && (
            <LocalDevView
              apps={apps}
              onStart={handleStartDevServer}
              onStartAuthAndApp={handleStartAuthAndApp}
              onStop={handleStopDevServer}
              onRestart={handleRestartDevServer}
              onStartAll={handleStartAllDevServers}
              onStopAll={handleStopAllDevServers}
            />
          )}

          {activeTab === 'topology' && (
            <TopologyStacksView snapshot={wshSnapshot} isLoading={false} />
          )}

          {activeTab === 'dietpi' && (
            <DietPiHostView
              snapshot={wshSnapshot}
              isLoading={false}
              onRefresh={refreshWshTelemetry}
              onTriggerAction={(actionLabel, cmd, args) => {
                const jobId = `action-${Date.now()}`;
                const newTab: TerminalTab = {
                  id: jobId,
                  title: actionLabel,
                  lines: [`[PanoramaSRE] Executing ${actionLabel}...`],
                  isRunning: true,
                };
                setTerminalTabs((prev) => [...prev, newTab]);
                setActiveTerminalTabId(jobId);
                setIsDrawerOpen(true);
                invoke('run_process_stream', {
                  jobId,
                  command: cmd,
                  args,
                  resourceLock: 'WSH_HOST_ACTION',
                }).then(() => refreshWshTelemetry());
              }}
            />
          )}

          {activeTab === 'releases' && (
            <ReleasePipelineView
              apps={apps}
              onTriggerDeploy={(app, bump, allowDirty) => {
                const jobId = `deploy-${app.manifest.slug}-${Date.now()}`;
                const newTab: TerminalTab = {
                  id: jobId,
                  title: `Deploy: ${app.manifest.displayName}`,
                  lines: [`[PanoramaSRE] Initiating release pipeline for ${app.manifest.displayName}...`],
                  isRunning: true,
                };
                setTerminalTabs((prev) => [...prev, newTab]);
                setActiveTerminalTabId(jobId);
                setIsDrawerOpen(true);
                const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', './deploy-docker.ps1'];
                if (bump !== 'none') {
                  args.push('-BumpVersion', bump);
                }
                if (allowDirty) {
                  args.push('-AllowDirty');
                }
                invoke('run_process_stream', {
                  jobId,
                  command: 'powershell.exe',
                  args,
                  workingDir: app.workspacePath,
                  resourceLock: 'WSH_REMOTE_MUTATION',
                }).then(() => syncFullTelemetry(false));
              }}
              onTriggerRollback={(app, tag) => {
                const jobId = `rollback-${app.manifest.slug}-${Date.now()}`;
                const newTab: TerminalTab = {
                  id: jobId,
                  title: `Rollback: ${app.manifest.displayName}`,
                  lines: [`[PanoramaSRE] Swapping container to image tag ${tag}...`],
                  isRunning: true,
                };
                setTerminalTabs((prev) => [...prev, newTab]);
                setActiveTerminalTabId(jobId);
                setIsDrawerOpen(true);
                invoke('run_process_stream', {
                  jobId,
                  command: 'powershell.exe',
                  args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', './deploy-docker.ps1', '-RollbackToTag', tag],
                  workingDir: app.workspacePath,
                  resourceLock: 'WSH_REMOTE_MUTATION',
                }).then(() => syncFullTelemetry(false));
              }}
            />
          )}

          {activeTab === 'backups' && (
            <BackupsRecoveryView
              apps={apps}
              ledger={backupLedger}
              isLoading={isManualSyncing}
              onRefresh={refreshBackupLedger}
              onTriggerFullGfsBackup={() => {
                const jobId = `gfs-backup-${Date.now()}`;
                const newTab: TerminalTab = {
                  id: jobId,
                  title: 'GFS Full Backup',
                  lines: ['[PanoramaSRE] Triggering BackupManager.ps1 full backup...'],
                  isRunning: true,
                };
                setTerminalTabs((prev) => [...prev, newTab]);
                setActiveTerminalTabId(jobId);
                setIsDrawerOpen(true);
                invoke('run_process_stream', {
                  jobId,
                  command: 'powershell.exe',
                  args: [
                    '-NoProfile',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-File',
                    'C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaDrSuite\\tools\\backup-manager\\BackupManager.ps1',
                    'Backup',
                  ],
                  resourceLock: 'BACKUP_GFS_RUNNER',
                }).then(() => refreshBackupLedger());
              }}
              onTriggerAppBackup={handleTriggerAppBackup}
              onApplyLocalBackup={handleApplyLocalBackup}
              onRestoreRemoteBackup={handleRestoreRemoteBackup}
            />
          )}

          {activeTab === 'edge' && (
            <EdgePkiView
              snapshot={wshSnapshot}
              sslFleet={sslFleet}
              isLoadingSsl={isLoadingSsl}
              onRefreshSsl={refreshSslStatus}
              onTriggerRenewal={handleTriggerSslRenewal}
            />
          )}

          {activeTab === 'settings' && <SettingsView />}

          {activeTab !== 'hud' &&
            activeTab !== 'local-dev' &&
            activeTab !== 'releases' &&
            activeTab !== 'topology' &&
            activeTab !== 'dietpi' &&
            activeTab !== 'edge' &&
            activeTab !== 'backups' &&
            activeTab !== 'settings' && (
              <div className="flex-1 flex items-center justify-center p-12 text-slate-500 text-sm">
                Module <span className="font-mono text-emerald-400 mx-1">{activeTab}</span> will hydrate in subsequent milestones.
              </div>
            )}
        </div>

        {/* Global SRE Terminal Drawer for Streaming Process Operations */}
        <SreTerminalDrawer
          isOpen={isDrawerOpen}
          onClose={() => setIsDrawerOpen(false)}
          tabs={terminalTabs}
          activeTabId={activeTerminalTabId}
          onSelectTab={setActiveTerminalTabId}
          onCloseTab={handleCloseTab}
          onClearTab={handleClearTab}
          onAbortJob={handleAbortJob}
        />
      </main>
    </div>
  );
};

export default App;
