import React from 'react';
import { X, AlertTriangle, CheckCircle2, ArrowRight, Bell, ShieldAlert, Clock } from 'lucide-react';
import type { OttoProposalRow } from '../../lib/types';
import { OttoIcon } from '../agent/OttoAvatar';
import { BlastRadiusBadge } from '../ui/BlastRadiusBadge';

export interface UnifiedAlertItem {
  id: string;
  domain: string;
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
  actionLabel: string;
  onAction: () => void;
}

interface AlertsInboxDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  alerts: UnifiedAlertItem[];
  pendingOttoProposals?: OttoProposalRow[];
  onOpenOttoApprovals?: () => void;
  onSnoozeOttoProposal?: (proposalId: string) => void;
  onAskOttoProposal?: (proposal: OttoProposalRow) => void;
}

function safeParseFlags(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export const AlertsInboxDrawer: React.FC<AlertsInboxDrawerProps> = ({
  isOpen,
  onClose,
  alerts,
  pendingOttoProposals = [],
  onOpenOttoApprovals,
  onSnoozeOttoProposal,
  onAskOttoProposal,
}) => {
  if (!isOpen) return null;

  const sorted = [...alerts].sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === 'critical' ? -1 : 1;
  });

  const criticalCount = sorted.filter((a) => a.severity === 'critical').length;
  const warningCount = sorted.filter((a) => a.severity === 'warning').length;
  const approvalCount = pendingOttoProposals.length;

  return (
    <div
      className="fixed inset-0 z-[75] bg-slate-900/70 backdrop-blur-sm flex justify-end"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Unified Alerts & Attention Queue"
    >
      <div
        className="w-full max-w-md h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                Unified Attention Queue
              </h2>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
              {approvalCount > 0 ? `${approvalCount} L3 Approval${approvalCount === 1 ? '' : 's'} • ` : ''}
              {criticalCount} Critical • {warningCount} Warnings across 7 SRE domains
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
            aria-label="Close Alerts Drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Top Section: Pending L3 Otto Approvals (Always above 7-Domain Incidents) */}
          {approvalCount > 0 && (
            <section
              data-testid="alerts-drawer-otto-approvals"
              aria-label="Pending L3 Otto Approvals"
              className="space-y-2.5 pb-3 border-b border-slate-200 dark:border-slate-800"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider text-[var(--color-brand-text)]">
                  <OttoIcon className="w-4 h-4" state="AWAITING_APPROVAL" />
                  <span>Pending L3 Otto Approvals ({approvalCount})</span>
                </div>
                {onOpenOttoApprovals && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenOttoApprovals();
                      onClose();
                    }}
                    className="text-[11px] font-mono font-semibold text-[var(--color-brand-text)] hover:underline cursor-pointer whitespace-nowrap"
                  >
                    Open Queue →
                  </button>
                )}
              </div>

              {pendingOttoProposals.map((prop) => {
                const flags = safeParseFlags(prop.blastRadiusFlagsJson);
                return (
                  <div
                    key={prop.id}
                    className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border-2 border-[var(--color-brand-ring)] space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)] border border-[var(--color-brand-ring)]">
                        <ShieldAlert className="w-3 h-3 shrink-0" />
                        <span>L3 • {prop.domain} • {prop.assetSlug}</span>
                      </span>
                      <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                        {prop.actionId}
                      </span>
                    </div>

                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        {prop.title}
                      </div>
                      {prop.rcaSummary && (
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed line-clamp-3">
                          {prop.rcaSummary}
                        </p>
                      )}
                    </div>

                    {flags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {flags.map((flag) => (
                          <BlastRadiusBadge key={flag} badge={flag} />
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {onOpenOttoApprovals && (
                        <button
                          type="button"
                          onClick={() => {
                            onOpenOttoApprovals();
                            onClose();
                          }}
                          className="btn-primary flex-1 text-xs py-1.5 px-2.5 flex items-center justify-center gap-1 whitespace-nowrap"
                        >
                          <span>Review &amp; Approve</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onAskOttoProposal && (
                        <button
                          type="button"
                          onClick={() => {
                            onAskOttoProposal(prop);
                            onClose();
                          }}
                          className="btn-tonal text-xs py-1.5 px-2.5 flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                        >
                          <OttoIcon className="w-3.5 h-3.5" />
                          <span>Ask</span>
                        </button>
                      )}
                      {onSnoozeOttoProposal && (
                        <button
                          type="button"
                          onClick={() => onSnoozeOttoProposal(prop.id)}
                          className="btn-secondary text-xs py-1.5 px-2 flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                          title="Snooze this proposal for 24 hours"
                        >
                          <Clock className="w-3 h-3" />
                          <span>24h</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {sorted.length === 0 && approvalCount === 0 ? (
            <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-emerald-500/30 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400 mx-auto" />
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                All 7 SRE Domains Nominal
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Fleet health, 360° Threat Intel, WSH Hardening (9/9), PKI certificates, GFS Backups, Smoke Suites, and DietPi Crons report zero active incidents.
              </p>
            </div>
          ) : (
            sorted.map((alert) => {
              const isCritical = alert.severity === 'critical';
              return (
                <div
                  key={alert.id}
                  className={`p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border space-y-2.5 ${
                    isCritical
                      ? 'border-rose-500/50'
                      : 'border-amber-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border ${
                        isCritical
                          ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40'
                          : 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40'
                      }`}
                    >
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>{alert.severity} • {alert.domain}</span>
                    </span>
                  </div>

                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {alert.title}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                      {alert.detail}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      alert.onAction();
                      onClose();
                    }}
                    className={`${
                      isCritical ? 'btn-danger' : 'btn-primary'
                    } w-full text-xs flex items-center justify-center gap-1.5`}
                  >
                    <span>{alert.actionLabel}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
