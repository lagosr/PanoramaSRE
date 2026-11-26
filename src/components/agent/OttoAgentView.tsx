import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SegmentedControl, StatusBadge } from '@lagosr/panorama-ui-kit';
import {
  Activity,
  AlertOctagon,
  BrainCircuit,
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
  Square,
  Terminal,
} from 'lucide-react';
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
  onDecideProposal: (proposalId: string, decision: string) => Promise<void>;
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

export const OttoAgentView: React.FC<OttoAgentViewProps> = ({
  apps,
  status,
  policies,
  l4Invariants,
  traces,
  proposals,
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
  onNavigateToSettings,
}) => {
  const [subView, setSubView] = useState<OttoSubView>(initialSubView);
  const [inspectedTraceId, setInspectedTraceId] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [probeFeedback, setProbeFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [elapsedSecs, setElapsedSecs] = useState<number>(0);

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

      {/* Sub-View 2: Verbose Traces & Deep-Thinking Activity Log */}
      {subView === 'traces' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <BrainCircuit className="w-4 h-4 text-[var(--color-accent-text)]" />
                <span>Verbose Execution Traces &amp; Deep-Thinking Audit Ledger</span>
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Every Ask Otto turn, Policy Kernel evaluation, and probe writes an immutable scrubbed trace retained for 30 days.
              </p>
            </div>
          </div>

          {traces.length === 0 ? (
            <div className="p-8 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
              No Otto traces recorded yet. Start a conversation in <strong>Ask Otto</strong> to inspect full step-by-step Deep-Thinking rundowns.
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
      )}

      {/* Sub-View 3: Approval Queue & Shadow Proposals */}
      {subView === 'approvals' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Desktop Approval Queue &amp; Shadow Proposal Ledger
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              All proposals pass through the compiled Rust Policy-as-Code Kernel first. Phase 1 operates in safe Shadow / Dry-Run audit mode; live L2/L3 execution unlocks in Phases 2–3.
            </p>
          </div>

          {proposals.length === 0 ? (
            <div className="p-8 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
              No proposals queued yet. Proposals generated during <strong>Ask Otto</strong> triage will appear here with blast-radius flags and Deep-Thinking links.
            </div>
          ) : (
            <div className="space-y-3">
              {proposals.map((p) => (
                <div
                  key={p.id}
                  className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          label={p.status}
                          variant={
                            p.status === 'PENDING_APPROVAL'
                              ? 'warning'
                              : p.status.includes('APPROVED') || p.status === 'SHADOW_AGREED'
                              ? 'success'
                              : p.status === 'REJECTED'
                              ? 'danger'
                              : 'info'
                          }
                        />
                        <StatusBadge label={p.classification} variant="accent" />
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                          {p.title}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                        action: {p.actionId} · target: {p.assetSlug} ({p.assetTier}) · confidence:{' '}
                        {Math.round(p.confidence * 100)}% · {formatRelativeTime(p.createdAt)}
                      </div>
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
                      {p.status === 'SHADOW_LOGGED' && (
                        <>
                          <button
                            type="button"
                            onClick={() => void onDecideProposal(p.id, 'SHADOW_AGREE')}
                            className="btn-primary text-xs whitespace-nowrap flex-shrink-0"
                          >
                            Agree (Shadow)
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDecideProposal(p.id, 'SHADOW_DISAGREE')}
                            className="btn-secondary text-xs whitespace-nowrap flex-shrink-0"
                          >
                            Disagree
                          </button>
                        </>
                      )}
                      {p.status === 'PENDING_APPROVAL' && (
                        <>
                          <button
                            type="button"
                            onClick={() => void onDecideProposal(p.id, 'APPROVE')}
                            className="btn-primary text-xs whitespace-nowrap flex-shrink-0"
                          >
                            Approve (Dry-Run)
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDecideProposal(p.id, 'SNOOZE_24H')}
                            className="btn-secondary text-xs whitespace-nowrap flex-shrink-0"
                          >
                            Snooze 24h
                          </button>
                          <button
                            type="button"
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
                </div>
              ))}
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
                      {pol.shadowRunsCount > 0 && (
                        <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 tabular-nums">
                          Shadow agreement: {pol.shadowAgreedCount}/{pol.shadowRunsCount}
                        </span>
                      )}
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
    </div>
  );
};
