import React, { useMemo, useState } from 'react';
import { BottomSheetModal, StatusBadge } from '@lagosr/panorama-ui-kit';
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Shield,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type {
  UnifiPolicyDto,
  UnifiTopologySnapshotDto,
  UnifiZoneDto,
} from '../../lib/types';
import {
  getVlanBadgeStyle,
  type ZbfCellVerdict,
  type ZbfMatrixResult,
  type ZoneFlowConnection,
} from '../../lib/unifi-zbf';

export interface RuleInspectTarget {
  connection?: ZoneFlowConnection | null;
  focusedPolicy?: UnifiPolicyDto | null;
  sourceZone?: UnifiZoneDto | null;
  destinationZone?: UnifiZoneDto | null;
}

interface ZoneRuleQuickInspectModalProps {
  target: RuleInspectTarget | null;
  onClose: () => void;
  topology: UnifiTopologySnapshotDto;
  matrix: ZbfMatrixResult;
  customRulesOnly: boolean;
  hasReverseConnection: boolean;
  onInspectReverse?: () => void;
  onOpenUnifiFirewall?: () => void;
}

function verdictMeta(verdict: ZbfCellVerdict): {
  label: string;
  variant: 'success' | 'info' | 'warning' | 'danger' | 'neutral';
  description: string;
} {
  switch (verdict) {
    case 'ALLOW':
      return {
        label: 'Allowed',
        variant: 'success',
        description:
          'New connections and matching stateful return replies are permitted in this direction.',
      };
    case 'ALLOW_WITH_BLOCKS':
      return {
        label: 'Allowed w/ Blocks',
        variant: 'info',
        description:
          'Traffic is allowed by baseline policy except for explicit block carve-out rules evaluated first.',
      };
    case 'RESTRICTED_ALLOW':
      return {
        label: 'Limited Pinholes',
        variant: 'warning',
        description:
          'Blocked by default — only the specific protocol, IP, or port pinhole rule(s) listed below are permitted.',
      };
    case 'RETURN_ONLY':
      return {
        label: 'Return Traffic Only',
        variant: 'info',
        description:
          'New outbound connections are blocked; only ESTABLISHED/RELATED replies to allowed sessions may pass.',
      };
    case 'BLOCKED':
      return {
        label: 'Blocked',
        variant: 'danger',
        description:
          'All new traffic between these zones is dropped by the Zone-Based Firewall policy chain.',
      };
  }
}

export const ZoneRuleQuickInspectModal: React.FC<ZoneRuleQuickInspectModalProps> = ({
  target,
  onClose,
  topology,
  matrix,
  customRulesOnly,
  hasReverseConnection,
  onInspectReverse,
  onOpenUnifiFirewall,
}) => {
  const [copied, setCopied] = useState(false);

  const srcZone = useMemo(() => {
    if (!target) return null;
    if (target.sourceZone) return target.sourceZone;
    const id = target.connection?.sourceZoneId ?? target.focusedPolicy?.sourceZoneId;
    return matrix.zones.find((z) => z.id === id) ?? null;
  }, [target, matrix.zones]);

  const dstZone = useMemo(() => {
    if (!target) return null;
    if (target.destinationZone) return target.destinationZone;
    const id = target.connection?.destinationZoneId ?? target.focusedPolicy?.destinationZoneId;
    return matrix.zones.find((z) => z.id === id) ?? null;
  }, [target, matrix.zones]);

  const matrixCell = useMemo(() => {
    if (!srcZone || !dstZone) return null;
    return matrix.cells[srcZone.id]?.[dstZone.id] ?? null;
  }, [matrix.cells, srcZone, dstZone]);

  const subnetsByZoneId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const net of topology.networks) {
      if (!net.zoneId || !net.subnetCidr) continue;
      const arr = map.get(net.zoneId) ?? [];
      arr.push(net.subnetCidr);
      map.set(net.zoneId, arr);
    }
    return map;
  }, [topology.networks]);

  const rulesToRender = useMemo(() => {
    if (!target) return [];
    const pool =
      target.connection?.rules ??
      matrixCell?.rules ??
      (target.focusedPolicy ? [target.focusedPolicy] : []);

    const filtered = customRulesOnly
      ? pool.filter(
          (r) =>
            r.origin.toUpperCase() === 'USER_DEFINED' ||
            r.id === target.focusedPolicy?.id
        )
      : pool;

    const list = filtered.length > 0 ? filtered : pool;
    const focusedId = target.focusedPolicy?.id;

    return list.slice().sort((a, b) => {
      if (focusedId && a.id === focusedId && b.id !== focusedId) return -1;
      if (focusedId && b.id === focusedId && a.id !== focusedId) return 1;
      return a.index - b.index || a.name.localeCompare(b.name);
    });
  }, [target, matrixCell, customRulesOnly]);

  const activeVerdict: ZbfCellVerdict = useMemo(() => {
    if (target?.connection) return target.connection.verdict;
    if (matrixCell) return matrixCell.verdict;
    const act = target?.focusedPolicy?.action.toUpperCase();
    return act === 'ALLOW' ? 'ALLOW' : 'BLOCKED';
  }, [target, matrixCell]);

  const vMeta = verdictMeta(activeVerdict);
  const isIntraZone = Boolean(srcZone && dstZone && srcZone.id === dstZone.id);
  const srcSubnets = srcZone ? subnetsByZoneId.get(srcZone.id) ?? [] : [];
  const dstSubnets = dstZone ? subnetsByZoneId.get(dstZone.id) ?? [] : [];

  const customCount = rulesToRender.filter(
    (r) => r.origin.toUpperCase() === 'USER_DEFINED'
  ).length;
  const systemCount = rulesToRender.length - customCount;
  const anyReturnTraffic = rulesToRender.some(
    (r) => r.action.toUpperCase() === 'ALLOW' && r.allowReturnTraffic
  );
  const anyLogging = rulesToRender.some((r) => r.loggingEnabled);

  const srcName = srcZone?.name ?? target?.connection?.sourceZoneName ?? 'Source Zone';
  const dstName = dstZone?.name ?? target?.connection?.destinationZoneName ?? 'Destination Zone';

  const modalTitle = isIntraZone
    ? `${srcName} (Intra-Zone Rule)`
    : `${srcName} → ${dstName}`;

  const handleCopySummary = async () => {
    const lines = [
      `UniFi ZBF Connection: ${modalTitle}`,
      `Effective Verdict: ${vMeta.label}`,
      target?.connection?.summary || matrixCell?.summary || vMeta.description,
      '',
      ...rulesToRender.map(
        (r) =>
          `- [${r.action.toUpperCase()}] #${r.index} ${r.name} (${r.origin}) | Proto: ${r.protocol || 'All'} | Src: ${r.sourceFilterSummary || 'Any'} | Dst: ${r.destinationFilterSummary || 'Any'} | Return: ${r.allowReturnTraffic ? 'Yes' : 'No'} | Syslog: ${r.loggingEnabled ? 'On' : 'Off'}`
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures cleanly
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
        target?.focusedPolicy
          ? `Focused rule: ${target.focusedPolicy.name} (UniFi index #${target.focusedPolicy.index})`
          : target?.connection?.summary || matrixCell?.summary || vMeta.description
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
              <span>{copied ? 'Copied!' : 'Copy Rule Summary'}</span>
            </button>

            {!isIntraZone && hasReverseConnection && onInspectReverse && (
              <button
                type="button"
                onClick={onInspectReverse}
                className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span>Flip Reverse Flow</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {onOpenUnifiFirewall && (
              <button
                type="button"
                onClick={onOpenUnifiFirewall}
                className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open UniFi Firewall</span>
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
                Source Zone
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {srcName}
                </span>
                {(srcZone?.vlanIds ?? []).map((vid) => {
                  const vs = getVlanBadgeStyle(`VLAN ${vid}`);
                  return (
                    <span
                      key={vid}
                      className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-semibold tabular-nums ${vs.chipClass}`}
                    >
                      VLAN {vid}
                    </span>
                  );
                })}
              </div>
              <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                {srcSubnets.length > 0 ? srcSubnets.join(', ') : 'System scope'}
                {srcZone ? ` • ${srcZone.clientCount} client(s)` : ''}
              </div>
            </div>

            <div className="flex items-center justify-center gap-2 shrink-0 px-2">
              <ArrowRight className="w-4 h-4 text-[var(--color-brand-text)]" />
              <StatusBadge label={vMeta.label} variant={vMeta.variant} />
              <ArrowRight className="w-4 h-4 text-[var(--color-brand-text)]" />
            </div>

            <div className="min-w-0 flex-1 space-y-1 sm:text-right">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {isIntraZone ? 'Same Zone (Intra-Zone)' : 'Destination Zone'}
              </div>
              <div className="flex flex-wrap sm:justify-end items-center gap-1.5">
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {dstName}
                </span>
                {(dstZone?.vlanIds ?? []).map((vid) => {
                  const vs = getVlanBadgeStyle(`VLAN ${vid}`);
                  return (
                    <span
                      key={vid}
                      className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-semibold tabular-nums ${vs.chipClass}`}
                    >
                      VLAN {vid}
                    </span>
                  );
                })}
              </div>
              <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                {dstSubnets.length > 0 ? dstSubnets.join(', ') : 'System scope'}
                {dstZone ? ` • ${dstZone.clientCount} client(s)` : ''}
              </div>
            </div>
          </div>

          {/* Quick-Facts KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Verdict
              </div>
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                {vMeta.label}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Stateful Return
              </div>
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                {anyReturnTraffic ? 'Return Allowed' : 'No Return Auto-Allow'}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Policy Chain
              </div>
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {customCount} Custom · {systemCount} System
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                SIEM Syslog
              </div>
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                {anyLogging ? 'Logging Active' : 'Disabled'}
              </div>
            </div>
          </div>

          {/* Plain-English Assessment */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2.5">
            {activeVerdict === 'BLOCKED' ? (
              <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            )}
            <div className="space-y-0.5">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                {target.connection?.summary || matrixCell?.summary || vMeta.label}
              </div>
              <p className="text-slate-600 dark:text-slate-400">{vMeta.description}</p>
            </div>
          </div>

          {/* Ordered UniFi Policy Chain */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 tabular-nums">
                Governing Firewall Rules ({rulesToRender.length})
              </h4>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                Evaluated top-to-bottom by UniFi index
              </span>
            </div>

            {rulesToRender.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-500 text-center">
                No detailed policies matched this selection.
              </div>
            ) : (
              <div className="space-y-2.5">
                {rulesToRender.map((pol) => {
                  const isFocused = target.focusedPolicy?.id === pol.id;
                  const isAllow = pol.action.toUpperCase() === 'ALLOW';
                  const isCustom = pol.origin.toUpperCase() === 'USER_DEFINED';

                  return (
                    <div
                      key={pol.id}
                      className={`rounded-xl bg-white dark:bg-slate-900 border p-3.5 space-y-2.5 ${
                        isFocused
                          ? 'border-[var(--color-brand)] ring-2 ring-[var(--color-brand-ring)] shadow-sm'
                          : 'border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {isFocused && (
                              <StatusBadge label="Selected Rule" variant="brand" />
                            )}
                            <StatusBadge
                              label={pol.action.toUpperCase()}
                              variant={isAllow ? 'success' : 'danger'}
                            />
                            <StatusBadge
                              label={isCustom ? 'Custom' : 'System'}
                              variant={isCustom ? 'accent' : 'neutral'}
                            />
                            {!pol.enabled && (
                              <StatusBadge label="Disabled" variant="warning" />
                            )}
                            <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                              #{pol.index}
                            </span>
                          </div>
                          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {pol.name}
                          </div>
                          {pol.description && (
                            <p className="text-xs text-slate-600 dark:text-slate-400">
                              {pol.description}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-slate-500 dark:text-slate-400 shrink-0">
                            Protocol
                          </span>
                          <span className="font-mono text-slate-800 dark:text-slate-200 text-right">
                            {pol.protocol || 'All Protocols'}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-slate-500 dark:text-slate-400 shrink-0">
                            Return Traffic
                          </span>
                          <span className="font-mono text-slate-800 dark:text-slate-200 text-right">
                            {pol.allowReturnTraffic ? 'Auto-Allow Stateful' : 'Off'}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-slate-500 dark:text-slate-400 shrink-0">
                            Source Criteria
                          </span>
                          <span className="font-mono text-slate-800 dark:text-slate-200 text-right break-all">
                            {pol.sourceFilterSummary || 'Any source in zone'}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-slate-500 dark:text-slate-400 shrink-0">
                            Destination Criteria
                          </span>
                          <span className="font-mono text-slate-800 dark:text-slate-200 text-right break-all">
                            {pol.destinationFilterSummary || 'Any destination in zone'}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-slate-500 dark:text-slate-400 shrink-0">
                            Connection States
                          </span>
                          <span className="font-mono text-slate-800 dark:text-slate-200 text-right">
                            {pol.connectionStates.length > 0
                              ? pol.connectionStates.join(', ')
                              : 'All states'}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-slate-500 dark:text-slate-400 shrink-0">
                            Schedule / Syslog
                          </span>
                          <span className="font-mono text-slate-800 dark:text-slate-200 text-right">
                            {pol.scheduleMode || 'ALWAYS'} •{' '}
                            {pol.loggingEnabled ? 'Syslog ON' : 'Syslog OFF'}
                          </span>
                        </div>
                        <div className="sm:col-span-2 flex items-baseline justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/70">
                          <span className="text-slate-500 dark:text-slate-400 shrink-0">
                            Rule ID
                          </span>
                          <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400 break-all text-right">
                            {pol.id}
                          </span>
                        </div>
                      </div>
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
