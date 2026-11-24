import React, { useMemo, useState } from 'react';
import { BottomSheetModal, StatusBadge } from '@lagosr/panorama-ui-kit';
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  Copy,
  Layers,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import type {
  BoundaryConnection,
  BoundaryRuleItem,
  BoundaryWireVerdict,
  BoundaryZoneNode,
} from '../../lib/topology-boundary-layout';
import type { IngressHop, TopologyRouteItem } from '../../lib/topology-synthesizer';
import { CopyableAddressText, CopyableValue, writeClipboardText } from '../ui/CopyableValue';

export interface BoundaryInspectTarget {
  connection?: BoundaryConnection | null;
  focusedRule?: BoundaryRuleItem | null;
  sourceZone?: BoundaryZoneNode | null;
  destinationZone?: BoundaryZoneNode | null;
}

interface BoundaryConnectionInspectModalProps {
  target: BoundaryInspectTarget | null;
  onClose: () => void;
  zones: BoundaryZoneNode[];
  focusedRoute: TopologyRouteItem | null;
  hasReverseConnection: boolean;
  onInspectReverse?: () => void;
  onOpenDeepDrawer?: (route: TopologyRouteItem | null, hop: IngressHop | null) => void;
  onRunTestHop?: (route: TopologyRouteItem) => void;
}

function verdictMeta(verdict: BoundaryWireVerdict): {
  label: string;
  variant: 'success' | 'info' | 'warning' | 'danger' | 'neutral';
  description: string;
} {
  switch (verdict) {
    case 'VERIFIED':
      return {
        label: 'Verified Flow',
        variant: 'success',
        description:
          'Traffic crosses this security boundary strictly through isolated CGNAT bridges and non-root containers.',
      };
    case 'TUNNEL':
      return {
        label: 'Encrypted Tunnel',
        variant: 'info',
        description:
          'Authenticated outbound QUIC tunnel terminates edge TLS requests with zero open inbound WAN ports.',
      };
    case 'PINHOLE':
      return {
        label: 'Scoped Pinhole',
        variant: 'warning',
        description:
          'Only explicitly allowlisted sockets and destination ports may traverse this boundary.',
      };
    case 'BLOCKED':
      return {
        label: 'Blocked Boundary',
        variant: 'danger',
        description:
          'Lateral, admin-plane, or RFC1918 traffic across this perimeter is explicitly dropped by kernel firewall / UniFi ZBF.',
      };
    case 'WARNING':
      return {
        label: 'Attention Required',
        variant: 'warning',
        description:
          'One or more posture invariants or health checks flagged a deviation across this boundary.',
      };
  }
}

export const BoundaryConnectionInspectModal: React.FC<
  BoundaryConnectionInspectModalProps
> = ({
  target,
  onClose,
  zones,
  focusedRoute,
  hasReverseConnection,
  onInspectReverse,
  onOpenDeepDrawer,
  onRunTestHop,
}) => {
  const [copied, setCopied] = useState(false);

  const srcZone = useMemo(() => {
    if (!target) return null;
    if (target.sourceZone) return target.sourceZone;
    const id = target.connection?.sourceZoneId;
    return zones.find((z) => z.id === id) ?? null;
  }, [target, zones]);

  const dstZone = useMemo(() => {
    if (!target) return null;
    if (target.destinationZone) return target.destinationZone;
    const id = target.connection?.destinationZoneId ?? target.focusedRule?.peerZoneId;
    return zones.find((z) => z.id === id) ?? null;
  }, [target, zones]);

  const rulesToRender = useMemo(() => {
    if (!target) return [];
    const pool = target.connection?.rules ?? (target.focusedRule ? [target.focusedRule] : []);
    const focusedId = target.focusedRule?.id;
    const seen = new Set<string>();
    const deduped = pool.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    if (focusedId && !seen.has(focusedId) && target.focusedRule) {
      deduped.unshift(target.focusedRule);
    }
    return deduped.sort((a, b) => {
      if (focusedId && a.id === focusedId && b.id !== focusedId) return -1;
      if (focusedId && b.id === focusedId && a.id !== focusedId) return 1;
      return a.title.localeCompare(b.title);
    });
  }, [target]);

  const activeVerdict: BoundaryWireVerdict = useMemo(() => {
    if (target?.connection) return target.connection.verdict;
    const r = target?.focusedRule;
    if (!r) return 'VERIFIED';
    if (r.status === 'fail' || r.status === 'warn') return 'WARNING';
    if (r.action === 'BLOCK') return 'BLOCKED';
    if (r.action === 'TUNNEL') return 'TUNNEL';
    if (r.action === 'PINHOLE') return 'PINHOLE';
    return 'VERIFIED';
  }, [target]);

  const vMeta = verdictMeta(activeVerdict);
  const isIntraZone = Boolean(
    target?.focusedRule?.direction === 'LOCAL' ||
      (srcZone && dstZone && srcZone.id === dstZone.id)
  );
  const srcName =
    srcZone?.name ?? target?.connection?.sourceZoneName ?? 'Source Layer';
  const dstName =
    dstZone?.name ?? target?.connection?.destinationZoneName ?? srcName;

  const modalTitle = isIntraZone ? `${srcName} (Zone Guardrail)` : `${srcName} → ${dstName}`;

  const handleCopySummary = async () => {
    const lines = [
      `WSH Security Boundary: ${modalTitle}`,
      `Enforcement: ${vMeta.label}`,
      target?.connection?.summary || target?.focusedRule?.detail || vMeta.description,
      '',
      ...rulesToRender.map(
        (r) =>
          `- [${r.action}] ${r.invariantId ? `${r.invariantId} ` : ''}${r.title} | Proto: ${r.protocol || 'Scoped'} | Status: ${r.status.toUpperCase()} | ${r.detail}`
      ),
    ];
    const ok = await writeClipboardText(lines.join('\n'));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <BottomSheetModal
      isOpen={Boolean(target)}
      onClose={onClose}
      maxWidthClass="max-w-3xl"
      icon={<Shield className="w-5 h-5" />}
      title={modalTitle}
      subtitle={
        target?.focusedRule
          ? `${target.focusedRule.invariantId ? `[${target.focusedRule.invariantId}] ` : ''}${target.focusedRule.title}`
          : target?.connection?.summary || vMeta.description
      }
      headerBadge={<StatusBadge label={vMeta.label} variant={vMeta.variant} />}
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopySummary()}
              className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copied ? 'Copied!' : 'Copy Boundary Summary'}</span>
            </button>

            {!isIntraZone && hasReverseConnection && onInspectReverse && (
              <button
                type="button"
                onClick={onInspectReverse}
                className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span>Flip Pair Direction</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {focusedRoute && onRunTestHop && (
              <button
                type="button"
                onClick={() => onRunTestHop(focusedRoute)}
                className="btn-accent text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Test /{focusedRoute.slug} Hop</span>
              </button>
            )}
            {onOpenDeepDrawer && (focusedRoute || target?.connection?.hop) && (
              <button
                type="button"
                onClick={() => {
                  onOpenDeepDrawer(focusedRoute, target?.connection?.hop ?? null);
                  onClose();
                }}
                className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Open Socket Drawer</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="btn-primary text-xs whitespace-nowrap flex-shrink-0"
            >
              Done
            </button>
          </div>
        </div>
      }
    >
      {target && (
        <div className="space-y-4">
          {/* Source -> Destination Zone Flow Header */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Source Boundary Layer
              </div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {srcName}
              </div>
              <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 tabular-nums flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                {srcZone && srcZone.metadataAddresses.length > 0
                  ? srcZone.metadataAddresses.map((addr, idx) => (
                      <React.Fragment key={addr}>
                        {idx > 0 && <span>•</span>}
                        <CopyableValue value={addr} label="source boundary address" />
                      </React.Fragment>
                    ))
                  : srcZone?.metadataSummary || 'Perimeter Edge'}
              </div>
            </div>

            <div className="flex items-center justify-center gap-2 shrink-0 px-2">
              <ArrowRight className="w-4 h-4 text-[var(--color-brand-text)]" />
              <StatusBadge label={vMeta.label} variant={vMeta.variant} />
              <ArrowRight className="w-4 h-4 text-[var(--color-brand-text)]" />
            </div>

            <div className="min-w-0 flex-1 space-y-1 sm:text-right">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {isIntraZone ? 'Scoped Layer Guardrail' : 'Destination Boundary Layer'}
              </div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {dstName}
              </div>
              <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 tabular-nums flex flex-wrap sm:justify-end items-center gap-x-1.5 gap-y-0.5">
                {dstZone && dstZone.metadataAddresses.length > 0
                  ? dstZone.metadataAddresses.map((addr, idx) => (
                      <React.Fragment key={addr}>
                        {idx > 0 && <span>•</span>}
                        <CopyableValue value={addr} label="destination boundary address" />
                      </React.Fragment>
                    ))
                  : dstZone?.metadataSummary || 'Host Target'}
              </div>
            </div>
          </div>

          {/* Enforcement Assessment Banner */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2.5">
            {activeVerdict === 'BLOCKED' || activeVerdict === 'WARNING' ? (
              <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            )}
            <div className="space-y-0.5">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                {target.connection?.summary || target.focusedRule?.title || vMeta.label}
              </div>
              <p className="text-slate-600 dark:text-slate-400">{vMeta.description}</p>
            </div>
          </div>

          {/* Governing Rules & Security Posture Invariants */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 tabular-nums">
                Boundary Enforcement Controls ({rulesToRender.length})
              </h4>
              {focusedRoute && (
                <span className="text-[11px] font-mono text-[var(--color-brand-text)] tabular-nums">
                  Route Focus: /{focusedRoute.slug} (:{focusedRoute.port})
                </span>
              )}
            </div>

            {rulesToRender.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-500 text-center">
                No detailed boundary controls attached to this selection.
              </div>
            ) : (
              <div className="space-y-2.5">
                {rulesToRender.map((rule) => {
                  const isFocused = target.focusedRule?.id === rule.id;
                  const actionVariant =
                    rule.action === 'BLOCK' || rule.status === 'fail'
                      ? 'danger'
                      : rule.action === 'PINHOLE' || rule.status === 'warn'
                        ? 'warning'
                        : rule.action === 'TUNNEL'
                          ? 'info'
                          : 'success';

                  return (
                    <div
                      key={rule.id}
                      className={`rounded-xl bg-white dark:bg-slate-900 border p-3.5 space-y-2.5 ${
                        isFocused
                          ? 'border-[var(--color-brand)] ring-2 ring-[var(--color-brand-ring)] shadow-sm'
                          : 'border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge label={rule.action} variant={actionVariant} />
                          {rule.invariantId && (
                            <StatusBadge label={rule.invariantId} variant="brand" />
                          )}
                          <StatusBadge
                            label={
                              rule.status === 'pass'
                                ? 'ENFORCED'
                                : rule.status === 'warn'
                                  ? 'WARNING'
                                  : 'VIOLATION'
                            }
                            variant={
                              rule.status === 'pass'
                                ? 'success'
                                : rule.status === 'warn'
                                  ? 'warning'
                                  : 'danger'
                            }
                          />
                        </div>
                        {rule.protocol && (
                          <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                            <CopyableAddressText text={rule.protocol} />
                          </span>
                        )}
                      </div>

                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {rule.title}
                      </div>

                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        <CopyableAddressText text={rule.detail} />
                      </p>

                      {rule.evidence && (
                        <pre className="p-3 rounded-xl bg-slate-50 dark:bg-[#050b14] border border-slate-200/90 dark:border-slate-800 shadow-inner font-mono text-[11px] text-emerald-900 dark:text-emerald-400 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                          {rule.evidence}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </BottomSheetModal>
  );
};
