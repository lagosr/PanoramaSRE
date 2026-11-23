import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SegmentedControl,
  StatusBadge,
  ToggleSwitch,
} from '@lagosr/panorama-ui-kit';
import {
  ArrowLeftRight,
  ArrowRight,
  Cable,
  Check,
  ChevronRight,
  Eye,
  GripVertical,
  Laptop,
  LayoutGrid,
  Network,
  RotateCcw,
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
  type ZoneScopedRuleItem,
} from '../../lib/unifi-zbf';
import {
  CANVAS_PAD,
  ESTIMATED_HIGH_LEVEL_HEIGHT,
  ESTIMATED_INSPECTION_HEIGHT,
  clampCardPosition,
  computeAutoZoneLayout,
  computeCanvasBounds,
  computeWireGeometries,
  formatWirePillRuleSuffix,
  getEffectiveZoneViewMode,
  getZoneCardWidth,
  mergeIncrementalZoneLayout,
  setZoneViewModeOverride,
  type WireManualAdjustment,
  type ZoneCardPosition,
  type ZoneCardRect,
  type ZoneCardViewMode,
} from '../../lib/unifi-zone-layout';
import {
  ZoneRuleQuickInspectModal,
  type RuleInspectTarget,
} from './ZoneRuleQuickInspectModal';

interface UnifiZoneFlowExplorerProps {
  topology: UnifiTopologySnapshotDto;
  matrix: ZbfMatrixResult;
  lanClients?: LanClientBaselineRow[];
  onToggleLanTrust?: (client: LanClientBaselineRow, trusted: boolean) => void;
  renderPolicyRow?: (pol: UnifiPolicyDto, showZones?: boolean) => React.ReactNode;
  onOpenUnifiFirewall?: () => void;
}

const VIEW_MODE_STORAGE_KEY = 'panoramasre_zbf_flow_view_mode';

function readInitialViewMode(): ZoneCardViewMode {
  try {
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return saved === 'inspection' ? 'inspection' : 'high-level';
  } catch {
    return 'high-level';
  }
}

function isCatchAllSystemPolicy(pol: UnifiPolicyDto): boolean {
  const nameLower = pol.name.trim().toLowerCase();
  if (pol.index >= 2_000_000_000) return true;
  return (
    pol.origin.toUpperCase() === 'SYSTEM_DEFINED' &&
    !pol.hasSourceFilter &&
    !pol.hasDestinationFilter &&
    pol.connectionStates.length === 0 &&
    (nameLower === 'allow all traffic' || nameLower === 'block all traffic')
  );
}

function positionsEqual(
  a: Record<string, ZoneCardPosition>,
  b: Record<string, ZoneCardPosition>
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const pa = a[key];
    const pb = b[key];
    if (!pa || !pb || pa.x !== pb.x || pa.y !== pb.y) return false;
  }
  return true;
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
  onOpenUnifiFirewall,
}) => {
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [showReturnWires, setShowReturnWires] = useState<boolean>(false);
  const [showBlockedWires, setShowBlockedWires] = useState<boolean>(false);
  const [customRulesOnly, setCustomRulesOnly] = useState<boolean>(false);

  const [globalViewMode, setGlobalViewMode] =
    useState<ZoneCardViewMode>(readInitialViewMode);
  const [zoneViewOverrides, setZoneViewOverrides] = useState<
    Record<string, ZoneCardViewMode>
  >({});

  const [zoneRuleScopeById, setZoneRuleScopeById] = useState<
    Record<string, 'selected' | 'all'>
  >({});
  const [zoneClientSearchById, setZoneClientSearchById] = useState<
    Record<string, string>
  >({});
  const [expandedDefaultRulesByZoneId, setExpandedDefaultRulesByZoneId] =
    useState<Record<string, boolean>>({});

  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(
    null
  );
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(
    null
  );
  const [inspectTarget, setInspectTarget] = useState<RuleInspectTarget | null>(
    null
  );

  // Spatial Free-Canvas Positions, Wire Bends & Drag State
  const [positionsByZoneId, setPositionsByZoneId] = useState<
    Record<string, ZoneCardPosition>
  >({});
  const [hasCustomLayout, setHasCustomLayout] = useState<boolean>(false);
  const [draggingZoneId, setDraggingZoneId] = useState<string | null>(null);
  const [wireAdjustmentsById, setWireAdjustmentsById] = useState<
    Record<string, WireManualAdjustment>
  >({});
  const [draggingWireState, setDraggingWireState] = useState<{
    connectionId: string;
    mode: 'wire' | 'label';
  } | null>(null);
  const [cardStackOrder, setCardStackOrder] = useState<string[]>([]);
  const [canvasViewportWidth, setCanvasViewportWidth] = useState<number>(1200);
  const [measuredCardSizes, setMeasuredCardSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const seededTopologyRef = useRef<boolean>(false);
  const dragSessionRef = useRef<{
    zoneId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const wireDragSessionRef = useRef<{
    connectionId: string;
    mode: 'wire' | 'label';
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originWireDx: number;
    originWireDy: number;
    originLabelDx: number;
    originLabelDy: number;
    moved: boolean;
  } | null>(null);

  // Persist holistic view mode preference
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, globalViewMode);
    } catch {
      // Ignore storage write errors
    }
  }, [globalViewMode]);

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

  const effectiveViewModeByZoneId = useMemo(() => {
    const next: Record<string, ZoneCardViewMode> = {};
    for (const id of selectedZoneIds) {
      next[id] = getEffectiveZoneViewMode(id, globalViewMode, zoneViewOverrides);
    }
    return next;
  }, [selectedZoneIds, globalViewMode, zoneViewOverrides]);

  const activeCustomOverrideCount = useMemo(
    () =>
      selectedZoneIds.filter(
        (id) =>
          zoneViewOverrides[id] !== undefined &&
          zoneViewOverrides[id] !== globalViewMode
      ).length,
    [selectedZoneIds, zoneViewOverrides, globalViewMode]
  );

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
    if (
      activeConnectionId &&
      connections.some((c) => c.id === activeConnectionId)
    ) {
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

  // Drop stale manual wire/label adjustments when connections are filtered/hidden
  useEffect(() => {
    const validConnIds = new Set(connections.map((c) => c.id));
    setWireAdjustmentsById((prev) => {
      const keys = Object.keys(prev);
      if (keys.every((k) => validConnIds.has(k))) return prev;
      const next: Record<string, WireManualAdjustment> = {};
      for (const k of keys) {
        if (validConnIds.has(k)) next[k] = prev[k];
      }
      return next;
    });
  }, [connections]);

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

  // Measure canvas scroll container viewport width
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const updateWidth = () => {
      const nextW = el.clientWidth;
      if (nextW > 0) {
        setCanvasViewportWidth((prev) =>
          Math.abs(prev - nextW) >= 2 ? nextW : prev
        );
      }
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    window.addEventListener('resize', updateWidth);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, [selectedZones.length]);

  // Measure rendered zone card heights & widths smoothly (without scroll/rect feedback loops)
  useEffect(() => {
    if (selectedZones.length === 0) return;
    const syncMeasurements = () => {
      setMeasuredCardSizes((prev) => {
        let changed = false;
        const next: Record<string, { width: number; height: number }> = { ...prev };
        for (const z of selectedZones) {
          const cardEl = cardRefs.current.get(z.id);
          if (!cardEl) continue;
          const w = cardEl.offsetWidth;
          const h = cardEl.offsetHeight;
          if (w <= 0 || h <= 0) continue;
          const cur = prev[z.id];
          if (
            !cur ||
            Math.abs(cur.width - w) >= 2 ||
            Math.abs(cur.height - h) >= 2
          ) {
            next[z.id] = { width: w, height: h };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };

    syncMeasurements();
    const ro = new ResizeObserver(syncMeasurements);
    for (const z of selectedZones) {
      const el = cardRefs.current.get(z.id);
      if (el) ro.observe(el);
    }
    return () => ro.disconnect();
  }, [selectedZones, effectiveViewModeByZoneId]);

  const measuredHeightMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [id, sz] of Object.entries(measuredCardSizes)) {
      map[id] = sz.height;
    }
    return map;
  }, [measuredCardSizes]);

  // Reconcile spatial positions when selected zones, view modes, connections, or container width change
  useEffect(() => {
    if (selectedZoneIds.length === 0) {
      setPositionsByZoneId({});
      return;
    }
    setPositionsByZoneId((prev) => {
      const next = hasCustomLayout
        ? mergeIncrementalZoneLayout(
            selectedZoneIds,
            prev,
            canvasViewportWidth,
            effectiveViewModeByZoneId,
            measuredHeightMap,
            connections
          )
        : computeAutoZoneLayout(
            selectedZoneIds,
            canvasViewportWidth,
            effectiveViewModeByZoneId,
            measuredHeightMap,
            connections
          );
      return positionsEqual(prev, next) ? prev : next;
    });
  }, [
    selectedZoneIds,
    hasCustomLayout,
    canvasViewportWidth,
    effectiveViewModeByZoneId,
    measuredHeightMap,
    connections,
  ]);

  const rectsByZoneId = useMemo(() => {
    const map: Record<string, ZoneCardRect> = {};
    for (const z of selectedZones) {
      const mode = effectiveViewModeByZoneId[z.id] ?? globalViewMode;
      const pos = positionsByZoneId[z.id] ?? { x: CANVAS_PAD, y: CANVAS_PAD };
      const measured = measuredCardSizes[z.id];
      map[z.id] = {
        x: pos.x,
        y: pos.y,
        width: measured?.width || getZoneCardWidth(mode),
        height:
          measured?.height ||
          (mode === 'high-level'
            ? ESTIMATED_HIGH_LEVEL_HEIGHT
            : ESTIMATED_INSPECTION_HEIGHT),
      };
    }
    return map;
  }, [
    selectedZones,
    effectiveViewModeByZoneId,
    globalViewMode,
    positionsByZoneId,
    measuredCardSizes,
  ]);

  const wireGeometries = useMemo(
    () =>
      selectedZones.length > 1
        ? computeWireGeometries(connections, rectsByZoneId, wireAdjustmentsById)
        : [],
    [selectedZones.length, connections, rectsByZoneId, wireAdjustmentsById]
  );

  const canvasBounds = useMemo(
    () =>
      computeCanvasBounds(
        rectsByZoneId,
        wireGeometries,
        canvasViewportWidth,
        460
      ),
    [rectsByZoneId, wireGeometries, canvasViewportWidth]
  );

  const bringCardToFront = useCallback((zoneId: string) => {
    setCardStackOrder((prev) => [...prev.filter((id) => id !== zoneId), zoneId]);
  }, []);

  const handleGlobalViewModeChange = (mode: ZoneCardViewMode) => {
    setGlobalViewMode(mode);
    setZoneViewOverrides({});
    if (!hasCustomLayout) {
      const nextModes: Record<string, ZoneCardViewMode> = {};
      for (const id of selectedZoneIds) nextModes[id] = mode;
      setPositionsByZoneId(
        computeAutoZoneLayout(
          selectedZoneIds,
          canvasViewportWidth,
          nextModes,
          undefined,
          connections
        )
      );
    }
  };

  const handlePerZoneViewModeChange = (
    zoneId: string,
    mode: ZoneCardViewMode
  ) => {
    setZoneViewOverrides((prev) =>
      setZoneViewModeOverride(zoneId, mode, globalViewMode, prev)
    );
  };

  const handleAutoArrange = () => {
    setHasCustomLayout(false);
    setDraggingZoneId(null);
    setWireAdjustmentsById({});
    setDraggingWireState(null);
    setPositionsByZoneId(
      computeAutoZoneLayout(
        selectedZoneIds,
        canvasViewportWidth,
        effectiveViewModeByZoneId,
        measuredHeightMap,
        connections
      )
    );
  };

  const toggleZoneSelection = (zoneId: string) => {
    setSelectedZoneIds((prev) =>
      prev.includes(zoneId)
        ? prev.filter((id) => id !== zoneId)
        : [...prev, zoneId]
    );
  };

  const handleSelectConnectedLan = () => {
    setHasCustomLayout(false);
    setWireAdjustmentsById({});
    setSelectedZoneIds(pickDefaultFlowZoneIds(matrix, 4));
  };

  const handleSelectAllUserZones = () => {
    const userZones = matrix.zones
      .filter(
        (z) =>
          z.origin.toUpperCase() !== 'SYSTEM_DEFINED' ||
          z.name.toLowerCase() === 'internal'
      )
      .map((z) => z.id);
    setHasCustomLayout(false);
    setWireAdjustmentsById({});
    setSelectedZoneIds(userZones);
  };

  // Drag handlers on Zone Container Header
  const handleDragStart = (
    e: React.PointerEvent<HTMLDivElement>,
    zoneId: string
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    bringCardToFront(zoneId);
    const currentPos = positionsByZoneId[zoneId] ?? {
      x: CANVAS_PAD,
      y: CANVAS_PAD,
    };
    dragSessionRef.current = {
      zoneId,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: currentPos.x,
      originY: currentPos.y,
      moved: false,
    };
    setDraggingZoneId(zoneId);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if capture is unavailable
    }
  };

  const handleDragMove = (
    e: React.PointerEvent<HTMLDivElement>,
    zoneId: string
  ) => {
    const session = dragSessionRef.current;
    if (!session || session.zoneId !== zoneId || session.pointerId !== e.pointerId) {
      return;
    }
    const dx = e.clientX - session.startClientX;
    const dy = e.clientY - session.startClientY;
    if (!session.moved && Math.hypot(dx, dy) < 3) {
      return;
    }
    session.moved = true;
    setHasCustomLayout(true);
    const clamped = clampCardPosition({
      x: session.originX + dx,
      y: session.originY + dy,
    });
    setPositionsByZoneId((prev) => {
      const existing = prev[zoneId];
      if (existing && existing.x === clamped.x && existing.y === clamped.y) {
        return prev;
      }
      return { ...prev, [zoneId]: clamped };
    });
  };

  const handleDragEnd = (
    e: React.PointerEvent<HTMLDivElement>,
    zoneId: string
  ) => {
    const session = dragSessionRef.current;
    if (!session || session.zoneId !== zoneId || session.pointerId !== e.pointerId) {
      return;
    }
    dragSessionRef.current = null;
    setDraggingZoneId(null);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }
  };

  const handleOpenConnectionModal = (
    connId: string,
    focusedPolicy: UnifiPolicyDto | null = null
  ) => {
    const conn = connections.find((c) => c.id === connId) ?? null;
    if (conn) {
      setActiveConnectionId(conn.id);
      setInspectTarget({
        connection: conn,
        focusedPolicy,
        sourceZone: matrix.zones.find((z) => z.id === conn.sourceZoneId) ?? null,
        destinationZone:
          matrix.zones.find((z) => z.id === conn.destinationZoneId) ?? null,
      });
    }
  };

  const handleInspectRuleFromZoneCard = (
    item: ZoneScopedRuleItem,
    cardZone: UnifiZoneDto
  ) => {
    const pol = item.policy;
    const srcZoneId = pol.sourceZoneId ?? (item.direction === 'OUT' ? cardZone.id : item.peerZoneId);
    const dstZoneId =
      pol.destinationZoneId ?? (item.direction === 'IN' ? cardZone.id : item.peerZoneId);
    const matchingConn =
      srcZoneId && dstZoneId
        ? connections.find(
            (c) => c.sourceZoneId === srcZoneId && c.destinationZoneId === dstZoneId
          ) ?? null
        : null;
    if (matchingConn) {
      setActiveConnectionId(matchingConn.id);
    }
    setInspectTarget({
      connection: matchingConn,
      focusedPolicy: pol,
      sourceZone:
        (srcZoneId ? matrix.zones.find((z) => z.id === srcZoneId) : null) ??
        cardZone,
      destinationZone:
        (dstZoneId ? matrix.zones.find((z) => z.id === dstZoneId) : null) ??
        cardZone,
    });
  };

  const inspectReverseAvailable = useMemo(() => {
    if (!inspectTarget) return false;
    const srcId =
      inspectTarget.sourceZone?.id ?? inspectTarget.connection?.sourceZoneId;
    const dstId =
      inspectTarget.destinationZone?.id ??
      inspectTarget.connection?.destinationZoneId;
    if (!srcId || !dstId || srcId === dstId) return false;
    return Boolean(
      connections.some(
        (c) => c.sourceZoneId === dstId && c.destinationZoneId === srcId
      ) || matrix.cells[dstId]?.[srcId]
    );
  }, [inspectTarget, connections, matrix.cells]);

  const handleFlipInspectReverse = () => {
    if (!inspectTarget) return;
    const srcId =
      inspectTarget.sourceZone?.id ?? inspectTarget.connection?.sourceZoneId;
    const dstId =
      inspectTarget.destinationZone?.id ??
      inspectTarget.connection?.destinationZoneId;
    if (!srcId || !dstId || srcId === dstId) return;

    const revConn =
      connections.find(
        (c) => c.sourceZoneId === dstId && c.destinationZoneId === srcId
      ) ?? null;
    if (revConn) {
      setActiveConnectionId(revConn.id);
    }
    setInspectTarget({
      connection: revConn,
      focusedPolicy: null,
      sourceZone: matrix.zones.find((z) => z.id === dstId) ?? null,
      destinationZone: matrix.zones.find((z) => z.id === srcId) ?? null,
    });
  };

  const handleResetWireAdjustment = (connectionId: string) => {
    setWireAdjustmentsById((prev) => {
      if (!prev[connectionId]) return prev;
      const next = { ...prev };
      delete next[connectionId];
      return next;
    });
  };

  const handleWirePointerDown = (
    e: React.PointerEvent<Element>,
    connectionId: string,
    mode: 'wire' | 'label'
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const cur = wireAdjustmentsById[connectionId] ?? {
      wireDx: 0,
      wireDy: 0,
      labelDx: 0,
      labelDy: 0,
    };
    const geom = wireGeometries.find((g) => g.connection.id === connectionId);
    const effectiveOriginLabelDx =
      cur.labelDx === 0 && cur.labelDy === 0 && geom
        ? Math.round(geom.labelX - geom.anchorX)
        : cur.labelDx;
    const effectiveOriginLabelDy =
      cur.labelDx === 0 && cur.labelDy === 0 && geom
        ? Math.round(geom.labelY - geom.anchorY)
        : cur.labelDy;

    wireDragSessionRef.current = {
      connectionId,
      mode,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originWireDx: cur.wireDx,
      originWireDy: cur.wireDy,
      originLabelDx: effectiveOriginLabelDx,
      originLabelDy: effectiveOriginLabelDy,
      moved: false,
    };
    setHoveredConnectionId(connectionId);
    setDraggingWireState({ connectionId, mode });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore pointer capture unavailability
    }
  };

  const handleWirePointerMove = (
    e: React.PointerEvent<Element>,
    connectionId: string
  ) => {
    const session = wireDragSessionRef.current;
    if (
      !session ||
      session.connectionId !== connectionId ||
      session.pointerId !== e.pointerId
    ) {
      return;
    }
    const dx = e.clientX - session.startClientX;
    const dy = e.clientY - session.startClientY;
    if (!session.moved && Math.hypot(dx, dy) < 5) {
      return;
    }
    session.moved = true;

    setWireAdjustmentsById((prev) => {
      const cur = prev[connectionId] ?? {
        wireDx: session.originWireDx,
        wireDy: session.originWireDy,
        labelDx: session.originLabelDx,
        labelDy: session.originLabelDy,
      };
      if (session.mode === 'wire') {
        return {
          ...prev,
          [connectionId]: {
            ...cur,
            wireDx: Math.round(session.originWireDx + dx),
            wireDy: Math.round(session.originWireDy + dy),
          },
        };
      }
      return {
        ...prev,
        [connectionId]: {
          ...cur,
          labelDx: Math.round(session.originLabelDx + dx),
          labelDy: Math.round(session.originLabelDy + dy),
        },
      };
    });
  };

  const handleWirePointerUp = (
    e: React.PointerEvent<Element>,
    connectionId: string
  ) => {
    const session = wireDragSessionRef.current;
    if (
      !session ||
      session.connectionId !== connectionId ||
      session.pointerId !== e.pointerId
    ) {
      return;
    }
    const didMove = session.moved;
    wireDragSessionRef.current = null;
    setDraggingWireState(null);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }

    if (!didMove) {
      handleOpenConnectionModal(connectionId);
    }
  };

  const renderWireSvgGroup = (
    geomList: typeof wireGeometries,
    mode: 'hit-and-base' | 'active-overlay'
  ) =>
    geomList.map(({ connection, pathD }) => {
      const style = wireStrokeStyle(connection.verdict);
      const isActive = activeConnectionId === connection.id;
      const isHovered = hoveredConnectionId === connection.id;
      const isDraggingThisWire = draggingWireState?.connectionId === connection.id;
      const isFocused = isActive || isHovered || isDraggingThisWire;
      const dimmed =
        (hoveredConnectionId && !isHovered && !isDraggingThisWire) ||
        (!hoveredConnectionId && activeConnectionId && !isActive && !isDraggingThisWire);

      if (mode === 'active-overlay') {
        if (!isFocused) return null;
        return (
          <path
            key={`overlay-${connection.id}`}
            d={pathD}
            fill="none"
            stroke={style.stroke}
            strokeWidth={3.4}
            strokeDasharray={style.dashArray}
            strokeLinecap="round"
            strokeOpacity={0.95}
            markerEnd={`url(#overlay-${style.markerId})`}
          />
        );
      }

      return (
        <g key={`base-${connection.id}`}>
          <path
            d={pathD}
            fill="none"
            stroke="transparent"
            strokeWidth={20}
            className="pointer-events-auto cursor-grab active:cursor-grabbing"
            onMouseEnter={() => setHoveredConnectionId(connection.id)}
            onMouseLeave={() => {
              if (!draggingWireState) setHoveredConnectionId(null);
            }}
            onPointerDown={(e) => handleWirePointerDown(e, connection.id, 'wire')}
            onPointerMove={(e) => handleWirePointerMove(e, connection.id)}
            onPointerUp={(e) => handleWirePointerUp(e, connection.id)}
            onPointerCancel={(e) => handleWirePointerUp(e, connection.id)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              handleResetWireAdjustment(connection.id);
            }}
          />
          <path
            d={pathD}
            fill="none"
            stroke={style.stroke}
            strokeWidth={isFocused ? 3.1 : 2.1}
            strokeDasharray={style.dashArray}
            strokeLinecap="round"
            strokeOpacity={dimmed ? 0.34 : 0.88}
            markerEnd={`url(#${style.markerId})`}
            className="transition-opacity"
          />
        </g>
      );
    });

  return (
    <div className="space-y-4">
      {/* Multi-Zone Selector, Holistic View Mode & Wire Controls */}
      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              Select Firewall Zones to Inspect ({selectedZones.length} active)
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Drag zone headers, wire curves, or wire labels to arrange freely. Tap any wire, label, or rule row to inspect details (double-click a wire/label to reset its bend).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Holistic View Level Control + Per-Zone Mixed Override Reset */}
            <div className="flex items-center gap-2">
              <SegmentedControl<ZoneCardViewMode>
                size="sm"
                activeVariant="brand"
                value={globalViewMode}
                onChange={handleGlobalViewModeChange}
                options={[
                  { value: 'high-level', label: 'High-Level' },
                  { value: 'inspection', label: 'Inspection' },
                ]}
              />
              {activeCustomOverrideCount > 0 && (
                <button
                  type="button"
                  onClick={() => setZoneViewOverrides({})}
                  title="Reset per-card view overrides to match the holistic setting"
                  className="px-2 py-1 rounded-lg bg-[var(--color-brand-subtle)] border border-[var(--color-brand-ring)] text-[11px] font-mono font-semibold text-[var(--color-brand-text)] hover:opacity-90 whitespace-nowrap flex-shrink-0 cursor-pointer"
                >
                  Mixed ({activeCustomOverrideCount}) · Sync All
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleAutoArrange}
              disabled={selectedZones.length === 0}
              title="Re-arrange all open zone containers and wires into a clean non-overlapping layout"
              className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Auto-Arrange</span>
            </button>

            {Object.keys(wireAdjustmentsById).length > 0 && (
              <button
                type="button"
                onClick={() => setWireAdjustmentsById({})}
                title="Reset custom wire bends and label offsets while keeping your zone card positions"
                className="btn-ghost text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Wires</span>
              </button>
            )}

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
                {isSelected && (
                  <Check className="w-3.5 h-3.5 text-[var(--color-brand-text)] shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Wire Controls & Legend */}
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

          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-600 dark:text-slate-400 tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-emerald-500 inline-block" /> Allow
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-0.5 border-t-2 border-dashed border-amber-500 inline-block" /> Limited Pinhole
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-0.5 border-t-2 border-dashed border-sky-400 inline-block" /> Return Only
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-0.5 border-t-2 border-dotted border-rose-500 inline-block" /> Blocked
            </span>
          </div>
        </div>
      </div>

      {/* Free-Canvas Draggable Zone Container Stage */}
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
          className="relative rounded-2xl bg-slate-100/70 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 overflow-auto"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(148,163,184,0.22) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        >
          <div
            className="relative"
            style={{
              width: `${canvasBounds.width}px`,
              height: `${canvasBounds.height}px`,
            }}
          >
            {/* Base Wire Layer (z-[5] behind zone cards) */}
            {selectedZones.length > 1 && wireGeometries.length > 0 && (
              <svg
                aria-hidden="true"
                width={canvasBounds.width}
                height={canvasBounds.height}
                className="absolute inset-0 pointer-events-none z-[5]"
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
                {renderWireSvgGroup(wireGeometries, 'hit-and-base')}
              </svg>
            )}

            {/* Hovered/Selected Wire Highlight Overlay Layer (z-30, pointer-events-none) */}
            {selectedZones.length > 1 && wireGeometries.length > 0 && (
              <svg
                aria-hidden="true"
                width={canvasBounds.width}
                height={canvasBounds.height}
                className="absolute inset-0 pointer-events-none z-30"
              >
                <defs>
                  {[
                    { id: 'overlay-zbf-arrow-allow', color: '#10b981' },
                    { id: 'overlay-zbf-arrow-allow-blocks', color: '#14b8a6' },
                    { id: 'overlay-zbf-arrow-limited', color: '#f59e0b' },
                    { id: 'overlay-zbf-arrow-return', color: '#38bdf8' },
                    { id: 'overlay-zbf-arrow-blocked', color: '#f43f5e' },
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
                {renderWireSvgGroup(wireGeometries, 'active-overlay')}
              </svg>
            )}

            {/* Draggable Zone Container Cards (z-[10..28]) */}
            {selectedZones.map((zone) => {
              const firstVlan = zone.vlanIds[0];
              const style = getVlanBadgeStyle(
                firstVlan != null ? `VLAN ${firstVlan}` : zone.name
              );
              const viewMode =
                effectiveViewModeByZoneId[zone.id] ?? globalViewMode;
              const isHighLevel = viewMode === 'high-level';
              const cardWidth = getZoneCardWidth(viewMode);
              const pos = positionsByZoneId[zone.id] ?? {
                x: CANVAS_PAD,
                y: CANVAS_PAD,
              };
              const stackIdx = cardStackOrder.indexOf(zone.id);
              const isDragging = draggingZoneId === zone.id;
              const zIndex = isDragging
                ? 29
                : 10 + (stackIdx >= 0 ? Math.min(18, stackIdx + 1) : 0);

              const subnets = subnetsByZoneId.get(zone.id) ?? [];
              const ruleScope =
                zoneRuleScopeById[zone.id] ??
                (selectedZones.length > 1 ? 'selected' : 'all');
              const zoneRules = getZoneScopedRules(
                zone.id,
                topology.policies,
                matrix.zones,
                selectedZoneIds,
                {
                  selectedPeersOnly:
                    selectedZones.length > 1 && ruleScope === 'selected',
                  customOnly: customRulesOnly,
                }
              );

              const primaryRules = zoneRules.filter(
                (r) => !isCatchAllSystemPolicy(r.policy)
              );
              const catchAllRules = zoneRules.filter((r) =>
                isCatchAllSystemPolicy(r.policy)
              );
              const showDefaultsInHighLevel = Boolean(
                expandedDefaultRulesByZoneId[zone.id]
              );
              const highLevelRules =
                primaryRules.length === 0
                  ? catchAllRules.slice(0, 2)
                  : showDefaultsInHighLevel
                    ? zoneRules
                    : primaryRules;

              const zoneClients = getClientsForZone(
                zone,
                topology.clients,
                topology.networks
              );
              const trustedClientCount = zoneClients.reduce((acc, cli) => {
                const row = trustByMac.get(cli.macAddress.trim().toUpperCase());
                return acc + (row?.isTrusted ? 1 : 0);
              }, 0);

              const clientSearch = (zoneClientSearchById[zone.id] ?? '')
                .trim()
                .toLowerCase();
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
                (c) =>
                  c.destinationZoneId === zone.id && c.verdict !== 'BLOCKED'
              ).length;

              return (
                <div
                  key={zone.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(zone.id, el);
                    else cardRefs.current.delete(zone.id);
                  }}
                  onMouseDownCapture={() => bringCardToFront(zone.id)}
                  style={{
                    position: 'absolute',
                    left: `${pos.x}px`,
                    top: `${pos.y}px`,
                    width: `${cardWidth}px`,
                    zIndex,
                  }}
                  className={`rounded-2xl bg-white dark:bg-slate-900 border overflow-hidden flex flex-col transition-shadow ${
                    isDragging
                      ? 'border-[var(--color-brand)] ring-2 ring-[var(--color-brand-ring)] shadow-2xl'
                      : 'border-slate-300 dark:border-slate-700 shadow-md dark:shadow-xl'
                  }`}
                >
                  {/* Top VLAN Accent Strip */}
                  <div className={`h-1 w-full ${style.dotClass}`} />

                  {/* Draggable Header */}
                  <div
                    onPointerDown={(e) => handleDragStart(e, zone.id)}
                    onPointerMove={(e) => handleDragMove(e, zone.id)}
                    onPointerUp={(e) => handleDragEnd(e, zone.id)}
                    onPointerCancel={(e) => handleDragEnd(e, zone.id)}
                    title="Drag header to reposition zone container"
                    className={`px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-white dark:bg-slate-900 select-none ${
                      isDragging ? 'cursor-grabbing' : 'cursor-grab'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <GripVertical className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
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
                              className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-semibold tabular-nums shrink-0 ${vs.chipClass}`}
                            >
                              VLAN {vid}
                            </span>
                          );
                        })
                      ) : (
                        <StatusBadge label="System" variant="neutral" />
                      )}
                    </div>

                    <div
                      className="flex items-center gap-1.5 shrink-0"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      {/* Per-Zone View Level Switch */}
                      <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-0.5 text-[10px] font-mono">
                        <button
                          type="button"
                          onClick={() =>
                            handlePerZoneViewModeChange(zone.id, 'high-level')
                          }
                          className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                            isHighLevel
                              ? 'bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)] font-semibold'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                          }`}
                        >
                          High-Level
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handlePerZoneViewModeChange(zone.id, 'inspection')
                          }
                          className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                            !isHighLevel
                              ? 'bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)] font-semibold'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                          }`}
                        >
                          Inspect
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleZoneSelection(zone.id)}
                        aria-label={`Remove ${zone.name} from flow view`}
                        title={`Hide ${zone.name}`}
                        className="min-w-[28px] min-h-[28px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Metadata Sub-Bar */}
                  <div className="px-3.5 py-1.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                    <span>{subnets.length > 0 ? subnets.join(', ') : 'System scope'}</span>
                    {selectedZones.length > 1 && (
                      <span>
                        Wires: → {outOpenCount} out • ← {inOpenCount} in
                      </span>
                    )}
                  </div>

                  {isHighLevel ? (
                    /* =========================================================
                     * HIGH-LEVEL COLLAPSED VIEW (Rules-Focused Summary)
                     * ========================================================= */
                    <>
                      <div className="flex flex-col bg-white dark:bg-slate-900">
                        <div className="px-3.5 py-2 bg-slate-100/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider tabular-nums">
                            <Shield className="w-3.5 h-3.5 text-[var(--color-brand-text)] shrink-0" />
                            <span>Rules ({zoneRules.length})</span>
                          </div>
                          {selectedZones.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                setZoneRuleScopeById((prev) => ({
                                  ...prev,
                                  [zone.id]:
                                    ruleScope === 'selected' ? 'all' : 'selected',
                                }))
                              }
                              className="text-[10px] font-mono text-[var(--color-brand-text)] hover:underline cursor-pointer"
                            >
                              {ruleScope === 'selected'
                                ? 'Scope: Selected Peers'
                                : 'Scope: All Rules'}
                            </button>
                          )}
                        </div>

                        {highLevelRules.length === 0 ? (
                          <div className="px-3.5 py-3 text-[11px] font-mono text-slate-500 dark:text-slate-400 text-center">
                            No active rules match the current filter.
                          </div>
                        ) : (
                          <div className="max-h-44 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800">
                            {highLevelRules.map((item) => {
                              const pol = item.policy;
                              const isAllow = pol.action.toUpperCase() === 'ALLOW';
                              const edgeId =
                                item.direction === 'OUT' && item.peerZoneId
                                  ? `${zone.id}->${item.peerZoneId}`
                                  : item.direction === 'IN' && item.peerZoneId
                                    ? `${item.peerZoneId}->${zone.id}`
                                    : null;
                              const isActiveEdge = Boolean(
                                edgeId && activeConnectionId === edgeId
                              );
                              const peerChip =
                                item.direction === 'OUT'
                                  ? `→ ${item.peerZoneName}`
                                  : item.direction === 'IN'
                                    ? `← ${item.peerZoneName}`
                                    : 'INTRA';

                              return (
                                <button
                                  key={`${zone.id}-hl-${pol.id}-${item.direction}`}
                                  type="button"
                                  onClick={() =>
                                    handleInspectRuleFromZoneCard(item, zone)
                                  }
                                  className={`w-full px-3 py-2 flex items-center justify-between gap-2 text-left transition-colors cursor-pointer group ${
                                    isActiveEdge
                                      ? 'bg-[var(--color-brand-subtle)]/40'
                                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <span
                                      className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold shrink-0 ${
                                        isAllow
                                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                          : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                                      }`}
                                    >
                                      {pol.action.toUpperCase()}
                                    </span>
                                    <span
                                      className={`text-[10px] font-mono shrink-0 max-w-[115px] truncate ${
                                        item.connectsSelectedZone
                                          ? 'text-[var(--color-brand-text)] font-semibold'
                                          : 'text-slate-500 dark:text-slate-400'
                                      }`}
                                    >
                                      {peerChip}
                                    </span>
                                    <span className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                                      {pol.name}
                                    </span>
                                    {item.isCustom && (
                                      <span
                                        title="Custom Rule"
                                        className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] shrink-0"
                                      />
                                    )}
                                  </div>
                                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[var(--color-brand-text)] shrink-0" />
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {primaryRules.length > 0 && catchAllRules.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedDefaultRulesByZoneId((prev) => ({
                                ...prev,
                                [zone.id]: !prev[zone.id],
                              }))
                            }
                            className="px-3.5 py-1.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70 text-[11px] font-mono text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 text-left cursor-pointer"
                          >
                            {showDefaultsInHighLevel
                              ? `Hide ${catchAllRules.length} system default rule(s)`
                              : `+ ${catchAllRules.length} system default rule(s)`}
                          </button>
                        )}
                      </div>

                      {/* Collapsed Clients Summary Strip */}
                      <div className="px-3.5 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-mono text-[11px] tabular-nums">
                          <Laptop className="w-3.5 h-3.5 text-[var(--color-accent-text)] shrink-0" />
                          <span>
                            Clients: <strong>{zoneClients.length}</strong>
                            {trustedClientCount > 0 && ` • ${trustedClientCount} trusted`}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handlePerZoneViewModeChange(zone.id, 'inspection')
                          }
                          className="text-[11px] font-mono font-semibold text-[var(--color-brand-text)] hover:underline cursor-pointer whitespace-nowrap"
                        >
                          Inspect →
                        </button>
                      </div>
                    </>
                  ) : (
                    /* =========================================================
                     * INSPECTION DETAILED VIEW (Full Readable Rules + Table)
                     * ========================================================= */
                    <>
                      {/* Rules Table */}
                      <div className="flex flex-col border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                        <div className="px-3.5 py-2 bg-slate-100/90 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-700/80 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider tabular-nums">
                            <Shield className="w-3.5 h-3.5 text-[var(--color-brand-text)] shrink-0" />
                            <span>Zone Rules ({zoneRules.length})</span>
                          </div>

                          {selectedZones.length > 1 && (
                            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5 text-[10px] font-mono">
                              <button
                                type="button"
                                onClick={() =>
                                  setZoneRuleScopeById((prev) => ({
                                    ...prev,
                                    [zone.id]: 'selected',
                                  }))
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
                                  setZoneRuleScopeById((prev) => ({
                                    ...prev,
                                    [zone.id]: 'all',
                                  }))
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
                          <div className="p-4 text-xs font-mono text-slate-500 text-center">
                            {ruleScope === 'selected' && selectedZones.length > 1
                              ? 'No rules directly between selected zones — switch to All Rules or enable Return/Blocked wires.'
                              : 'No active rules match the current filter.'}
                          </div>
                        ) : (
                          <div className="max-h-[260px] overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800">
                            {zoneRules.map((item) => {
                              const pol = item.policy;
                              const isAllow =
                                pol.action.toUpperCase() === 'ALLOW';
                              const edgeId =
                                item.direction === 'OUT' && item.peerZoneId
                                  ? `${zone.id}->${item.peerZoneId}`
                                  : item.direction === 'IN' && item.peerZoneId
                                    ? `${item.peerZoneId}->${zone.id}`
                                    : null;
                              const dirBadge =
                                item.direction === 'OUT'
                                  ? `OUT → ${item.peerZoneName}`
                                  : item.direction === 'IN'
                                    ? `IN ← ${item.peerZoneName}`
                                    : 'INTRA-ZONE';

                              return (
                                <button
                                  key={`${zone.id}-${pol.id}-${item.direction}`}
                                  type="button"
                                  onClick={() =>
                                    handleInspectRuleFromZoneCard(item, zone)
                                  }
                                  className={`w-full px-3.5 py-2.5 text-left space-y-1 transition-colors cursor-pointer group ${
                                    edgeId && activeConnectionId === edgeId
                                      ? 'bg-[var(--color-brand-subtle)]/35'
                                      : 'odd:bg-white dark:odd:bg-slate-900 even:bg-slate-50/70 dark:even:bg-slate-950/60 hover:bg-slate-100/80 dark:hover:bg-slate-800/70'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
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
                                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[var(--color-brand-text)] shrink-0" />
                                  </div>
                                  <div className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                                    {pol.name}
                                  </div>
                                  {(pol.protocol ||
                                    pol.sourceFilterSummary ||
                                    pol.destinationFilterSummary) && (
                                    <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 truncate">
                                      {[
                                        pol.protocol,
                                        pol.sourceFilterSummary &&
                                          `Src: ${pol.sourceFilterSummary}`,
                                        pol.destinationFilterSummary &&
                                          `Dst: ${pol.destinationFilterSummary}`,
                                      ]
                                        .filter(Boolean)
                                        .join(' • ')}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Clients Table */}
                      <div className="flex flex-col bg-white dark:bg-slate-900">
                        <div className="px-3.5 py-2 bg-slate-100/90 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-700/80 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider tabular-nums">
                            <Laptop className="w-3.5 h-3.5 text-[var(--color-accent-text)] shrink-0" />
                            <span>Clients in Zone ({zoneClients.length})</span>
                          </div>

                          {zoneClients.length > 3 && (
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
                                className="w-full pl-7 pr-2 py-1 text-[11px] font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
                              />
                            </div>
                          )}
                        </div>

                        {visibleClients.length === 0 ? (
                          <div className="p-4 text-xs font-mono text-slate-500 text-center">
                            {zoneClients.length === 0
                              ? 'No active clients currently in this zone.'
                              : 'No clients match your search.'}
                          </div>
                        ) : (
                          <div className="max-h-[260px] overflow-y-auto">
                            <table className="w-full border-collapse text-left">
                              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300">
                                <tr>
                                  <th className="py-1.5 px-3 font-semibold">Device</th>
                                  <th className="py-1.5 px-2 font-semibold">IP / MAC</th>
                                  <th className="py-1.5 px-3 font-semibold text-right">
                                    Trust
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                {visibleClients.map((cli) => {
                                  const baseline = trustByMac.get(
                                    cli.macAddress.trim().toUpperCase()
                                  );
                                  const isTrusted = baseline?.isTrusted ?? false;
                                  const isWired =
                                    (cli.clientType || '').toUpperCase() ===
                                    'WIRED';
                                  return (
                                    <tr
                                      key={cli.id || cli.macAddress}
                                      className="odd:bg-white dark:odd:bg-slate-900 even:bg-slate-50/70 dark:even:bg-slate-950/60"
                                    >
                                      <td className="py-2 px-3 align-middle max-w-[200px]">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          {isWired ? (
                                            <Cable className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                          ) : (
                                            <Wifi className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                                          )}
                                          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                                            {cli.name ||
                                              cli.hostname ||
                                              cli.macAddress}
                                          </span>
                                        </div>
                                        <div className="pl-5 text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">
                                          {cli.vlanId != null
                                            ? `VLAN ${cli.vlanId}`
                                            : ''}
                                          {cli.vlanId != null && cli.ouiVendor
                                            ? ' • '
                                            : ''}
                                          {cli.ouiVendor || ''}
                                        </div>
                                      </td>
                                      <td className="py-2 px-2 align-middle font-mono tabular-nums">
                                        <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                                          {cli.ipAddress || 'no-ip'}
                                        </div>
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                          {cli.macAddress}
                                        </div>
                                      </td>
                                      <td className="py-2 px-3 align-middle text-right">
                                        {baseline && onToggleLanTrust ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              onToggleLanTrust(
                                                baseline,
                                                !isTrusted
                                              )
                                            }
                                            title={
                                              isTrusted
                                                ? 'Owner-verified LAN MAC (click to revoke trust)'
                                                : 'Click to mark hardware MAC owner-verified'
                                            }
                                            className={`px-2 py-1 rounded-lg border text-[10px] font-mono font-semibold inline-flex items-center gap-1 whitespace-nowrap flex-shrink-0 cursor-pointer ${
                                              isTrusted
                                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                                                : 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/25'
                                            }`}
                                          >
                                            <ShieldCheck className="w-3 h-3 shrink-0" />
                                            <span>
                                              {isTrusted ? 'Trusted' : 'Trust MAC'}
                                            </span>
                                          </button>
                                        ) : (
                                          <StatusBadge
                                            label={
                                              isTrusted ? 'Trusted' : 'Unreviewed'
                                            }
                                            variant={
                                              isTrusted ? 'success' : 'neutral'
                                            }
                                          />
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {/* Wire Leader Tethers & Draggable Midpoint Bend Handles (z-[32]) */}
            {selectedZones.length > 1 && wireGeometries.length > 0 && (
              <svg
                aria-hidden="true"
                width={canvasBounds.width}
                height={canvasBounds.height}
                className="absolute inset-0 pointer-events-none z-[32]"
              >
                {wireGeometries.map(
                  ({ connection, anchorX, anchorY, labelX, labelY, tetherNeeded }) => {
                    const style = wireStrokeStyle(connection.verdict);
                    const isFocused =
                      activeConnectionId === connection.id ||
                      hoveredConnectionId === connection.id ||
                      draggingWireState?.connectionId === connection.id;
                    return (
                      <g key={`handle-${connection.id}`}>
                        {tetherNeeded && (
                          <line
                            x1={anchorX}
                            y1={anchorY}
                            x2={labelX}
                            y2={labelY}
                            stroke={style.stroke}
                            strokeWidth={1.5}
                            strokeDasharray="3 3"
                            strokeOpacity={isFocused ? 0.9 : 0.6}
                          />
                        )}
                        <g
                          className="pointer-events-auto cursor-grab active:cursor-grabbing"
                          onMouseEnter={() => setHoveredConnectionId(connection.id)}
                          onMouseLeave={() => {
                            if (!draggingWireState) setHoveredConnectionId(null);
                          }}
                          onPointerDown={(e) =>
                            handleWirePointerDown(e, connection.id, 'wire')
                          }
                          onPointerMove={(e) => handleWirePointerMove(e, connection.id)}
                          onPointerUp={(e) => handleWirePointerUp(e, connection.id)}
                          onPointerCancel={(e) => handleWirePointerUp(e, connection.id)}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            handleResetWireAdjustment(connection.id);
                          }}
                        >
                          <circle cx={anchorX} cy={anchorY} r={12} fill="transparent" />
                          <circle
                            cx={anchorX}
                            cy={anchorY}
                            r={isFocused ? 6 : 4.5}
                            className="fill-white dark:fill-slate-900"
                            stroke={style.stroke}
                            strokeWidth={2.2}
                          />
                        </g>
                      </g>
                    );
                  }
                )}
              </svg>
            )}

            {/* Draggable & Tap-to-Inspect Wire Labels (z-[35] above all cards) */}
            {selectedZones.length > 1 &&
              wireGeometries.map(({ connection, labelX, labelY }) => {
                const style = wireStrokeStyle(connection.verdict);
                const isActive = activeConnectionId === connection.id;
                const isDraggingLabel =
                  draggingWireState?.connectionId === connection.id &&
                  draggingWireState.mode === 'label';
                const ruleSuffix = formatWirePillRuleSuffix(connection);

                return (
                  <button
                    key={`pill-${connection.id}`}
                    type="button"
                    style={{ left: `${labelX}px`, top: `${labelY}px` }}
                    onMouseEnter={() => setHoveredConnectionId(connection.id)}
                    onMouseLeave={() => {
                      if (!draggingWireState) setHoveredConnectionId(null);
                    }}
                    onPointerDown={(e) =>
                      handleWirePointerDown(e, connection.id, 'label')
                    }
                    onPointerMove={(e) => handleWirePointerMove(e, connection.id)}
                    onPointerUp={(e) => handleWirePointerUp(e, connection.id)}
                    onPointerCancel={(e) => handleWirePointerUp(e, connection.id)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handleResetWireAdjustment(connection.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleOpenConnectionModal(connection.id);
                      }
                    }}
                    title={`Drag label to move · Tap to inspect: ${connection.sourceZoneName} → ${connection.destinationZoneName} (${connection.primaryRuleName}) · Double-click to reset`}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 z-[35] px-2.5 py-1 rounded-full bg-white dark:bg-slate-900 border shadow-md font-mono text-[10px] font-semibold flex items-center gap-1.5 whitespace-nowrap select-none transition-shadow ${
                      isDraggingLabel
                        ? 'cursor-grabbing ring-2 ring-[var(--color-brand)] shadow-xl scale-105'
                        : 'cursor-grab hover:scale-105'
                    } ${style.pillClass} ${
                      isActive && !isDraggingLabel
                        ? 'ring-2 ring-[var(--color-brand)] shadow-lg'
                        : ''
                    }`}
                  >
                    <GripVertical className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="font-bold">{style.shortLabel}</span>
                    <span className="max-w-[78px] truncate text-slate-700 dark:text-slate-200">
                      {connection.sourceZoneName}
                    </span>
                    <ArrowRight className="w-3 h-3 shrink-0" />
                    <span className="max-w-[78px] truncate text-slate-700 dark:text-slate-200">
                      {connection.destinationZoneName}
                    </span>
                    {ruleSuffix && (
                      <span className="max-w-[130px] truncate font-normal text-slate-500 dark:text-slate-400">
                        · {ruleSuffix}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Compact Active Wire Bar below Canvas */}
      {activeConnection && (
        <div className="px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <Shield className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
            <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
              {activeConnection.sourceZoneName}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
              {activeConnection.destinationZoneName}
            </span>
            <StatusBadge
              label={wireStrokeStyle(activeConnection.verdict).fullLabel}
              variant={wireStrokeStyle(activeConnection.verdict).badgeVariant}
            />
            <span className="text-xs text-slate-600 dark:text-slate-400 truncate">
              {activeConnection.summary}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
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
                <span>Flip Reverse</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => handleOpenConnectionModal(activeConnection.id)}
              className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Inspect Rules ({activeConnection.rules.length})</span>
            </button>
          </div>
        </div>
      )}

      {/* Tap-to-Inspect Quick Rule Modal */}
      <ZoneRuleQuickInspectModal
        target={inspectTarget}
        onClose={() => setInspectTarget(null)}
        topology={topology}
        matrix={matrix}
        customRulesOnly={customRulesOnly}
        hasReverseConnection={inspectReverseAvailable}
        onInspectReverse={handleFlipInspectReverse}
        onOpenUnifiFirewall={onOpenUnifiFirewall}
      />
    </div>
  );
};
