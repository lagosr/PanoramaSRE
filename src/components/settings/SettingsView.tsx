import React, { useState, useEffect, useCallback } from 'react';
import {
  Sliders,
  Shield,
  Terminal,
  Database,
  Check,
  RefreshCw,
  Info,
  Trash2,
  Search,
  Sun,
  Moon,
  Laptop,
  FolderOpen,
  Copy,
  Pin,
  ArrowDownToLine,
  Bell,
  Send,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { CustomSelect } from '../ui/CustomSelect';
import { WorkStreamContainer } from '../ui/WorkStreamContainer';
import { UnifiSiemSettingsCard } from './UnifiSiemSettingsCard';
import { SegmentedControl, StatusBadge, ToggleSwitch } from '@lagosr/panorama-ui-kit';
import { formatConsoleLine, stripAnsiCodes } from '../layout/ConsoleColorizer';
import { useSmartAutoScroll } from '../../hooks/useSmartAutoScroll';
import { APP_VERSION_INFO } from '../../lib/version';
import type { UnifiSiemAction } from '../../lib/script-adapters';
import {
  PushoverPreferences,
  PushoverSendReceipt,
  PushoverSettingsViewDto,
  SaveThreatIntelSettingsInput,
  TerminalTab,
  ThreatIntelPreferences,
  ThreatIntelSettingsViewDto,
  WshSnapshot,
} from '../../lib/types';
import { useTheme } from '../../context/ThemeContext';

type ConnectorCheckStatus = 'idle' | 'testing' | 'pass' | 'fail';

interface ConnectorDiagnosticRow {
  id: 'cloudflare' | 'gemini' | 'unifi' | 'wsh';
  label: string;
  surface:
    | 'External (Cloudflare)'
    | 'AI Engine (Gemini 4)'
    | 'Internal LAN (UniFi)'
    | 'Internal Host (WSH)';
  status: ConnectorCheckStatus;
  durationMs?: number;
  detail: string;
}

const INITIAL_CONNECTOR_DIAGNOSTICS: ConnectorDiagnosticRow[] = [
  {
    id: 'cloudflare',
    label: 'Cloudflare Perimeter & Zero Trust',
    surface: 'External (Cloudflare)',
    status: 'idle',
    detail: 'Ready — verifies token scope, account, zones, Tunnels, IP Intel, and Audit logs.',
  },
  {
    id: 'gemini',
    label: 'Gemini 4 Security AI Engine',
    surface: 'AI Engine (Gemini 4)',
    status: 'idle',
    detail: 'Ready — tests structured JSON brief schema handshake on the configured Tier 1 model.',
  },
  {
    id: 'unifi',
    label: 'UniFi CloudKey Integration API',
    surface: 'Internal LAN (UniFi)',
    status: 'idle',
    detail: 'Ready — verifies X-API-Key against local UniFi Network sites, devices, and clients.',
  },
  {
    id: 'wsh',
    label: 'WSH Origin & PanoramaAuth SSH',
    surface: 'Internal Host (WSH)',
    status: 'idle',
    detail: 'Ready — runs read-only SSH probe for containers, PanoramaAuth SQLite, and UniFi CEF.',
  },
];

interface SettingsViewProps {
  terminalTabs?: TerminalTab[];
  onWorkspaceChanged?: () => void;
  pollInterval?: string;
  onPollIntervalChanged?: (interval: string) => void;
  securityAuditInterval?: string;
  onSecurityAuditIntervalChanged?: (interval: string) => void;
  lastHourlyCheckTime?: string | null;
  onRunHourlyChecksNow?: () => void;
  isCheckingHourly?: boolean;
  onOpenInBottomConsole?: (tabId?: string) => void;
  onAbortJob?: (tabId: string) => void;
  onClearTab?: (tabId: string) => void;
  onEmitSettingsStream?: (title: string, lines: string[], exitCode?: number) => void;
  onThreatSettingsChanged?: (dto: ThreatIntelSettingsViewDto) => void;
  wshSnapshot?: WshSnapshot | null;
  onTriggerUnifiSiemAction?: (action: UnifiSiemAction) => void;
  onReapplyHardening?: () => void;
}

interface SystemLogEntry {
  id: number;
  category: string;
  level: string;
  message: string;
  metadata: string | null;
  created_at: string;
}

type SettingsTab = 'general' | 'ssh' | 'logs' | 'database';

export const SettingsView: React.FC<SettingsViewProps> = ({
  terminalTabs = [],
  onWorkspaceChanged,
  pollInterval: propPollInterval,
  onPollIntervalChanged,
  securityAuditInterval: propSecurityAuditInterval,
  onSecurityAuditIntervalChanged,
  lastHourlyCheckTime = null,
  onRunHourlyChecksNow,
  isCheckingHourly = false,
  onOpenInBottomConsole,
  onAbortJob,
  onClearTab,
  onEmitSettingsStream,
  onThreatSettingsChanged,
  wshSnapshot = null,
  onTriggerUnifiSiemAction,
  onReapplyHardening,
}) => {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [toastAlerts, setToastAlerts] = useState(true);
  const [pollInterval, setPollInterval] = useState<string>(() => {
    return propPollInterval || localStorage.getItem('panoramasre_tier1_poll_interval') || '15';
  });
  const [securityAuditInterval, setSecurityAuditInterval] = useState<string>(() => {
    return propSecurityAuditInterval || localStorage.getItem('panoramasre_security_audit_interval') || '5';
  });

  useEffect(() => {
    if (propPollInterval && propPollInterval !== pollInterval) {
      setPollInterval(propPollInterval);
    }
  }, [propPollInterval, pollInterval]);

  useEffect(() => {
    if (propSecurityAuditInterval && propSecurityAuditInterval !== securityAuditInterval) {
      setSecurityAuditInterval(propSecurityAuditInterval);
    }
  }, [propSecurityAuditInterval, securityAuditInterval]);
  const [isSaved, setIsSaved] = useState(false);
  const [workspaceRoot, setWorkspaceRoot] = useState<string>('');
  const [workspaceFeedback, setWorkspaceFeedback] = useState<string | null>(null);

  // Pushover Mobile Notifications & Trusted-Network Gate state
  const [pushoverDto, setPushoverDto] = useState<PushoverSettingsViewDto | null>(null);
  const [pushoverPrefs, setPushoverPrefs] = useState<PushoverPreferences>({
    enabled: true,
    device: '',
    updateSound: 'cosmic',
    failureSound: 'cosmic',
    recoverySound: 'cosmic',
    failurePriority: 0,
    expectedWshIp: '172.25.25.5',
    canaryHost: 'ui.panoramadr.com',
    categories: {
      systemUpdates: true,
      appAndHostFailures: true,
      smokeFailures: true,
      sslAlerts: true,
      backupFailures: true,
      optInEvents: false,
      recoveryAlerts: false,
    },
  });
  const [isLoadingPushover, setIsLoadingPushover] = useState<boolean>(false);
  const [isSavingPushover, setIsSavingPushover] = useState<boolean>(false);
  const [isTestingPushover, setIsTestingPushover] = useState<boolean>(false);
  const [pushoverFeedback, setPushoverFeedback] = useState<{
    text: string;
    tone: 'ok' | 'err';
  } | null>(null);

  // 360° Threat Intelligence & AI (Cloudflare + Gemini 4 + UniFi) state
  const [threatDto, setThreatDto] = useState<ThreatIntelSettingsViewDto | null>(null);
  const [threatPrefs, setThreatPrefs] = useState<ThreatIntelPreferences>({
    enabled: true,
    cadenceHours: 6,
    tier1Model: 'gemini-4-hydrogen',
    tier2Model: 'gemini-4-carbon',
    dailyCarbonCap: 6,
    pushoverThreshold: 'HIGH',
    unifiBaseUrl: 'https://ui.panoramadr.com',
  });
  const [windowsAutostart, setWindowsAutostart] = useState<boolean>(false);
  const [isSavingThreat, setIsSavingThreat] = useState<boolean>(false);
  const [isTestingAllConnectors, setIsTestingAllConnectors] = useState<boolean>(false);
  const [connectorResults, setConnectorResults] = useState<ConnectorDiagnosticRow[]>(
    INITIAL_CONNECTOR_DIAGNOSTICS
  );
  const [lastConnectorTestAt, setLastConnectorTestAt] = useState<string | null>(null);
  const [threatFeedback, setThreatFeedback] = useState<{
    text: string;
    tone: 'ok' | 'err';
  } | null>(null);

  const loadThreatSettings = useCallback(async () => {
    try {
      const dto = await invoke<ThreatIntelSettingsViewDto>('get_threat_intel_settings');
      setThreatDto(dto);
      setThreatPrefs(dto.preferences);
      setWindowsAutostart(Boolean(dto.windowsAutostartEnabled));
    } catch (err) {
      console.warn('Failed to load Threat Intel settings:', err);
    }
  }, []);

  useEffect(() => {
    void loadThreatSettings();
  }, [loadThreatSettings]);

  const handleToggleWindowsAutostart = async (enabled: boolean) => {
    try {
      const actual = await invoke<boolean>('set_windows_autostart', { enabled });
      setWindowsAutostart(actual);
      setThreatDto((prev) => (prev ? { ...prev, windowsAutostartEnabled: actual } : prev));
      setThreatFeedback({
        text: actual
          ? 'Windows login autostart enabled (--minimized)'
          : 'Windows login autostart removed',
        tone: 'ok',
      });
      setTimeout(() => setThreatFeedback(null), 3500);
    } catch (err) {
      setThreatFeedback({ text: `Autostart error: ${String(err)}`, tone: 'err' });
    }
  };

  const handleSaveThreatSettings = async () => {
    setIsSavingThreat(true);
    try {
      const input: SaveThreatIntelSettingsInput = {
        cfApiToken: null,
        cfAccountId: null,
        geminiApiKey: null,
        unifiApiKey: null,
        clearCfToken: false,
        clearGeminiKey: false,
        clearUnifiKey: false,
        preferences: threatPrefs,
      };
      const updated = await invoke<ThreatIntelSettingsViewDto>('save_threat_intel_settings', {
        input,
      });
      setThreatDto(updated);
      setThreatPrefs(updated.preferences);
      onThreatSettingsChanged?.(updated);
      setThreatFeedback({ text: '360° Threat Intel preferences saved to SQLite', tone: 'ok' });
      setTimeout(() => setThreatFeedback(null), 4000);
      onEmitSettingsStream?.('Save 360° Threat Intelligence Settings', [
        '[PanoramaSRE] Persisting 360° Threat Intel preferences...',
        `[INFO] Enabled: ${updated.preferences.enabled} | Cadence: ${updated.preferences.cadenceHours}h | Tier1=${updated.preferences.tier1Model} | Tier2=${updated.preferences.tier2Model}`,
        `[INFO] Keys configured: CF=${updated.cfConfigured} (${updated.cfSource}) | Gemini=${updated.geminiConfigured} (${updated.geminiSource}) | UniFi=${updated.unifiConfigured} (${updated.unifiSource})`,
        '[PASS] 360° Threat Intelligence settings saved cleanly.',
      ]);
    } catch (err) {
      const msg = String(err);
      setThreatFeedback({ text: `Save failed: ${msg}`, tone: 'err' });
      onEmitSettingsStream?.(
        'Save 360° Threat Intelligence Settings',
        [`[ERROR] Failed saving threat settings: ${msg}`],
        1
      );
    } finally {
      setIsSavingThreat(false);
    }
  };

  const handleTestAllThreatConnectors = async () => {
    if (isTestingAllConnectors) return;
    setIsTestingAllConnectors(true);
    setThreatFeedback(null);

    setConnectorResults(
      INITIAL_CONNECTOR_DIAGNOSTICS.map((item) => ({
        ...item,
        status: 'testing',
        durationMs: undefined,
        detail: 'Probing connector...',
      }))
    );

    const updateRow = (
      id: ConnectorDiagnosticRow['id'],
      patch: Partial<ConnectorDiagnosticRow>
    ) => {
      setConnectorResults((prev) =>
        prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
      );
    };

    const runOne = async <T,>(
      id: ConnectorDiagnosticRow['id'],
      label: string,
      fn: () => Promise<T>,
      formatSuccess: (res: T) => string
    ): Promise<{ id: ConnectorDiagnosticRow['id']; label: string; ok: boolean; durationMs: number; detail: string }> => {
      const t0 = performance.now();
      try {
        const res = await fn();
        const durationMs = Math.round(performance.now() - t0);
        const detail = formatSuccess(res);
        updateRow(id, { status: 'pass', durationMs, detail });
        return { id, label, ok: true, durationMs, detail };
      } catch (err) {
        const durationMs = Math.round(performance.now() - t0);
        const detail = String(err);
        updateRow(id, { status: 'fail', durationMs, detail });
        return { id, label, ok: false, durationMs, detail };
      }
    };

    const baseUrl = threatPrefs.unifiBaseUrl.trim() || 'https://ui.panoramadr.com';

    const results = await Promise.all([
      runOne(
        'cloudflare',
        'Cloudflare Perimeter & Zero Trust',
        async () => {
          const res = await invoke<{
            accountId: string;
            zones: Array<{ name: string; plan: string }>;
            tunnelsOk: boolean;
            intelOk: boolean;
            auditOk: boolean;
            wafReadOk?: boolean;
            wafReadStatus?: string;
            wafRulesCount?: number;
          }>('test_cloudflare_threat_connection', {
            tokenOverride: null,
            accountIdOverride: null,
          });
          if (res.accountId) {
            setThreatDto((prev) => (prev ? { ...prev, cfAccountId: res.accountId } : prev));
          }
          return res;
        },
        (res) => {
          const zoneNames = res.zones.map((z) => `${z.name} (${z.plan})`).join(', ');
          const wafText = res.wafReadOk
            ? `OK (${res.wafRulesCount ?? 0} rules)`
            : 'Add Zone WAF:Read';
          return `Account ${res.accountId} • Zones: ${zoneNames || 'none'} • Tunnels=${res.tunnelsOk ? 'OK' : 'WARN'} • IP Intel=${res.intelOk ? 'OK' : 'WARN'} • Audit=${res.auditOk ? 'OK' : 'WARN'} • WAF Rules=${wafText}`;
        }
      ),
      runOne(
        'gemini',
        'Gemini 4 Security AI Engine',
        () =>
          invoke<{ model: string; severity: string }>('test_gemini_connection', {
            apiKeyOverride: null,
          }),
        (res) =>
          `Structured JSON schema handshake passed on model=${res.model} (baseline check=${res.severity || 'OK'}).`
      ),
      runOne(
        'unifi',
        'UniFi CloudKey Integration API',
        () =>
          invoke<{
            siteCount?: number;
            deviceCount?: number;
            clientCount?: number;
          }>('test_unifi_connection', {
            baseUrlOverride: baseUrl,
            apiKeyOverride: null,
          }),
        (res) =>
          `${baseUrl} • ${res.siteCount ?? 1} site(s), ${res.deviceCount ?? 0} device(s), ${res.clientCount ?? 0} LAN client(s).`
      ),
      runOne(
        'wsh',
        'WSH Origin & PanoramaAuth SSH',
        () =>
          invoke<{
            hostname: string;
            panoramaAuthAvailable: boolean;
            anomaliesCount: number;
            auditLogsCount: number;
            containersCount: number;
            unifiSiemPresent: boolean;
            unifiCefCount: number;
          }>('test_wsh_security_probe'),
        (res) =>
          `Host ${res.hostname} • Containers=${res.containersCount} • PanoramaAuth=${res.panoramaAuthAvailable ? 'RO Active' : 'Unavailable'} (anom=${res.anomaliesCount}, logs=${res.auditLogsCount}) • UniFi CEF=${res.unifiSiemPresent ? `${res.unifiCefCount} events` : 'Not Deployed'}.`
      ),
    ]);

    const passCount = results.filter((r) => r.ok).length;
    const failCount = results.length - passCount;
    setLastConnectorTestAt(new Date().toLocaleTimeString());
    setThreatFeedback({
      text:
        failCount === 0
          ? `All ${passCount} / 4 connectors verified cleanly`
          : `${passCount} / 4 passed • ${failCount} failed (see Connector Verification Output)`,
      tone: failCount === 0 ? 'ok' : 'err',
    });

    onEmitSettingsStream?.(
      'Test All 360° Threat Connectors',
      results.map(
        (r) =>
          `[${r.ok ? 'PASS' : 'ERROR'}] ${r.label} (${r.durationMs}ms): ${r.detail}`
      ),
      failCount > 0 ? 1 : 0
    );

    setTimeout(() => setThreatFeedback(null), 6000);
    setIsTestingAllConnectors(false);
  };

  const loadPushoverSettings = useCallback(async () => {
    setIsLoadingPushover(true);
    try {
      const dto = await invoke<PushoverSettingsViewDto>('get_pushover_settings');
      setPushoverDto(dto);
      setPushoverPrefs(dto.preferences);
    } catch (err) {
      console.warn('Failed to load Pushover settings:', err);
    } finally {
      setIsLoadingPushover(false);
    }
  }, []);

  useEffect(() => {
    loadPushoverSettings();
  }, [loadPushoverSettings]);

  useEffect(() => {
    if (activeTab === 'ssh') {
      loadPushoverSettings();
    }
  }, [activeTab, loadPushoverSettings]);

  const handleSavePushover = async () => {
    setIsSavingPushover(true);
    try {
      const updated = await invoke<PushoverSettingsViewDto>('save_pushover_settings', {
        input: {
          apiToken: null,
          userKey: null,
          clearStoredCredentials: false,
          preferences: pushoverPrefs,
        },
      });
      setPushoverDto(updated);
      setPushoverPrefs(updated.preferences);
      setPushoverFeedback({ text: 'Pushover settings saved', tone: 'ok' });
      setTimeout(() => setPushoverFeedback(null), 3500);
      onEmitSettingsStream?.('Save Pushover Notification Governance', [
        '[PanoramaSRE] Persisting Pushover preferences & DPAPI secret configuration...',
        `[INFO] Enabled: ${updated.preferences.enabled} | Source: ${updated.credentialSource} | Sounds: updates=${updated.preferences.updateSound}, failures=${updated.preferences.failureSound}`,
        `[INFO] Trusted-Network Gate: ${updated.networkGate.isTrusted ? 'ARMED' : 'PAUSED'} (${updated.networkGate.reason})`,
        '[PASS] Pushover mobile alert configuration updated.',
      ]);
    } catch (err) {
      const msg = String(err);
      setPushoverFeedback({ text: `Error: ${msg}`, tone: 'err' });
      setTimeout(() => setPushoverFeedback(null), 5000);
      onEmitSettingsStream?.(
        'Save Pushover Notification Governance',
        [`[ERROR] Failed saving Pushover settings: ${msg}`],
        1
      );
    } finally {
      setIsSavingPushover(false);
    }
  };

  const handleSendTestPushover = async () => {
    setIsTestingPushover(true);
    try {
      const receipt = await invoke<PushoverSendReceipt>('send_test_pushover_notification', {
        soundOverride: pushoverPrefs.updateSound,
      });
      setPushoverFeedback({
        text: `Test delivered (req ${receipt.requestId.slice(0, 8)})`,
        tone: 'ok',
      });
      setTimeout(() => setPushoverFeedback(null), 4500);
      onEmitSettingsStream?.('Send Test Pushover Notification', [
        '[PanoramaSRE] Dispatching direct HTTPS test payload to https://api.pushover.net/1/messages.json...',
        `[PASS] Pushover accepted message (status=${receipt.status}, request=${receipt.requestId}, sound=${pushoverPrefs.updateSound}).`,
      ]);
    } catch (err) {
      const msg = String(err);
      setPushoverFeedback({ text: msg, tone: 'err' });
      setTimeout(() => setPushoverFeedback(null), 6000);
      onEmitSettingsStream?.(
        'Send Test Pushover Notification',
        [`[ERROR] Pushover test failed: ${msg}`],
        1
      );
    } finally {
      setIsTestingPushover(false);
    }
  };

  const handleResetPushoverLedger = async () => {
    try {
      const cleared = await invoke<number>('reset_pushover_alert_baseline');
      await loadPushoverSettings();
      setPushoverFeedback({
        text: `Cleared ${cleared} dedup fingerprint(s)`,
        tone: 'ok',
      });
      setTimeout(() => setPushoverFeedback(null), 3500);
      onEmitSettingsStream?.('Reset Pushover Deduplication Ledger', [
        `[PanoramaSRE] Purged ${cleared} persisted state fingerprint(s) from pushover_alert_state.`,
        '[PASS] Active updates or unresolved incidents will notify once on the next trusted sync.',
      ]);
    } catch (err) {
      setPushoverFeedback({ text: String(err), tone: 'err' });
    }
  };

  // Load configured workspace directory on mount
  useEffect(() => {
    (async () => {
      try {
        const root = await invoke<string>('get_workspace_setting');
        if (root) {
          setWorkspaceRoot(root);
        }
      } catch (err) {
        console.warn('Failed to load workspace setting:', err);
      }
    })();
  }, []);

  const handleSelectWorkspaceFolder = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: 'Select Panorama Suite Repositories Directory (e.g. AG Projects)',
        defaultPath: workspaceRoot || undefined,
      });

      if (selected && typeof selected === 'string') {
        setWorkspaceRoot(selected);
        const resolved = await invoke<string>('save_workspace_setting', {
          workspaceRoot: selected,
        });
        setWorkspaceRoot(resolved);
        setWorkspaceFeedback('Workspace directory updated');
        setTimeout(() => setWorkspaceFeedback(null), 3000);
        if (onWorkspaceChanged) {
          onWorkspaceChanged();
        }
      }
    } catch (err) {
      console.error('Failed to select workspace folder:', err);
    }
  };

  const handleSaveWorkspaceRoot = async () => {
    try {
      const resolved = await invoke<string>('save_workspace_setting', {
        workspaceRoot: workspaceRoot,
      });
      setWorkspaceRoot(resolved);
      setWorkspaceFeedback('Workspace directory saved');
      setTimeout(() => setWorkspaceFeedback(null), 3000);
      if (onWorkspaceChanged) {
        onWorkspaceChanged();
      }
    } catch (err) {
      setWorkspaceFeedback(`Error: ${String(err)}`);
      setTimeout(() => setWorkspaceFeedback(null), 4000);
    }
  };

  // Application Logs state
  const [logs, setLogs] = useState<SystemLogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [autoRefreshLogs, setAutoRefreshLogs] = useState<boolean>(true);
  const [copiedLogs, setCopiedLogs] = useState<boolean>(false);

  const fetchLogs = useCallback(async () => {
    try {
      setIsLoadingLogs(true);
      const res = await invoke<SystemLogEntry[]>('get_system_logs', {
        limit: 300,
        category: selectedCategory === 'ALL' ? null : selectedCategory,
      });
      setLogs(res);
    } catch (err) {
      console.warn('Failed to load system logs:', err);
    } finally {
      setIsLoadingLogs(false);
    }
  }, [selectedCategory]);

  useEffect(() => {
    if (activeTab === 'logs') {
      fetchLogs();
    }
  }, [activeTab, fetchLogs]);

  useEffect(() => {
    if (activeTab !== 'logs' || !autoRefreshLogs) return;
    const interval = setInterval(() => {
      fetchLogs();
    }, 3000);
    return () => clearInterval(interval);
  }, [activeTab, autoRefreshLogs, fetchLogs]);

  const handleClearLogs = async () => {
    try {
      await invoke('clear_system_logs');
      setLogs([]);
      onEmitSettingsStream?.('Clear SRE System Logs', [
        '[PanoramaSRE] Clearing persisted SQLite system_logs & sre.log buffer...',
        '[PASS] All historical system logs purged cleanly.',
      ]);
    } catch (err) {
      console.error('Failed to clear logs:', err);
      onEmitSettingsStream?.(
        'Clear SRE System Logs',
        [`[ERROR] Failed to clear system logs: ${String(err)}`],
        1
      );
    }
  };

  const filteredLogs = logs.filter((log) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      log.message.toLowerCase().includes(q) ||
      log.category.toLowerCase().includes(q) ||
      (log.metadata && log.metadata.toLowerCase().includes(q))
    );
  });

  const {
    containerRef: logsContainerRef,
    isPinned: isLogsPinned,
    unseenCount: unseenLogsCount,
    handleScroll: handleLogsScroll,
    pinToBottom: pinLogsToBottom,
  } = useSmartAutoScroll({
    lineCount: filteredLogs.length,
    isActive: activeTab === 'logs',
    sessionKey: `settings-logs-${selectedCategory}`,
  });

  const handleCopyFilteredLogs = useCallback(async () => {
    if (filteredLogs.length === 0) return;
    const formatted = filteredLogs
      .map((log) => {
        const ts = log.created_at.slice(11, 19);
        const msg = stripAnsiCodes(log.message);
        const meta = log.metadata ? ` (${stripAnsiCodes(log.metadata)})` : '';
        return `[${ts}] [${log.category}] [${log.level}] ${msg}${meta}`;
      })
      .join('\n');
    try {
      await navigator.clipboard.writeText(formatted);
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 2000);
    } catch (err) {
      console.error('Failed to copy application logs:', err);
    }
  }, [filteredLogs]);

  const handleSave = () => {
    localStorage.setItem('panoramasre_tier1_poll_interval', pollInterval);
    localStorage.setItem('panoramasre_security_audit_interval', securityAuditInterval);
    if (onPollIntervalChanged) {
      onPollIntervalChanged(pollInterval);
    }
    if (onSecurityAuditIntervalChanged) {
      onSecurityAuditIntervalChanged(securityAuditInterval);
    }
    onEmitSettingsStream?.('Save SRE Governance Settings', [
      '[PanoramaSRE] Persisting workstation governance preferences...',
      `[INFO] Tier 1 local interval: ${pollInterval}s | Tier 2 LAN/schedule: 60s | Tier 3 WSH/fleet: ${securityAuditInterval}m | Tier 4 hourly checks: 1h.`,
      '[PASS] Governance settings updated.',
    ]);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-hidden">
      {/* View Header */}
      <div className="h-14 border-b border-slate-200 dark:border-slate-800 px-6 flex items-center justify-between bg-white dark:bg-slate-900">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Settings & SRE Governance</h2>
        <button
          onClick={handleSave}
          className="btn-primary text-xs flex items-center space-x-1.5"
        >
          {isSaved ? <Check className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
          <span>{isSaved ? 'Saved!' : 'Save Changes'}</span>
        </button>
      </div>

      {/* 4-Tab Bar */}
      <div className="border-b border-slate-200 dark:border-slate-800 px-6 flex space-x-6 bg-white dark:bg-slate-900 overflow-x-auto">
        <button
          onClick={() => setActiveTab('general')}
          className={`py-3 min-h-[44px] text-sm font-medium border-b-2 flex items-center space-x-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'general' ? 'border-[var(--color-brand)] text-[var(--color-brand-text)] font-semibold' : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>General & System Tray</span>
        </button>
        <button
          onClick={() => setActiveTab('ssh')}
          className={`py-3 min-h-[44px] text-sm font-medium border-b-2 flex items-center space-x-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'ssh' ? 'border-[var(--color-brand)] text-[var(--color-brand-text)] font-semibold' : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>SSH & Secrets</span>
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`py-3 min-h-[44px] text-sm font-medium border-b-2 flex items-center space-x-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'logs' ? 'border-[var(--color-brand)] text-[var(--color-brand-text)] font-semibold' : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Terminal className="w-4 h-4" />
          <span>Application Logs</span>
        </button>
        <button
          onClick={() => setActiveTab('database')}
          className={`py-3 min-h-[44px] text-sm font-medium border-b-2 flex items-center space-x-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'database' ? 'border-[var(--color-brand)] text-[var(--color-brand-text)] font-semibold' : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Database & Cache</span>
        </button>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {activeTab === 'general' && (
          <div className="w-full max-w-[1920px] mx-auto space-y-6">
            {/* Appearance & Color Scheme Preference */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Appearance & Theme Preference</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">Select your preferred user theme. Synchronized across PanoramaDrSuite.</p>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 uppercase">
                  Active: {resolvedTheme}
                </span>
              </div>

              <SegmentedControl<'dark' | 'light' | 'system'>
                activeVariant="brand"
                fullWidth
                value={theme}
                onChange={setTheme}
                options={[
                  { value: 'dark', label: 'Dark Mode', icon: <Moon className="w-4 h-4" /> },
                  { value: 'light', label: 'Light Mode', icon: <Sun className="w-4 h-4" /> },
                  { value: 'system', label: 'System Sync', icon: <Laptop className="w-4 h-4" /> },
                ]}
              />
            </div>

            {/* Suite Repositories & Workspace Directory Configuration */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Suite Repositories Workspace</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">Root folder containing child application repositories with panorama.app.json manifests.</p>
                </div>
                {workspaceFeedback && (
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                    {workspaceFeedback}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                  <input
                    type="text"
                    value={workspaceRoot}
                    onChange={(e) => setWorkspaceRoot(e.target.value)}
                    placeholder="e.g. C:\Users\<Username>\Documents\AG Projects"
                    className="flex-1 min-w-[200px] px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
                  />
                  <button
                    type="button"
                    onClick={handleSelectWorkspaceFolder}
                    className="btn-secondary text-xs flex items-center gap-1.5"
                    title="Browse for folder"
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>Browse...</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveWorkspaceRoot}
                    className="btn-primary text-xs"
                  >
                    Apply
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                  Default search path: <span className="text-slate-700 dark:text-slate-300">%USERPROFILE%\Documents\AG Projects</span>
                </p>
              </div>
            </div>

            {/* Version & Build Provenance Card */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <Info className="w-4 h-4 text-[var(--color-brand-text)]" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-200">PanoramaSRE Build Provenance</h3>
                </div>
                <span className="px-2 py-0.5 rounded text-xs font-mono font-semibold bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)] border border-[var(--color-brand-ring)] tabular-nums">
                  {APP_VERSION_INFO.fullVersionString}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 font-mono text-xs tabular-nums">
                <div>
                  <span className="text-slate-600 dark:text-slate-400 block text-[11px]">Semantic Version:</span>
                  <span className="text-slate-800 dark:text-slate-300 font-semibold">{APP_VERSION_INFO.version}</span>
                </div>
                <div>
                  <span className="text-slate-600 dark:text-slate-400 block text-[11px]">Git Commit SHA:</span>
                  <span className="text-[var(--color-accent-text)] font-semibold">{APP_VERSION_INFO.buildHash}</span>
                </div>
                <div>
                  <span className="text-slate-600 dark:text-slate-400 block text-[11px]">Build Timestamp:</span>
                  <span className="text-slate-800 dark:text-slate-300">{APP_VERSION_INFO.buildDate || 'Local Dev'}</span>
                </div>
                <div>
                  <span className="text-slate-600 dark:text-slate-400 block text-[11px]">Build Identifier:</span>
                  <span className="text-slate-800 dark:text-slate-300">{APP_VERSION_INFO.buildNumber}</span>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-200">System Tray & Window Lifecycle</h3>
              
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-slate-800 dark:text-slate-300">Minimize to System Tray on Close (X)</div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">Keeps background telemetry scheduler and local dev servers active.</div>
                </div>
                <ToggleSwitch
                  checked={minimizeToTray}
                  onChange={setMinimizeToTray}
                  activeColor="brand"
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-slate-800 dark:text-slate-300">Windows 11 Toast Notifications</div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">Edge-triggered alerts on app outage, 75°C thermals, or SSL expiry.</div>
                </div>
                <ToggleSwitch
                  checked={toastAlerts}
                  onChange={setToastAlerts}
                  activeColor="brand"
                />
              </div>

              <div className="flex items-center justify-between gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <div className="text-sm text-slate-800 dark:text-slate-300">
                    Start PanoramaSRE minimized to tray at Windows login
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    Registers HKCU\...\Run\PanoramaSRE with --minimized (zero UAC) for uninterrupted 6-hour security audits.
                  </div>
                </div>
                <ToggleSwitch
                  checked={windowsAutostart}
                  onChange={(val) => void handleToggleWindowsAutostart(val)}
                  activeColor="brand"
                />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-200">Telemetry & Unified 4-Tier Schedule</h3>
                {onRunHourlyChecksNow && (
                  <button
                    type="button"
                    onClick={onRunHourlyChecksNow}
                    disabled={isCheckingHourly}
                    className="btn-secondary text-xs font-mono flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-[var(--color-accent-text)] ${isCheckingHourly ? 'animate-spin' : ''}`} />
                    <span>{isCheckingHourly ? 'Running Hourly Checks...' : 'Run Hourly Checks Now'}</span>
                  </button>
                )}
              </div>
              
              <div>
                <label className="block text-xs font-mono text-slate-600 dark:text-slate-400 mb-1.5">Tier 1 Local Polling Interval</label>
                <CustomSelect
                  value={pollInterval}
                  onChange={(val) => {
                    setPollInterval(val);
                    localStorage.setItem('panoramasre_tier1_poll_interval', val);
                    onPollIntervalChanged?.(val);
                  }}
                  options={[
                    { value: '5', label: '5 seconds (High Frequency / Debug)' },
                    { value: '15', label: '15 seconds (Recommended Default)' },
                    { value: '30', label: '30 seconds (Low Power)' },
                    { value: '60', label: '60 seconds' },
                  ]}
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
                  Local-only polling of dev servers and the Named Pipe MCP bridge (zero LAN/WAN traffic).
                </p>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-600 dark:text-slate-400 mb-1.5">
                  Tier 3 WSH SSH & Fleet Sync Interval
                </label>
                <CustomSelect
                  value={securityAuditInterval}
                  onChange={(val) => {
                    setSecurityAuditInterval(val);
                    localStorage.setItem('panoramasre_security_audit_interval', val);
                    if (onSecurityAuditIntervalChanged) {
                      onSecurityAuditIntervalChanged(val);
                    }
                  }}
                  options={[
                    { value: '1', label: '1 minute (High Frequency / Verification)' },
                    { value: '3', label: '3 minutes' },
                    { value: '5', label: '5 minutes (Recommended Default)' },
                    { value: '10', label: '10 minutes' },
                    { value: '15', label: '15 minutes' },
                    { value: '30', label: '30 minutes (Low Resource)' },
                  ]}
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
                  Probes network posture, all suite health endpoints, local Git composition, and WSH --fast SSH snapshot.
                </p>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2 tabular-nums">
                <div className="flex items-center justify-between text-xs font-mono text-slate-600 dark:text-slate-400">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Active 4-Tier Background Schedule</span>
                  <span className="text-[11px] text-slate-500">
                    Last hourly run: {lastHourlyCheckTime || 'Startup / Pending'}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] font-mono">
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">Tier 1 · {pollInterval}s (Local)</div>
                    <div className="text-slate-500">Dev Servers & Named Pipe MCP Bridge</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">Tier 2 · 60s (LAN / Slots)</div>
                    <div className="text-slate-500">4 Appliances (pooled) & 4x/day Smoke Slot Check</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">Tier 3 · {securityAuditInterval}m (Fleet + SSH)</div>
                    <div className="text-slate-500">Posture, Fleet Health & Git, WSH --fast SSH Snapshot</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">Tier 4 · 1h + Startup (Slow/Upstream)</div>
                    <div className="text-slate-500">Cloudflare Tunnel Release (ETag), SSL Fleet, Backup Ledger</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 360° Threat Intelligence & AI (Cloudflare + Gemini 4 + UniFi) Card */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      360° Threat Intelligence &amp; AI (Cloudflare + Gemini 4 + UniFi)
                    </h3>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Autonomous 6-hour security audits powered by read-only SSOT credentials (.env.local.keys / Windows DPAPI).
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
                  <StatusBadge
                    label={`Carbon (24h): ${threatDto?.carbonUsedLast24h ?? 0} / ${threatPrefs.dailyCarbonCap === 0 ? '∞' : threatPrefs.dailyCarbonCap}`}
                    variant="info"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 pt-1">
                <div>
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    Enable Scheduled 360° Threat &amp; Zero Trust Audits
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    Sleep-safe background timer checks due cadence on the alert leader instance and recovers missed windows up to 24h.
                  </div>
                </div>
                <ToggleSwitch
                  checked={threatPrefs.enabled}
                  onChange={(val) =>
                    setThreatPrefs((prev) => ({ ...prev, enabled: val }))
                  }
                  activeColor="brand"
                />
              </div>

              {/* Read-Only SSOT Credentials */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-200 dark:border-slate-800">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-mono text-slate-600 dark:text-slate-400">
                      Cloudflare Read-Only API Token (SSOT)
                    </label>
                    <span className="text-[11px] font-mono text-slate-500">
                      {threatDto?.cfConfigured
                        ? threatDto.cfSource === 'dpapi'
                          ? 'Windows DPAPI'
                          : '.env.local.keys'
                        : 'Not configured'}
                    </span>
                  </div>
                  <div
                    aria-readonly="true"
                    className="w-full truncate px-3 py-2.5 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 cursor-default select-all"
                  >
                    {threatDto?.cfConfigured
                      ? threatDto.maskedCfToken
                      : 'Not configured in .env.local.keys'}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-mono text-slate-600 dark:text-slate-400">
                    Cloudflare Account ID (Auto-detected on Test)
                  </label>
                  <div
                    aria-readonly="true"
                    className="w-full truncate px-3 py-2.5 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 cursor-default select-all tabular-nums"
                  >
                    {threatDto?.cfAccountId || 'Auto-detected on Test'}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-mono text-slate-600 dark:text-slate-400">
                      Gemini API Key (Paid Tier for Log Privacy — SSOT)
                    </label>
                    <span className="text-[11px] font-mono text-slate-500">
                      {threatDto?.geminiConfigured
                        ? threatDto.geminiSource === 'dpapi'
                          ? 'Windows DPAPI'
                          : '.env.local.keys'
                        : 'Not configured'}
                    </span>
                  </div>
                  <div
                    aria-readonly="true"
                    className="w-full truncate px-3 py-2.5 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 cursor-default select-all"
                  >
                    {threatDto?.geminiConfigured
                      ? threatDto.maskedGeminiKey
                      : 'Not configured in .env.local.keys'}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-mono text-slate-600 dark:text-slate-400">
                      UniFi Integration X-API-Key &amp; Base URL (SSOT)
                    </label>
                    <span className="text-[11px] font-mono text-slate-500">
                      {threatDto?.unifiConfigured
                        ? threatDto.unifiSource === 'dpapi'
                          ? 'Windows DPAPI'
                          : '.env.local.keys'
                        : 'Optional'}
                    </span>
                  </div>
                  <div
                    aria-readonly="true"
                    className="w-full truncate px-3 py-2.5 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 cursor-default select-all"
                  >
                    {threatDto?.unifiConfigured
                      ? threatDto.maskedUnifiKey
                      : 'Not configured in .env.local.keys'}
                  </div>
                  <div
                    aria-readonly="true"
                    className="w-full truncate px-3 py-2.5 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 cursor-default select-all"
                  >
                    {threatPrefs.unifiBaseUrl || 'https://ui.panoramadr.com'}
                  </div>
                </div>
              </div>

              {/* Cadence, Models & Alert Controls (All CustomSelect) */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <label className="block text-xs font-mono text-slate-600 dark:text-slate-400 mb-1">
                    Audit Cadence
                  </label>
                  <CustomSelect
                    value={String(threatPrefs.cadenceHours)}
                    onChange={(val) =>
                      setThreatPrefs((prev) => ({
                        ...prev,
                        cadenceHours: Number.parseInt(val, 10) || 6,
                      }))
                    }
                    options={[
                      { value: '3', label: 'Every 3 hours' },
                      { value: '6', label: 'Every 6 hours (Recommended)' },
                      { value: '12', label: 'Every 12 hours' },
                      { value: '24', label: 'Every 24 hours' },
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-600 dark:text-slate-400 mb-1">
                    Tier 1 Triage Model
                  </label>
                  <CustomSelect
                    value={threatPrefs.tier1Model}
                    onChange={(val) =>
                      setThreatPrefs((prev) => ({ ...prev, tier1Model: val }))
                    }
                    options={[
                      { value: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (Fast Default)' },
                      { value: 'gemini-4-neon', label: 'Gemini 4 Neon (Balanced)' },
                      { value: 'gemini-4-argon', label: 'Gemini 4 Argon (Legacy Alias)' },
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-600 dark:text-slate-400 mb-1">
                    Tier 2 Forensic Escalation Model
                  </label>
                  <CustomSelect
                    value={threatPrefs.tier2Model}
                    onChange={(val) =>
                      setThreatPrefs((prev) => ({ ...prev, tier2Model: val }))
                    }
                    options={[
                      { value: 'gemini-4-carbon', label: 'Gemini 4 Carbon (Deep Sec Recommended)' },
                      { value: 'gemini-4-neon', label: 'Gemini 4 Neon' },
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-600 dark:text-slate-400 mb-1">
                    Daily Auto-Escalation Cap
                  </label>
                  <CustomSelect
                    value={String(threatPrefs.dailyCarbonCap)}
                    onChange={(val) =>
                      setThreatPrefs((prev) => ({
                        ...prev,
                        dailyCarbonCap: Number.parseInt(val, 10),
                      }))
                    }
                    options={[
                      { value: '3', label: '3 Carbon escalations / 24h' },
                      { value: '6', label: '6 Carbon escalations / 24h (Default)' },
                      { value: '10', label: '10 Carbon escalations / 24h' },
                      { value: '0', label: 'Unlimited (Manual/Auto Uncapped)' },
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-600 dark:text-slate-400 mb-1">
                    Pushover Alert Threshold
                  </label>
                  <CustomSelect
                    value={threatPrefs.pushoverThreshold}
                    onChange={(val) =>
                      setThreatPrefs((prev) => ({ ...prev, pushoverThreshold: val }))
                    }
                    options={[
                      { value: 'HIGH', label: 'HIGH & CRITICAL Only (Recommended)' },
                      { value: 'CRITICAL', label: 'CRITICAL Only' },
                      { value: 'MEDIUM', label: 'MEDIUM+ (Verbose)' },
                      { value: 'OFF', label: 'Disabled' },
                    ]}
                  />
                </div>
              </div>

              {/* Dedicated Connector Verification Results Output */}
              {(() => {
                const passCount = connectorResults.filter((r) => r.status === 'pass').length;
                const failCount = connectorResults.filter((r) => r.status === 'fail').length;
                const completedCount = passCount + failCount;
                const badgeLabel = isTestingAllConnectors
                  ? `Testing (${completedCount}/4)`
                  : completedCount === 0
                  ? 'Ready to Test'
                  : failCount === 0
                  ? `${passCount} / 4 Passed`
                  : `${passCount} / 4 Passed • ${failCount} Failed`;
                const badgeVariant = isTestingAllConnectors
                  ? 'info'
                  : completedCount === 0
                  ? 'neutral'
                  : failCount === 0
                  ? 'success'
                  : 'danger';

                return (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
                        <span className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                          Connector Verification Output
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
                        {lastConnectorTestAt && (
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            Last tested: {lastConnectorTestAt}
                          </span>
                        )}
                        <StatusBadge label={badgeLabel} variant={badgeVariant} />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {connectorResults.map((row) => (
                        <div
                          key={row.id}
                          className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                                {row.label}
                              </div>
                              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                {row.surface}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
                              {row.durationMs !== undefined && (
                                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                  {row.durationMs}ms
                                </span>
                              )}
                              <StatusBadge
                                label={row.status.toUpperCase()}
                                variant={
                                  row.status === 'pass'
                                    ? 'success'
                                    : row.status === 'fail'
                                    ? 'danger'
                                    : row.status === 'testing'
                                    ? 'info'
                                    : 'neutral'
                                }
                              />
                            </div>
                          </div>
                          <p
                            className={`text-[11px] font-mono leading-relaxed break-words ${
                              row.status === 'fail'
                                ? 'text-rose-700 dark:text-rose-300'
                                : row.status === 'pass'
                                ? 'text-emerald-800 dark:text-emerald-300'
                                : 'text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            {row.detail}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Footer */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2">
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveThreatSettings()}
                    disabled={isSavingThreat}
                    className="btn-primary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{isSavingThreat ? 'Saving...' : 'Save Threat Intel Settings'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleTestAllThreatConnectors()}
                    disabled={isTestingAllConnectors}
                    className="btn-accent text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isTestingAllConnectors ? 'animate-spin' : ''}`}
                    />
                    <span>
                      {isTestingAllConnectors
                        ? `Testing All (${connectorResults.filter((r) => r.status === 'pass' || r.status === 'fail').length}/4)...`
                        : 'Test All Connections'}
                    </span>
                  </button>
                </div>

                {threatFeedback && (
                  <span
                    className={`text-xs font-mono px-2.5 py-1 rounded border whitespace-nowrap flex-shrink-0 ${
                      threatFeedback.tone === 'ok'
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30'
                    }`}
                  >
                    {threatFeedback.text}
                  </span>
                )}
              </div>
            </div>

            <UnifiSiemSettingsCard
              containers={wshSnapshot?.containers || []}
              onTriggerUnifiSiemAction={onTriggerUnifiSiemAction}
              onReapplyHardening={onReapplyHardening}
            />

            <WorkStreamContainer
              pageScope="settings"
              title="Settings & Governance Stream"
              description="Workspace rescan discovery, governance preference updates, and system log purge events."
              tabs={terminalTabs}
              onOpenInBottomConsole={onOpenInBottomConsole}
              onAbortJob={onAbortJob}
              onClearTab={onClearTab}
              emptyHint="Apply a workspace path, save governance intervals, or purge logs to inspect stream output."
            />
          </div>
        )}

        {activeTab === 'ssh' && (
          <div className="w-full max-w-[1920px] mx-auto space-y-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3 font-mono text-xs shadow-sm">
              <div className="text-slate-600 dark:text-slate-400 font-semibold mb-2">TARGET HOST CONNECTION</div>
              <div className="text-slate-800 dark:text-slate-300"><span className="text-slate-500">Host:</span> wsh.panoramadr.com</div>
              <div className="text-slate-800 dark:text-slate-300"><span className="text-slate-500">User:</span> root</div>
              <div className="text-slate-800 dark:text-slate-300"><span className="text-slate-500">Key:</span> C:\Users\rodrigo\.ssh\rsa-key-deployment</div>
              <div className="text-slate-800 dark:text-slate-300"><span className="text-slate-500">Key Type:</span> OpenSSH Private Key (RSA)</div>
            </div>

            {/* Pushover Mobile Notifications & Trusted-Network Gate Card */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Pushover Mobile Notifications & Roaming Gate
                    </h3>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Direct out-of-band Pushover REST alerts for new system updates, host/app outages, smoke failures, SSL drift, and backups.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {pushoverDto?.networkGate.isTrusted ? (
                    <span
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border border-emerald-500/30 whitespace-nowrap flex-shrink-0"
                      title={pushoverDto.networkGate.reason}
                    >
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>Gate: Armed (Home / VPN)</span>
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 whitespace-nowrap flex-shrink-0"
                      title={pushoverDto?.networkGate.reason || 'Checking network posture...'}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>Gate: Paused (Away / No Tunnel)</span>
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={loadPushoverSettings}
                    disabled={isLoadingPushover}
                    aria-label="Re-probe Trusted Home/VPN Network Gate"
                    className="min-w-[36px] min-h-[36px] flex items-center justify-center p-1.5 rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors flex-shrink-0 cursor-pointer"
                    title="Re-probe Trusted Home/VPN Network Gate"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingPushover ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {pushoverDto?.networkGate.reason && (
                <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
                  <span>{pushoverDto.networkGate.reason}</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    Credentials:{' '}
                    {pushoverDto.configured
                      ? `Active (${pushoverDto.credentialSource === 'dpapi' ? 'Windows DPAPI' : '.env.local.keys'} • ${pushoverDto.maskedToken})`
                      : 'Not Configured'}
                  </span>
                </div>
              )}

              {/* Master Toggle */}
              <div className="flex items-center justify-between gap-4 pt-1">
                <div>
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    Enable Automated Pushover Notifications
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    Sends strictly once per new actionable event while connected to your trusted home network or VPN.
                  </div>
                </div>
                <ToggleSwitch
                  checked={pushoverPrefs.enabled}
                  onChange={(val) =>
                    setPushoverPrefs((prev) => ({ ...prev, enabled: val }))
                  }
                  activeColor="brand"
                />
              </div>

              {/* Read-Only Credentials & Device Target */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <label className="block text-xs font-mono text-slate-600 dark:text-slate-400 mb-1">
                    App API Token (SSOT)
                  </label>
                  <div className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300">
                    {pushoverDto?.configured ? pushoverDto.maskedToken : 'Not configured in .env.local.keys'}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-600 dark:text-slate-400 mb-1">
                    User / Group Key (SSOT)
                  </label>
                  <div className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300">
                    {pushoverDto?.configured ? pushoverDto.maskedUser : 'Not configured in .env.local.keys'}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-600 dark:text-slate-400 mb-1">
                    Target Device (Optional)
                  </label>
                  <input
                    type="text"
                    value={pushoverPrefs.device}
                    onChange={(e) =>
                      setPushoverPrefs((prev) => ({ ...prev, device: e.target.value }))
                    }
                    placeholder="All subscribed devices"
                    className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
                  />
                </div>
              </div>

              {/* Read-Only Trusted Home / VPN Network Gate Anchors */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <label className="block text-xs font-mono text-slate-600 dark:text-slate-400 mb-1">
                    Expected WSH Split-DNS / Private IP
                  </label>
                  <div className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 tabular-nums">
                    {pushoverPrefs.expectedWshIp}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
                    Suppresses alerts when roaming on external Wi-Fi without VPN.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-600 dark:text-slate-400 mb-1">
                    Independent Home Network Canary Host
                  </label>
                  <div className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300">
                    {pushoverPrefs.canaryHost}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
                    Proves home/VPN reachability even if DietPi WSH itself crashes.
                  </p>
                </div>
              </div>

              {/* Sound & Priority Selectors */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <label className="block text-xs font-mono text-slate-600 dark:text-slate-400 mb-1">
                    Notification Sound (Fixed App Signature)
                  </label>
                  <div className="px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 flex items-center justify-between">
                    <span>cosmic</span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Always used for all PanoramaSRE alerts
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-600 dark:text-slate-400 mb-1">
                    Failure Priority Level
                  </label>
                  <CustomSelect
                    value={String(pushoverPrefs.failurePriority)}
                    onChange={(val) =>
                      setPushoverPrefs((prev) => ({
                        ...prev,
                        failurePriority: Number.parseInt(val, 10) || 0,
                      }))
                    }
                    options={[
                      { value: '0', label: 'Normal (0) — Recommended Default' },
                      { value: '1', label: 'High (1) — Bypass Quiet Hours' },
                      { value: '-1', label: 'Low / Quiet (-1)' },
                    ]}
                  />
                </div>
              </div>

              {/* Per-Category Actionable Event Toggles */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                <div className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-400">
                  ACTIONABLE EVENT TRIGGERS
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                  {(
                    [
                      {
                        key: 'systemUpdates',
                        title: 'System & Tunnel Updates',
                        desc: 'New cloudflared release, DietPi OS, Debian APT packages, or kernel reboot flag.',
                      },
                      {
                        key: 'appAndHostFailures',
                        title: 'App, WSH Host & Appliance Outages',
                        desc: 'Unreachable suite apps, WSH systemd/thermal/security failures, or offline appliances.',
                      },
                      {
                        key: 'smokeFailures',
                        title: 'Production Smoke Suite Failures',
                        desc: 'Failed checks during 4x/day scheduled or IPC smoke test executions.',
                      },
                      {
                        key: 'sslAlerts',
                        title: 'SSL Expiry & Certificate Drift',
                        desc: 'Domains expiring (<30d), self-signed fallbacks, or live TLS thumbprint drift.',
                      },
                      {
                        key: 'backupFailures',
                        title: 'GFS Database Backup Failures',
                        desc: 'Failed or missed daily SQLite backup runs in backup_history.json.',
                      },
                      {
                        key: 'optInEvents',
                        title: 'Parakith D1 SMS Opt-Ins',
                        desc: 'Notify when new subscriber opt-in records arrive during 15m D1 syncs.',
                      },
                      {
                        key: 'recoveryAlerts',
                        title: 'Quiet Recovery Notifications',
                        desc: 'Send a low-priority (-1) alert when an active outage returns to healthy.',
                      },
                    ] as const
                  ).map((item) => (
                    <div
                      key={item.key}
                      className="flex items-start justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                    >
                      <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-400">
                          {item.desc}
                        </div>
                      </div>
                      <ToggleSwitch
                        size="sm"
                        checked={pushoverPrefs.categories[item.key]}
                        onChange={(val) =>
                          setPushoverPrefs((prev) => ({
                            ...prev,
                            categories: {
                              ...prev.categories,
                              [item.key]: val,
                            },
                          }))
                        }
                        activeColor="brand"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Footer */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2">
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSavePushover}
                    disabled={isSavingPushover}
                    className="btn-primary text-xs flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{isSavingPushover ? 'Saving...' : 'Save Pushover Settings'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSendTestPushover}
                    disabled={isTestingPushover}
                    className="btn-accent text-xs flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isTestingPushover ? 'Sending Test...' : 'Send Test Alert'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleResetPushoverLedger}
                    className="btn-secondary text-xs flex items-center gap-1.5 tabular-nums"
                    title="Clears remembered alert fingerprints so current updates/failures re-notify once on next sync"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset Dedup ({pushoverDto?.trackedStateCount ?? 0})</span>
                  </button>
                </div>

                {pushoverFeedback && (
                  <span
                    className={`text-xs font-mono px-2.5 py-1 rounded border whitespace-nowrap flex-shrink-0 ${
                      pushoverFeedback.tone === 'ok'
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30'
                    }`}
                  >
                    {pushoverFeedback.text}
                  </span>
                )}
              </div>
            </div>

            <WorkStreamContainer
              pageScope="settings"
              title="Settings & Governance Stream"
              description="Workspace rescan discovery, governance preference updates, and system log purge events."
              tabs={terminalTabs}
              onOpenInBottomConsole={onOpenInBottomConsole}
              onAbortJob={onAbortJob}
              onClearTab={onClearTab}
              emptyHint="Apply a workspace path, save governance intervals, or purge logs to inspect stream output."
            />
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="flex flex-col space-y-3 h-full">
            {/* Log Controls Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 shadow-sm">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 shrink-0" />
                <input
                  type="text"
                  placeholder="Filter logs or parameters..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent border-0 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none w-full"
                />
              </div>

              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                <div className="w-36">
                  <CustomSelect
                    value={selectedCategory}
                    onChange={setSelectedCategory}
                    options={[
                      { value: 'ALL', label: 'All Categories' },
                      { value: 'SYSTEM', label: 'SYSTEM' },
                      { value: 'DEV_SUPERVISOR', label: 'DEV_SUPERVISOR' },
                      { value: 'RUNNER', label: 'RUNNER' },
                      { value: 'STREAM', label: 'STREAM' },
                      { value: 'DEPLOY', label: 'DEPLOY' },
                      { value: 'BACKUP', label: 'BACKUP' },
                      { value: 'MONITOR', label: 'MONITOR' },
                      { value: 'NOTIFY', label: 'NOTIFY' },
                      { value: 'OPT_IN', label: 'OPT_IN' },
                    ]}
                  />
                </div>

                <button
                  type="button"
                  onClick={handleCopyFilteredLogs}
                  disabled={filteredLogs.length === 0}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0 cursor-pointer"
                  title="Copy filtered application logs for debugging"
                >
                  {copiedLogs ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-emerald-700 dark:text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                      <span>Copy Logs</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={pinLogsToBottom}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] rounded-xl text-xs font-mono font-medium transition-colors border whitespace-nowrap flex-shrink-0 cursor-pointer ${
                    isLogsPinned
                      ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)] border-[var(--color-accent-ring)]'
                      : 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30'
                  }`}
                  title={isLogsPinned ? 'Pinned to latest log tail' : 'Click to pin scroll to bottom'}
                >
                  <Pin className="w-3.5 h-3.5" />
                  <span>{isLogsPinned ? 'Pinned' : 'Scroll Paused'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAutoRefreshLogs(!autoRefreshLogs)}
                  className={`px-2.5 py-1.5 min-h-[36px] rounded-xl text-xs font-mono font-medium transition-colors border whitespace-nowrap flex-shrink-0 cursor-pointer ${
                    autoRefreshLogs
                      ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)] border-[var(--color-accent-ring)]'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                  }`}
                  title="Toggle 3s live polling"
                >
                  {autoRefreshLogs ? 'Live: ON' : 'Live: PAUSED'}
                </button>

                <button
                  type="button"
                  onClick={fetchLogs}
                  disabled={isLoadingLogs}
                  aria-label="Manual Refresh"
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center p-1.5 rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex-shrink-0 cursor-pointer"
                  title="Manual Refresh"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingLogs ? 'animate-spin' : ''}`} />
                </button>

                <button
                  type="button"
                  onClick={handleClearLogs}
                  aria-label="Clear All Logs"
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center p-1.5 rounded-xl text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 transition-colors flex-shrink-0 cursor-pointer"
                  title="Clear All Logs"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Terminal Log Console */}
            <div className="relative flex-1 min-h-[420px] max-h-[600px] flex flex-col">
              <div
                ref={logsContainerRef}
                onScroll={handleLogsScroll}
                className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 font-mono text-xs overflow-y-auto space-y-1 select-text"
              >
                {filteredLogs.length === 0 ? (
                  <div className="text-slate-600 dark:text-slate-500 italic py-8 text-center">
                    No log entries found. Perform actions or run commands to stream logs.
                  </div>
                ) : (
                  filteredLogs.map((log) => {
                    const isWarn = log.level === 'WARN';
                    const isError = log.level === 'ERROR';
                    return (
                      <div key={log.id} className="leading-relaxed hover:bg-slate-200/50 dark:hover:bg-slate-900/40 px-1 rounded flex items-start gap-2">
                        <span className="text-slate-500 shrink-0 text-[11px] select-none font-mono tabular-nums">
                          [{log.created_at.slice(11, 19)}]
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded font-bold shrink-0 font-mono ${
                            isError
                              ? 'bg-rose-500/15 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                              : isWarn
                              ? 'bg-amber-500/15 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/30'
                              : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                          }`}
                        >
                          {log.category}
                        </span>
                        <span className="break-all">
                          {formatConsoleLine(log.message)}
                          {log.metadata && (
                            <span className="text-slate-500 dark:text-slate-400 text-[11px] ml-2 font-mono">
                              ({log.metadata})
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              {!isLogsPinned && filteredLogs.length > 0 && (
                <button
                  type="button"
                  onClick={pinLogsToBottom}
                  className="absolute bottom-3 right-4 z-10 inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[36px] rounded-full text-xs font-semibold bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-[var(--color-on-accent)] shadow-lg transition-colors cursor-pointer tabular-nums"
                >
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                  <span>{unseenLogsCount > 0 ? `Pin to Bottom (${unseenLogsCount} new)` : 'Pin to Bottom'}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {activeTab === 'database' && (
          <div className="w-full max-w-[1920px] mx-auto space-y-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-200">Local SQLite Telemetry Storage</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">Stores audit logs, system telemetry, and command run history locally in WAL mode.</p>
              <div className="text-xs font-mono text-slate-600 dark:text-slate-400">Database file: data/sre.sqlite (WAL enabled)</div>
            </div>

            <WorkStreamContainer
              pageScope="settings"
              title="Settings & Governance Stream"
              description="Workspace rescan discovery, governance preference updates, and system log purge events."
              tabs={terminalTabs}
              onOpenInBottomConsole={onOpenInBottomConsole}
              onAbortJob={onAbortJob}
              onClearTab={onClearTab}
              emptyHint="Apply a workspace path, save governance intervals, or purge logs to inspect stream output."
            />
          </div>
        )}
      </div>
    </div>
  );
};
