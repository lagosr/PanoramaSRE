import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  SegmentedControl,
  StatusBadge,
  ToggleSwitch,
} from '@lagosr/panorama-ui-kit';
import {
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  BrainCircuit,
  Copy,
  Check,
  ExternalLink,
  Search,
  CheckCircle2,
  Plus,
  Trash2,
  Wifi,
  Globe,
  Lock,
  Server,
  AlertTriangle,
  Sliders,
} from 'lucide-react';
import { CustomSelect } from '../ui/CustomSelect';
import { formatLocalDateTime, formatRelativeTime } from '../../lib/formatters';
import {
  buildCloudflareSecurityEventsUrl,
  buildCloudflareZeroTrustLogsUrl,
  buildUnifiConsoleUrl,
  buildWafRuleExpression,
  collectorStatusToBadgeVariant,
  filterThreatActors,
  formatCompactBytes,
  safeParseJson,
  severityToBadgeVariant,
  verdictToBadgeVariant,
} from '../../lib/threat-utils';
import type {
  CfZoneSummary,
  CollectorStatuses,
  GeminiBriefDto,
  InternalNetworkSummary,
  LanClientBaselineRow,
  ThreatActorRow,
  ThreatAllowlistRow,
  ThreatAuditRunRow,
  ThreatIntelSettingsViewDto,
  ThreatRunDetailDto,
  ZeroTrustSummary,
} from '../../lib/types';

type SubViewTab = 'overview' | 'actors' | 'sources';

interface ThreatIntelViewProps {
  latestDetail: ThreatRunDetailDto | null;
  runs: ThreatAuditRunRow[];
  settings: ThreatIntelSettingsViewDto | null;
  isRunningAudit: boolean;
  onRunAuditNow: (windowHours: number, forceCarbon?: boolean) => Promise<void>;
  onEscalateRunToCarbon: (runId: string) => Promise<void>;
  onSelectRunId: (runId: string) => Promise<void>;
  onRefreshAll: () => Promise<void>;
  onNavigateToSettings: () => void;
}

const EMPTY_ZT_SUMMARY: ZeroTrustSummary = {
  accessAppCount: 0,
  accessAllowed: 0,
  accessDenied: 0,
  tunnels: [],
  auditMutations: 0,
};

const EMPTY_INTERNAL_SUMMARY: InternalNetworkSummary = {
  unifiDevicesTotal: 0,
  unifiOfflineDevices: [],
  unifiClientsTotal: 0,
  newUnknownLanMacs: [],
  unifiPoliciesTotal: 0,
  panoramaAuthAvailable: false,
  panoramaAuthAnomalies: 0,
  sshAnomalyCount: 0,
  unifiSiemCefEvents: 0,
  unifiCefSecurityAlerts: 0,
};

export const ThreatIntelView: React.FC<ThreatIntelViewProps> = ({
  latestDetail,
  runs,
  settings,
  isRunningAudit,
  onRunAuditNow,
  onEscalateRunToCarbon,
  onSelectRunId,
  onRefreshAll,
  onNavigateToSettings,
}) => {
  const [subView, setSubView] = useState<SubViewTab>('overview');
  const [lookbackHours, setLookbackHours] = useState<string>('6');

  // Threat Actors state
  const [actors, setActors] = useState<ThreatActorRow[]>([]);
  const [actorDispositionFilter, setActorDispositionFilter] = useState<string>('ACTIVE');
  const [actorSearch, setActorSearch] = useState<string>('');
  const [isLoadingActors, setIsLoadingActors] = useState<boolean>(false);

  // LAN Baseline & Allowlist state
  const [lanClients, setLanClients] = useState<LanClientBaselineRow[]>([]);
  const [allowlist, setAllowlist] = useState<ThreatAllowlistRow[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState<boolean>(false);
  const [newRuleType, setNewRuleType] = useState<string>('IP');
  const [newRuleValue, setNewRuleValue] = useState<string>('');
  const [newRuleLabel, setNewRuleLabel] = useState<string>('');
  const [sourceFeedback, setSourceFeedback] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  // Clipboard copy feedback key
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const activeRun = latestDetail?.run ?? runs[0] ?? null;
  const activeFindings = latestDetail?.findings ?? [];

  const handleCopyText = useCallback(async (key: string, text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((curr) => (curr === key ? null : curr));
      }, 2000);
    } catch {
      // Clipboard error ignored gracefully
    }
  }, []);

  const handleOpenExternal = useCallback(async (url: string) => {
    if (!url) return;
    try {
      await openUrl(url);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const loadActors = useCallback(async () => {
    setIsLoadingActors(true);
    try {
      const list = await invoke<ThreatActorRow[]>('get_threat_actors', {
        disposition: actorDispositionFilter,
      });
      setActors(Array.isArray(list) ? list : []);
    } catch (err) {
      console.warn('[PanoramaSRE] Failed loading threat actors:', err);
    } finally {
      setIsLoadingActors(false);
    }
  }, [actorDispositionFilter]);

  const loadSourcesAndAllowlist = useCallback(async () => {
    setIsLoadingSources(true);
    try {
      const [lan, rules] = await Promise.all([
        invoke<LanClientBaselineRow[]>('get_lan_clients_baseline'),
        invoke<ThreatAllowlistRow[]>('get_threat_allowlist'),
      ]);
      setLanClients(Array.isArray(lan) ? lan : []);
      setAllowlist(Array.isArray(rules) ? rules : []);
    } catch (err) {
      console.warn('[PanoramaSRE] Failed loading LAN baseline & allowlist:', err);
    } finally {
      setIsLoadingSources(false);
    }
  }, []);

  useEffect(() => {
    void loadActors();
  }, [loadActors, activeRun?.id]);

  useEffect(() => {
    void loadSourcesAndAllowlist();
  }, [loadSourcesAndAllowlist, activeRun?.id]);

  const collectorStatuses: CollectorStatuses = useMemo(() => {
    const fallback: CollectorStatuses = {
      cloudflare: settings?.cfConfigured ? 'Ready' : 'Not Configured',
      unifi: settings?.unifiConfigured ? 'Ready' : 'Not Configured',
      wshAuth: 'Ready',
    };
    return safeParseJson<CollectorStatuses>(activeRun?.collectorStatusesJson, fallback);
  }, [activeRun?.collectorStatusesJson, settings]);

  const zonesSummary = useMemo(
    () => safeParseJson<CfZoneSummary[]>(activeRun?.zonesSummaryJson, []),
    [activeRun?.zonesSummaryJson]
  );

  const zeroTrustSummary = useMemo(
    () => safeParseJson<ZeroTrustSummary>(activeRun?.zeroTrustSummaryJson, EMPTY_ZT_SUMMARY),
    [activeRun?.zeroTrustSummaryJson]
  );

  const internalSummary = useMemo(
    () => safeParseJson<InternalNetworkSummary>(activeRun?.internalSummaryJson, EMPTY_INTERNAL_SUMMARY),
    [activeRun?.internalSummaryJson]
  );

  const geminiBrief = useMemo(
    () => safeParseJson<GeminiBriefDto | null>(activeRun?.geminiBriefJson, null),
    [activeRun?.geminiBriefJson]
  );

  const escalationReasons = useMemo(
    () => safeParseJson<string[]>(activeRun?.escalationReasonsJson, []),
    [activeRun?.escalationReasonsJson]
  );

  const panoramaZone = useMemo(
    () => zonesSummary.find((z) => z.name.toLowerCase().includes('panoramadr.com')) ?? zonesSummary[0] ?? null,
    [zonesSummary]
  );

  const parakithZone = useMemo(
    () => zonesSummary.find((z) => z.name.toLowerCase().includes('parakith.com')) ?? null,
    [zonesSummary]
  );

  const filteredActors = useMemo(
    () => filterThreatActors(actors, actorSearch, actorDispositionFilter),
    [actors, actorSearch, actorDispositionFilter]
  );

  const trustedLanCount = useMemo(
    () => lanClients.filter((c) => c.isTrusted).length,
    [lanClients]
  );

  const handleSetDisposition = async (actorId: string, disposition: string) => {
    try {
      await invoke('set_threat_actor_disposition', { actorId, disposition });
      await Promise.all([loadActors(), onRefreshAll()]);
    } catch (err) {
      setSourceFeedback({ text: `Disposition update failed: ${String(err)}`, tone: 'err' });
    }
  };

  const handleAllowlistActor = async (actor: ThreatActorRow) => {
    const val = (actor.ipAddress || actor.id || '').trim();
    if (!val) return;
    const entryType = actor.actorType === 'LAN_MAC' ? 'LAN_MAC' : 'IP';
    const label = [actor.asOrg, actor.country].filter(Boolean).join(' • ') || 'Allowlisted Threat Actor';
    try {
      await invoke('upsert_threat_allowlist', { entryType, value: val, label });
      await Promise.all([loadActors(), loadSourcesAndAllowlist(), onRefreshAll()]);
      setSourceFeedback({ text: `Allowlisted ${val}`, tone: 'ok' });
      setTimeout(() => setSourceFeedback(null), 3500);
    } catch (err) {
      setSourceFeedback({ text: `Allowlist failed: ${String(err)}`, tone: 'err' });
    }
  };

  const handleToggleLanTrust = async (client: LanClientBaselineRow, trusted: boolean) => {
    try {
      await invoke('set_lan_client_trusted', {
        macAddress: client.macAddress,
        trusted,
        label: client.label || client.hostname || null,
      });
      await loadSourcesAndAllowlist();
    } catch (err) {
      setSourceFeedback({ text: `Failed updating device trust: ${String(err)}`, tone: 'err' });
    }
  };

  const handleTrustAllBaseline = async () => {
    try {
      const updated = await invoke<number>('trust_all_lan_clients');
      await loadSourcesAndAllowlist();
      setSourceFeedback({
        text: `Marked ${updated} LAN baseline device(s) as trusted.`,
        tone: 'ok',
      });
      setTimeout(() => setSourceFeedback(null), 4000);
    } catch (err) {
      setSourceFeedback({ text: `Trust baseline failed: ${String(err)}`, tone: 'err' });
    }
  };

  const handleAddAllowlistRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = newRuleValue.trim();
    if (!val) return;
    try {
      await invoke('upsert_threat_allowlist', {
        entryType: newRuleType,
        value: val,
        label: newRuleLabel.trim() || `${newRuleType} allowlist rule`,
      });
      setNewRuleValue('');
      setNewRuleLabel('');
      await Promise.all([loadSourcesAndAllowlist(), loadActors()]);
      setSourceFeedback({ text: `Added ${newRuleType} allowlist rule: ${val}`, tone: 'ok' });
      setTimeout(() => setSourceFeedback(null), 3500);
    } catch (err) {
      setSourceFeedback({ text: `Failed adding rule: ${String(err)}`, tone: 'err' });
    }
  };

  const handleDeleteAllowlistRule = async (id: string) => {
    try {
      await invoke('delete_threat_allowlist', { id });
      await loadSourcesAndAllowlist();
    } catch (err) {
      setSourceFeedback({ text: `Failed removing rule: ${String(err)}`, tone: 'err' });
    }
  };

  const windowHrsNum = Number.parseInt(lookbackHours, 10) || 6;
  const dailyCarbonCap = settings?.preferences.dailyCarbonCap ?? 6;
  const carbonUsed24h = settings?.carbonUsedLast24h ?? 0;
  const cfAccountId = settings?.cfAccountId || '';
  const unifiBaseUrl = settings?.preferences.unifiBaseUrl || 'https://ui.panoramadr.com';

  const deepLinkZoneForAction = (surface: string): string => {
    const s = surface.toUpperCase();
    if (s.includes('PARAKITH')) return 'parakith.com';
    return panoramaZone?.name || 'panoramadr.com';
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top 360° Command Header Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)] border border-[var(--color-brand-ring)] flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                360° Threat Intelligence &amp; Zero Trust Monitor
              </h2>
              {activeRun ? (
                <>
                  <StatusBadge
                    label={`Posture: ${activeRun.overallSeverity}`}
                    variant={severityToBadgeVariant(activeRun.overallSeverity)}
                    pulse={activeRun.overallSeverity === 'HIGH' || activeRun.overallSeverity === 'CRITICAL'}
                  />
                  <StatusBadge
                    label={activeRun.intrusionVerdict.replace(/_/g, ' ')}
                    variant={verdictToBadgeVariant(activeRun.intrusionVerdict)}
                  />
                  {activeRun.escalatedToTier2 && (
                    <StatusBadge
                      label={`Tier 2: ${activeRun.tier2Model || 'gemini-4-carbon'}`}
                      variant="accent"
                      icon={BrainCircuit}
                    />
                  )}
                </>
              ) : (
                <StatusBadge label="No Audit Run Yet" variant="neutral" />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              <StatusBadge
                label={`Cloudflare: ${collectorStatuses.cloudflare}`}
                variant={collectorStatusToBadgeVariant(collectorStatuses.cloudflare)}
                icon={Globe}
              />
              <StatusBadge
                label={`UniFi CloudKey: ${collectorStatuses.unifi}`}
                variant={collectorStatusToBadgeVariant(collectorStatuses.unifi)}
                icon={Wifi}
              />
              <StatusBadge
                label={`WSH / Auth: ${collectorStatuses.wshAuth}`}
                variant={collectorStatusToBadgeVariant(collectorStatuses.wshAuth)}
                icon={Server}
              />
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 tabular-nums">
                Carbon Escalations (24h): {carbonUsed24h} / {dailyCarbonCap === 0 ? '∞' : dailyCarbonCap}
              </span>
              {activeRun && (
                <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  Last run: {formatLocalDateTime(activeRun.completedAt || activeRun.startedAt)} ({activeRun.triggerSource})
                </span>
              )}
            </div>
          </div>

          {/* Primary Actions Bar */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
            <div className="w-40">
              <CustomSelect
                value={lookbackHours}
                onChange={setLookbackHours}
                options={[
                  { value: '6', label: 'Last 6 hours' },
                  { value: '24', label: 'Last 24 hours' },
                  { value: '168', label: 'Last 7 days' },
                ]}
              />
            </div>

            <button
              type="button"
              onClick={() => void onRunAuditNow(windowHrsNum, false)}
              disabled={isRunningAudit}
              className="btn-primary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRunningAudit ? 'animate-spin' : ''}`} />
              <span>{isRunningAudit ? 'Auditing...' : 'Run Audit Now'}</span>
            </button>

            <button
              type="button"
              onClick={() =>
                activeRun
                  ? void onEscalateRunToCarbon(activeRun.id)
                  : void onRunAuditNow(windowHrsNum, true)
              }
              disabled={isRunningAudit}
              className="btn-accent text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              title="Run full 72h forensic fetch and escalate directly to Gemini 4 Carbon (bypasses daily auto cap)"
            >
              <BrainCircuit className="w-3.5 h-3.5" />
              <span>Deep Investigate (Carbon)</span>
            </button>

            <button
              type="button"
              onClick={onNavigateToSettings}
              className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              title="Configure Cloudflare, Gemini 4, and UniFi keys"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Keys</span>
            </button>
          </div>
        </div>

        {/* Degraded / Missing Keys Notice */}
        {activeRun?.errorMessage && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-semibold">
                Degraded Mode ({activeRun.status}) — Deterministic Stage 0 Findings Preserved
              </div>
              <div className="font-mono text-[11px]">{activeRun.errorMessage}</div>
            </div>
          </div>
        )}

        {(!settings?.cfConfigured || !settings?.geminiConfigured) && !activeRun && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <Lock className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
              <span>
                Configure your read-only Cloudflare API Token, Gemini 4 API Key, and optional UniFi X-API-Key in Settings to begin autonomous 6-hour 360° audits.
              </span>
            </div>
            <button
              type="button"
              onClick={onNavigateToSettings}
              className="btn-tonal text-xs whitespace-nowrap flex-shrink-0"
            >
              Configure Keys in Settings
            </button>
          </div>
        )}

        {/* Sub-View Switcher */}
        <div className="pt-1 flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl<SubViewTab>
            activeVariant="brand"
            value={subView}
            onChange={setSubView}
            options={[
              { value: 'overview', label: 'Overview & Brief' },
              {
                value: 'actors',
                label: 'Threat Actors',
                badge: actors.length > 0 ? <span className="tabular-nums font-mono">{actors.length}</span> : undefined,
              },
              { value: 'sources', label: '360° Sources & Allowlist' },
            ]}
          />

          {runs.length > 0 && subView === 'overview' && (
            <div className="w-full sm:w-80">
              <CustomSelect
                value={activeRun?.id || ''}
                onChange={(runId) => {
                  if (runId) void onSelectRunId(runId);
                }}
                options={runs.map((r) => ({
                  value: r.id,
                  label: `${formatLocalDateTime(r.startedAt)} • ${r.overallSeverity}${r.escalatedToTier2 ? ' (Carbon)' : ''}`,
                  description: `${r.triggerSource} (${r.windowHours}h) — ${r.intrusionVerdict}`,
                }))}
              />
            </div>
          )}
        </div>
      </div>

      {/* =================================================================== */}
      {/* SUB-VIEW 1: OVERVIEW & BRIEF                                        */}
      {/* =================================================================== */}
      {subView === 'overview' && (
        <div className="space-y-6">
          {/* 4-Card 360° Telemetry Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 tabular-nums">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-400">
                  panoramadr.com
                </span>
                <StatusBadge label="Strict Private" variant="brand" />
              </div>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {panoramaZone ? panoramaZone.totalRequests.toLocaleString() : '—'}{' '}
                <span className="text-xs font-normal text-slate-500">reqs</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                <span>4xx/5xx: {panoramaZone?.error4xx5xx ?? 0}</span>
                <span>WAF hits: {panoramaZone?.firewallEventsCount ?? 0}</span>
                <span className={(panoramaZone?.untrustedOrigin200s ?? 0) > 0 ? 'text-rose-600 dark:text-rose-400 font-bold' : ''}>
                  Origin 200s: {panoramaZone?.untrustedOrigin200s ?? 0}
                </span>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-400">
                  parakith.com
                </span>
                <StatusBadge label="Public Web" variant="info" />
              </div>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {parakithZone ? parakithZone.totalRequests.toLocaleString() : '—'}{' '}
                <span className="text-xs font-normal text-slate-500">reqs</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                <span>4xx/5xx: {parakithZone?.error4xx5xx ?? 0}</span>
                <span>WAF hits: {parakithZone?.firewallEventsCount ?? 0}</span>
                <span>Bandwidth: {formatCompactBytes(parakithZone?.totalBytes ?? 0)}</span>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-400">
                  Zero Trust &amp; Tunnel
                </span>
                <StatusBadge
                  label={`${zeroTrustSummary.accessAppCount} App(s)`}
                  variant={zeroTrustSummary.accessDenied > 0 ? 'warning' : 'success'}
                />
              </div>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {zeroTrustSummary.accessAllowed} <span className="text-xs font-normal text-slate-500">allowed</span>{' '}
                <span className="text-sm font-mono text-slate-400">/</span>{' '}
                <span className={zeroTrustSummary.accessDenied > 0 ? 'text-amber-600 dark:text-amber-400' : ''}>
                  {zeroTrustSummary.accessDenied}
                </span>{' '}
                <span className="text-xs font-normal text-slate-500">denied</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                <span>
                  Tunnels: {zeroTrustSummary.tunnels.filter((t) => t.status.toLowerCase() === 'healthy').length}/
                  {zeroTrustSummary.tunnels.length} healthy
                </span>
                <span>Control Mutations: {zeroTrustSummary.auditMutations}</span>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-400">
                  UniFi &amp; WSH / Auth
                </span>
                <StatusBadge
                  label={internalSummary.panoramaAuthAvailable ? 'Auth RO Active' : 'SSH Standby'}
                  variant={internalSummary.newUnknownLanMacs.length > 0 || internalSummary.panoramaAuthAnomalies > 0 ? 'danger' : 'success'}
                />
              </div>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {internalSummary.unifiClientsTotal}{' '}
                <span className="text-xs font-normal text-slate-500">LAN clients</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                <span>Unknown MACs: {internalSummary.newUnknownLanMacs.length}</span>
                <span>Auth Anom: {internalSummary.panoramaAuthAnomalies}</span>
                <span>SSH Flagged: {internalSummary.sshAnomalyCount}</span>
                <span>CEF Events: {internalSummary.unifiSiemCefEvents}</span>
              </div>
            </div>
          </div>

          {/* Gemini 4 Threat Brief */}
          {geminiBrief && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <BrainCircuit className="w-5 h-5 text-[var(--color-accent-text)]" />
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Gemini 4 Security Intelligence Brief
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                  {activeRun?.tier1Model && (
                    <StatusBadge label={`Tier 1: ${activeRun.tier1Model}`} variant="info" />
                  )}
                  {activeRun?.tier2Model && (
                    <StatusBadge label={`Tier 2: ${activeRun.tier2Model}`} variant="accent" />
                  )}
                </div>
              </div>

              {escalationReasons.length > 0 && (
                <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-700 dark:text-slate-300">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">Escalation triggers: </span>
                  {escalationReasons.join(' • ')}
                </div>
              )}

              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                  {geminiBrief.executiveSummary}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {geminiBrief.zeroTrustAssessment && (
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                      <div className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                        Zero Trust &amp; Access Assessment
                      </div>
                      <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                        {geminiBrief.zeroTrustAssessment}
                      </p>
                    </div>
                  )}
                  {geminiBrief.internalNetworkAssessment && (
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                      <div className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                        UniFi LAN &amp; WSH Origin Assessment
                      </div>
                      <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                        {geminiBrief.internalNetworkAssessment}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Attack Campaigns */}
              {geminiBrief.attackCampaigns.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                    Identified Attack Campaigns ({geminiBrief.attackCampaigns.length})
                  </div>
                  <div className="space-y-3">
                    {geminiBrief.attackCampaigns.map((camp, idx) => {
                      const copyId = `camp-waf-${idx}`;
                      return (
                        <div
                          key={`${camp.name}-${idx}`}
                          className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge
                                label={camp.severity}
                                variant={severityToBadgeVariant(camp.severity)}
                              />
                              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {camp.name}
                              </span>
                              <span className="text-xs font-mono text-slate-500 tabular-nums">
                                ~{camp.countEstimate} events
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {camp.targetHosts.map((h) => (
                                <span
                                  key={h}
                                  className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-mono text-slate-700 dark:text-slate-300"
                                >
                                  {h}
                                </span>
                              ))}
                            </div>
                          </div>

                          <p className="text-xs text-slate-700 dark:text-slate-300">{camp.pattern}</p>

                          {camp.sampleRayIds.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                              <span className="text-slate-500">Ray IDs:</span>
                              {camp.sampleRayIds.slice(0, 6).map((ray) => (
                                <button
                                  key={ray}
                                  type="button"
                                  onClick={() => void handleCopyText(`ray-${ray}`, ray)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-[var(--color-brand)] cursor-pointer"
                                  title="Click to copy Cloudflare Ray ID"
                                >
                                  <span>{ray}</span>
                                  {copiedKey === `ray-${ray}` ? (
                                    <Check className="w-3 h-3 text-emerald-500" />
                                  ) : (
                                    <Copy className="w-3 h-3 opacity-60" />
                                  )}
                                </button>
                              ))}
                            </div>
                          )}

                          {camp.suggestedWafExpression && (
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                              <pre className="flex-1 overflow-x-auto px-3 py-2 rounded-lg bg-white dark:bg-[#050b14] border border-slate-200/90 dark:border-slate-800 text-emerald-900 dark:text-emerald-400 font-mono text-xs">
                                {camp.suggestedWafExpression}
                              </pre>
                              <button
                                type="button"
                                onClick={() => void handleCopyText(copyId, camp.suggestedWafExpression || '')}
                                className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                              >
                                {copiedKey === copyId ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                                <span>{copiedKey === copyId ? 'Copied!' : 'Copy WAF Rule'}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Recommended Actions */}
              {geminiBrief.recommendedActions.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                    Recommended Read-Only Mitigations ({geminiBrief.recommendedActions.length})
                  </div>
                  <div className="space-y-2.5">
                    {geminiBrief.recommendedActions.map((act, idx) => {
                      const copyKey = `act-waf-${idx}`;
                      const isUnifi = act.surface.toUpperCase().includes('UNIFI');
                      const isZt = act.surface.toUpperCase().includes('ZERO_TRUST');
                      const deepUrl = isUnifi
                        ? buildUnifiConsoleUrl(unifiBaseUrl, 'policies')
                        : isZt
                        ? buildCloudflareZeroTrustLogsUrl(cfAccountId)
                        : buildCloudflareSecurityEventsUrl(cfAccountId, deepLinkZoneForAction(act.surface));

                      return (
                        <div
                          key={`${act.action}-${idx}`}
                          className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge
                                label={act.priority}
                                variant={act.priority === 'IMMEDIATE' ? 'danger' : act.priority === 'SOON' ? 'warning' : 'info'}
                              />
                              <StatusBadge label={act.surface} variant="neutral" />
                              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {act.action}
                              </span>
                            </div>

                            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                              {act.wafRuleSnippet && (
                                <button
                                  type="button"
                                  onClick={() => void handleCopyText(copyKey, act.wafRuleSnippet || '')}
                                  className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                                >
                                  {copiedKey === copyKey ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                                  <span>{copiedKey === copyKey ? 'Copied!' : 'Copy WAF Rule'}</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => void handleOpenExternal(deepUrl)}
                                className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span>
                                  {isUnifi ? 'Open UniFi Console' : isZt ? 'Open Zero Trust Logs' : 'Open Cloudflare Security Events'}
                                </span>
                              </button>
                            </div>
                          </div>

                          <p className="text-xs text-slate-600 dark:text-slate-400">{act.rationale}</p>

                          {act.wafRuleSnippet && (
                            <pre className="overflow-x-auto px-3 py-2 rounded-lg bg-white dark:bg-[#050b14] border border-slate-200/90 dark:border-slate-800 text-emerald-900 dark:text-emerald-400 font-mono text-xs">
                              {act.wafRuleSnippet}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Deterministic Stage 0 Findings Matrix */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[var(--color-brand-text)]" />
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Deterministic Stage 0 Findings ({activeFindings.length})
                </h3>
              </div>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                Rule-based invariants across Cloudflare, UniFi LAN, PanoramaAuth &amp; WSH
              </span>
            </div>

            {activeFindings.length === 0 ? (
              <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center space-y-1">
                <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto" />
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {activeRun ? 'No Deterministic Anomalies Flagged in This Window' : 'Run Your First Audit to Inspect Telemetry'}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Stage 0 checks split sensitivity rules across strict-private and public routes without spending LLM tokens when traffic is clean.
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {activeFindings.map((f) => {
                  const rayIds = safeParseJson<string[]>(f.rayIdsJson, []);
                  const wafExpr = buildWafRuleExpression(
                    f.actorIp ? [f.actorIp] : [],
                    f.actorAsn ? [f.actorAsn] : []
                  );
                  const copyWafKey = `find-waf-${f.id}`;
                  const zoneForLink = f.host?.includes('parakith') ? 'parakith.com' : 'panoramadr.com';

                  return (
                    <div
                      key={f.id}
                      className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge label={f.severity} variant={severityToBadgeVariant(f.severity)} />
                          <StatusBadge label={f.sourceLayer} variant="neutral" />
                          <span className="text-[11px] font-mono text-slate-500">{f.ruleId}</span>
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {f.title}
                          </span>
                        </div>

                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                          {wafExpr && (
                            <button
                              type="button"
                              onClick={() => void handleCopyText(copyWafKey, wafExpr)}
                              className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                            >
                              {copiedKey === copyWafKey ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                              <span>{copiedKey === copyWafKey ? 'Copied!' : 'Copy WAF Rule'}</span>
                            </button>
                          )}
                          {f.sourceLayer === 'CLOUDFLARE' && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleOpenExternal(
                                  buildCloudflareSecurityEventsUrl(cfAccountId, zoneForLink, f.actorIp)
                                )
                              }
                              className="btn-ghost text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Cloudflare Events</span>
                            </button>
                          )}
                          {f.sourceLayer === 'UNIFI' && (
                            <button
                              type="button"
                              onClick={() => void handleOpenExternal(buildUnifiConsoleUrl(unifiBaseUrl, 'threats'))}
                              className="btn-ghost text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>UniFi Console</span>
                            </button>
                          )}
                        </div>
                      </div>

                      <p className="text-xs text-slate-700 dark:text-slate-300">{f.summary}</p>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {f.host && <span>Host: {f.host}</span>}
                        {f.actorIp && <span>IP: {f.actorIp}</span>}
                        {f.actorAsn && <span>ASN: {f.actorAsn}</span>}
                        {rayIds.length > 0 && <span>Rays: {rayIds.slice(0, 4).join(', ')}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SUB-VIEW 2: THREAT ACTORS LEDGER                                    */}
      {/* =================================================================== */}
      {subView === 'actors' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Recurring Threat Actors Ledger
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Cross-run actor tracking with Cloudflare IP Intel, origin-reach counts, and 1-click WAF mitigation expressions.
              </p>
            </div>

            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={actorSearch}
                  onChange={(e) => setActorSearch(e.target.value)}
                  placeholder="Filter IP, ASN, org, host..."
                  className="w-full pl-8 pr-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
                />
              </div>

              <div className="w-40">
                <CustomSelect
                  value={actorDispositionFilter}
                  onChange={setActorDispositionFilter}
                  options={[
                    { value: 'ACTIVE', label: 'Active' },
                    { value: 'ALLOWLISTED', label: 'Allowlisted' },
                    { value: 'RESOLVED', label: 'Resolved' },
                    { value: 'ALL', label: 'All Actors' },
                  ]}
                />
              </div>
            </div>
          </div>

          {sourceFeedback && (
            <div
              className={`text-xs font-mono px-3 py-2 rounded-xl border ${
                sourceFeedback.tone === 'ok'
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                  : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30'
              }`}
            >
              {sourceFeedback.text}
            </div>
          )}

          {isLoadingActors ? (
            <div className="p-8 text-center text-xs font-mono text-slate-500">Loading threat actors...</div>
          ) : filteredActors.length === 0 ? (
            <div className="p-8 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
              No threat actors match the selected disposition filter.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredActors.map((actor) => {
                const hosts = safeParseJson<string[]>(actor.targetHostsJson, []);
                const paths = safeParseJson<string[]>(actor.samplePathsJson, []);
                const tags = safeParseJson<string[]>(actor.intelTagsJson, []);
                const wafExpr = buildWafRuleExpression(
                  actor.ipAddress ? [actor.ipAddress] : [],
                  actor.asn ? [actor.asn] : []
                );
                const copyKey = `actor-waf-${actor.id}`;
                const cfZone = hosts.some((h) => h.includes('parakith')) ? 'parakith.com' : 'panoramadr.com';

                return (
                  <div
                    key={actor.id}
                    className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          label={actor.highestSeverity}
                          variant={severityToBadgeVariant(actor.highestSeverity)}
                        />
                        <span className="text-sm font-mono font-bold text-slate-900 dark:text-slate-100">
                          {actor.ipAddress || actor.id}
                        </span>
                        {actor.country && (
                          <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-mono text-slate-700 dark:text-slate-300">
                            {actor.country}
                          </span>
                        )}
                        {(actor.asn || actor.asOrg) && (
                          <span className="text-xs font-mono text-slate-600 dark:text-slate-400">
                            {actor.asn ? `AS${actor.asn.replace(/^AS/i, '')}` : ''} {actor.asOrg || ''}
                          </span>
                        )}
                        {actor.latestClassification && (
                          <StatusBadge label={actor.latestClassification} variant="accent" />
                        )}
                        <StatusBadge
                          label={actor.disposition}
                          variant={actor.disposition === 'ACTIVE' ? 'warning' : 'neutral'}
                        />
                      </div>

                      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                        {wafExpr && (
                          <button
                            type="button"
                            onClick={() => void handleCopyText(copyKey, wafExpr)}
                            className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                          >
                            {copiedKey === copyKey ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copiedKey === copyKey ? 'Copied!' : 'Copy WAF Rule'}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            void handleOpenExternal(
                              buildCloudflareSecurityEventsUrl(cfAccountId, cfZone, actor.ipAddress)
                            )
                          }
                          className="btn-ghost text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Cloudflare</span>
                        </button>
                        {actor.disposition !== 'ALLOWLISTED' && (
                          <button
                            type="button"
                            onClick={() => void handleAllowlistActor(actor)}
                            className="btn-tonal text-xs whitespace-nowrap flex-shrink-0"
                          >
                            Allowlist
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            void handleSetDisposition(
                              actor.id,
                              actor.disposition === 'RESOLVED' ? 'ACTIVE' : 'RESOLVED'
                            )
                          }
                          className="btn-secondary text-xs whitespace-nowrap flex-shrink-0"
                        >
                          {actor.disposition === 'RESOLVED' ? 'Reopen' : 'Mark Resolved'}
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                      <span>Runs seen: {actor.runsSeen}</span>
                      <span>Requests: {actor.totalRequests}</span>
                      <span className={actor.totalOrigin200s > 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : ''}>
                        Origin 200s: {actor.totalOrigin200s}
                      </span>
                      <span title={formatLocalDateTime(actor.lastSeenAt)}>
                        Last seen: {formatRelativeTime(actor.lastSeenAt)}
                      </span>
                      <span title={formatLocalDateTime(actor.firstSeenAt)}>
                        First seen: {formatRelativeTime(actor.firstSeenAt)}
                      </span>
                    </div>

                    {(tags.length > 0 || actor.intelSummary) && (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        {tags.map((t) => (
                          <StatusBadge key={t} label={`Intel: ${t}`} variant="danger" />
                        ))}
                        {actor.intelSummary && (
                          <span className="text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                            {actor.intelSummary}
                          </span>
                        )}
                      </div>
                    )}

                    {(hosts.length > 0 || paths.length > 0) && (
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 break-all">
                        {hosts.length > 0 && <span className="mr-3">Hosts: {hosts.join(', ')}</span>}
                        {paths.length > 0 && <span>Paths: {paths.slice(0, 6).join(', ')}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* SUB-VIEW 3: 360° SOURCES, LAN BASELINE & ALLOWLIST                  */}
      {/* =================================================================== */}
      {subView === 'sources' && (
        <div className="space-y-6">
          {sourceFeedback && (
            <div
              className={`text-xs font-mono px-3 py-2 rounded-xl border ${
                sourceFeedback.tone === 'ok'
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                  : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30'
              }`}
            >
              {sourceFeedback.text}
            </div>
          )}

          {/* Collector Health & CEF Detection */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                  Cloudflare Perimeter &amp; ZT
                </span>
                <StatusBadge
                  label={collectorStatuses.cloudflare}
                  variant={collectorStatusToBadgeVariant(collectorStatuses.cloudflare)}
                />
              </div>
              <div className="text-xs font-mono text-slate-500 dark:text-slate-400 space-y-1">
                <div>Account ID: {cfAccountId || 'Auto-detect on test'}</div>
                <div>Token: {settings?.cfConfigured ? `${settings.cfSource} • ${settings.maskedCfToken}` : 'Not configured'}</div>
              </div>
              <button
                type="button"
                onClick={() => void handleOpenExternal(buildCloudflareSecurityEventsUrl(cfAccountId, 'panoramadr.com'))}
                className="btn-ghost text-xs flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open Cloudflare Dashboard</span>
              </button>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                  UniFi CloudKey &amp; CEF Syslog
                </span>
                <StatusBadge
                  label={collectorStatuses.unifi}
                  variant={collectorStatusToBadgeVariant(collectorStatuses.unifi)}
                />
              </div>
              <div className="text-xs font-mono text-slate-500 dark:text-slate-400 space-y-1">
                <div>Endpoint: {unifiBaseUrl}</div>
                <div>
                  Optional WSH CEF Syslog:{' '}
                  {internalSummary.unifiSiemCefEvents > 0
                    ? `${internalSummary.unifiSiemCefEvents} recent events`
                    : 'Not active / 0 recent events'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleOpenExternal(buildUnifiConsoleUrl(unifiBaseUrl, 'clients'))}
                className="btn-ghost text-xs flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open UniFi Console</span>
              </button>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                  WSH Origin &amp; PanoramaAuth
                </span>
                <StatusBadge
                  label={collectorStatuses.wshAuth}
                  variant={collectorStatusToBadgeVariant(collectorStatuses.wshAuth)}
                />
              </div>
              <div className="text-xs font-mono text-slate-500 dark:text-slate-400 space-y-1">
                <div>Probe: Read-only SSH SQLite (?mode=ro)</div>
                <div>
                  Auth Watchdog: {internalSummary.panoramaAuthAvailable ? 'Available' : 'Unavailable / Standby'}
                </div>
              </div>
              <button
                type="button"
                onClick={onNavigateToSettings}
                className="btn-ghost text-xs flex items-center gap-1.5"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Test Connections in Settings</span>
              </button>
            </div>
          </div>

          {/* UniFi LAN Baseline Trust Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  UniFi LAN Device Baseline ({trustedLanCount} / {lanClients.length} Trusted)
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Any new MAC address appearing on the LAN outside your trusted baseline triggers a HIGH Unknown-Device finding.
                </p>
              </div>
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadSourcesAndAllowlist()}
                  disabled={isLoadingSources}
                  className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSources ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleTrustAllBaseline()}
                  disabled={lanClients.length === 0}
                  className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Trust All Initial Baseline</span>
                </button>
              </div>
            </div>

            {lanClients.length === 0 ? (
              <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
                No UniFi LAN clients captured yet. Configure your UniFi X-API-Key in Settings and run an audit.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 font-mono text-[11px] text-slate-500 uppercase">
                      <th className="py-2.5 px-3">Device / Hostname</th>
                      <th className="py-2.5 px-3">MAC Address</th>
                      <th className="py-2.5 px-3">IP Address</th>
                      <th className="py-2.5 px-3">VLAN / Vendor</th>
                      <th className="py-2.5 px-3">Last Seen</th>
                      <th className="py-2.5 px-3 text-right">Trusted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                    {lanClients.map((cli) => (
                      <tr key={cli.macAddress} className="hover:bg-slate-50/70 dark:hover:bg-slate-950/60">
                        <td className="py-2.5 px-3 font-sans font-medium text-slate-900 dark:text-slate-100">
                          {cli.label || cli.hostname || 'Unnamed Device'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">{cli.macAddress}</td>
                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">{cli.ipAddress || '—'}</td>
                        <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">
                          {[cli.networkVlan, cli.ouiVendor].filter(Boolean).join(' • ') || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400" title={formatLocalDateTime(cli.lastSeenAt)}>
                          {formatRelativeTime(cli.lastSeenAt)}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="inline-flex justify-end">
                            <ToggleSwitch
                              size="sm"
                              checked={cli.isTrusted}
                              onChange={(val) => void handleToggleLanTrust(cli, val)}
                              activeColor="brand"
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Allowlist Rules Manager */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Threat Suppression Allowlist ({allowlist.length})
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Suppress expected operators, home/office IPs, CIDRs, ASNs, Access emails, LAN MACs, or SSH fingerprints from future findings.
              </p>
            </div>

            <form onSubmit={(e) => void handleAddAllowlistRule(e)} className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end">
              <div className="md:col-span-3">
                <label className="block text-[11px] font-mono text-slate-500 mb-1">Type</label>
                <CustomSelect
                  value={newRuleType}
                  onChange={setNewRuleType}
                  options={[
                    { value: 'IP', label: 'IP Address' },
                    { value: 'CIDR', label: 'IPv4 CIDR' },
                    { value: 'ASN', label: 'ASN' },
                    { value: 'EMAIL', label: 'Zero Trust Email' },
                    { value: 'LAN_MAC', label: 'LAN MAC Address' },
                    { value: 'SSH_KEY', label: 'SSH Key Fingerprint' },
                  ]}
                />
              </div>

              <div className="md:col-span-4">
                <label className="block text-[11px] font-mono text-slate-500 mb-1">Value</label>
                <input
                  type="text"
                  value={newRuleValue}
                  onChange={(e) => setNewRuleValue(e.target.value)}
                  placeholder="e.g. 203.0.113.10 or AS13335"
                  className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-[11px] font-mono text-slate-500 mb-1">Label</label>
                <input
                  type="text"
                  value={newRuleLabel}
                  onChange={(e) => setNewRuleLabel(e.target.value)}
                  placeholder="Operator Workstation"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
                />
              </div>

              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={!newRuleValue.trim()}
                  className="btn-primary w-full text-xs flex items-center justify-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Rule</span>
                </button>
              </div>
            </form>

            {allowlist.length > 0 && (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                {allowlist.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 px-3.5 py-2.5 bg-slate-50/70 dark:bg-slate-950/60 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                      <StatusBadge label={rule.entryType} variant="neutral" />
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {rule.value}
                      </span>
                      <span className="text-slate-600 dark:text-slate-400 truncate">{rule.label}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteAllowlistRule(rule.id)}
                      className="btn-danger text-xs px-2.5 py-1.5 min-h-[36px] flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
