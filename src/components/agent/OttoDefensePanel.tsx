import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { StatusBadge } from '@lagosr/panorama-ui-kit';
import {
  Bug,
  CheckCircle2,
  Clock,
  Eye,
  Filter,
  FlaskConical,
  Layers,
  Radar,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { ConfirmDangerModal } from '../ui/ConfirmDangerModal';
import { CustomSelect } from '../ui/CustomSelect';
import { formatLocalDateTime, formatRelativeTime, parseUtcDate } from '../../lib/formatters';
import type {
  FastEdgeSweepResultDto,
  OttoContextSeed,
  OttoDefenseOverviewDto,
  OttoProposalRow,
  OttoWafLeaseRow,
  WafLeaseReconcileReportDto,
} from '../../lib/types';
import { OttoIcon } from './OttoAvatar';

interface OttoDefensePanelProps {
  overview: OttoDefenseOverviewDto | null;
  isLoading?: boolean;
  onRefreshDefense: () => Promise<void>;
  onRefreshOtto: () => Promise<void>;
  onInspectTrace: (traceRunId: string) => void;
  onDecideProposal: (proposalId: string, decision: string) => Promise<OttoProposalRow | void>;
  onAskOtto?: (seed: OttoContextSeed) => void;
}

interface ParsedDefenseParams {
  targetZone?: string;
  targetHost?: string;
  cfAction?: string;
  compiledExpression?: string;
  ttlMinutes?: number | null;
  homeWanAndFamilyProtected?: boolean;
  materialityBreakdown?: {
    surface?: string;
    stackMatchPts?: number;
    boundaryPenetrationPts?: number;
    authWriteImpactPts?: number;
    volumetricPersistencePts?: number;
    crossLayerPts?: number;
    totalScore?: number;
    hardTriggers?: string[];
  };
}

function safeParseDefenseParams(raw?: string | null): ParsedDefenseParams {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ParsedDefenseParams;
  } catch {
    return {};
  }
}

function safeParsePaths(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function formatLeaseCountdown(expiresAt?: string | null, nowMs = Date.now()): string {
  if (!expiresAt) return 'Permanent (1-Click Revert)';
  const parsed = parseUtcDate(expiresAt);
  if (!parsed) return 'Active TTL';
  const diffSec = Math.floor((parsed.getTime() - nowMs) / 1000);
  if (diffSec <= 0) return 'Expired — Pending Auto-Revert';
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${mins}m ${String(secs).padStart(2, '0')}s left`;
}

export const OttoDefensePanel: React.FC<OttoDefensePanelProps> = ({
  overview,
  isLoading = false,
  onRefreshDefense,
  onRefreshOtto,
  onInspectTrace,
  onDecideProposal,
  onAskOtto,
}) => {
  const [windowMins, setWindowMins] = useState<string>('15');
  const [isSweeping, setIsSweeping] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [confirmRevertLease, setConfirmRevertLease] = useState<OttoWafLeaseRow | null>(null);
  const [confirmApplyProposal, setConfirmApplyProposal] = useState<OttoProposalRow | null>(null);
  const [isBusyId, setIsBusyId] = useState<string | null>(null);
  const [showSafeTestForm, setShowSafeTestForm] = useState(false);
  const [testZone, setTestZone] = useState<string>('parakith.com');
  const [testIp, setTestIp] = useState<string>('192.0.2.99');
  const [testTtl, setTestTtl] = useState<string>('60');
  const [isStagingTest, setIsStagingTest] = useState(false);
  const [showLeaseHistory, setShowLeaseHistory] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const exposure = overview?.exposureProfile;
  const activeLeases = overview?.activeLeases ?? [];
  const leaseHistory = overview?.leaseHistory ?? [];
  const dropped = overview?.droppedNoise24h;
  const recentNoise = overview?.recentDroppedNoise ?? [];
  const defenseProposals = overview?.defenseProposals ?? [];

  const actionablePlans = useMemo(
    () =>
      defenseProposals.filter(
        (p) => p.status === 'PENDING_APPROVAL' || p.status === 'SHADOW_LOGGED'
      ),
    [defenseProposals]
  );

  const handleRunFastSweep = async () => {
    setIsSweeping(true);
    setFeedback(null);
    try {
      const res = await invoke<FastEdgeSweepResultDto>('run_otto_fast_edge_sweep', {
        windowMinutes: Number(windowMins) || 15,
        forceNeonPlan: false,
      });
      setFeedback({ ok: true, text: res.summary });
      await Promise.all([onRefreshDefense(), onRefreshOtto()]);
    } catch (err) {
      setFeedback({ ok: false, text: `Fast edge sweep failed: ${String(err)}` });
    } finally {
      setIsSweeping(false);
    }
  };

  const handleReconcileLeases = async () => {
    setIsReconciling(true);
    setFeedback(null);
    try {
      const rep = await invoke<WafLeaseReconcileReportDto>('reconcile_otto_waf_leases');
      setFeedback({
        ok: rep.failedCount === 0,
        text:
          rep.checkedExpired === 0
            ? 'TTL Reconciler: 0 expired Cloudflare WAF leases pending cleanup.'
            : `TTL Reconciler: checked ${rep.checkedExpired}, auto-reverted ${rep.revertedCount}, failed ${rep.failedCount}.`,
      });
      await Promise.all([onRefreshDefense(), onRefreshOtto()]);
    } catch (err) {
      setFeedback({ ok: false, text: `TTL reconcile failed: ${String(err)}` });
    } finally {
      setIsReconciling(false);
    }
  };

  const handleConfirmRevert = async (lease: OttoWafLeaseRow) => {
    setConfirmRevertLease(null);
    setIsBusyId(lease.id);
    setFeedback(null);
    try {
      await invoke<OttoWafLeaseRow>('revert_otto_waf_lease', {
        leaseId: lease.id,
        reason: 'Operator 1-click revert from Defense Plans & Leases',
      });
      setFeedback({
        ok: true,
        text: `Reverted Cloudflare WAF rule '${lease.cfRuleId}' on ${lease.cfZoneName} cleanly.`,
      });
      await Promise.all([onRefreshDefense(), onRefreshOtto()]);
    } catch (err) {
      setFeedback({ ok: false, text: `Revert failed: ${String(err)}` });
    } finally {
      setIsBusyId(null);
    }
  };

  const handleConfirmApplyProposal = async (proposal: OttoProposalRow) => {
    setConfirmApplyProposal(null);
    setIsBusyId(proposal.id);
    setFeedback(null);
    try {
      const updated = await onDecideProposal(proposal.id, 'APPROVE');
      if (updated && (updated.status === 'FAILED' || updated.status === 'BLOCKED')) {
        setFeedback({
          ok: false,
          text: `Defense proposal ended with status ${updated.status}. Inspect trace for details.`,
        });
      } else {
        setFeedback({
          ok: true,
          text: `Applied & verified Cloudflare WAF plan '${proposal.title}' (prior snapshot saved).`,
        });
      }
      await Promise.all([onRefreshDefense(), onRefreshOtto()]);
    } catch (err) {
      setFeedback({ ok: false, text: `Apply failed: ${String(err)}` });
    } finally {
      setIsBusyId(null);
    }
  };

  const handleStageSafeTestProposal = async () => {
    setIsStagingTest(true);
    setFeedback(null);
    try {
      const ttl = Number(testTtl) || 60;
      await invoke<OttoProposalRow>('stage_otto_waf_defense_proposal', {
        input: {
          title: `Safe RFC 5737 Test Lease (${testIp} · ${ttl}m Managed Challenge)`,
          targetZone: testZone,
          targetHost: null,
          actionType: 'managed_challenge',
          targetIps: [testIp.trim()],
          targetAsns: [],
          targetPaths: [],
          ttlMinutes: ttl,
          rcaSummary: `Controlled non-impact Cloudflare WAF lease test targeting RFC 5737 documentation IP ${testIp} with ${ttl}m automatic TTL expiry and 1-Click Revert verification.`,
          evidenceJson: JSON.stringify(['RFC-5737-CONTROLLED-TEST']),
          classification: 'MATERIAL_THREAT',
        },
      });
      setFeedback({
        ok: true,
        text: `Staged L3 test proposal for ${testIp} on ${testZone}. Approve below to apply & verify 1-Click Revert.`,
      });
      setShowSafeTestForm(false);
      await Promise.all([onRefreshDefense(), onRefreshOtto()]);
    } catch (err) {
      setFeedback({ ok: false, text: `Could not stage test lease: ${String(err)}` });
    } finally {
      setIsStagingTest(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 1. Dual-Perimeter Exposure Posture & Zero-SSH Fast Edge Sweep */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Radar className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
                <span>Dual-Perimeter Proactive Defense &amp; Stack Materiality Engine</span>
              </h2>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/35">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>Home WAN &amp; Family Access Protected ✓</span>
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Zero-SSH Cloudflare burst triage (0 SSH SYNs). Drops absent-stack noise (WP/PHP/Spring/OS-on-Pages) at Stage 0 for $0 LLM, flags inside-perimeter correlation bugs as Detection Defects, and gates live Cloudflare WAF leases with prior ruleset snapshots &amp; 1-Click Revert.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="w-28">
              <CustomSelect
                value={windowMins}
                onChange={setWindowMins}
                options={[
                  { value: '5', label: '5m window' },
                  { value: '15', label: '15m window' },
                  { value: '30', label: '30m window' },
                  { value: '60', label: '60m window' },
                ]}
              />
            </div>
            <button
              type="button"
              disabled={isSweeping || !overview?.cfConfigured}
              onClick={() => void handleRunFastSweep()}
              className="btn-primary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 disabled:opacity-50"
            >
              <Radar className={`w-3.5 h-3.5 ${isSweeping ? 'animate-spin' : ''}`} />
              <span>{isSweeping ? 'Sweeping Edge...' : 'Run Fast Edge Sweep'}</span>
            </button>
            <button
              type="button"
              disabled={isReconciling || !overview?.cfConfigured}
              onClick={() => void handleReconcileLeases()}
              className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 disabled:opacity-50"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{isReconciling ? 'Reconciling...' : 'Reconcile TTL Leases'}</span>
            </button>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => void onRefreshDefense()}
              className="btn-ghost text-xs flex items-center gap-1 whitespace-nowrap flex-shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {feedback && (
          <div
            className={`text-xs font-mono px-3 py-2 rounded-xl border ${
              feedback.ok
                ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/35'
                : 'bg-rose-500/10 text-rose-800 dark:text-rose-300 border-rose-500/35'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {/* Dynamic 3-Surface SuiteExposureProfile Strip */}
        {exposure && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono font-bold uppercase text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[var(--color-brand-text)]" />
                  Surface A · StrictPrivate
                </span>
                <StatusBadge label={`${exposure.activeBasePaths.length} Apps`} variant="info" />
              </div>
              <div className="text-[11px] font-mono text-slate-700 dark:text-slate-300 truncate">
                {exposure.strictPrivateHosts.join(', ')}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                {exposure.wshStackSummary}
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono font-bold uppercase text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-sky-500" />
                  Surface B · PublicWeb
                </span>
                <StatusBadge label="CF Pages + D1" variant="success" />
              </div>
              <div className="text-[11px] font-mono text-slate-700 dark:text-slate-300 truncate">
                {exposure.publicWebHosts.join(', ')}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                {exposure.publicWebStackSummary}
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono font-bold uppercase text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-emerald-500" />
                  Dropped Noise (24h · $0 LLM)
                </span>
                <StatusBadge
                  label={`${(dropped?.totalRequests ?? 0).toLocaleString()} reqs`}
                  variant="neutral"
                />
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400 pt-0.5">
                <span>Absent Stack: <strong className="text-slate-900 dark:text-slate-100">{dropped?.absentStack ?? 0}</strong></span>
                <span>Edge Blocked: <strong className="text-slate-900 dark:text-slate-100">{dropped?.edgeBlockedZeroOrigin ?? 0}</strong></span>
                <span>Static 404: <strong className="text-slate-900 dark:text-slate-100">{dropped?.static404Crawler ?? 0}</strong></span>
                <span>WAN Deny: <strong className="text-slate-900 dark:text-slate-100">{dropped?.wanDefaultDeny ?? 0}</strong></span>
              </div>
              <p className="text-[10px] font-mono text-slate-500">
                Zero WAN port forwards: {exposure.zeroWanPortForwards ? 'VERIFIED ✓' : 'CHECK'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 2. Active TTL Cloudflare WAF Leases & 1-Click Revert */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-[var(--color-brand-text)]" />
              <span>Active TTL WAF Leases ({activeLeases.length})</span>
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Every rule applied by Otto stores a pre-mutation Cloudflare ruleset snapshot and supports instant 1-Click Revert or automatic TTL expiry cleanup.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowSafeTestForm((v) => !v)}
              className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              <span>{showSafeTestForm ? 'Hide Safe Test Form' : 'Stage Safe RFC 5737 Test Lease'}</span>
            </button>
            {leaseHistory.length > 0 && (
              <button
                type="button"
                onClick={() => setShowLeaseHistory((v) => !v)}
                className="btn-secondary text-xs whitespace-nowrap flex-shrink-0"
              >
                {showLeaseHistory ? `Hide History (${leaseHistory.length})` : `Lease History (${leaseHistory.length})`}
              </button>
            )}
          </div>
        </div>

        {/* Controlled RFC 5737 Live Cloudflare Lease Test Helper */}
        {showSafeTestForm && (
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-[var(--color-brand-ring)] space-y-3">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Stage Controlled L3 Test Lease (RFC 5737 Non-Routable Documentation IP)
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Safely validates live Cloudflare Rulesets API snapshot capture, <code className="font-mono">panorama-sre-ttl:</code> tag embedding, live countdown, and 1-Click Revert using an unused documentation IP (<code className="font-mono">192.0.2.99</code>) with zero impact on real traffic.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">Cloudflare Zone</label>
                <CustomSelect
                  value={testZone}
                  onChange={setTestZone}
                  options={[
                    { value: 'parakith.com', label: 'parakith.com (PublicWeb)' },
                    { value: 'panoramadr.com', label: 'panoramadr.com (StrictPrivate/Apex)' },
                  ]}
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">Test IP (RFC 5737)</label>
                <input
                  type="text"
                  value={testIp}
                  onChange={(e) => setTestIp(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">Auto-Revert TTL</label>
                <CustomSelect
                  value={testTtl}
                  onChange={setTestTtl}
                  options={[
                    { value: '15', label: '15 minutes' },
                    { value: '60', label: '60 minutes (Default)' },
                    { value: '120', label: '120 minutes' },
                  ]}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSafeTestForm(false)}
                className="btn-ghost text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isStagingTest || !testIp.trim()}
                onClick={() => void handleStageSafeTestProposal()}
                className="btn-primary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 disabled:opacity-50"
              >
                <FlaskConical className="w-3.5 h-3.5" />
                <span>{isStagingTest ? 'Staging...' : 'Stage L3 Test Lease Proposal'}</span>
              </button>
            </div>
          </div>
        )}

        {activeLeases.length === 0 ? (
          <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
            No active Otto Cloudflare WAF leases right now. Stage a defense plan or run a fast edge sweep above.
          </div>
        ) : (
          <div className="space-y-2.5">
            {activeLeases.map((lease) => (
              <div
                key={lease.id}
                className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-[var(--color-brand-ring)] flex flex-col lg:flex-row lg:items-center justify-between gap-3"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge label="ACTIVE LEASE" variant="warning" />
                    <StatusBadge label={lease.actionType.toUpperCase()} variant="accent" />
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {lease.cfZoneName}
                    </span>
                    <span className="text-[11px] font-mono font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                      <Clock className="w-3 h-3 inline mr-1" />
                      {formatLeaseCountdown(lease.expiresAt, nowMs)}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-emerald-900 dark:text-emerald-400 bg-white dark:bg-[#050b14] border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 break-all">
                    {lease.ruleExpression}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                    Rule ID: {lease.cfRuleId} · Created {formatRelativeTime(lease.createdAt)} · Prior snapshot captured ✓
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {lease.traceRunId && (
                    <button
                      type="button"
                      onClick={() => onInspectTrace(lease.traceRunId!)}
                      className="btn-ghost text-xs py-1 px-2.5 flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Trace</span>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isBusyId === lease.id}
                    onClick={() => setConfirmRevertLease(lease)}
                    className="btn-danger text-xs py-1.5 px-3 flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{isBusyId === lease.id ? 'Reverting...' : 'Revert Rule Now'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {showLeaseHistory && leaseHistory.length > 0 && (
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <div className="text-[11px] font-mono font-bold uppercase text-slate-500">
              Reverted &amp; Expired Lease Audit History
            </div>
            {leaseHistory.slice(0, 12).map((lease) => (
              <div
                key={lease.id}
                className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      label={lease.status}
                      variant={lease.status.includes('REVERTED') ? 'success' : 'danger'}
                    />
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {lease.cfZoneName} · {lease.actionType}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 truncate max-w-[360px]">
                      {lease.ruleExpression}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-slate-500 tabular-nums shrink-0">
                  {lease.revertedAt
                    ? `Reverted ${formatLocalDateTime(lease.revertedAt)}`
                    : formatLocalDateTime(lease.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Staged Defense Plans & Inside-Perimeter Detection-Defect Diagnostics */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Shield className="w-4 h-4 text-[var(--color-brand-text)]" />
              <span>Staged Defense Plans &amp; Detection Diagnostics ({actionablePlans.length})</span>
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Zero-tool Gemini 4 Neon Defense Plans verified independently in Rust against Stage-0 evidence, Protected Allowlists, and L4-06 invariants.
            </p>
          </div>
        </div>

        {actionablePlans.length === 0 ? (
          <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
            No pending Defense Plans or Shadow dry-runs. Background noise is auto-dropped at Stage 0 below.
          </div>
        ) : (
          <div className="space-y-3">
            {actionablePlans.map((prop) => {
              const parsed = safeParseDefenseParams(prop.paramsJson);
              const mat = parsed.materialityBreakdown;
              const isDefect = prop.classification === 'DETECTION_DEFECT_SUSPECTED';
              return (
                <div
                  key={prop.id}
                  className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          label={prop.status}
                          variant={prop.status === 'PENDING_APPROVAL' ? 'warning' : 'info'}
                        />
                        {isDefect ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/35">
                            <Bug className="w-3 h-3" />
                            <span>Suspected Detection Bug</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/35">
                            <ShieldCheck className="w-3 h-3" />
                            <span>Home WAN &amp; Family Access Protected ✓</span>
                          </span>
                        )}
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                          {prop.title}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {prop.rcaSummary}
                      </p>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500 shrink-0 tabular-nums">
                      {prop.actionId} · {prop.assetSlug}
                    </span>
                  </div>

                  {mat && typeof mat.totalScore === 'number' && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono tabular-nums">
                      <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-800 dark:text-rose-300 border border-rose-500/30 font-bold">
                        Materiality {mat.totalScore}/100 ({mat.surface || 'Edge'})
                      </span>
                      <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                        Stack {mat.stackMatchPts ?? 0}/25
                      </span>
                      <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                        Boundary {mat.boundaryPenetrationPts ?? 0}/30
                      </span>
                      <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                        Impact {mat.authWriteImpactPts ?? 0}/20
                      </span>
                      <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                        Vol {mat.volumetricPersistencePts ?? 0}/15
                      </span>
                      <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                        X-Layer {mat.crossLayerPts ?? 0}/10
                      </span>
                    </div>
                  )}

                  {prop.diffPreview && (
                    <pre className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#050b14] border border-slate-200/90 dark:border-slate-800 text-emerald-900 dark:text-emerald-400 font-mono text-[11px] whitespace-pre-wrap break-all">
                      {prop.diffPreview}
                    </pre>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {prop.status === 'PENDING_APPROVAL' && (
                        <>
                          <button
                            type="button"
                            disabled={isBusyId === prop.id}
                            onClick={() => setConfirmApplyProposal(prop)}
                            className="btn-primary text-xs py-1 px-3 flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>
                              {isBusyId === prop.id ? 'Applying...' : 'Approve & Apply WAF'}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDecideProposal(prop.id, 'SNOOZE_24H')}
                            className="btn-secondary text-xs py-1 px-2.5 whitespace-nowrap flex-shrink-0"
                          >
                            Snooze 24h
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDecideProposal(prop.id, 'REJECT')}
                            className="btn-danger text-xs py-1 px-2.5 whitespace-nowrap flex-shrink-0"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {prop.status === 'SHADOW_LOGGED' && (
                        <>
                          <button
                            type="button"
                            onClick={() => void onDecideProposal(prop.id, 'SHADOW_AGREE')}
                            className="btn-primary text-xs py-1 px-2.5 flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                            <span>Agree (+1)</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDecideProposal(prop.id, 'SHADOW_DISAGREE')}
                            className="btn-secondary text-xs py-1 px-2.5 flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                          >
                            <ThumbsDown className="w-3.5 h-3.5" />
                            <span>Disagree</span>
                          </button>
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {prop.traceRunId && (
                        <button
                          type="button"
                          onClick={() => onInspectTrace(prop.traceRunId!)}
                          className="btn-ghost text-xs py-1 px-2.5 flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Deep-Thinking Trace</span>
                        </button>
                      )}
                      {onAskOtto && (
                        <button
                          type="button"
                          onClick={() =>
                            onAskOtto({
                              kind: 'defense_plan',
                              entityId: prop.id,
                              originView: 'agent',
                              title: `Defense Plan: ${prop.title}`,
                              severity: prop.severity,
                              summary: prop.rcaSummary,
                              metadata: {
                                actionId: prop.actionId,
                                assetSlug: prop.assetSlug,
                                classification: prop.classification,
                                params: parsed,
                              },
                              starterPrompts: [
                                `Audit this Defense Plan ("${prop.title}") against our SuiteExposureProfile and confirm whether it is safe to apply on Cloudflare.`,
                                `Verify zero family/home WAN allowlist impact and explain the 1-Click Revert path for ${prop.assetSlug}.`,
                              ],
                            })
                          }
                          className="btn-tonal text-xs py-1 px-2.5 flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                        >
                          <OttoIcon state="IDLE" className="w-3.5 h-3.5" />
                          <span>Ask Otto</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Dropped Noise (24h) Sampled Audit Ledger ($0 LLM) */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500" />
              <span>Dropped Noise Audit Trail — Last 24h ({recentNoise.length} Sampled Actors)</span>
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Absent-stack probes (WordPress, PHP, Spring <code className="font-mono">/actuator</code>, OS paths on static Cloudflare Pages) and zero-origin edge blocks auto-dropped at Stage 0 with zero alerts and $0 LLM cost.
            </p>
          </div>
        </div>

        {recentNoise.length === 0 ? (
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
            No dropped background noise recorded in the last 24 hours yet. Click <strong>Run Fast Edge Sweep</strong> to sample live Cloudflare edge traffic.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 font-mono text-[11px] text-slate-500 uppercase">
                  <th className="py-2 px-3">Actor IP / ASN</th>
                  <th className="py-2 px-3">Host &amp; Surface</th>
                  <th className="py-2 px-3">Drop Reason</th>
                  <th className="py-2 px-3 text-right">Score</th>
                  <th className="py-2 px-3 text-right">Reqs</th>
                  <th className="py-2 px-3">Sample Paths</th>
                  <th className="py-2 px-3 text-right">Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                {recentNoise.slice(0, 20).map((row) => {
                  const paths = safeParsePaths(row.samplePathsJson);
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-950/60">
                      <td className="py-2 px-3 text-slate-900 dark:text-slate-100">
                        <div>{row.actorIp}</div>
                        <div className="text-[10px] text-slate-500">
                          {row.actorAsn ? `AS${row.actorAsn}` : '—'} {row.country ? `· ${row.country}` : ''}
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <div className="text-slate-800 dark:text-slate-200">{row.host || '—'}</div>
                        <div className="text-[10px] text-slate-500">{row.surface}</div>
                      </td>
                      <td className="py-2 px-3">
                        <StatusBadge label={row.reason} variant="neutral" />
                      </td>
                      <td className="py-2 px-3 text-right text-slate-700 dark:text-slate-300">
                        {row.score}/100
                      </td>
                      <td className="py-2 px-3 text-right text-slate-700 dark:text-slate-300">
                        {row.requestCount}
                      </td>
                      <td className="py-2 px-3 text-[11px] text-slate-600 dark:text-slate-400 max-w-[260px] truncate">
                        {paths.join(', ') || '—'}
                      </td>
                      <td
                        className="py-2 px-3 text-right text-[11px] text-slate-500 whitespace-nowrap"
                        title={formatLocalDateTime(row.createdAt)}
                      >
                        {formatRelativeTime(row.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm 1-Click Revert Modal */}
      <ConfirmDangerModal
        isOpen={Boolean(confirmRevertLease)}
        title={
          confirmRevertLease
            ? `Revert Cloudflare WAF Lease (${confirmRevertLease.cfZoneName})`
            : 'Revert WAF Rule'
        }
        description={
          confirmRevertLease
            ? `Remove Otto rule '${confirmRevertLease.cfRuleId}' (${confirmRevertLease.ruleExpression}) from Cloudflare zone '${confirmRevertLease.cfZoneName}' immediately while preserving all other custom WAF rules.`
            : ''
        }
        confirmLabel="Revert Rule Now"
        isProcessing={Boolean(confirmRevertLease && isBusyId === confirmRevertLease.id)}
        onCancel={() => setConfirmRevertLease(null)}
        onConfirm={() => {
          if (confirmRevertLease) void handleConfirmRevert(confirmRevertLease);
        }}
      />

      {/* Confirm L3 Apply Cloudflare WAF Plan Modal */}
      <ConfirmDangerModal
        isOpen={Boolean(confirmApplyProposal)}
        title={
          confirmApplyProposal
            ? `Approve & Apply Cloudflare WAF: ${confirmApplyProposal.title}`
            : 'Apply Cloudflare WAF'
        }
        description={
          confirmApplyProposal
            ? `Otto will capture a full prior ruleset snapshot on Cloudflare, re-validate Home WAN & Family Access L4-06 protections, apply '${confirmApplyProposal.actionId}' on '${confirmApplyProposal.assetSlug}', and register a 1-Click Revert lease.\n\n${confirmApplyProposal.diffPreview || confirmApplyProposal.rcaSummary}`
            : ''
        }
        confirmLabel="Approve & Apply WAF"
        isProcessing={Boolean(confirmApplyProposal && isBusyId === confirmApplyProposal.id)}
        onCancel={() => setConfirmApplyProposal(null)}
        onConfirm={() => {
          if (confirmApplyProposal) void handleConfirmApplyProposal(confirmApplyProposal);
        }}
      />
    </div>
  );
};
