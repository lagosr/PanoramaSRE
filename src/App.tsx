import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, save } from '@tauri-apps/plugin-dialog';
import { runStreamJob } from './lib/process-runner';
import { SidebarRail, NavItem } from './components/layout/SidebarRail';
import { TopLiveSyncBar } from './components/layout/TopLiveSyncBar';
import { ReturnBreadcrumbPill } from './components/layout/ReturnBreadcrumbPill';
import { CommandPaletteModal, CommandPaletteEntry } from './components/layout/CommandPaletteModal';
import { AlertsInboxDrawer, UnifiedAlertItem } from './components/layout/AlertsInboxDrawer';
import {
  SreEventsConsolePanel,
  ConsoleFooterTicker,
  TerminalTab,
  SystemEventItem,
} from './components/layout/SreEventsConsolePanel';
import { CommandCenterView } from './components/hud/CommandCenterView';
import { OttoAgentView, type OttoSubView } from './components/agent/OttoAgentView';
import { LocalDevView } from './components/local-dev/LocalDevView';
import { SettingsView, type SettingsTab } from './components/settings/SettingsView';
import { TopologyStacksView, type TopologyIngressTab } from './components/topology/TopologyStacksView';
import { UnifiNetworkZbfView } from './components/network/UnifiNetworkZbfView';
import type { UnifiZbfPanelTab } from './components/security/UnifiVlanZbfPanel';
import { DietPiHostView, type DietPiSubTab } from './components/dietpi/DietPiHostView';
import type { CronActionRequest } from './components/dietpi/CronManagerPanel';
import { EdgePkiView } from './components/edge/EdgePkiView';
import { ThreatIntelView, type ThreatSubViewTab } from './components/security/ThreatIntelView';
import { classifyFindingSurface } from './lib/threat-utils';
import { WshHardeningView } from './components/security/WshHardeningView';
import { ReleasePipelineView } from './components/releases/ReleasePipelineView';
import { BuildTelemetryView } from './components/telemetry/BuildTelemetryView';
import { computeActionableTelemetryAlerts } from './lib/deployHistoryAnalytics';
import { BackupsRecoveryView } from './components/backups/BackupsRecoveryView';
import { SmokeTestsView } from './components/smoke/SmokeTestsView';
import { OptInComplianceView } from './components/optins/OptInComplianceView';
import { synthesizeTopology, computeTopologyBadges } from './lib/topology-synthesizer';
import { attributeBatchSmokeFailures } from './lib/batchRollback';
import {
  auditFleetCrons,
  computeDietPiBadges,
  mergeLocalManifestRefresh,
  normalizeDiscoveredManifest,
  type RawDiscoveredSuiteApp,
} from './lib/cron-auditor';
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
  McpBridgeStatus,
  SmokeTestRun,
  CloudflareTunnelVersionStatus,
  OptInComplianceSnapshot,
  ParakithOptInRecord,
  NavSectionId,
  WorkStreamSource,
  ConsoleAutoOpenMode,
  ConsoleDockSide,
  ConsoleScopeMode,
  ReturnBreadcrumb,
  NavigateContext,
  getAppOperationalHealth,
  isAppUnhealthy,
  isAppEvaluableForFleetCount,
  isAppDeployCandidate,
  reconcileServiceAppsFromSnapshot,
  BatchPreDeploySnapshot,
  BatchSmokeFailureReport,
  DeployTelemetryRunRecord,
  LocalDockerDiskUsage,
  ThreatIntelSettingsViewDto,
  ThreatAuditRunRow,
  ThreatRunDetailDto,
  ThreatActorRow,
  ThreatAuditProgressEvent,
  CfWafRuleDto,
  CloudflareWafSnapshotDto,
  QuarantinedAccessEmailRow,
  OttoContextSeed,
  OttoL4Invariant,
  OttoLifecycleSnapshot,
  OttoPolicyRow,
  OttoProposalRow,
  OttoSoakSessionRow,
  OttoStatusDto,
  OttoSteadyStateResult,
  OttoTraceRunRow,
} from './lib/types';
import { computeActionableSecuritySummary } from './lib/threat-actionability';
import { inferPageScopeFromJob } from './lib/stream-utils';
import {
  shouldAutoOpenOnJobStart,
  shouldAutoOpenOnJobFinish,
  resolveResponsiveDockLayout,
} from './lib/console-dock-policy';
import { buildSyncAlertEvaluationInput } from './lib/pushover-payload';
import {
  buildSslCertCommand,
  buildCloudflareTunnelCommand,
  buildServiceScriptCommand,
  type ServiceLifecycleAction,
  buildRemoteSshCommand,
  buildCloudflarePagesDeployCommand,
  buildCronSyncCommand,
  resolveSuiteRootFromAppPath,
  ScriptActionExecution,
} from './lib/script-adapters';

const DEFAULT_APPLIANCES = [
  { key: 'ui', name: 'UniFi CloudKey', host: 'ui.panoramadr.com' },
  { key: 'protect', name: 'UniFi Protect UNVR', host: 'protect.panoramadr.com' },
  { key: 'ha', name: 'Home Assistant', host: 'ha.panoramadr.com' },
  { key: 'genmon', name: 'Generator Monitor', host: 'genmon.panoramadr.com' },
];

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavItem>('hud');
  const [settingsNav, setSettingsNav] = useState<{ tab: SettingsTab; nonce: number }>({
    tab: 'general',
    nonce: 0,
  });
  const [apps, setApps] = useState<DiscoveredApp[]>([]);
  const [appliances, setAppliances] = useState<ApplianceStatus[]>([]);
  const [networkPosture, setNetworkPosture] = useState<NetworkPosture>('LAN_DIRECT');
  const [hasResolvedPosture, setHasResolvedPosture] = useState<boolean>(false);
  const [hasCompletedInitialSync, setHasCompletedInitialSync] = useState<boolean>(false);
  const [isInitialSyncing, setIsInitialSyncing] = useState<boolean>(true);
  const [isManualSyncing, setIsManualSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [securityAuditInterval, setSecurityAuditInterval] = useState<string>(() => {
    return localStorage.getItem('panoramasre_security_audit_interval') || '5';
  });
  const [tier1PollInterval, setTier1PollInterval] = useState<string>(() => {
    return localStorage.getItem('panoramasre_tier1_poll_interval') || '15';
  });
  const [lastSecurityAuditTime, setLastSecurityAuditTime] = useState<string | null>(null);
  const [lastHourlyCheckTime, setLastHourlyCheckTime] = useState<string | null>(null);
  const [wshSnapshot, setWshSnapshot] = useState<WshSnapshot | null>(null);
  const [tunnelVersionStatus, setTunnelVersionStatus] = useState<CloudflareTunnelVersionStatus | null>(null);
  const [isCheckingTunnelVersion, setIsCheckingTunnelVersion] = useState<boolean>(false);
  const [backupLedger, setBackupLedger] = useState<BackupLedgerSummary | null>(null);
  const [dismissedBackupIncidentKeys, setDismissedBackupIncidentKeys] = useState<string[]>(() => {
    try {
      const legacy = localStorage.getItem('panorama_sre_dismissed_backup_incident');
      return legacy ? [legacy] : [];
    } catch {
      return [];
    }
  });
  const [dismissedTelemetryAlertIds, setDismissedTelemetryAlertIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('panorama_sre_dismissed_telemetry_alerts');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  });
  const [sslFleet, setSslFleet] = useState<SslFleetSummary | null>(null);
  const [mcpStatus, setMcpStatus] = useState<McpBridgeStatus | null>(null);
  const [smokeRuns, setSmokeRuns] = useState<SmokeTestRun[]>([]);
  const [optInSnapshot, setOptInSnapshot] = useState<OptInComplianceSnapshot | null>(null);
  const [isSyncingOptIns, setIsSyncingOptIns] = useState<boolean>(false);
  const [isSmokeRunning, setIsSmokeRunning] = useState<boolean>(false);
  const [activeSmokeJobId, setActiveSmokeJobId] = useState<string>('');
  const [smokeError, setSmokeError] = useState<string | null>(null);
  const [isLoadingSsl, setIsLoadingSsl] = useState<boolean>(false);
  const [isLoadingWsh, setIsLoadingWsh] = useState<boolean>(false);
  const [dietpiSubTab, setDietpiSubTab] = useState<DietPiSubTab>('host');
  const [topologyNav, setTopologyNav] = useState<{ tab: TopologyIngressTab; nonce: number }>({
    tab: 'visual',
    nonce: 0,
  });
  const [unifiNav, setUnifiNav] = useState<{
    tab: UnifiZbfPanelTab;
    search?: string;
    nonce: number;
  }>({
    tab: 'flow',
    search: '',
    nonce: 0,
  });
  const [threatNav, setThreatNav] = useState<{
    tab: ThreatSubViewTab;
    focusId?: string;
    nonce: number;
  }>({
    tab: 'overview',
    focusId: undefined,
    nonce: 0,
  });
  const [isCronActionBusy, setIsCronActionBusy] = useState<boolean>(false);
  // Terminal Dock & Phase 1 Navigation / Console State
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [activeTerminalTabId, setActiveTerminalTabId] = useState<string>('');
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('panoramasre_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [sidebarAutoCollapsed, setSidebarAutoCollapsed] = useState<boolean>(false);
  const [dockSide, setDockSide] = useState<ConsoleDockSide>(() => {
    try {
      return localStorage.getItem('panoramasre_console_dock_side') === 'right' ? 'right' : 'bottom';
    } catch {
      return 'bottom';
    }
  });
  const [dockHeight, setDockHeight] = useState<number>(() => {
    try {
      const parsed = Number(localStorage.getItem('panoramasre_console_dock_height'));
      return Number.isFinite(parsed) && parsed >= 180 && parsed <= 700 ? parsed : 320;
    } catch {
      return 320;
    }
  });
  const [dockWidth, setDockWidth] = useState<number>(() => {
    try {
      const parsed = Number(localStorage.getItem('panoramasre_console_dock_width'));
      return Number.isFinite(parsed) && parsed >= 320 && parsed <= 820 ? parsed : 500;
    } catch {
      return 500;
    }
  });
  const [autoOpenMode, setAutoOpenMode] = useState<ConsoleAutoOpenMode>(() => {
    try {
      const saved = localStorage.getItem('panoramasre_console_auto_open');
      return saved === 'errors' || saved === 'manual' ? saved : 'smart';
    } catch {
      return 'smart';
    }
  });
  const [scopeMode, setScopeMode] = useState<ConsoleScopeMode>(() => {
    try {
      return localStorage.getItem('panoramasre_console_scope_mode') === 'all' ? 'all' : 'page';
    } catch {
      return 'page';
    }
  });
  const [unreadFailureTabId, setUnreadFailureTabId] = useState<string | null>(null);
  const [isPaletteOpen, setIsPaletteOpen] = useState<boolean>(false);
  const [isAlertsDrawerOpen, setIsAlertsDrawerOpen] = useState<boolean>(false);
  const [returnTo, setReturnTo] = useState<ReturnBreadcrumb | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1600
  );
  const dismissedJobIdsRef = useRef<Set<string>>(new Set());
  const mainScrollContainerRef = useRef<HTMLDivElement>(null);
  const isDrawerOpenRef = useRef<boolean>(false);
  isDrawerOpenRef.current = isDrawerOpen;
  const autoOpenModeRef = useRef<ConsoleAutoOpenMode>('smart');
  autoOpenModeRef.current = autoOpenMode;
  const activeTerminalTabIdRef = useRef<string>('');
  activeTerminalTabIdRef.current = activeTerminalTabId;
  const terminalTabsRef = useRef<TerminalTab[]>([]);
  terminalTabsRef.current = terminalTabs;
  const [isDeployingAll, setIsDeployingAll] = useState<boolean>(false);
  const [isHostRebooting, setIsHostRebooting] = useState<boolean>(false);
  const [selectedReleaseAppSlug, setSelectedReleaseAppSlug] = useState<string>('');
  const [trackedDeployJobIds, setTrackedDeployJobIds] = useState<Record<string, string>>({});
  const [deployTelemetryRuns, setDeployTelemetryRuns] = useState<DeployTelemetryRunRecord[]>([]);
  const [dockerDiskUsage, setDockerDiskUsage] = useState<LocalDockerDiskUsage | null>(null);
  const [selectedTelemetryAppSlug, setSelectedTelemetryAppSlug] = useState<string>('all');
  const [isRefreshingTelemetry, setIsRefreshingTelemetry] = useState<boolean>(false);
  const [isPruningBuildKitCache, setIsPruningBuildKitCache] = useState<boolean>(false);
  const [batchSmokeFailureReport, setBatchSmokeFailureReport] =
    useState<BatchSmokeFailureReport | null>(null);
  const [threatSettings, setThreatSettings] = useState<ThreatIntelSettingsViewDto | null>(null);
  const [threatRuns, setThreatRuns] = useState<ThreatAuditRunRow[]>([]);
  const [selectedThreatDetail, setSelectedThreatDetail] = useState<ThreatRunDetailDto | null>(null);
  const [latestThreatDetail, setLatestThreatDetail] = useState<ThreatRunDetailDto | null>(null);
  const [activeThreatActors, setActiveThreatActors] = useState<ThreatActorRow[]>([]);
  const [threatWafRules, setThreatWafRules] = useState<CfWafRuleDto[]>([]);
  const [quarantinedAccessEmails, setQuarantinedAccessEmails] = useState<QuarantinedAccessEmailRow[]>([]);
  // Otto — Autonomous AI Agent SRE state
  const [ottoStatus, setOttoStatus] = useState<OttoStatusDto | null>(null);
  const [ottoPolicies, setOttoPolicies] = useState<OttoPolicyRow[]>([]);
  const [ottoL4Invariants, setOttoL4Invariants] = useState<OttoL4Invariant[]>([]);
  const [ottoTraces, setOttoTraces] = useState<OttoTraceRunRow[]>([]);
  const [ottoProposals, setOttoProposals] = useState<OttoProposalRow[]>([]);
  const [ottoSoaks, setOttoSoaks] = useState<OttoSoakSessionRow[]>([]);
  const ottoSoaksRef = useRef<OttoSoakSessionRow[]>([]);
  ottoSoaksRef.current = ottoSoaks;
  const dockerDiskUsageRef = useRef<LocalDockerDiskUsage | null>(null);
  dockerDiskUsageRef.current = dockerDiskUsage;
  const sslFleetRef = useRef<SslFleetSummary | null>(null);
  sslFleetRef.current = sslFleet;
  const networkPostureRef = useRef<NetworkPosture>('LAN_DIRECT');
  networkPostureRef.current = networkPosture;
  const hasCompletedInitialSyncRef = useRef<boolean>(false);
  hasCompletedInitialSyncRef.current = hasCompletedInitialSync;
  const [ottoNav, setOttoNav] = useState<{ tab: OttoSubView; nonce: number }>({
    tab: 'ask',
    nonce: 0,
  });
  const [ottoPendingSeed, setOttoPendingSeed] = useState<{
    seed: OttoContextSeed | null;
    nonce: number;
  }>({ seed: null, nonce: 0 });
  const [ottoInspectTrace, setOttoInspectTrace] = useState<{
    id: string | null;
    nonce: number;
  }>({ id: null, nonce: 0 });
  const [isRunningThreatAudit, setIsRunningThreatAudit] = useState<boolean>(false);
  const [threatAuditProgress, setThreatAuditProgress] = useState<{
    runId: string;
    stage: string;
    label: string;
    message: string;
    level: string;
    startedAtMs: number;
  } | null>(null);
  const activeThreatAuditTabIdRef = useRef<string | null>(null);
  const threatAuditLazyTabCreatedRef = useRef<boolean>(false);
  const haltDeploymentsRef = useRef<boolean>(false);
  const currentRunningDeployJobIdRef = useRef<string | null>(null);
  const lastOptInSyncMsRef = useRef<number>(0);
  const parakithAppRef = useRef<DiscoveredApp | null>(null);

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
            page_scope?: string | null;
            source?: string | null;
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
            pageScope: inferPageScopeFromJob(s.id, s.page_scope, s.title),
            source: (s.source as WorkStreamSource) || 'ui',
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
    (tab: {
      id: string;
      title: string;
      lines: string[];
      isRunning: boolean;
      exitCode?: number;
      pageScope?: NavSectionId;
      source?: WorkStreamSource;
    }) => {
      invoke('save_console_session', {
        id: tab.id,
        title: tab.title,
        lines: tab.lines,
        isRunning: tab.isRunning,
        exitCode: tab.exitCode ?? null,
        pageScope: tab.pageScope ?? inferPageScopeFromJob(tab.id, undefined, tab.title),
        source: tab.source ?? 'ui',
      }).catch((e) => console.warn('Failed to save console session to DB:', e));
    },
    []
  );

  const handleOpenInBottomConsole = useCallback((tabId?: string) => {
    if (tabId) {
      setActiveTerminalTabId(tabId);
    }
    setUnreadFailureTabId(null);
    setIsDrawerOpen(true);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    // Remember Manual-Dismiss across active running jobs, unread failures, and batch groups
    const activeTabObj = terminalTabsRef.current.find(
      (t) => t.id === activeTerminalTabIdRef.current
    );
    if (activeTabObj && (activeTabObj.isRunning || (activeTabObj.exitCode !== undefined && activeTabObj.exitCode !== 0 && activeTabObj.exitCode !== 130))) {
      dismissedJobIdsRef.current.add(activeTabObj.id);
      if (activeTabObj.batchGroupId) {
        dismissedJobIdsRef.current.add(activeTabObj.batchGroupId);
      }
    }
    for (const tab of terminalTabsRef.current) {
      if (tab.isRunning) {
        dismissedJobIdsRef.current.add(tab.id);
        if (tab.batchGroupId) {
          dismissedJobIdsRef.current.add(tab.batchGroupId);
        }
      }
    }
    setUnreadFailureTabId(null);
    setIsDrawerOpen(false);
  }, []);

  const isJobOrBatchDismissed = useCallback((jobId: string, batchGroupId?: string | null) => {
    if (dismissedJobIdsRef.current.has(jobId)) return true;
    if (batchGroupId && dismissedJobIdsRef.current.has(batchGroupId)) return true;
    return false;
  }, []);

  const evaluateJobFinishAutoOpen = useCallback(
    (jobId: string, exitCode: number) => {
      if (exitCode === 0 || exitCode === 130) return;
      const targetTab = terminalTabsRef.current.find((t) => t.id === jobId);
      const suppressed = isJobOrBatchDismissed(jobId, targetTab?.batchGroupId);
      const shouldOpen =
        !isDrawerOpenRef.current &&
        !suppressed &&
        shouldAutoOpenOnJobFinish({
          exitCode,
          source: targetTab?.source ?? 'ui',
          mode: autoOpenModeRef.current,
          isAborted: exitCode === 130,
        });
      if (shouldOpen) {
        setActiveTerminalTabId(jobId);
        setUnreadFailureTabId(null);
        setIsDrawerOpen(true);
      } else if (!isDrawerOpenRef.current) {
        setUnreadFailureTabId(jobId);
      }
    },
    [isJobOrBatchDismissed]
  );

  const registerStreamTab = useCallback(
    (
      newTab: TerminalTab,
      opts?: { focusTab?: boolean; upsert?: boolean; persist?: boolean }
    ) => {
      setTerminalTabs((prev) => {
        if (opts?.upsert) {
          const existingIdx = prev.findIndex((t) => t.id === newTab.id);
          if (existingIdx !== -1) {
            const next = [...prev];
            next[existingIdx] = {
              ...next[existingIdx],
              ...newTab,
              lines: next[existingIdx].lines,
            };
            return next;
          }
        }
        return [...prev, newTab];
      });
      if (opts?.focusTab !== false) {
        setActiveTerminalTabId(newTab.id);
      }
      if (opts?.persist !== false) {
        saveTabToDb(newTab);
      }
      const autoOpen =
        !isDrawerOpenRef.current &&
        shouldAutoOpenOnJobStart({
          tier: newTab.autoOpenTier ?? 'B',
          source: newTab.source ?? 'ui',
          mode: autoOpenModeRef.current,
          jobId: newTab.id,
          batchGroupId: newTab.batchGroupId,
          dismissedIds: dismissedJobIdsRef.current,
        });
      if (autoOpen) {
        setActiveTerminalTabId(newTab.id);
        setUnreadFailureTabId(null);
        setIsDrawerOpen(true);
      }
    },
    [saveTabToDb]
  );

  const navigateTo = useCallback(
    (view: NavItem, ctx?: NavigateContext) => {
      const labels: Record<NavItem, string> = {
        hud: 'Command HUD',
        agent: 'Otto AI SRE',
        releases: 'Releases & Drift',
        telemetry: 'Build Telemetry',
        smoke: 'Smoke Tests',
        security: 'Threat & Zero Trust',
        hardening: 'WSH Hardening',
        edge: 'PKI & Certificates',
        'opt-ins': 'SMS Opt-Ins (10DLC)',
        topology: 'Topology & Ingress',
        'unifi-zbf': 'UniFi Network & ZBF',
        dietpi: 'DietPi Host & Crons',
        backups: 'Backups & DR',
        'local-dev': 'Local Dev',
        settings: 'Settings & Logs',
      };
      if (ctx?.returnFromCurrent) {
        setReturnTo({ view: activeTab, label: labels[activeTab] });
      } else if (!ctx?.preserveReturn) {
        setReturnTo(null);
      }
      if (ctx?.appSlug !== undefined && view === 'releases') {
        setSelectedReleaseAppSlug(ctx.appSlug);
      }
      if (ctx?.appSlug !== undefined && view === 'telemetry') {
        setSelectedTelemetryAppSlug(ctx.appSlug || 'all');
      }
      if (
        ctx?.tab !== undefined &&
        view === 'dietpi' &&
        (ctx.tab === 'host' || ctx.tab === 'interfaces' || ctx.tab === 'crons')
      ) {
        setDietpiSubTab(ctx.tab);
      }
      if (
        ctx?.tab !== undefined &&
        view === 'topology' &&
        (ctx.tab === 'visual' || ctx.tab === 'matrix' || ctx.tab === 'tunnel')
      ) {
        setTopologyNav((prev) => ({
          tab: ctx.tab as TopologyIngressTab,
          nonce: prev.nonce + 1,
        }));
      }
      if (view === 'unifi-zbf' && (ctx?.tab !== undefined || ctx?.highlightId !== undefined)) {
        setUnifiNav((prev) => ({
          tab:
            ctx?.tab === 'flow' ||
            ctx?.tab === 'matrix' ||
            ctx?.tab === 'vlans' ||
            ctx?.tab === 'rules' ||
            ctx?.tab === 'baseline'
              ? ctx.tab
              : prev.tab,
          search: ctx?.highlightId ?? '',
          nonce: prev.nonce + 1,
        }));
      }
      if (
        ctx?.tab !== undefined &&
        view === 'agent' &&
        (ctx.tab === 'ask' ||
          ctx.tab === 'traces' ||
          ctx.tab === 'approvals' ||
          ctx.tab === 'policies')
      ) {
        setOttoNav((prev) => ({
          tab: ctx.tab as OttoSubView,
          nonce: prev.nonce + 1,
        }));
      }
      if (ctx?.tab !== undefined && view === 'settings') {
        setSettingsNav((prev) => ({
          tab: ctx.tab as SettingsTab,
          nonce: prev.nonce + 1,
        }));
      } else if (view === 'settings' && activeTab !== 'settings') {
        setSettingsNav((prev) => ({ tab: 'general', nonce: prev.nonce + 1 }));
      }
      if (view === 'security' && (ctx?.tab !== undefined || ctx?.highlightId !== undefined)) {
        const nextTab: ThreatSubViewTab =
          ctx?.tab === 'overview' ||
          ctx?.tab === 'external' ||
          ctx?.tab === 'internal' ||
          ctx?.tab === 'allowlist'
            ? ctx.tab
            : 'overview';
        setThreatNav((prev) => ({
          tab: nextTab,
          focusId: ctx?.highlightId,
          nonce: prev.nonce + 1,
        }));
      } else if (view === 'security') {
        setThreatNav((prev) => ({
          tab: 'overview',
          focusId: undefined,
          nonce: prev.nonce + 1,
        }));
      }
      setActiveTab(view);
    },
    [activeTab]
  );

  useEffect(() => {
    if (mainScrollContainerRef.current) {
      mainScrollContainerRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  // Persist dock & sidebar user preferences
  useEffect(() => {
    try {
      localStorage.setItem('panoramasre_sidebar_collapsed', String(sidebarCollapsed));
    } catch {
      // ignore storage errors
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem('panoramasre_console_dock_side', dockSide);
    } catch {
      // ignore storage errors
    }
  }, [dockSide]);

  useEffect(() => {
    try {
      localStorage.setItem('panoramasre_console_dock_height', String(dockHeight));
    } catch {
      // ignore storage errors
    }
  }, [dockHeight]);

  useEffect(() => {
    try {
      localStorage.setItem('panoramasre_console_dock_width', String(dockWidth));
    } catch {
      // ignore storage errors
    }
  }, [dockWidth]);

  useEffect(() => {
    try {
      localStorage.setItem('panoramasre_console_auto_open', autoOpenMode);
    } catch {
      // ignore storage errors
    }
  }, [autoOpenMode]);

  useEffect(() => {
    try {
      localStorage.setItem('panoramasre_console_scope_mode', scopeMode);
    } catch {
      // ignore storage errors
    }
  }, [scopeMode]);

  // Track viewport width for responsive Right-dock & sidebar auto-collapse rules
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const responsiveDockLayout = useMemo(
    () =>
      resolveResponsiveDockLayout({
        viewportWidth,
        dockOpen: isDrawerOpen,
        dockSide,
        sidebarCollapsed,
        sidebarAutoCollapsed,
      }),
    [viewportWidth, isDrawerOpen, dockSide, sidebarCollapsed, sidebarAutoCollapsed]
  );

  useEffect(() => {
    if (responsiveDockLayout.nextSidebarCollapsed !== sidebarCollapsed) {
      setSidebarCollapsed(responsiveDockLayout.nextSidebarCollapsed);
    }
    if (responsiveDockLayout.nextSidebarAutoCollapsed !== sidebarAutoCollapsed) {
      setSidebarAutoCollapsed(responsiveDockLayout.nextSidebarAutoCollapsed);
    }
  }, [responsiveDockLayout, sidebarCollapsed, sidebarAutoCollapsed]);

  // Global keyboard shortcuts: Ctrl+K (Command Palette) & Ctrl+` (Toggle Output Console)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsPaletteOpen((prev) => !prev);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '`' || e.code === 'Backquote')) {
        e.preventDefault();
        if (isDrawerOpenRef.current) {
          handleCloseDrawer();
        } else {
          setUnreadFailureTabId(null);
          setIsDrawerOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleCloseDrawer]);

  // Keep refs to current apps, snapshot, and smoke history loader for async callbacks
  const appsRef = useRef<DiscoveredApp[]>([]);
  appsRef.current = apps;
  const wshSnapshotRef = useRef<WshSnapshot | null>(null);
  wshSnapshotRef.current = wshSnapshot;
  const maintenanceSuppressedRef = useRef<boolean>(false);
  maintenanceSuppressedRef.current =
    isHostRebooting || isDeployingAll || currentRunningDeployJobIdRef.current !== null;
  const dismissedBackupKeysRef = useRef<string[]>(dismissedBackupIncidentKeys);
  dismissedBackupKeysRef.current = dismissedBackupIncidentKeys;
  const refreshSmokeHistoryRef = useRef<(() => Promise<SmokeTestRun[]>) | null>(null);
  const refreshDeployTelemetryRef = useRef<(() => Promise<void>) | null>(null);

  // Hydrate global dismissed backup incident keys from sre.sqlite (and migrate any legacy localStorage key)
  const hydrateDismissedBackupIncidents = useCallback(async () => {
    try {
      const dbKeys = await invoke<string[]>('get_dismissed_backup_incidents');
      let merged = Array.isArray(dbKeys) ? [...dbKeys] : [];
      const legacy = localStorage.getItem('panorama_sre_dismissed_backup_incident');
      if (legacy && !merged.includes(legacy)) {
        merged = await invoke<string[]>('dismiss_backup_incident', { incidentKey: legacy });
      }
      dismissedBackupKeysRef.current = merged;
      setDismissedBackupIncidentKeys(merged);
    } catch (err) {
      console.warn('Failed to load dismissed backup incidents from SQLite:', err);
    }
  }, []);

  const computeBackupIncidentKey = useCallback((ledger: BackupLedgerSummary | null | undefined) => {
    if (!ledger) return { rawFailures: 0, incidentKey: null as string | null, isDismissed: false };
    const isLatestFailed = ledger.last_run_status?.toLowerCase() === 'failed';
    const rawFailures = isLatestFailed
      ? ledger.latest_app_details.filter((a) => a.status.toLowerCase() === 'failed').length || 1
      : ledger.failed_runs_7d || 0;
    const failedDates = (ledger.daily_pips_7d || [])
      .filter((p) => p.status !== 'Success')
      .map((p) => p.date)
      .join(',');
    const incidentKey =
      rawFailures > 0
        ? isLatestFailed
          ? `failed:${ledger.last_run_timestamp || 'unknown'}|${failedDates}`
          : failedDates
          ? `missed:${failedDates}`
          : `missed:7d:${ledger.failed_runs_7d || 0}`
        : null;
    return {
      rawFailures,
      incidentKey,
      isDismissed: Boolean(incidentKey && dismissedBackupKeysRef.current.includes(incidentKey)),
    };
  }, []);

  // Refresh Dev Server process states (lightweight TCP / PID check)
  const refreshDevServers = useCallback(async () => {
    const currentApps = appsRef.current;
    if (currentApps.length === 0) return;
    try {
      const appsPayload = currentApps
        .filter(
          (a) =>
            a.manifest.hostingTarget !== 'wsh-docker-service' &&
            Boolean(a.manifest.sre.devCommand?.trim())
        )
        .map((a) => ({
          appId: a.manifest.appId,
          port: a.manifest.port,
          basePath: a.manifest.basePath,
          workspacePath: a.workspacePath,
          localSqlitePath: a.manifest.localSqlitePath,
        }));
      if (appsPayload.length === 0) return;
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
  const refreshAppliances = useCallback(async (evaluateAlerts = true): Promise<ApplianceStatus[]> => {
    try {
      const applianceTuples = DEFAULT_APPLIANCES.map((a) => [a.key, a.name, a.host]);
      const applianceResults = await invoke<ApplianceStatus[]>('probe_appliances', {
        appliances: applianceTuples,
        timeoutMs: 2500,
      });
      setAppliances(applianceResults);
      if (evaluateAlerts && applianceResults.length > 0) {
        const input = buildSyncAlertEvaluationInput({
          maintenanceSuppressed: maintenanceSuppressedRef.current,
          appliances: applianceResults,
        });
        void invoke('evaluate_and_notify_sync', { input }).catch(() => {});
      }
      return applianceResults;
    } catch {
      // Ignore background appliance probe errors
      return [];
    }
  }, []);

  // Refresh WSH Snapshot & Posture
  const refreshWshTelemetry = useCallback(async (force = false) => {
    setIsLoadingWsh(true);
    try {
      const posture = await invoke<NetworkPosture>('detect_network_posture', {});
      setNetworkPosture(posture);
      setHasResolvedPosture(true);

      if (posture === 'LAN_DIRECT') {
        const snap = await invoke<WshSnapshot>('fetch_wsh_snapshot', {
          mode: '--fast',
          force,
        });
        setWshSnapshot(snap);
        setApps((prev) => reconcileServiceAppsFromSnapshot(prev, snap));
        setLastSecurityAuditTime(new Date().toLocaleTimeString());
      }
    } catch {
      // Ignore background WSH snapshot errors
    } finally {
      setIsLoadingWsh(false);
    }
  }, []);

  // Refresh local panorama.app.json manifests & LF-normalized cron script SHA-256 hashes (no SSH/HTTP)
  const refreshLocalManifests = useCallback(async (): Promise<number> => {
    try {
      const rawDiscovered = await invoke<RawDiscoveredSuiteApp[]>('discover_suite_apps', {});
      if (rawDiscovered.length > 0) {
        setApps((prev) => mergeLocalManifestRefresh(prev, rawDiscovered));
      }
      return rawDiscovered.length;
    } catch (err) {
      console.warn('[PanoramaSRE] Local manifest refresh warning:', err);
      return 0;
    }
  }, []);

  // Refresh Backup Ledger
  const refreshBackupLedger = useCallback(async (): Promise<BackupLedgerSummary | null> => {
    try {
      const ledger = await invoke<BackupLedgerSummary>('read_backup_ledger', {});
      setBackupLedger(ledger);
      return ledger;
    } catch (ledgerErr) {
      console.warn('[PanoramaSRE] Backup ledger warning:', ledgerErr);
      return null;
    }
  }, []);

  // Refresh 5-Domain SSL Dual-Probe & Drift Status
  const refreshSslStatus = useCallback(async (): Promise<SslFleetSummary | null> => {
    setIsLoadingSsl(true);
    try {
      const summary = await invoke<SslFleetSummary>('get_ssl_fleet_status', {});
      setSslFleet(summary);
      return summary;
    } catch (sslErr) {
      console.warn('[PanoramaSRE] SSL fleet probe warning:', sslErr);
      return null;
    } finally {
      setIsLoadingSsl(false);
    }
  }, []);

  // Refresh Agent MCP Bridge Status
  const refreshMcpStatus = useCallback(async () => {
    try {
      const status = await invoke<McpBridgeStatus>('get_mcp_bridge_status');
      setMcpStatus(status);
    } catch {
      // Ignore background MCP status polling errors
    }
  }, []);

  // Load cached Parakith D1 SMS Opt-In records from local SQLite
  const loadCachedOptIns = useCallback(async (databaseName?: string) => {
    try {
      const snapshot = await invoke<OptInComplianceSnapshot>('get_cached_parakith_opt_ins', {
        databaseName: databaseName ?? null,
      });
      setOptInSnapshot(snapshot);
      return snapshot;
    } catch (err) {
      console.warn('[PanoramaSRE] Failed loading cached Parakith opt-ins:', err);
      return null;
    }
  }, []);

  // Synchronize Parakith D1 SMS Opt-In records via Wrangler CLI
  const refreshOptIns = useCallback(
    async (workspacePath?: string, databaseName?: string, notifyOnNew = true) => {
      const targetApp = parakithAppRef.current;
      const resolvedWorkspace = workspacePath || targetApp?.workspacePath;
      const resolvedDatabase =
        databaseName || targetApp?.manifest.cloudflare?.d1DatabaseName || 'parakith-opt-ins';
      if (!resolvedWorkspace) {
        return null;
      }
      setIsSyncingOptIns(true);
      try {
        const snapshot = await invoke<OptInComplianceSnapshot>('sync_parakith_opt_ins', {
          workspacePath: resolvedWorkspace,
          databaseName: resolvedDatabase,
          notifyOnNew,
        });
        setOptInSnapshot(snapshot);
        lastOptInSyncMsRef.current = Date.now();
        return snapshot;
      } catch (err) {
        console.warn('[PanoramaSRE] Parakith D1 opt-in sync warning:', err);
        await loadCachedOptIns(resolvedDatabase);
        return null;
      } finally {
        setIsSyncingOptIns(false);
      }
    },
    [loadCachedOptIns]
  );

  // Refresh Upstream Cloudflare Tunnel Release Status (non-SSH, ETag cached)
  const refreshTunnelVersion = useCallback(
    async (force = false, explicitRunningRaw?: string): Promise<CloudflareTunnelVersionStatus | null> => {
      setIsCheckingTunnelVersion(true);
      try {
        const runningRaw =
          explicitRunningRaw ?? wshSnapshotRef.current?.cloudflared?.version_raw ?? undefined;
        const status = await invoke<CloudflareTunnelVersionStatus>(
          'check_cloudflare_tunnel_version',
          {
            runningVersionRaw: runningRaw ?? null,
            force,
          }
        );
        setTunnelVersionStatus(status);
        setLastHourlyCheckTime(new Date().toLocaleTimeString());
        return status;
      } catch (cfErr) {
        console.warn('[PanoramaSRE] Cloudflare tunnel version check warning:', cfErr);
        return null;
      } finally {
        setIsCheckingTunnelVersion(false);
      }
    },
    []
  );

  // Execute Tier 4 hourly checks (Cloudflare Tunnel release, SSL matrix, GFS backup ledger)
  const runHourlyChecksNow = useCallback(
    async (force = false, explicitRunningRaw?: string) => {
      const [tunnelRes, sslRes, ledgerRes] = await Promise.all([
        refreshTunnelVersion(force, explicitRunningRaw),
        refreshSslStatus(),
        refreshBackupLedger(),
      ]);
      setLastHourlyCheckTime(new Date().toLocaleTimeString());

      const { incidentKey, isDismissed } = computeBackupIncidentKey(ledgerRes);
      const input = buildSyncAlertEvaluationInput({
        maintenanceSuppressed: maintenanceSuppressedRef.current,
        tunnelVersion: tunnelRes,
        sslFleet: sslRes,
        backupLedger: ledgerRes,
        backupIncidentKey: incidentKey,
        isBackupIncidentDismissed: isDismissed,
      });
      void invoke('evaluate_and_notify_sync', { input }).catch(() => {});
    },
    [computeBackupIncidentKey, refreshTunnelVersion, refreshSslStatus, refreshBackupLedger]
  );

  // Full Initial App Discovery & Telemetry Probe
  const syncFullTelemetry = useCallback(async (
    isUserInitiated = false,
    includeWshSnapshot = true,
    traceScope: NavSectionId = 'hud',
    includeHourlyTiers = false
  ) => {
    const syncJobId = isUserInitiated ? `${traceScope}-sync-${Date.now()}` : null;
    if (isUserInitiated && syncJobId) {
      setIsManualSyncing(true);
      const traceTitle =
        traceScope === 'settings'
          ? 'Workspace Discovery & Telemetry Sync'
          : 'Full Suite Telemetry Sync';
      const initialTab: TerminalTab = {
        id: syncJobId,
        title: traceTitle,
        lines: [
          `[PanoramaSRE] Starting manual telemetry synchronization (${traceScope})...`,
          '[INFO] Probing network posture and discovering PanoramaDrSuite manifests...',
        ],
        isRunning: true,
        createdAt: new Date().toISOString(),
        pageScope: traceScope,
        source: 'ui',
        abortable: false,
        autoOpenTier: 'B',
      };
      registerStreamTab(initialTab, { focusTab: false });
    }

    const pushSyncTrace = (line: string) => {
      if (!syncJobId) return;
      setTerminalTabs((prev) =>
        prev.map((t) => (t.id === syncJobId ? { ...t, lines: [...t.lines, line] } : t))
      );
    };

    try {
      // 1. Posture check
      const posture = await invoke<NetworkPosture>('detect_network_posture', {});
      setNetworkPosture(posture);
      setHasResolvedPosture(true);
      pushSyncTrace(`[INFO] Network posture resolved: ${posture}`);

      // 2. Discover apps via panorama.app.json
      const rawDiscovered = await invoke<RawDiscoveredSuiteApp[]>('discover_suite_apps', {});

      // 3. For each discovered app, probe /api/health and compute git provenance
      const enrichedApps: DiscoveredApp[] = await Promise.all(
        rawDiscovered.map(async (item) => {
          const appManifest = normalizeDiscoveredManifest(item.manifest);
          const hostingTarget = appManifest.hostingTarget || 'wsh-docker';

          // Probe /api/health (skip for non-HTTP WSH container services; reconcile from WSH snapshot instead)
          let probedHealth: AppHealth | undefined;
          let latencyMs = 0;
          if (hostingTarget !== 'wsh-docker-service') {
            try {
              const healthUrl =
                hostingTarget === 'cloudflare-pages'
                  ? `${(appManifest.cloudflare?.primaryUrl || 'https://www.parakith.com').replace(/\/+$/, '')}${appManifest.sre.healthEndpoint || '/api/health'}`
                  : `https://wsh.panoramadr.com${appManifest.basePath}/api/health`;
              const res = await invoke<{
                status: string;
                latency_ms: number;
                health: AppHealth | null;
              }>('probe_app_health', {
                appId: appManifest.appId,
                url: healthUrl,
                timeoutMs: 4000,
                authMode: appManifest.sre.healthAuthMode ?? null,
                workspacePath: item.workspace_path,
              });
              latencyMs = res.latency_ms;
              if (res.health) {
                probedHealth = res.health;
              }
            } catch {
              // Health probe fallback
            }
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

      // 4. Query Dev Servers Status (web/edge apps only)
      try {
        const appsPayload = enrichedApps
          .filter(
            (a) =>
              a.manifest.hostingTarget !== 'wsh-docker-service' &&
              Boolean(a.manifest.sre.devCommand?.trim())
          )
          .map((a) => ({
            appId: a.manifest.appId,
            port: a.manifest.port,
            basePath: a.manifest.basePath,
            workspacePath: a.workspacePath,
            localSqlitePath: a.manifest.localSqlitePath,
          }));
        if (appsPayload.length > 0) {
          const devStatuses = await invoke<DevServerInfo[]>('get_dev_servers_status', {
            apps: appsPayload,
          });

          // Merge dev server status into apps
          for (const app of enrichedApps) {
            app.devServer = devStatuses.find((d) => d.app_id === app.manifest.appId);
          }
        }
      } catch (err) {
        console.error('[PanoramaSRE] Dev servers probe error:', err);
      }

      const preSnapApps = reconcileServiceAppsFromSnapshot(enrichedApps, wshSnapshotRef.current);
      setApps(preSnapApps);
      const discoveredParakith =
        enrichedApps.find(
          (a) => a.manifest.hostingTarget === 'cloudflare-pages' && a.manifest.cloudflare?.d1DatabaseName
        ) ||
        enrichedApps.find((a) => a.manifest.slug === 'parakith') ||
        null;
      parakithAppRef.current = discoveredParakith;
      if (discoveredParakith && (lastOptInSyncMsRef.current === 0 || isUserInitiated)) {
        refreshOptIns(
          discoveredParakith.workspacePath,
          discoveredParakith.manifest.cloudflare?.d1DatabaseName || 'parakith-opt-ins',
          !isUserInitiated
        );
      }

      const healthyCount = enrichedApps.filter((a) => a.health?.status === 'healthy').length;
      pushSyncTrace(
        `[INFO] Discovered ${enrichedApps.length} suite apps (${healthyCount}/${enrichedApps.length} production healthy).`
      );

      // 5. Fetch WSH Host & Topology Snapshot (LAN Direct only)
      let latestSnap: WshSnapshot | null = wshSnapshotRef.current;
      let capturedRunningRaw: string | undefined =
        wshSnapshotRef.current?.cloudflared?.version_raw;
      if (includeWshSnapshot && posture === 'LAN_DIRECT') {
        setIsLoadingWsh(true);
        try {
          const snap = await invoke<WshSnapshot>('fetch_wsh_snapshot', {
            mode: '--fast',
            force: isUserInitiated,
          });
          setWshSnapshot(snap);
          latestSnap = snap;
          capturedRunningRaw = snap.cloudflared?.version_raw;
          setLastSecurityAuditTime(new Date().toLocaleTimeString());
          pushSyncTrace('[INFO] WSH host firewall, Docker, and CGNAT snapshot updated.');
        } catch (snapErr) {
          console.warn('[PanoramaSRE] WSH snapshot warning:', snapErr);
          pushSyncTrace(`[WARN] WSH snapshot partial warning: ${snapErr}`);
        } finally {
          setIsLoadingWsh(false);
        }
      }

      // Reconcile container-backed health for WSH services against latest snapshot
      const reconciledApps = reconcileServiceAppsFromSnapshot(preSnapApps, latestSnap);
      setApps(reconciledApps);

      // Phase 2: If any Otto 15m Post-Deploy Soak is active, feed fresh health observations
      if (ottoSoaksRef.current.some((s) => s.status === 'SOAKING')) {
        const soakObservations = reconciledApps.map((a) => ({
          appSlug: a.manifest.slug,
          hostingTarget: a.manifest.hostingTarget || 'wsh-docker',
          healthy: a.health?.status === 'healthy',
          latencyMs: a.latencyMs ?? null,
          containerState: a.health?.status ?? null,
          detail: a.health?.status === 'healthy' ? 'healthy' : a.health?.status || 'unreachable',
        }));
        void invoke<OttoSoakSessionRow[]>('evaluate_otto_soak_tick', {
          input: { observations: soakObservations },
        })
          .then((nextSoaks) => {
            if (Array.isArray(nextSoaks)) {
              setOttoSoaks(nextSoaks);
            }
          })
          .catch((e) => console.warn('[PanoramaSRE] Otto soak tick warning:', e));
      }

      // 6. On initial startup or manual Sync Now, also execute Tier 2 appliances + Tier 4 hourly checks
      let hourlyAppliances: ApplianceStatus[] | undefined;
      let hourlyLedger: BackupLedgerSummary | null = null;
      let hourlySsl: SslFleetSummary | null = null;
      let hourlyTunnel: CloudflareTunnelVersionStatus | null = null;
      if (includeHourlyTiers) {
        const [applRes, ledgerRes, sslRes, tunnelRes] = await Promise.all([
          refreshAppliances(false),
          refreshBackupLedger(),
          refreshSslStatus(),
          refreshTunnelVersion(isUserInitiated, capturedRunningRaw),
        ]);
        hourlyAppliances = applRes;
        hourlyLedger = ledgerRes;
        hourlySsl = sslRes;
        hourlyTunnel = tunnelRes;
      } else {
        // Refresh local GFS backup ledger & run-state watchdog on every Tier 3 tick (zero network/SSH)
        hourlyLedger = await refreshBackupLedger();
      }

      // 7. Evaluate edge-triggered Pushover notifications (coalesced across this sync tick; paused if roaming)
      const evalTopo = latestSnap
        ? synthesizeTopology(reconciledApps, latestSnap, hourlyTunnel)
        : null;
      const { incidentKey, isDismissed } = computeBackupIncidentKey(hourlyLedger);
      const alertInput = buildSyncAlertEvaluationInput({
        maintenanceSuppressed: maintenanceSuppressedRef.current,
        apps: reconciledApps,
        appliances: hourlyAppliances,
        wshSnapshot: includeWshSnapshot ? latestSnap : null,
        securityViolationCount: evalTopo ? evalTopo.securityAudit.securityViolationCount : 0,
        failingInvariants: evalTopo
          ? evalTopo.securityAudit.invariants.filter((i) => i.status === 'FAIL')
          : [],
        tunnelVersion: hourlyTunnel,
        sslFleet: hourlySsl,
        backupLedger: hourlyLedger,
        backupIncidentKey: incidentKey,
        isBackupIncidentDismissed: isDismissed,
      });
      void invoke('evaluate_and_notify_sync', { input: alertInput }).catch(() => {});

      // Keep smoke test history & build telemetry synced with headless/CLI runs
      await Promise.allSettled([
        refreshSmokeHistoryRef.current?.(),
        refreshDeployTelemetryRef.current?.(),
      ]);

      if (syncJobId) {
        const finishedAt = new Date().toISOString();
        const passLine = `[PASS] Telemetry sync complete (${enrichedApps.length} apps, posture: ${posture}).`;
        setTerminalTabs((prev) =>
          prev.map((t) => {
            if (t.id !== syncJobId) return t;
            const updated: TerminalTab = {
              ...t,
              lines: [...t.lines, passLine],
              isRunning: false,
              exitCode: 0,
              finishedAt,
            };
            saveTabToDb(updated);
            return updated;
          })
        );
      }

      setLastSyncTime(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('[PanoramaSRE] Full sync error:', err);
      if (syncJobId) {
        const finishedAt = new Date().toISOString();
        const errLine = `[ERROR] Telemetry sync failed: ${err instanceof Error ? err.message : String(err)}`;
        setTerminalTabs((prev) =>
          prev.map((t) => {
            if (t.id !== syncJobId) return t;
            const updated: TerminalTab = {
              ...t,
              lines: [...t.lines, errLine],
              isRunning: false,
              exitCode: 1,
              finishedAt,
            };
            saveTabToDb(updated);
            return updated;
          })
        );
        evaluateJobFinishAutoOpen(syncJobId, 1);
      }
    } finally {
      if (isUserInitiated) {
        setIsManualSyncing(false);
      }
    }
  }, [computeBackupIncidentKey, evaluateJobFinishAutoOpen, refreshAppliances, refreshBackupLedger, refreshSslStatus, refreshTunnelVersion, refreshOptIns, registerStreamTab, saveTabToDb]);

  // Initial sync on mount (all tiers once on startup + cached opt-ins hydration)
  const refreshThreatIntelState = useCallback(async (preferredRunId?: string) => {
    try {
      const [settingsDto, runsList, activeActorsList, wafSnap, quarantinedList] = await Promise.all([
        invoke<ThreatIntelSettingsViewDto>('get_threat_intel_settings'),
        invoke<ThreatAuditRunRow[]>('get_threat_audit_runs', { limit: 30 }),
        invoke<ThreatActorRow[]>('get_threat_actors', { disposition: 'ACTIVE' }),
        invoke<CloudflareWafSnapshotDto>('get_cloudflare_waf_rules', { forceRefresh: false }).catch(
          () => null
        ),
        invoke<QuarantinedAccessEmailRow[]>('get_quarantined_access_emails').catch(() => []),
      ]);
      setThreatSettings(settingsDto);
      const safeRuns = Array.isArray(runsList) ? runsList : [];
      setThreatRuns(safeRuns);
      setActiveThreatActors(Array.isArray(activeActorsList) ? activeActorsList : []);
      setThreatWafRules(Array.isArray(wafSnap?.rules) ? wafSnap.rules : []);
      setQuarantinedAccessEmails(Array.isArray(quarantinedList) ? quarantinedList : []);

      const latestRunId = safeRuns[0]?.id;
      if (latestRunId) {
        const latestDetail = await invoke<ThreatRunDetailDto>('get_threat_run_detail', {
          runId: latestRunId,
        });
        setLatestThreatDetail(latestDetail);

        if (preferredRunId && preferredRunId !== latestRunId) {
          const selectedDetail = await invoke<ThreatRunDetailDto>('get_threat_run_detail', {
            runId: preferredRunId,
          });
          setSelectedThreatDetail(selectedDetail);
        } else {
          setSelectedThreatDetail(latestDetail);
        }
      } else {
        setLatestThreatDetail(null);
        setSelectedThreatDetail(null);
      }
    } catch (err) {
      console.warn('[PanoramaSRE] Failed refreshing 360 Threat Intel state:', err);
    }
  }, []);

  const handleSelectThreatRunId = useCallback(async (runId: string) => {
    try {
      const detail = await invoke<ThreatRunDetailDto>('get_threat_run_detail', { runId });
      setSelectedThreatDetail(detail);
    } catch (err) {
      console.warn('[PanoramaSRE] Failed loading selected threat run detail:', err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsInitialSyncing(true);
      try {
        await hydrateDismissedBackupIncidents();
        await Promise.allSettled([
          loadCachedOptIns(),
          refreshMcpStatus(),
          refreshThreatIntelState(),
          syncFullTelemetry(false, true, 'hud', true),
        ]);
      } finally {
        if (!cancelled) {
          setHasCompletedInitialSync(true);
          setIsInitialSyncing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    hydrateDismissedBackupIncidents,
    loadCachedOptIns,
    syncFullTelemetry,
    refreshMcpStatus,
    refreshThreatIntelState,
  ]);

  useEffect(() => {
    let unlistenThreat: (() => void) | undefined;
    let unlistenQuarantine: (() => void) | undefined;
    listen<ThreatRunDetailDto>('sre://threat-audit-updated', (event) => {
      const detail = event.payload;
      if (detail?.run?.id) {
        setLatestThreatDetail(detail);
        setSelectedThreatDetail(detail);
        void refreshThreatIntelState(detail.run.id);
      } else {
        void refreshThreatIntelState();
      }
    }).then((unsub) => {
      unlistenThreat = unsub;
    });
    listen<QuarantinedAccessEmailRow[]>('sre://threat-quarantine-updated', () => {
      void invoke<QuarantinedAccessEmailRow[]>('get_quarantined_access_emails')
        .then((rows) => {
          setQuarantinedAccessEmails(Array.isArray(rows) ? rows : []);
        })
        .catch(() => {});
    }).then((unsub) => {
      unlistenQuarantine = unsub;
    });
    let unlistenOtto: (() => void) | undefined;
    listen<OttoLifecycleSnapshot>('sre://agent-lifecycle', (event) => {
      if (event.payload) {
        setOttoStatus((prev) =>
          prev
            ? { ...prev, lifecycle: event.payload }
            : prev
        );
      }
    }).then((unsub) => {
      unlistenOtto = unsub;
    });
    let unlistenOttoSoaks: (() => void) | undefined;
    listen('sre://agent-soaks-updated', () => {
      void invoke<OttoSoakSessionRow[]>('get_otto_soak_sessions', { limit: 25 })
        .then((list) => {
          if (Array.isArray(list)) setOttoSoaks(list);
        })
        .catch(() => {});
      void invoke<OttoProposalRow[]>('get_otto_proposals', { limit: 80 })
        .then((list) => {
          if (Array.isArray(list)) setOttoProposals(list);
        })
        .catch(() => {});
    }).then((unsub) => {
      unlistenOttoSoaks = unsub;
    });
    return () => {
      if (unlistenThreat) unlistenThreat();
      if (unlistenQuarantine) unlistenQuarantine();
      if (unlistenOtto) unlistenOtto();
      if (unlistenOttoSoaks) unlistenOttoSoaks();
    };
  }, [refreshThreatIntelState]);

  const refreshOttoState = useCallback(async () => {
    try {
      const [statusDto, policiesList, invariantsList, tracesList, proposalsList, soaksList] =
        await Promise.all([
          invoke<OttoStatusDto>('get_otto_status'),
          invoke<OttoPolicyRow[]>('get_otto_policies'),
          invoke<OttoL4Invariant[]>('get_otto_l4_invariants'),
          invoke<OttoTraceRunRow[]>('get_otto_trace_runs', { limit: 60 }),
          invoke<OttoProposalRow[]>('get_otto_proposals', { limit: 80 }),
          invoke<OttoSoakSessionRow[]>('get_otto_soak_sessions', { limit: 25 }),
        ]);
      setOttoStatus(statusDto);
      setOttoPolicies(Array.isArray(policiesList) ? policiesList : []);
      setOttoL4Invariants(Array.isArray(invariantsList) ? invariantsList : []);
      setOttoTraces(Array.isArray(tracesList) ? tracesList : []);
      setOttoProposals(Array.isArray(proposalsList) ? proposalsList : []);
      setOttoSoaks(Array.isArray(soaksList) ? soaksList : []);
    } catch (err) {
      console.warn('[PanoramaSRE] Failed to hydrate Otto state:', err);
    }
  }, []);

  useEffect(() => {
    void refreshOttoState();
  }, [refreshOttoState]);

  const openOttoWithContext = useCallback(
    (seed: OttoContextSeed) => {
      setOttoPendingSeed((prev) => ({ seed, nonce: prev.nonce + 1 }));
      navigateTo('agent', { tab: 'ask', returnFromCurrent: true });
    },
    [navigateTo]
  );

  const handleToggleOttoKillSwitch = useCallback(
    async (active: boolean) => {
      try {
        const next = await invoke<OttoStatusDto>('set_otto_kill_switch', {
          active,
          reason: active
            ? 'Operator engaged Global Emergency Kill-Switch from PanoramaSRE UI'
            : 'Operator released Global Emergency Kill-Switch from PanoramaSRE UI',
        });
        setOttoStatus(next);
      } catch (err) {
        console.warn('[PanoramaSRE] Failed to toggle Otto kill-switch:', err);
      }
    },
    []
  );

  const handleAbortOttoStep = useCallback(async () => {
    try {
      const snap = await invoke<OttoLifecycleSnapshot>('abort_otto_active_step');
      setOttoStatus((prev) => (prev ? { ...prev, lifecycle: snap } : prev));
      await refreshOttoState();
    } catch (err) {
      console.warn('[PanoramaSRE] Failed to abort Otto active step:', err);
    }
  }, [refreshOttoState]);

  const handleResetOttoCircuitBreaker = useCallback(async () => {
    try {
      const next = await invoke<OttoStatusDto>('reset_otto_circuit_breaker');
      setOttoStatus(next);
    } catch (err) {
      console.warn('[PanoramaSRE] Failed to reset Otto circuit breaker:', err);
    }
  }, []);

  const handleUpdateOttoPolicyMode = useCallback(
    async (actionId: string, mode: string) => {
      const updated = await invoke<OttoPolicyRow>('update_otto_policy_mode', {
        actionId,
        mode,
      });
      setOttoPolicies((prev) =>
        prev.map((p) => (p.actionId === updated.actionId ? updated : p))
      );
    },
    []
  );

  const handleDecideOttoProposal = useCallback(
    async (proposalId: string, decision: string): Promise<OttoProposalRow> => {
      const updated = await invoke<OttoProposalRow>('decide_otto_proposal', {
        input: { proposalId, decision, note: null },
      });
      await refreshOttoState();
      return updated;
    },
    [refreshOttoState]
  );

  const handleCancelOttoSoak = useCallback(
    async (soakId: string) => {
      try {
        await invoke<OttoSoakSessionRow>('cancel_otto_soak_session', { soakId });
        showActionFeedback('Cancelled active Otto post-deploy soak monitor.', 'success', 3500);
        await refreshOttoState();
      } catch (err) {
        showActionFeedback(`Failed cancelling soak monitor: ${String(err)}`, 'error', 5000);
      }
    },
    [refreshOttoState, showActionFeedback]
  );

  const handleStartManualOttoSoak = useCallback(
    async (app: DiscoveredApp) => {
      try {
        const hasDbMigration = Boolean(
          app.composition?.blast_radius_badges?.includes('DB_MIGRATION')
        );
        const prevTag = app.health?.release?.image_tag ?? null;
        const releaseId =
          app.health?.release?.release_id ||
          app.composition?.local_head_short ||
          app.health?.version ||
          'manual-soak';
        await invoke<OttoSoakSessionRow>('start_otto_soak_session', {
          input: {
            appSlug: app.manifest.slug,
            hostingTarget: app.manifest.hostingTarget || 'wsh-docker',
            releaseId,
            previousImageTag: prevTag,
            hasDbMigration,
            durationSecs: 900,
          },
        });
        showActionFeedback(
          `Started 15-minute Otto post-deploy soak for ${app.manifest.displayName}.`,
          'success',
          4000
        );
        await refreshOttoState();
      } catch (err) {
        showActionFeedback(`Failed starting Otto soak: ${String(err)}`, 'error', 5000);
      }
    },
    [refreshOttoState, showActionFeedback]
  );

  const handleEvaluateOttoSteadyState = useCallback(async (): Promise<string> => {
    const evalOpts = {
      isInitialSyncComplete: hasCompletedInitialSyncRef.current,
      networkPosture: networkPostureRef.current,
    };
    const unhealthyApps = appsRef.current
      .filter((a) => isAppUnhealthy(a, evalOpts))
      .map((a) => ({
        appSlug: a.manifest.slug,
        hostingTarget: a.manifest.hostingTarget || 'wsh-docker',
        healthy: false,
        latencyMs: a.latencyMs ?? null,
        containerState: a.health?.status ?? null,
        detail: a.health?.status || 'unhealthy',
      }));
    const usage = dockerDiskUsageRef.current;
    const ssl = sslFleetRef.current;
    const res = await invoke<OttoSteadyStateResult>('evaluate_otto_steady_state', {
      input: {
        unhealthyApps,
        buildkitReclaimableBytes: usage?.build_cache?.reclaimable_bytes ?? null,
        buildkitTotalBytes: usage?.build_cache?.size_bytes ?? null,
        sslMinDaysRemaining: ssl ? ssl.min_days_remaining : null,
      },
    });
    showActionFeedback(`Otto steady-state sweep: ${res.summary}`, 'success', 4500);
    await refreshOttoState();
    return res.summary;
  }, [refreshOttoState, showActionFeedback]);

  const handleQueueBuildKitPruneProposal = useCallback(async () => {
    try {
      await invoke<OttoProposalRow>('queue_otto_manual_proposal', {
        input: {
          actionId: 'prune_buildkit_cache',
          assetSlug: 'buildkit',
          title: 'Prune Stale Local BuildKit Cache (>72h)',
          rcaSummary:
            'Runs compiled docker buildx prune --all --filter until=72h -f locally on the workstation (zero SSH/WSH production mutation).',
          paramsJson: JSON.stringify({ filter: 'until=72h', scope: 'local-workstation' }),
          severity: 'LOW',
          domain: 'HEAL',
          hasDbMigration: false,
        },
      });
      showActionFeedback('Staged Local BuildKit Prune in Otto Approval Queue.', 'success', 4000);
      await refreshOttoState();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showActionFeedback(`Could not stage BuildKit prune: ${msg}`, 'error', 6000);
      throw err;
    }
  }, [refreshOttoState, showActionFeedback]);

  // Background 15-minute D1 SMS Opt-In sync with new-record desktop notification
  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshOptIns(undefined, undefined, true);
    }, 15 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [refreshOptIns]);

  // Clear unread badge count whenever operator opens the SMS Opt-Ins view
  useEffect(() => {
    if (activeTab !== 'opt-ins') return;
    invoke('mark_parakith_opt_ins_seen')
      .then(() => {
        setOptInSnapshot((prev) =>
          prev ? { ...prev, unreadCount: 0, lastSeenId: prev.maxId } : prev
        );
      })
      .catch((err) => {
        console.warn('[PanoramaSRE] Failed marking opt-ins seen:', err);
      });
  }, [activeTab]);

  // Refresh build telemetry history & local Docker disk usage whenever opening the Telemetry tab
  useEffect(() => {
    if (activeTab !== 'telemetry') return;
    void refreshDeployTelemetryRef.current?.();
  }, [activeTab]);

  // Synchronize configurable Tier 1 & Tier 3 intervals to Rust TelemetryScheduler
  useEffect(() => {
    const t1 = Math.max(5, Number.parseInt(tier1PollInterval, 10) || 15);
    const t3Mins = Math.max(1, Number.parseInt(securityAuditInterval, 10) || 5);
    invoke('update_scheduler_intervals', {
      tier1Secs: t1,
      tier3Secs: t3Mins * 60,
    }).catch((err) => {
      console.warn('[PanoramaSRE] Failed to update scheduler intervals:', err);
    });
  }, [tier1PollInterval, securityAuditInterval]);

  // Listen for unified 4-tier TelemetryScheduler ticks and dispatch due tier workloads
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ tier?: number; tiers?: number[] }>('sre://telemetry-tick', (event) => {
      const payload = event.payload;
      const dueTiers: number[] =
        Array.isArray(payload?.tiers) && payload.tiers.length > 0
          ? payload.tiers
          : payload?.tier
          ? [payload.tier]
          : [];

      // Tier 1 (15s default): local dev servers & Named Pipe MCP bridge (0 LAN/WAN traffic)
      if (dueTiers.includes(1)) {
        refreshDevServers();
        refreshMcpStatus();
      }

      // Tier 2 (60s): pooled home lab appliance probes (4x/day smoke schedule is owned by Windows Task Scheduler)
      if (dueTiers.includes(2)) {
        refreshAppliances();
        if (ottoSoaksRef.current.some((s) => s.status === 'SOAKING') && appsRef.current.length > 0) {
          const obs = appsRef.current.map((a) => ({
            appSlug: a.manifest.slug,
            hostingTarget: a.manifest.hostingTarget || 'wsh-docker',
            healthy: a.health?.status === 'healthy',
            latencyMs: a.latencyMs ?? null,
            containerState: a.health?.status ?? null,
            detail: a.health?.status === 'healthy' ? 'healthy' : a.health?.status || 'unreachable',
          }));
          void invoke<OttoSoakSessionRow[]>('evaluate_otto_soak_tick', {
            input: { observations: obs },
          })
            .then((nextSoaks) => {
              if (Array.isArray(nextSoaks)) setOttoSoaks(nextSoaks);
            })
            .catch(() => {});
        }
      }

      // Tier 3 (300s default / configurable): posture + fleet health + fleet git composition + WSH --fast SSH snapshot
      if (dueTiers.includes(3)) {
        syncFullTelemetry(false, true, 'hud', false);
      }

      // Tier 4 (3600s / 1 hour): upstream cloudflared GitHub check + 5-domain SSL + backup ledger
      if (dueTiers.includes(4)) {
        runHourlyChecksNow(false);
      }
    }).then((unsub) => {
      unlisten = unsub;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [refreshDevServers, refreshMcpStatus, refreshAppliances, syncFullTelemetry, runHourlyChecksNow]);

  // Listen for AI Agent MCP Control Plane IPC actions & security alerts
  useEffect(() => {
    let unlistenAction: (() => void) | undefined;
    let unlistenAlert: (() => void) | undefined;

    listen<{ action: string; slug: string; message: string }>('sre://agent-action', (event) => {
      const msg = event.payload?.message || `AI Agent executed ${event.payload?.action || 'action'}`;
      if (event.payload?.action === 'composition') {
        syncFullTelemetry(false, false);
        refreshMcpStatus();
        return;
      }
      showActionFeedback(msg, 'success', 4000);
      refreshDevServers();
      refreshMcpStatus();
      setTimeout(() => {
        refreshDevServers();
        refreshMcpStatus();
      }, 800);
    }).then((unsub) => {
      unlistenAction = unsub;
    });

    listen<{ pid: number; exePath: string; reason: string }>('sre://security-alert', (event) => {
      const reason = event.payload?.reason || 'Unauthorized IPC access blocked';
      showActionFeedback(`[SECURITY ALERT] ${reason}`, 'error', 8000);
      refreshMcpStatus();
    }).then((unsub) => {
      unlistenAlert = unsub;
    });

    return () => {
      if (unlistenAction) unlistenAction();
      if (unlistenAlert) unlistenAlert();
    };
  }, [showActionFeedback, refreshDevServers, refreshMcpStatus, syncFullTelemetry]);

  // Listen for Local Dev Server boot-until-ready stream events (UI, MCP, & supervisor)
  useEffect(() => {
    let unlistenStart: (() => void) | undefined;
    let unlistenLine: (() => void) | undefined;
    let unlistenEnd: (() => void) | undefined;

    listen<{
      id: string;
      title: string;
      appId: string;
      port?: number;
      source?: string;
    }>('sre://dev-stream-start', (event) => {
      const { id, title, appId, source } = event.payload || {};
      if (!id) return;
      const mappedSource: WorkStreamSource =
        source === 'mcp' ? 'mcp' : source === 'ui' ? 'ui' : 'supervisor';
      const newTab: TerminalTab = {
        id,
        title: title || `Dev Server Boot: ${appId}`,
        lines: [],
        isRunning: true,
        createdAt: new Date().toISOString(),
        pageScope: 'local-dev',
        source: mappedSource,
        appSlug: appId,
        abortable: false,
        autoOpenTier: 'C',
      };
      registerStreamTab(newTab, { upsert: true, persist: false });
    }).then((unsub) => {
      unlistenStart = unsub;
    });

    listen<{ id: string; appId: string; line: string }>('sre://dev-stream-line', (event) => {
      const { id, appId, line } = event.payload || {};
      if (!id || typeof line !== 'string') return;
      setTerminalTabs((prev) => {
        const exists = prev.some((t) => t.id === id);
        if (!exists) {
          return [
            ...prev,
            {
              id,
              title: `Dev Server Boot: ${appId || 'app'}`,
              lines: [line],
              isRunning: true,
              createdAt: new Date().toISOString(),
              pageScope: 'local-dev',
              source: 'supervisor',
              appSlug: appId,
              abortable: false,
              autoOpenTier: 'C',
            },
          ];
        }
        return prev.map((t) => (t.id === id ? { ...t, lines: [...t.lines, line] } : t));
      });
    }).then((unsub) => {
      unlistenLine = unsub;
    });

    listen<{ id: string; appId: string; exitCode: number }>('sre://dev-stream-end', (event) => {
      const { id, exitCode } = event.payload || {};
      if (!id) return;
      const code = typeof exitCode === 'number' ? exitCode : 0;
      const finishedAt = new Date().toISOString();
      setTerminalTabs((prev) =>
        prev.map((t) => {
          if (t.id === id) {
            const updated: TerminalTab = { ...t, isRunning: false, exitCode: code, finishedAt };
            saveTabToDb(updated);
            return updated;
          }
          return t;
        })
      );
      evaluateJobFinishAutoOpen(id, code);
      refreshDevServers();
    }).then((unsub) => {
      unlistenEnd = unsub;
    });

    return () => {
      if (unlistenStart) unlistenStart();
      if (unlistenLine) unlistenLine();
      if (unlistenEnd) unlistenEnd();
    };
  }, [refreshDevServers, saveTabToDb]);

  // Listen for Otto AI SRE compiled executor stream events (Unified Output Console Dock)
  // L2 background actions use source='agent', autoOpenTier='C' (zero focus steal);
  // L3 human-clicked approvals use source='ui', autoOpenTier='A' (auto-opens dock).
  useEffect(() => {
    let unlistenStart: (() => void) | undefined;
    let unlistenLine: (() => void) | undefined;
    let unlistenEnd: (() => void) | undefined;

    listen<{
      id: string;
      title?: string;
      appSlug?: string;
      source?: string;
      autoOpenTier?: string;
      pageScope?: string;
    }>('sre://agent-stream-start', (event) => {
      const { id, title, appSlug, source, autoOpenTier } = event.payload || {};
      if (!id) return;
      const mappedSource: WorkStreamSource = source === 'ui' ? 'ui' : 'agent';
      const mappedTier = autoOpenTier === 'A' ? 'A' : 'C';
      const newTab: TerminalTab = {
        id,
        title: title || `Otto Action (${appSlug || 'fleet'})`,
        lines: [],
        isRunning: true,
        createdAt: new Date().toISOString(),
        pageScope: 'agent',
        source: mappedSource,
        appSlug,
        abortable: true,
        autoOpenTier: mappedTier,
      };
      registerStreamTab(newTab, {
        upsert: true,
        persist: false,
        focusTab: mappedSource === 'ui',
      });
    }).then((unsub) => {
      unlistenStart = unsub;
    });

    listen<{ id: string; line: string }>('sre://agent-stream-line', (event) => {
      const { id, line } = event.payload || {};
      if (!id || typeof line !== 'string') return;
      setTerminalTabs((prev) => {
        const exists = prev.some((t) => t.id === id);
        if (!exists) {
          return [
            ...prev,
            {
              id,
              title: 'Otto Action',
              lines: [line],
              isRunning: true,
              createdAt: new Date().toISOString(),
              pageScope: 'agent',
              source: 'agent',
              abortable: true,
              autoOpenTier: 'C',
            },
          ];
        }
        return prev.map((t) => (t.id === id ? { ...t, lines: [...t.lines, line] } : t));
      });
    }).then((unsub) => {
      unlistenLine = unsub;
    });

    listen<{ id: string; exitCode: number }>('sre://agent-stream-end', (event) => {
      const { id, exitCode } = event.payload || {};
      if (!id) return;
      const code = typeof exitCode === 'number' ? exitCode : 0;
      const finishedAt = new Date().toISOString();
      setTerminalTabs((prev) =>
        prev.map((t) => {
          if (t.id === id) {
            const updated: TerminalTab = { ...t, isRunning: false, exitCode: code, finishedAt };
            saveTabToDb(updated);
            return updated;
          }
          return t;
        })
      );
      evaluateJobFinishAutoOpen(id, code);
      void refreshOttoState();
    }).then((unsub) => {
      unlistenEnd = unsub;
    });

    return () => {
      if (unlistenStart) unlistenStart();
      if (unlistenLine) unlistenLine();
      if (unlistenEnd) unlistenEnd();
    };
  }, [registerStreamTab, saveTabToDb, evaluateJobFinishAutoOpen, refreshOttoState]);

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

    // 2. Start all other remaining WSH child web servers in parallel (exclude Cloudflare Pages & headless services)
    const childApps = apps.filter(
      (a) =>
        a.manifest.slug !== 'auth' &&
        (!a.manifest.hostingTarget || a.manifest.hostingTarget === 'wsh-docker') &&
        Boolean(a.manifest.sre.devCommand?.trim())
    );
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
      pageScope: 'backups',
      source: 'ui',
      appSlug: app.manifest.slug,
      abortable: true,
      autoOpenTier: 'B',
    };
    registerStreamTab(newTab);

    runStreamJob({
      jobId,
      label: `Snapshot: ${app.manifest.displayName}`,
      command: 'pwsh.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', './db-manager.ps1', 'Backup'],
      workingDir: app.workspacePath,
      lockType: 'LocalBackupIo',
      timeoutSecs: 600,
      onLine: (line) => {
        appendTerminalLine(jobId, line);
      },
      onComplete: async (exitCode) => {
        finalizeTerminalJob(jobId, exitCode);
        await refreshBackupLedger();
        if (exitCode === 0) {
          showActionFeedback(
            `Snapshot for ${app.manifest.displayName} completed cleanly.`,
            'success',
            5000
          );
        } else {
          showActionFeedback(
            `Snapshot for ${app.manifest.displayName} exited with code ${exitCode}.`,
            'error',
            7000
          );
        }
      },
      onError: (err) => {
        failTerminalJob(jobId, `Backup failed: ${err}`);
      },
    });
  };

  const handleApplyLocalBackup = async (app: DiscoveredApp, archivePath: string) => {
    const jobId = `apply-local-${app.manifest.slug}-${Date.now()}`;
    const isRunning =
      app.devServer?.status === 'RUNNING_MANAGED' ||
      app.devServer?.status === 'RUNNING_EXTERNAL';

    const newTab: TerminalTab = {
      id: jobId,
      title: `ApplyLocal: ${app.manifest.displayName}`,
      lines: [
        `[PanoramaSRE] Extracting ${archivePath.split('\\').pop()} to local SQLite...`,
        ...(isRunning
          ? [`[PanoramaSRE] Stopping dev server for ${app.manifest.displayName} (port ${app.manifest.port}) via supervisor...`]
          : []),
      ],
      isRunning: true,
      createdAt: new Date().toISOString(),
      pageScope: 'backups',
      source: 'ui',
      appSlug: app.manifest.slug,
      abortable: true,
      autoOpenTier: 'A',
    };
    registerStreamTab(newTab);

    if (isRunning) {
      try {
        await invoke('stop_dev_server', {
          appId: app.manifest.appId,
          port: app.manifest.port,
        });
        await new Promise((resolve) => setTimeout(resolve, 600));
        appendTerminalLine(jobId, `[PanoramaSRE] Dev server stopped cleanly.`);
      } catch (stopErr) {
        appendTerminalLine(
          jobId,
          `[PanoramaSRE] Warning: supervisor stop returned (${stopErr}); continuing with db-manager.ps1 cleanup.`
        );
      }
    }

    runStreamJob({
      jobId,
      label: `ApplyLocal: ${app.manifest.displayName}`,
      command: 'pwsh.exe',
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
        if (exitCode === 0) {
          appendTerminalLine(
            jobId,
            `[PanoramaSRE] Starting ${app.manifest.displayName} via PanoramaSRE dev supervisor (port ${app.manifest.port})...`
          );
          void handleStartDevServer(
            app.manifest.appId,
            app.workspacePath,
            app.manifest.sre.devCommand,
            app.manifest.port
          );
        } else {
          refreshDevServers();
        }
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
      pageScope: 'backups',
      source: 'ui',
      appSlug: app.manifest.slug,
      abortable: true,
      autoOpenTier: 'A',
    };
    registerStreamTab(newTab);

    runStreamJob({
      jobId,
      label: `RestoreProd: ${app.manifest.displayName}`,
      command: 'pwsh.exe',
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
    skipDeploy?: boolean;
    skipRenew?: boolean;
    deployTargets?: string[];
    targetDevice?: string;
  }) => {
    const suiteToolsPath = 'C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaDrSuite\\tools';
    const cmdSpec = buildSslCertCommand(suiteToolsPath, options);
    const jobId = `ssl-renew-${Date.now()}`;
    const title = options.targetDevice
      ? options.skipDeploy
        ? `Renew Cert: ${options.targetDevice}`
        : options.skipRenew
        ? `Deploy Cert: ${options.targetDevice}`
        : `Renew & Deploy: ${options.targetDevice}`
      : options.forceRenewal
      ? options.skipDeploy
        ? 'Force Renew All (No Deploy)'
        : 'Force Renew All & Deploy'
      : options.deployTargets && options.deployTargets.length > 0
      ? `Deploy SSL: ${options.deployTargets.join(', ')}`
      : 'Renew Due SSL (<30d)';

    const newTab: TerminalTab = {
      id: jobId,
      title,
      lines: [`[PanoramaSRE] Invoking ${cmdSpec.command} ${cmdSpec.args.join(' ')}...`],
      isRunning: true,
      createdAt: new Date().toISOString(),
      pageScope: 'edge',
      source: 'ui',
      abortable: true,
      autoOpenTier: 'A',
    };
    registerStreamTab(newTab);

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
      pageScope: 'topology',
      source: 'ui',
      abortable: true,
      autoOpenTier: action === 'update' || action === 'update_force' ? 'A' : 'B',
    };
    registerStreamTab(newTab);

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
        syncFullTelemetry(false, true, 'topology', false).then(() => {
          refreshTunnelVersion(action !== 'status');
        });
      },
      onError: (err) => {
        failTerminalJob(jobId, `Cloudflare Tunnel execution failed: ${err}`);
      },
    });
  };

  // Parakith D1 SMS Opt-In Compliance Handlers
  const handleExportOptIns = useCallback(
    async (records: ParakithOptInRecord[], format: 'csv' | 'json') => {
      try {
        const targetPath = await save({
          title: `Export Parakith SMS Opt-Ins (${format.toUpperCase()})`,
          defaultPath: `parakith-opt-ins-${new Date().toISOString().slice(0, 10)}.${format}`,
          filters: [{ name: format.toUpperCase(), extensions: [format] }],
        });
        if (!targetPath) return;
        const count = await invoke<number>('export_parakith_opt_ins', {
          records,
          format,
          targetPath,
        });
        showActionFeedback(
          `Exported ${count} SMS opt-in record(s) to ${targetPath}`,
          'success',
          5000
        );
      } catch (err) {
        showActionFeedback(`Failed to export opt-in records: ${err}`, 'error', 6000);
      }
    },
    [showActionFeedback]
  );

  const handleDeleteOptIn = useCallback(
    async (recordId: number) => {
      const targetApp =
        parakithAppRef.current || apps.find((a) => a.manifest.slug === 'parakith') || null;
      if (!targetApp) {
        throw new Error('ParakithSite workspace is not discovered in active suite apps.');
      }
      const updated = await invoke<OptInComplianceSnapshot>('delete_parakith_opt_in', {
        workspacePath: targetApp.workspacePath,
        databaseName: targetApp.manifest.cloudflare?.d1DatabaseName || 'parakith-opt-ins',
        recordId,
      });
      setOptInSnapshot(updated);
      showActionFeedback(
        `Deleted opt-in record #${recordId} from D1 & local cache`,
        'success',
        5000
      );
    },
    [apps, showActionFeedback]
  );

  // Deployment Execution Helpers
  const executeAppDeploy = (
    app: DiscoveredApp,
    bump: string,
    allowDirty: boolean,
    skipSmoke = false,
    edgeMode: 'GitCi' | 'Wrangler' = 'GitCi',
    batchGroupId?: string
  ): Promise<number> => {
    const jobId = `deploy-${app.manifest.slug}-${Date.now()}`;
    currentRunningDeployJobIdRef.current = jobId;
    setSelectedReleaseAppSlug(app.manifest.slug);
    setTrackedDeployJobIds((prev) => ({ ...prev, [app.manifest.slug]: jobId }));
    const isEdgeApp = app.manifest.hostingTarget === 'cloudflare-pages';
    const isWshService = app.manifest.hostingTarget === 'wsh-docker-service';
    const jobTitle = isWshService
      ? `Deploy Service: ${app.manifest.displayName}`
      : isEdgeApp
      ? `Edge Publish: ${app.manifest.displayName}`
      : `Deploy: ${app.manifest.displayName}`;
    const newTab: TerminalTab = {
      id: jobId,
      title: jobTitle,
      lines: [
        isWshService
          ? `[PanoramaSRE] Initiating WSH service deployment for ${app.manifest.displayName}...`
          : isEdgeApp
          ? `[PanoramaSRE] Initiating Cloudflare Pages publish (${edgeMode}) for ${app.manifest.displayName}...`
          : `[PanoramaSRE] Initiating release pipeline for ${app.manifest.displayName}...`,
      ],
      isRunning: true,
      createdAt: new Date().toISOString(),
      pageScope: 'releases',
      source: 'ui',
      appSlug: app.manifest.slug,
      abortable: true,
      autoOpenTier: 'A',
      batchGroupId,
    };
    registerStreamTab(newTab);

    let command = 'pwsh.exe';
    let args: string[];
    let lockType: ScriptActionExecution['lockType'] = 'WshRemoteMutation';
    let workingDir = app.workspacePath;

    if (isWshService) {
      const svcExec = buildServiceScriptCommand(
        app.workspacePath,
        app.manifest.sre.deployScript || './deploy-unifi-siem.ps1',
        'deploy',
        { allowDirty }
      );
      command = svcExec.command;
      args = svcExec.args;
      lockType = svcExec.lockType;
      workingDir = svcExec.workingDir || app.workspacePath;
    } else if (isEdgeApp) {
      const cfExec = buildCloudflarePagesDeployCommand(app.workspacePath, {
        mode: edgeMode,
        bumpVersion: (bump as 'none' | 'patch' | 'minor' | 'major') || 'none',
        allowDirty,
        skipSmoke,
      });
      command = cfExec.command;
      args = cfExec.args;
      lockType = cfExec.lockType;
      workingDir = cfExec.workingDir || app.workspacePath;
    } else {
      args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', './deploy-docker.ps1'];
      if (bump !== 'none') {
        args.push('-BumpVersion', bump);
      }
      if (allowDirty) {
        args.push('-AllowDirty');
      }
      if (skipSmoke) {
        args.push('-SkipSmoke');
      }
    }

    return runStreamJob({
      jobId,
      label: jobTitle,
      command,
      args,
      workingDir,
      lockType,
      onLine: (line) => {
        appendTerminalLine(jobId, line);
      },
      onComplete: async (exitCode) => {
        if (currentRunningDeployJobIdRef.current === jobId) {
          currentRunningDeployJobIdRef.current = null;
        }
        finalizeTerminalJob(jobId, exitCode);
        if (exitCode === 0 && !isEdgeApp) {
          const hasDbMigration = Boolean(
            app.composition?.blast_radius_badges?.includes('DB_MIGRATION')
          );
          const prevTag = app.health?.release?.image_tag ?? null;
          const nextReleaseId =
            app.composition?.local_head_short ||
            app.health?.release?.release_id ||
            app.health?.version ||
            'deployed';
          void invoke<OttoSoakSessionRow>('start_otto_soak_session', {
            input: {
              appSlug: app.manifest.slug,
              hostingTarget: app.manifest.hostingTarget || 'wsh-docker',
              releaseId: nextReleaseId,
              previousImageTag: prevTag,
              hasDbMigration,
              durationSecs: 900,
            },
          })
            .then(() => refreshOttoState())
            .catch((e) => console.warn('[PanoramaSRE] Failed starting Otto soak session:', e));
        }
        if (isWshService) {
          await refreshWshTelemetry(true);
          if (app.manifest.slug === 'unifi-siem') {
            await refreshThreatIntelState(selectedThreatDetail?.run?.id);
          }
        }
        syncFullTelemetry(false, false);
        void refreshDeployTelemetryRef.current?.();
        setTimeout(() => {
          syncFullTelemetry(false, false);
          void refreshDeployTelemetryRef.current?.();
        }, 1500);
        if (!skipSmoke && !isWshService) {
          void refreshSmokeHistoryRef.current?.();
        }
      },
      onError: (err) => {
        if (currentRunningDeployJobIdRef.current === jobId) {
          currentRunningDeployJobIdRef.current = null;
        }
        failTerminalJob(jobId, `Deploy failed: ${err}`);
      },
    });
  };

  const executeAppRollback = (app: DiscoveredApp, tag: string): Promise<number> => {
    const jobId = `rollback-${app.manifest.slug}-${Date.now()}`;
    setSelectedReleaseAppSlug(app.manifest.slug);
    setTrackedDeployJobIds((prev) => ({ ...prev, [app.manifest.slug]: jobId }));
    const isEdgeApp = app.manifest.hostingTarget === 'cloudflare-pages';
    const newTab: TerminalTab = {
      id: jobId,
      title: isEdgeApp
        ? `Edge Rollback: ${app.manifest.displayName}`
        : `Rollback: ${app.manifest.displayName}`,
      lines: [
        isEdgeApp
          ? `[PanoramaSRE] Rolling back Cloudflare Pages deployment to ${tag}...`
          : `[PanoramaSRE] Swapping container to image tag ${tag}...`,
      ],
      isRunning: true,
      createdAt: new Date().toISOString(),
      pageScope: 'releases',
      source: 'ui',
      appSlug: app.manifest.slug,
      abortable: true,
      autoOpenTier: 'A',
    };
    registerStreamTab(newTab);

    const cfExec = isEdgeApp
      ? buildCloudflarePagesDeployCommand(app.workspacePath, {
          rollbackDeploymentId: tag,
        })
      : null;

    return runStreamJob({
      jobId,
      label: isEdgeApp
        ? `Edge Rollback: ${app.manifest.displayName}`
        : `Rollback: ${app.manifest.displayName}`,
      command: cfExec ? cfExec.command : 'pwsh.exe',
      args: cfExec
        ? cfExec.args
        : ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', './deploy-docker.ps1', '-RollbackToTag', tag],
      workingDir: cfExec?.workingDir || app.workspacePath,
      lockType: cfExec ? cfExec.lockType : 'WshRemoteMutation',
      onLine: (line) => {
        appendTerminalLine(jobId, line);
      },
      onComplete: (exitCode) => {
        finalizeTerminalJob(jobId, exitCode);
        syncFullTelemetry(false);
        void refreshDeployTelemetryRef.current?.();
      },
      onError: (err) => {
        failTerminalJob(jobId, `Rollback failed: ${err}`);
      },
    }).catch(() => -1);
  };

  const handleRollbackBatchTargets = async (targets: BatchPreDeploySnapshot[]) => {
    if (targets.length === 0) return;
    const currentApps = appsRef.current.length > 0 ? appsRef.current : apps;
    const rolledSlugs: string[] = [];
    const failedSlugs: string[] = [];

    showActionFeedback(
      `Rolling back ${targets.map((t) => t.displayName).join(', ')}...`,
      'pending'
    );

    for (const target of targets) {
      if (!target.preBatchTag) {
        failedSlugs.push(target.slug);
        continue;
      }
      const targetApp = currentApps.find(
        (a) => a.manifest.slug.toLowerCase() === target.slug.toLowerCase()
      );
      if (!targetApp) {
        failedSlugs.push(target.slug);
        continue;
      }
      const exitCode = await executeAppRollback(targetApp, target.preBatchTag);
      if (exitCode === 0) {
        rolledSlugs.push(target.slug);
      } else {
        failedSlugs.push(target.slug);
      }
    }

    let summary = '';
    if (rolledSlugs.length > 0) {
      const recExit = await handleRunSmokeTests(
        `deploy:batch-recovery:${rolledSlugs.join(',')}`,
        false
      );
      summary =
        recExit === 0
          ? `Rolled back ${rolledSlugs.join(', ')}. Recovery smoke gate PASSED.`
          : `Rolled back ${rolledSlugs.join(', ')}, but recovery smoke gate exited ${recExit}.`;
    }
    if (failedSlugs.length > 0) {
      summary = `${summary ? `${summary} ` : ''}Rollback failed/skipped for: ${failedSlugs.join(', ')}.`;
    }

    setBatchSmokeFailureReport((prev) =>
      prev
        ? {
            ...prev,
            autoRollbackAttempted: true,
            autoRollbackSummary: summary || prev.autoRollbackSummary,
          }
        : prev
    );
    setActionFeedback({
      message: summary || 'Batch rollback completed.',
      type: failedSlugs.length === 0 ? 'success' : 'error',
    });
  };

  const handleDeployAllApps = async (
    appsToDeploy: DiscoveredApp[],
    bump: string,
    allowDirty: boolean,
    autoRollbackOnSmokeFailure = true
  ) => {
    setIsDeployingAll(true);
    haltDeploymentsRef.current = false;
    setBatchSmokeFailureReport(null);

    try {
      // Respect the user's explicit deployment order and isolate external Cloudflare Pages & headless services from WSH Docker batching
      const sortedApps = appsToDeploy.filter(
        (a) => !a.manifest.hostingTarget || a.manifest.hostingTarget === 'wsh-docker'
      );

      const preBatchSnapshots: Record<string, BatchPreDeploySnapshot> = {};
      sortedApps.forEach((app, idx) => {
        preBatchSnapshots[app.manifest.slug.toLowerCase()] = {
          slug: app.manifest.slug,
          displayName: app.manifest.displayName,
          preBatchTag: app.health?.release?.image_tag || null,
          hasDbMigration: Boolean(
            app.composition?.blast_radius_badges?.includes('DB_MIGRATION')
          ),
          deployOrderIndex: idx,
        };
      });

      const skipSmoke = sortedApps.length > 1;
      const deployedApps: DiscoveredApp[] = [];
      const batchGroupId = `deploy-batch-${Date.now()}`;

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
          exitCode = await executeAppDeploy(app, bump, allowDirty, skipSmoke, 'GitCi', batchGroupId);
        } catch {
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

        deployedApps.push(app);
      }

      // Execute one consolidated suite smoke gate once every WSH batch app finishes cleanly
      if (
        skipSmoke &&
        deployedApps.length === sortedApps.length &&
        !haltDeploymentsRef.current
      ) {
        const batchTrigger = `deploy:batch:${deployedApps.map((a) => a.manifest.slug).join(',')}`;
        const smokeExit = await handleRunSmokeTests(batchTrigger, false);

        if (smokeExit === 0) {
          setActionFeedback({
            message: `Batch deploy (${deployedApps.length} apps) and consolidated 41-step smoke gate PASSED.`,
            type: 'success',
          });
        } else {
          const latestRuns = await refreshSmokeHistory();
          const matchedRun =
            latestRuns.find((r) => r.triggeredBy === batchTrigger) ??
            latestRuns[0] ??
            null;
          const failedChecks = (matchedRun?.results ?? []).filter((r) => !r.passed);
          const currentApps = appsRef.current.length > 0 ? appsRef.current : apps;
          const attribution = attributeBatchSmokeFailures(
            failedChecks,
            currentApps,
            deployedApps,
            preBatchSnapshots,
            autoRollbackOnSmokeFailure
          );
          const deployedSnapshots = deployedApps.map(
            (a) => preBatchSnapshots[a.manifest.slug.toLowerCase()]
          );

          if (attribution.action === 'TARGETED_AUTO_ROLLBACK') {
            const rolledSlugs: string[] = [];
            const failedRollbacks: string[] = [];
            for (const target of attribution.rollbackPlan) {
              const targetApp =
                deployedApps.find(
                  (a) => a.manifest.slug.toLowerCase() === target.slug.toLowerCase()
                ) ||
                currentApps.find(
                  (a) => a.manifest.slug.toLowerCase() === target.slug.toLowerCase()
                );
              if (!targetApp || !target.preBatchTag) {
                failedRollbacks.push(target.slug);
                continue;
              }
              const rbExit = await executeAppRollback(targetApp, target.preBatchTag);
              if (rbExit === 0) {
                rolledSlugs.push(target.slug);
              } else {
                failedRollbacks.push(target.slug);
              }
            }

            let recoverySummary = attribution.summaryReason;
            if (rolledSlugs.length > 0) {
              const recExit = await handleRunSmokeTests(
                `deploy:batch-recovery:${rolledSlugs.join(',')}`,
                false
              );
              recoverySummary =
                recExit === 0
                  ? `Targeted rollback of ${rolledSlugs.join(', ')} succeeded and recovery smoke gate PASSED.`
                  : `Targeted rollback of ${rolledSlugs.join(', ')} completed, but recovery smoke gate exited ${recExit}.`;
            }
            if (failedRollbacks.length > 0) {
              recoverySummary += ` Failed rollbacks: ${failedRollbacks.join(', ')}.`;
            }

            setBatchSmokeFailureReport({
              triggeredAt: new Date().toISOString(),
              smokeRunId: matchedRun?.id ?? null,
              triggeredBy: batchTrigger,
              deployedApps: deployedSnapshots,
              failedChecks,
              attribution,
              autoRollbackAttempted: true,
              autoRollbackSummary: recoverySummary,
            });
            setActionFeedback({
              message: recoverySummary,
              type: failedRollbacks.length === 0 ? 'success' : 'error',
            });
          } else {
            setBatchSmokeFailureReport({
              triggeredAt: new Date().toISOString(),
              smokeRunId: matchedRun?.id ?? null,
              triggeredBy: batchTrigger,
              deployedApps: deployedSnapshots,
              failedChecks,
              attribution,
              autoRollbackAttempted: false,
              autoRollbackSummary: null,
            });
            setActionFeedback({
              message: attribution.summaryReason,
              type: 'error',
            });
          }
        }
      }
    } finally {
      setIsDeployingAll(false);
      haltDeploymentsRef.current = false;
      currentRunningDeployJobIdRef.current = null;
      syncFullTelemetry(false);
      void refreshDeployTelemetryRef.current?.();
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
      evaluateJobFinishAutoOpen(jobId, exitCode);
    },
    [evaluateJobFinishAutoOpen, saveTabToDb]
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
      evaluateJobFinishAutoOpen(jobId, -1);
    },
    [evaluateJobFinishAutoOpen, saveTabToDb]
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
      pageScope: 'dietpi',
      source: 'ui',
      abortable: true,
      autoOpenTier: 'A',
    };
    registerStreamTab(newTab);
    showActionFeedback('Initiating DietPi WSH reboot...', 'pending');

    // Send reboot in background with nohup and immediate exit so SSH closes cleanly with exit code 0
    // before systemd terminates network interfaces and kills active TCP sockets.
    const sshReboot = buildRemoteSshCommand('nohup reboot >/dev/null 2>&1 & exit 0');

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
          const freshSnap = await invoke<WshSnapshot>('fetch_wsh_snapshot', { mode: '--fast', force: true });
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
          syncFullTelemetry(false, false);
        } catch (postBootErr) {
          appendTerminalLine(jobId, `[WARN] SSH is up, but telemetry snapshot returned warning: ${postBootErr}`);
          finalizeTerminalJob(jobId, 0);
          showActionFeedback('DietPi WSH online (telemetry settling)', 'success', 4000);
          refreshWshTelemetry(true);
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

  const handleTriggerFullGfsBackup = useCallback((originScope: NavSectionId = 'backups') => {
    const jobId = `gfs-backup-${Date.now()}`;
    const newTab: TerminalTab = {
      id: jobId,
      title: 'GFS Full Backup',
      lines: ['[PanoramaSRE] Triggering BackupManager.ps1 full backup...'],
      isRunning: true,
      createdAt: new Date().toISOString(),
      pageScope: originScope,
      source: 'ui',
      abortable: true,
      autoOpenTier: 'B',
    };
    registerStreamTab(newTab);

    runStreamJob({
      jobId,
      label: 'GFS Full Backup',
      command: 'pwsh.exe',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaDrSuite\\tools\\backup-manager\\BackupManager.ps1',
        '-AutomatedRun',
      ],
      lockType: 'LocalBackupIo',
      timeoutSecs: 1800,
      onLine: (line) => {
        appendTerminalLine(jobId, line);
      },
      onComplete: async (exitCode) => {
        finalizeTerminalJob(jobId, exitCode);
        await refreshBackupLedger();
        if (exitCode === 0) {
          showActionFeedback('Full GFS database backup completed cleanly.', 'success', 5000);
        } else {
          showActionFeedback(`Full GFS database backup exited with code ${exitCode}.`, 'error', 7000);
        }
      },
      onError: (err) => {
        failTerminalJob(jobId, `GFS backup failed: ${err}`);
      },
    });
  }, [appendTerminalLine, finalizeTerminalJob, failTerminalJob, refreshBackupLedger, saveTabToDb]);

  const handleRunPenetrationAudit = useCallback((originScope: NavSectionId = 'topology') => {
    const jobId = `audit-penetration-${Date.now()}`;
    const actionLabel = 'WSH Network Hardening Penetration Audit (SEC-01..08)';
    const newTab: TerminalTab = {
      id: jobId,
      title: actionLabel,
      lines: [
        `[PanoramaSRE] Launching Automated WSH Network & Container Hardening Penetration Audit...`,
        `[PanoramaSRE] Target Host: wsh.panoramadr.com (172.25.25.5)`,
      ],
      isRunning: true,
      createdAt: new Date().toISOString(),
      pageScope: originScope,
      source: 'ui',
      abortable: true,
      autoOpenTier: 'A',
    };
    registerStreamTab(newTab);

    runStreamJob({
      jobId,
      label: actionLabel,
      command: 'pwsh.exe',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaDrSuite\\tools\\server-setup\\Test-WshNetworkHardening.ps1',
      ],
      workingDir: 'C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaDrSuite\\tools\\server-setup',
      lockType: 'None',
      onLine: (line) => {
        appendTerminalLine(jobId, line);
      },
      onComplete: (exitCode) => {
        finalizeTerminalJob(jobId, exitCode);
        refreshWshTelemetry(true);
        setLastSecurityAuditTime(new Date().toLocaleTimeString());
      },
      onError: (err) => {
        failTerminalJob(jobId, `Audit execution error: ${err}`);
      },
    });
  }, [appendTerminalLine, finalizeTerminalJob, failTerminalJob, refreshWshTelemetry, saveTabToDb]);

  const handleReapplyHardening = useCallback((originScope: NavSectionId = 'topology') => {
    const jobId = `reapply-hardening-${Date.now()}`;
    const actionLabel = 'Re-Apply Host Firewall & Network Hardening';
    const newTab: TerminalTab = {
      id: jobId,
      title: actionLabel,
      lines: [
        `[PanoramaSRE] Re-Applying WSH Network Hardening & Kernel Firewall Rules...`,
        `[PanoramaSRE] Target Host: wsh.panoramadr.com (172.25.25.5)`,
      ],
      isRunning: true,
      createdAt: new Date().toISOString(),
      pageScope: originScope,
      source: 'ui',
      abortable: true,
      autoOpenTier: 'A',
    };
    registerStreamTab(newTab);

    runStreamJob({
      jobId,
      label: actionLabel,
      command: 'pwsh.exe',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaDrSuite\\tools\\server-setup\\deploy-server-setup.ps1',
      ],
      workingDir: 'C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaDrSuite\\tools\\server-setup',
      lockType: 'WshRemoteMutation',
      onLine: (line) => {
        appendTerminalLine(jobId, line);
      },
      onComplete: (exitCode) => {
        finalizeTerminalJob(jobId, exitCode);
        refreshWshTelemetry(true);
        setLastSecurityAuditTime(new Date().toLocaleTimeString());
      },
      onError: (err) => {
        failTerminalJob(jobId, `Hardening re-apply failed: ${err}`);
      },
    });
  }, [appendTerminalLine, finalizeTerminalJob, failTerminalJob, refreshWshTelemetry, saveTabToDb]);

  const handleCloseTab = (id: string) => {
    setTerminalTabs((prev) => prev.filter((t) => t.id !== id));
    setTrackedDeployJobIds((prev) => {
      const next = { ...prev };
      for (const [slug, trackedId] of Object.entries(next)) {
        if (trackedId === id) {
          delete next[slug];
        }
      }
      return next;
    });
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
          const updated = { ...t, lines: [], exitCode: undefined, isRunning: false };
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
    setTrackedDeployJobIds({});
    setIsDrawerOpen(false);
    invoke('delete_all_console_sessions').catch((e) =>
      console.warn('Failed to purge all console sessions from DB:', e)
    );
  };

  const devRunningCount = apps.filter(
    (a) => a.devServer?.status === 'RUNNING_MANAGED' || a.devServer?.status === 'RUNNING_EXTERNAL'
  ).length;

  const healthEvalOpts = useMemo(
    () => ({ isInitialSyncComplete: hasCompletedInitialSync, networkPosture }),
    [hasCompletedInitialSync, networkPosture]
  );

  const unhealthyCount = hasCompletedInitialSync
    ? apps.filter((a) => isAppUnhealthy(a, healthEvalOpts)).length
    : 0;
  const evaluableAppCount = apps.filter((a) =>
    isAppEvaluableForFleetCount(a, healthEvalOpts)
  ).length;
  const prodHealthyCount = apps.filter(
    (a) => getAppOperationalHealth(a, healthEvalOpts) === 'healthy'
  ).length;

  const {
    rawFailures: rawBackupFailureCount,
    incidentKey: backupIncidentKey,
    isDismissed: isBackupIncidentDismissed,
  } = computeBackupIncidentKey(backupLedger);

  const backupFailureCount =
    hasCompletedInitialSync && !isBackupIncidentDismissed ? rawBackupFailureCount : 0;

  const handleDismissBackupIncident = useCallback(() => {
    if (!backupIncidentKey) return;
    setDismissedBackupIncidentKeys((prev) =>
      prev.includes(backupIncidentKey) ? prev : [...prev, backupIncidentKey]
    );
    try {
      localStorage.setItem('panorama_sre_dismissed_backup_incident', backupIncidentKey);
    } catch {
      // Ignore storage quota / private mode errors
    }
    void invoke<string[]>('dismiss_backup_incident', { incidentKey: backupIncidentKey })
      .then((updated) => {
        if (Array.isArray(updated)) {
          setDismissedBackupIncidentKeys(updated);
        }
      })
      .catch((err) => {
        console.warn('Failed persisting dismissed backup incident globally:', err);
      });
  }, [backupIncidentKey]);

  // Count apps requiring release deployment (drifted, ahead, dirty, diverged, or unhealthy/unreachable)
  const behindReleasesCount = hasCompletedInitialSync
    ? apps.filter(isAppDeployCandidate).length
    : 0;

  const topology = React.useMemo(
    () => synthesizeTopology(apps, wshSnapshot, tunnelVersionStatus),
    [apps, wshSnapshot, tunnelVersionStatus]
  );
  const topologyBadges = React.useMemo(
    () => computeTopologyBadges(topology, wshSnapshot !== null),
    [topology, wshSnapshot]
  );
  const securityViolationCount =
    hasCompletedInitialSync && wshSnapshot ? topology.securityAudit.securityViolationCount : 0;
  const failingInvariants =
    hasCompletedInitialSync && wshSnapshot
      ? topology.securityAudit.invariants.filter((i) => i.status === 'FAIL')
      : [];
  const smokeFailureCount = smokeRuns[0]?.failed || 0;
  const fleetCronSummary = useMemo(() => auditFleetCrons(apps, wshSnapshot), [apps, wshSnapshot]);
  const dietpiBadges = useMemo(
    () => computeDietPiBadges(wshSnapshot, fleetCronSummary),
    [wshSnapshot, fleetCronSummary]
  );
  const dietpiPackagesCount = dietpiBadges.tabs.host.count;
  const actionableSecuritySummary = useMemo(
    () =>
      computeActionableSecuritySummary({
        latestRun: latestThreatDetail?.run ?? threatRuns[0] ?? null,
        findings: latestThreatDetail?.findings ?? [],
        actors: activeThreatActors,
        wafRules: threatWafRules,
      }),
    [latestThreatDetail, threatRuns, activeThreatActors, threatWafRules]
  );
  const threatBadge = actionableSecuritySummary.sidebarBadge;
  const pendingQuarantinedEmails = useMemo(
    () => quarantinedAccessEmails.filter((q) => q.status === 'PENDING'),
    [quarantinedAccessEmails]
  );

  const topThreatSummary = useMemo<{
    title: string;
    detail: string;
    tab: ThreatSubViewTab;
    focusId?: string;
  } | null>(() => {
    const topFinding = actionableSecuritySummary.actionableFindings[0];
    if (topFinding) {
      return {
        title: `${topFinding.severity}: ${topFinding.title}`,
        detail: `${topFinding.summary}${topFinding.host ? ` • Host: ${topFinding.host}` : ''}`,
        tab: classifyFindingSurface(topFinding.sourceLayer) === 'external' ? 'external' : 'internal',
        focusId: `threat-finding-${topFinding.id}`,
      };
    }
    const topActor = actionableSecuritySummary.deduplicatedActionableActors[0];
    if (topActor) {
      return {
        title: `${topActor.highestSeverity} Threat Actor: ${topActor.ipAddress || topActor.id}${
          topActor.totalOrigin200s > 0 ? ` (${topActor.totalOrigin200s} Origin 200s)` : ''
        }`,
        detail: `${topActor.asOrg || topActor.asn || 'External IP'} • ${topActor.totalRequests} reqs${
          topActor.latestClassification ? ` • ${topActor.latestClassification}` : ''
        }`,
        tab: 'external',
        focusId: `threat-actor-${topActor.id}`,
      };
    }
    const topOutage = actionableSecuritySummary.collectorOutages[0];
    if (topOutage) {
      return {
        title: `Collector Outage: ${topOutage.label} (${topOutage.status})`,
        detail: '360° Threat & Zero Trust collector failed during the latest audit window.',
        tab: 'overview',
      };
    }
    return null;
  }, [actionableSecuritySummary]);

  const getWorkspaceRoot = useCallback(() => {
    if (apps.length > 0 && apps[0].workspacePath) {
      return apps[0].workspacePath.replace(/[\\/][^\\/]+$/, '');
    }
    return 'c:\\Users\\rodrigo\\Documents\\AG Projects';
  }, [apps]);

  const handleRunThreatAuditNow = useCallback(
    async (windowHours: number, forceCarbon = false) => {
      if (isRunningThreatAudit) return;
      const tabId = `threat-audit-${Date.now()}`;
      const startMs = Date.now();
      const tier2Short =
        threatSettings?.preferences.tier2Model === 'gemini-4-carbon' ? 'Carbon' : 'Neon';
      const title = forceCarbon
        ? `360° Deep Investigate (Gemini 4 ${tier2Short} • ${windowHours}h)`
        : `360° Threat & Zero Trust Audit (${windowHours}h)`;
      const newTab: TerminalTab = {
        id: tabId,
        title,
        lines: [
          `[PanoramaSRE] Starting ${title}...`,
          `[${new Date().toLocaleTimeString()}] [INFO] [INIT] Dispatching 3-layer collection (Cloudflare, UniFi CloudKey, WSH SSH)...`,
        ],
        isRunning: true,
        createdAt: new Date().toISOString(),
        pageScope: 'security',
        source: 'ui',
        abortable: false,
        autoOpenTier: 'B',
      };
      activeThreatAuditTabIdRef.current = tabId;
      threatAuditLazyTabCreatedRef.current = false;
      registerStreamTab(newTab);
      setIsRunningThreatAudit(true);
      setThreatAuditProgress({
        runId: tabId,
        stage: 'init',
        label: 'Initializing Audit',
        message: 'Dispatching parallel collectors (Cloudflare, UniFi CloudKey, WSH SSH)...',
        level: 'INFO',
        startedAtMs: startMs,
      });
      showActionFeedback(
        forceCarbon
          ? `Running 72h Deep ${tier2Short} threat audit (${windowHours}h window)...`
          : `Running 360° Threat & Zero Trust audit (${windowHours}h window)...`,
        'pending'
      );
      try {
        const detail = await invoke<ThreatRunDetailDto>('run_threat_audit_now', {
          windowHours,
          forceCarbon,
        });
        if (detail.run.errorMessage) {
          appendTerminalLine(tabId, `[WARN] ${detail.run.errorMessage}`);
        }
        finalizeTerminalJob(tabId, detail.run.status === 'FAILED' ? 1 : 0);
        setLatestThreatDetail(detail);
        setSelectedThreatDetail(detail);
        await refreshThreatIntelState(detail.run.id);
        showActionFeedback(
          `360° Threat Audit finished: ${detail.run.overallSeverity} (${detail.run.intrusionVerdict})`,
          detail.run.overallSeverity === 'HIGH' || detail.run.overallSeverity === 'CRITICAL'
            ? 'error'
            : 'success',
          6000
        );
      } catch (err) {
        failTerminalJob(tabId, `360° Threat Audit failed: ${String(err)}`);
        showActionFeedback(`360° Threat Audit failed: ${String(err)}`, 'error', 7000);
      } finally {
        if (activeThreatAuditTabIdRef.current === tabId) {
          activeThreatAuditTabIdRef.current = null;
        }
        setThreatAuditProgress(null);
        setIsRunningThreatAudit(false);
      }
    },
    [
      appendTerminalLine,
      failTerminalJob,
      finalizeTerminalJob,
      isRunningThreatAudit,
      refreshThreatIntelState,
      saveTabToDb,
      showActionFeedback,
      threatSettings?.preferences.tier2Model,
    ]
  );

  const handleEscalateThreatRunToCarbon = useCallback(
    async (runId: string) => {
      if (isRunningThreatAudit) return;
      const tabId = `threat-deep-${Date.now()}`;
      const startMs = Date.now();
      const tier2Short =
        threatSettings?.preferences.tier2Model === 'gemini-4-carbon' ? 'Carbon' : 'Neon';
      const title = `360° Deep Investigate (Gemini 4 ${tier2Short})`;
      const newTab: TerminalTab = {
        id: tabId,
        title,
        lines: [
          `[PanoramaSRE] Starting ${title} for run ${runId}...`,
          `[${new Date().toLocaleTimeString()}] [INFO] [INIT] Fetching 72h forensic timeline & invoking Gemini 4 ${tier2Short}...`,
        ],
        isRunning: true,
        createdAt: new Date().toISOString(),
        pageScope: 'security',
        source: 'ui',
        abortable: false,
        autoOpenTier: 'B',
      };
      activeThreatAuditTabIdRef.current = tabId;
      threatAuditLazyTabCreatedRef.current = false;
      registerStreamTab(newTab);
      setIsRunningThreatAudit(true);
      setThreatAuditProgress({
        runId: tabId,
        stage: 'init',
        label: `Deep ${tier2Short} Investigation`,
        message: `Preparing 72h forensic fetch & Gemini 4 ${tier2Short} deep escalation...`,
        level: 'INFO',
        startedAtMs: startMs,
      });
      showActionFeedback(`Escalating to 72h Deep Gemini 4 ${tier2Short} investigation...`, 'pending');
      try {
        const detail = await invoke<ThreatRunDetailDto>('escalate_threat_run_to_carbon', {
          runId,
        });
        if (detail.run.errorMessage) {
          appendTerminalLine(tabId, `[WARN] ${detail.run.errorMessage}`);
        }
        finalizeTerminalJob(tabId, detail.run.status === 'FAILED' ? 1 : 0);
        setLatestThreatDetail(detail);
        setSelectedThreatDetail(detail);
        await refreshThreatIntelState(detail.run.id);
        showActionFeedback(
          `${tier2Short} Deep Investigation complete: ${detail.run.overallSeverity} (${detail.run.intrusionVerdict})`,
          detail.run.overallSeverity === 'HIGH' || detail.run.overallSeverity === 'CRITICAL'
            ? 'error'
            : 'success',
          6000
        );
      } catch (err) {
        failTerminalJob(tabId, `${tier2Short} escalation failed: ${String(err)}`);
        showActionFeedback(`${tier2Short} escalation failed: ${String(err)}`, 'error', 7000);
      } finally {
        if (activeThreatAuditTabIdRef.current === tabId) {
          activeThreatAuditTabIdRef.current = null;
        }
        setThreatAuditProgress(null);
        setIsRunningThreatAudit(false);
      }
    },
    [
      appendTerminalLine,
      failTerminalJob,
      finalizeTerminalJob,
      isRunningThreatAudit,
      refreshThreatIntelState,
      saveTabToDb,
      showActionFeedback,
      threatSettings?.preferences.tier2Model,
    ]
  );

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    listen<ThreatAuditProgressEvent>('sre://threat-audit-progress', (event) => {
      const payload = event.payload;
      if (!payload) return;

      setThreatAuditProgress((prev) => ({
        runId: payload.runId,
        stage: payload.stage,
        label: payload.label,
        message: payload.message,
        level: payload.level,
        startedAtMs:
          prev && (prev.runId === payload.runId || prev.stage === 'init')
            ? prev.startedAtMs
            : Date.now(),
      }));

      const ts = payload.timestamp
        ? new Date(payload.timestamp).toLocaleTimeString()
        : new Date().toLocaleTimeString();
      const line = `[${ts}] [${payload.level}] [${payload.stage.toUpperCase()}] ${payload.message}`;
      let targetTabId = activeThreatAuditTabIdRef.current;

      if (!targetTabId) {
        targetTabId = `threat-audit-${payload.runId}`;
        activeThreatAuditTabIdRef.current = targetTabId;
        threatAuditLazyTabCreatedRef.current = true;
        const bgTab: TerminalTab = {
          id: targetTabId,
          title: '360° Threat & Zero Trust Audit (Scheduled)',
          lines: [`[PanoramaSRE] Streaming scheduled threat audit ${payload.runId}...`, line],
          isRunning: payload.stage !== 'done' && payload.stage !== 'error',
          createdAt: new Date().toISOString(),
          pageScope: 'security',
          source: 'scheduled',
          abortable: false,
          autoOpenTier: 'C',
        };
        registerStreamTab(bgTab, { focusTab: false, upsert: true });
      } else {
        appendTerminalLine(targetTabId, line);
      }

      if (payload.stage === 'done' || payload.stage === 'error') {
        if (threatAuditLazyTabCreatedRef.current && targetTabId) {
          finalizeTerminalJob(targetTabId, payload.stage === 'error' ? 1 : 0);
          activeThreatAuditTabIdRef.current = null;
          threatAuditLazyTabCreatedRef.current = false;
          setThreatAuditProgress(null);
        }
      }
    }).then((unsub) => {
      unlistenProgress = unsub;
    });

    return () => {
      if (unlistenProgress) unlistenProgress();
    };
  }, [appendTerminalLine, finalizeTerminalJob, saveTabToDb]);

  const handleTriggerServiceAction = useCallback(
    async (app: DiscoveredApp, action: Exclude<ServiceLifecycleAction, 'deploy'>) => {
      if (action === 'stop') {
        const confirmed = await ask(
          `Stop and remove the ${app.manifest.displayName} container (${app.manifest.containerName || app.manifest.slug}) on wsh.panoramadr.com?`,
          {
            title: `Confirm Stop ${app.manifest.displayName}`,
            kind: 'warning',
            okLabel: 'Stop Container',
            cancelLabel: 'Cancel',
          }
        );
        if (!confirmed) return;
      }

      const cmdSpec = buildServiceScriptCommand(
        app.workspacePath,
        app.manifest.sre.deployScript || './deploy-unifi-siem.ps1',
        action
      );
      const jobId = `deploy-${app.manifest.slug}-${action}-${Date.now()}`;
      setSelectedReleaseAppSlug(app.manifest.slug);
      setTrackedDeployJobIds((prev) => ({ ...prev, [app.manifest.slug]: jobId }));
      const labelMap: Record<Exclude<ServiceLifecycleAction, 'deploy'>, string> = {
        verify_local: `${app.manifest.displayName}: Verify Local (-VerifyLocal)`,
        test: `${app.manifest.displayName}: Dry-Run Preflight (-Test)`,
        status: `${app.manifest.displayName}: Container Status (-Status)`,
        stop: `${app.manifest.displayName}: Stop Service Container (-Stop)`,
      };
      const title = labelMap[action];

      const newTab: TerminalTab = {
        id: jobId,
        title,
        lines: [`[PanoramaSRE] Invoking ${cmdSpec.scriptPath}...`],
        isRunning: true,
        createdAt: new Date().toISOString(),
        pageScope: 'releases',
        source: 'ui',
        appSlug: app.manifest.slug,
        abortable: true,
        autoOpenTier: action === 'verify_local' || action === 'status' ? 'B' : 'A',
      };
      registerStreamTab(newTab);

      try {
        await runStreamJob({
          jobId,
          label: title,
          command: cmdSpec.command,
          args: cmdSpec.args,
          workingDir: cmdSpec.workingDir,
          lockType: cmdSpec.lockType,
          onLine: (line) => {
            appendTerminalLine(jobId, line);
          },
          onComplete: async (exitCode) => {
            finalizeTerminalJob(jobId, exitCode);
            if (action !== 'verify_local') {
              await refreshWshTelemetry(true);
            }
            if (app.manifest.slug === 'unifi-siem') {
              await refreshThreatIntelState(selectedThreatDetail?.run?.id);
            }
            showActionFeedback(
              exitCode === 0 ? `${title} completed cleanly.` : `${title} exited with code ${exitCode}.`,
              exitCode === 0 ? 'success' : 'error',
              6000
            );
          },
          onError: (err) => {
            failTerminalJob(jobId, `${app.manifest.displayName} action failed: ${err}`);
          },
        });
      } catch (err) {
        failTerminalJob(jobId, `${app.manifest.displayName} action failed: ${String(err)}`);
      }
    },
    [
      appendTerminalLine,
      failTerminalJob,
      finalizeTerminalJob,
      refreshThreatIntelState,
      refreshWshTelemetry,
      saveTabToDb,
      selectedThreatDetail?.run?.id,
      showActionFeedback,
    ]
  );

  const refreshSmokeHistory = useCallback(async (): Promise<SmokeTestRun[]> => {
    try {
      const history = await invoke<SmokeTestRun[]>('get_smoke_test_history', {
        workspaceRoot: getWorkspaceRoot(),
        limit: 500,
      });
      setSmokeRuns(history);
      setSmokeError(null);
      if (history.length > 0) {
        const input = buildSyncAlertEvaluationInput({
          maintenanceSuppressed: maintenanceSuppressedRef.current,
          latestSmokeRun: history[0],
        });
        void invoke('evaluate_and_notify_sync', { input }).catch(() => {});
      }
      return history;
    } catch (err) {
      setSmokeError(String(err));
      return [];
    }
  }, [getWorkspaceRoot]);
  refreshSmokeHistoryRef.current = refreshSmokeHistory;

  const refreshDeployTelemetry = useCallback(async () => {
    setIsRefreshingTelemetry(true);
    try {
      const [historyRes, diskRes] = await Promise.allSettled([
        invoke<DeployTelemetryRunRecord[]>('get_deploy_telemetry_history', {
          workspaceRoot: getWorkspaceRoot(),
          limit: 1000,
        }),
        invoke<LocalDockerDiskUsage>('get_local_docker_disk_usage'),
      ]);
      if (historyRes.status === 'fulfilled') {
        setDeployTelemetryRuns(historyRes.value);
      }
      if (diskRes.status === 'fulfilled') {
        setDockerDiskUsage(diskRes.value);
      }
    } finally {
      setIsRefreshingTelemetry(false);
    }
  }, [getWorkspaceRoot]);
  refreshDeployTelemetryRef.current = refreshDeployTelemetry;

  const actionableTelemetryAlerts = useMemo(
    () =>
      computeActionableTelemetryAlerts({
        apps,
        runs: deployTelemetryRuns,
        dockerDiskUsage,
        dismissedIds: dismissedTelemetryAlertIds,
      }),
    [apps, deployTelemetryRuns, dockerDiskUsage, dismissedTelemetryAlertIds]
  );
  const telemetryWarningCount = actionableTelemetryAlerts.length;
  const telemetryAlertSeverity: 'error' | 'warning' = actionableTelemetryAlerts.some(
    (a) => a.severity === 'error'
  )
    ? 'error'
    : 'warning';

  const handleDismissTelemetryAlert = useCallback((alertId: string) => {
    setDismissedTelemetryAlertIds((prev) => {
      if (prev.includes(alertId)) return prev;
      const next = [...prev, alertId].slice(-100);
      try {
        localStorage.setItem('panorama_sre_dismissed_telemetry_alerts', JSON.stringify(next));
      } catch {
        // Ignore storage quota errors
      }
      return next;
    });
  }, []);

  const handleRunSmokeTests = useCallback(
    (triggeredBy = 'sre-manual', forceSms = false): Promise<number> => {
      if (isSmokeRunning) return Promise.resolve(-1);
      const jobId = `smoke-${Date.now()}`;
      const smokeDir = `${getWorkspaceRoot()}\\PanoramaDrSuite\\tools\\smoke-tester`;
      setIsSmokeRunning(true);
      setActiveSmokeJobId(jobId);
      setSmokeError(null);

      const newTab: TerminalTab = {
        id: jobId,
        title: `Smoke Tests (${triggeredBy})`,
        lines: [`[PanoramaSRE] Starting Production Smoke Suite (trigger=${triggeredBy})...`],
        isRunning: true,
        createdAt: new Date().toISOString(),
        pageScope: 'smoke',
        source: triggeredBy.startsWith('sre-scheduled') ? 'scheduled' : 'ui',
        abortable: true,
        autoOpenTier: triggeredBy.startsWith('sre-scheduled') ? 'C' : 'B',
      };
      registerStreamTab(newTab);

      const scriptArgs = [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        './Run-SmokeTests.ps1',
        '-TargetUrl',
        'https://wsh.panoramadr.com',
        '-TriggeredBy',
        triggeredBy,
      ];
      if (forceSms) {
        scriptArgs.push('-ForceSms');
      }

      return runStreamJob({
        jobId,
        label: `Smoke Tests (${triggeredBy})`,
        command: 'pwsh.exe',
        args: scriptArgs,
        workingDir: smokeDir,
        lockType: 'None',
        onLine: (line) => {
          appendTerminalLine(jobId, line);
        },
        onComplete: (exitCode) => {
          finalizeTerminalJob(jobId, exitCode);
          setIsSmokeRunning(false);
          void refreshSmokeHistory();
        },
        onError: (err) => {
          failTerminalJob(jobId, `Smoke tests failed: ${err}`);
          setSmokeError(String(err));
          setIsSmokeRunning(false);
          void refreshSmokeHistory();
        },
      }).catch(() => -1);
    },
    [
      appendTerminalLine,
      failTerminalJob,
      finalizeTerminalJob,
      getWorkspaceRoot,
      isSmokeRunning,
      refreshSmokeHistory,
      saveTabToDb,
    ]
  );

  const handlePruneBuildKitCache = useCallback(() => {
    if (isPruningBuildKitCache) return;
    const jobId = `prune-buildkit-${Date.now()}`;
    setIsPruningBuildKitCache(true);
    const newTab: TerminalTab = {
      id: jobId,
      title: 'Prune BuildKit Cache (>3d)',
      lines: [
        '[PanoramaSRE] Pruning Docker BuildKit cache layers unused for more than 3 days (72h, --all)...',
      ],
      isRunning: true,
      createdAt: new Date().toISOString(),
      pageScope: 'telemetry',
      source: 'ui',
      abortable: true,
      autoOpenTier: 'A',
    };
    registerStreamTab(newTab);

    void runStreamJob({
      jobId,
      label: 'Prune BuildKit Cache (>3d)',
      command: 'docker',
      args: ['buildx', 'prune', '--all', '--filter', 'until=72h', '-f'],
      workingDir: getWorkspaceRoot(),
      lockType: 'None',
      onLine: (line) => {
        appendTerminalLine(jobId, line);
      },
      onComplete: (exitCode) => {
        finalizeTerminalJob(jobId, exitCode);
        setIsPruningBuildKitCache(false);
        void refreshDeployTelemetry();
        showActionFeedback(
          exitCode === 0
            ? 'Pruned BuildKit cache layers unused for more than 3 days.'
            : `BuildKit cache prune exited ${exitCode}.`,
          exitCode === 0 ? 'success' : 'error',
          5000
        );
      },
      onError: (err) => {
        failTerminalJob(jobId, `BuildKit cache prune failed: ${err}`);
        setIsPruningBuildKitCache(false);
        void refreshDeployTelemetry();
        showActionFeedback(`BuildKit cache prune failed: ${err}`, 'error', 6000);
      },
    });
  }, [
    appendTerminalLine,
    failTerminalJob,
    finalizeTerminalJob,
    getWorkspaceRoot,
    isPruningBuildKitCache,
    refreshDeployTelemetry,
    saveTabToDb,
    showActionFeedback,
  ]);

  const handleRegisterSmokeSchedule = useCallback(() => {
    const jobId = `smoke-schedule-${Date.now()}`;
    const smokeDir = `${getWorkspaceRoot()}\\PanoramaDrSuite\\tools\\smoke-tester`;
    const newTab: TerminalTab = {
      id: jobId,
      title: 'Register 4x/Day Smoke Schedule',
      lines: ['[PanoramaSRE] Registering 4x daily smoke test task (08:00, 13:00, 17:00, 22:00)...'],
      isRunning: true,
      createdAt: new Date().toISOString(),
      pageScope: 'smoke',
      source: 'ui',
      abortable: true,
      autoOpenTier: 'B',
    };
    registerStreamTab(newTab);

    runStreamJob({
      jobId,
      label: 'Register 4x/Day Smoke Schedule',
      command: 'pwsh.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', './Run-SmokeTests.ps1', '-RegisterDailyTask'],
      workingDir: smokeDir,
      lockType: 'None',
      onLine: (line) => appendTerminalLine(jobId, line),
      onComplete: (exitCode) => finalizeTerminalJob(jobId, exitCode),
      onError: (err) => failTerminalJob(jobId, `Failed to register schedule: ${err}`),
    });
  }, [appendTerminalLine, failTerminalJob, finalizeTerminalJob, getWorkspaceRoot, saveTabToDb]);

  useEffect(() => {
    if (apps.length > 0) {
      refreshSmokeHistory();
    }
  }, [apps.length, refreshSmokeHistory]);

  useEffect(() => {
    if (activeTab === 'smoke') {
      void refreshSmokeHistory();
    }
  }, [activeTab, refreshSmokeHistory]);

  // Listen for IPC-triggered Smoke Test executions (AI Agent MCP or Windows Task Scheduler bridge)
  useEffect(() => {
    let unlistenStart: (() => void) | undefined;
    let unlistenLine: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;

    listen<{ jobId: string; triggeredBy: string; targetUrl: string }>('sre://smoke-run-start', (event) => {
      const { jobId, triggeredBy } = event.payload || {
        jobId: `smoke-mcp-${Date.now()}`,
        triggeredBy: 'mcp-agent',
      };
      const isScheduled =
        triggeredBy === 'scheduled' || triggeredBy.startsWith('scheduled:');
      const actorLabel = isScheduled ? 'OS Scheduled Task' : 'AI Agent';
      setIsSmokeRunning(true);
      setActiveSmokeJobId(jobId);
      setSmokeError(null);

      const newTab: TerminalTab = {
        id: jobId,
        title: `Smoke Tests (${triggeredBy})`,
        lines: [`[PanoramaSRE] ${actorLabel} triggered Production Smoke Suite (${triggeredBy})...`],
        isRunning: true,
        createdAt: new Date().toISOString(),
        pageScope: 'smoke',
        source: isScheduled ? 'scheduled' : 'mcp',
        abortable: false,
        autoOpenTier: 'C',
      };
      registerStreamTab(newTab);
      showActionFeedback(`${actorLabel} started Production Smoke Suite (${triggeredBy})`, 'pending');
    }).then((unsub) => {
      unlistenStart = unsub;
    });

    listen<{ jobId: string; line: string }>('sre://smoke-run-line', (event) => {
      if (event.payload?.jobId && typeof event.payload?.line === 'string') {
        appendTerminalLine(event.payload.jobId, event.payload.line);
      }
    }).then((unsub) => {
      unlistenLine = unsub;
    });

    listen<{ jobId: string; exitCode: number; run?: SmokeTestRun }>('sre://smoke-run-complete', (event) => {
      const { jobId, exitCode, run } = event.payload || {};
      if (jobId) {
        finalizeTerminalJob(jobId, typeof exitCode === 'number' ? exitCode : 0);
      }
      setIsSmokeRunning(false);
      refreshSmokeHistory();
      refreshMcpStatus();
      if (run) {
        const isScheduled =
          run.triggeredBy === 'scheduled' || run.triggeredBy?.startsWith('scheduled:');
        const suiteLabel = isScheduled ? 'Scheduled Smoke Suite' : 'AI Agent Smoke Suite';
        if (run.failed === 0) {
          showActionFeedback(
            `${suiteLabel} passed (${run.passed}/${run.total} checks)`,
            'success',
            5000
          );
        } else {
          showActionFeedback(
            `${suiteLabel} detected ${run.failed} failure(s) (${run.passed}/${run.total} passed)`,
            'error',
            8000
          );
        }
      }
    }).then((unsub) => {
      unlistenComplete = unsub;
    });

    return () => {
      if (unlistenStart) unlistenStart();
      if (unlistenLine) unlistenLine();
      if (unlistenComplete) unlistenComplete();
    };
  }, [appendTerminalLine, finalizeTerminalJob, refreshMcpStatus, refreshSmokeHistory, saveTabToDb, showActionFeedback]);

  const runManualTraceStream = useCallback(
    async (
      pageScope: NavSectionId,
      idPrefix: string,
      title: string,
      initialLines: string[],
      task: (appendLine: (line: string) => void) => Promise<void>
    ) => {
      const jobId = `${idPrefix}-${Date.now()}`;
      const newTab: TerminalTab = {
        id: jobId,
        title,
        lines: initialLines,
        isRunning: true,
        createdAt: new Date().toISOString(),
        pageScope,
        source: 'ui',
        abortable: false,
        autoOpenTier: 'B',
      };
      registerStreamTab(newTab, { focusTab: false });

      try {
        await task((line) => appendTerminalLine(jobId, line));
        finalizeTerminalJob(jobId, 0);
      } catch (err) {
        failTerminalJob(jobId, `${title} error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [appendTerminalLine, failTerminalJob, finalizeTerminalJob, saveTabToDb]
  );

  const handleManualTopologyRefresh = useCallback(() => {
    void runManualTraceStream(
      'topology',
      'topology-refresh',
      'Refresh WSH Network & Firewall Snapshot',
      ['[PanoramaSRE] Probing WSH host network bindings, iptables, and container isolation...'],
      async (append) => {
        await refreshWshTelemetry(true);
        append('[PASS] WSH network, Docker CGNAT bridges, and firewall snapshot refreshed.');
      }
    );
  }, [refreshWshTelemetry, runManualTraceStream]);

  const handleManualDietPiRefresh = useCallback(() => {
    void runManualTraceStream(
      'dietpi',
      'dietpi-refresh',
      'Refresh DietPi Host & APT Snapshot',
      ['[PanoramaSRE] Re-hashing local cron manifests/scripts and querying DietPi host telemetry...'],
      async (append) => {
        await Promise.all([refreshLocalManifests(), refreshWshTelemetry(true)]);
        append('[PASS] Local cron script hashes, DietPi host health, systemd units, and package list refreshed.');
      }
    );
  }, [refreshLocalManifests, refreshWshTelemetry, runManualTraceStream]);

  const handleTriggerCronAction = useCallback(
    (req: CronActionRequest) => {
      const suiteRoot = req.app?.workspacePath
        ? resolveSuiteRootFromAppPath(req.app.workspacePath)
        : getWorkspaceRoot();
      let execSpec: ReturnType<typeof buildCronSyncCommand>;
      try {
        execSpec = buildCronSyncCommand(suiteRoot, {
          appPath: req.type === 'sync-all' ? undefined : req.app?.workspacePath,
          allApps: req.type === 'sync-all',
          testMode: req.type === 'dry-run',
          testRunJobId: req.type === 'test-run' ? req.jobId : undefined,
        });
      } catch (err) {
        showActionFeedback(
          `Cron command validation failed: ${err instanceof Error ? err.message : String(err)}`,
          'error',
          6000
        );
        return;
      }

      const actionLabel =
        req.type === 'sync-all'
          ? 'Sync All Suite Crons (/etc/cron.d/panorama-*)'
          : req.type === 'dry-run'
          ? `Dry-Run Crons (-Test): ${req.app?.manifest.displayName || 'App'}`
          : req.type === 'test-run'
          ? `Test Run Heartbeat (${req.jobId}): ${req.app?.manifest.displayName || 'App'}`
          : `Sync Crons: ${req.app?.manifest.displayName || 'App'}`;

      const jobId = `cron-${req.type}-${Date.now()}`;
      const newTab: TerminalTab = {
        id: jobId,
        title: actionLabel,
        lines: [`[PanoramaSRE] Executing ${actionLabel}...`],
        isRunning: true,
        createdAt: new Date().toISOString(),
        pageScope: 'dietpi',
        source: 'ui',
        appSlug: req.app?.manifest.slug,
        abortable: true,
        autoOpenTier: req.type === 'dry-run' ? 'B' : 'A',
      };
      registerStreamTab(newTab);
      setIsCronActionBusy(true);

      runStreamJob({
        jobId,
        label: actionLabel,
        command: execSpec.command,
        args: execSpec.args,
        workingDir: execSpec.workingDir,
        lockType: execSpec.lockType,
        onLine: (line) => {
          appendTerminalLine(jobId, line);
        },
        onComplete: async (exitCode) => {
          setIsCronActionBusy(false);
          finalizeTerminalJob(jobId, exitCode);
          if (req.type !== 'dry-run') {
            await Promise.all([refreshLocalManifests(), refreshWshTelemetry(true)]);
          } else {
            await refreshLocalManifests();
          }
          if (exitCode === 0) {
            showActionFeedback(`${actionLabel} completed cleanly.`, 'success', 5000);
          } else {
            showActionFeedback(`${actionLabel} exited with code ${exitCode}.`, 'error', 7000);
          }
        },
        onError: (err) => {
          setIsCronActionBusy(false);
          failTerminalJob(jobId, `Cron action failed: ${err}`);
        },
      });
    },
    [
      appendTerminalLine,
      failTerminalJob,
      finalizeTerminalJob,
      getWorkspaceRoot,
      refreshLocalManifests,
      refreshWshTelemetry,
      saveTabToDb,
      showActionFeedback,
    ]
  );

  const handleManualSslRefresh = useCallback(() => {
    void runManualTraceStream(
      'edge',
      'ssl-probe',
      'Re-probe 7-Domain SSL Fleet',
      ['[PanoramaSRE] Probing Edge & Internal TLS endpoints across PanoramaDrSuite fleet...'],
      async (append) => {
        await refreshSslStatus();
        append('[PASS] SSL fleet dual-probe verification completed.');
      }
    );
  }, [refreshSslStatus, runManualTraceStream]);

  const handleManualBackupRefresh = useCallback(() => {
    void runManualTraceStream(
      'backups',
      'backups-refresh',
      'Refresh GFS Backup Ledger & Archives',
      ['[PanoramaSRE] Scanning suite SQLite backup ledger and local hydration archives...'],
      async (append) => {
        await refreshBackupLedger();
        append('[PASS] GFS backup ledger and archive telemetry updated.');
      }
    );
  }, [refreshBackupLedger, runManualTraceStream]);

  const handleManualSmokeRefresh = useCallback(() => {
    void runManualTraceStream(
      'smoke',
      'smoke-refresh',
      'Reload Smoke Test History',
      ['[PanoramaSRE] Reloading smoke test run ledger from SQLite & suite results...'],
      async (append) => {
        await refreshSmokeHistory();
        append('[PASS] Smoke test run history refreshed.');
      }
    );
  }, [refreshSmokeHistory, runManualTraceStream]);

  const handleEmitSettingsStream = useCallback(
    (title: string, lines: string[], exitCode = 0) => {
      const nowIso = new Date().toISOString();
      const tab: TerminalTab = {
        id: `settings-op-${Date.now()}`,
        title,
        lines,
        isRunning: false,
        exitCode,
        createdAt: nowIso,
        finishedAt: nowIso,
        pageScope: 'settings',
        source: 'ui',
        abortable: false,
        autoOpenTier: 'B',
      };
      registerStreamTab(tab, { focusTab: false });
    },
    [registerStreamTab]
  );

  const handleRunAuditCommand = useCallback(
    (
      actionLabel: string,
      cmd: string,
      args: string[],
      originScope: NavSectionId = 'topology'
    ) => {
      const jobId = `audit-${Date.now()}`;
      const newTab: TerminalTab = {
        id: jobId,
        title: actionLabel,
        lines: [`[PanoramaSRE] Executing ${actionLabel}...`],
        isRunning: true,
        createdAt: new Date().toISOString(),
        pageScope: originScope,
        source: 'ui',
        abortable: true,
        autoOpenTier: 'A',
      };
      registerStreamTab(newTab);

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
    },
    [appendTerminalLine, failTerminalJob, finalizeTerminalJob, registerStreamTab]
  );

  const sslMinDays = sslFleet ? sslFleet.min_days_remaining : null;
  const sslAlertCount =
    hasCompletedInitialSync && sslFleet
      ? sslFleet.critical_count + sslFleet.expiring_soon_count + sslFleet.drift_count
      : 0;
  const sslAlertSeverity: 'error' | 'warning' | null =
    sslFleet && sslFleet.critical_count > 0 ? 'error' : sslAlertCount > 0 ? 'warning' : null;
  const hardeningTotalCount = topology.securityAudit.invariants.length;
  const hardeningPassingCount = Math.max(0, hardeningTotalCount - securityViolationCount);

  const navLabelMap: Record<NavItem, string> = {
    hud: 'Command HUD',
    agent: 'Otto AI SRE',
    releases: 'Releases & Drift',
    telemetry: 'Build Telemetry',
    smoke: 'Smoke Tests',
    security: 'Threat & Zero Trust',
    hardening: 'WSH Hardening',
    edge: 'PKI & Certificates',
    'opt-ins': 'SMS Opt-Ins (10DLC)',
    topology: 'Topology & Ingress',
    'unifi-zbf': 'UniFi Network & ZBF',
    dietpi: 'DietPi Host & Crons',
    backups: 'Backups & DR',
    'local-dev': 'Local Dev',
    settings: 'Settings & Logs',
  };

  const unifiedAlerts: UnifiedAlertItem[] = [];
  if (hasCompletedInitialSync) {
    if (unhealthyCount > 0) {
      unifiedAlerts.push({
        id: 'alert-unhealthy-apps',
        domain: 'Apps',
        severity: 'critical',
        title: `${unhealthyCount} Production App${unhealthyCount === 1 ? '' : 's'} Unhealthy`,
        detail: apps
          .filter((a) => isAppUnhealthy(a, healthEvalOpts))
          .map((a) => a.manifest.displayName)
          .join(', '),
        actionLabel: 'Inspect Releases',
        onAction: () => {
          const firstBad = apps.find((a) => isAppUnhealthy(a, healthEvalOpts));
          navigateTo('releases', {
            appSlug: firstBad?.manifest.slug,
            returnFromCurrent: true,
          });
        },
      });
    }
    if (securityViolationCount > 0) {
      unifiedAlerts.push({
        id: 'alert-wsh-hardening',
        domain: 'Hardening',
        severity: 'critical',
        title: `${securityViolationCount} WSH Security Invariant Violation${securityViolationCount === 1 ? '' : 's'}`,
        detail: failingInvariants.map((i) => `${i.id}: ${i.title}`).join(' · '),
        actionLabel: 'Open Hardening',
        onAction: () =>
          navigateTo('hardening', {
            returnFromCurrent: true,
          }),
      });
    }
    if (sslAlertCount > 0 && sslFleet) {
      unifiedAlerts.push({
        id: 'alert-ssl-fleet',
        domain: 'PKI & TLS',
        severity: sslFleet.critical_count > 0 ? 'critical' : 'warning',
        title: `${sslAlertCount} Certificate Alert${sslAlertCount === 1 ? '' : 's'} (min ${sslFleet.min_days_remaining}d)`,
        detail: `${sslFleet.critical_count} critical (<7d), ${sslFleet.expiring_soon_count} expiring (<30d), ${sslFleet.drift_count} SHA256 drift.`,
        actionLabel: 'Open PKI Matrix',
        onAction: () =>
          navigateTo('edge', {
            returnFromCurrent: true,
          }),
      });
    }
    if (backupFailureCount > 0) {
      unifiedAlerts.push({
        id: 'alert-backups',
        domain: 'Backups & DR',
        severity: 'critical',
        title: `${backupFailureCount} GFS Backup Failure${backupFailureCount === 1 ? '' : 's'}`,
        detail: 'Latest nightly GFS database snapshot reported failed application DBs.',
        actionLabel: 'Open Backups',
        onAction: () =>
          navigateTo('backups', {
            returnFromCurrent: true,
          }),
      });
    }
    if (smokeFailureCount > 0) {
      unifiedAlerts.push({
        id: 'alert-smoke',
        domain: 'Smoke Tests',
        severity: 'critical',
        title: `${smokeFailureCount} Failed Smoke Assertion${smokeFailureCount === 1 ? '' : 's'}`,
        detail: 'Latest 41-step production smoke run reported assertions failing.',
        actionLabel: 'Inspect Smoke Run',
        onAction: () =>
          navigateTo('smoke', {
            returnFromCurrent: true,
          }),
      });
    }
    if (threatBadge.count > 0 && threatBadge.severity) {
      unifiedAlerts.push({
        id: 'alert-threat-intel',
        domain: 'Threat & ZT',
        severity: threatBadge.severity === 'error' ? 'critical' : 'warning',
        title:
          topThreatSummary?.title ||
          `${threatBadge.count} Actionable Security Finding${threatBadge.count === 1 ? '' : 's'}`,
        detail:
          topThreatSummary?.detail ||
          'Unmitigated Cloudflare / UniFi SIEM findings or rogue LAN clients require triage.',
        actionLabel: topThreatSummary?.focusId ? 'Inspect High Threat' : 'Open Threat SOC',
        onAction: () =>
          navigateTo('security', {
            tab: topThreatSummary?.tab,
            highlightId: topThreatSummary?.focusId,
            returnFromCurrent: true,
          }),
      });
    }
    if (pendingQuarantinedEmails.length > 0) {
      unifiedAlerts.push({
        id: 'alert-threat-quarantine',
        domain: 'ZT Quarantine',
        severity: 'warning',
        title: `${pendingQuarantinedEmails.length} Zero Trust Access Email${
          pendingQuarantinedEmails.length === 1 ? '' : 's'
        } Pending Quarantine Approval`,
        detail: `${pendingQuarantinedEmails
          .slice(0, 3)
          .map((q) => q.email)
          .join(', ')}${
          pendingQuarantinedEmails.length > 3
            ? ` (+${pendingQuarantinedEmails.length - 3} more)`
            : ''
        } synced from wsh.panoramadr.com Cloudflare Access policies.`,
        actionLabel: 'Review Quarantine',
        onAction: () =>
          navigateTo('security', {
            tab: 'allowlist',
            returnFromCurrent: true,
          }),
      });
    }
    if (dietpiBadges.totalCount > 0 && dietpiBadges.severity) {
      unifiedAlerts.push({
        id: 'alert-dietpi-host',
        domain: 'DietPi & Crons',
        severity: dietpiBadges.severity === 'error' ? 'critical' : 'warning',
        title: `${dietpiBadges.totalCount} DietPi Host / Cron Alert${dietpiBadges.totalCount === 1 ? '' : 's'}`,
        detail: 'Reboot required, APT upgrades pending, or host cron drift detected.',
        actionLabel: 'Open DietPi Host',
        onAction: () =>
          navigateTo('dietpi', {
            returnFromCurrent: true,
          }),
      });
    }
  }

  const pendingOttoProposals = useMemo(
    () => ottoProposals.filter((p) => p.status === 'PENDING_APPROVAL'),
    [ottoProposals]
  );

  const totalAttentionCount = unifiedAlerts.length + pendingOttoProposals.length;
  const totalAttentionSeverity: 'error' | 'warning' | null = unifiedAlerts.some(
    (a) => a.severity === 'critical'
  )
    ? 'error'
    : unifiedAlerts.length > 0 || pendingOttoProposals.length > 0
    ? 'warning'
    : null;

  const commandPaletteEntries: CommandPaletteEntry[] = [
    ...(
      [
        ['hud', 'Command HUD', 'Executive fleet overview health telemetry'],
        ['agent', 'Otto AI SRE', 'Otto AI SRE Ask agent traces policy matrix kill switch'],
        ['releases', 'Releases & Drift', 'Deploy rollback buildx edge cloudflare'],
        ['telemetry', 'Build Telemetry', 'Docker BuildKit cache budget metrics'],
        ['smoke', 'Smoke Tests', 'Production verification assertions suite'],
        ['security', 'Threat & Zero Trust', '360 audit WAF actors SIEM Gemini'],
        ['hardening', 'WSH Hardening', 'Docker iptables firewall CGNAT SEC invariants'],
        ['edge', 'PKI & Certificates', 'SSL TLS Let\'s Encrypt ACME dual-probe'],
        ['opt-ins', 'SMS Opt-Ins (10DLC)', 'Parakith Twilio A2P compliance'],
        ['topology', 'Topology & Ingress', 'Cloudflare tunnel Lighttpd ports'],
        ['unifi-zbf', 'UniFi Network & ZBF', 'VLAN firewall rules LAN device baseline'],
        ['dietpi', 'DietPi Host & Crons', 'Raspberry Pi kernel APT reboot crontab'],
        ['backups', 'Backups & DR', 'SQLite GFS restore hydration snapshots'],
        ['local-dev', 'Local Dev', 'Dev servers supervisor Next.js MCP ports'],
        ['settings', 'Settings & Logs', 'Governance polling SIEM notifications SQLite'],
      ] as Array<[NavItem, string, string]>
    ).map(([id, label, keywords]) => ({
      id: `view-${id}`,
      kind: 'View',
      label,
      hint: navLabelMap[id],
      keywords,
      category: 'view' as const,
      onExecute: () => navigateTo(id),
    })),
    {
      id: 'view-dietpi-interfaces',
      kind: 'View',
      label: 'Host Interfaces & Sockets (DietPi)',
      hint: 'DietPi Host & Crons',
      keywords: 'eth0 lo netfilter sockets hardware gatekeeper suricata',
      category: 'view' as const,
      onExecute: () =>
        navigateTo('dietpi', { tab: 'interfaces', returnFromCurrent: true }),
    },
    {
      id: 'view-lan-baseline',
      kind: 'View',
      label: 'UniFi LAN Device Baseline',
      hint: 'UniFi Network & ZBF',
      keywords: 'mac lan baseline trusted devices clients',
      category: 'view' as const,
      onExecute: () =>
        navigateTo('unifi-zbf', { tab: 'baseline', returnFromCurrent: true }),
    },
    ...apps.map((app) => ({
      id: `app-${app.manifest.slug}`,
      kind: 'App Release',
      label: `${app.manifest.displayName} (/${app.manifest.slug})`,
      hint: `:${app.manifest.port}`,
      keywords: `${app.manifest.slug} ${app.manifest.appId} ${app.manifest.hostingTarget ?? 'wsh-docker'}`,
      category: 'app' as const,
      onExecute: () =>
        navigateTo('releases', {
          appSlug: app.manifest.slug,
          returnFromCurrent: true,
        }),
    })),
    ...failingInvariants.map((inv) => ({
      id: `inv-${inv.id}`,
      kind: 'Violation',
      label: `${inv.id}: ${inv.title}`,
      hint: 'WSH Hardening',
      keywords: `invariant violation security ${inv.id} ${inv.title}`,
      category: 'invariant' as const,
      onExecute: () =>
        navigateTo('hardening', {
          returnFromCurrent: true,
        }),
    })),
    {
      id: 'act-sync-now',
      kind: 'Action',
      label: 'Sync Full Suite Telemetry Now',
      keywords: 'refresh sync telemetry',
      category: 'action',
      onExecute: () => void syncFullTelemetry(true, true, activeTab, true),
    },
    {
      id: 'act-run-smoke',
      kind: 'Action',
      label: 'Run 41-Step Production Smoke Suite',
      keywords: 'smoke test verify production',
      category: 'action',
      onExecute: () => void handleRunSmokeTests('sre-manual', false),
    },
    {
      id: 'act-run-threat-audit',
      kind: 'Action',
      label: 'Run 360° Threat & Zero Trust Audit',
      keywords: 'threat security audit gemini',
      category: 'action',
      onExecute: () => void handleRunThreatAuditNow(24, false),
    },
    {
      id: 'act-toggle-console',
      kind: 'Console',
      label: isDrawerOpen ? 'Collapse Output Console Dock' : 'Open Output Console Dock',
      hint: 'Ctrl+`',
      keywords: 'console output terminal stream drawer',
      category: 'console',
      onExecute: () => {
        if (isDrawerOpen) handleCloseDrawer();
        else handleOpenInBottomConsole();
      },
    },
    {
      id: 'act-open-logs',
      kind: 'Logs',
      label: 'Open Full System Logs (Settings > Logs)',
      keywords: 'logs history audit sqlite',
      category: 'console',
      onExecute: () =>
        navigateTo('settings', {
          tab: 'logs',
          returnFromCurrent: true,
        }),
    },
    {
      id: 'act-otto-kill-switch',
      kind: 'Safety',
      label: ottoStatus?.lifecycle.killSwitchActive
        ? 'Resume Otto AI SRE (Release Kill-Switch)'
        : 'Pause Otto AI SRE (Global Emergency Kill-Switch)',
      hint: 'Otto AI SRE',
      keywords: 'otto agent kill switch pause emergency stop',
      category: 'action',
      onExecute: () =>
        void handleToggleOttoKillSwitch(!ottoStatus?.lifecycle.killSwitchActive),
    },
    {
      id: 'act-otto-policies',
      kind: 'Governance',
      label: 'Open Otto Policy Matrix & L4 Guardrails',
      hint: 'Otto AI SRE > Policy Matrix',
      keywords: 'otto policy l0 l1 l2 l3 l4 guardrails circuit breaker',
      category: 'view',
      onExecute: () =>
        navigateTo('agent', { tab: 'policies', returnFromCurrent: true }),
    },
    {
      id: 'act-open-db-storage',
      kind: 'Storage',
      label: 'Local SQLite Storage & VACUUM (Settings)',
      hint: 'Settings > Sync & Storage',
      keywords: 'sqlite wal vacuum storage db compact',
      category: 'action',
      onExecute: () =>
        navigateTo('settings', {
          tab: 'sync',
          returnFromCurrent: true,
        }),
    },
  ];

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden font-sans">
      {/* Upper Area: Sidebar Navigation + Main Application Content */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden relative">
        <SidebarRail
          activeTab={activeTab}
          onSelectTab={(tab) => navigateTo(tab)}
          unhealthyCount={unhealthyCount}
          backupFailureCount={backupFailureCount}
          behindReleasesCount={behindReleasesCount}
          telemetryWarningCount={telemetryWarningCount}
          telemetryAlertSeverity={telemetryAlertSeverity}
          dietpiPackagesCount={dietpiPackagesCount}
          dietpiAlertCount={dietpiBadges.totalCount}
          dietpiAlertSeverity={dietpiBadges.severity}
          securityViolationCount={securityViolationCount}
          hardeningPassingCount={hardeningPassingCount}
          hardeningTotalCount={hardeningTotalCount}
          topologyAlertCount={topologyBadges.ingressTotalCount}
          topologyAlertSeverity={topologyBadges.ingressSeverity}
          smokeFailureCount={smokeFailureCount}
          unreadOptInsCount={optInSnapshot?.unreadCount ?? 0}
          threatAlertCount={
            threatBadge.count > 0 ? threatBadge.count : pendingQuarantinedEmails.length
          }
          threatAlertSeverity={
            threatBadge.severity ?? (pendingQuarantinedEmails.length > 0 ? 'warning' : null)
          }
          sslAlertCount={sslAlertCount}
          sslAlertSeverity={sslAlertSeverity}
          sslMinDays={sslMinDays}
          devRunningCount={devRunningCount}
          totalAppCount={apps.length}
          totalAttentionCount={totalAttentionCount}
          totalAttentionSeverity={totalAttentionSeverity}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => {
            setSidebarAutoCollapsed(false);
            setSidebarCollapsed((c) => !c);
          }}
          showAgentNav={true}
          ottoPhase={ottoStatus?.lifecycle.state ?? 'IDLE'}
          ottoBadgeCount={ottoStatus?.lifecycle.pendingApprovalsCount ?? 0}
          ottoBadgeSeverity={
            ottoStatus?.lifecycle.killSwitchActive ||
            ottoStatus?.lifecycle.circuitBreakerState === 'TRIPPED'
              ? 'error'
              : (ottoStatus?.lifecycle.pendingApprovalsCount ?? 0) > 0
              ? 'warning'
              : 'info'
          }
          isInitialSyncComplete={hasCompletedInitialSync}
        />

        <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
          <TopLiveSyncBar
            networkPosture={networkPosture}
            devRunningCount={devRunningCount}
            totalAppCount={apps.length}
            evaluableAppCount={evaluableAppCount}
            prodHealthyCount={prodHealthyCount}
            unhealthyCount={unhealthyCount}
            lastSyncTime={lastSyncTime}
            lastSecurityAuditTime={lastSecurityAuditTime}
            securityAuditInterval={securityAuditInterval}
            isSyncing={isManualSyncing || isInitialSyncing}
            isInitialSyncComplete={hasCompletedInitialSync}
            hasResolvedPosture={hasResolvedPosture}
            onRefresh={() => syncFullTelemetry(true, true, activeTab, true)}
            backupFailureCount={backupFailureCount}
            onNavigateToBackups={() => navigateTo('backups')}
            securityViolationCount={securityViolationCount}
            onNavigateToTopology={() => navigateTo('topology')}
            mcpStatus={mcpStatus}
            onNavigateToDev={() => navigateTo('local-dev')}
            totalAttentionCount={totalAttentionCount}
            totalAttentionSeverity={totalAttentionSeverity}
            onOpenCommandPalette={() => setIsPaletteOpen(true)}
            onOpenAlertsDrawer={() => setIsAlertsDrawerOpen(true)}
            ottoLifecycle={ottoStatus?.lifecycle ?? null}
            onOpenOtto={(sub) =>
              navigateTo('agent', { tab: sub || 'ask', returnFromCurrent: true })
            }
            onInspectOttoTrace={(traceId) => {
              setOttoInspectTrace((prev) => ({ id: traceId, nonce: prev.nonce + 1 }));
              navigateTo('agent', { tab: 'traces', returnFromCurrent: true });
            }}
            onToggleOttoKillSwitch={(active) => void handleToggleOttoKillSwitch(active)}
            onAbortOttoStep={() => void handleAbortOttoStep()}
          />

          <div
            className={`flex-1 min-h-0 flex ${
              responsiveDockLayout.effectiveDockSide === 'right' ? 'flex-row' : 'flex-col'
            } overflow-hidden`}
          >
          <div
            ref={mainScrollContainerRef}
            className="flex-1 min-w-0 min-h-0 overflow-y-auto"
          >
          {returnTo && (
            <ReturnBreadcrumbPill
              returnTo={returnTo}
              onNavigateBack={() => {
                const target = returnTo.view;
                setReturnTo(null);
                navigateTo(target);
              }}
            />
          )}
          {activeTab === 'hud' && (
            <CommandCenterView
              apps={apps}
              appliances={appliances}
              wshSnapshot={wshSnapshot}
              tunnelVersionStatus={tunnelVersionStatus}
              sslFleet={sslFleet}
              backupLedger={backupLedger}
              isBackupIncidentDismissed={isBackupIncidentDismissed}
              optInSnapshot={optInSnapshot}
              cronSummary={fleetCronSummary}
              smokeRuns={smokeRuns}
              latestThreatRun={latestThreatDetail?.run ?? threatRuns[0] ?? null}
              threatAlertCount={threatBadge.count}
              threatAlertSeverity={threatBadge.severity}
              topThreatTitle={topThreatSummary?.title ?? null}
              topThreatDetail={topThreatSummary?.detail ?? null}
              topThreatTargetTab={
                topThreatSummary?.tab === 'external' || topThreatSummary?.tab === 'internal'
                  ? topThreatSummary.tab
                  : 'overview'
              }
              topThreatFocusId={topThreatSummary?.focusId ?? null}
              pendingQuarantinedEmails={pendingQuarantinedEmails}
              terminalTabs={terminalTabs}
              isLoading={apps.length === 0}
              isInitialSyncComplete={hasCompletedInitialSync}
              networkPosture={networkPosture}
              onNavigateToBackups={() => navigateTo('backups', { returnFromCurrent: true })}
              onNavigateToOptIns={() => navigateTo('opt-ins', { returnFromCurrent: true })}
              onNavigateToCrons={() =>
                navigateTo('dietpi', { tab: 'crons', returnFromCurrent: true })
              }
              onNavigateToDietPi={() =>
                navigateTo('dietpi', { tab: 'host', returnFromCurrent: true })
              }
              onNavigateToRelease={(slug) =>
                navigateTo('releases', { appSlug: slug, returnFromCurrent: true })
              }
              onTriggerFullGfsBackup={() => handleTriggerFullGfsBackup('hud')}
              securityViolationCount={securityViolationCount}
              failingInvariants={failingInvariants}
              hardeningPassingCount={hardeningPassingCount}
              hardeningTotalCount={hardeningTotalCount}
              onReapplyHardening={() => handleReapplyHardening('hud')}
              onRunPenetrationAudit={() => handleRunPenetrationAudit('hud')}
              onNavigateToTopology={() => navigateTo('topology', { returnFromCurrent: true })}
              onNavigateToHardening={() => navigateTo('hardening', { returnFromCurrent: true })}
              onNavigateToThreat={(opts) =>
                navigateTo('security', {
                  tab: opts?.tab ?? topThreatSummary?.tab,
                  highlightId: opts?.focusId ?? topThreatSummary?.focusId,
                  returnFromCurrent: true,
                })
              }
              onNavigateToSmoke={() => navigateTo('smoke', { returnFromCurrent: true })}
              onNavigateToPki={() => navigateTo('edge', { returnFromCurrent: true })}
              isDeployingAll={isDeployingAll}
              onTriggerDeployAll={handleDeployAllApps}
              onOpenInBottomConsole={handleOpenInBottomConsole}
              onAbortJob={handleAbortJob}
              onClearTab={handleClearTab}
              ottoLifecycle={ottoStatus?.lifecycle ?? null}
              ottoSoaks={ottoSoaks}
              pendingOttoProposals={pendingOttoProposals}
              onOpenOtto={() => navigateTo('agent', { tab: 'ask', returnFromCurrent: true })}
              onOpenOttoApprovals={() =>
                navigateTo('agent', { tab: 'approvals', returnFromCurrent: true })
              }
              onAskOtto={openOttoWithContext}
            />
          )}

          {activeTab === 'agent' && (
            <OttoAgentView
              apps={apps}
              status={ottoStatus}
              policies={ottoPolicies}
              l4Invariants={ottoL4Invariants}
              traces={ottoTraces}
              proposals={ottoProposals}
              soaks={ottoSoaks}
              initialSubView={ottoNav.tab}
              initialSubViewNonce={ottoNav.nonce}
              pendingContextSeed={ottoPendingSeed.seed}
              pendingContextNonce={ottoPendingSeed.nonce}
              onConsumeContextSeed={() =>
                setOttoPendingSeed((prev) => ({ seed: null, nonce: prev.nonce }))
              }
              initialInspectTraceId={ottoInspectTrace.id}
              initialInspectTraceNonce={ottoInspectTrace.nonce}
              onRefreshOtto={refreshOttoState}
              onToggleKillSwitch={handleToggleOttoKillSwitch}
              onAbortStep={handleAbortOttoStep}
              onResetCircuitBreaker={handleResetOttoCircuitBreaker}
              onUpdatePolicyMode={handleUpdateOttoPolicyMode}
              onDecideProposal={handleDecideOttoProposal}
              onCancelSoak={handleCancelOttoSoak}
              onEvaluateSteadyState={handleEvaluateOttoSteadyState}
              onQueueBuildKitPruneProposal={handleQueueBuildKitPruneProposal}
              onAskOtto={openOttoWithContext}
              onNavigateToSettings={() =>
                navigateTo('settings', { tab: 'security', returnFromCurrent: true })
              }
            />
          )}

          {activeTab === 'local-dev' && (
            <LocalDevView
              apps={apps}
              terminalTabs={terminalTabs}
              mcpStatus={mcpStatus}
              onStart={handleStartDevServer}
              onStartAuthAndApp={handleStartAuthAndApp}
              onStop={handleStopDevServer}
              onRestart={handleRestartDevServer}
              onStartAll={handleStartAllDevServers}
              onStopAll={handleStopAllDevServers}
              onOpenInBottomConsole={handleOpenInBottomConsole}
              onAbortJob={handleAbortJob}
              onClearTab={handleClearTab}
              isActionPending={actionFeedback?.type === 'pending'}
              actionMessage={actionFeedback?.message}
            />
          )}

          {activeTab === 'topology' && (
            <TopologyStacksView
              snapshot={wshSnapshot}
              apps={apps}
              terminalTabs={terminalTabs}
              tunnelVersionStatus={tunnelVersionStatus}
              isCheckingTunnelVersion={isCheckingTunnelVersion}
              isLoading={isManualSyncing || isInitialSyncing}
              initialTab={topologyNav.tab}
              initialTabNonce={topologyNav.nonce}
              onRefresh={handleManualTopologyRefresh}
              onNavigateToUnifi={() =>
                navigateTo('unifi-zbf', { tab: 'flow', returnFromCurrent: true })
              }
              onNavigateToHardening={() =>
                navigateTo('hardening', { returnFromCurrent: true })
              }
              onNavigateToDietPiInterfaces={() =>
                navigateTo('dietpi', { tab: 'interfaces', returnFromCurrent: true })
              }
              onOpenInBottomConsole={handleOpenInBottomConsole}
              onAbortJob={handleAbortJob}
              onClearTab={handleClearTab}
              onRunAuditCommand={(actionLabel, cmd, args) =>
                handleRunAuditCommand(actionLabel, cmd, args, 'topology')
              }
              onTriggerTunnelAction={handleTriggerTunnelAction}
            />
          )}

          {activeTab === 'hardening' && (
            <WshHardeningView
              snapshot={wshSnapshot}
              apps={apps}
              onRunAuditCommand={(actionLabel, cmd, args) =>
                handleRunAuditCommand(actionLabel, cmd, args, 'hardening')
              }
              onRunPenetrationAudit={() => handleRunPenetrationAudit('hardening')}
              onReapplyHardening={() => handleReapplyHardening('hardening')}
              onNavigateToTopology={() =>
                navigateTo('topology', {
                  returnFromCurrent: true,
                })
              }
              onNavigateToSecurity={() =>
                navigateTo('security', {
                  returnFromCurrent: true,
                })
              }
              onNavigateToUnifi={() =>
                navigateTo('unifi-zbf', {
                  returnFromCurrent: true,
                })
              }
            />
          )}

          {activeTab === 'unifi-zbf' && (
            <UnifiNetworkZbfView
              unifiBaseUrl={threatSettings?.preferences.unifiBaseUrl || 'https://ui.panoramadr.com'}
              initialTab={unifiNav.tab}
              initialTabNonce={unifiNav.nonce}
              initialSearch={unifiNav.search}
              onLanBaselineMutated={() => void refreshThreatIntelState(selectedThreatDetail?.run?.id)}
              onNavigateToTopology={() =>
                navigateTo('topology', {
                  returnFromCurrent: true,
                })
              }
              onNavigateToHardening={() =>
                navigateTo('hardening', {
                  returnFromCurrent: true,
                })
              }
              onNavigateToSecurity={() =>
                navigateTo('security', {
                  returnFromCurrent: true,
                })
              }
            />
          )}

          {activeTab === 'dietpi' && (
            <DietPiHostView
              snapshot={wshSnapshot}
              apps={apps}
              cronSummary={fleetCronSummary}
              subTab={dietpiSubTab}
              onSelectSubTab={setDietpiSubTab}
              isCronActionBusy={isCronActionBusy}
              terminalTabs={terminalTabs}
              isLoading={isLoadingWsh || isInitialSyncing}
              onRefresh={handleManualDietPiRefresh}
              onTriggerCronAction={handleTriggerCronAction}
              onTriggerReboot={handleRebootWshWithVerification}
              onNavigateToTopology={() =>
                navigateTo('topology', { returnFromCurrent: true })
              }
              onNavigateToHardening={() =>
                navigateTo('hardening', { returnFromCurrent: true })
              }
              isRebooting={isHostRebooting}
              suricataStatus={ottoStatus?.suricata ?? null}
              onAskOtto={openOttoWithContext}
              onOpenInBottomConsole={handleOpenInBottomConsole}
              onAbortJob={handleAbortJob}
              onClearTab={handleClearTab}
              onTriggerAction={(actionLabel, cmd, args) => {
                const jobId = `action-${Date.now()}`;
                const newTab: TerminalTab = {
                  id: jobId,
                  title: actionLabel,
                  lines: [`[PanoramaSRE] Executing ${actionLabel}...`],
                  isRunning: true,
                  createdAt: new Date().toISOString(),
                  pageScope: 'dietpi',
                  source: 'ui',
                  abortable: true,
                  autoOpenTier: 'A',
                };
                registerStreamTab(newTab);

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
                    const snap = await invoke<WshSnapshot>('fetch_wsh_snapshot', { mode: '--fast', force: true }).catch(() => null);
                    if (snap) {
                      setWshSnapshot(snap);
                      setLastSecurityAuditTime(new Date().toLocaleTimeString());
                    }

                    // If an upgrade just ran and host reports a reboot is required, offer to reboot immediately
                    if (actionLabel.toLowerCase().includes('upgrade') && exitCode === 0 && snap?.reboot_required) {
                      try {
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
              selectedAppSlug={selectedReleaseAppSlug}
              onSelectAppSlug={setSelectedReleaseAppSlug}
              trackedDeployJobIds={trackedDeployJobIds}
              onTrackDeployJob={(slug, jobId) =>
                setTrackedDeployJobIds((prev) => ({ ...prev, [slug]: jobId }))
              }
              onDismissDeployJob={(slug) =>
                setTrackedDeployJobIds((prev) => {
                  const next = { ...prev };
                  delete next[slug];
                  return next;
                })
              }
              onOpenInBottomConsole={handleOpenInBottomConsole}
              onOpenInConsoleDrawer={(jobId) => handleOpenInBottomConsole(jobId)}
              onAbortJob={handleAbortJob}
              onCloseTab={handleCloseTab}
              onClearTab={handleClearTab}
              onTriggerDeploy={(app, bump, allowDirty, edgeMode) =>
                executeAppDeploy(app, bump, allowDirty, false, edgeMode)
              }
              onTriggerDeployAll={handleDeployAllApps}
              isDeployingAll={isDeployingAll}
              onHaltDeployments={handleHaltDeployments}
              onTriggerRollback={(app, tag) => {
                void executeAppRollback(app, tag);
              }}
              batchSmokeFailureReport={batchSmokeFailureReport}
              onDismissBatchSmokeFailure={() => setBatchSmokeFailureReport(null)}
              onRollbackBatchTargets={(targets) => {
                void handleRollbackBatchTargets(targets);
              }}
              onOpenSmokeTests={() => navigateTo('smoke', { returnFromCurrent: true })}
              onOpenTelemetry={(slug) =>
                navigateTo('telemetry', {
                  appSlug: slug || 'all',
                  returnFromCurrent: true,
                })
              }
              wshSnapshot={wshSnapshot}
              isInitialSyncComplete={hasCompletedInitialSync}
              networkPosture={networkPosture}
              onTriggerServiceAction={(app, action) => void handleTriggerServiceAction(app, action)}
              onReapplyHardening={() => handleReapplyHardening('releases')}
              ottoSoaks={ottoSoaks}
              onStartManualSoak={(app) => void handleStartManualOttoSoak(app)}
              onCancelSoak={(soakId) => void handleCancelOttoSoak(soakId)}
              onAskOtto={openOttoWithContext}
            />
          )}

          {activeTab === 'telemetry' && (
            <BuildTelemetryView
              apps={apps}
              runs={deployTelemetryRuns}
              dockerDiskUsage={dockerDiskUsage}
              terminalTabs={terminalTabs}
              selectedAppSlug={selectedTelemetryAppSlug}
              onSelectAppSlug={setSelectedTelemetryAppSlug}
              isRefreshing={isRefreshingTelemetry}
              isPruningCache={isPruningBuildKitCache}
              onRefresh={() => {
                void refreshDeployTelemetry();
              }}
              onPruneBuildKitCache={handlePruneBuildKitCache}
              onInspectConsoleSession={(sessionId) => handleOpenInBottomConsole(sessionId)}
              onOpenInReleases={(slug) =>
                navigateTo('releases', { appSlug: slug, returnFromCurrent: true })
              }
              actionableAlerts={actionableTelemetryAlerts}
              onDismissAlert={handleDismissTelemetryAlert}
              onAskOtto={openOttoWithContext}
            />
          )}

          {activeTab === 'backups' && (
            <BackupsRecoveryView
              apps={apps}
              ledger={backupLedger}
              terminalTabs={terminalTabs}
              isLoading={isManualSyncing || isInitialSyncing}
              isInitialSyncComplete={hasCompletedInitialSync}
              onRefresh={handleManualBackupRefresh}
              onTriggerFullGfsBackup={() => handleTriggerFullGfsBackup('backups')}
              onTriggerAppBackup={handleTriggerAppBackup}
              onApplyLocalBackup={handleApplyLocalBackup}
              onRestoreRemoteBackup={handleRestoreRemoteBackup}
              onOpenInBottomConsole={handleOpenInBottomConsole}
              onAbortJob={handleAbortJob}
              onClearTab={handleClearTab}
              isIncidentDismissed={isBackupIncidentDismissed}
              onDismissIncident={handleDismissBackupIncident}
              onAskOtto={openOttoWithContext}
            />
          )}

          {activeTab === 'smoke' && (
            <SmokeTestsView
              runs={smokeRuns}
              isRunning={isSmokeRunning}
              streamLines={terminalTabs.find((t) => t.id === activeSmokeJobId)?.lines || []}
              terminalTabs={terminalTabs}
              onRunNow={(force) =>
                handleRunSmokeTests(force ? 'sre-manual:force-sms' : 'sre-manual', Boolean(force))
              }
              onRefreshHistory={handleManualSmokeRefresh}
              onRegisterOsSchedule={handleRegisterSmokeSchedule}
              onOpenInBottomConsole={handleOpenInBottomConsole}
              onAbortJob={handleAbortJob}
              onClearTab={handleClearTab}
              lastError={smokeError}
              onAskOtto={openOttoWithContext}
            />
          )}

          {activeTab === 'edge' && (
            <EdgePkiView
              snapshot={wshSnapshot}
              sslFleet={sslFleet}
              terminalTabs={terminalTabs}
              isLoadingSsl={isLoadingSsl}
              onRefreshSsl={handleManualSslRefresh}
              onTriggerRenewal={handleTriggerSslRenewal}
              onOpenInBottomConsole={handleOpenInBottomConsole}
              onAbortJob={handleAbortJob}
              onClearTab={handleClearTab}
            />
          )}

          {activeTab === 'security' && (
            <ThreatIntelView
              latestDetail={selectedThreatDetail}
              runs={threatRuns}
              settings={threatSettings}
              isRunningAudit={isRunningThreatAudit}
              auditProgress={threatAuditProgress}
              onRunAuditNow={handleRunThreatAuditNow}
              onEscalateRunToCarbon={handleEscalateThreatRunToCarbon}
              onSelectRunId={handleSelectThreatRunId}
              onRefreshAll={() => refreshThreatIntelState(selectedThreatDetail?.run?.id)}
              onNavigateToSettings={() =>
                navigateTo('settings', {
                  tab: 'security',
                  returnFromCurrent: true,
                })
              }
              onNavigateToSiemRelease={() =>
                navigateTo('releases', {
                  appSlug: 'unifi-siem',
                  returnFromCurrent: true,
                })
              }
              onNavigateToHardening={() =>
                navigateTo('hardening', {
                  returnFromCurrent: true,
                })
              }
              onNavigateToUnifiZbf={(tab = 'flow', searchQuery = '') =>
                navigateTo('unifi-zbf', {
                  tab,
                  highlightId: searchQuery,
                  returnFromCurrent: true,
                })
              }
              hardeningPassingCount={hardeningPassingCount}
              hardeningTotalCount={hardeningTotalCount}
              securityViolationCount={securityViolationCount}
              wshSnapshot={wshSnapshot}
              terminalTabs={terminalTabs}
              onOpenInBottomConsole={handleOpenInBottomConsole}
              onAbortJob={handleAbortJob}
              onClearTab={handleClearTab}
              initialSubView={threatNav.tab}
              initialFocusId={threatNav.focusId}
              initialNavNonce={threatNav.nonce}
              quarantinedAccessEmails={quarantinedAccessEmails}
              onQuarantineChanged={() => {
                void refreshThreatIntelState(selectedThreatDetail?.run?.id);
              }}
              onAskOtto={openOttoWithContext}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              initialTab={settingsNav.tab}
              initialTabNonce={settingsNav.nonce}
              terminalTabs={terminalTabs}
              onWorkspaceChanged={() => syncFullTelemetry(true, true, 'settings', true)}
              pollInterval={tier1PollInterval}
              onPollIntervalChanged={(val) => setTier1PollInterval(val)}
              securityAuditInterval={securityAuditInterval}
              onSecurityAuditIntervalChanged={(val) => setSecurityAuditInterval(val)}
              lastHourlyCheckTime={lastHourlyCheckTime}
              isCheckingHourly={isCheckingTunnelVersion || isLoadingSsl}
              onRunHourlyChecksNow={async () => {
                await runHourlyChecksNow(true);
                handleEmitSettingsStream('Run Tier 4 Hourly Checks', [
                  '[PanoramaSRE] Executing Tier 4 hourly checks...',
                  '[INFO] Checked upstream cloudflared GitHub release (ETag), 5-domain SSL fleet, and GFS backup ledger.',
                  '[PASS] Tier 4 hourly telemetry refreshed.',
                ]);
              }}
              onOpenInBottomConsole={handleOpenInBottomConsole}
              onAbortJob={handleAbortJob}
              onClearTab={handleClearTab}
              onEmitSettingsStream={handleEmitSettingsStream}
              onThreatSettingsChanged={(dto) => setThreatSettings(dto)}
              wshSnapshot={wshSnapshot}
              onNavigateToRelease={(slug) =>
                navigateTo('releases', { appSlug: slug, returnFromCurrent: true })
              }
              onNavigateToHardening={() =>
                navigateTo('hardening', { returnFromCurrent: true })
              }
              autoOpenMode={autoOpenMode}
              onChangeAutoOpenMode={setAutoOpenMode}
              dockSide={dockSide}
              onChangeDockSide={setDockSide}
              sidebarCollapsed={sidebarCollapsed}
              onChangeSidebarCollapsed={(val) => {
                setSidebarAutoCollapsed(false);
                setSidebarCollapsed(val);
              }}
              suricataStatus={ottoStatus?.suricata ?? null}
              onRefreshSuricata={() => void refreshOttoState()}
              onNavigateToAgentPolicies={() =>
                navigateTo('agent', { tab: 'policies', returnFromCurrent: true })
              }
            />
          )}

          {activeTab === 'opt-ins' && (() => {
            const parakithApp =
              apps.find((a) => a.manifest.slug === 'parakith') || parakithAppRef.current;
            return (
              <OptInComplianceView
                snapshot={optInSnapshot}
                isSyncing={isSyncingOptIns}
                workspacePath={parakithApp?.workspacePath}
                d1DatabaseId={parakithApp?.manifest.cloudflare?.d1DatabaseId}
                onSyncNow={() =>
                  refreshOptIns(
                    parakithApp?.workspacePath,
                    parakithApp?.manifest.cloudflare?.d1DatabaseName,
                    false
                  )
                }
                onExport={handleExportOptIns}
                onDeleteRecord={handleDeleteOptIn}
              />
            );
          })()}

          {activeTab !== 'hud' &&
            activeTab !== 'agent' &&
            activeTab !== 'local-dev' &&
            activeTab !== 'releases' &&
            activeTab !== 'telemetry' &&
            activeTab !== 'topology' &&
            activeTab !== 'unifi-zbf' &&
            activeTab !== 'dietpi' &&
            activeTab !== 'edge' &&
            activeTab !== 'security' &&
            activeTab !== 'hardening' &&
            activeTab !== 'backups' &&
            activeTab !== 'smoke' &&
            activeTab !== 'opt-ins' &&
            activeTab !== 'settings' && (
              <div className="flex-1 flex items-center justify-center p-12 text-slate-500 text-sm">
                Module <span className="font-mono text-emerald-400 mx-1">{activeTab}</span> will hydrate in subsequent milestones.
              </div>
            )}
          </div>

          <SreEventsConsolePanel
            isOpen={isDrawerOpen}
            onClose={handleCloseDrawer}
            tabs={terminalTabs}
            activeTabId={activeTerminalTabId}
            onSelectTab={(id) => {
              if (id === unreadFailureTabId) {
                setUnreadFailureTabId(null);
              }
              setActiveTerminalTabId(id);
            }}
            onCloseTab={handleCloseTab}
            onClearTab={handleClearTab}
            onPurgeAllTabs={handlePurgeAllTabs}
            onAbortJob={handleAbortJob}
            actionFeedback={actionFeedback}
            onClearFeedback={() => setActionFeedback(null)}
            eventsHistory={eventsHistory}
            onClearEvents={() => setEventsHistory([])}
            runningJobsCount={terminalTabs.filter((t) => t.isRunning).length}
            networkPosture={networkPosture}
            activePageScope={activeTab}
            dockSide={responsiveDockLayout.effectiveDockSide}
            onChangeDockSide={setDockSide}
            canDockRight={responsiveDockLayout.canDockRight}
            dockHeight={dockHeight}
            onChangeDockHeight={setDockHeight}
            dockWidth={dockWidth}
            onChangeDockWidth={setDockWidth}
            autoOpenMode={autoOpenMode}
            onChangeAutoOpenMode={setAutoOpenMode}
            scopeMode={scopeMode}
            onChangeScopeMode={setScopeMode}
            unreadFailureTabId={unreadFailureTabId}
            onOpenFullSystemLogs={() =>
              navigateTo('settings', {
                tab: 'logs',
                returnFromCurrent: true,
              })
            }
          />
          </div>
        </main>
      </div>

      {/* Permanent 36px Live Activity Ticker & Drawer Control Footer */}
      <ConsoleFooterTicker
        isOpen={isDrawerOpen}
        networkPosture={networkPosture}
        tabs={terminalTabs}
        runningJobsCount={terminalTabs.filter((t) => t.isRunning).length}
        autoOpenMode={autoOpenMode}
        unreadFailureTabId={unreadFailureTabId}
        actionFeedback={actionFeedback}
        onClearFeedback={() => setActionFeedback(null)}
        onToggleDrawer={() => {
          if (isDrawerOpen) {
            handleCloseDrawer();
          } else {
            handleOpenInBottomConsole();
          }
        }}
        onAbortJob={handleAbortJob}
        onInspectUnreadFailure={(tabId) => handleOpenInBottomConsole(tabId)}
      />

      {/* Global Ctrl+K Command Palette & Unified Alerts Slide-Over Drawer */}
      <CommandPaletteModal
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        entries={commandPaletteEntries}
      />
      <AlertsInboxDrawer
        isOpen={isAlertsDrawerOpen}
        onClose={() => setIsAlertsDrawerOpen(false)}
        alerts={unifiedAlerts}
        pendingOttoProposals={pendingOttoProposals}
        onOpenOttoApprovals={() => {
          setIsAlertsDrawerOpen(false);
          navigateTo('agent', { tab: 'approvals', returnFromCurrent: true });
        }}
        onSnoozeOttoProposal={(proposalId) => void handleDecideOttoProposal(proposalId, 'SNOOZE_24H')}
        onAskOttoProposal={(proposal) => {
          setIsAlertsDrawerOpen(false);
          openOttoWithContext({
            kind: 'general',
            entityId: proposal.id,
            originView: 'hud',
            title: `Review L3 Proposal: ${proposal.title}`,
            severity: proposal.severity,
            summary: proposal.rcaSummary,
            metadata: {
              proposalId: proposal.id,
              actionId: proposal.actionId,
              assetSlug: proposal.assetSlug,
              severity: proposal.severity,
              paramsJson: proposal.paramsJson,
            },
            starterPrompts: [
              `Walk me through L3 proposal "${proposal.title}" (${proposal.actionId} on ${proposal.assetSlug}). What is the blast radius, verification plan, and safest way to execute or decline it?`,
              `Are there any hidden risks or prerequisite checks before approving ${proposal.actionId} on ${proposal.assetSlug}?`,
            ],
          });
        }}
      />
    </div>
  );
};

export default App;
