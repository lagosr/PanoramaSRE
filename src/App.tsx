import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask } from '@tauri-apps/plugin-dialog';
import { runStreamJob } from './lib/process-runner';
import { SidebarRail, NavItem } from './components/layout/SidebarRail';
import { TopLiveSyncBar } from './components/layout/TopLiveSyncBar';
import { SreEventsConsolePanel, TerminalTab, SystemEventItem } from './components/layout/SreEventsConsolePanel';
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
  isAppDeployCandidate,
} from './lib/types';
import { buildSslCertCommand, buildCloudflareTunnelCommand, buildRemoteSshCommand } from './lib/script-adapters';

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
  const [isLoadingWsh, setIsLoadingWsh] = useState<boolean>(false);
  // Terminal Drawer State
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [activeTerminalTabId, setActiveTerminalTabId] = useState<string>('');
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [isDeployingAll, setIsDeployingAll] = useState<boolean>(false);
  const [isHostRebooting, setIsHostRebooting] = useState<boolean>(false);
  const haltDeploymentsRef = useRef<boolean>(false);
  const currentRunningDeployJobIdRef = useRef<string | null>(null);

  // Load saved console sessions from SQLite database on mount
  useEffect(() => {
    (async () => {
      try {
        const saved = await invoke<
          Array<{
            id: string;
            title: string;
            lines: string[];
            is_running: boolean;
            exit_code: number | null;
            created_at?: string | null;
            updated_at?: string | null;
          }>
        >('get_saved_console_sessions');

        if (saved && saved.length > 0) {
          const loadedTabs: TerminalTab[] = saved.map((s) => ({
            id: s.id,
            title: s.title,
            lines: s.lines,
            isRunning: false, // past runs are not running across app launch
            exitCode: s.exit_code ?? undefined,
            createdAt: s.created_at ?? undefined,
            finishedAt: s.updated_at ?? undefined,
          }));
          setTerminalTabs(loadedTabs);
          setActiveTerminalTabId(loadedTabs[0].id);
        }
      } catch (err) {
        console.warn('Failed to hydrate console sessions from DB:', err);
      }
    })();
  }, []);

  // Intercept window close requested to ask user whether to minimize or quit
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    (async () => {
      try {
        const appWindow = getCurrentWindow();
        unlistenFn = await appWindow.onCloseRequested(async (event) => {
          event.preventDefault();

          // Ask the user: Yes = Minimize to Tray, No = Quit Completely
          const shouldMinimize = await ask(
            'Do you want to minimize PanoramaSRE to the system tray?\n\n• Yes: Minimize to tray (keep dev servers and monitoring running)\n• No: Quit completely and shut down all supervised dev servers',
            {
              title: 'Close PanoramaSRE',
              kind: 'info',
              okLabel: 'Minimize to Tray',
              cancelLabel: 'Quit Completely',
            }
          );

          if (shouldMinimize) {
            try {
              await appWindow.hide();
            } catch (hideErr) {
              console.warn('Failed to hide window directly, falling back to minimize:', hideErr);
              await appWindow.minimize().catch(() => {});
            }
          } else {
            // User chose Quit Completely
            await invoke('exit_app_completely');
          }
        });
      } catch (err) {
        console.warn('Failed to attach window close listener:', err);
      }
    })();

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // Universal Action Feedback & Events History
  const [actionFeedback, setActionFeedback] = useState<{
    message: string;
    type: 'pending' | 'success' | 'error';
  } | null>(null);

  const [eventsHistory, setEventsHistory] = useState<SystemEventItem[]>([]);

  const showActionFeedback = useCallback((message: string, type: 'pending' | 'success' | 'error', durationMs?: number) => {
    setActionFeedback({ message, type });

    // Deduplicate / resolve active in-flight pending events into success/error when state transitions
    setEventsHistory((prev) => {
      const now = new Date().toLocaleTimeString();
      if (type === 'success' || type === 'error') {
        // Find if there's a preceding pending event that matches this action and update it in-place
        const pendingIndex = prev.findIndex((e) => e.type === 'pending');
        if (pendingIndex !== -1) {
          const updated = [...prev];
          updated[pendingIndex] = {
            ...updated[pendingIndex],
            type,
            message,
            timestamp: now,
          };
          return updated;
        }
      }

      const newEvent: SystemEventItem = {
        id: `ev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        timestamp: now,
        message,
        type,
      };
      return [newEvent, ...prev.slice(0, 99)];
    });

    if (durationMs && durationMs > 0) {
      setTimeout(() => {
        setActionFeedback((current) => (current?.message === message ? null : current));
      }, durationMs);
    }
  }, []);

  const saveTabToDb = useCallback(
    (tab: { id: string; title: string; lines: string[]; isRunning: boolean; exitCode?: number }) => {
      invoke('save_console_session', {
        id: tab.id,
        title: tab.title,
        lines: tab.lines,
        isRunning: tab.isRunning,
        exitCode: tab.exitCode ?? null,
      }).catch((e) => console.warn('Failed to save console session to DB:', e));
    },
    []
  );

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
    setIsLoadingWsh(true);
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
    } finally {
      setIsLoadingWsh(false);
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
            hasDatabase: item.manifest.hasDatabase ?? item.manifest.has_database ?? true,
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
  const handleStartDevServer = async (appId: string, workspacePath: string, devCommand: string, port?: number) => {
    try {
      showActionFeedback(`Starting ${appId}...`, 'pending');
      await invoke('start_dev_server', {
        appId,
        workspacePath,
        devCommand,
        port,
      });
      showActionFeedback(`Dev server ${appId} started`, 'success', 3000);
      refreshDevServers();
    } catch (err) {
      console.error('Failed to start dev server:', err);
      showActionFeedback(`Failed to start ${appId}: ${err}`, 'error', 5000);
    }
  };

  const handleStartAuthAndApp = async (appId: string, workspacePath: string, devCommand: string, port?: number) => {
    showActionFeedback(`Starting PanoramaAuth and ${appId}...`, 'pending');
    const authApp = apps.find((a) => a.manifest.slug === 'auth');
    if (authApp) {
      await handleStartDevServer(
        authApp.manifest.appId,
        authApp.workspacePath,
        authApp.manifest.sre.devCommand,
        authApp.manifest.port
      );
    }
    await handleStartDevServer(appId, workspacePath, devCommand, port);
  };

  const handleStopDevServer = async (appId: string, port?: number) => {
    try {
      showActionFeedback(`Stopping ${appId}...`, 'pending');
      await invoke('stop_dev_server', { appId, port });
      showActionFeedback(`Dev server ${appId} stopped`, 'success', 3000);
      // Short delay to allow Windows process termination and port release
      setTimeout(() => refreshDevServers(), 600);
    } catch (err) {
      console.error('Failed to stop dev server:', err);
      showActionFeedback(`Failed to stop ${appId}: ${err}`, 'error', 5000);
    }
  };

  const handleRestartDevServer = async (appId: string, workspacePath: string, devCommand: string, port?: number) => {
    try {
      showActionFeedback(`Restarting ${appId}...`, 'pending');
      await invoke('stop_dev_server', { appId, port });
      setTimeout(async () => {
        try {
          await invoke('start_dev_server', {
            appId,
            workspacePath,
            devCommand,
            port,
          });
          showActionFeedback(`Dev server ${appId} restarted`, 'success', 3000);
          refreshDevServers();
        } catch (startErr) {
          console.error('Failed to start during restart:', startErr);
          showActionFeedback(`Failed to restart ${appId}: ${startErr}`, 'error', 5000);
        }
      }, 700);
    } catch (err) {
      console.error('Failed to restart dev server:', err);
      showActionFeedback(`Failed to restart ${appId}: ${err}`, 'error', 5000);
    }
  };

  const handleStartAllDevServers = async () => {
    showActionFeedback('Starting all dev servers (Auth first)...', 'pending');
    // 1. Start auth first if present
    const authApp = apps.find((a) => a.manifest.slug === 'auth');
    if (authApp && authApp.devServer?.status !== 'RUNNING_MANAGED' && authApp.devServer?.status !== 'RUNNING_EXTERNAL') {
      try {
        await invoke('start_dev_server', {
          appId: authApp.manifest.appId,
          workspacePath: authApp.workspacePath,
          devCommand: authApp.manifest.sre.devCommand,
          port: authApp.manifest.port,
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
              port: child.manifest.port,
            });
          } catch (childErr) {
            console.warn(`Failed to start ${child.manifest.displayName}:`, childErr);
          }
        }
      })
    );

    showActionFeedback('All dev servers launched', 'success', 3500);
    setTimeout(() => refreshDevServers(), 1000);
  };

  const handleStopAllDevServers = async () => {
    showActionFeedback('Stopping all dev servers...', 'pending');
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
    showActionFeedback('All dev servers stopped', 'success', 3500);
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
      createdAt: new Date().toISOString(),
    };
    setTerminalTabs((prev) => [...prev, newTab]);
    setActiveTerminalTabId(jobId);
    setIsDrawerOpen(true);
    saveTabToDb(newTab);

    runStreamJob({
      jobId,
      label: `Snapshot: ${app.manifest.displayName}`,
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', './db-manager.ps1', 'Backup'],
      workingDir: app.workspacePath,
      lockType: 'LocalBackupIo',
      onLine: (line) => {
        appendTerminalLine(jobId, line);
      },
      onComplete: (exitCode) => {
        finalizeTerminalJob(jobId, exitCode);
        refreshBackupLedger();
      },
      onError: (err) => {
        failTerminalJob(jobId, `Backup failed: ${err}`);
      },
    });
  };

  const handleApplyLocalBackup = (app: DiscoveredApp, archivePath: string) => {
    const jobId = `apply-local-${app.manifest.slug}-${Date.now()}`;
    const newTab: TerminalTab = {
      id: jobId,
      title: `ApplyLocal: ${app.manifest.displayName}`,
      lines: [`[PanoramaSRE] Extracting ${archivePath.split('\\').pop()} to local SQLite...`],
      isRunning: true,
      createdAt: new Date().toISOString(),
    };
    setTerminalTabs((prev) => [...prev, newTab]);
    setActiveTerminalTabId(jobId);
    setIsDrawerOpen(true);
    saveTabToDb(newTab);

    runStreamJob({
      jobId,
      label: `ApplyLocal: ${app.manifest.displayName}`,
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
      lockType: 'None',
      onLine: (line) => {
        appendTerminalLine(jobId, line);
      },
      onComplete: (exitCode) => {
        finalizeTerminalJob(jobId, exitCode);
        refreshDevServers();
      },
      onError: (err) => {
        failTerminalJob(jobId, `Apply local failed: ${err}`);
      },
    });
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
      createdAt: new Date().toISOString(),
    };
    setTerminalTabs((prev) => [...prev, newTab]);
    setActiveTerminalTabId(jobId);
    setIsDrawerOpen(true);
    saveTabToDb(newTab);

    runStreamJob({
      jobId,
      label: `RestoreProd: ${app.manifest.displayName}`,
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
      lockType: 'WshRemoteMutation',
      onLine: (line) => {
        appendTerminalLine(jobId, line);
      },
      onComplete: (exitCode) => {
        finalizeTerminalJob(jobId, exitCode);
        syncFullTelemetry(false);
        refreshBackupLedger();
      },
      onError: (err) => {
        failTerminalJob(jobId, `Restore remote failed: ${err}`);
      },
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
      createdAt: new Date().toISOString(),
    };
    setTerminalTabs((prev) => [...prev, newTab]);
    setActiveTerminalTabId(jobId);
    setIsDrawerOpen(true);
    saveTabToDb(newTab);

    runStreamJob({
      jobId,
      label: title,
      command: cmdSpec.command,
      args: cmdSpec.args,
      workingDir: cmdSpec.workingDir,
      lockType: 'WshRemoteMutation',
      onLine: (line) => {
        appendTerminalLine(jobId, line);
      },
      onComplete: (exitCode) => {
        finalizeTerminalJob(jobId, exitCode);
        refreshSslStatus();
      },
      onError: (err) => {
        failTerminalJob(jobId, `SSL renewal failed: ${err}`);
      },
    });
  };

  // Cloudflare Tunnel Management via deploy-cloudflare-tunnel.ps1
  const handleTriggerTunnelAction = (action: 'status' | 'check_update' | 'update' | 'update_force') => {
    const suiteToolsPath = 'C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaDrSuite\\tools';
    const cmdSpec = buildCloudflareTunnelCommand(suiteToolsPath, action);
    const jobId = `cf-tunnel-${action}-${Date.now()}`;
    const title = action === 'update' || action === 'update_force'
      ? 'Update Cloudflare Tunnel'
      : action === 'check_update'
      ? 'Check Tunnel Updates'
      : 'Cloudflare Tunnel Status';

    const newTab: TerminalTab = {
      id: jobId,
      title,
      lines: [`[PanoramaSRE] Invoking deploy-cloudflare-tunnel.ps1 -${action}...`],
      isRunning: true,
      createdAt: new Date().toISOString(),
    };
    setTerminalTabs((prev) => [...prev, newTab]);
    setActiveTerminalTabId(jobId);
    setIsDrawerOpen(true);
    saveTabToDb(newTab);

    runStreamJob({
      jobId,
      label: title,
      command: cmdSpec.command,
      args: cmdSpec.args,
      workingDir: cmdSpec.workingDir,
      lockType: cmdSpec.lockType,
      onLine: (line) => {
        appendTerminalLine(jobId, line);
      },
      onComplete: (exitCode) => {
        finalizeTerminalJob(jobId, exitCode);
        syncFullTelemetry(false);
      },
      onError: (err) => {
        failTerminalJob(jobId, `Cloudflare Tunnel execution failed: ${err}`);
      },
    });
  };

  // Deployment Execution Helpers
  const executeAppDeploy = (app: DiscoveredApp, bump: string, allowDirty: boolean): Promise<number> => {
    const jobId = `deploy-${app.manifest.slug}-${Date.now()}`;
    currentRunningDeployJobIdRef.current = jobId;
    const newTab: TerminalTab = {
      id: jobId,
      title: `Deploy: ${app.manifest.displayName}`,
      lines: [`[PanoramaSRE] Initiating release pipeline for ${app.manifest.displayName}...`],
      isRunning: true,
      createdAt: new Date().toISOString(),
    };
    setTerminalTabs((prev) => [...prev, newTab]);
    setActiveTerminalTabId(jobId);
    setIsDrawerOpen(true);
    saveTabToDb(newTab);

    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', './deploy-docker.ps1'];
    if (bump !== 'none') {
      args.push('-BumpVersion', bump);
    }
    if (allowDirty) {
      args.push('-AllowDirty');
    }

    return runStreamJob({
      jobId,
      label: `Deploy: ${app.manifest.displayName}`,
      command: 'powershell.exe',
      args,
      workingDir: app.workspacePath,
      lockType: 'WshRemoteMutation',
      onLine: (line) => {
        appendTerminalLine(jobId, line);
      },
      onComplete: (exitCode) => {
        if (currentRunningDeployJobIdRef.current === jobId) {
          currentRunningDeployJobIdRef.current = null;
        }
        finalizeTerminalJob(jobId, exitCode);
        syncFullTelemetry(false);
      },
      onError: (err) => {
        if (currentRunningDeployJobIdRef.current === jobId) {
          currentRunningDeployJobIdRef.current = null;
        }
        failTerminalJob(jobId, `Deploy failed: ${err}`);
      },
    });
  };

  const handleDeployAllApps = async (appsToDeploy: DiscoveredApp[], bump: string, allowDirty: boolean) => {
    setIsDeployingAll(true);
    haltDeploymentsRef.current = false;

    try {
      // Respect the user's explicit deployment order (caller passes already-ordered slice)
      const sortedApps = [...appsToDeploy];

      for (let i = 0; i < sortedApps.length; i++) {
        // Check if user clicked Halt
        if (haltDeploymentsRef.current) {
          const remainingNames = sortedApps.slice(i).map((a) => a.manifest.displayName).join(', ');
          setActionFeedback({
            message: `Deployments halted by user. Cancelled remaining: ${remainingNames}`,
            type: 'error',
          });
          break;
        }

        const app = sortedApps[i];
        let exitCode: number = -1;
        try {
          exitCode = await executeAppDeploy(app, bump, allowDirty);
        } catch (err: any) {
          exitCode = -1;
        }

        // Check if deployment failed (exit code != 0)
        if (exitCode !== 0) {
          const failedApp = app.manifest.displayName;
          const remaining = sortedApps.slice(i + 1);
          if (remaining.length > 0) {
            const skippedNames = remaining.map((a) => a.manifest.displayName).join(', ');
            setActionFeedback({
              message: `Deployment of ${failedApp} failed (exit code ${exitCode}). Immediately halted ${remaining.length} remaining deployments: ${skippedNames}`,
              type: 'error',
            });
            // Append explicit safety notification to active console
            if (activeTerminalTabId) {
              appendTerminalLine(
                activeTerminalTabId,
                `\n[CRITICAL SAFETY GATE] Deployment failed for ${failedApp}. Automatically halted remaining pending deployments: ${skippedNames}.\n`
              );
            }
          } else {
            setActionFeedback({
              message: `Deployment of ${failedApp} failed (exit code ${exitCode}).`,
              type: 'error',
            });
          }
          break; // Hard stop all further deployments
        }
      }
    } finally {
      setIsDeployingAll(false);
      haltDeploymentsRef.current = false;
      currentRunningDeployJobIdRef.current = null;
      syncFullTelemetry(false);
    }
  };

  const handleHaltDeployments = async () => {
    haltDeploymentsRef.current = true;
    const activeJobId = currentRunningDeployJobIdRef.current;
    if (activeJobId) {
      try {
        await invoke('abort_process', { jobId: activeJobId });
        appendTerminalLine(activeJobId, '\n[PanoramaSRE] Deployment aborted by user request.\n');
      } catch (err) {
        console.error('Failed to abort running deploy job:', err);
      }
      finalizeTerminalJob(activeJobId, 130);
      currentRunningDeployJobIdRef.current = null;
    }
    // Finalize any running deployment tabs immediately
    setTerminalTabs((prev) =>
      prev.map((t) =>
        t.isRunning && t.id.startsWith('deploy-')
          ? { ...t, isRunning: false, exitCode: 130, finishedAt: new Date().toISOString() }
          : t
      )
    );
    setIsDeployingAll(false);
    setActionFeedback({
      message: 'Suite deployments successfully halted.',
      type: 'error',
    });
    syncFullTelemetry(false);
  };
  const handleAbortJob = async (id: string) => {
    try {
      await invoke('abort_process', { jobId: id });
      appendTerminalLine(id, '\n[PanoramaSRE] Process terminated by user request.\n');
    } catch (err) {
      console.error('Failed to abort process:', err);
    }
    if (currentRunningDeployJobIdRef.current === id) {
      currentRunningDeployJobIdRef.current = null;
      setIsDeployingAll(false);
    }
    finalizeTerminalJob(id, 130);
    syncFullTelemetry(false);
  };

  // Helper to append a line to a terminal tab and schedule DB persistence
  const appendTerminalLine = useCallback((jobId: string, line: string) => {
    setTerminalTabs((prev) =>
      prev.map((t) => {
        if (t.id === jobId) {
          const updated = { ...t, lines: [...t.lines, line] };
          return updated;
        }
        return t;
      })
    );
  }, []);

  const finalizeTerminalJob = useCallback(
    (jobId: string, exitCode: number) => {
      setTerminalTabs((prev) =>
        prev.map((t) => {
          if (t.id === jobId) {
            const updated = { ...t, isRunning: false, exitCode, finishedAt: new Date().toISOString() };
            saveTabToDb(updated);
            return updated;
          }
          return t;
        })
      );
    },
    [saveTabToDb]
  );

  const failTerminalJob = useCallback(
    (jobId: string, errMsg: string) => {
      setTerminalTabs((prev) =>
        prev.map((t) => {
          if (t.id === jobId) {
            const updated = {
              ...t,
              isRunning: false,
              lines: [...t.lines, `[ERROR] ${errMsg}`],
              exitCode: -1,
              finishedAt: new Date().toISOString(),
            };
            saveTabToDb(updated);
            return updated;
          }
          return t;
        })
      );
    },
    [saveTabToDb]
  );

  // Orchestrated DietPi Host Reboot with Active Polling & Recovery Telemetry
  const handleRebootWshWithVerification = useCallback(async () => {
    if (isHostRebooting) return;
    setIsHostRebooting(true);

    const jobId = `reboot-wsh-${Date.now()}`;
    const newTab: TerminalTab = {
      id: jobId,
      title: 'Reboot WSH Host',
      lines: [
        '[PanoramaSRE] INITIATING GRACEFUL REBOOT OF DIETPI WSH HOST...',
        '[PanoramaSRE] Stage 1/4: Sending remote reboot signal via OpenSSH...',
      ],
      isRunning: true,
      createdAt: new Date().toISOString(),
    };
    setTerminalTabs((prev) => [...prev, newTab]);
    setActiveTerminalTabId(jobId);
    setIsDrawerOpen(true);
    saveTabToDb(newTab);
    showActionFeedback('Initiating DietPi WSH reboot...', 'pending');

    const sshReboot = buildRemoteSshCommand('reboot');

    runStreamJob({
      jobId,
      label: 'Reboot WSH Host',
      command: sshReboot.command,
      args: sshReboot.args,
      lockType: 'None',
      onLine: (line) => {
        appendTerminalLine(jobId, line);
      },
      onComplete: async () => {
        appendTerminalLine(jobId, '[PanoramaSRE] Reboot command accepted by DietPi kernel.');
        appendTerminalLine(jobId, '[PanoramaSRE] Stage 2/4: Waiting for host shutdown (monitoring SSH connection drops)...');

        // Allow up to 30s for host to drop offline
        let wentDown = false;
        const shutdownStart = Date.now();
        while (Date.now() - shutdownStart < 30000) {
          await new Promise((r) => setTimeout(r, 2000));
          const isAlive = await invoke<boolean>('probe_host_tcp', {
            host: 'wsh.panoramadr.com',
            port: 22,
            timeoutMs: 1500,
          });
          if (!isAlive) {
            wentDown = true;
            appendTerminalLine(jobId, '[PanoramaSRE] Host went offline as expected. Initiating recovery polling...');
            break;
          }
        }

        if (!wentDown) {
          appendTerminalLine(jobId, '[PanoramaSRE] Host remained online or completed instantaneous restart.');
        }

        // Stage 3: Recovery Polling (Wait up to 180 seconds for SSH port 22 to accept connections)
        appendTerminalLine(jobId, '[PanoramaSRE] Stage 3/4: Polling SSH port 22 on wsh.panoramadr.com...');
        const bootStart = Date.now();
        let recovered = false;
        let elapsed = 0;

        while (Date.now() - bootStart < 180000) {
          await new Promise((r) => setTimeout(r, 3000));
          elapsed = Math.round((Date.now() - bootStart) / 1000);

          const isAlive = await invoke<boolean>('probe_host_tcp', {
            host: 'wsh.panoramadr.com',
            port: 22,
            timeoutMs: 2000,
          });

          if (isAlive) {
            recovered = true;
            appendTerminalLine(jobId, `[PanoramaSRE] Host SSH port 22 is ONLINE (elapsed: ${elapsed}s).`);
            break;
          } else {
            appendTerminalLine(jobId, `[PanoramaSRE] Host booting... waiting for SSH daemon (elapsed: ${elapsed}s)`);
          }
        }

        if (!recovered) {
          failTerminalJob(jobId, 'Host recovery timeout after 180 seconds. Check physical DietPi hardware/network.');
          showActionFeedback('Host recovery timed out after reboot', 'error', 6000);
          setIsHostRebooting(false);
          return;
        }

        // Stage 4: Post-boot service verification & telemetry sync
        appendTerminalLine(jobId, '[PanoramaSRE] Stage 4/4: Host is back online! Fetching post-boot health telemetry...');
        await new Promise((r) => setTimeout(r, 4000)); // give systemd 4s to settle services

        try {
          const freshSnap = await invoke<WshSnapshot>('fetch_wsh_snapshot', { mode: '--fast' });
          setWshSnapshot(freshSnap);

          const uptimeSecs = freshSnap.uptime_secs;
          const uptimeMinutes = Math.round(uptimeSecs / 60);
          appendTerminalLine(jobId, `[PanoramaSRE] Kernel uptime verified: ${uptimeMinutes}m (${uptimeSecs}s)`);
          appendTerminalLine(jobId, `[PanoramaSRE] Kernel version: ${freshSnap.kernel}`);
          appendTerminalLine(
            jobId,
            `[PanoramaSRE] Services: Lighttpd=${freshSnap.services?.lighttpd || 'ok'}, Docker=${freshSnap.services?.docker || 'ok'}, SSH=${freshSnap.services?.ssh || 'ok'}`
          );
          appendTerminalLine(
            jobId,
            `[PanoramaSRE] Reboot flag (/var/run/reboot-required): ${freshSnap.reboot_required ? 'STILL_PENDING' : 'CLEARED'}`
          );

          finalizeTerminalJob(jobId, 0);
          showActionFeedback('DietPi WSH successfully rebooted and online', 'success', 5000);
          syncFullTelemetry(false);
        } catch (postBootErr) {
          appendTerminalLine(jobId, `[WARN] SSH is up, but telemetry snapshot returned warning: ${postBootErr}`);
          finalizeTerminalJob(jobId, 0);
          showActionFeedback('DietPi WSH online (telemetry settling)', 'success', 4000);
          refreshWshTelemetry();
        } finally {
          setIsHostRebooting(false);
        }
      },
      onError: (err) => {
        failTerminalJob(jobId, `Failed to deliver reboot command: ${err}`);
        showActionFeedback(`Reboot trigger failed: ${err}`, 'error', 5000);
        setIsHostRebooting(false);
      },
    });
  }, [
    isHostRebooting,
    saveTabToDb,
    showActionFeedback,
    appendTerminalLine,
    finalizeTerminalJob,
    failTerminalJob,
    syncFullTelemetry,
    refreshWshTelemetry,
  ]);

  const handleTriggerFullGfsBackup = useCallback(() => {
    const jobId = `gfs-backup-${Date.now()}`;
    const newTab: TerminalTab = {
      id: jobId,
      title: 'GFS Full Backup',
      lines: ['[PanoramaSRE] Triggering BackupManager.ps1 full backup...'],
      isRunning: true,
      createdAt: new Date().toISOString(),
    };
    setTerminalTabs((prev) => [...prev, newTab]);
    setActiveTerminalTabId(jobId);
    setIsDrawerOpen(true);
    saveTabToDb(newTab);

    runStreamJob({
      jobId,
      label: 'GFS Full Backup',
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaDrSuite\\tools\\backup-manager\\BackupManager.ps1',
        'Backup',
      ],
      lockType: 'LocalBackupIo',
      onLine: (line) => {
        appendTerminalLine(jobId, line);
      },
      onComplete: (exitCode) => {
        finalizeTerminalJob(jobId, exitCode);
        refreshBackupLedger();
      },
      onError: (err) => {
        failTerminalJob(jobId, `GFS backup failed: ${err}`);
      },
    });
  }, [appendTerminalLine, finalizeTerminalJob, failTerminalJob, refreshBackupLedger, saveTabToDb]);

  const handleCloseTab = (id: string) => {
    setTerminalTabs((prev) => prev.filter((t) => t.id !== id));
    invoke('delete_console_session', { id }).catch((e) =>
      console.warn('Failed to delete console session from DB:', e)
    );
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
      prev.map((t) => {
        if (t.id === id) {
          const updated = { ...t, lines: [] };
          saveTabToDb(updated);
          return updated;
        }
        return t;
      })
    );
  };

  const handlePurgeAllTabs = () => {
    setTerminalTabs([]);
    setActiveTerminalTabId('');
    setIsDrawerOpen(false);
    invoke('delete_all_console_sessions').catch((e) =>
      console.warn('Failed to purge all console sessions from DB:', e)
    );
  };

  const devRunningCount = apps.filter(
    (a) => a.devServer?.status === 'RUNNING_MANAGED' || a.devServer?.status === 'RUNNING_EXTERNAL'
  ).length;

  const unhealthyCount = apps.filter((a) => a.health && a.health.status !== 'healthy').length;
  const prodHealthyCount = apps.filter((a) => a.health?.status === 'healthy').length;

  const backupFailureCount =
    backupLedger?.last_run_status?.toLowerCase() === 'failed'
      ? backupLedger?.latest_app_details.filter((a) => a.status.toLowerCase() === 'failed').length || 0
      : 0;

  // Count apps requiring release deployment (drifted, ahead, dirty, diverged, or unhealthy/unreachable)
  const behindReleasesCount = apps.filter(isAppDeployCandidate).length;

  // Count packages to be installed on DietPi host (upgradable Debian packages + DietPi OS updates)
  const dietpiPackagesCount = (() => {
    let count = 0;
    if (wshSnapshot?.apt_upgradable_raw) {
      count += wshSnapshot.apt_upgradable_raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('Listing...')).length;
    }
    if (
      wshSnapshot?.dietpi_update_available &&
      wshSnapshot.dietpi_update_available.trim().length > 0 &&
      wshSnapshot.dietpi_update_available.toLowerCase() !== 'false' &&
      wshSnapshot.dietpi_update_available.toLowerCase() !== 'none'
    ) {
      count += 1;
    }
    return count;
  })();

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-50 dark:bg-[#050b14] text-slate-900 dark:text-slate-100 overflow-hidden font-sans">
      {/* Upper Area: Sidebar Navigation + Main Application Content */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden relative">
        <SidebarRail
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          unhealthyCount={unhealthyCount}
          backupFailureCount={backupFailureCount}
          behindReleasesCount={behindReleasesCount}
          dietpiPackagesCount={dietpiPackagesCount}
        />

        <main className="flex-1 flex flex-col h-full overflow-hidden relative">
          <TopLiveSyncBar
            networkPosture={networkPosture}
            devRunningCount={devRunningCount}
            totalAppCount={apps.length}
            prodHealthyCount={prodHealthyCount}
            lastSyncTime={lastSyncTime}
            isSyncing={isManualSyncing}
            onRefresh={() => syncFullTelemetry(true)}
            backupFailureCount={backupFailureCount}
            onNavigateToBackups={() => setActiveTab('backups')}
          />

          <div className="flex-1 min-h-0 overflow-y-auto">
          {activeTab === 'hud' && (
            <CommandCenterView
              apps={apps}
              appliances={appliances}
              sslFleet={sslFleet}
              backupLedger={backupLedger}
              isLoading={apps.length === 0}
              onNavigateToBackups={() => setActiveTab('backups')}
              onTriggerFullGfsBackup={handleTriggerFullGfsBackup}
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
              isActionPending={actionFeedback?.type === 'pending'}
              actionMessage={actionFeedback?.message}
            />
          )}

          {activeTab === 'topology' && (
            <TopologyStacksView
              snapshot={wshSnapshot}
              apps={apps}
              isLoading={isManualSyncing}
              onRefresh={refreshWshTelemetry}
              onRunAuditCommand={(actionLabel, cmd, args) => {
                const jobId = `audit-${Date.now()}`;
                const newTab: TerminalTab = {
                  id: jobId,
                  title: actionLabel,
                  lines: [`[PanoramaSRE] Executing ${actionLabel}...`],
                  isRunning: true,
                  createdAt: new Date().toISOString(),
                };
                setTerminalTabs((prev) => [...prev, newTab]);
                setActiveTerminalTabId(jobId);
                setIsDrawerOpen(true);
                saveTabToDb(newTab);

                runStreamJob({
                  jobId,
                  label: actionLabel,
                  command: cmd,
                  args,
                  workingDir: 'C:\\Users\\rodrigo',
                  lockType: 'None',
                  onLine: (line) => {
                    appendTerminalLine(jobId, line);
                  },
                  onComplete: (exitCode) => {
                    finalizeTerminalJob(jobId, exitCode);
                  },
                  onError: (err) => {
                    failTerminalJob(jobId, `Action failed: ${err}`);
                  },
                });
              }}
              onTriggerTunnelAction={handleTriggerTunnelAction}
            />
          )}

          {activeTab === 'dietpi' && (
            <DietPiHostView
              snapshot={wshSnapshot}
              isLoading={isLoadingWsh}
              onRefresh={refreshWshTelemetry}
              onTriggerReboot={handleRebootWshWithVerification}
              isRebooting={isHostRebooting}
              onTriggerAction={(actionLabel, cmd, args) => {
                const jobId = `action-${Date.now()}`;
                const newTab: TerminalTab = {
                  id: jobId,
                  title: actionLabel,
                  lines: [`[PanoramaSRE] Executing ${actionLabel}...`],
                  isRunning: true,
                  createdAt: new Date().toISOString(),
                };
                setTerminalTabs((prev) => [...prev, newTab]);
                setActiveTerminalTabId(jobId);
                setIsDrawerOpen(true);
                saveTabToDb(newTab);

                runStreamJob({
                  jobId,
                  label: actionLabel,
                  command: cmd,
                  args,
                  lockType: 'None',
                  onLine: (line) => {
                    appendTerminalLine(jobId, line);
                  },
                  onComplete: async (exitCode) => {
                    finalizeTerminalJob(jobId, exitCode);
                    await refreshWshTelemetry();

                    // If an upgrade just ran and host reports a reboot is required, offer to reboot immediately
                    if (actionLabel.toLowerCase().includes('upgrade') && exitCode === 0) {
                      try {
                        const freshSnap = await invoke<WshSnapshot>('fetch_wsh_snapshot', { mode: '--fast' });
                        if (freshSnap.reboot_required) {
                          const confirmReboot = await ask(
                            'Package upgrade completed successfully, but the DietPi Linux kernel or core system libraries require a reboot (/var/run/reboot-required).\n\nWould you like PanoramaSRE to initiate the graceful reboot and monitor recovery now?',
                            {
                              title: 'Reboot Required After Upgrade',
                              kind: 'warning',
                              okLabel: 'Reboot & Verify Now',
                              cancelLabel: 'Reboot Later',
                            }
                          );

                          if (confirmReboot) {
                            handleRebootWshWithVerification();
                          }
                        }
                      } catch (checkErr) {
                        console.warn('[PanoramaSRE] Failed to check post-upgrade reboot status:', checkErr);
                      }
                    }
                  },
                  onError: (err) => {
                    failTerminalJob(jobId, `Execution failed: ${err}`);
                  },
                });
              }}
            />
          )}

          {activeTab === 'releases' && (
            <ReleasePipelineView
              apps={apps}
              terminalTabs={terminalTabs}
              onTriggerDeploy={executeAppDeploy}
              onTriggerDeployAll={handleDeployAllApps}
              isDeployingAll={isDeployingAll}
              onHaltDeployments={handleHaltDeployments}
              onTriggerRollback={(app, tag) => {
                const jobId = `rollback-${app.manifest.slug}-${Date.now()}`;
                const newTab: TerminalTab = {
                  id: jobId,
                  title: `Rollback: ${app.manifest.displayName}`,
                  lines: [`[PanoramaSRE] Swapping container to image tag ${tag}...`],
                  isRunning: true,
                  createdAt: new Date().toISOString(),
                };
                setTerminalTabs((prev) => [...prev, newTab]);
                setActiveTerminalTabId(jobId);
                setIsDrawerOpen(true);
                saveTabToDb(newTab);

                runStreamJob({
                  jobId,
                  label: `Rollback: ${app.manifest.displayName}`,
                  command: 'powershell.exe',
                  args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', './deploy-docker.ps1', '-RollbackToTag', tag],
                  workingDir: app.workspacePath,
                  lockType: 'WshRemoteMutation',
                  onLine: (line) => {
                    appendTerminalLine(jobId, line);
                  },
                  onComplete: (exitCode) => {
                    finalizeTerminalJob(jobId, exitCode);
                    syncFullTelemetry(false);
                  },
                  onError: (err) => {
                    failTerminalJob(jobId, `Rollback failed: ${err}`);
                  },
                });
              }}
            />
          )}

          {activeTab === 'backups' && (
            <BackupsRecoveryView
              apps={apps}
              ledger={backupLedger}
              isLoading={isManualSyncing}
              onRefresh={refreshBackupLedger}
              onTriggerFullGfsBackup={handleTriggerFullGfsBackup}
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

          {activeTab === 'settings' && (
            <SettingsView onWorkspaceChanged={() => syncFullTelemetry(true)} />
          )}

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
      </main>
    </div>

    {/* Global SRE Unified Console & Events Panel (Spans full application width, docked at bottom, pushing upper UI up) */}
    <SreEventsConsolePanel
      isOpen={isDrawerOpen}
      onClose={() => setIsDrawerOpen(false)}
      tabs={terminalTabs}
      activeTabId={activeTerminalTabId}
      onSelectTab={setActiveTerminalTabId}
      onCloseTab={handleCloseTab}
      onClearTab={handleClearTab}
      onPurgeAllTabs={handlePurgeAllTabs}
      onAbortJob={handleAbortJob}
      actionFeedback={actionFeedback}
      onClearFeedback={() => setActionFeedback(null)}
      eventsHistory={eventsHistory}
      onClearEvents={() => setEventsHistory([])}
      runningJobsCount={terminalTabs.filter((t) => t.isRunning).length}
      onToggleDrawer={() => setIsDrawerOpen((prev) => !prev)}
    />
  </div>
  );
};

export default App;
