import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SegmentedControl, StatusBadge } from '@lagosr/panorama-ui-kit';
import {
  Activity,
  AlertOctagon,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  KeyRound,
  Lock,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  XCircle,
} from 'lucide-react';
import { BlastRadiusBadge } from '../ui/BlastRadiusBadge';
import { ConfirmDangerModal } from '../ui/ConfirmDangerModal';
import { CustomSelect } from '../ui/CustomSelect';
import { formatLocalDateTime, formatRelativeTime } from '../../lib/formatters';
import type {
  DiscoveredApp,
  OttoContextSeed,
  OttoL4Invariant,
  OttoLogDeltaProbeResult,
  OttoPolicyRow,
  OttoProposalRow,
  OttoRuntimePhase,
  OttoSoakSessionRow,
  OttoStatusDto,
  OttoTraceRunRow,
} from '../../lib/types';
import { AskOttoPanel } from './AskOttoPanel';
import { OttoIcon } from './OttoAvatar';
import { OttoTraceInspectorDrawer } from './OttoTraceInspectorDrawer';

export type OttoSubView = 'ask' | 'traces' | 'approvals' | 'policies';

interface OttoAgentViewProps {
  apps: DiscoveredApp[];
  status: OttoStatusDto | null;
  policies: OttoPolicyRow[];
  l4Invariants: OttoL4Invariant[];
  traces: OttoTraceRunRow[];
  proposals: OttoProposalRow[];
  soaks?: OttoSoakSessionRow[];
  initialSubView?: OttoSubView;
  initialSubViewNonce?: number;
  pendingContextSeed?: OttoContextSeed | null;
  pendingContextNonce?: number;
  onConsumeContextSeed?: () => void;
  initialInspectTraceId?: string | null;
  initialInspectTraceNonce?: number;
  onRefreshOtto: () => Promise<void>;
  onToggleKillSwitch: (active: boolean) => Promise<void>;
  onAbortStep: () => Promise<void>;
  onResetCircuitBreaker: () => Promise<void>;
  onUpdatePolicyMode: (actionId: string, mode: string) => Promise<void>;
  onDecideProposal: (proposalId: string, decision: string) => Promise<OttoProposalRow | void>;
  onCancelSoak?: (soakId: string) => Promise<void>;
  onEvaluateSteadyState?: () => Promise<string | void>;
  onQueueBuildKitPruneProposal?: () => Promise<void>;
  onAskOtto?: (seed: OttoContextSeed) => void;
  onNavigateToSettings?: () => void;
}

const FSM_STEPS: Array<{ key: OttoRuntimePhase; label: string }> = [
  { key: 'SENSING', label: 'Sense' },
  { key: 'STAGE0_EVAL', label: 'Stage-0' },
  { key: 'THINKING', label: 'Think' },
  { key: 'STAGING', label: 'Policy' },
  { key: 'ACTING', label: 'Act' },
  { key: 'VERIFYING', label: 'Verify' },
];

const MODE_LABELS: Record<string, string> = {
  OBSERVE: 'L0 Observe Only',
  SHADOW: 'L1 Shadow (Dry-Run)',
  L3_APPROVAL: 'L3 Desktop Approval',
  L2_AUTO: 'L2 Auto (Reversible)',
};

function allowedOptionsForPolicy(maxAllowedMode: string): Array<{ value: string; label: string }> {
  const rank = (m: string) =>
    m === 'OBSERVE' ? 0 : m === 'SHADOW' ? 1 : m === 'L3_APPROVAL' ? 2 : m === 'L2_AUTO' ? 3 : 0;
  const maxRank = rank(maxAllowedMode);
  return ['OBSERVE', 'SHADOW', 'L3_APPROVAL', 'L2_AUTO']
    .filter((m) => rank(m) <= maxRank)
    .map((m) => ({ value: m, label: MODE_LABELS[m] || m }));
}

function safeParseStringArray(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function safeParseSamples(raw?: string | null): Array<{ timestamp: string; healthy: boolean; detail: string }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const OttoAgentView: React.FC<OttoAgentViewProps> = ({
  apps,
  status,
  policies,
  l4Invariants,
  traces,
  proposals,
  soaks = [],
  initialSubView = 'ask',
  initialSubViewNonce = 0,
  pendingContextSeed = null,
  pendingContextNonce = 0,
  onConsumeContextSeed,
  initialInspectTraceId = null,
  initialInspectTraceNonce = 0,
  onRefreshOtto,
  onToggleKillSwitch,
  onAbortStep,
  onResetCircuitBreaker,
  onUpdatePolicyMode,
  onDecideProposal,
  onCancelSoak,
  onEvaluateSteadyState,
  onQueueBuildKitPruneProposal,
  onAskOtto,
  onNavigateToSettings,
}) => {
  const [subView, setSubView] = useState<OttoSubView>(initialSubView);
  const [inspectedTraceId, setInspectedTraceId] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [probeFeedback, setProbeFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [isEvaluatingSteady, setIsEvaluatingSteady] = useState(false);
  const [isStagingPrune, setIsStagingPrune] = useState(false);
  const [elapsedSecs, setElapsedSecs] = useState<number>(0);
  const [approvalDomainFilter, setApprovalDomainFilter] = useState<string>('ALL');
  const [approvalStatusFilter, setApprovalStatusFilter] = useState<'active' | 'shadow' | 'history'>('active');
  const [expandedProposalIds, setExpandedProposalIds] = useState<Record<string, boolean>>({});
  const [confirmApproveProposal, setConfirmApproveProposal] = useState<OttoProposalRow | null>(null);
  const [isExecutingProposalId, setIsExecutingProposalId] = useState<string | null>(null);

  useEffect(() => {
    if (initialSubViewNonce > 0) {
      setSubView(initialSubView);
    }
  }, [initialSubView, initialSubViewNonce]);

  useEffect(() => {
    if (pendingContextSeed && pendingContextNonce > 0) {
      setSubView('ask');
    }
  }, [pendingContextSeed, pendingContextNonce]);

  useEffect(() => {
    if (initialInspectTraceId && initialInspectTraceNonce > 0) {
      setInspectedTraceId(initialInspectTraceId);
    }
  }, [initialInspectTraceId, initialInspectTraceNonce]);

  const lifecycle = status?.lifecycle;
  const runtimeState: OttoRuntimePhase = lifecycle?.state ?? 'IDLE';
  const isKillSwitchActive = Boolean(lifecycle?.killSwitchActive);
  const isCircuitTripped = lifecycle?.circuitBreakerState === 'TRIPPED';

  useEffect(() => {
    if (!lifecycle?.startedAt) {
      setElapsedSecs(0);
      return;
    }
    const startMs = Date.parse(lifecycle.startedAt);
    if (!Number.isFinite(startMs)) return;
    const tick = () => setElapsedSecs(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [lifecycle?.startedAt]);

  const pendingApprovals = useMemo(
    () => proposals.filter((p) => p.status === 'PENDING_APPROVAL'),
    [proposals]
  );

  const shadowProposals = useMemo(
    () => proposals.filter((p) => p.status === 'SHADOW_LOGGED'),
    [proposals]
  );

  const activeSoaks = useMemo(
    () => soaks.filter((s) => s.status === 'SOAKING'),
    [soaks]
  );

  const filteredProposals = useMemo(() => {
    return proposals.filter((p) => {
      const domainMatch = approvalDomainFilter === 'ALL' || p.domain === approvalDomainFilter;
      if (!domainMatch) return false;
      if (approvalStatusFilter === 'active') return p.status === 'PENDING_APPROVAL';
      if (approvalStatusFilter === 'shadow') {
        return (
          p.status === 'SHADOW_LOGGED' ||
          p.status === 'SHADOW_AGREED' ||
          p.status === 'SHADOW_DISAGREED'
        );
      }
      return (
        p.status !== 'PENDING_APPROVAL' &&
        p.status !== 'SHADOW_LOGGED'
      );
    });
  }, [proposals, approvalDomainFilter, approvalStatusFilter]);

  const handleRunSteadyStateSweep = async () => {
    if (!onEvaluateSteadyState) return;
    setIsEvaluatingSteady(true);
    setProbeFeedback(null);
    try {
      const msg = await onEvaluateSteadyState();
      setProbeFeedback({
        ok: true,
        text: typeof msg === 'string' && msg ? msg : 'Steady-state fleet & hygiene sweep completed.',
      });
    } catch (err) {
      setProbeFeedback({ ok: false, text: String(err) });
    } finally {
      setIsEvaluatingSteady(false);
    }
  };

  const handleStageBuildKitPrune = async () => {
    if (!onQueueBuildKitPruneProposal || isStagingPrune) return;
    setIsStagingPrune(true);
    setProbeFeedback(null);
    try {
      await onQueueBuildKitPruneProposal();
      setApprovalStatusFilter('active');
      setApprovalDomainFilter('ALL');
      setProbeFeedback({
        ok: true,
        text: 'Staged Local BuildKit Cache Prune (>72h) into Pending L3 Approvals.',
      });
    } catch (err) {
      setProbeFeedback({ ok: false, text: `Could not stage proposal: ${String(err)}` });
    } finally {
      setIsStagingPrune(false);
    }
  };

  const handleConfirmExecuteProposal = async (proposal: OttoProposalRow) => {
    setConfirmApproveProposal(null);
    setIsExecutingProposalId(proposal.id);
    setProbeFeedback(null);
    try {
      const updated = await onDecideProposal(proposal.id, 'APPROVE');
      if (updated && (updated.status === 'FAILED' || updated.status === 'BLOCKED')) {
        let detail = `Action '${proposal.actionId}' ended with status ${updated.status}.`;
        if (updated.verificationResultJson) {
          try {
            const parsed = JSON.parse(updated.verificationResultJson) as {
              verifyDetail?: string;
              reason?: string;
            };
            if (parsed.reason || parsed.verifyDetail) {
              detail = parsed.reason || parsed.verifyDetail || detail;
            }
          } catch {
            // keep default detail
          }
        }
        setProbeFeedback({ ok: false, text: detail });
      } else {
        setProbeFeedback({
          ok: true,
          text: `Executed & verified '${proposal.actionId}' on '${proposal.assetSlug}'.`,
        });
      }
    } catch (err) {
      setProbeFeedback({ ok: false, text: `Execution failed: ${String(err)}` });
    } finally {
      setIsExecutingProposalId(null);
    }
  };

  const handleRunLogDeltaProbe = async () => {
    setIsProbing(true);
    setProbeFeedback(null);
    try {
      const res = await invoke<OttoLogDeltaProbeResult>('run_otto_log_delta_probe');
      setProbeFeedback({ ok: res.ok, text: res.detail });
      await onRefreshOtto();
    } catch (err) {
      setProbeFeedback({ ok: false, text: String(err) });
    } finally {
      setIsProbing(false);
    }
  };

  const handlePolicyModeChange = async (actionId: string, nextMode: string) => {
    setPolicyError(null);
    try {
      await onUpdatePolicyMode(actionId, nextMode);
    } catch (err) {
      setPolicyError(String(err));
    }
  };

  return (
    <div className="p-6 max-w-[1920px] mx-auto w-full min-w-0 space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <OttoIcon className="w-10 h-10" state={runtimeState} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight truncate">
                Otto AI SRE
              </h1>
              <StatusBadge
                label={lifecycle?.phaseLabel || 'Otto: Idle · Shadow'}
                variant={
                  isKillSwitchActive || isCircuitTripped
                    ? 'danger'
                    : runtimeState === 'THINKING' ||
                      runtimeState === 'SENSING' ||
                      runtimeState === 'STAGE0_EVAL'
                    ? 'info'
                    : pendingApprovals.length > 0
                    ? 'warning'
                    : 'success'
                }
              />
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Semi-Autonomous AI SRE Control Plane — Conversational Investigation, Verbose Deep-Thinking Traces &amp; Compiled Policy-as-Code Guardrails
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {lifecycle?.canAbort && (
            <button
              type="button"
              onClick={() => void onAbortStep()}
              className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
            >
              <Square className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
              <span>Abort Active Step</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void onToggleKillSwitch(!isKillSwitchActive)}
            className={`${
              isKillSwitchActive ? 'btn-primary' : 'btn-danger'
            } text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0`}
          >
            {isKillSwitchActive ? (
              <>
                <PlayCircle className="w-3.5 h-3.5" />
                <span>Resume Otto</span>
              </>
            ) : (
              <>
                <PauseCircle className="w-3.5 h-3.5" />
                <span>Global Kill-Switch</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => void onRefreshOtto()}
            className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Persistent Live State & Safety Telemetry Strip */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* 6-Stage FSM Stepper */}
          <div className="flex flex-wrap items-center gap-1.5">
            {FSM_STEPS.map((step) => {
              const isCurrent = runtimeState === step.key;
              return (
                <span
                  key={step.key}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold border transition-colors ${
                    isCurrent
                      ? 'bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)] border-[var(--color-brand-ring)] animate-pulse'
                      : 'bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  {step.label}
                </span>
              );
            })}
            {elapsedSecs > 0 && (
              <span className="ml-1 text-[11px] font-mono font-bold tabular-nums text-[var(--color-accent-text)]">
                {elapsedSecs}s
              </span>
            )}
          </div>

          {/* Live Budgets & Suricata Gatekeeper Status */}
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400">
            <span>
              AI Today:{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                T1 {lifecycle?.dailyT1Calls ?? 0} · T2 {lifecycle?.dailyT2Calls ?? 0}/
                {status?.dailyT2Cap ?? 6}
              </strong>
            </span>
            <span>
              Suricata SSH:{' '}
              <strong className="text-emerald-700 dark:text-emerald-400">
                {status?.suricata.usedLast120s ?? 0}/{status?.suricata.maxPer120s ?? 2} SYNs (120s)
              </strong>
            </span>
            <span>
              Breaker:{' '}
              <strong
                className={
                  isCircuitTripped
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }
              >
                {lifecycle?.circuitBreakerState || 'CLOSED'}
              </strong>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
          <span className="text-slate-600 dark:text-slate-300">
            <strong className="text-slate-900 dark:text-slate-100">Current Status:</strong>{' '}
            {lifecycle?.summary || 'Standing watch in Shadow / Observe mode'}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {lifecycle?.traceRunId && (
              <button
                type="button"
                onClick={() => setInspectedTraceId(lifecycle.traceRunId!)}
                className="btn-ghost text-xs py-1 px-2.5 flex items-center gap-1 whitespace-nowrap flex-shrink-0"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Inspect Latest Trace</span>
              </button>
            )}
            {onEvaluateSteadyState && (
              <button
                type="button"
                disabled={isEvaluatingSteady}
                onClick={() => void handleRunSteadyStateSweep()}
                className="btn-tonal text-xs py-1 px-2.5 flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                title="Evaluate fleet health, BuildKit cache threshold (>=35 GB / >=100 GB), and SSL expiry (<21d) under active policy"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isEvaluatingSteady ? 'Evaluating...' : 'Sweep Health & Hygiene'}</span>
              </button>
            )}
            <button
              type="button"
              disabled={isProbing}
              onClick={() => void handleRunLogDeltaProbe()}
              className="btn-secondary text-xs py-1 px-2.5 flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              title="Run single-SYN read-only log delta probe via sre-agent-wsh forced-command key"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>{isProbing ? 'Probing WSH...' : 'Run Log Delta Probe'}</span>
            </button>
          </div>
        </div>

        {probeFeedback && (
          <div
            className={`text-xs font-mono px-3 py-2 rounded-xl border ${
              probeFeedback.ok
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                : 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30'
            }`}
          >
            {probeFeedback.text}
          </div>
        )}
      </div>

      {/* Sub-View Switcher (Single-Row Flat IA v2.0 Standard) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<OttoSubView>
          activeVariant="brand"
          size="md"
          value={subView}
          onChange={setSubView}
          options={[
            {
              value: 'ask',
              label: 'Ask Otto',
              icon: <MessageSquare className="w-3.5 h-3.5" />,
            },
            {
              value: 'traces',
              label: `Traces & Activity (${traces.length})`,
              icon: <Activity className="w-3.5 h-3.5" />,
            },
            {
              value: 'approvals',
              label: `Approval Queue (${pendingApprovals.length})`,
              icon: <ShieldAlert className="w-3.5 h-3.5" />,
            },
            {
              value: 'policies',
              label: 'Policy Matrix & Guardrails',
              icon: <Sliders className="w-3.5 h-3.5" />,
            },
          ]}
        />
      </div>

      {/* Sub-View 1: Ask Otto Free-Form Conversational SRE */}
      {subView === 'ask' && (
        <AskOttoPanel
          apps={apps}
          runtimeState={runtimeState}
          geminiConfigured={Boolean(status?.geminiConfigured)}
          pendingContextSeed={pendingContextSeed}
          pendingContextNonce={pendingContextNonce}
          onConsumeContextSeed={onConsumeContextSeed}
          proposals={proposals}
          onRefreshOtto={onRefreshOtto}
          onInspectTrace={(id) => setInspectedTraceId(id)}
          onDecideProposal={onDecideProposal}
          onAbortStep={onAbortStep}
          onNavigateToSettings={onNavigateToSettings}
        />
      )}

      {/* Sub-View 2: Verbose Traces, Active 15m Post-Deploy Soaks & Shadow Mode Graduation */}
      {subView === 'traces' && (
        <div className="space-y-5">
          {/* Active & Recent 15m Post-Deploy Soak Sessions */}
          {soaks.length > 0 && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-sky-500" />
                    <span>Post-Deployment 15m Soak Sessions ({activeSoaks.length} Active)</span>
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Automatic 15-minute post-deploy stability windows enforcing DB-Safe N-3 rollback guards, Tier-0 protection, and multi-app cascade suppression.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {soaks.slice(0, 8).map((sk) => {
                  const samples = safeParseSamples(sk.samplesJson);
                  const healthyCount = samples.filter((s) => s.healthy).length;
                  const minsLeft = Math.max(0, Math.ceil((Date.parse(sk.endsAt) - Date.now()) / 60000));
                  return (
                    <div
                      key={sk.id}
                      className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge
                            label={sk.status === 'SOAKING' ? `SOAKING (${minsLeft}m left)` : sk.status}
                            variant={
                              sk.status === 'SOAKING'
                                ? 'info'
                                : sk.status === 'HEALTHY_VERIFIED'
                                ? 'success'
                                : sk.status === 'ESCALATED_L3' || sk.status === 'ROLLED_BACK'
                                ? 'danger'
                                : 'warning'
                            }
                          />
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            {sk.appSlug}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            {sk.releaseId} ({sk.hostingTarget})
                          </span>
                          {sk.hasDbMigration ? (
                            <BlastRadiusBadge badge="DB_MIGRATION" />
                          ) : (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                              DB-Safe N-3 Eligible
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                          Samples: {healthyCount}/{samples.length} healthy
                          {sk.previousImageTag ? ` · prev tag: ${sk.previousImageTag}` : ' · no prev tag'}
                          {' · '}started {formatRelativeTime(sk.startedAt)}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {sk.traceRunId && (
                          <button
                            type="button"
                            onClick={() => setInspectedTraceId(sk.traceRunId!)}
                            className="btn-ghost text-xs py-1 px-2.5 flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Trace</span>
                          </button>
                        )}
                        {sk.status === 'SOAKING' && onCancelSoak && (
                          <button
                            type="button"
                            onClick={() => void onCancelSoak(sk.id)}
                            className="btn-secondary text-xs py-1 px-2.5 flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Cancel Soak</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Shadow Mode Graduation Feedback Strip */}
          {shadowProposals.length > 0 && (
            <div className="rounded-2xl border border-amber-500/40 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-500" />
                  <span>Shadow Mode Dry-Run Decisions ({shadowProposals.length} Pending Feedback)</span>
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Rate Otto&apos;s dry-run decisions with Agree (+1) or Disagree to track graduation precision (&ge;90% across &ge;10 runs recommended before promoting any rule to L2 Auto).
                </p>
              </div>
              <div className="space-y-2">
                {shadowProposals.slice(0, 6).map((sp) => (
                  <div
                    key={sp.id}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge label="SHADOW_LOGGED" variant="info" />
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                          {sp.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400">
                        {sp.rcaSummary}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void onDecideProposal(sp.id, 'SHADOW_AGREE')}
                        className="btn-primary text-xs py-1 px-2.5 flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                      >
                        <ThumbsUp className="w-3.5 h-3.5" />
                        <span>Agree (+1)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDecideProposal(sp.id, 'SHADOW_DISAGREE')}
                        className="btn-secondary text-xs py-1 px-2.5 flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                      >
                        <ThumbsDown className="w-3.5 h-3.5" />
                        <span>Disagree</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Verbose Execution Traces Ledger */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <BrainCircuit className="w-4 h-4 text-[var(--color-accent-text)]" />
                  <span>Verbose Execution Traces &amp; Deep-Thinking Audit Ledger</span>
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Every Ask Otto turn, soak evaluation, Policy Kernel decision, and compiled execution writes an immutable scrubbed trace retained for 30 days.
                </p>
              </div>
            </div>

            {traces.length === 0 ? (
              <div className="p-8 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
                No Otto traces recorded yet. Start a conversation in <strong>Ask Otto</strong> or run a steady-state sweep to inspect full step-by-step traces.
              </div>
            ) : (
              <div className="space-y-2.5">
                {traces.map((t) => (
                  <div
                    key={t.id}
                    className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          label={t.finalState}
                          variant={
                            t.finalState === 'COMPLETED'
                              ? 'success'
                              : t.finalState === 'FAILED'
                              ? 'danger'
                              : 'warning'
                          }
                        />
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                          {t.triggerKind} · {t.domain}
                        </span>
                        {t.modelUsed && (
                          <span className="text-[11px] font-mono text-[var(--color-accent-text)] font-semibold">
                            {t.modelUsed} ({t.thinkingLevel || 'auto'})
                          </span>
                        )}
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {t.outcomeSummary}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                        <span>{t.id}</span>
                        <span>
                          Tokens: {t.inputTokens} in / {t.outputTokens} out /{' '}
                          <strong className="text-[var(--color-accent-text)]">
                            {t.thoughtTokens} thought
                          </strong>
                        </span>
                        <span>{(t.durationMs / 1000).toFixed(2)}s</span>
                        <span title={formatLocalDateTime(t.startedAt)}>
                          {formatRelativeTime(t.startedAt)}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setInspectedTraceId(t.id)}
                      className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Inspect Trace &amp; Thinking</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sub-View 3: Full Phase 2 Approval Queue & Shadow Proposal Ledger */}
      {subView === 'approvals' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Desktop Approval Queue &amp; Shadow Proposal Ledger
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Every proposal is re-validated by the compiled Rust Policy Kernel at click time. Approved Phase 2 actions execute cleanly in the Unified Console Dock (Tier A) with Post-Action Outcome Verification.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {onQueueBuildKitPruneProposal && (
                <button
                  type="button"
                  disabled={isStagingPrune}
                  onClick={() => void handleStageBuildKitPrune()}
                  className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 disabled:opacity-50"
                  title="Stage a safe, non-destructive local BuildKit cache prune (>72h layers) into the L3 Approval Queue"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isStagingPrune ? 'Staging...' : 'Stage Local BuildKit Prune (L3)'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Filters: Status Tabs + Domain Chips */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'active', label: `Pending L3 (${pendingApprovals.length})` },
                  { id: 'shadow', label: `Shadow Dry-Runs (${shadowProposals.length})` },
                  { id: 'history', label: 'Executed & History' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setApprovalStatusFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold border transition-colors cursor-pointer ${
                    approvalStatusFilter === tab.id
                      ? 'bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)] border-[var(--color-brand-ring)]'
                      : 'bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(['ALL', 'HEAL', 'DEFENSE', 'UPGRADE', 'BUG_DIAGNOSTIC'] as const).map((dom) => (
                <button
                  key={dom}
                  type="button"
                  onClick={() => setApprovalDomainFilter(dom)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border cursor-pointer ${
                    approvalDomainFilter === dom
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100 font-bold'
                      : 'bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  {dom}
                </button>
              ))}
            </div>
          </div>

          {filteredProposals.length === 0 ? (
            <div className="p-8 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
              No proposals match this filter. Proposals generated during <strong>Ask Otto</strong>, 15m soak monitoring, or steady-state sweeps appear here with blast-radius flags and Deep-Thinking links.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredProposals.map((p) => {
                const flags = safeParseStringArray(p.blastRadiusFlagsJson);
                const isExpanded = Boolean(expandedProposalIds[p.id]);
                const isExecutingThis = isExecutingProposalId === p.id;
                return (
                  <div
                    key={p.id}
                    className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge
                            label={p.status}
                            variant={
                              p.status === 'PENDING_APPROVAL'
                                ? 'warning'
                                : p.status === 'VERIFIED' ||
                                  p.status === 'ROLLED_BACK' ||
                                  p.status.includes('APPROVED') ||
                                  p.status === 'SHADOW_AGREED'
                                ? 'success'
                                : p.status === 'REJECTED' ||
                                  p.status === 'FAILED' ||
                                  p.status === 'BLOCKED'
                                ? 'danger'
                                : 'info'
                            }
                          />
                          <StatusBadge label={p.domain} variant="neutral" />
                          <StatusBadge label={p.classification} variant="accent" />
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            {p.title}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                          action: {p.actionId} · target: {p.assetSlug} ({p.assetTier}) · confidence:{' '}
                          {Math.round(p.confidence * 100)}% · {formatRelativeTime(p.createdAt)}
                        </div>
                        {flags.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            {flags.map((flag) => (
                              <BlastRadiusBadge key={flag} badge={flag} />
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {p.traceRunId && (
                          <button
                            type="button"
                            onClick={() => setInspectedTraceId(p.traceRunId!)}
                            className="btn-ghost text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Trace</span>
                          </button>
                        )}
                        {onAskOtto && (
                          <button
                            type="button"
                            onClick={() =>
                              onAskOtto({
                                kind: 'app_release',
                                entityId: p.id,
                                originView: 'agent',
                                title: `Proposal: ${p.title}`,
                                severity: p.severity,
                                summary: `Action ${p.actionId} targeting ${p.assetSlug} (${p.assetTier}): ${p.rcaSummary}`,
                                metadata: { actionId: p.actionId, assetSlug: p.assetSlug, status: p.status },
                                starterPrompts: [
                                  `Explain the blast radius and rollback plan for proposal "${p.title}".`,
                                  `Should I approve or reject "${p.actionId}" on ${p.assetSlug}?`,
                                ],
                              })
                            }
                            className="btn-tonal text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                          >
                            <OttoIcon className="w-3.5 h-3.5" />
                            <span>Ask Otto</span>
                          </button>
                        )}
                        {p.status === 'SHADOW_LOGGED' && (
                          <>
                            <button
                              type="button"
                              onClick={() => void onDecideProposal(p.id, 'SHADOW_AGREE')}
                              className="btn-primary text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                            >
                              <ThumbsUp className="w-3.5 h-3.5" />
                              <span>Agree (+1)</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void onDecideProposal(p.id, 'SHADOW_DISAGREE')}
                              className="btn-secondary text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                            >
                              <ThumbsDown className="w-3.5 h-3.5" />
                              <span>Disagree</span>
                            </button>
                          </>
                        )}
                        {p.status === 'PENDING_APPROVAL' && (
                          <>
                            <button
                              type="button"
                              disabled={isExecutingThis}
                              onClick={() => setConfirmApproveProposal(p)}
                              className="btn-primary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>{isExecutingThis ? 'Executing...' : 'Approve & Execute'}</span>
                            </button>
                            <button
                              type="button"
                              disabled={isExecutingThis}
                              onClick={() => void onDecideProposal(p.id, 'SNOOZE_24H')}
                              className="btn-secondary text-xs whitespace-nowrap flex-shrink-0"
                            >
                              Snooze 24h
                            </button>
                            <button
                              type="button"
                              disabled={isExecutingThis}
                              onClick={() => void onDecideProposal(p.id, 'REJECT')}
                              className="btn-danger text-xs whitespace-nowrap flex-shrink-0"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {p.rcaSummary && (
                      <p className="text-xs text-slate-700 dark:text-slate-300">{p.rcaSummary}</p>
                    )}

                    {/* Expandable Scrubbed Params, Evidence & Verification Outcome */}
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedProposalIds((prev) => ({ ...prev, [p.id]: !prev[p.id] }))
                        }
                        className="text-[11px] font-mono text-slate-500 hover:text-[var(--color-brand-text)] inline-flex items-center gap-1 cursor-pointer"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {isExpanded ? 'Hide Parameters & Verification' : 'Inspect Parameters, Rollback Vector & Verification'}
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                          <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#050b14] border border-slate-200/90 dark:border-slate-800 text-emerald-900 dark:text-emerald-400 font-mono text-[11px] overflow-x-auto">
                            <div className="text-[10px] uppercase text-slate-500 mb-1">
                              Compiled Parameters
                            </div>
                            <pre className="whitespace-pre-wrap break-all">{p.paramsJson}</pre>
                          </div>
                          <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#050b14] border border-slate-200/90 dark:border-slate-800 text-emerald-900 dark:text-emerald-400 font-mono text-[11px] overflow-x-auto">
                            <div className="text-[10px] uppercase text-slate-500 mb-1">
                              {p.verificationResultJson ? 'Post-Action Verification Result' : 'Rollback / Policy Vector'}
                            </div>
                            <pre className="whitespace-pre-wrap break-all">
                              {p.verificationResultJson || p.rollbackPlanJson || '{}'}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Sub-View 4: Policy Matrix, Circuit Breaker & Compile-Time L4 Hard-Blocked Invariants */}
      {subView === 'policies' && (
        <div className="space-y-5">
          {policyError && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-500/40 text-xs text-rose-700 dark:text-rose-300">
              {policyError}
            </div>
          )}

          {/* Circuit Breaker & Settings Boundary Card */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <AlertOctagon
                    className={`w-4 h-4 ${
                      isCircuitTripped ? 'text-rose-500' : 'text-emerald-500'
                    }`}
                  />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Autonomous Circuit Breaker
                  </h3>
                  <StatusBadge
                    label={lifecycle?.circuitBreakerState || 'CLOSED'}
                    variant={isCircuitTripped ? 'danger' : 'success'}
                  />
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Auto-trips after 2 consecutive autonomous failures, freezing L2 execution until manually inspected and reset.
                </p>
              </div>
              {isCircuitTripped && (
                <button
                  type="button"
                  onClick={() => void onResetCircuitBreaker()}
                  className="btn-primary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Breaker</span>
                </button>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-[var(--color-brand-text)]" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Credentials, AI Budgets &amp; Gatekeeper Key
                  </h3>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Gemini DPAPI keys, daily Tier-2 caps, Pushover routing, and <code className="font-mono">sre-agent-wsh</code> connector diagnostics live in Settings.
                </p>
              </div>
              {onNavigateToSettings && (
                <button
                  type="button"
                  onClick={onNavigateToSettings}
                  className="btn-secondary text-xs whitespace-nowrap flex-shrink-0"
                >
                  Open Settings →
                </button>
              )}
            </div>
          </div>

          {/* Per-Action Policy Matrix (Clamped to Compile-Time Ceiling) */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Compiled Action Broker Policy Matrix ({policies.length} Actions)
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Every action is hard-clamped by its Rust compile-time ceiling. Production deployments and APT upgrades can never exceed L3 Desktop Approval.
              </p>
            </div>

            <div className="space-y-2.5">
              {policies.map((pol) => (
                <div
                  key={pol.actionId}
                  className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        {pol.label}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-[10px] text-slate-600 dark:text-slate-300">
                        {pol.domain} · {pol.assetTier}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                        Ceiling: {pol.maxAllowedMode} · Cooldown: {Math.round(pol.cooldownSecs / 60)}m
                      </span>
                      {pol.shadowRunsCount > 0 && (() => {
                        const pct = Math.round((pol.shadowAgreedCount / pol.shadowRunsCount) * 100);
                        const ready = pol.shadowRunsCount >= 10 && pct >= 90;
                        return (
                          <span
                            className={`text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded border ${
                              ready
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35 font-bold'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            Shadow: {pol.shadowAgreedCount}/{pol.shadowRunsCount} ({pct}%){ready ? ' · Ready for L2' : ''}
                          </span>
                        );
                      })()}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">{pol.description}</p>
                  </div>

                  <div className="w-full sm:w-52 shrink-0">
                    <CustomSelect
                      value={pol.mode}
                      onChange={(val) => void handlePolicyModeChange(pol.actionId, val)}
                      options={allowedOptionsForPolicy(pol.maxAllowedMode)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Compile-Time Immutable L4 Hard-Blocked Invariants */}
          <div className="rounded-2xl border border-rose-500/40 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Compile-Time Immutable L4 Hard-Blocked Invariants ({l4Invariants.length})
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Compiled directly into Rust (<code className="font-mono">otto_policy.rs</code>). Cannot be overridden by UI toggles, SQLite edits, or LLM prompts.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {l4Invariants.map((inv) => (
                <div
                  key={inv.id}
                  className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-rose-700 dark:text-rose-400 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>{inv.id}</span>
                    </span>
                    <StatusBadge label={inv.category} variant="danger" />
                  </div>
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    {inv.title}
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    {inv.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Verbose Trace & Deep-Thinking Slide-Over Inspector */}
      <OttoTraceInspectorDrawer
        traceRunId={inspectedTraceId}
        isOpen={Boolean(inspectedTraceId)}
        onClose={() => setInspectedTraceId(null)}
      />

      {/* L3 Desktop Approval Confirmation Modal (Solid Surface + Policy Re-Validation) */}
      <ConfirmDangerModal
        isOpen={Boolean(confirmApproveProposal)}
        title={
          confirmApproveProposal
            ? `Approve & Execute: ${confirmApproveProposal.title}`
            : 'Approve L3 Action'
        }
        description={
          confirmApproveProposal
            ? `Otto will re-validate "${confirmApproveProposal.actionId}" targeting "${confirmApproveProposal.assetSlug}" (${confirmApproveProposal.assetTier}) through the compiled Rust Policy Kernel, stream live output in Tier A Console Dock, and run Post-Action Outcome Verification.\n\nSummary: ${confirmApproveProposal.rcaSummary || confirmApproveProposal.title}`
            : ''
        }
        confirmWord={
          confirmApproveProposal?.assetTier === 'TIER0_CRITICAL' ? 'CONFIRM' : undefined
        }
        confirmLabel="Approve & Execute"
        onCancel={() => setConfirmApproveProposal(null)}
        onConfirm={() => {
          if (confirmApproveProposal) {
            void handleConfirmExecuteProposal(confirmApproveProposal);
          }
        }}
      />
    </div>
  );
};
