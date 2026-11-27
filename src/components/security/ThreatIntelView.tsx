import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  SegmentedControl,
  StatusBadge,
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
  Mail,
  Server,
  AlertTriangle,
  Sliders,
  Terminal,
  Clock,
  Save,
  ArrowRight,
  ArrowLeftRight,
  Filter,
  Shield,
  Waypoints,
  X,
} from 'lucide-react';
import { CustomSelect } from '../ui/CustomSelect';
import { CopyableAddressText, CopyableValue } from '../ui/CopyableValue';
import { SnoozeSplitButton } from './SnoozeSplitButton';
import { OttoIcon } from '../agent/OttoAvatar';
import type { UnifiZbfPanelTab } from './UnifiVlanZbfPanel';
import { formatLocalDateTime, formatRelativeTime, parseUtcDate } from '../../lib/formatters';
import {
  buildActorCountryOptions,
  buildActorVectorOptions,
  buildCloudflareSecurityEventsUrl,
  buildCloudflareZeroTrustLogsUrl,
  buildDomainFilterOptions,
  buildExternalFindingVectorOptions,
  buildSeverityFilterOptions,
  buildUnifiConsoleUrl,
  buildWafRuleExpression,
  classifyActionSurface,
  classifyAllowlistSurface,
  classifyCampaignSurface,
  classifyFindingSurface,
  collectorStatusToBadgeVariant,
  filterExternalCampaigns,
  filterExternalFindings,
  filterThreatActors,
  formatSnoozeRemaining,
  normalizeHostname,
  safeParseJson,
  severityToBadgeVariant,
  verdictToBadgeVariant,
} from '../../lib/threat-utils';
import {
  computeActionableSecuritySummary,
  getFindingDisposition,
  isFindingActionable,
} from '../../lib/threat-actionability';
import {
  evaluateActionWafCoverage,
  evaluateActorWafCoverage,
  evaluateCampaignWafCoverage,
  evaluateFindingWafCoverage,
  partitionExternalActions,
  type WafActionEvaluation,
} from '../../lib/waf-coverage';
import {
  buildRecommendedActionKey,
  loadRecommendedActionDispositions,
  partitionRecommendedActions,
  saveRecommendedActionDispositions,
  type RecommendedActionDisposition,
  type RecommendedActionDispositionMap,
} from '../../lib/recommended-action-triage';
import type {
  CfAccessPolicyGrantDto,
  CfAttachedAccessPolicyDto,
  CfAccessPolicySyncResultDto,
  CfWafRuleDto,
  CfZoneSummary,
  CloudflareWafSnapshotDto,
  CollectorStatuses,
  GeminiActionDto,
  GeminiBriefDto,
  InternalNetworkSummary,
  LanClientBaselineRow,
  OttoContextSeed,
  QuarantinedAccessEmailRow,
  TerminalTab,
  ThreatActorRow,
  ThreatAllowlistRow,
  ThreatAuditRunRow,
  ThreatFindingRow,
  ThreatIntelSettingsViewDto,
  ThreatRunDetailDto,
  WshSnapshot,
  ZeroTrustSummary,
} from '../../lib/types';

export type ThreatSubViewTab = 'overview' | 'external' | 'internal' | 'allowlist';
type SubViewTab = ThreatSubViewTab;

function parsePolicyGrants(grantsJson: string): CfAccessPolicyGrantDto[] {
  const parsed = safeParseJson<CfAccessPolicyGrantDto[]>(grantsJson, []);
  return Array.isArray(parsed) ? parsed : [];
}

function extractFindingActorEmail(f: ThreatFindingRow): string | null {
  const parsed = safeParseJson<{
    matchedAccessEmails?: string[];
    email?: string;
    actorEmail?: string;
  }>(f.evidenceJson, {});
  const candidate =
    parsed.matchedAccessEmails?.[0]?.trim() ||
    parsed.email?.trim() ||
    parsed.actorEmail?.trim() ||
    '';
  return candidate || null;
}

function PolicyGrantProvenanceChips({ grants }: { grants: CfAccessPolicyGrantDto[] }) {
  if (grants.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
      {grants.map((g, idx) => (
        <span
          key={`${g.policyId || idx}-${g.viaGroupId || 'direct'}`}
          className="inline-flex flex-wrap items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
        >
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {g.policyName || 'Unnamed Policy'}
          </span>
          <span className="text-slate-500">#{g.precedence}</span>
          <span className="px-1 py-0.2 rounded bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            {g.reusable ? 'Reusable' : 'App-Local'}
          </span>
          {g.sessionDuration && <span>{g.sessionDuration}</span>}
          {g.viaGroupName && (
            <span className="text-amber-700 dark:text-amber-300">Group: {g.viaGroupName}</span>
          )}
          {g.policyCreatedAt && (
            <span className="text-slate-500">Created {g.policyCreatedAt.slice(0, 10)}</span>
          )}
          {g.policyUpdatedAt && (
            <span className="text-slate-500">Updated {g.policyUpdatedAt.slice(0, 10)}</span>
          )}
        </span>
      ))}
    </div>
  );
}

function formatRunDuration(startedAt: string, completedAt?: string | null): string | null {
  const s = parseUtcDate(startedAt);
  const c = parseUtcDate(completedAt);
  if (!s || !c) return null;
  const secs = Math.max(0, Math.round((c.getTime() - s.getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

export interface ThreatAuditProgressUiState {
  runId: string;
  stage: string;
  label: string;
  message: string;
  level: string;
  startedAtMs: number;
}

interface ThreatIntelViewProps {
  latestDetail: ThreatRunDetailDto | null;
  runs: ThreatAuditRunRow[];
  settings: ThreatIntelSettingsViewDto | null;
  isRunningAudit: boolean;
  auditProgress?: ThreatAuditProgressUiState | null;
  onRunAuditNow: (windowHours: number, forceCarbon?: boolean) => Promise<void>;
  onEscalateRunToCarbon: (runId: string) => Promise<void>;
  onSelectRunId: (runId: string) => Promise<void>;
  onRefreshAll: () => Promise<void>;
  onNavigateToSettings: () => void;
  onNavigateToSiemRelease?: () => void;
  onNavigateToHardening?: () => void;
  onNavigateToUnifiZbf?: (tab?: UnifiZbfPanelTab, searchQuery?: string) => void;
  hardeningPassingCount?: number;
  hardeningTotalCount?: number;
  securityViolationCount?: number;
  wshSnapshot?: WshSnapshot | null;
  terminalTabs?: TerminalTab[];
  onOpenInBottomConsole?: (tabId?: string) => void;
  onAbortJob?: (tabId: string) => void;
  onClearTab?: (tabId: string) => void;
  initialSubView?: ThreatSubViewTab;
  initialFocusId?: string;
  initialNavNonce?: number;
  quarantinedAccessEmails?: QuarantinedAccessEmailRow[];
  onQuarantineChanged?: () => void;
  onAskOtto?: (seed: OttoContextSeed) => void;
  onOpenDefensePlans?: () => void;
  onStageWafDefense?: (input: {
    title: string;
    targetZone: string;
    targetHost?: string | null;
    actionType: 'managed_challenge' | 'block';
    targetIps: string[];
    targetAsns: string[];
    rcaSummary: string;
  }) => Promise<void>;
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

const AUDIT_PIPELINE_STEPS = [
  { key: 'collect', label: '1. Collect (CF / UniFi / WSH)' },
  { key: 'stage0', label: '2. Stage 0 Triage' },
  { key: 'stage1', label: '3. Gemini Base (Hydrogen)' },
  { key: 'stage2', label: '4. Deep AI & Save' },
];

function tier2ModelShortLabel(model?: string | null): string {
  const m = (model || '').trim().toLowerCase();
  if (m === 'gemini-4-carbon') return 'Carbon';
  if (m === 'gemini-4-hydrogen') return 'Hydrogen';
  return 'Neon';
}

function stageToStepIndex(stage: string | undefined): number {
  switch ((stage || '').toLowerCase()) {
    case 'stage0':
      return 1;
    case 'stage1':
      return 2;
    case 'forensics':
    case 'stage2':
    case 'persist':
    case 'done':
      return 3;
    default:
      return 0;
  }
}

export const ThreatIntelView: React.FC<ThreatIntelViewProps> = ({
  latestDetail,
  runs,
  settings,
  isRunningAudit,
  auditProgress = null,
  onRunAuditNow,
  onEscalateRunToCarbon,
  onSelectRunId,
  onRefreshAll,
  onNavigateToSettings,
  onNavigateToSiemRelease,
  onNavigateToHardening,
  onNavigateToUnifiZbf,
  hardeningPassingCount = 0,
  hardeningTotalCount = 0,
  securityViolationCount = 0,
  wshSnapshot = null,
  terminalTabs = [],
  onOpenInBottomConsole,
  initialSubView,
  initialFocusId,
  initialNavNonce = 0,
  quarantinedAccessEmails,
  onQuarantineChanged,
  onAskOtto,
  onOpenDefensePlans,
  onStageWafDefense,
}) => {
  const [subView, setSubView] = useState<SubViewTab>(() => initialSubView || 'overview');
  const [focusedItemId, setFocusedItemId] = useState<string | null>(() => initialFocusId || null);
  const [lookbackHours, setLookbackHours] = useState<string>('6');
  const [auditElapsedSec, setAuditElapsedSec] = useState<number>(0);

  // External Threat Actors, Findings & Campaigns filter state
  const [actors, setActors] = useState<ThreatActorRow[]>([]);
  const [actorDispositionFilter, setActorDispositionFilter] = useState<string>('ACTIONABLE');
  const [actorSearch, setActorSearch] = useState<string>('');
  const [actorDomainFilter, setActorDomainFilter] = useState<string>('ALL');
  const [actorSeverityFilter, setActorSeverityFilter] = useState<string>('ALL');
  const [actorVectorFilter, setActorVectorFilter] = useState<string>('ALL');
  const [actorCountryFilter, setActorCountryFilter] = useState<string>('ALL');
  const [findingSearch, setFindingSearch] = useState<string>('');
  const [findingDomainFilter, setFindingDomainFilter] = useState<string>('ALL');
  const [findingSeverityFilter, setFindingSeverityFilter] = useState<string>('ALL');
  const [findingVectorFilter, setFindingVectorFilter] = useState<string>('ALL');
  const [campaignDomainFilter, setCampaignDomainFilter] = useState<string>('ALL');
  const [campaignSeverityFilter, setCampaignSeverityFilter] = useState<string>('ALL');
  const [showExternalInformationalFindings, setShowExternalInformationalFindings] =
    useState<boolean>(false);
  const [showInternalInformationalFindings, setShowInternalInformationalFindings] =
    useState<boolean>(false);
  const [actionDispositions, setActionDispositions] = useState<RecommendedActionDispositionMap>(() =>
    loadRecommendedActionDispositions()
  );
  const [showHiddenActions, setShowHiddenActions] = useState<boolean>(false);
  const [isLoadingActors, setIsLoadingActors] = useState<boolean>(false);

  // Live Cloudflare WAF Custom Rules + Local Tracked Overrides state
  const [wafSnapshot, setWafSnapshot] = useState<CloudflareWafSnapshotDto | null>(null);
  const [isLoadingWaf, setIsLoadingWaf] = useState<boolean>(false);
  const [wafFeedback, setWafFeedback] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const [showManualWafForm, setShowManualWafForm] = useState<boolean>(false);
  const [manualWafZone, setManualWafZone] = useState<string>('parakith.com');
  const [manualWafName, setManualWafName] = useState<string>('');
  const [manualWafAction, setManualWafAction] = useState<string>('block');
  const [manualWafExpr, setManualWafExpr] = useState<string>('');
  const [isSavingWafOverride, setIsSavingWafOverride] = useState<boolean>(false);

  // Internal LAN Baseline, Quarantine & Allowlist state (promoted UniFi ZBF UI lives in UnifiNetworkZbfView)
  const [lanClients, setLanClients] = useState<LanClientBaselineRow[]>([]);
  const [allowlist, setAllowlist] = useState<ThreatAllowlistRow[]>([]);
  const [localQuarantinedEmails, setLocalQuarantinedEmails] = useState<QuarantinedAccessEmailRow[] | null>(
    null
  );
  const [syncedAttachedPolicies, setSyncedAttachedPolicies] = useState<CfAttachedAccessPolicyDto[] | null>(
    null
  );
  const [syncPermissionHint, setSyncPermissionHint] = useState<string | null>(null);
  const [isSyncingQuarantine, setIsSyncingQuarantine] = useState<boolean>(false);
  const [newRuleType, setNewRuleType] = useState<string>('IP');
  const [newRuleValue, setNewRuleValue] = useState<string>('');
  const [newRuleLabel, setNewRuleLabel] = useState<string>('');
  const [sourceFeedback, setSourceFeedback] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  useEffect(() => {
    if (quarantinedAccessEmails !== undefined) {
      setLocalQuarantinedEmails(quarantinedAccessEmails);
    }
  }, [quarantinedAccessEmails]);

  // Clipboard copy feedback key
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const activeRun = latestDetail?.run ?? runs[0] ?? null;
  const activeFindings = latestDetail?.findings ?? [];

  useEffect(() => {
    if (!isRunningAudit) {
      setAuditElapsedSec(0);
      return;
    }
    const startMs = auditProgress?.startedAtMs ?? Date.now();
    const sync = () => {
      setAuditElapsedSec(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    };
    sync();
    const timer = window.setInterval(sync, 1000);
    return () => window.clearInterval(timer);
  }, [isRunningAudit, auditProgress?.startedAtMs]);

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

  const activeFindingsRef = React.useRef<ThreatFindingRow[]>(activeFindings);
  activeFindingsRef.current = activeFindings;
  const onRefreshAllRef = React.useRef(onRefreshAll);
  onRefreshAllRef.current = onRefreshAll;

  const autoResolveWafCoveredFindings = useCallback(async (rules: CfWafRuleDto[]): Promise<number> => {
    if (!rules || rules.length === 0) return 0;
    const idsToResolve = activeFindingsRef.current
      .filter((f) => {
        if (classifyFindingSurface(f.sourceLayer) !== 'external') return false;
        if (getFindingDisposition(f) !== 'ACTIVE') return false;
        const ruleUpper = (f.ruleId || '').trim().toUpperCase();
        if (ruleUpper === 'ORIGIN_BREACH_THROUGH' || ruleUpper === 'ZT_UNEXPECTED_ACCESS') {
          return false;
        }
        return evaluateFindingWafCoverage(f, rules).status === 'COVERED';
      })
      .map((f) => f.id);
    if (idsToResolve.length === 0) return 0;
    try {
      return await invoke<number>('resolve_threat_findings_batch', {
        findingIds: idsToResolve,
        note: 'Covered by active Cloudflare WAF rule',
      });
    } catch {
      return 0;
    }
  }, []);

  const loadActors = useCallback(async () => {
    setIsLoadingActors(true);
    try {
      const list = await invoke<ThreatActorRow[]>('get_threat_actors', {
        disposition: 'ALL',
      });
      setActors(Array.isArray(list) ? list : []);
    } catch (err) {
      console.warn('[PanoramaSRE] Failed loading threat actors:', err);
    } finally {
      setIsLoadingActors(false);
    }
  }, []);

  const loadSourcesAndAllowlist = useCallback(async () => {
    try {
      const [lan, rules, quarantined] = await Promise.all([
        invoke<LanClientBaselineRow[]>('get_lan_clients_baseline'),
        invoke<ThreatAllowlistRow[]>('get_threat_allowlist'),
        invoke<QuarantinedAccessEmailRow[]>('get_quarantined_access_emails').catch(() => null),
      ]);
      setLanClients(Array.isArray(lan) ? lan : []);
      setAllowlist(Array.isArray(rules) ? rules : []);
      if (Array.isArray(quarantined)) {
        setLocalQuarantinedEmails(quarantined);
      }
    } catch (err) {
      console.warn('[PanoramaSRE] Failed loading LAN baseline & allowlist:', err);
    }
  }, []);

  const loadWafRules = useCallback(async (forceRefresh = false) => {
    setIsLoadingWaf(true);
    try {
      const snap = await invoke<CloudflareWafSnapshotDto>('get_cloudflare_waf_rules', {
        forceRefresh,
      });
      setWafSnapshot(snap ?? null);
      if (forceRefresh) {
        const autoResolved = snap?.rules ? await autoResolveWafCoveredFindings(snap.rules) : 0;
        setWafFeedback({
          text: snap?.wafReadOk
            ? `Synced ${snap.rules.length} Cloudflare WAF rule(s) across ${snap.zones.length} zone(s)${
                autoResolved > 0 ? ` — auto-resolved ${autoResolved} covered finding(s)` : ''
              }.`
            : snap?.permissionHint || 'Live WAF sync unavailable; using tracked local rules.',
          tone: snap?.wafReadOk ? 'ok' : 'err',
        });
        setTimeout(() => setWafFeedback(null), 5000);
        await onRefreshAllRef.current();
      }
    } catch (err) {
      if (forceRefresh) {
        setWafFeedback({ text: `WAF sync error: ${String(err)}`, tone: 'err' });
      }
    } finally {
      setIsLoadingWaf(false);
    }
  }, [autoResolveWafCoveredFindings]);

  useEffect(() => {
    void loadActors();
  }, [loadActors, activeRun?.id]);

  useEffect(() => {
    void loadSourcesAndAllowlist();
  }, [loadSourcesAndAllowlist, activeRun?.id]);

  useEffect(() => {
    void loadWafRules(false);
  }, [loadWafRules, activeRun?.id, settings?.cfConfigured]);

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

  const effectiveQuarantinedEmails = useMemo(
    () => localQuarantinedEmails ?? quarantinedAccessEmails ?? [],
    [localQuarantinedEmails, quarantinedAccessEmails]
  );
  const pendingQuarantined = useMemo(
    () => effectiveQuarantinedEmails.filter((q) => q.status === 'PENDING'),
    [effectiveQuarantinedEmails]
  );
  const effectiveAttachedPolicies = useMemo(
    () => syncedAttachedPolicies ?? zeroTrustSummary.attachedAccessPolicies ?? [],
    [syncedAttachedPolicies, zeroTrustSummary.attachedAccessPolicies]
  );
  const effectivePolicyPermissionHint =
    syncPermissionHint ?? zeroTrustSummary.accessPoliciesPermissionHint ?? null;

  const actorEmailByIp = useMemo(() => {
    const map = new Map<string, { email: string; verified: boolean; source?: string }>();
    for (const s of zeroTrustSummary.verifiedFamilySessions ?? []) {
      const ipKey = (s.ipAddress || '').trim().toLowerCase();
      if (ipKey && s.email?.trim()) {
        map.set(ipKey, { email: s.email.trim(), verified: true, source: s.authSource });
      }
    }
    for (const f of activeFindings) {
      const ipKey = (f.actorIp || '').trim().toLowerCase();
      if (!ipKey || map.has(ipKey)) continue;
      const email = extractFindingActorEmail(f);
      if (email) {
        map.set(ipKey, { email, verified: false });
      }
    }
    return map;
  }, [zeroTrustSummary.verifiedFamilySessions, activeFindings]);

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

  const knownCfZones = useMemo(() => {
    const zoneSet = new Set<string>(['panoramadr.com', 'parakith.com']);
    for (const z of zonesSummary) {
      const clean = normalizeHostname(z.name);
      if (clean) zoneSet.add(clean);
    }
    return Array.from(zoneSet);
  }, [zonesSummary]);

  const activeQuickZoneFilter = useMemo(() => {
    if (
      campaignDomainFilter !== 'ALL' &&
      campaignDomainFilter === findingDomainFilter &&
      findingDomainFilter === actorDomainFilter
    ) {
      return campaignDomainFilter;
    }
    return '';
  }, [campaignDomainFilter, findingDomainFilter, actorDomainFilter]);

  const handleToggleExternalZoneFilter = useCallback(
    (zoneName: string) => {
      const cleanZone = normalizeHostname(zoneName);
      if (!cleanZone) return;
      const targetVal = `zone:${cleanZone}`;
      const isAlreadySelected =
        campaignDomainFilter === targetVal &&
        findingDomainFilter === targetVal &&
        actorDomainFilter === targetVal;
      const next = isAlreadySelected ? 'ALL' : targetVal;
      setCampaignDomainFilter(next);
      setFindingDomainFilter(next);
      setActorDomainFilter(next);
    },
    [campaignDomainFilter, findingDomainFilter, actorDomainFilter]
  );

  const externalFindings = useMemo(
    () => activeFindings.filter((f) => classifyFindingSurface(f.sourceLayer) === 'external'),
    [activeFindings]
  );

  const internalFindings = useMemo(
    () => activeFindings.filter((f) => classifyFindingSurface(f.sourceLayer) === 'internal'),
    [activeFindings]
  );

  const externalCampaigns = useMemo(
    () =>
      (geminiBrief?.attackCampaigns ?? []).filter((c) => {
        const surf = classifyCampaignSurface(c);
        return surf === 'external' || surf === 'crossover';
      }),
    [geminiBrief]
  );

  const internalCampaigns = useMemo(
    () =>
      (geminiBrief?.attackCampaigns ?? []).filter((c) => {
        const surf = classifyCampaignSurface(c);
        return surf === 'internal' || surf === 'crossover';
      }),
    [geminiBrief]
  );

  const campaignDomainOptions = useMemo(
    () =>
      buildDomainFilterOptions(
        externalCampaigns.map((c) => c.targetHosts),
        knownCfZones
      ),
    [externalCampaigns, knownCfZones]
  );

  const campaignSeverityOptions = useMemo(
    () => buildSeverityFilterOptions(externalCampaigns.map((c) => c.severity)),
    [externalCampaigns]
  );

  const filteredExternalCampaigns = useMemo(
    () =>
      filterExternalCampaigns(externalCampaigns, {
        domain: campaignDomainFilter,
        severity: campaignSeverityFilter,
      }),
    [externalCampaigns, campaignDomainFilter, campaignSeverityFilter]
  );

  const hasActiveCampaignFilters =
    campaignDomainFilter !== 'ALL' || campaignSeverityFilter !== 'ALL';

  const clearCampaignFilters = useCallback(() => {
    setCampaignDomainFilter('ALL');
    setCampaignSeverityFilter('ALL');
  }, []);

  const findingDomainOptions = useMemo(
    () =>
      buildDomainFilterOptions(
        externalFindings.map((f) => [f.host]),
        knownCfZones
      ),
    [externalFindings, knownCfZones]
  );

  const findingSeverityOptions = useMemo(
    () => buildSeverityFilterOptions(externalFindings.map((f) => f.severity)),
    [externalFindings]
  );

  const findingVectorOptions = useMemo(
    () => buildExternalFindingVectorOptions(externalFindings),
    [externalFindings]
  );

  const filteredExternalFindings = useMemo(
    () =>
      filterExternalFindings(externalFindings, {
        search: findingSearch,
        domain: findingDomainFilter,
        severity: findingSeverityFilter,
        vector: findingVectorFilter,
      }),
    [externalFindings, findingSearch, findingDomainFilter, findingSeverityFilter, findingVectorFilter]
  );

  const hasActiveFindingFilters =
    findingSearch.trim().length > 0 ||
    findingDomainFilter !== 'ALL' ||
    findingSeverityFilter !== 'ALL' ||
    findingVectorFilter !== 'ALL';

  const clearFindingFilters = useCallback(() => {
    setFindingSearch('');
    setFindingDomainFilter('ALL');
    setFindingSeverityFilter('ALL');
    setFindingVectorFilter('ALL');
  }, []);

  const wafRules: CfWafRuleDto[] = useMemo(
    () => wafSnapshot?.rules ?? [],
    [wafSnapshot]
  );

  const actionableSummary = useMemo(
    () =>
      computeActionableSecuritySummary({
        latestRun: activeRun,
        findings: activeFindings,
        actors,
        wafRules,
      }),
    [activeRun, activeFindings, actors, wafRules]
  );

  const actorCounts = useMemo(() => {
    let snoozed = 0;
    let allowlisted = 0;
    let resolved = 0;
    let expired = 0;
    for (const a of actors) {
      const disp = (a.disposition || '').trim().toUpperCase();
      if (disp === 'SNOOZED') snoozed += 1;
      else if (disp === 'ALLOWLISTED') allowlisted += 1;
      else if (disp === 'RESOLVED') resolved += 1;
      else if (disp === 'EXPIRED') expired += 1;
    }
    return { snoozed, allowlisted, resolved, expired };
  }, [actors]);

  const actorBucket = useMemo(() => {
    const filterUpper = actorDispositionFilter.trim().toUpperCase();
    if (filterUpper === 'ACTIONABLE') {
      return actionableSummary.actionableActors;
    }
    if (filterUpper === 'NOISE') {
      return actionableSummary.backgroundNoiseActors;
    }
    if (filterUpper === 'ALL') {
      return actors;
    }
    return actors.filter(
      (a) => (a.disposition || '').trim().toUpperCase() === filterUpper
    );
  }, [actorDispositionFilter, actors, actionableSummary]);

  const actorDomainOptions = useMemo(
    () =>
      buildDomainFilterOptions(
        actorBucket.map((a) => safeParseJson<string[]>(a.targetHostsJson, [])),
        knownCfZones
      ),
    [actorBucket, knownCfZones]
  );

  const actorSeverityOptions = useMemo(
    () => buildSeverityFilterOptions(actorBucket.map((a) => a.highestSeverity)),
    [actorBucket]
  );

  const actorVectorOptions = useMemo(
    () => buildActorVectorOptions(actorBucket),
    [actorBucket]
  );

  const actorCountryOptions = useMemo(
    () => buildActorCountryOptions(actorBucket),
    [actorBucket]
  );

  const filteredActors = useMemo(
    () =>
      filterThreatActors(actorBucket, actorSearch, 'ALL', {
        domain: actorDomainFilter,
        severity: actorSeverityFilter,
        vector: actorVectorFilter,
        country: actorCountryFilter,
      }),
    [
      actorBucket,
      actorSearch,
      actorDomainFilter,
      actorSeverityFilter,
      actorVectorFilter,
      actorCountryFilter,
    ]
  );

  const hasActiveActorFilters =
    actorSearch.trim().length > 0 ||
    actorDomainFilter !== 'ALL' ||
    actorSeverityFilter !== 'ALL' ||
    actorVectorFilter !== 'ALL' ||
    actorCountryFilter !== 'ALL';

  const clearActorFilters = useCallback(() => {
    setActorSearch('');
    setActorDomainFilter('ALL');
    setActorSeverityFilter('ALL');
    setActorVectorFilter('ALL');
    setActorCountryFilter('ALL');
  }, []);

  const scrollToDomTarget = useCallback((domId: string) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    window.setTimeout(() => {
      const el = document.getElementById(domId);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 80);
  }, []);

  const jumpToThreatTarget = useCallback(
    (
      targetTab: 'external' | 'internal',
      domId: string,
      opts?: { clearFindings?: boolean; clearActors?: boolean }
    ) => {
      setSubView(targetTab);
      if (opts?.clearFindings) {
        clearFindingFilters();
      }
      if (opts?.clearActors) {
        clearActorFilters();
        setActorDispositionFilter('ACTIONABLE');
      }
      setFocusedItemId(domId);
      scrollToDomTarget(domId);
    },
    [clearActorFilters, clearFindingFilters, scrollToDomTarget]
  );

  useEffect(() => {
    if (!initialNavNonce || initialNavNonce <= 0) return;
    if (initialSubView) {
      setSubView(initialSubView);
    }
    if (initialFocusId) {
      if (initialFocusId.startsWith('threat-actor-')) {
        clearActorFilters();
        setActorDispositionFilter('ACTIONABLE');
      } else if (initialFocusId.startsWith('threat-finding-')) {
        clearFindingFilters();
      }
      setFocusedItemId(initialFocusId);
      scrollToDomTarget(initialFocusId);
    }
  }, [
    initialNavNonce,
    initialSubView,
    initialFocusId,
    clearActorFilters,
    clearFindingFilters,
    scrollToDomTarget,
  ]);

  const trustedLanCount = useMemo(
    () => lanClients.filter((c) => c.isTrusted).length,
    [lanClients]
  );

  const externalActions = useMemo(
    () => (geminiBrief?.recommendedActions || []).filter((a) => classifyActionSurface(a.surface) === 'external'),
    [geminiBrief]
  );

  const internalActions = useMemo(
    () => (geminiBrief?.recommendedActions || []).filter((a) => classifyActionSurface(a.surface) === 'internal'),
    [geminiBrief]
  );

  const observedPathsByHost = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const actor of actors) {
      const hosts = safeParseJson<string[]>(actor.targetHostsJson, []);
      const paths = safeParseJson<string[]>(actor.samplePathsJson, []);
      for (const h of hosts) {
        const cleanHost = normalizeHostname(h);
        if (!cleanHost) continue;
        let set = map.get(cleanHost);
        if (!set) {
          set = new Set<string>();
          map.set(cleanHost, set);
        }
        for (const p of paths) {
          if (p && p.trim() !== '/') set.add(p);
        }
      }
    }
    return map;
  }, [actors]);

  const partitionedExternalActions = useMemo(() => {
    const wafPart = partitionExternalActions(externalActions, wafRules, externalCampaigns);
    const triagePart = partitionRecommendedActions(wafPart.visibleActions, actionDispositions);
    return {
      visibleActions: triagePart.active,
      hiddenActions: triagePart.hidden,
      suppressedCoveredCount: wafPart.suppressedCoveredCount,
    };
  }, [externalActions, wafRules, externalCampaigns, actionDispositions]);

  const internalActionsState = useMemo(
    () =>
      partitionRecommendedActions(
        internalActions.map((action) => ({ action })),
        actionDispositions
      ),
    [internalActions, actionDispositions]
  );

  const overviewActionsState = useMemo(() => {
    const all = geminiBrief?.recommendedActions || [];
    const candidateVisible: Array<{ action: GeminiActionDto; coverage: WafActionEvaluation | null }> =
      [];
    let suppressedCount = 0;

    for (const act of all) {
      if (classifyActionSurface(act.surface) === 'external') {
        const cov = evaluateActionWafCoverage(act, wafRules, externalCampaigns);
        if (cov.isWafAddAction && cov.status === 'COVERED') {
          suppressedCount += 1;
          continue;
        }
        candidateVisible.push({ action: act, coverage: cov });
      } else {
        candidateVisible.push({ action: act, coverage: null });
      }
    }
    const triagePart = partitionRecommendedActions(candidateVisible, actionDispositions);
    return { visible: triagePart.active, hidden: triagePart.hidden, suppressedCount };
  }, [geminiBrief, wafRules, externalCampaigns, actionDispositions]);

  const siemContainer = useMemo(
    () =>
      (wshSnapshot?.containers || []).find((c) =>
        (c.Names || c.ID || '').toLowerCase().includes('unifi-siem')
      ),
    [wshSnapshot?.containers]
  );

  const healthyTunnelsCount = useMemo(
    () => zeroTrustSummary.tunnels.filter((t) => t.status.toLowerCase() === 'healthy').length,
    [zeroTrustSummary.tunnels]
  );

  const totalOrigin200Breaches = useMemo(
    () =>
      (panoramaZone?.untrustedOrigin200s ?? 0) +
      zonesSummary
        .filter((z) => !z.name.toLowerCase().includes('parakith'))
        .reduce((acc, z) => (panoramaZone && z.id === panoramaZone.id ? acc : acc + (z.untrustedOrigin200s || 0)), 0),
    [panoramaZone, zonesSummary]
  );

  const totalWafHits = useMemo(
    () => zonesSummary.reduce((acc, z) => acc + (z.firewallEventsCount || 0), 0),
    [zonesSummary]
  );

  const handleSetDisposition = async (actorId: string, disposition: string) => {
    try {
      await invoke('set_threat_actor_disposition', { actorId, disposition });
      await Promise.all([loadActors(), onRefreshAll()]);
    } catch (err) {
      setSourceFeedback({ text: `Disposition update failed: ${String(err)}`, tone: 'err' });
    }
  };

  const handleSnoozeActor = async (actorId: string, days: number) => {
    try {
      await invoke('snooze_threat_actor', { actorId, days });
      setSourceFeedback({ text: `Snoozed ${actorId} for ${days} day(s).`, tone: 'ok' });
      setTimeout(() => setSourceFeedback(null), 3500);
      await Promise.all([loadActors(), onRefreshAll()]);
    } catch (err) {
      setSourceFeedback({ text: `Snooze failed: ${String(err)}`, tone: 'err' });
    }
  };

  const handleSnoozeRecommendedAction = (act: GeminiActionDto, days: number) => {
    const key = buildRecommendedActionKey(act);
    if (!key) return;
    const snoozedUntil = new Date(Date.now() + days * 86_400_000).toISOString();
    const next: RecommendedActionDispositionMap = {
      ...actionDispositions,
      [key]: {
        key,
        status: 'SNOOZED',
        snoozedUntil,
        updatedAt: new Date().toISOString(),
        actionLabel: act.action,
        surface: act.surface,
      },
    };
    setActionDispositions(next);
    saveRecommendedActionDispositions(next);
    setSourceFeedback({ text: `Snoozed recommended action for ${days} day(s).`, tone: 'ok' });
    setTimeout(() => setSourceFeedback(null), 3500);
  };

  const handleDismissRecommendedAction = (act: GeminiActionDto) => {
    const key = buildRecommendedActionKey(act);
    const next: RecommendedActionDispositionMap = {
      ...actionDispositions,
      [key]: {
        key,
        status: 'DISMISSED',
        snoozedUntil: null,
        updatedAt: new Date().toISOString(),
        actionLabel: act.action,
        surface: act.surface,
      },
    };
    setActionDispositions(next);
    saveRecommendedActionDispositions(next);
    setSourceFeedback({ text: 'Permanently dismissed recommended action.', tone: 'ok' });
    setTimeout(() => setSourceFeedback(null), 3500);
  };

  const handleRestoreRecommendedAction = (key: string) => {
    if (!(key in actionDispositions)) return;
    const next = { ...actionDispositions };
    delete next[key];
    setActionDispositions(next);
    saveRecommendedActionDispositions(next);
    setSourceFeedback({ text: 'Restored recommended action to active view.', tone: 'ok' });
    setTimeout(() => setSourceFeedback(null), 3500);
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

  const handleSetFindingDisposition = async (
    findingId: string,
    disposition: 'ACTIVE' | 'RESOLVED' | 'SNOOZED' | 'DISMISSED',
    snoozeDays?: number,
    note?: string
  ) => {
    try {
      await invoke('set_threat_finding_disposition', {
        findingId,
        disposition,
        snoozeDays: snoozeDays ?? null,
        note: note ?? null,
      });
      const label =
        disposition === 'SNOOZED'
          ? `Snoozed finding for ${snoozeDays ?? 7} day(s).`
          : disposition === 'ACTIVE'
          ? 'Reopened finding.'
          : `Marked finding as ${disposition.toLowerCase()}.`;
      setSourceFeedback({ text: label, tone: 'ok' });
      setTimeout(() => setSourceFeedback(null), 3500);
      await onRefreshAllRef.current();
    } catch (err) {
      setSourceFeedback({ text: `Finding update failed: ${String(err)}`, tone: 'err' });
    }
  };

  const handleAllowlistFindingTarget = async (
    entryType: 'IP' | 'EMAIL',
    value: string,
    label: string
  ) => {
    const clean = value.trim();
    if (!clean) return;
    try {
      await invoke('upsert_threat_allowlist', { entryType, value: clean, label });
      await Promise.all([loadActors(), loadSourcesAndAllowlist(), onRefreshAllRef.current()]);
      setSourceFeedback({
        text: `Allowlisted ${clean} and resolved matching findings.`,
        tone: 'ok',
      });
      setTimeout(() => setSourceFeedback(null), 3500);
    } catch (err) {
      setSourceFeedback({ text: `Allowlist failed: ${String(err)}`, tone: 'err' });
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
      await Promise.all([loadSourcesAndAllowlist(), loadActors(), onRefreshAllRef.current()]);
      setSourceFeedback({ text: `Added ${newRuleType} allowlist rule: ${val}`, tone: 'ok' });
      setTimeout(() => setSourceFeedback(null), 3500);
    } catch (err) {
      setSourceFeedback({ text: `Failed adding rule: ${String(err)}`, tone: 'err' });
    }
  };

  const handleDeleteAllowlistRule = async (id: string) => {
    try {
      await invoke('delete_threat_allowlist', { id });
      await Promise.all([loadSourcesAndAllowlist(), onRefreshAllRef.current()]);
      onQuarantineChanged?.();
    } catch (err) {
      setSourceFeedback({ text: `Failed removing rule: ${String(err)}`, tone: 'err' });
    }
  };

  const handleSyncAccessEmailsNow = async () => {
    setIsSyncingQuarantine(true);
    try {
      const res = await invoke<CfAccessPolicySyncResultDto>('sync_cloudflare_access_emails_now');
      setLocalQuarantinedEmails(Array.isArray(res?.quarantinedEmails) ? res.quarantinedEmails : []);
      setSyncedAttachedPolicies(Array.isArray(res?.attachedPolicies) ? res.attachedPolicies : []);
      setSyncPermissionHint(res?.permissionHint ?? null);
      setSourceFeedback({
        text: res?.syncOk
          ? `Synced ${res.attachedPolicies.length} wsh.panoramadr.com policy(ies): ${res.pendingCount} pending quarantine, ${res.newlyQuarantinedCount} newly quarantined, ${res.autoRevokedCount} auto-revoked.`
          : res?.permissionHint || 'Cloudflare Access policy sync degraded; preserved prior state safely.',
        tone: res?.syncOk ? 'ok' : 'err',
      });
      setTimeout(() => setSourceFeedback(null), 5000);
      await Promise.all([loadSourcesAndAllowlist(), onRefreshAllRef.current()]);
      onQuarantineChanged?.();
    } catch (err) {
      setSourceFeedback({ text: `Cloudflare Access sync failed: ${String(err)}`, tone: 'err' });
    } finally {
      setIsSyncingQuarantine(false);
    }
  };

  const handleApproveQuarantinedEmail = async (email: string, defaultLabel?: string) => {
    try {
      await invoke<QuarantinedAccessEmailRow>('approve_quarantined_access_email', {
        email,
        label: defaultLabel || 'Approved Cloudflare wsh Access Email',
      });
      setSourceFeedback({
        text: `Approved ${email} and added to Zero Trust Email Allowlist.`,
        tone: 'ok',
      });
      setTimeout(() => setSourceFeedback(null), 4000);
      await Promise.all([loadSourcesAndAllowlist(), loadActors(), onRefreshAllRef.current()]);
      onQuarantineChanged?.();
    } catch (err) {
      setSourceFeedback({ text: `Failed approving ${email}: ${String(err)}`, tone: 'err' });
    }
  };

  const handleRejectQuarantinedEmail = async (email: string) => {
    try {
      await invoke<QuarantinedAccessEmailRow>('reject_quarantined_access_email', {
        email,
        note: 'Rejected by operator in Zero Trust Quarantine',
      });
      setSourceFeedback({
        text: `Rejected ${email}. Future wsh.panoramadr.com Access logins by this email will trigger HIGH alerts.`,
        tone: 'ok',
      });
      setTimeout(() => setSourceFeedback(null), 5000);
      await Promise.all([loadSourcesAndAllowlist(), loadActors(), onRefreshAllRef.current()]);
      onQuarantineChanged?.();
    } catch (err) {
      setSourceFeedback({ text: `Failed rejecting ${email}: ${String(err)}`, tone: 'err' });
    }
  };

  const handleSaveWafOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualWafName.trim() || !manualWafExpr.trim()) return;
    setIsSavingWafOverride(true);
    try {
      const updated = await invoke<CloudflareWafSnapshotDto>('upsert_waf_rule_override', {
        zoneName: manualWafZone,
        ruleName: manualWafName.trim(),
        action: manualWafAction,
        expression: manualWafExpr.trim(),
        enabled: true,
      });
      setWafSnapshot(updated);
      const autoResolved = updated?.rules ? await autoResolveWafCoveredFindings(updated.rules) : 0;
      setManualWafName('');
      setManualWafExpr('');
      setShowManualWafForm(false);
      setWafFeedback({
        text: `Tracked local WAF rule on ${manualWafZone}.${
          autoResolved > 0 ? ` Auto-resolved ${autoResolved} covered finding(s).` : " Matching items now display 'WAF Covered'."
        }`,
        tone: 'ok',
      });
      setTimeout(() => setWafFeedback(null), 4500);
      await onRefreshAllRef.current();
    } catch (err) {
      setWafFeedback({ text: `Failed saving WAF override: ${String(err)}`, tone: 'err' });
    } finally {
      setIsSavingWafOverride(false);
    }
  };

  const handleDeleteWafOverride = async (id: string) => {
    try {
      const updated = await invoke<CloudflareWafSnapshotDto>('delete_waf_rule_override', { id });
      setWafSnapshot(updated);
      await onRefreshAllRef.current();
    } catch (err) {
      setWafFeedback({ text: `Failed removing WAF override: ${String(err)}`, tone: 'err' });
    }
  };

  const handlePrefillMarkCovered = (zoneName: string, ruleName: string, expr: string) => {
    const cleanZone = normalizeHostname(zoneName).includes('parakith') ? 'parakith.com' : 'panoramadr.com';
    setManualWafZone(cleanZone);
    setManualWafName(ruleName);
    setManualWafExpr(expr);
    setShowManualWafForm(true);
    document.getElementById('cf-waf-rules-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const windowHrsNum = Number.parseInt(lookbackHours, 10) || 6;
  const dailyCarbonCap = settings?.preferences.dailyCarbonCap ?? 6;
  const carbonUsed24h = settings?.carbonUsedLast24h ?? 0;
  const cfAccountId = settings?.cfAccountId || '';
  const unifiBaseUrl = settings?.preferences.unifiBaseUrl || 'https://ui.panoramadr.com';
  const activeStepIdx = stageToStepIndex(auditProgress?.stage);

  const deepLinkZoneForAction = (surface: string): string => {
    const s = surface.toUpperCase();
    if (s.includes('PARAKITH')) return 'parakith.com';
    return panoramaZone?.name || 'panoramadr.com';
  };

  const scrollToSecurityStream = () => {
    const latestSecurityTab =
      [...terminalTabs].reverse().find((t) => t.pageScope === 'security' || t.id.startsWith('security-') || t.id.startsWith('audit-')) ??
      terminalTabs[terminalTabs.length - 1];
    onOpenInBottomConsole?.(latestSecurityTab?.id);
  };

  const renderFindingRow = (f: ThreatFindingRow) => {
    const rayIds = safeParseJson<string[]>(f.rayIdsJson, []);
    const isExt = classifyFindingSurface(f.sourceLayer) === 'external';
    const wafExpr = isExt
      ? buildWafRuleExpression(
          f.actorIp ? [f.actorIp] : [],
          f.actorAsn ? [f.actorAsn] : []
        )
      : '';
    const copyWafKey = `find-waf-${f.id}`;
    const zoneForLink = f.host?.includes('parakith') ? 'parakith.com' : 'panoramadr.com';
    const findWafCov = isExt ? evaluateFindingWafCoverage(f, wafRules) : null;
    const isCovered = findWafCov?.status === 'COVERED';
    const isPartial = findWafCov?.status === 'PARTIAL';
    const findingDisp = getFindingDisposition(f);
    const isFindingSnoozed = findingDisp === 'SNOOZED';
    const findingSnoozeRem = isFindingSnoozed ? formatSnoozeRemaining(f.snoozedUntil) : null;

    const auditEvidence =
      f.ruleId.startsWith('CONTROL_PLANE') || f.ruleId === 'ORIGIN_BREACH_THROUGH'
        ? safeParseJson<{
            actorEmail?: string;
            actor_email?: string;
            matchedAccessEmails?: string[];
          }>(f.evidenceJson, {})
        : null;
    const adminEmail = (
      auditEvidence?.actorEmail ||
      auditEvidence?.actor_email ||
      auditEvidence?.matchedAccessEmails?.[0] ||
      ''
    ).trim();
    const isAdminAlreadyAllowlisted = Boolean(
      adminEmail &&
        allowlist.some(
          (r) => r.entryType === 'EMAIL' && r.value.trim().toLowerCase() === adminEmail.toLowerCase()
        )
    );

    const rogueEvidence =
      f.ruleId === 'UNIFI_ROGUE_LAN_CLIENT'
        ? safeParseJson<{ macAddress?: string; name?: string | null; hostname?: string | null }>(
            f.evidenceJson,
            {}
          )
        : null;
    const rogueMac = (rogueEvidence?.macAddress || '').trim().toUpperCase();
    const matchedLanClient = rogueMac
      ? lanClients.find((c) => c.macAddress.trim().toUpperCase() === rogueMac) ?? null
      : null;
    const isRogueAlreadyTrusted = matchedLanClient?.isTrusted ?? false;

    const handleQuickTrustRogueDevice = async () => {
      if (!rogueMac) return;
      try {
        await invoke('set_lan_client_trusted', {
          macAddress: rogueMac,
          trusted: true,
          label:
            matchedLanClient?.label ||
            matchedLanClient?.hostname ||
            rogueEvidence?.hostname ||
            rogueEvidence?.name ||
            null,
        });
        setSourceFeedback({
          text: `Marked ${rogueMac} as owner-verified trusted LAN hardware.`,
          tone: 'ok',
        });
        setTimeout(() => setSourceFeedback(null), 4000);
        await Promise.all([loadSourcesAndAllowlist(), onRefreshAllRef.current()]);
      } catch (err) {
        setSourceFeedback({ text: `Failed trusting LAN MAC ${rogueMac}: ${String(err)}`, tone: 'err' });
      }
    };

    const findingDomId = `threat-finding-${f.id}`;
    const isFocusedFinding = focusedItemId === findingDomId;

    return (
      <div
        key={f.id}
        id={findingDomId}
        className={`p-4 rounded-xl border space-y-2 transition-shadow ${
          isFocusedFinding
            ? 'bg-rose-50/40 dark:bg-rose-950/20 border-rose-500 ring-2 ring-rose-500 shadow-md'
            : findingDisp !== 'ACTIVE'
            ? 'bg-slate-50 dark:bg-slate-950 border-slate-200/70 dark:border-slate-800/70 opacity-85'
            : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={f.severity} variant={severityToBadgeVariant(f.severity)} />
            <StatusBadge label={f.sourceLayer} variant="neutral" />
            <StatusBadge
              label={isExt ? 'External Perimeter' : 'Internal LAN / WSH'}
              variant={isExt ? 'info' : 'accent'}
            />
            {findingDisp === 'RESOLVED' && <StatusBadge label="Resolved" variant="success" />}
            {findingDisp === 'DISMISSED' && <StatusBadge label="Dismissed" variant="neutral" />}
            {isFindingSnoozed && (
              <span title={f.snoozedUntil ? `Snoozed until ${formatLocalDateTime(f.snoozedUntil)}` : undefined}>
                <StatusBadge
                  label={`Snoozed${findingSnoozeRem ? ` · ${findingSnoozeRem}` : ''}`}
                  variant="info"
                />
              </span>
            )}
            {isCovered && findWafCov?.primaryRuleName && (
              <StatusBadge label={`WAF Covered: ${findWafCov.primaryRuleName}`} variant="success" />
            )}
            {isPartial && findWafCov?.primaryRuleName && (
              <StatusBadge label={`Partial WAF: ${findWafCov.primaryRuleName}`} variant="warning" />
            )}
            <span className="text-[11px] font-mono text-slate-500">{f.ruleId}</span>
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {f.title}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {findingDisp === 'ACTIVE' && wafExpr && !isCovered && (
              <button
                type="button"
                onClick={() => void handleCopyText(copyWafKey, wafExpr)}
                className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                {copiedKey === copyWafKey ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
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
            {findingDisp === 'ACTIVE' && isExt && f.actorIp && (
              <button
                type="button"
                onClick={() =>
                  void handleAllowlistFindingTarget(
                    'IP',
                    f.actorIp || '',
                    `${f.ruleId} (${f.host || 'Perimeter'})`
                  )
                }
                className="btn-tonal text-xs whitespace-nowrap flex-shrink-0"
                title="Add IP to local allowlist and resolve matching findings"
              >
                Allowlist IP
              </button>
            )}
            {findingDisp === 'ACTIVE' &&
              adminEmail &&
              !isAdminAlreadyAllowlisted &&
              (f.ruleId === 'CONTROL_PLANE_MUTATION' || f.ruleId === 'ORIGIN_BREACH_THROUGH') && (
                <button
                  type="button"
                  onClick={() =>
                    void handleAllowlistFindingTarget(
                      'EMAIL',
                      adminEmail,
                      f.ruleId === 'ORIGIN_BREACH_THROUGH'
                        ? 'Trusted Family / Zero Trust Email'
                        : 'Trusted Cloudflare Admin'
                    )
                  }
                  className="btn-primary text-xs whitespace-nowrap flex-shrink-0"
                  title={`Trust Zero Trust email ${adminEmail} in PanoramaSRE allowlist (correlates rotating cellular IPs)`}
                >
                  Trust Email ({adminEmail})
                </button>
              )}
            {f.sourceLayer === 'UNIFI' && (
              <>
                {f.ruleId === 'UNIFI_ROGUE_LAN_CLIENT' && rogueMac && (
                  <>
                    {isRogueAlreadyTrusted ? (
                      <StatusBadge label="Device Trusted" variant="success" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleQuickTrustRogueDevice()}
                        className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                        title={`Mark MAC ${rogueMac} as owner-verified hardware in PanoramaSRE (read-only local inventory)`}
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Trust Device</span>
                      </button>
                    )}
                    {onNavigateToUnifiZbf && (
                      <button
                        type="button"
                        onClick={() => onNavigateToUnifiZbf('baseline', rogueMac)}
                        className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                        title={`Inspect ${rogueMac} inside UniFi Network & ZBF → LAN Device Baseline`}
                      >
                        <Waypoints className="w-3.5 h-3.5" />
                        <span>LAN Baseline →</span>
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  onClick={() =>
                    void handleOpenExternal(
                      buildUnifiConsoleUrl(
                        unifiBaseUrl,
                        f.ruleId === 'UNIFI_ROGUE_LAN_CLIENT' ? 'clients' : 'threats'
                      )
                    )
                  }
                  className="btn-ghost text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>{f.ruleId === 'UNIFI_ROGUE_LAN_CLIENT' ? 'UniFi Clients' : 'UniFi Flows'}</span>
                </button>
              </>
            )}
            {findingDisp === 'ACTIVE' ? (
              <>
                <button
                  type="button"
                  onClick={() =>
                    void handleSetFindingDisposition(
                      f.id,
                      'RESOLVED',
                      undefined,
                      'Operator verified & resolved'
                    )
                  }
                  className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Mark Resolved</span>
                </button>
                <SnoozeSplitButton
                  onSnooze={(days) =>
                    void handleSetFindingDisposition(
                      f.id,
                      'SNOOZED',
                      days,
                      `Snoozed for ${days} days`
                    )
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    void handleSetFindingDisposition(f.id, 'DISMISSED', undefined, 'Operator dismissed')
                  }
                  className="btn-ghost text-xs whitespace-nowrap flex-shrink-0"
                >
                  Dismiss
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void handleSetFindingDisposition(f.id, 'ACTIVE')}
                className="btn-secondary text-xs whitespace-nowrap flex-shrink-0"
              >
                Reopen
              </button>
            )}
            {onAskOtto && (
              <button
                type="button"
                onClick={() => {
                  const isInternal = classifyFindingSurface(f.sourceLayer) === 'internal';
                  onAskOtto({
                    kind: 'threat_finding',
                    entityId: f.id,
                    originView: 'security',
                    title: `${f.severity} Finding: ${f.title}`,
                    severity: f.severity,
                    summary: f.summary,
                    metadata: {
                      ruleId: f.ruleId,
                      sourceLayer: f.sourceLayer,
                      host: f.host,
                      actorIp: f.actorIp,
                      actorAsn: f.actorAsn,
                      category: f.category,
                    },
                    starterPrompts: isInternal
                      ? [
                          `Audit inside-perimeter finding "${f.title}" (${f.ruleId}): is this a detection/correlation code defect or false positive, or a genuine anomaly?`,
                          `Check if actor ${f.actorIp || 'involved'} matches our allowlist or roaming family Access sessions.`,
                        ]
                      : [
                          `Evaluate "${f.title}" (${f.ruleId}) against our actual Next.js/SQLite/CF-Pages stack: is this a MATERIAL_THREAT or NOISE_SAFE_DROP?`,
                          `If this finding is a material threat, what is the safest policy-compliant defensive step?`,
                        ],
                  });
                }}
                className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                title="Open Ask Otto with this threat finding pinned as context"
              >
                <OttoIcon className="w-3.5 h-3.5" />
                <span>Ask Otto</span>
              </button>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-700 dark:text-slate-300">
          <CopyableAddressText text={f.summary} />
        </p>

        {f.resolutionNote && findingDisp !== 'ACTIVE' && (
          <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
            Note: {f.resolutionNote}
            {f.resolvedAt ? ` • ${formatLocalDateTime(f.resolvedAt)}` : ''}
          </div>
        )}

        {isPartial && findWafCov && (
          <div className="text-[11px] font-mono text-amber-700 dark:text-amber-400">
            {findWafCov.reason}
            {findWafCov.uncoveredPaths.length > 0 && ` Uncovered: ${findWafCov.uncoveredPaths.slice(0, 4).join(', ')}`}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
          {f.host && <span>Host: {f.host}</span>}
          {f.actorIp && (
            <span>
              IP: <CopyableValue value={f.actorIp} label="actor IP" />
            </span>
          )}
          {(() => {
            const actorEmail =
              extractFindingActorEmail(f) ||
              (f.actorIp ? actorEmailByIp.get(f.actorIp.trim().toLowerCase())?.email : null);
            return actorEmail ? (
              <span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300">
                <Mail className="w-3 h-3 text-amber-500 shrink-0" />
                <span>Email:</span>
                <CopyableValue value={actorEmail} label="actor email" />
              </span>
            ) : null;
          })()}
          {f.actorAsn && <span>ASN: {f.actorAsn}</span>}
          {rayIds.length > 0 && <span>Rays: {rayIds.slice(0, 4).join(', ')}</span>}
        </div>
      </div>
    );
  };

  const renderActionRow = (
    act: GeminiActionDto,
    idx: number,
    prefix: string,
    wafCoverage?: WafActionEvaluation | null,
    hiddenState?: { disposition: RecommendedActionDisposition; key: string }
  ) => {
    const copyKey = `${prefix}-waf-${idx}`;
    const surfaceDomain = classifyActionSurface(act.surface);
    const isUnifi = surfaceDomain === 'internal';
    const isZt = act.surface.toUpperCase().includes('ZERO_TRUST');
    const isCrossover = surfaceDomain === 'crossover';
    const isPartialWaf = wafCoverage?.status === 'PARTIAL';
    const isUncoveredWafAdd = Boolean(wafCoverage?.isWafAddAction && wafCoverage.status === 'UNCOVERED' && act.wafRuleSnippet);
    const deepUrl = isUnifi
      ? buildUnifiConsoleUrl(unifiBaseUrl, 'policies')
      : isZt
      ? buildCloudflareZeroTrustLogsUrl(cfAccountId)
      : buildCloudflareSecurityEventsUrl(cfAccountId, deepLinkZoneForAction(act.surface));

    const surfaceBadgeLabel =
      surfaceDomain === 'external'
        ? 'External (Cloudflare)'
        : surfaceDomain === 'internal'
        ? 'Internal (UniFi / WSH)'
        : 'Cross-Surface (Allowlist)';

    return (
      <div
        key={`${prefix}-${act.action}-${idx}`}
        className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              label={act.priority}
              variant={act.priority === 'IMMEDIATE' ? 'danger' : act.priority === 'SOON' ? 'warning' : 'info'}
            />
            <StatusBadge
              label={surfaceBadgeLabel}
              variant={
                surfaceDomain === 'external'
                  ? 'info'
                  : surfaceDomain === 'internal'
                  ? 'accent'
                  : 'neutral'
              }
            />
            {isPartialWaf && wafCoverage?.primaryRuleName && (
              <StatusBadge label={`Tighten Rule: ${wafCoverage.primaryRuleName}`} variant="warning" />
            )}
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {act.action}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hiddenState ? (
              <>
                <StatusBadge
                  label={
                    hiddenState.disposition.status === 'DISMISSED'
                      ? 'Permanently Dismissed'
                      : `Snoozed${
                          formatSnoozeRemaining(hiddenState.disposition.snoozedUntil)
                            ? ` · ${formatSnoozeRemaining(hiddenState.disposition.snoozedUntil)}`
                            : ''
                        }`
                  }
                  variant={hiddenState.disposition.status === 'DISMISSED' ? 'neutral' : 'info'}
                />
                <button
                  type="button"
                  onClick={() => handleRestoreRecommendedAction(hiddenState.key)}
                  className="btn-secondary text-xs whitespace-nowrap flex-shrink-0"
                >
                  Restore
                </button>
              </>
            ) : (
              <>
                {act.wafRuleSnippet && (
                  <button
                    type="button"
                    onClick={() => void handleCopyText(copyKey, act.wafRuleSnippet || '')}
                    className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                  >
                    {copiedKey === copyKey ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {copiedKey === copyKey
                        ? 'Copied!'
                        : isPartialWaf
                        ? 'Copy Tightened Snippet'
                        : 'Copy WAF Rule'}
                    </span>
                  </button>
                )}
                {isUncoveredWafAdd && act.wafRuleSnippet && (
                  <button
                    type="button"
                    onClick={() =>
                      handlePrefillMarkCovered(
                        deepLinkZoneForAction(`${act.action} ${act.wafRuleSnippet || ''}`),
                        act.action.slice(0, 64),
                        act.wafRuleSnippet || ''
                      )
                    }
                    className="btn-ghost text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                    title="Track this rule as already deployed in Cloudflare"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Mark Covered</span>
                  </button>
                )}
                {isCrossover ? (
                  <button
                    type="button"
                    onClick={() => setSubView('allowlist')}
                    className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>Open Allowlist &amp; Controls</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleOpenExternal(deepUrl)}
                    className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>
                      {isUnifi
                        ? 'Open UniFi Console'
                        : isZt
                        ? 'Open Zero Trust Logs'
                        : 'Open Cloudflare Events'}
                    </span>
                  </button>
                )}
                <SnoozeSplitButton
                  targetLabel="this recommended action"
                  onSnooze={(days) => handleSnoozeRecommendedAction(act, days)}
                />
                <button
                  type="button"
                  onClick={() => handleDismissRecommendedAction(act)}
                  className="btn-ghost text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                  title="Permanently dismiss this recommended action so it will not reappear in future runs"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Dismiss</span>
                </button>
              </>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-400">{act.rationale}</p>

        {isPartialWaf && wafCoverage && (
          <div className="text-[11px] font-mono text-amber-700 dark:text-amber-400">
            {wafCoverage.reason}
            {wafCoverage.uncoveredPaths.length > 0 && ` Uncovered paths: ${wafCoverage.uncoveredPaths.slice(0, 5).join(', ')}`}
          </div>
        )}

        {act.wafRuleSnippet && (
          <pre className="overflow-x-auto px-3 py-2 rounded-lg bg-white dark:bg-[#050b14] border border-slate-200/90 dark:border-slate-800 text-emerald-900 dark:text-emerald-400 font-mono text-xs">
            {act.wafRuleSnippet}
          </pre>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6 w-full min-w-0 max-w-[1920px] mx-auto">
      {/* Top 360° Command Header Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col 2xl:flex-row 2xl:items-center 2xl:justify-between gap-4">
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)] border border-[var(--color-brand-ring)] flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                360° Threat &amp; Zero Trust SOC
              </h1>
              {activeRun ? (
                <>
                  <StatusBadge
                    label={`Posture: ${activeRun.overallSeverity}`}
                    variant={severityToBadgeVariant(activeRun.overallSeverity)}
                    pulse={
                      actionableSummary.totalActionable > 0 &&
                      (activeRun.overallSeverity === 'HIGH' ||
                        activeRun.overallSeverity === 'CRITICAL')
                    }
                  />
                  <StatusBadge
                    label={
                      actionableSummary.totalActionable > 0
                        ? `Action Required: ${actionableSummary.totalActionable}`
                        : '0 Actionable Threats'
                    }
                    variant={actionableSummary.totalActionable > 0 ? 'danger' : 'success'}
                  />
                  <StatusBadge
                    label={activeRun.intrusionVerdict.replace(/_/g, ' ')}
                    variant={verdictToBadgeVariant(activeRun.intrusionVerdict)}
                  />
                  {activeRun.escalatedToTier2 && (
                    <StatusBadge
                      label={`Tier 2: ${activeRun.tier2Model || 'gemini-4-neon'}`}
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
                Deep Escalations (24h): {carbonUsed24h} / {dailyCarbonCap === 0 ? '∞' : dailyCarbonCap}
              </span>
            </div>
          </div>

          {/* Primary Actions Bar */}
          <div className="flex flex-wrap items-center gap-2 min-w-0">
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
              <span>{isRunningAudit ? `Auditing (${auditElapsedSec}s)...` : 'Run Audit Now'}</span>
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
              title={`Run full 72h forensic fetch and escalate directly to Gemini 4 ${tier2ModelShortLabel(settings?.preferences.tier2Model)} (bypasses daily auto cap)`}
            >
              <BrainCircuit className="w-3.5 h-3.5" />
              <span>Deep Investigate ({tier2ModelShortLabel(settings?.preferences.tier2Model)})</span>
            </button>

            <button
              type="button"
              onClick={onNavigateToSettings}
              className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              title="Configure & test Cloudflare, Gemini 4, UniFi, and WSH connections"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Settings</span>
            </button>
          </div>
        </div>

        {/* Prominent Last Audit Run Strip */}
        {activeRun && (() => {
          const runDur = formatRunDuration(activeRun.startedAt, activeRun.completedAt);
          const triggerLabel =
            activeRun.triggerSource.charAt(0).toUpperCase() +
            activeRun.triggerSource.slice(1).toLowerCase();
          return (
            <div className="rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 tabular-nums">
              <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4 text-[var(--color-brand-text)]" />
                </div>
                <div className="space-y-0.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Last Run:
                    </span>
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {formatRelativeTime(activeRun.completedAt || activeRun.startedAt)}
                    </span>
                    <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                      {formatLocalDateTime(activeRun.completedAt || activeRun.startedAt)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                    <StatusBadge
                      label={activeRun.status}
                      variant={
                        activeRun.status === 'COMPLETED'
                          ? 'success'
                          : activeRun.status === 'DEGRADED'
                          ? 'warning'
                          : 'danger'
                      }
                    />
                    <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      {triggerLabel}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      {activeRun.windowHours}h lookback
                    </span>
                    {runDur && (
                      <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                        Duration: {runDur}
                      </span>
                    )}
                    {activeRun.escalatedToTier2 && (
                      <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[var(--color-accent-text)]">
                        Tier 2: {activeRun.tier2Model || 'gemini-4-neon'}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {runs.length > 0 && (
                <div className="w-full lg:w-80 shrink-0">
                  <CustomSelect
                    value={activeRun.id}
                    onChange={(runId) => {
                      if (runId) void onSelectRunId(runId);
                    }}
                    options={runs.map((r) => ({
                      value: r.id,
                      label: `${formatLocalDateTime(r.completedAt || r.startedAt)} • ${r.overallSeverity}${r.escalatedToTier2 ? ` (${tier2ModelShortLabel(r.tier2Model)})` : ''}`,
                      description: `${r.triggerSource} (${r.windowHours}h) • ${r.status} — ${r.intrusionVerdict}`,
                    }))}
                  />
                </div>
              )}
            </div>
          );
        })()}

        {/* Live Audit Progress Feedback Banner */}
        {isRunningAudit && (
          <div className="rounded-xl border border-[var(--color-brand-ring)] bg-slate-50 dark:bg-slate-950 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                <RefreshCw className="w-4 h-4 animate-spin text-[var(--color-brand-text)] shrink-0" />
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {auditProgress?.label || 'Running 360° Security Audit'}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 tabular-nums">
                  Elapsed: {auditElapsedSec}s
                </span>
              </div>

              <button
                type="button"
                onClick={scrollToSecurityStream}
                className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Watch Raw Stream ▴</span>
              </button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {AUDIT_PIPELINE_STEPS.map((step, idx) => {
                const isDone = idx < activeStepIdx;
                const isCurrent = idx === activeStepIdx;
                return (
                  <div
                    key={step.key}
                    className={`px-3 py-1.5 rounded-lg border text-[11px] font-mono flex items-center justify-between gap-1.5 ${
                      isDone
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                        : isCurrent
                        ? 'bg-white dark:bg-slate-900 border-[var(--color-brand)] text-slate-900 dark:text-slate-100 font-semibold'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500'
                    }`}
                  >
                    <span className="truncate">{step.label}</span>
                    {isDone && <Check className="w-3 h-3 shrink-0" />}
                    {isCurrent && <RefreshCw className="w-3 h-3 animate-spin shrink-0" />}
                  </div>
                );
              })}
            </div>

            <div className="text-xs font-mono text-slate-700 dark:text-slate-300 break-words">
              {auditProgress?.message ||
                'Collecting Cloudflare Perimeter, UniFi CloudKey, and WSH SSH telemetry...'}
            </div>
          </div>
        )}

        {/* Degraded / Missing Keys Notice */}
        {activeRun?.errorMessage && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-300">
            <div className="flex items-start gap-2.5 min-w-0">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-0.5 min-w-0">
                <div className="font-semibold">
                  {actionableSummary.isAiOnlyDegraded
                    ? 'Stage 2 AI Timed Out — Deterministic Stage 0 & Collectors Intact (No Red Alert Raised)'
                    : `Degraded Mode (${activeRun.status}) — Deterministic Stage 0 Findings Preserved`}
                </div>
                <div className="font-mono text-[11px] break-words">{activeRun.errorMessage}</div>
              </div>
            </div>
            {actionableSummary.isAiOnlyDegraded && (
              <button
                type="button"
                onClick={() => void onEscalateRunToCarbon(activeRun.id)}
                disabled={isRunningAudit}
                className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRunningAudit ? 'animate-spin' : ''}`} />
                <span>Retry {tier2ModelShortLabel(settings?.preferences.tier2Model)}</span>
              </button>
            )}
          </div>
        )}

        {(!settings?.cfConfigured || !settings?.geminiConfigured) && !activeRun && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <Lock className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
              <span>
                Verify your Cloudflare, Gemini 4, UniFi, and WSH connections in Settings to begin autonomous 6-hour 360° audits.
              </span>
            </div>
            <button
              type="button"
              onClick={onNavigateToSettings}
              className="btn-tonal text-xs whitespace-nowrap flex-shrink-0"
            >
              Open Settings &amp; Test Connections
            </button>
          </div>
        )}

        {/* High / Critical Active Threat Spotlight — Pinned Above the Fold Across All Sub-Views */}
        {actionableSummary.totalActionable > 0 && (
          <div
            data-testid="threat-action-required-spotlight"
            className="bg-white dark:bg-slate-900 border-2 border-rose-500/60 rounded-2xl p-4 sm:p-5 shadow-md space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  Action Required ({actionableSummary.totalActionable} Active Critical/High Issue
                  {actionableSummary.totalActionable === 1 ? '' : 's'})
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {actionableSummary.externalCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setSubView('external')}
                    className="btn-tonal text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                  >
                    <span>External Perimeter ({actionableSummary.externalCount})</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
                {actionableSummary.internalCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setSubView('internal')}
                    className="btn-tonal text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                  >
                    <span>Internal Events ({actionableSummary.internalCount})</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2 text-xs">
              {actionableSummary.collectorOutages.map((o) => (
                <div
                  key={o.collector}
                  className="px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-rose-500/40 flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2">
                    <StatusBadge label="OUTAGE" variant="danger" />
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{o.label}</span>
                  </div>
                  <span className="font-mono text-rose-600 dark:text-rose-400">{o.status}</span>
                </div>
              ))}

              {actionableSummary.actionableFindings.map((f) => {
                const isExt = classifyFindingSurface(f.sourceLayer) === 'external';
                const targetDomId = `threat-finding-${f.id}`;
                const spotlightMatchedEmail =
                  f.ruleId === 'ORIGIN_BREACH_THROUGH'
                    ? safeParseJson<{ matchedAccessEmails?: string[] }>(f.evidenceJson, {})
                        .matchedAccessEmails?.[0]?.trim() || ''
                    : '';
                const isSpotlightEmailTrusted = Boolean(
                  spotlightMatchedEmail &&
                    allowlist.some(
                      (r) =>
                        r.entryType === 'EMAIL' &&
                        r.value.trim().toLowerCase() === spotlightMatchedEmail.toLowerCase()
                    )
                );
                return (
                  <div
                    key={`spotlight-find-${f.id}`}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-rose-500/35 space-y-2"
                  >
                    <div className="flex flex-col gap-2 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <StatusBadge label={f.severity} variant={severityToBadgeVariant(f.severity)} />
                        <StatusBadge label={f.sourceLayer} variant="neutral" />
                        <span className="text-[11px] font-mono text-slate-500">{f.ruleId}</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {f.title}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 w-full min-w-0">
                        {spotlightMatchedEmail && !isSpotlightEmailTrusted && (
                          <button
                            type="button"
                            onClick={() =>
                              void handleAllowlistFindingTarget(
                                'EMAIL',
                                spotlightMatchedEmail,
                                'Trusted Family / Zero Trust Email'
                              )
                            }
                            className="btn-tonal text-xs whitespace-nowrap flex-shrink-0"
                            title={`Trust Zero Trust email ${spotlightMatchedEmail} across rotating mobile IPs`}
                          >
                            Trust Email ({spotlightMatchedEmail})
                          </button>
                        )}
                        {isExt && f.actorIp && (
                          <button
                            type="button"
                            onClick={() =>
                              void handleAllowlistFindingTarget(
                                'IP',
                                f.actorIp || '',
                                `${f.ruleId} (${f.host || 'Perimeter'})`
                              )
                            }
                            className="btn-tonal text-xs whitespace-nowrap flex-shrink-0"
                            title="Add static IP to local allowlist (for mobile cellular IPs, prefer Trust Email in Allowlist)"
                          >
                            Allowlist IP
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            void handleSetFindingDisposition(
                              f.id,
                              'RESOLVED',
                              undefined,
                              'Operator verified & resolved'
                            )
                          }
                          className="btn-secondary text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          <span>Mark Resolved</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            jumpToThreatTarget(isExt ? 'external' : 'internal', targetDomId, {
                              clearFindings: true,
                            })
                          }
                          className="btn-primary text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                        >
                          <span>Jump to Details</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                        {onAskOtto && (
                          <button
                            type="button"
                            onClick={() =>
                              onAskOtto({
                                kind: 'threat_finding',
                                entityId: f.id,
                                originView: 'security',
                                title: `${f.severity} Spotlight: ${f.title}`,
                                severity: f.severity,
                                summary: f.summary,
                                metadata: {
                                  ruleId: f.ruleId,
                                  sourceLayer: f.sourceLayer,
                                  host: f.host,
                                  actorIp: f.actorIp,
                                },
                                starterPrompts: [
                                  `Audit spotlight finding "${f.title}" (${f.ruleId}): is it a detection defect / false positive, safe-to-drop noise, or a material threat?`,
                                  `Recommend the safest next step for "${f.title}" under PanoramaSRE policy guardrails.`,
                                ],
                              })
                            }
                            className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                          >
                            <OttoIcon className="w-3.5 h-3.5" />
                            <span>Ask Otto</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-slate-700 dark:text-slate-300">
                      <CopyableAddressText text={f.summary} />
                    </p>

                    {(f.host || f.actorIp || f.actorAsn || spotlightMatchedEmail) && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                        {f.host && <span>Host: {f.host}</span>}
                        {f.actorIp && (
                          <span>
                            IP: <CopyableValue value={f.actorIp} label="threat actor IP" />
                          </span>
                        )}
                        {(() => {
                          const resolvedEmail =
                            extractFindingActorEmail(f) ||
                            (f.actorIp
                              ? actorEmailByIp.get(f.actorIp.trim().toLowerCase())?.email
                              : null);
                          return resolvedEmail ? (
                            <span className="inline-flex items-center gap-1 text-slate-800 dark:text-slate-200 font-semibold">
                              <Mail className="w-3 h-3 text-amber-500 shrink-0" />
                              <span>Email:</span>
                              <CopyableValue value={resolvedEmail} label="actor email" />
                            </span>
                          ) : null;
                        })()}
                        {f.actorAsn && <span>ASN: {f.actorAsn}</span>}
                      </div>
                    )}
                  </div>
                );
              })}

              {actionableSummary.deduplicatedActionableActors.map((a) => {
                const actorDomId = `threat-actor-${a.id}`;
                return (
                  <div
                    key={`spotlight-actor-${a.id}`}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-rose-500/35 flex flex-col lg:flex-row lg:items-center justify-between gap-2"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <StatusBadge
                          label={a.highestSeverity}
                          variant={severityToBadgeVariant(a.highestSeverity)}
                        />
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {a.ipAddress ? (
                            <CopyableValue value={a.ipAddress} label="actor IP" />
                          ) : (
                            a.id
                          )}
                        </span>
                        {a.totalOrigin200s > 0 && (
                          <StatusBadge label={`${a.totalOrigin200s} Origin 200s`} variant="danger" />
                        )}
                        {a.latestClassification && (
                          <StatusBadge label={a.latestClassification} variant="accent" />
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                        {(() => {
                          const info = a.ipAddress
                            ? actorEmailByIp.get(a.ipAddress.trim().toLowerCase())
                            : undefined;
                          return info ? (
                            <span className="inline-flex items-center gap-1 text-slate-800 dark:text-slate-200 font-semibold">
                              <Mail className="w-3 h-3 text-amber-500 shrink-0" />
                              <CopyableValue value={info.email} label="actor email" />
                            </span>
                          ) : null;
                        })()}
                        {(a.asn || a.asOrg) && (
                          <span>
                            {a.asn ? `AS${a.asn.replace(/^AS/i, '')}` : ''} {a.asOrg || ''}
                          </span>
                        )}
                        <span>{a.totalRequests} requests</span>
                        {a.country && <span>{a.country}</span>}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {a.disposition !== 'ALLOWLISTED' && (
                        <button
                          type="button"
                          onClick={() => void handleAllowlistActor(a)}
                          className="btn-tonal text-xs whitespace-nowrap flex-shrink-0"
                        >
                          Allowlist IP
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          jumpToThreatTarget('external', actorDomId, { clearActors: true })
                        }
                        className="btn-primary text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                      >
                        <span>Jump to Actor</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      {onAskOtto && (
                        <button
                          type="button"
                          onClick={() =>
                            onAskOtto({
                              kind: 'threat_actor',
                              entityId: a.id,
                              originView: 'security',
                              title: `Threat Actor ${a.ipAddress || a.id} (${a.highestSeverity})`,
                              severity: a.highestSeverity,
                              summary: `${a.totalRequests} requests, ${a.totalOrigin200s} origin 200s (${a.asOrg || a.asn || 'unknown ASN'}, ${a.country || 'unknown country'})`,
                              metadata: {
                                ip: a.ipAddress,
                                asn: a.asn,
                                asOrg: a.asOrg,
                                country: a.country,
                                origin200s: a.totalOrigin200s,
                                requests: a.totalRequests,
                              },
                              starterPrompts: [
                                `Is actor ${a.ipAddress || a.id} a MATERIAL_THREAT against our Next.js/SQLite/CF-Pages stack or NOISE_SAFE_DROP?`,
                                `Check whether ${a.ipAddress || a.id} could be a roaming family user or protected IP before proposing any Cloudflare action.`,
                              ],
                            })
                          }
                          className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                        >
                          <OttoIcon className="w-3.5 h-3.5" />
                          <span>Ask Otto</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Above-the-Fold Amber Quarantine Spotlight — Visible Across All Sub-Views Until Reviewed */}
        {pendingQuarantined.length > 0 && (
          <div
            data-testid="threat-quarantine-spotlight"
            className="bg-white dark:bg-slate-900 border-2 border-amber-500/60 rounded-2xl p-4 sm:p-5 shadow-md space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  Quarantined Zero Trust Access Emails Pending Approval ({pendingQuarantined.length})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSubView('allowlist')}
                className="btn-tonal text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
              >
                <span>Open Quarantine Queue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              {pendingQuarantined.map((q) => {
                const grants = parsePolicyGrants(q.policyGrantsJson);
                const firstPolicyName = grants[0]?.policyName;
                return (
                  <div
                    key={`spotlight-quar-${q.email}`}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-amber-500/40 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5"
                  >
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge label="PENDING QUARANTINE" variant="warning" />
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          <CopyableValue value={q.email} label="quarantined email" />
                        </span>
                        <span className="text-[11px] font-mono text-slate-500">
                          First seen {formatLocalDateTime(q.firstSeenAt)}
                        </span>
                      </div>
                      <PolicyGrantProvenanceChips grants={grants} />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          void handleApproveQuarantinedEmail(
                            q.email,
                            firstPolicyName ? `${firstPolicyName} (wsh Access)` : undefined
                          )
                        }
                        className="btn-primary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve &amp; Allow</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRejectQuarantinedEmail(q.email)}
                        className="btn-danger text-xs whitespace-nowrap flex-shrink-0"
                      >
                        Reject
                      </button>
                      {onAskOtto && (
                        <button
                          type="button"
                          onClick={() =>
                            onAskOtto({
                              kind: 'quarantined_email',
                              entityId: q.email,
                              originView: 'security',
                              title: `Quarantined Zero Trust Email: ${q.email}`,
                              severity: 'MEDIUM',
                              summary: `Discovered in wsh.panoramadr.com Cloudflare Access policies (status: ${q.status}, first seen ${q.firstSeenAt}).`,
                              metadata: { email: q.email, status: q.status, grants },
                              starterPrompts: [
                                `Audit quarantined email ${q.email}: which Cloudflare Access policies granted it access and is there any anomalous login activity?`,
                                `Should ${q.email} be approved into the Zero Trust allowlist or rejected?`,
                              ],
                            })
                          }
                          className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                        >
                          <OttoIcon className="w-3.5 h-3.5" />
                          <span>Ask Otto</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Persistent Single-Row 4-Card Telemetry Context Ribbon (Eliminates Per-Tab Duplication) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 pt-1 tabular-nums">
          {/* Card 1: Cloudflare Edge */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Cloudflare Edge
              </span>
              <StatusBadge label={`WAF ${totalWafHits}`} variant="info" />
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {((panoramaZone?.totalRequests ?? 0) + (parakithZone?.totalRequests ?? 0)).toLocaleString()}{' '}
              <span className="text-xs font-normal text-slate-500">reqs</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-400">
              <span className={totalOrigin200Breaches > 0 ? 'text-rose-600 dark:text-rose-400 font-bold' : ''}>
                Origin 200s: {totalOrigin200Breaches}
              </span>
              <span>•</span>
              <button
                type="button"
                onClick={() => {
                  handleToggleExternalZoneFilter('panoramadr.com');
                  setSubView('external');
                }}
                className={`px-1.5 py-0.5 rounded border cursor-pointer transition-colors ${
                  activeQuickZoneFilter === 'zone:panoramadr.com'
                    ? 'bg-[var(--color-brand-subtle)] border-[var(--color-brand-ring)] text-[var(--color-brand-text)] font-semibold'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-[var(--color-brand)]'
                }`}
                title="Filter External tables to panoramadr.com"
              >
                <Filter className="w-2.5 h-2.5 inline mr-1" />
                panoramadr
              </button>
              <button
                type="button"
                onClick={() => {
                  handleToggleExternalZoneFilter('parakith.com');
                  setSubView('external');
                }}
                className={`px-1.5 py-0.5 rounded border cursor-pointer transition-colors ${
                  activeQuickZoneFilter === 'zone:parakith.com'
                    ? 'bg-[var(--color-brand-subtle)] border-[var(--color-brand-ring)] text-[var(--color-brand-text)] font-semibold'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-[var(--color-brand)]'
                }`}
                title="Filter External tables to parakith.com"
              >
                <Filter className="w-2.5 h-2.5 inline mr-1" />
                parakith
              </button>
            </div>
          </div>

          {/* Card 2: Zero Trust & Tunnel */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Zero Trust &amp; Tunnel
              </span>
              <StatusBadge
                label={`${healthyTunnelsCount}/${zeroTrustSummary.tunnels.length} Tunnels`}
                variant={zeroTrustSummary.accessDenied > 0 ? 'warning' : 'success'}
              />
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {zeroTrustSummary.accessAllowed}
              <span className="text-xs font-normal text-slate-400"> / </span>
              <span className={zeroTrustSummary.accessDenied > 0 ? 'text-amber-600 dark:text-amber-400' : ''}>
                {zeroTrustSummary.accessDenied}
              </span>{' '}
              <span className="text-xs font-normal text-slate-500">allow / deny</span>
            </div>
            <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 truncate">
              {zeroTrustSummary.accessAppCount} Access app(s) • Mutations: {zeroTrustSummary.auditMutations}
            </div>
            {(zeroTrustSummary.verifiedFamilySessions?.length ?? 0) > 0 && (
              <div className="space-y-0.5 pt-0.5">
                <div
                  className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 truncate"
                  title={zeroTrustSummary.verifiedFamilySessions
                    ?.map((s) => `${s.email} (${s.authSource} • ${s.requests} reqs)`)
                    .join('\n')}
                >
                  {zeroTrustSummary.verifiedFamilySessions!.length} Family Session
                  {zeroTrustSummary.verifiedFamilySessions!.length === 1 ? '' : 's'} Verified
                </div>
                <div className="flex flex-wrap gap-1 text-[10px] font-mono text-emerald-800 dark:text-emerald-300">
                  {Array.from(
                    new Set(
                      zeroTrustSummary.verifiedFamilySessions!.map((s) => s.email).filter(Boolean)
                    )
                  ).map((email) => (
                    <span
                      key={`zt-fam-${email}`}
                      className="px-1.5 py-0.2 rounded bg-emerald-500/10 border border-emerald-500/30 truncate max-w-full"
                    >
                      {email}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Card 3: Internal UniFi & WSH */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Internal UniFi &amp; WSH
              </span>
              <StatusBadge
                label={`${trustedLanCount}/${lanClients.length} Trusted`}
                variant={
                  actionableSummary.actionableInternalFindings.some(
                    (f) => f.ruleId === 'UNIFI_ROGUE_LAN_CLIENT'
                  )
                    ? 'danger'
                    : trustedLanCount > 0
                    ? 'success'
                    : 'neutral'
                }
              />
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {internalSummary.unifiSiemCefEvents}{' '}
              <span className="text-xs font-normal text-slate-500">CEF events</span>
            </div>
            <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 truncate">
              Auth: {internalSummary.panoramaAuthAnomalies} • SSH: {internalSummary.sshAnomalyCount} • SIEM:{' '}
              {siemContainer
                ? siemContainer.State?.toLowerCase() === 'running'
                  ? 'Running'
                  : siemContainer.State
                : 'Not Deployed'}
            </div>
          </div>

          {/* Card 4: Clickable WSH Hardening Bridge Tile */}
          <button
            type="button"
            onClick={() => onNavigateToHardening?.()}
            disabled={!onNavigateToHardening}
            className={`text-left p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border space-y-1.5 transition-colors ${
              securityViolationCount > 0
                ? 'border-rose-500/40 hover:border-rose-500'
                : 'border-slate-200 dark:border-slate-800 hover:border-[var(--color-brand)]'
            } ${onNavigateToHardening ? 'cursor-pointer' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-[var(--color-brand-text)]" />
                WSH Hardening
              </span>
              <StatusBadge
                label={
                  hardeningTotalCount > 0
                    ? securityViolationCount > 0
                      ? `${securityViolationCount} VIOLATIONS`
                      : `${hardeningPassingCount}/${hardeningTotalCount} PASS`
                    : 'Standing By'
                }
                variant={
                  hardeningTotalCount > 0
                    ? securityViolationCount > 0
                      ? 'danger'
                      : 'success'
                    : 'neutral'
                }
              />
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
              SEC-01..SEC-09
            </div>
            <div className="text-[11px] font-mono text-[var(--color-brand-text)] truncate">
              {onNavigateToHardening
                ? 'Open WSH Firewall & Container Rules →'
                : 'Container & iptables containment'}
            </div>
          </button>
        </div>

        {onOpenDefensePlans && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-[var(--color-brand-ring)]/60 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <OttoIcon state="IDLE" className="w-4 h-4 shrink-0" />
              <span className="text-slate-700 dark:text-slate-300 truncate">
                <strong className="text-slate-900 dark:text-slate-100">Otto Proactive Defense:</strong>{' '}
                Zero-SSH fast edge sweep, Stage-0 dropped noise ($0 LLM), and Cloudflare WAF TTL leases with 1-Click Revert.
              </span>
            </div>
            <button
              type="button"
              onClick={onOpenDefensePlans}
              className="btn-tonal text-xs py-1 px-2.5 whitespace-nowrap flex-shrink-0"
            >
              Open Defense Plans &amp; Leases →
            </button>
          </div>
        )}

        {/* Domain-Separated Sub-View Switcher */}
        <div className="pt-1 flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl<SubViewTab>
            activeVariant="brand"
            value={subView}
            onChange={setSubView}
            options={[
              { value: 'overview', label: 'Triage & AI Brief' },
              {
                value: 'external',
                label: 'External Perimeter (CF)',
                badge:
                  actionableSummary.externalCount > 0 ? (
                    <span className="tabular-nums font-mono">{actionableSummary.externalCount}</span>
                  ) : undefined,
              },
              {
                value: 'internal',
                label: 'Internal Events (UniFi & WSH)',
                badge:
                  actionableSummary.internalCount > 0 ? (
                    <span className="tabular-nums font-mono">{actionableSummary.internalCount}</span>
                  ) : undefined,
              },
              {
                value: 'allowlist',
                label: 'Allowlist',
                badge:
                  pendingQuarantined.length > 0 ? (
                    <span className="tabular-nums font-mono text-amber-600 dark:text-amber-300 font-bold">
                      {pendingQuarantined.length}Q
                    </span>
                  ) : allowlist.length > 0 ? (
                    <span className="tabular-nums font-mono">{allowlist.length}</span>
                  ) : undefined,
              },
            ]}
          />
        </div>
      </div>

      {/* =================================================================== */}
      {/* SUB-VIEW 1: OVERVIEW & BRIEF                                        */}
      {/* =================================================================== */}
      {subView === 'overview' && (
        <div className="space-y-6">
          {/* Actionable Triage Status Card (All-Clear state when zero actionable issues; Action Required is pinned above the fold) */}
          {actionableSummary.totalActionable === 0 && (
            <div className="bg-white dark:bg-slate-900 border border-emerald-500/40 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    All Clear — Zero Actionable Security Threats or Infrastructure Outages
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                    Edge scanner noise, WAF-covered traffic, and isolated-zone mobile devices are suppressed from alerts ({actionableSummary.backgroundNoiseActors.length} background noise actor(s), {actionableSummary.informationalOrResolvedFindings.length} informational/resolved finding(s)).
                  </p>
                </div>
              </div>
              {actionableSummary.backgroundNoiseActors.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setActorDispositionFilter('NOISE');
                    setSubView('external');
                  }}
                  className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <span>Inspect Noise ({actionableSummary.backgroundNoiseActors.length})</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Authoritative Perimeter <-> Internal Cross-Over Bridge Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-[var(--color-accent-text)] shrink-0" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                  Perimeter ↔ Internal Cross-Over Boundaries
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                <span>External Findings: {externalFindings.length}</span>
                <span>•</span>
                <span>Internal Findings: {internalFindings.length}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                <div className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                  1. Cloudflare Tunnel → WSH Lighttpd
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Edge requests cross <code className="font-mono">panorama-tunnel</code> (<code className="font-mono">cf-egress-net</code>) into WSH <code className="font-mono">:443</code>.
                </p>
                <div className="text-[11px] font-mono tabular-nums pt-0.5">
                  Tunnels: {healthyTunnelsCount}/{zeroTrustSummary.tunnels.length} •{' '}
                  <span className={totalOrigin200Breaches > 0 ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-emerald-700 dark:text-emerald-400'}>
                    Private Origin 200s: {totalOrigin200Breaches}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                <div className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                  2. Zero Trust Access ↔ PanoramaAuth
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Cloudflare Google OIDC Access gates SSO sessions before reaching internal <code className="font-mono">PanoramaAuth</code>.
                </p>
                <div className="text-[11px] font-mono tabular-nums pt-0.5 text-slate-700 dark:text-slate-300">
                  ZT Denied: {zeroTrustSummary.accessDenied} • Auth Anomalies: {internalSummary.panoramaAuthAnomalies}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                <div className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                  3. Edge WAF ↔ UniFi CyberSecure IPS
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Edge WAF filters proxied HTTPS; UniFi Gateway IPS inspects direct WAN/LAN packets to <code className="font-mono">unifi-siem</code>.
                </p>
                <div className="text-[11px] font-mono tabular-nums pt-0.5 text-slate-700 dark:text-slate-300">
                  CF WAF Hits: {totalWafHits} • CEF Alerts: {internalSummary.unifiCefSecurityAlerts}
                </div>
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
                      <div className="flex items-center justify-between gap-2 font-mono font-semibold text-slate-700 dark:text-slate-300">
                        <span>External: Zero Trust &amp; Access</span>
                        <StatusBadge label="Cloudflare" variant="info" />
                      </div>
                      <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                        {geminiBrief.zeroTrustAssessment}
                      </p>
                    </div>
                  )}
                  {geminiBrief.internalNetworkAssessment && (
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                      <div className="flex items-center justify-between gap-2 font-mono font-semibold text-slate-700 dark:text-slate-300">
                        <span>Internal: UniFi LAN &amp; WSH Origin</span>
                        <StatusBadge label="UniFi / WSH" variant="accent" />
                      </div>
                      <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                        {geminiBrief.internalNetworkAssessment}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {(overviewActionsState.visible.length > 0 ||
                overviewActionsState.hidden.length > 0 ||
                overviewActionsState.suppressedCount > 0) && (
                <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider tabular-nums">
                      Recommended Actions by Surface ({overviewActionsState.visible.length})
                    </div>
                    {overviewActionsState.suppressedCount > 0 && (
                      <StatusBadge
                        label={`${overviewActionsState.suppressedCount} covered by WAF`}
                        variant="success"
                      />
                    )}
                  </div>
                  {overviewActionsState.visible.length === 0 ? (
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
                      {overviewActionsState.hidden.length > 0
                        ? 'All remaining recommended actions have been snoozed or permanently dismissed.'
                        : 'All external WAF actions for this run are already mitigated by deployed Cloudflare custom rules.'}
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {overviewActionsState.visible.map((item, idx) =>
                        renderActionRow(item.action, idx, 'ov-act', item.coverage)
                      )}
                    </div>
                  )}
                  {overviewActionsState.hidden.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowHiddenActions((p) => !p)}
                        className="btn-secondary text-xs whitespace-nowrap flex-shrink-0"
                      >
                        {showHiddenActions ? 'Hide' : 'Show'} Snoozed &amp; Permanently Dismissed Actions (
                        {overviewActionsState.hidden.length})
                      </button>
                      {showHiddenActions && (
                        <div className="space-y-2">
                          {overviewActionsState.hidden.map((item, idx) =>
                            renderActionRow(item.action, idx, 'ov-hidden-act', item.coverage, {
                              disposition: item.disposition,
                              key: item.key,
                            })
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Quick Surface Findings Jump Summary */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span className="text-slate-700 dark:text-slate-300">
                {activeRun
                  ? `Deterministic Stage 0 evaluated ${activeFindings.length} finding(s): ${actionableSummary.externalCount} actionable External, ${actionableSummary.internalCount} actionable Internal.`
                  : 'Run your first 360° audit to populate External and Internal findings.'}
              </span>
            </div>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSubView('external')}
                className="btn-secondary text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
              >
                <span>
                  External ({actionableSummary.externalCount} actionable • {actors.length} tracked)
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setSubView('internal')}
                className="btn-secondary text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
              >
                <span>
                  Internal ({actionableSummary.internalCount} actionable • {lanClients.length} LAN)
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Related Security & Network Surfaces (Depth-2 Deep Links) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
            <div className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Related Security &amp; Network Surfaces
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <button
                type="button"
                onClick={() => onNavigateToHardening?.()}
                className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-[var(--color-brand)] text-left space-y-1 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2 font-semibold text-slate-900 dark:text-slate-100">
                  <span className="flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-[var(--color-brand-text)]" />
                    WSH Hardening
                  </span>
                  <span className="font-mono text-[var(--color-brand-text)]">→</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  SEC-01..SEC-09 container invariants, WSH iptables enforcement, and penetration audits.
                </p>
              </button>

              <button
                type="button"
                onClick={() => onNavigateToUnifiZbf?.('flow')}
                className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-[var(--color-brand)] text-left space-y-1 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2 font-semibold text-slate-900 dark:text-slate-100">
                  <span className="flex items-center gap-1.5">
                    <Waypoints className="w-4 h-4 text-[var(--color-brand-text)]" />
                    UniFi Network &amp; ZBF
                  </span>
                  <span className="font-mono text-[var(--color-brand-text)]">→</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Interactive VLAN Zone Flow Explorer, ZBF policy matrix, and owner-verified LAN MAC baseline.
                </p>
              </button>

              <button
                type="button"
                onClick={onNavigateToSettings}
                className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-[var(--color-brand)] text-left space-y-1 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2 font-semibold text-slate-900 dark:text-slate-100">
                  <span className="flex items-center gap-1.5">
                    <Sliders className="w-4 h-4 text-[var(--color-brand-text)]" />
                    Settings &gt; Security &amp; AI
                  </span>
                  <span className="font-mono text-[var(--color-brand-text)]">→</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Gemini 4 Hydrogen/Neon caps, connector verification, and autonomous audit cadence.
                </p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SUB-VIEW 2: EXTERNAL PERIMETER (CLOUDFLARE)                         */}
      {/* =================================================================== */}
      {subView === 'external' && (
        <div className="space-y-6">
          {/* External Action Header */}
          <div
            data-testid="threat-external-header-card"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4"
          >
            <div className="flex flex-col gap-3 min-w-0">
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Globe className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0" />
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Out-of-LAN External Perimeter (Cloudflare Edge, WAF &amp; Zero Trust)
                  </h3>
                  <StatusBadge
                    label={collectorStatuses.cloudflare}
                    variant={collectorStatusToBadgeVariant(collectorStatuses.cloudflare)}
                  />
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Monitors external internet traffic targeting <code className="font-mono">panoramadr.com</code> and <code className="font-mono">parakith.com</code>, Cloudflare Access OIDC logins, and <code className="font-mono">panorama-tunnel</code>. Mitigations apply in Cloudflare WAF or Zero Trust.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full min-w-0 pt-1">
                <button
                  type="button"
                  onClick={() => void handleOpenExternal(buildCloudflareSecurityEventsUrl(cfAccountId, 'panoramadr.com'))}
                  className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>CF Events (panoramadr)</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleOpenExternal(buildCloudflareSecurityEventsUrl(cfAccountId, 'parakith.com'))}
                  className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>CF Events (parakith)</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleOpenExternal(buildCloudflareZeroTrustLogsUrl(cfAccountId))}
                  className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Zero Trust Logs</span>
                </button>
              </div>
            </div>
          </div>

          {/* External Deterministic Findings */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[var(--color-brand-text)]" />
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  External Perimeter Findings (
                  {hasActiveFindingFilters
                    ? `${filteredExternalFindings.length} / ${externalFindings.length}`
                    : externalFindings.length}
                  )
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {hasActiveFindingFilters && (
                  <button
                    type="button"
                    onClick={clearFindingFilters}
                    className="btn-ghost text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Clear Filters</span>
                  </button>
                )}
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  Cloudflare HTTP/WAF, IP Threat Intel, Zero Trust Access &amp; Tunnel rules
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={findingSearch}
                  onChange={(e) => setFindingSearch(e.target.value)}
                  placeholder="Filter IP, ASN, host, rule, ray ID..."
                  className="w-full min-h-[40px] pl-8 pr-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
                />
              </div>

              <CustomSelect
                value={findingDomainFilter}
                onChange={setFindingDomainFilter}
                options={findingDomainOptions}
              />

              <CustomSelect
                value={findingVectorFilter}
                onChange={setFindingVectorFilter}
                options={findingVectorOptions}
              />

              <CustomSelect
                value={findingSeverityFilter}
                onChange={setFindingSeverityFilter}
                options={findingSeverityOptions}
              />
            </div>

            {externalFindings.length === 0 ? (
              <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center space-y-1">
                <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto" />
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  No External Deterministic Anomalies Flagged in This Window
                </div>
              </div>
            ) : filteredExternalFindings.length === 0 ? (
              <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center space-y-2.5">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  No External Findings Match Active Filters
                </div>
                <button
                  type="button"
                  onClick={clearFindingFilters}
                  className="btn-secondary text-xs inline-flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Clear Finding Filters</span>
                </button>
              </div>
            ) : (() => {
              const actionableExtList = filteredExternalFindings.filter((f) =>
                isFindingActionable(f, wafRules)
              );
              const infoExtList = filteredExternalFindings.filter(
                (f) => !isFindingActionable(f, wafRules)
              );
              return (
                <div className="space-y-4">
                  {actionableExtList.length > 0 ? (
                    <div className="space-y-3">{actionableExtList.map(renderFindingRow)}</div>
                  ) : (
                    !hasActiveFindingFilters && (
                      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-emerald-500/30 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            0 Actionable External Incidents
                          </span>
                          <span className="text-slate-500 dark:text-slate-400">
                            ({infoExtList.length} WAF-covered, low-severity, or resolved item{infoExtList.length === 1 ? '' : 's'})
                          </span>
                        </div>
                      </div>
                    )
                  )}
                  {infoExtList.length > 0 && (
                    <div className="space-y-2.5">
                      {!hasActiveFindingFilters && (
                        <button
                          type="button"
                          onClick={() =>
                            setShowExternalInformationalFindings((prev) => !prev)
                          }
                          className="btn-secondary text-xs inline-flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                        >
                          <span>
                            {showExternalInformationalFindings ? 'Hide' : 'Show'} Informational, WAF-Covered &amp; Resolved ({infoExtList.length})
                          </span>
                        </button>
                      )}
                      {(hasActiveFindingFilters || showExternalInformationalFindings) && (
                        <div className="space-y-3">{infoExtList.map(renderFindingRow)}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Recurring External Threat Actors Ledger */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  Recurring External Threat Actors (
                  {hasActiveActorFilters
                    ? `${filteredActors.length} / ${actorBucket.length}`
                    : filteredActors.length}
                  )
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Defaults to actionable HIGH/CRITICAL &amp; Origin-200 actors. Background scanners and WAF-covered probes live under Background / Mitigated Noise (auto-expires after 7d unseen).
                </p>
              </div>

              {hasActiveActorFilters && (
                <button
                  type="button"
                  onClick={clearActorFilters}
                  className="btn-ghost text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Clear Filters</span>
                </button>
              )}
            </div>

            <div className="space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5">
                <div className="relative sm:col-span-2 lg:col-span-6">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={actorSearch}
                    onChange={(e) => setActorSearch(e.target.value)}
                    placeholder="Filter IP, ASN, org, host, path..."
                    className="w-full min-h-[40px] pl-8 pr-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
                  />
                </div>

                <div className="lg:col-span-3">
                  <CustomSelect
                    value={actorDomainFilter}
                    onChange={setActorDomainFilter}
                    options={actorDomainOptions}
                  />
                </div>

                <div className="lg:col-span-3">
                  <CustomSelect
                    value={actorDispositionFilter}
                    onChange={setActorDispositionFilter}
                    options={[
                      {
                        value: 'ACTIONABLE',
                        label: `Actionable Only (${actionableSummary.actionableActors.length})`,
                      },
                      {
                        value: 'NOISE',
                        label: `Background / Mitigated Noise (${actionableSummary.backgroundNoiseActors.length})`,
                      },
                      { value: 'SNOOZED', label: `Snoozed (${actorCounts.snoozed})` },
                      { value: 'ALLOWLISTED', label: `Allowlisted (${actorCounts.allowlisted})` },
                      { value: 'RESOLVED', label: `Resolved (${actorCounts.resolved})` },
                      { value: 'EXPIRED', label: `Expired Noise (${actorCounts.expired})` },
                      { value: 'ALL', label: `All Actors (${actors.length})` },
                    ]}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <CustomSelect
                  value={actorVectorFilter}
                  onChange={setActorVectorFilter}
                  options={actorVectorOptions}
                />

                <CustomSelect
                  value={actorSeverityFilter}
                  onChange={setActorSeverityFilter}
                  options={actorSeverityOptions}
                />

                <CustomSelect
                  value={actorCountryFilter}
                  onChange={setActorCountryFilter}
                  options={actorCountryOptions}
                />
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
              <div className="p-8 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center space-y-2.5 text-xs text-slate-500">
                {actorDispositionFilter === 'ACTIONABLE' && !hasActiveActorFilters ? (
                  <>
                    <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto" />
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      Zero Actionable External Threat Actors
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      All recurring IPs are either low/medium scanner noise, WAF-covered, snoozed, or allowlisted.
                    </div>
                    {actionableSummary.backgroundNoiseActors.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setActorDispositionFilter('NOISE')}
                        className="btn-secondary text-xs inline-flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                      >
                        <span>
                          Inspect Background / Mitigated Noise (
                          {actionableSummary.backgroundNoiseActors.length})
                        </span>
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <div>
                      {actorBucket.length > 0 && hasActiveActorFilters
                        ? 'No threat actors match the active domain, vector, severity, country, or search filters.'
                        : 'No threat actors match the selected view.'}
                    </div>
                    {actorBucket.length > 0 && hasActiveActorFilters && (
                      <button
                        type="button"
                        onClick={clearActorFilters}
                        className="btn-secondary text-xs inline-flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Clear Actor Filters</span>
                      </button>
                    )}
                  </>
                )}
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
                  const actorCov = evaluateActorWafCoverage(actor, wafRules);
                  const actorCovered = actorCov.status === 'COVERED';
                  const actorPartial = actorCov.status === 'PARTIAL';
                  const isSnoozed = actor.disposition === 'SNOOZED';
                  const snoozeRem = isSnoozed ? formatSnoozeRemaining(actor.snoozedUntil) : null;

                  const actorDomId = `threat-actor-${actor.id}`;
                  const isFocusedActor = focusedItemId === actorDomId;

                  return (
                    <div
                      key={actor.id}
                      id={actorDomId}
                      className={`p-4 rounded-xl border space-y-2.5 transition-shadow ${
                        isFocusedActor
                          ? 'bg-rose-50/40 dark:bg-rose-950/20 border-rose-500 ring-2 ring-rose-500 shadow-md'
                          : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge
                            label={actor.highestSeverity}
                            variant={severityToBadgeVariant(actor.highestSeverity)}
                          />
                          <span className="text-sm font-mono font-bold text-slate-900 dark:text-slate-100">
                            {actor.ipAddress ? (
                              <CopyableValue value={actor.ipAddress} label="threat actor IP" />
                            ) : (
                              actor.id
                            )}
                          </span>
                          {(() => {
                            const info = actor.ipAddress
                              ? actorEmailByIp.get(actor.ipAddress.trim().toLowerCase())
                              : undefined;
                            return info ? (
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-mono ${
                                  info.verified
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                                    : 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300'
                                }`}
                              >
                                <Mail className="w-3 h-3 shrink-0" />
                                <CopyableValue value={info.email} label="actor email" />
                              </span>
                            ) : null;
                          })()}
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
                          {isSnoozed ? (
                            <span title={actor.snoozedUntil ? `Snoozed until ${formatLocalDateTime(actor.snoozedUntil)}` : undefined}>
                              <StatusBadge
                                label={`Snoozed${snoozeRem ? ` · ${snoozeRem}` : ''}`}
                                variant="info"
                              />
                            </span>
                          ) : (
                            <StatusBadge
                              label={actor.disposition}
                              variant={actor.disposition === 'ACTIVE' ? 'warning' : 'neutral'}
                            />
                          )}
                          {actorCovered && actorCov.primaryRuleName && (
                            <StatusBadge
                              label={`WAF Covered: ${actorCov.primaryRuleName}`}
                              variant="success"
                            />
                          )}
                          {actorPartial && actorCov.primaryRuleName && (
                            <StatusBadge
                              label={`Partial WAF: ${actorCov.primaryRuleName}`}
                              variant="warning"
                            />
                          )}
                          {actor.totalOrigin200s > 0 && (
                            <StatusBadge
                              label={`CROSS-OVER: ${actor.totalOrigin200s} Origin 200s`}
                              variant="danger"
                            />
                          )}
                        </div>

                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                          {wafExpr && !actorCovered && (
                            <button
                              type="button"
                              onClick={() => void handleCopyText(copyKey, wafExpr)}
                              className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                            >
                              {copiedKey === copyKey ? (
                                <Check className="w-3.5 h-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
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
                              title="Permanently exempt your own trusted IP or ASN from future local PanoramaSRE alerts (never modifies Cloudflare). Use Snooze for external scanner noise."
                            >
                              Allowlist
                            </button>
                          )}
                          {isSnoozed || actor.disposition === 'RESOLVED' ? (
                            <button
                              type="button"
                              onClick={() => void handleSetDisposition(actor.id, 'ACTIVE')}
                              className="btn-secondary text-xs whitespace-nowrap flex-shrink-0"
                            >
                              {isSnoozed ? 'Unsnooze' : 'Reopen'}
                            </button>
                          ) : (
                            <SnoozeSplitButton
                              onSnooze={(days) => void handleSnoozeActor(actor.id, days)}
                            />
                          )}
                          {onStageWafDefense && actor.ipAddress && (
                            <button
                              type="button"
                              onClick={() => {
                                const actorIp = actor.ipAddress;
                                if (!actorIp) return;
                                const targetZone = hosts.some((h) => h.toLowerCase().includes('parakith'))
                                  ? 'parakith.com'
                                  : 'panoramadr.com';
                                void onStageWafDefense({
                                  title: `60m Managed Challenge: ${actorIp}`,
                                  targetZone,
                                  targetHost: hosts[0] ?? null,
                                  actionType: 'managed_challenge',
                                  targetIps: [actorIp],
                                  targetAsns: [],
                                  rcaSummary: `Staged from Threat SOC for external actor ${actorIp} (${actor.asOrg || actor.asn || 'unknown ASN'}, ${actor.totalRequests} reqs, ${actor.totalOrigin200s} origin 200s).`,
                                });
                              }}
                              className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                              title="Stage a Policy-Kernel-validated 60m Managed Challenge Defense Plan in Otto"
                            >
                              <ShieldAlert className="w-3.5 h-3.5 text-[var(--color-brand-text)]" />
                              <span>Stage Defense Plan</span>
                            </button>
                          )}
                          {onAskOtto && (
                            <button
                              type="button"
                              onClick={() =>
                                onAskOtto({
                                  kind: 'threat_actor',
                                  entityId: actor.id,
                                  originView: 'security',
                                  title: `External Actor ${actor.ipAddress || actor.id}`,
                                  severity: actor.highestSeverity,
                                  summary: `${actor.totalRequests} requests (${actor.totalOrigin200s} origin 200s) targeting ${hosts.join(', ') || 'suite edge'}`,
                                  metadata: {
                                    ip: actor.ipAddress,
                                    asn: actor.asn,
                                    asOrg: actor.asOrg,
                                    country: actor.country,
                                    hosts,
                                    paths: paths.slice(0, 8),
                                  },
                                  starterPrompts: [
                                    `Evaluate actor ${actor.ipAddress || actor.id} against our Next.js/SQLite/CF-Pages stack: MATERIAL_THREAT or NOISE_SAFE_DROP?`,
                                    `Are the probed paths (${paths.slice(0, 4).join(', ') || 'recent paths'}) actually exposed on our stack?`,
                                  ],
                                })
                              }
                              className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                            >
                              <OttoIcon className="w-3.5 h-3.5" />
                              <span>Ask Otto</span>
                            </button>
                          )}
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

          {/* Active Cloudflare WAF Custom Rules & Free-Plan Slot Budget */}
          <div
            id="cf-waf-rules-card"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4"
          >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-[var(--color-brand-text)] shrink-0" />
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Cloudflare Custom WAF Rules &amp; Free-Plan Slot Budget
                  </h3>
                  {wafSnapshot?.wafReadOk ? (
                    <StatusBadge label={`Live Sync OK (${wafRules.length} rules)`} variant="success" />
                  ) : wafSnapshot?.wafReadStatus === 'forbidden' ? (
                    <StatusBadge label="Add Zone WAF:Read Permission" variant="warning" />
                  ) : (
                    <StatusBadge label="Manual Tracking" variant="neutral" />
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Deployed custom rules automatically mark matching campaigns, findings, and actors as <strong className="text-slate-800 dark:text-slate-200">WAF Covered</strong>, remove redundant add-WAF actions, and detect unblocked slip-through paths.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                <button
                  type="button"
                  onClick={() => void loadWafRules(true)}
                  disabled={isLoadingWaf}
                  className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingWaf ? 'animate-spin' : ''}`} />
                  <span>{isLoadingWaf ? 'Syncing...' : 'Sync WAF Rules'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowManualWafForm((prev) => !prev)}
                  className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{showManualWafForm ? 'Close Rule Form' : 'Track Local Rule'}</span>
                </button>
              </div>
            </div>

            {wafSnapshot?.zones && wafSnapshot.zones.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 tabular-nums">
                {wafSnapshot.zones.map((zb) => (
                  <div
                    key={zb.zoneName}
                    className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono flex items-center gap-2"
                  >
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{zb.zoneName}</span>
                    <span
                      className={
                        zb.rulesUsed >= zb.freePlanLimit
                          ? 'text-amber-600 dark:text-amber-400 font-bold'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }
                    >
                      {zb.rulesUsed} / {zb.freePlanLimit} slots
                    </span>
                    <span className="text-[11px] text-slate-500">
                      ({zb.readStatus === 'ok' ? 'Live' : 'Tracked'})
                    </span>
                  </div>
                ))}
              </div>
            )}

            {wafSnapshot?.wafReadStatus === 'forbidden' && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                <div className="font-semibold">
                  Automatic Cloudflare WAF rule sync returned HTTP 403 (missing permission)
                </div>
                <div>
                  {wafSnapshot.permissionHint ||
                    "Add read-only permission 'Zone → Zone WAF → Read' to your Cloudflare API Token, or track your deployed rules manually below so PanoramaSRE stops suggesting duplicate WAF actions."}
                </div>
              </div>
            )}

            {wafFeedback && (
              <div
                className={`text-xs font-mono px-3 py-2 rounded-xl border ${
                  wafFeedback.tone === 'ok'
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30'
                }`}
              >
                {wafFeedback.text}
              </div>
            )}

            {showManualWafForm && (
              <form
                onSubmit={(e) => void handleSaveWafOverride(e)}
                className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3"
              >
                <div className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                  Track Local Cloudflare Custom WAF Rule (Fallback / Pin)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  <CustomSelect
                    value={manualWafZone}
                    onChange={setManualWafZone}
                    options={knownCfZones.map((z) => ({ value: z, label: z }))}
                  />
                  <CustomSelect
                    value={manualWafAction}
                    onChange={setManualWafAction}
                    options={[
                      { value: 'block', label: 'Block' },
                      { value: 'managed_challenge', label: 'Managed Challenge' },
                      { value: 'js_challenge', label: 'JS Challenge' },
                    ]}
                  />
                  <input
                    type="text"
                    value={manualWafName}
                    onChange={(e) => setManualWafName(e.target.value)}
                    placeholder="Rule name (e.g. Block WP Probes)"
                    className="sm:col-span-2 px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={manualWafExpr}
                    onChange={(e) => setManualWafExpr(e.target.value)}
                    placeholder='Expression, e.g. (http.host eq "wsh.panoramadr.com" and ip.geoip.country ne "US")'
                    className="flex-1 px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
                  />
                  <button
                    type="submit"
                    disabled={isSavingWafOverride || !manualWafName.trim() || !manualWafExpr.trim()}
                    className="btn-primary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSavingWafOverride ? 'Saving...' : 'Save Tracked Rule'}</span>
                  </button>
                </div>
              </form>
            )}

            {wafRules.length > 0 && (
              <div className="space-y-2">
                {wafRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          label={rule.enabled ? rule.action.toUpperCase() : 'DISABLED'}
                          variant={rule.enabled ? 'info' : 'neutral'}
                        />
                        <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-mono text-slate-700 dark:text-slate-300">
                          {rule.zoneName}
                        </span>
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {rule.description}
                        </span>
                        <StatusBadge
                          label={rule.source === 'cloudflare_live' ? 'Live CF' : 'Local Tracked'}
                          variant={rule.source === 'cloudflare_live' ? 'success' : 'neutral'}
                        />
                      </div>
                      <pre className="overflow-x-auto text-[11px] font-mono text-emerald-900 dark:text-emerald-400">
                        {rule.expression}
                      </pre>
                    </div>

                    {rule.source === 'manual_override' && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteWafOverride(rule.id)}
                        className="btn-ghost text-xs text-rose-600 dark:text-rose-400 min-w-[36px] min-h-[36px] flex items-center justify-center whitespace-nowrap flex-shrink-0"
                        title="Remove tracked local WAF rule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* External Gemini Attack Campaigns & Mitigations */}
          {geminiBrief && (externalCampaigns.length > 0 || externalActions.length > 0) && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
              {externalCampaigns.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                    <div className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider tabular-nums">
                      External Attack Campaigns (
                      {hasActiveCampaignFilters
                        ? `${filteredExternalCampaigns.length} / ${externalCampaigns.length}`
                        : externalCampaigns.length}
                      )
                    </div>

                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                      <div className="w-full sm:w-56">
                        <CustomSelect
                          value={campaignDomainFilter}
                          onChange={setCampaignDomainFilter}
                          options={campaignDomainOptions}
                        />
                      </div>
                      <div className="w-full sm:w-48">
                        <CustomSelect
                          value={campaignSeverityFilter}
                          onChange={setCampaignSeverityFilter}
                          options={campaignSeverityOptions}
                        />
                      </div>
                      {hasActiveCampaignFilters && (
                        <button
                          type="button"
                          onClick={clearCampaignFilters}
                          className="btn-ghost text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Clear</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {filteredExternalCampaigns.length === 0 ? (
                    <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center space-y-2.5">
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        No attack campaigns match the selected domain or severity filter.
                      </div>
                      <button
                        type="button"
                        onClick={clearCampaignFilters}
                        className="btn-secondary text-xs inline-flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Clear Campaign Filters</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredExternalCampaigns.map((camp, idx) => {
                        const copyId = `ext-camp-waf-${camp.name}-${idx}`;
                        const campObservedPaths = Array.from(
                          new Set(
                            camp.targetHosts.flatMap((h) =>
                              Array.from(observedPathsByHost.get(normalizeHostname(h)) ?? [])
                            )
                          )
                        );
                        const campCov = evaluateCampaignWafCoverage(camp, wafRules, campObservedPaths);
                        const campCovered = campCov.status === 'COVERED';
                        const campPartial = campCov.status === 'PARTIAL';

                        return (
                          <div
                            key={`${camp.name}-${camp.severity}-${idx}`}
                            className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <StatusBadge
                                  label={camp.severity}
                                  variant={severityToBadgeVariant(camp.severity)}
                                />
                                {classifyCampaignSurface(camp) === 'crossover' && (
                                  <StatusBadge label="Cross-Surface" variant="accent" />
                                )}
                                {campCovered && campCov.primaryRuleName && (
                                  <StatusBadge
                                    label={`WAF Covered: ${campCov.primaryRuleName}`}
                                    variant="success"
                                  />
                                )}
                                {campPartial && campCov.primaryRuleName && (
                                  <StatusBadge
                                    label={`Partial WAF: ${campCov.primaryRuleName}`}
                                    variant="warning"
                                  />
                                )}
                                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                  {camp.name}
                                </span>
                                <span className="text-xs font-mono text-slate-500 tabular-nums">
                                  ~{camp.countEstimate} events
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {camp.suggestedWafExpression && !campCovered && !campPartial && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handlePrefillMarkCovered(
                                        camp.targetHosts[0] || 'parakith.com',
                                        camp.name.slice(0, 64),
                                        camp.suggestedWafExpression || ''
                                      )
                                    }
                                    className="btn-ghost text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                                    title="Mark this campaign as covered by an active Cloudflare WAF rule"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>Mark Covered</span>
                                  </button>
                                )}
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

                            {campPartial && campCov.uncoveredPaths.length > 0 && (
                              <div className="text-[11px] font-mono text-amber-700 dark:text-amber-400">
                                Unblocked slip-through paths (tighten existing rule instead of adding a new slot):{' '}
                                {campCov.uncoveredPaths.slice(0, 6).join(', ')}
                              </div>
                            )}

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

                            {camp.suggestedWafExpression && !campCovered && (
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                                <pre className="flex-1 overflow-x-auto px-3 py-2 rounded-lg bg-white dark:bg-[#050b14] border border-slate-200/90 dark:border-slate-800 text-emerald-900 dark:text-emerald-400 font-mono text-xs">
                                  {camp.suggestedWafExpression}
                                </pre>
                                <button
                                  type="button"
                                  onClick={() => void handleCopyText(copyId, camp.suggestedWafExpression || '')}
                                  className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                                >
                                  {copiedKey === copyId ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                  <span>
                                    {copiedKey === copyId
                                      ? 'Copied!'
                                      : campPartial
                                      ? 'Copy Tightened Snippet'
                                      : 'Copy WAF Rule'}
                                  </span>
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {(partitionedExternalActions.visibleActions.length > 0 ||
                partitionedExternalActions.hiddenActions.length > 0 ||
                partitionedExternalActions.suppressedCoveredCount > 0) && (
                <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider tabular-nums">
                      External Cloudflare Actions ({partitionedExternalActions.visibleActions.length})
                    </div>
                    {partitionedExternalActions.suppressedCoveredCount > 0 && (
                      <StatusBadge
                        label={`${partitionedExternalActions.suppressedCoveredCount} covered by WAF`}
                        variant="success"
                      />
                    )}
                  </div>
                  {partitionedExternalActions.visibleActions.length === 0 ? (
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
                      {partitionedExternalActions.hiddenActions.length > 0
                        ? 'All remaining external Cloudflare actions are snoozed or permanently dismissed.'
                        : 'All suggested Cloudflare WAF additions are already covered by active rules.'}
                    </div>
                  ) : (
                    partitionedExternalActions.visibleActions.map((item, idx) =>
                      renderActionRow(item.action, idx, 'ext-act', item.coverage)
                    )
                  )}
                  {partitionedExternalActions.hiddenActions.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowHiddenActions((p) => !p)}
                        className="btn-secondary text-xs whitespace-nowrap flex-shrink-0"
                      >
                        {showHiddenActions ? 'Hide' : 'Show'} Snoozed &amp; Permanently Dismissed Actions (
                        {partitionedExternalActions.hiddenActions.length})
                      </button>
                      {showHiddenActions && (
                        <div className="space-y-2">
                          {partitionedExternalActions.hiddenActions.map((item, idx) =>
                            renderActionRow(item.action, idx, 'ext-hidden-act', item.coverage, {
                              disposition: item.disposition,
                              key: item.key,
                            })
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* SUB-VIEW 3: INTERNAL LAN & WSH INFRASTRUCTURE (UNIFI + WSH)         */}
      {/* =================================================================== */}
      {subView === 'internal' && (
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

          {/* Internal Action Header & Hardware Telemetry */}
          <div
            data-testid="threat-internal-header-card"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4"
          >
            <div className="flex flex-col gap-3 min-w-0">
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Wifi className="w-5 h-5 text-[var(--color-brand-text)] shrink-0" />
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Internal LAN, UniFi Network &amp; WSH Origin Host
                  </h3>
                  <StatusBadge
                    label={`UniFi: ${collectorStatuses.unifi}`}
                    variant={collectorStatusToBadgeVariant(collectorStatuses.unifi)}
                  />
                  <StatusBadge
                    label={`WSH: ${collectorStatuses.wshAuth}`}
                    variant={collectorStatusToBadgeVariant(collectorStatuses.wshAuth)}
                  />
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Monitors your private LAN hardware (<code className="font-mono">{unifiBaseUrl}</code>), device MAC baseline, UniFi CyberSecure IPS/CEF alerts, WSH SSH auth, and <code className="font-mono">PanoramaAuth</code>. Actions apply in UniFi Console, WSH Firewall, or the <code className="font-mono">unifi-siem</code> collector.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full min-w-0 pt-1">
                <button
                  type="button"
                  onClick={() => void handleOpenExternal(buildUnifiConsoleUrl(unifiBaseUrl, 'clients'))}
                  className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>UniFi Clients</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleOpenExternal(buildUnifiConsoleUrl(unifiBaseUrl, 'threats'))}
                  className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>UniFi Flows / IPS</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleOpenExternal(buildUnifiConsoleUrl(unifiBaseUrl, 'policies'))}
                  className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>UniFi Firewall</span>
                </button>
                {onNavigateToUnifiZbf && (
                  <>
                    <button
                      type="button"
                      onClick={() => onNavigateToUnifiZbf('flow')}
                      className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                    >
                      <Waypoints className="w-3.5 h-3.5" />
                      <span>UniFi Network &amp; ZBF →</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigateToUnifiZbf('baseline')}
                      className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>LAN Device Baseline →</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={onNavigateToSiemRelease ?? onNavigateToSettings}
                  className="btn-ghost text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <span>{onNavigateToSiemRelease ? 'Manage SIEM →' : 'SIEM Settings →'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Internal Security Campaigns & Deterministic Findings */}
          {(internalCampaigns.length > 0 || internalFindings.length > 0 || internalActions.length > 0) && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
              {internalCampaigns.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider tabular-nums">
                    Internal Security Campaigns ({internalCampaigns.length})
                  </div>
                  <div className="space-y-2.5">
                    {internalCampaigns.map((camp, idx) => (
                      <div
                        key={`int-camp-${camp.name}-${idx}`}
                        className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge
                              label={camp.severity}
                              variant={severityToBadgeVariant(camp.severity)}
                            />
                            {classifyCampaignSurface(camp) === 'crossover' && (
                              <StatusBadge label="Cross-Surface" variant="accent" />
                            )}
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
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(internalFindings.length > 0 || internalActions.length > 0) && (() => {
                const actionableIntList = internalFindings.filter((f) =>
                  isFindingActionable(f, wafRules)
                );
                const infoIntList = internalFindings.filter(
                  (f) => !isFindingActionable(f, wafRules)
                );
                return (
                  <>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-[var(--color-brand-text)]" />
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        Internal LAN &amp; Host Findings ({actionableIntList.length} actionable
                        {infoIntList.length > 0 ? ` • ${infoIntList.length} informational/resolved` : ''})
                      </h3>
                    </div>
                    {actionableIntList.length > 0 ? (
                      <div className="space-y-3">{actionableIntList.map(renderFindingRow)}</div>
                    ) : (
                      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-emerald-500/30 flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          0 Actionable Internal Security Incidents
                        </span>
                      </div>
                    )}
                    {infoIntList.length > 0 && (
                      <div className="space-y-2.5">
                        <button
                          type="button"
                          onClick={() =>
                            setShowInternalInformationalFindings((prev) => !prev)
                          }
                          className="btn-secondary text-xs inline-flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                        >
                          <span>
                            {showInternalInformationalFindings ? 'Hide' : 'Show'} Informational &amp; Resolved Internal Telemetry ({infoIntList.length})
                          </span>
                        </button>
                        {showInternalInformationalFindings && (
                          <div className="space-y-3">{infoIntList.map(renderFindingRow)}</div>
                        )}
                      </div>
                    )}
                    {(internalActionsState.active.length > 0 ||
                      internalActionsState.hidden.length > 0) && (
                      <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                        <div className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider tabular-nums">
                          Recommended Internal Actions ({internalActionsState.active.length})
                        </div>
                        {internalActionsState.active.map((item, idx) =>
                          renderActionRow(item.action, idx, 'int-act')
                        )}
                        {internalActionsState.hidden.length > 0 && (
                          <div className="space-y-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setShowHiddenActions((p) => !p)}
                              className="btn-secondary text-xs whitespace-nowrap flex-shrink-0"
                            >
                              {showHiddenActions ? 'Hide' : 'Show'} Snoozed &amp; Permanently Dismissed Actions (
                              {internalActionsState.hidden.length})
                            </button>
                            {showHiddenActions && (
                              <div className="space-y-2">
                                {internalActionsState.hidden.map((item, idx) =>
                                  renderActionRow(item.action, idx, 'int-hidden-act', null, {
                                    disposition: item.disposition,
                                    key: item.key,
                                  })
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* Cross-Domain Link Card to Promoted UniFi Network & ZBF Explorer */}
          {onNavigateToUnifiZbf && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
                  <Waypoints className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
                  <span>UniFi Network Topology &amp; Owner-Verified LAN Device Baseline</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Zone Flow Explorer, ZBF Matrix, VLAN Directory, and the LAN Device MAC Trust table ({trustedLanCount}/{lanClients.length} trusted) live in{' '}
                  <strong>Infrastructure &amp; Network → UniFi Network &amp; ZBF</strong>.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onNavigateToUnifiZbf('baseline')}
                  className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <span>LAN Baseline ({trustedLanCount}/{lanClients.length}) →</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateToUnifiZbf('flow')}
                  className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <span>Zone Flow Explorer →</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* SUB-VIEW 4: ALLOWLIST & CONTROLS                                    */}
      {/* =================================================================== */}
      {subView === 'allowlist' && (
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

          {/* Card 1: Cloudflare Access Quarantine Queue (wsh.panoramadr.com) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  Cloudflare Access Quarantine Queue ({effectiveQuarantinedEmails.length})
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Emails discovered inside attached <code className="font-mono">wsh.panoramadr.com</code> Cloudflare Access policies. New or re-added addresses stay untrusted until approved; removed addresses are auto-revoked.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleSyncAccessEmailsNow()}
                disabled={isSyncingQuarantine}
                className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingQuarantine ? 'animate-spin' : ''}`} />
                <span>{isSyncingQuarantine ? 'Syncing Access...' : 'Sync Access Emails Now'}</span>
              </button>
            </div>

            {effectivePolicyPermissionHint && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{effectivePolicyPermissionHint}</span>
              </div>
            )}

            {effectiveQuarantinedEmails.length === 0 ? (
              <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
                No synced Cloudflare Access emails recorded yet. Click &quot;Sync Access Emails Now&quot; or run a 360° Threat Audit.
              </div>
            ) : (
              <div className="space-y-2.5">
                {effectiveQuarantinedEmails.map((q) => {
                  const grants = parsePolicyGrants(q.policyGrantsJson);
                  const badgeVariant =
                    q.status === 'APPROVED'
                      ? 'success'
                      : q.status === 'PENDING'
                      ? 'warning'
                      : q.status === 'REJECTED'
                      ? 'danger'
                      : 'neutral';
                  const firstPolicyName = grants[0]?.policyName;
                  return (
                    <div
                      key={`quar-row-${q.email}`}
                      className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge label={q.status} variant={badgeVariant} />
                          <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                            <CopyableValue value={q.email} label="quarantined email" />
                          </span>
                          <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                            First: {formatLocalDateTime(q.firstSeenAt)} • Last: {formatLocalDateTime(q.lastSeenAt)}
                          </span>
                        </div>
                        <PolicyGrantProvenanceChips grants={grants} />
                        {q.reviewNote && (
                          <div className="text-[11px] text-slate-600 dark:text-slate-400">
                            Note: {q.reviewNote}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {q.status !== 'APPROVED' && q.status !== 'REMOVED' && (
                          <button
                            type="button"
                            onClick={() =>
                              void handleApproveQuarantinedEmail(
                                q.email,
                                firstPolicyName ? `${firstPolicyName} (wsh Access)` : undefined
                              )
                            }
                            className="btn-primary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Approve &amp; Allow</span>
                          </button>
                        )}
                        {q.status !== 'REJECTED' && q.status !== 'REMOVED' && (
                          <button
                            type="button"
                            onClick={() => void handleRejectQuarantinedEmail(q.email)}
                            className="btn-danger text-xs whitespace-nowrap flex-shrink-0"
                          >
                            {q.status === 'APPROVED' ? 'Revoke / Reject' : 'Reject'}
                          </button>
                        )}
                        {onAskOtto && (
                          <button
                            type="button"
                            onClick={() =>
                              onAskOtto({
                                kind: 'quarantined_email',
                                entityId: q.email,
                                originView: 'security',
                                title: `Quarantined Zero Trust Email: ${q.email}`,
                                severity: 'MEDIUM',
                                summary: `Cloudflare Access policy grant status=${q.status}, first seen ${q.firstSeenAt}.`,
                                metadata: { email: q.email, status: q.status, grants },
                                starterPrompts: [
                                  `Audit Zero Trust email ${q.email} and explain its policy provenance and risk posture.`,
                                ],
                              })
                            }
                            className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                          >
                            <OttoIcon className="w-3.5 h-3.5" />
                            <span>Ask Otto</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Card 2: Attached wsh.panoramadr.com Cloudflare Access Policies */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                Attached wsh.panoramadr.com Cloudflare Access Policies ({effectiveAttachedPolicies.length})
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Policy provenance attached directly to <code className="font-mono">wsh.panoramadr.com</code> (unattached library policies and non-WSH LAN subdomains are excluded).
              </p>
            </div>

            {effectiveAttachedPolicies.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                No attached policy snapshot recorded yet. Click &quot;Sync Access Emails Now&quot; to inspect live policies.
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {effectiveAttachedPolicies.map((pol) => (
                  <div
                    key={`${pol.appUid}-${pol.policyId}`}
                    className={`p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border space-y-2 text-xs ${
                      pol.broadRules.length > 0
                        ? 'border-rose-500/60'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {pol.policyName}
                        </span>
                        <StatusBadge label={`#${pol.precedence}`} variant="neutral" />
                        <StatusBadge
                          label={pol.decision.toUpperCase()}
                          variant={pol.decision === 'allow' ? 'info' : 'warning'}
                        />
                        <StatusBadge
                          label={pol.reusable ? 'Reusable' : 'App-Local'}
                          variant="accent"
                        />
                        {pol.broadRules.length > 0 && (
                          <StatusBadge
                            label={`BROAD RULE: ${pol.broadRules.join(', ')}`}
                            variant="danger"
                          />
                        )}
                      </div>
                      <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                        {pol.emailCount} email{pol.emailCount === 1 ? '' : 's'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                      <span>App: {pol.appDomain}</span>
                      {pol.sessionDuration && <span>Session: {pol.sessionDuration}</span>}
                      {pol.policyCreatedAt && <span>Created: {pol.policyCreatedAt.slice(0, 10)}</span>}
                      {pol.policyUpdatedAt && <span>Updated: {pol.policyUpdatedAt.slice(0, 10)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cross-Surface Allowlist Rules Manager */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Cross-Surface Threat Suppression Allowlist ({allowlist.length})
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Suppress expected operators, home/office IPs, CIDRs, ASNs, Zero Trust emails (External Cloudflare), LAN MACs, or SSH fingerprints (Internal UniFi / WSH) from future findings.
                </p>
              </div>
              <button
                type="button"
                onClick={onNavigateToSettings}
                className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Test Connections in Settings</span>
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 space-y-1">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Family &amp; Mobile Zero Trust Correlation
              </div>
              <p className="text-slate-600 dark:text-slate-400">
                Add your family&apos;s Google OIDC emails as <code className="font-mono">Zero Trust Email</code> rules below. PanoramaSRE automatically correlates their Cloudflare Access logins and active <code className="font-mono">PanoramaAuth</code> sessions — including rotating cellular IPv6 <code className="font-mono">/64</code> addresses — without ever allowlisting broad carrier ASNs.
              </p>
            </div>

            <form onSubmit={(e) => void handleAddAllowlistRule(e)} className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end">
              <div className="md:col-span-3">
                <label className="block text-[11px] font-mono text-slate-500 mb-1">Type</label>
                <CustomSelect
                  value={newRuleType}
                  onChange={setNewRuleType}
                  options={[
                    { value: 'IP', label: 'IP Address (External / Both)' },
                    { value: 'CIDR', label: 'IPv4 CIDR (External)' },
                    { value: 'ASN', label: 'ASN (External)' },
                    { value: 'EMAIL', label: 'Zero Trust Email (External)' },
                    { value: 'LAN_MAC', label: 'LAN MAC Address (Internal)' },
                    { value: 'SSH_KEY', label: 'SSH Key Fingerprint (Internal)' },
                  ]}
                />
              </div>

              <div className="md:col-span-4">
                <label className="block text-[11px] font-mono text-slate-500 mb-1">Value</label>
                <input
                  type="text"
                  value={newRuleValue}
                  onChange={(e) => setNewRuleValue(e.target.value)}
                  placeholder={
                    newRuleType === 'EMAIL'
                      ? 'e.g. family@gmail.com'
                      : 'e.g. 203.0.113.10 or AS13335'
                  }
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

            {allowlist.length === 0 ? (
              <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
                No suppression allowlist rules configured yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                {allowlist.map((rule) => {
                  const surface = classifyAllowlistSurface(rule.entryType);
                  return (
                    <div
                      key={rule.id}
                      className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 text-xs"
                    >
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <StatusBadge
                          label={surface === 'external' ? 'External (CF)' : 'Internal (LAN/WSH)'}
                          variant={surface === 'external' ? 'info' : 'accent'}
                        />
                        <StatusBadge label={rule.entryType} variant="neutral" />
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          <CopyableValue value={rule.value} label={rule.entryType} />
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
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
