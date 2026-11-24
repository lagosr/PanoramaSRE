import React, { useEffect, useMemo, useState } from 'react';
import { SegmentedControl, StatusBadge, ToggleSwitch } from '@lagosr/panorama-ui-kit';
import {
  ArrowLeftRight,
  ArrowRight,
  ExternalLink,
  Filter,
  Network,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Wifi,
} from 'lucide-react';
import { CustomSelect } from '../ui/CustomSelect';
import { CopyableAddressText, CopyableValue } from '../ui/CopyableValue';
import { UnifiZoneFlowExplorer } from './UnifiZoneFlowExplorer';
import { formatLocalDateTime, formatRelativeTime } from '../../lib/formatters';
import type {
  LanClientBaselineRow,
  UnifiNetworkDto,
  UnifiPolicyDto,
  UnifiTopologySnapshotDto,
  UnifiZoneDto,
} from '../../lib/types';
import {
  buildZbfMatrix,
  computeZoneReachability,
  getVlanBadgeStyle,
  type ZbfCellVerdict,
} from '../../lib/unifi-zbf';

type PanelTab = 'flow' | 'matrix' | 'vlans' | 'rules';

interface UnifiVlanZbfPanelProps {
  topology: UnifiTopologySnapshotDto | null;
  isLoading: boolean;
  error: string | null;
  selectedVlanFilter: string;
  onSelectVlanFilter: (vlanName: string) => void;
  onRefresh: () => void;
  onOpenUnifiFirewall: () => void;
  lanClients?: LanClientBaselineRow[];
  onToggleLanTrust?: (client: LanClientBaselineRow, trusted: boolean) => void;
}

function verdictPillMeta(verdict: ZbfCellVerdict): {
  shortLabel: string;
  fullLabel: string;
  cellClass: string;
  badgeVariant: 'success' | 'info' | 'warning' | 'danger' | 'neutral';
} {
  switch (verdict) {
    case 'ALLOW':
      return {
        shortLabel: 'ALLOW',
        fullLabel: 'Allowed',
        cellClass:
          'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25',
        badgeVariant: 'success',
      };
    case 'ALLOW_WITH_BLOCKS':
      return {
        shortLabel: 'ALLOW −',
        fullLabel: 'Allowed w/ Blocks',
        cellClass:
          'bg-teal-500/15 text-teal-800 dark:text-teal-300 border-teal-500/30 hover:bg-teal-500/25',
        badgeVariant: 'info',
      };
    case 'RESTRICTED_ALLOW':
      return {
        shortLabel: 'LIMITED',
        fullLabel: 'Limited Pinholes',
        cellClass:
          'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/25',
        badgeVariant: 'warning',
      };
    case 'RETURN_ONLY':
      return {
        shortLabel: 'RETURN',
        fullLabel: 'Return Only',
        cellClass:
          'bg-sky-500/10 text-sky-800 dark:text-sky-300 border-sky-500/30 hover:bg-sky-500/20',
        badgeVariant: 'info',
      };
    case 'BLOCKED':
      return {
        shortLabel: 'BLOCKED',
        fullLabel: 'Blocked',
        cellClass:
          'bg-rose-500/10 text-rose-800 dark:text-rose-300 border-rose-500/30 hover:bg-rose-500/20',
        badgeVariant: 'danger',
      };
  }
}

export const UnifiVlanZbfPanel: React.FC<UnifiVlanZbfPanelProps> = ({
  topology,
  isLoading,
  error,
  selectedVlanFilter,
  onSelectVlanFilter,
  onRefresh,
  onOpenUnifiFirewall,
  lanClients = [],
  onToggleLanTrust,
}) => {
  const [panelTab, setPanelTab] = useState<PanelTab>('flow');
  const [activeZonesOnly, setActiveZonesOnly] = useState<boolean>(true);
  const [selectedPair, setSelectedPair] = useState<{ srcId: string; dstId: string } | null>(null);
  const [customRulesOnly, setCustomRulesOnly] = useState<boolean>(false);
  const [ruleSearch, setRuleSearch] = useState<string>('');
  const [ruleZoneFilter, setRuleZoneFilter] = useState<string>('ALL');

  const zones = topology?.zones ?? [];
  const networks = topology?.networks ?? [];
  const policies = topology?.policies ?? [];

  const matrix = useMemo(
    () => buildZbfMatrix(zones, policies, { activeOnly: activeZonesOnly }),
    [zones, policies, activeZonesOnly]
  );

  const zoneById = useMemo(() => {
    const map = new Map<string, UnifiZoneDto>();
    for (const z of zones) {
      map.set(z.id, z);
    }
    return map;
  }, [zones]);

  const sortedNetworks = useMemo(() => {
    return networks.slice().sort((a, b) => {
      const av = a.vlanId ?? 99999;
      const bv = b.vlanId ?? 99999;
      if (av !== bv) return av - bv;
      return a.name.localeCompare(b.name);
    });
  }, [networks]);

  // Select a helpful default cross-zone pair once matrix populates
  useEffect(() => {
    if (matrix.zones.length === 0) {
      setSelectedPair(null);
      return;
    }
    if (
      selectedPair &&
      matrix.cells[selectedPair.srcId]?.[selectedPair.dstId]
    ) {
      return;
    }

    // Prefer first cross-zone pair with user-defined rules
    for (const src of matrix.zones) {
      for (const dst of matrix.zones) {
        if (src.id === dst.id) continue;
        const c = matrix.cells[src.id]?.[dst.id];
        if (c && c.userRuleCount > 0) {
          setSelectedPair({ srcId: src.id, dstId: dst.id });
          return;
        }
      }
    }

    const first = matrix.zones[0];
    const second = matrix.zones[1] ?? matrix.zones[0];
    setSelectedPair({ srcId: first.id, dstId: second.id });
  }, [matrix, selectedPair]);

  const selectedCell =
    selectedPair && matrix.cells[selectedPair.srcId]?.[selectedPair.dstId]
      ? matrix.cells[selectedPair.srcId][selectedPair.dstId]
      : null;

  const selectedSrcZone = selectedPair ? zoneById.get(selectedPair.srcId) ?? null : null;
  const selectedDstZone = selectedPair ? zoneById.get(selectedPair.dstId) ?? null : null;

  const inspectorRules = useMemo(() => {
    if (!selectedCell) return [];
    return customRulesOnly
      ? selectedCell.rules.filter((r) => r.origin.toUpperCase() === 'USER_DEFINED')
      : selectedCell.rules;
  }, [selectedCell, customRulesOnly]);

  const filteredCustomRules = useMemo(() => {
    const q = ruleSearch.trim().toLowerCase();
    return matrix.customPolicies.filter((pol) => {
      if (
        ruleZoneFilter !== 'ALL' &&
        pol.sourceZoneId !== ruleZoneFilter &&
        pol.destinationZoneId !== ruleZoneFilter
      ) {
        return false;
      }
      if (!q) return true;
      const srcName = pol.sourceZoneId ? zoneById.get(pol.sourceZoneId)?.name ?? '' : '';
      const dstName = pol.destinationZoneId ? zoneById.get(pol.destinationZoneId)?.name ?? '' : '';
      const hay = [
        pol.name,
        pol.action,
        srcName,
        dstName,
        pol.protocol ?? '',
        pol.sourceFilterSummary ?? '',
        pol.destinationFilterSummary ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [matrix.customPolicies, ruleSearch, ruleZoneFilter, zoneById]);

  const jumpToBaselineFilter = (net: UnifiNetworkDto) => {
    const label = net.vlanId != null ? `${net.name} (VLAN ${net.vlanId})` : net.name;
    const isSame = selectedVlanFilter.toLowerCase() === label.toLowerCase();
    onSelectVlanFilter(isSame ? 'ALL' : label);
    document.getElementById('lan-device-baseline')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  const inspectZonesByName = (srcZoneId: string, dstZoneName: string) => {
    const target = matrix.zones.find(
      (z) => z.name.trim().toLowerCase() === dstZoneName.trim().toLowerCase()
    );
    if (!target) return;
    setSelectedPair({ srcId: srcZoneId, dstId: target.id });
    setPanelTab('matrix');
  };

  const renderPolicyRow = (pol: UnifiPolicyDto, showZones = false) => {
    const isAllow = pol.action.toUpperCase() === 'ALLOW';
    const isUser = pol.origin.toUpperCase() === 'USER_DEFINED';
    const srcName = pol.sourceZoneId ? zoneById.get(pol.sourceZoneId)?.name ?? pol.sourceZoneId : '—';
    const dstName = pol.destinationZoneId
      ? zoneById.get(pol.destinationZoneId)?.name ?? pol.destinationZoneId
      : '—';

    return (
      <div
        key={pol.id}
        className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
              {pol.index >= 2_000_000_000 ? 'Default' : `#${pol.index}`}
            </span>
            <StatusBadge
              label={pol.action.toUpperCase()}
              variant={isAllow ? 'success' : 'danger'}
            />
            {isAllow && pol.allowReturnTraffic && (
              <StatusBadge label="⇄ Return" variant="info" />
            )}
            <StatusBadge
              label={isUser ? 'Custom' : 'System'}
              variant={isUser ? 'accent' : 'neutral'}
            />
            {!pol.enabled && <StatusBadge label="Disabled" variant="warning" />}
            <span className="font-semibold text-slate-900 dark:text-slate-100">{pol.name}</span>
          </div>

          {showZones && (
            <div className="flex items-center gap-1.5 font-mono text-[11px] shrink-0">
              <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                {srcName}
              </span>
              <ArrowRight className="w-3 h-3 text-slate-400" />
              <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                {dstName}
              </span>
              {pol.sourceZoneId && pol.destinationZoneId && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPair({
                      srcId: pol.sourceZoneId!,
                      dstId: pol.destinationZoneId!,
                    });
                    setPanelTab('matrix');
                  }}
                  className="btn-ghost text-[11px] px-2 py-1 min-h-[28px] whitespace-nowrap flex-shrink-0"
                >
                  Inspect
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-slate-600 dark:text-slate-400">
          {pol.protocol && <span>Proto: {pol.protocol}</span>}
          {pol.sourceFilterSummary && (
            <span>
              Src Filter: <CopyableAddressText text={pol.sourceFilterSummary} />
            </span>
          )}
          {pol.destinationFilterSummary && (
            <span>
              Dst Filter: <CopyableAddressText text={pol.destinationFilterSummary} />
            </span>
          )}
          {pol.connectionStates.length > 0 && (
            <span>State: {pol.connectionStates.join(', ')}</span>
          )}
          {pol.scheduleMode && pol.scheduleMode !== 'ALWAYS' && (
            <span>Schedule: {pol.scheduleMode}</span>
          )}
          {pol.loggingEnabled && <span className="text-sky-600 dark:text-sky-400">Syslog ON</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Network className="w-5 h-5 text-[var(--color-brand-text)] shrink-0" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              UniFi VLANs &amp; Zone-Based Firewall Segmentation
            </h3>
            {topology && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono tabular-nums">
                <StatusBadge label={`${networks.length} VLANs`} variant="info" />
                <StatusBadge label={`${matrix.zones.length} Active Zones`} variant="accent" />
                <StatusBadge
                  label={`${matrix.customPolicies.length} Custom / ${policies.length} Total Rules`}
                  variant="neutral"
                />
              </div>
            )}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Live VLAN subnets, firewall zone assignments, and source → destination Zone-Based Firewall (ZBF) reachability read directly from UniFi Network Integration API v1.
            {topology?.capturedAt && (
              <span
                className="ml-2 font-mono text-[11px] text-slate-500"
                title={formatLocalDateTime(topology.capturedAt)}
              >
                (Synced {formatRelativeTime(topology.capturedAt)})
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? 'Syncing Topology...' : 'Refresh Live Topology'}</span>
          </button>
          <button
            type="button"
            onClick={onOpenUnifiFirewall}
            className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open UniFi Firewall</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs font-mono text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Navigation & Filter Bar */}
      {topology && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-200 dark:border-slate-800">
          <SegmentedControl<PanelTab>
            activeVariant="brand"
            value={panelTab}
            onChange={setPanelTab}
            options={[
              { value: 'flow', label: 'Zone Flow Explorer' },
              { value: 'matrix', label: 'Segmentation Matrix' },
              {
                value: 'vlans',
                label: 'VLAN Directory',
                badge: <span className="tabular-nums font-mono">{networks.length}</span>,
              },
              {
                value: 'rules',
                label: 'Custom Rules',
                badge: (
                  <span className="tabular-nums font-mono">{matrix.customPolicies.length}</span>
                ),
              },
            ]}
          />

          <div className="flex items-center gap-2.5 text-xs">
            <span className="font-mono text-slate-600 dark:text-slate-400">Active Zones Only</span>
            <ToggleSwitch
              size="sm"
              checked={activeZonesOnly}
              onChange={setActiveZonesOnly}
              activeColor="brand"
            />
          </div>
        </div>
      )}

      {!topology && !isLoading && (
        <div className="p-8 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center space-y-2">
          <Wifi className="w-6 h-6 text-slate-400 mx-auto" />
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            UniFi VLAN &amp; Firewall Topology Not Synced Yet
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto">
            Click <strong>Refresh Live Topology</strong> above (or run a 360° Threat Audit) to load all UniFi VLANs, CIDR subnets, security zones, and Zone-Based Firewall policies.
          </p>
        </div>
      )}

      {!topology && isLoading && (
        <div className="p-8 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center text-xs font-mono text-slate-500 flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Querying UniFi VLAN subnets, zones, and 270+ ZBF policies...</span>
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-VIEW 0: INTERACTIVE ZONE FLOW WIRE EXPLORER                   */}
      {/* ================================================================= */}
      {topology && panelTab === 'flow' && (
        <UnifiZoneFlowExplorer
          topology={topology}
          matrix={matrix}
          lanClients={lanClients}
          onToggleLanTrust={onToggleLanTrust}
          renderPolicyRow={renderPolicyRow}
          onOpenUnifiFirewall={onOpenUnifiFirewall}
        />
      )}

      {/* ================================================================= */}
      {/* SUB-VIEW A: ZONE-BASED FIREWALL SEGMENTATION MATRIX               */}
      {/* ================================================================= */}
      {topology && panelTab === 'matrix' && (
        <div className="space-y-4">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
            <span className="text-slate-500 dark:text-slate-400 mr-1">Zone Policy Legend:</span>
            {(
              ['ALLOW', 'ALLOW_WITH_BLOCKS', 'RESTRICTED_ALLOW', 'RETURN_ONLY', 'BLOCKED'] as ZbfCellVerdict[]
            ).map((v) => {
              const meta = verdictPillMeta(v);
              return (
                <span
                  key={v}
                  className={`px-2 py-0.5 rounded-lg border font-semibold ${meta.cellClass}`}
                >
                  {meta.shortLabel} = {meta.fullLabel}
                </span>
              );
            })}
          </div>

          {/* Interactive Matrix Grid */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
                  <th className="sticky left-0 z-10 bg-slate-50 dark:bg-slate-950 py-2.5 px-3 text-left font-mono text-[10px] uppercase tracking-wider text-slate-500 border-r border-slate-200 dark:border-slate-800 min-w-[210px]">
                    Source ↓ / Destination →
                  </th>
                  {matrix.zones.map((dst) => (
                    <th
                      key={dst.id}
                      className="py-2.5 px-2 text-center font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-200 min-w-[96px]"
                      title={`${dst.name}${dst.vlanIds.length ? ` (VLAN ${dst.vlanIds.join(', ')})` : ''}`}
                    >
                      <div className="truncate max-w-[110px] mx-auto">{dst.name}</div>
                      {dst.vlanIds.length > 0 && (
                        <div className="text-[10px] font-normal text-slate-500 tabular-nums">
                          VLAN {dst.vlanIds.join(', ')}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {matrix.zones.map((src) => (
                  <tr
                    key={src.id}
                    className="hover:bg-slate-50/60 dark:hover:bg-slate-950/60"
                  >
                    <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 py-2 px-3 border-r border-slate-200 dark:border-slate-800 align-middle">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate">
                            {src.name}
                          </span>
                          {src.clientCount > 0 && (
                            <span className="text-[10px] font-mono text-slate-500 tabular-nums shrink-0">
                              {src.clientCount} dev
                            </span>
                          )}
                        </div>
                        {src.vlanIds.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {src.vlanIds.map((vid) => {
                              const style = getVlanBadgeStyle(`VLAN ${vid}`);
                              return (
                                <span
                                  key={vid}
                                  className={`px-1.5 py-0.2 rounded border font-mono text-[10px] tabular-nums ${style.chipClass}`}
                                >
                                  VLAN {vid}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-[10px] font-mono text-slate-400">
                            System Zone
                          </span>
                        )}
                      </div>
                    </td>

                    {matrix.zones.map((dst) => {
                      const cell = matrix.cells[src.id]?.[dst.id];
                      if (!cell) return <td key={dst.id} className="p-1.5 text-center">—</td>;
                      const meta = verdictPillMeta(cell.verdict);
                      const isSelected =
                        selectedPair?.srcId === src.id && selectedPair?.dstId === dst.id;
                      const isSelf = src.id === dst.id;

                      return (
                        <td key={dst.id} className="p-1.5 text-center align-middle">
                          <button
                            type="button"
                            onClick={() => setSelectedPair({ srcId: src.id, dstId: dst.id })}
                            title={`${src.name} → ${dst.name}: ${cell.summary}`}
                            className={`w-full px-1.5 py-1.5 rounded-lg border font-mono text-[10px] font-semibold leading-tight transition-all cursor-pointer tabular-nums ${
                              meta.cellClass
                            } ${isSelf ? 'opacity-75' : ''} ${
                              isSelected
                                ? 'ring-2 ring-[var(--color-brand)] ring-offset-1 dark:ring-offset-slate-900 shadow-sm'
                                : ''
                            }`}
                          >
                            <div>{meta.shortLabel}</div>
                            {cell.userRuleCount > 0 && (
                              <div className="text-[9px] opacity-80 font-normal">
                                {cell.userRuleCount} rule{cell.userRuleCount > 1 ? 's' : ''}
                              </div>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Interactive Zone-Pair Rule Inspector */}
          {selectedCell && selectedSrcZone && selectedDstZone && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-2 border-b border-slate-200 dark:border-slate-800">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Shield className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {selectedSrcZone.name}
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {selectedDstZone.name}
                    </span>
                    <StatusBadge
                      label={verdictPillMeta(selectedCell.verdict).fullLabel}
                      variant={verdictPillMeta(selectedCell.verdict).badgeVariant}
                    />
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {selectedCell.summary}
                    {selectedCell.verdict === 'RETURN_ONLY' && selectedCell.hasReverseReturnPath && (
                      <span>
                        {' '}
                        — Established replies from {selectedDstZone.name} → {selectedSrcZone.name} are permitted.
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 shrink-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-slate-600 dark:text-slate-400">
                      Custom Rules Only
                    </span>
                    <ToggleSwitch
                      size="sm"
                      checked={customRulesOnly}
                      onChange={setCustomRulesOnly}
                      activeColor="brand"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPair({
                        srcId: selectedDstZone.id,
                        dstId: selectedSrcZone.id,
                      })
                    }
                    className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    <span>Flip Direction</span>
                  </button>
                </div>
              </div>

              {inspectorRules.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-500 text-center">
                  {customRulesOnly
                    ? 'No custom user-defined rules on this zone pair. Toggle "Custom Rules Only" off to inspect system default rules.'
                    : 'No explicit rules returned for this zone pair.'}
                </div>
              ) : (
                <div className="space-y-2">{inspectorRules.map((pol) => renderPolicyRow(pol, false))}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-VIEW B: COLOR-CODED VLAN DIRECTORY                            */}
      {/* ================================================================= */}
      {topology && panelTab === 'vlans' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 tabular-nums">
          {sortedNetworks.map((net) => {
            const style = getVlanBadgeStyle(
              net.vlanId != null ? `${net.name} (VLAN ${net.vlanId})` : net.name
            );
            const reach = net.zoneId ? computeZoneReachability(matrix, net.zoneId) : null;
            const filterLabel =
              net.vlanId != null ? `${net.name} (VLAN ${net.vlanId})` : net.name;
            const isActiveFilter =
              selectedVlanFilter.trim().toLowerCase() === filterLabel.toLowerCase();

            return (
              <div
                key={net.id}
                className={`rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 space-y-3 ${style.borderAccentClass}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${style.dotClass}`} />
                      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug break-words">
                        {net.name}
                      </h4>
                      {net.vlanId != null && (
                        <span
                          className={`px-2 py-0.5 rounded border font-mono text-[11px] font-semibold ${style.chipClass}`}
                        >
                          VLAN {net.vlanId}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                      <span>Zone: {net.zoneName || 'Unassigned'}</span>
                      {net.isDefault && <span>• Default LAN</span>}
                      {!net.enabled && <StatusBadge label="Disabled" variant="warning" />}
                    </div>
                  </div>

                  <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 shrink-0">
                    {net.clientCount} client{net.clientCount === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-white dark:bg-slate-900 rounded-lg p-2.5 border border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="text-slate-400 text-[10px]">CIDR SUBNET</div>
                    <div className="text-slate-800 dark:text-slate-200 font-semibold">
                      <CopyableValue value={net.subnetCidr} label="VLAN subnet CIDR" fallback="—" />
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[10px]">GATEWAY IP</div>
                    <div className="text-slate-800 dark:text-slate-200 font-semibold">
                      <CopyableValue value={net.gatewayIp} label="VLAN gateway IP" fallback="—" />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                  <StatusBadge
                    label={net.internetAccessEnabled ? 'Internet ON' : 'Internet OFF'}
                    variant={net.internetAccessEnabled ? 'info' : 'warning'}
                  />
                  <StatusBadge
                    label={net.isolationEnabled ? 'Client Isolation ON' : 'Intra-VLAN Open'}
                    variant={net.isolationEnabled ? 'success' : 'neutral'}
                  />
                  <StatusBadge
                    label={net.mdnsForwardingEnabled ? 'mDNS Relay ON' : 'mDNS OFF'}
                    variant={net.mdnsForwardingEnabled ? 'accent' : 'neutral'}
                  />
                </div>

                {reach && net.zoneId && (
                  <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-800 text-[11px]">
                    {reach.canReach.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold mr-1">
                          CAN REACH:
                        </span>
                        {reach.canReach.map((zName) => (
                          <button
                            key={zName}
                            type="button"
                            onClick={() => inspectZonesByName(net.zoneId!, zName)}
                            className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30 font-mono text-[10px] hover:bg-emerald-500/20 cursor-pointer"
                          >
                            {zName}
                          </button>
                        ))}
                      </div>
                    )}
                    {reach.limitedTo.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="font-mono text-[10px] text-amber-700 dark:text-amber-400 font-semibold mr-1">
                          PINHOLES:
                        </span>
                        {reach.limitedTo.map((zName) => (
                          <button
                            key={zName}
                            type="button"
                            onClick={() => inspectZonesByName(net.zoneId!, zName)}
                            className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/30 font-mono text-[10px] hover:bg-amber-500/20 cursor-pointer"
                          >
                            {zName}
                          </button>
                        ))}
                      </div>
                    )}
                    {reach.blockedFrom.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="font-mono text-[10px] text-rose-700 dark:text-rose-400 font-semibold mr-1">
                          BLOCKED:
                        </span>
                        {reach.blockedFrom.slice(0, 5).map((zName) => (
                          <button
                            key={zName}
                            type="button"
                            onClick={() => inspectZonesByName(net.zoneId!, zName)}
                            className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-800 dark:text-rose-300 border border-rose-500/30 font-mono text-[10px] hover:bg-rose-500/20 cursor-pointer"
                          >
                            {zName}
                          </button>
                        ))}
                        {reach.blockedFrom.length > 5 && (
                          <span className="font-mono text-[10px] text-slate-500">
                            +{reach.blockedFrom.length - 5} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-1 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => jumpToBaselineFilter(net)}
                    className={`${
                      isActiveFilter ? 'btn-primary' : 'btn-secondary'
                    } w-full text-xs flex items-center justify-center gap-1.5 whitespace-nowrap flex-shrink-0`}
                  >
                    <Filter className="w-3.5 h-3.5" />
                    <span>
                      {isActiveFilter
                        ? `Showing VLAN (${net.clientCount})`
                        : `Filter LAN Baseline (${net.clientCount})`}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-VIEW C: USER-DEFINED ZBF RULES DIRECTORY                      */}
      {/* ================================================================= */}
      {topology && panelTab === 'rules' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={ruleSearch}
                onChange={(e) => setRuleSearch(e.target.value)}
                placeholder="Filter rule name, zone, IP, port, protocol..."
                className="w-full pl-8 pr-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
              />
            </div>
            <div className="w-full sm:w-56">
              <CustomSelect
                value={ruleZoneFilter}
                onChange={setRuleZoneFilter}
                options={[
                  { value: 'ALL', label: `All Zones (${matrix.customPolicies.length})` },
                  ...matrix.zones.map((z) => ({
                    value: z.id,
                    label: z.name,
                  })),
                ]}
              />
            </div>
          </div>

          {filteredCustomRules.length === 0 ? (
            <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
              No custom firewall rules match your search filter.
            </div>
          ) : (
            <div className="space-y-2">{filteredCustomRules.map((pol) => renderPolicyRow(pol, true))}</div>
          )}
        </div>
      )}
    </div>
  );
};
