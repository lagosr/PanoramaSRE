import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StatusBadge, ToggleSwitch } from '@lagosr/panorama-ui-kit';
import {
  ArrowLeftRight,
  ArrowRight,
  Cable,
  Check,
  Laptop,
  Network,
  Search,
  Shield,
  ShieldCheck,
  Wifi,
  X,
} from 'lucide-react';
import type {
  LanClientBaselineRow,
  UnifiPolicyDto,
  UnifiTopologySnapshotDto,
  UnifiZoneDto,
} from '../../lib/types';
import {
  buildZoneFlowConnections,
  getClientsForZone,
  getVlanBadgeStyle,
  getZoneScopedRules,
  pickDefaultFlowZoneIds,
  type ZbfCellVerdict,
  type ZbfMatrixResult,
  type ZoneFlowConnection,
} from '../../lib/unifi-zbf';

interface UnifiZoneFlowExplorerProps {
  topology: UnifiTopologySnapshotDto;
  matrix: ZbfMatrixResult;
  lanClients?: LanClientBaselineRow[];
  onToggleLanTrust?: (client: LanClientBaselineRow, trusted: boolean) => void;
  renderPolicyRow: (pol: UnifiPolicyDto, showZones?: boolean) => React.ReactNode;
}

interface WireGeometry {
  connection: ZoneFlowConnection;
  pathD: string;
  labelX: number;
  labelY: number;
}

function wireStrokeStyle(verdict: ZbfCellVerdict): {
  stroke: string;
  markerId: string;
  dashArray?: string;
  pillClass: string;
  badgeVariant: 'success' | 'info' | 'warning' | 'danger' | 'neutral';
  shortLabel: string;
  fullLabel: string;
} {
  switch (verdict) {
    case 'ALLOW':
      return {
        stroke: '#10b981',
        markerId: 'zbf-arrow-allow',
        pillClass:
          'border-emerald-500/50 text-emerald-800 dark:text-emerald-300 hover:border-emerald-400',
        badgeVariant: 'success',
        shortLabel: 'ALLOW',
        fullLabel: 'Allowed',
      };
    case 'ALLOW_WITH_BLOCKS':
      return {
        stroke: '#14b8a6',
        markerId: 'zbf-arrow-allow-blocks',
        pillClass:
          'border-teal-500/50 text-teal-800 dark:text-teal-300 hover:border-teal-400',
        badgeVariant: 'info',
        shortLabel: 'ALLOW −',
        fullLabel: 'Allowed w/ Blocks',
      };
    case 'RESTRICTED_ALLOW':
      return {
        stroke: '#f59e0b',
        markerId: 'zbf-arrow-limited',
        dashArray: '7 4',
        pillClass:
          'border-amber-500/50 text-amber-800 dark:text-amber-300 hover:border-amber-400',
        badgeVariant: 'warning',
        shortLabel: 'LIMITED',
        fullLabel: 'Limited Pinholes',
      };
    case 'RETURN_ONLY':
      return {
        stroke: '#38bdf8',
        markerId: 'zbf-arrow-return',
        dashArray: '4 4',
        pillClass:
          'border-sky-500/50 text-sky-800 dark:text-sky-300 hover:border-sky-400',
        badgeVariant: 'info',
        shortLabel: 'RETURN',
        fullLabel: 'Return Only',
      };
    case 'BLOCKED':
      return {
        stroke: '#f43f5e',
        markerId: 'zbf-arrow-blocked',
        dashArray: '2 5',
        pillClass:
          'border-rose-500/50 text-rose-800 dark:text-rose-300 hover:border-rose-400',
        badgeVariant: 'danger',
        shortLabel: 'BLOCKED',
        fullLabel: 'Blocked',
      };
  }
}

export const UnifiZoneFlowExplorer: React.FC<UnifiZoneFlowExplorerProps> = ({
  topology,
  matrix,
  lanClients = [],
  onToggleLanTrust,
  renderPolicyRow,
}) => {
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [showReturnWires, setShowReturnWires] = useState<boolean>(false);
  const [showBlockedWires, setShowBlockedWires] = useState<boolean>(false);
  const [customRulesOnly, setCustomRulesOnly] = useState<boolean>(false);
  const [zoneRuleScopeById, setZoneRuleScopeById] = useState<Record<string, 'selected' | 'all'>>({});
  const [zoneClientSearchById, setZoneClientSearchById] = useState<Record<string, string>>({});
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);
  const [wireGeometries, setWireGeometries] = useState<WireGeometry[]>([]);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const seededTopologyRef = useRef<boolean>(false);

  // Seed default selected zones once matrix loads, and drop invalid IDs if zones refresh
  useEffect(() => {
    const validIds = new Set(matrix.zones.map((z) => z.id));
    if (!seededTopologyRef.current && matrix.zones.length > 0) {
      seededTopologyRef.current = true;
      setSelectedZoneIds(pickDefaultFlowZoneIds(matrix, 3));
      return;
    }
    setSelectedZoneIds((prev) => {
      const next = prev.filter((id) => validIds.has(id));
      return next.length > 0 ? next : pickDefaultFlowZoneIds(matrix, 3);
    });
  }, [matrix]);

  const selectedZones = useMemo(() => {
    const map = new Map(matrix.zones.map((z) => [z.id, z]));
    return selectedZoneIds
      .map((id) => map.get(id))
      .filter((z): z is UnifiZoneDto => Boolean(z));
  }, [matrix.zones, selectedZoneIds]);

  const connections = useMemo(
    () =>
      buildZoneFlowConnections(matrix, selectedZoneIds, {
        showReturnWires,
        showBlockedWires,
        customRulesOnly,
      }),
    [matrix, selectedZoneIds, showReturnWires, showBlockedWires, customRulesOnly]
  );

  // Keep activeConnectionId synchronized with visible wires
  useEffect(() => {
    if (connections.length === 0) {
      setActiveConnectionId(null);
      return;
    }
    if (activeConnectionId && connections.some((c) => c.id === activeConnectionId)) {
      return;
    }
    const preferred =
      connections.find((c) => c.customRuleCount > 0) ?? connections[0];
    setActiveConnectionId(preferred?.id ?? null);
  }, [connections, activeConnectionId]);

  const activeConnection = useMemo(
    () => connections.find((c) => c.id === activeConnectionId) ?? null,
    [connections, activeConnectionId]
  );

  const trustByMac = useMemo(() => {
    const map = new Map<string, LanClientBaselineRow>();
    for (const c of lanClients) {
      map.set(c.macAddress.trim().toUpperCase(), c);
    }
    return map;
  }, [lanClients]);

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

  const toggleZoneSelection = (zoneId: string) => {
    setSelectedZoneIds((prev) =>
      prev.includes(zoneId) ? prev.filter((id) => id !== zoneId) : [...prev, zoneId]
    );
  };

  const handleSelectConnectedLan = () => {
    const connected = pickDefaultFlowZoneIds(matrix, 4);
    setSelectedZoneIds(connected);
  };

  const handleSelectAllUserZones = () => {
    const userZones = matrix.zones
      .filter((z) => z.origin.toUpperCase() !== 'SYSTEM_DEFINED' || z.name.toLowerCase() === 'internal')
      .map((z) => z.id);
    setSelectedZoneIds(userZones);
  };

  const recalculateWires = useCallback(() => {
    const container = canvasRef.current;
    if (!container || connections.length === 0) {
      setWireGeometries([]);
      return;
    }
    const cRect = container.getBoundingClientRect();
    const width = container.scrollWidth || cRect.width;
    const height = container.scrollHeight || cRect.height;
    setCanvasSize({ width, height });

    const geometries: WireGeometry[] = [];

    for (const conn of connections) {
      const srcEl = cardRefs.current.get(conn.sourceZoneId);
      const dstEl = cardRefs.current.get(conn.destinationZoneId);
      if (!srcEl || !dstEl) continue;

      const sRect = srcEl.getBoundingClientRect();
      const dRect = dstEl.getBoundingClientRect();
      if (sRect.width === 0 || dRect.width === 0) continue;

      const sLeft = sRect.left - cRect.left + container.scrollLeft;
      const sTop = sRect.top - cRect.top + container.scrollTop;
      const sCenterX = sLeft + sRect.width / 2;
      const sCenterY = sTop + sRect.height / 2;

      const dLeft = dRect.left - cRect.left + container.scrollLeft;
      const dTop = dRect.top - cRect.top + container.scrollTop;
      const dCenterX = dLeft + dRect.width / 2;
      const dCenterY = dTop + dRect.height / 2;

      const dx = dCenterX - sCenterX;
      const dy = dCenterY - sCenterY;
      const dist = Math.hypot(dx, dy);
      if (!Number.isFinite(dist) || dist < 1) continue;

      // Facing edge anchor points
      const horizontalPrimary = Math.abs(dx) * 0.85 >= Math.abs(dy);
      let x1 = sCenterX;
      let y1 = sCenterY;
      let x2 = dCenterX;
      let y2 = dCenterY;
      let tx1 = 0;
      let ty1 = 0;
      let tx2 = 0;
      let ty2 = 0;

      if (horizontalPrimary) {
        if (dx >= 0) {
          x1 = sLeft + sRect.width;
          x2 = dLeft;
          tx1 = 1;
          tx2 = -1;
        } else {
          x1 = sLeft;
          x2 = dLeft + dRect.width;
          tx1 = -1;
          tx2 = 1;
        }
        y1 = sCenterY;
        y2 = dCenterY;
      } else {
        if (dy >= 0) {
          y1 = sTop + sRect.height;
          y2 = dTop;
          ty1 = 1;
          ty2 = -1;
        } else {
          y1 = sTop;
          y2 = dTop + dRect.height;
          ty1 = -1;
          ty2 = 1;
        }
        x1 = sCenterX;
        x2 = dCenterX;
      }

      // Separate bidirectional opposing wires cleanly along right-hand perpendicular normal
      const edgeDx = x2 - x1;
      const edgeDy = y2 - y1;
      const edgeDist = Math.max(1, Math.hypot(edgeDx, edgeDy));
      const nx = -edgeDy / edgeDist;
      const ny = edgeDx / edgeDist;
      const laneOffset = conn.hasOppositeWire ? 20 : 0;

      const sx = x1 + nx * laneOffset;
      const sy = y1 + ny * laneOffset;
      const ex = x2 + nx * laneOffset;
      const ey = y2 + ny * laneOffset;

      const curveHandle = Math.max(46, Math.min(130, edgeDist * 0.42));
      const archBoost = conn.hasOppositeWire ? 26 : 0;
      const c1x = sx + tx1 * curveHandle + nx * archBoost;
      const c1y = sy + ty1 * curveHandle + ny * archBoost;
      const c2x = ex + tx2 * curveHandle + nx * archBoost;
      const c2y = ey + ty2 * curveHandle + ny * archBoost;

      const labelX = 0.125 * sx + 0.375 * c1x + 0.375 * c2x + 0.125 * ex;
      const labelY = 0.125 * sy + 0.375 * c1y + 0.375 * c2y + 0.125 * ey;

      if (!Number.isFinite(labelX) || !Number.isFinite(labelY)) continue;

      geometries.push({
        connection: conn,
        pathD: `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`,
        labelX,
        labelY,
      });
    }

    setWireGeometries(geometries);
  }, [connections]);

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => recalculateWires());
    return () => cancelAnimationFrame(raf);
  }, [recalculateWires, selectedZones, zoneRuleScopeById, zoneClientSearchById]);

  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => recalculateWires());
    ro.observe(container);
    for (const z of selectedZones) {
      const el = cardRefs.current.get(z.id);
      if (el) ro.observe(el);
    }
    const onWinResize = () => recalculateWires();
    window.addEventListener('resize', onWinResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onWinResize);
    };
  }, [recalculateWires, selectedZones]);

  return (
    <div className="space-y-4">
      {/* Multi-Zone Selector & Wire Visibility Controls */}
      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          <div className="space-y-0.5">
            <div className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              Select Firewall Zones to Inspect ({selectedZones.length} active)
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Multi-select 2 or more zones to draw directional firewall wires showing allowed access, pinholes, and governing rules between zones.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleSelectConnectedLan}
              className="btn-tonal text-xs whitespace-nowrap flex-shrink-0"
            >
              Connected LAN
            </button>
            <button
              type="button"
              onClick={handleSelectAllUserZones}
              className="btn-secondary text-xs whitespace-nowrap flex-shrink-0"
            >
              All LAN Zones
            </button>
            {selectedZoneIds.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedZoneIds([])}
                className="btn-ghost text-xs whitespace-nowrap flex-shrink-0"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Multi-Select Zone Chips */}
        <div className="flex flex-wrap gap-2">
          {matrix.zones.map((zone) => {
            const isSelected = selectedZoneIds.includes(zone.id);
            const firstVlan = zone.vlanIds[0];
            const style = getVlanBadgeStyle(
              firstVlan != null ? `VLAN ${firstVlan}` : zone.name
            );
            return (
              <button
                key={zone.id}
                type="button"
                onClick={() => toggleZoneSelection(zone.id)}
                className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap flex-shrink-0 ${
                  isSelected
                    ? 'bg-[var(--color-brand-subtle)] border-[var(--color-brand)] text-slate-900 dark:text-slate-100 shadow-sm font-semibold'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500'
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${style.dotClass}`} />
                <span>{zone.name}</span>
                {zone.vlanIds.length > 0 && (
                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                    VLAN {zone.vlanIds.join(',')}
                  </span>
                )}
                <span className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                  {zone.clientCount}
                </span>
                {isSelected && <Check className="w-3.5 h-3.5 text-[var(--color-brand-text)] shrink-0" />}
              </button>
            );
          })}
        </div>

        {/* Wire Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <ToggleSwitch
                size="sm"
                checked={customRulesOnly}
                onChange={setCustomRulesOnly}
                activeColor="brand"
              />
              <span className="font-mono text-slate-700 dark:text-slate-300">
                Custom Rule Wires Only
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <ToggleSwitch
                size="sm"
                checked={showReturnWires}
                onChange={setShowReturnWires}
                activeColor="brand"
              />
              <span className="font-mono text-slate-700 dark:text-slate-300">
                Show Return Traffic
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <ToggleSwitch
                size="sm"
                checked={showBlockedWires}
                onChange={setShowBlockedWires}
                activeColor="brand"
              />
              <span className="font-mono text-slate-700 dark:text-slate-300">
                Show Blocked Pairs
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            <span className="inline-flex items-center gap-1">
              <span className="w-4 h-0.5 bg-emerald-500 inline-block" /> Allow
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-4 h-0.5 border-t-2 border-dashed border-amber-500 inline-block" /> Limited Pinhole
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-4 h-0.5 border-t-2 border-dashed border-sky-400 inline-block" /> Return Only
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-4 h-0.5 border-t-2 border-dotted border-rose-500 inline-block" /> Blocked
            </span>
          </div>
        </div>
      </div>

      {/* Zone Container + Directional Wire Canvas */}
      {selectedZones.length === 0 ? (
        <div className="p-8 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center space-y-2">
          <Network className="w-6 h-6 text-slate-400 mx-auto" />
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Select one or more firewall zones above
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Click two or more zones (or click <strong>Connected LAN</strong>) to see each zone&apos;s rules, clients, and directional connecting wires.
          </p>
        </div>
      ) : (
        <div
          ref={canvasRef}
          className="relative rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 sm:p-6 overflow-x-auto"
        >
          {/* SVG Directional Wires Layer (rendered behind interactive label pills, spanning canvas) */}
          {selectedZones.length > 1 && wireGeometries.length > 0 && (
            <svg
              aria-hidden="true"
              width={canvasSize.width || '100%'}
              height={canvasSize.height || '100%'}
              className="absolute inset-0 pointer-events-none z-20"
            >
              <defs>
                {[
                  { id: 'zbf-arrow-allow', color: '#10b981' },
                  { id: 'zbf-arrow-allow-blocks', color: '#14b8a6' },
                  { id: 'zbf-arrow-limited', color: '#f59e0b' },
                  { id: 'zbf-arrow-return', color: '#38bdf8' },
                  { id: 'zbf-arrow-blocked', color: '#f43f5e' },
                ].map((m) => (
                  <marker
                    key={m.id}
                    id={m.id}
                    viewBox="0 0 10 10"
                    refX="8.5"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.2 L 9.5 5 L 0 8.8 z" fill={m.color} />
                  </marker>
                ))}
              </defs>

              {wireGeometries.map(({ connection, pathD }) => {
                const style = wireStrokeStyle(connection.verdict);
                const isActive = activeConnectionId === connection.id;
                const isHovered = hoveredConnectionId === connection.id;
                const dimmed =
                  (hoveredConnectionId && !isHovered) ||
                  (!hoveredConnectionId && activeConnectionId && !isActive);

                return (
                  <g key={connection.id}>
                    <path
                      d={pathD}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={16}
                      className="pointer-events-auto cursor-pointer"
                      onMouseEnter={() => setHoveredConnectionId(connection.id)}
                      onMouseLeave={() => setHoveredConnectionId(null)}
                      onClick={() => setActiveConnectionId(connection.id)}
                    />
                    <path
                      d={pathD}
                      fill="none"
                      stroke={style.stroke}
                      strokeWidth={isActive || isHovered ? 3.2 : 2.1}
                      strokeDasharray={style.dashArray}
                      strokeLinecap="round"
                      strokeOpacity={dimmed ? 0.42 : 0.95}
                      markerEnd={`url(#${style.markerId})`}
                      className="transition-all"
                    />
                  </g>
                );
              })}
            </svg>
          )}

          {/* Clickable Midpoint Wire Labels */}
          {selectedZones.length > 1 &&
            wireGeometries.map(({ connection, labelX, labelY }) => {
              const style = wireStrokeStyle(connection.verdict);
              const isActive = activeConnectionId === connection.id;
              return (
                <button
                  key={`pill-${connection.id}`}
                  type="button"
                  style={{ left: `${labelX}px`, top: `${labelY}px` }}
                  onMouseEnter={() => setHoveredConnectionId(connection.id)}
                  onMouseLeave={() => setHoveredConnectionId(null)}
                  onClick={() => setActiveConnectionId(connection.id)}
                  title={`${connection.sourceZoneName} → ${connection.destinationZoneName}: ${connection.primaryRuleName} (${connection.summary})`}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 z-30 px-2.5 py-1 rounded-full bg-white dark:bg-slate-900 border shadow-md font-mono text-[10px] font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer transition-all ${
                    style.pillClass
                  } ${
                    isActive
                      ? 'ring-2 ring-[var(--color-brand)] scale-105 shadow-lg'
                      : 'opacity-95 hover:opacity-100 hover:scale-105'
                  }`}
                >
                  <span className="max-w-[90px] truncate text-slate-500 dark:text-slate-400">
                    {connection.sourceZoneName}
                  </span>
                  <ArrowRight className="w-3 h-3 shrink-0" />
                  <span className="max-w-[90px] truncate text-slate-500 dark:text-slate-400">
                    {connection.destinationZoneName}
                  </span>
                  <span>·</span>
                  <span>{style.shortLabel}</span>
                  <span className="max-w-[140px] truncate font-normal opacity-90">
                    ({connection.primaryRuleName})
                  </span>
                </button>
              );
            })}

          {/* Zone Containers Grid */}
          <div
            className={`relative z-10 grid gap-x-28 gap-y-20 ${
              selectedZones.length === 1
                ? 'grid-cols-1 max-w-2xl mx-auto'
                : 'grid-cols-1 xl:grid-cols-2 min-w-[320px]'
            }`}
          >
            {selectedZones.map((zone) => {
              const firstVlan = zone.vlanIds[0];
              const style = getVlanBadgeStyle(
                firstVlan != null ? `VLAN ${firstVlan}` : zone.name
              );
              const subnets = subnetsByZoneId.get(zone.id) ?? [];
              const ruleScope = zoneRuleScopeById[zone.id] ?? (selectedZones.length > 1 ? 'selected' : 'all');
              const zoneRules = getZoneScopedRules(
                zone.id,
                topology.policies,
                matrix.zones,
                selectedZoneIds,
                {
                  selectedPeersOnly: selectedZones.length > 1 && ruleScope === 'selected',
                  customOnly: customRulesOnly,
                }
              );
              const zoneClients = getClientsForZone(zone, topology.clients, topology.networks);
              const clientSearch = (zoneClientSearchById[zone.id] ?? '').trim().toLowerCase();
              const visibleClients = clientSearch
                ? zoneClients.filter((cli) =>
                    [
                      cli.name ?? '',
                      cli.hostname ?? '',
                      cli.ipAddress ?? '',
                      cli.macAddress,
                      cli.ouiVendor ?? '',
                      cli.networkName ?? '',
                    ]
                      .join(' ')
                      .toLowerCase()
                      .includes(clientSearch)
                  )
                : zoneClients;

              const outOpenCount = connections.filter(
                (c) => c.sourceZoneId === zone.id && c.verdict !== 'BLOCKED'
              ).length;
              const inOpenCount = connections.filter(
                (c) => c.destinationZoneId === zone.id && c.verdict !== 'BLOCKED'
              ).length;

              return (
                <div
                  key={zone.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(zone.id, el);
                    else cardRefs.current.delete(zone.id);
                  }}
                  className={`rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col ${style.borderAccentClass}`}
                >
                  {/* Zone Container Header */}
                  <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-2 bg-white dark:bg-slate-900">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${style.dotClass}`} />
                        <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                          {zone.name}
                        </h4>
                        {zone.vlanIds.length > 0 ? (
                          zone.vlanIds.map((vid) => {
                            const vs = getVlanBadgeStyle(`VLAN ${vid}`);
                            return (
                              <span
                                key={vid}
                                className={`px-2 py-0.5 rounded border font-mono text-[10px] font-semibold tabular-nums ${vs.chipClass}`}
                              >
                                VLAN {vid}
                              </span>
                            );
                          })
                        ) : (
                          <StatusBadge label="System Zone" variant="neutral" />
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                        {subnets.length > 0 && <span>{subnets.join(', ')}</span>}
                        {selectedZones.length > 1 && (
                          <span>
                            Wires: → {outOpenCount} out • ← {inOpenCount} in
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleZoneSelection(zone.id)}
                      aria-label={`Remove ${zone.name} from flow view`}
                      title={`Hide ${zone.name}`}
                      className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* TOP SECTION: Rules Applying to This Zone */}
                  <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 space-y-2.5 bg-slate-50/70 dark:bg-slate-950/60">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider tabular-nums">
                        <Shield className="w-3.5 h-3.5 text-[var(--color-brand-text)] shrink-0" />
                        <span>Zone Rules ({zoneRules.length})</span>
                      </div>

                      {selectedZones.length > 1 && (
                        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5 text-[10px] font-mono">
                          <button
                            type="button"
                            onClick={() =>
                              setZoneRuleScopeById((prev) => ({ ...prev, [zone.id]: 'selected' }))
                            }
                            className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                              ruleScope === 'selected'
                                ? 'bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)] font-semibold'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            Selected Peers
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setZoneRuleScopeById((prev) => ({ ...prev, [zone.id]: 'all' }))
                            }
                            className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                              ruleScope === 'all'
                                ? 'bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)] font-semibold'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            All Rules
                          </button>
                        </div>
                      )}
                    </div>

                    {zoneRules.length === 0 ? (
                      <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-500 text-center">
                        {ruleScope === 'selected' && selectedZones.length > 1
                          ? 'No rules directly between selected zones — switch to All Rules or enable Return/Blocked wires.'
                          : 'No active rules match the current filter.'}
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                        {zoneRules.map((item) => {
                          const pol = item.policy;
                          const isAllow = pol.action.toUpperCase() === 'ALLOW';
                          const edgeId =
                            item.direction === 'OUT' && item.peerZoneId
                              ? `${zone.id}->${item.peerZoneId}`
                              : item.direction === 'IN' && item.peerZoneId
                              ? `${item.peerZoneId}->${zone.id}`
                              : null;
                          const canInspectWire = Boolean(
                            edgeId && connections.some((c) => c.id === edgeId)
                          );
                          const dirBadge =
                            item.direction === 'OUT'
                              ? `OUT → ${item.peerZoneName}`
                              : item.direction === 'IN'
                              ? `IN ← ${item.peerZoneName}`
                              : 'INTRA-ZONE';

                          return (
                            <div
                              key={`${zone.id}-${pol.id}-${item.direction}`}
                              onClick={() => {
                                if (canInspectWire && edgeId) {
                                  setActiveConnectionId(edgeId);
                                }
                              }}
                              className={`p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1 text-[11px] ${
                                canInspectWire
                                  ? 'cursor-pointer hover:border-[var(--color-brand)] transition-colors'
                                  : ''
                              } ${
                                edgeId && activeConnectionId === edgeId
                                  ? 'border-[var(--color-brand)] ring-1 ring-[var(--color-brand-ring)]'
                                  : ''
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                  <StatusBadge
                                    label={pol.action.toUpperCase()}
                                    variant={isAllow ? 'success' : 'danger'}
                                  />
                                  <span
                                    className={`px-1.5 py-0.5 rounded font-mono text-[10px] border ${
                                      item.connectsSelectedZone
                                        ? 'bg-[var(--color-brand-subtle)] border-[var(--color-brand-ring)] text-[var(--color-brand-text)] font-semibold'
                                        : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                                    }`}
                                  >
                                    {dirBadge}
                                  </span>
                                  {item.isCustom && (
                                    <StatusBadge label="Custom" variant="accent" />
                                  )}
                                  {isAllow && pol.allowReturnTraffic && (
                                    <StatusBadge label="⇄ Return" variant="info" />
                                  )}
                                </div>
                              </div>
                              <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {pol.name}
                              </div>
                              {(pol.protocol ||
                                pol.sourceFilterSummary ||
                                pol.destinationFilterSummary) && (
                                <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">
                                  {[
                                    pol.protocol,
                                    pol.sourceFilterSummary && `Src: ${pol.sourceFilterSummary}`,
                                    pol.destinationFilterSummary && `Dst: ${pol.destinationFilterSummary}`,
                                  ]
                                    .filter(Boolean)
                                    .join(' • ')}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* BOTTOM SECTION: Clients inside This Zone */}
                  <div className="p-3.5 space-y-2.5 flex-1 flex flex-col">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider tabular-nums">
                        <Laptop className="w-3.5 h-3.5 text-[var(--color-accent-text)] shrink-0" />
                        <span>Clients in Zone ({zoneClients.length})</span>
                      </div>

                      {zoneClients.length > 5 && (
                        <div className="relative w-44">
                          <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="text"
                            value={zoneClientSearchById[zone.id] ?? ''}
                            onChange={(e) =>
                              setZoneClientSearchById((prev) => ({
                                ...prev,
                                [zone.id]: e.target.value,
                              }))
                            }
                            placeholder="Filter clients..."
                            className="w-full pl-7 pr-2 py-1 text-[11px] font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
                          />
                        </div>
                      )}
                    </div>

                    {visibleClients.length === 0 ? (
                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-500 text-center">
                        {zoneClients.length === 0
                          ? 'No active clients currently in this zone.'
                          : 'No clients match your search.'}
                      </div>
                    ) : (
                      <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                        {visibleClients.map((cli) => {
                          const baseline = trustByMac.get(cli.macAddress.trim().toUpperCase());
                          const isTrusted = baseline?.isTrusted ?? false;
                          const isWired = (cli.clientType || '').toUpperCase() === 'WIRED';
                          return (
                            <div
                              key={cli.id || cli.macAddress}
                              className="px-2.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-xs"
                            >
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {isWired ? (
                                    <Cable className="w-3 h-3 text-slate-500 shrink-0" />
                                  ) : (
                                    <Wifi className="w-3 h-3 text-sky-500 shrink-0" />
                                  )}
                                  <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                    {cli.name || cli.hostname || cli.macAddress}
                                  </span>
                                  {cli.vlanId != null && (
                                    <span className="text-[10px] font-mono text-slate-500 tabular-nums shrink-0">
                                      VLAN {cli.vlanId}
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-2.5 text-[10px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                                  <span>{cli.ipAddress || 'no-ip'}</span>
                                  <span>{cli.macAddress}</span>
                                  {cli.ouiVendor && <span className="truncate max-w-[140px]">{cli.ouiVendor}</span>}
                                </div>
                              </div>

                              {baseline && onToggleLanTrust ? (
                                <button
                                  type="button"
                                  onClick={() => onToggleLanTrust(baseline, !isTrusted)}
                                  title={
                                    isTrusted
                                      ? 'Owner-verified LAN MAC (click to revoke trust)'
                                      : 'Click to mark hardware MAC owner-verified'
                                  }
                                  className={`px-2 py-1 rounded-lg border text-[10px] font-mono font-semibold flex items-center gap-1 whitespace-nowrap flex-shrink-0 cursor-pointer ${
                                    isTrusted
                                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                                      : 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                                  }`}
                                >
                                  <ShieldCheck className="w-3 h-3 shrink-0" />
                                  <span>{isTrusted ? 'Trusted' : 'Trust MAC'}</span>
                                </button>
                              ) : (
                                <StatusBadge
                                  label={isTrusted ? 'Trusted' : 'Unreviewed'}
                                  variant={isTrusted ? 'success' : 'neutral'}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected Wire Rule Inspector */}
      {activeConnection && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-2 border-b border-slate-200 dark:border-slate-800">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Shield className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {activeConnection.sourceZoneName}
                </span>
                <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {activeConnection.destinationZoneName}
                </span>
                <StatusBadge
                  label={wireStrokeStyle(activeConnection.verdict).fullLabel}
                  variant={wireStrokeStyle(activeConnection.verdict).badgeVariant}
                />
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {activeConnection.summary} — Click any connecting wire pill or zone rule above to inspect its exact firewall policy chain.
              </p>
            </div>

            {connections.some(
              (c) =>
                c.sourceZoneId === activeConnection.destinationZoneId &&
                c.destinationZoneId === activeConnection.sourceZoneId
            ) && (
              <button
                type="button"
                onClick={() =>
                  setActiveConnectionId(
                    `${activeConnection.destinationZoneId}->${activeConnection.sourceZoneId}`
                  )
                }
                className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span>Inspect Reverse Direction</span>
              </button>
            )}
          </div>

          <div className="space-y-2">
            {activeConnection.rules
              .filter((pol) => !customRulesOnly || pol.origin.toUpperCase() === 'USER_DEFINED')
              .map((pol) => renderPolicyRow(pol, false))}
          </div>
        </div>
      )}
    </div>
  );
};
