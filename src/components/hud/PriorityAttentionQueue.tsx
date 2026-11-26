import React, { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  HardDriveDownload,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  FlaskConical,
  RefreshCw,
} from 'lucide-react';
import { HudIncidentAction, HudIncidentDomain, HudIncidentItem } from '../../lib/hud-synthesis';
import type { OttoContextSeed } from '../../lib/types';
import { OttoIcon } from '../agent/OttoAvatar';

interface PriorityAttentionQueueProps {
  incidents: HudIncidentItem[];
  isInitialSyncComplete: boolean;
  pendingAgentApprovalsCount?: number;
  onAction: (action: HudIncidentAction) => void;
  onRunPenetrationAudit?: () => void;
  onAskOtto?: (seed: OttoContextSeed) => void;
}

const DOMAIN_ICONS: Record<HudIncidentDomain, React.ComponentType<{ className?: string }>> = {
  apps: ShieldAlert,
  hardening: ShieldAlert,
  backups: HardDriveDownload,
  threat: AlertTriangle,
  smoke: FlaskConical,
  ssl: KeyRound,
  dietpi: Clock,
};

export const PriorityAttentionQueue: React.FC<PriorityAttentionQueueProps> = ({
  incidents,
  isInitialSyncComplete,
  pendingAgentApprovalsCount = 0,
  onAction,
  onRunPenetrationAudit,
  onAskOtto,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!isInitialSyncComplete) {
    return null;
  }

  if (incidents.length === 0 && pendingAgentApprovalsCount === 0) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-white dark:bg-slate-900 px-4 py-2.5 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            All 7 SRE Domains Nominal
          </span>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            Apps · Hardening · Backups · Threat SOC · Smoke · PKI · DietPi Host
          </span>
        </div>
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25 tabular-nums whitespace-nowrap">
          0 Active Incidents
        </span>
      </div>
    );
  }

  const criticalCount = incidents.filter((i) => i.severity === 'critical').length;
  const warningCount = incidents.filter((i) => i.severity === 'warning').length;
  const hasCritical = criticalCount > 0;

  return (
    <section
      aria-label="Priority Attention Queue"
      className={`rounded-2xl border bg-white dark:bg-slate-900 shadow-sm overflow-hidden ${
        hasCritical
          ? 'border-rose-500/70 ring-1 ring-rose-500/25'
          : 'border-amber-500/60 ring-1 ring-amber-500/20'
      }`}
    >
      {/* Queue Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-slate-950/60">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          {hasCritical ? (
            <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          )}
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
            Priority Attention Queue
          </h2>
          {criticalCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-600 text-white tabular-nums whitespace-nowrap">
              {criticalCount} CRITICAL
            </span>
          )}
          {warningCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/40 tabular-nums whitespace-nowrap">
              {warningCount} WARNING
            </span>
          )}
          {pendingAgentApprovalsCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)] border border-[var(--color-brand-ring)] tabular-nums whitespace-nowrap">
              {pendingAgentApprovalsCount} L3 APPROVAL{pendingAgentApprovalsCount > 1 ? 'S' : ''}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsCollapsed((prev) => !prev)}
          className="btn-ghost text-xs px-2.5 py-1 min-h-[32px] flex items-center gap-1 whitespace-nowrap flex-shrink-0"
          aria-expanded={!isCollapsed}
        >
          <span>{isCollapsed ? `Expand (${incidents.length})` : 'Collapse'}</span>
          {isCollapsed ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Severity-Ranked Rows */}
      {!isCollapsed && (
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {incidents.map((item) => {
            const Icon = DOMAIN_ICONS[item.domain];
            const isCrit = item.severity === 'critical';
            return (
              <div
                key={item.id}
                className="px-4 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${
                      isCrit
                        ? 'bg-rose-500/15 border-rose-500/40 text-rose-600 dark:text-rose-400'
                        : 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${
                          isCrit
                            ? 'bg-rose-700 dark:bg-rose-600 text-white'
                            : 'bg-amber-500/20 text-amber-900 dark:text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {item.domainLabel}
                      </span>
                      {item.meta && (
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {item.meta}
                        </span>
                      )}
                      {item.todayProtectedLabel && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                          {item.todayProtectedLabel}
                        </span>
                      )}
                    </div>
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                      {item.title}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400 break-words">
                      {item.detail}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onAction(item.primaryAction)}
                    className={`${isCrit ? 'btn-danger' : 'btn-primary'} text-xs py-1.5 px-3 whitespace-nowrap flex-shrink-0`}
                  >
                    {(item.primaryAction.kind === 'reapply_hardening' ||
                      item.primaryAction.kind === 'retry_backup') && (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>{item.primaryAction.label}</span>
                  </button>

                  {item.domain === 'hardening' && onRunPenetrationAudit && (
                    <button
                      type="button"
                      onClick={onRunPenetrationAudit}
                      className="btn-secondary text-xs py-1.5 px-3 whitespace-nowrap flex-shrink-0"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Run Penetration Audit</span>
                    </button>
                  )}

                  {item.secondaryAction && (
                    <button
                      type="button"
                      onClick={() => onAction(item.secondaryAction!)}
                      className="btn-secondary text-xs py-1.5 px-3 whitespace-nowrap flex-shrink-0"
                    >
                      <span>{item.secondaryAction.label}</span>
                    </button>
                  )}

                  {onAskOtto && (
                    <button
                      type="button"
                      onClick={() =>
                        onAskOtto({
                          kind: 'hud_incident',
                          entityId: item.id,
                          originView: 'hud',
                          title: item.title,
                          severity: item.severity.toUpperCase(),
                          summary: `${item.domainLabel}: ${item.detail}`,
                          metadata: { domain: item.domain, meta: item.meta },
                          starterPrompts: [
                            `Diagnose "${item.title}" — is this a genuine issue or a false positive / telemetry artifact?`,
                            `What is the safest reversible step to resolve "${item.title}" without risking production data?`,
                          ],
                        })
                      }
                      className="btn-tonal text-xs py-1.5 px-2.5 flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                      title="Open Ask Otto with this incident pinned as context"
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
    </section>
  );
};
