import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SegmentedControl,
  StatusBadge,
  ToggleSwitch,
} from '@lagosr/panorama-ui-kit';
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  ChevronRight,
  Eye,
  GripVertical,
  Layers,
  LayoutGrid,
  Network,
  Radio,
  RotateCcw,
  Search,
  Shield,
  Terminal,
  X,
} from 'lucide-react';
import type { DiscoveredApp, WshSnapshot } from '../../lib/types';
import type {
  IngressHop,
  SynthesizedTopology,
  TopologyRouteItem,
} from '../../lib/topology-synthesizer';
import {
  BOUNDARY_CANVAS_PAD,
  BOUNDARY_ESTIMATED_HIGH_LEVEL_HEIGHT,
  BOUNDARY_ESTIMATED_INSPECTION_HEIGHT,
  CORE_BOUNDARY_ZONE_IDS,
  HOST_DOCKER_PRESET_ZONE_IDS,
  buildTopologyBoundaryGraph,
  clampBoundaryCardPosition,
  computeAutoBoundaryLayout,
  computeBoundaryCanvasBounds,
  computeBoundaryWireGeometries,
  getBoundaryCardWidth,
  getEffectiveBoundaryViewMode,
  mergeIncrementalBoundaryLayout,
  setBoundaryViewModeOverride,
  type BoundaryAccentKey,
  type BoundaryCardPosition,
  type BoundaryCardRect,
  type BoundaryCardViewMode,
  type BoundaryRuleItem,
  type BoundaryWireManualAdjustment,
  type BoundaryWireVerdict,
  type BoundaryZoneId,
  type BoundaryZoneNode,
} from '../../lib/topology-boundary-layout';
import { CopyableAddressText } from '../ui/CopyableValue';
import {
  BoundaryConnectionInspectModal,
  type BoundaryInspectTarget,
} from './BoundaryConnectionInspectModal';

interface NetworkBoundaryCanvasProps {
  topology: SynthesizedTopology;
  selectedRouteSlug: string | null;
  onSelectRouteSlug: (slug: string | null) => void;
  onOpenInspector: (route: TopologyRouteItem | null, hop: IngressHop | null) => void;
  apps?: DiscoveredApp[];
  snapshot?: WshSnapshot | null;
  onRunTestHop?: (route: TopologyRouteItem) => void;
}

const VIEW_MODE_STORAGE_KEY = 'panoramasre_topology_boundary_view_mode';

function readInitialViewMode(): BoundaryCardViewMode {
  try {
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return saved === 'inspection' ? 'inspection' : 'high-level';
  } catch {
    return 'high-level';
  }
}

function accentStripStyle(accent: BoundaryAccentKey): {
  dotClass: string;
  chipClass: string;
} {
  switch (accent) {
    case 'indigo':
      return {
        dotClass: 'bg-indigo-500',
        chipClass:
          'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
      };
    case 'teal':
      return {
        dotClass: 'bg-teal-500',
        chipClass:
          'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30',
      };
    case 'emerald':
      return {
        dotClass: 'bg-emerald-500',
        chipClass:
          'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
      };
    case 'sky':
      return {
        dotClass: 'bg-sky-500',
        chipClass:
          'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
      };
    case 'amber':
      return {
        dotClass: 'bg-amber-500',
        chipClass:
          'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30',
      };
    case 'lime':
      return {
        dotClass: 'bg-lime-500',
        chipClass:
          'bg-lime-500/10 text-lime-800 dark:text-lime-300 border-lime-500/30',
      };
    case 'orange':
      return {
        dotClass: 'bg-orange-500',
        chipClass:
          'bg-orange-500/10 text-orange-800 dark:text-orange-300 border-orange-500/30',
      };
  }
}

function wireStrokeStyle(verdict: BoundaryWireVerdict): {
  stroke: string;
  markerId: string;
  dashArray?: string;
  pillClass: string;
  badgeVariant: 'success' | 'info' | 'warning' | 'danger' | 'neutral';
  shortLabel: string;
  fullLabel: string;
} {
  switch (verdict) {
    case 'VERIFIED':
      return {
        stroke: '#10b981',
        markerId: 'topo-arrow-verified',
        pillClass:
          'border-emerald-500/50 text-emerald-800 dark:text-emerald-300 hover:border-emerald-400',
        badgeVariant: 'success',
        shortLabel: 'VERIFIED',
        fullLabel: 'Verified Flow',
      };
    case 'TUNNEL':
      return {
        stroke: '#14b8a6',
        markerId: 'topo-arrow-tunnel',
        dashArray: '6 4',
        pillClass:
          'border-teal-500/50 text-teal-800 dark:text-teal-300 hover:border-teal-400',
        badgeVariant: 'info',
        shortLabel: 'TUNNEL',
        fullLabel: 'Encrypted Tunnel',
      };
    case 'PINHOLE':
      return {
        stroke: '#f59e0b',
        markerId: 'topo-arrow-pinhole',
        dashArray: '7 4',
        pillClass:
          'border-amber-500/50 text-amber-800 dark:text-amber-300 hover:border-amber-400',
        badgeVariant: 'warning',
        shortLabel: 'PINHOLE',
        fullLabel: 'Scoped Pinhole',
      };
    case 'BLOCKED':
      return {
        stroke: '#f43f5e',
        markerId: 'topo-arrow-blocked',
        dashArray: '2 5',
        pillClass:
          'border-rose-500/50 text-rose-800 dark:text-rose-300 hover:border-rose-400',
        badgeVariant: 'danger',
        shortLabel: 'BLOCKED',
        fullLabel: 'Blocked Boundary',
      };
    case 'WARNING':
      return {
        stroke: '#f97316',
        markerId: 'topo-arrow-warning',
        dashArray: '5 4',
        pillClass:
          'border-orange-500/50 text-orange-800 dark:text-orange-300 hover:border-orange-400',
        badgeVariant: 'warning',
        shortLabel: 'WARN',
        fullLabel: 'Attention Required',
      };
  }
}

function ruleActionChipClass(action: BoundaryRuleItem['action'], status: BoundaryRuleItem['status']): string {
  if (status === 'fail' || action === 'BLOCK') {
    return 'bg-rose-500/15 text-rose-700 dark:text-rose-300';
  }
  if (status === 'warn' || action === 'PINHOLE' || action === 'WARN') {
    return 'bg-amber-500/15 text-amber-800 dark:text-amber-300';
  }
  if (action === 'TUNNEL') {
    return 'bg-teal-500/15 text-teal-700 dark:text-teal-300';
  }
  return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
}

function positionsEqual(
  a: Partial<Record<BoundaryZoneId, BoundaryCardPosition>>,
  b: Partial<Record<BoundaryZoneId, BoundaryCardPosition>>
): boolean {
  const keysA = Object.keys(a) as BoundaryZoneId[];
  const keysB = Object.keys(b) as BoundaryZoneId[];
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const pa = a[key];
    const pb = b[key];
    if (!pa || !pb || pa.x !== pb.x || pa.y !== pb.y) return false;
  }
  return true;
}

export const NetworkBoundaryCanvas: React.FC<NetworkBoundaryCanvasProps> = ({
  topology,
  selectedRouteSlug,
  onSelectRouteSlug,
  onOpenInspector,
  apps = [],
  snapshot = null,
  onRunTestHop,
}) => {
  const [selectedZoneIds, setSelectedZoneIds] = useState<BoundaryZoneId[]>([
    ...CORE_BOUNDARY_ZONE_IDS,
  ]);
  const [showBlockedBoundaries, setShowBlockedBoundaries] = useState<boolean>(false);
  const [focusedRouteOnly, setFocusedRouteOnly] = useState<boolean>(false);

  const [globalViewMode, setGlobalViewMode] =
    useState<BoundaryCardViewMode>(readInitialViewMode);
  const [zoneViewOverrides, setZoneViewOverrides] = useState<
    Partial<Record<BoundaryZoneId, BoundaryCardViewMode>>
  >({});

  const [zoneEntitySearchById, setZoneEntitySearchById] = useState<
    Partial<Record<BoundaryZoneId, string>>
  >({});

  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);
  const [inspectTarget, setInspectTarget] = useState<BoundaryInspectTarget | null>(null);

  const [positionsByZoneId, setPositionsByZoneId] = useState<
    Partial<Record<BoundaryZoneId, BoundaryCardPosition>>
  >({});
  const [hasCustomLayout, setHasCustomLayout] = useState<boolean>(false);
  const [draggingZoneId, setDraggingZoneId] = useState<BoundaryZoneId | null>(null);
  const [wireAdjustmentsById, setWireAdjustmentsById] = useState<
    Record<string, BoundaryWireManualAdjustment>
  >({});
  const [draggingWireState, setDraggingWireState] = useState<{
    connectionId: string;
    mode: 'wire' | 'label';
  } | null>(null);
  const [cardStackOrder, setCardStackOrder] = useState<BoundaryZoneId[]>([]);
  const [canvasViewportWidth, setCanvasViewportWidth] = useState<number>(1200);
  const [measuredCardSizes, setMeasuredCardSizes] = useState<
    Partial<Record<BoundaryZoneId, { width: number; height: number }>>
  >({});

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<BoundaryZoneId, HTMLDivElement | null>>(new Map());
  const knownAvailableIdsRef = useRef<Set<BoundaryZoneId>>(new Set(CORE_BOUNDARY_ZONE_IDS));
  const dragSessionRef = useRef<{
    zoneId: BoundaryZoneId;
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

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, globalViewMode);
    } catch {
      // Ignore storage write failures cleanly
    }
  }, [globalViewMode]);

  useEffect(() => {
    if (!selectedRouteSlug && focusedRouteOnly) {
      setFocusedRouteOnly(false);
    }
  }, [selectedRouteSlug, focusedRouteOnly]);

  const focusedRoute = useMemo(
    () =>
      selectedRouteSlug
        ? topology.routes.find((r) => r.slug === selectedRouteSlug) ?? null
        : null,
    [topology.routes, selectedRouteSlug]
  );

  const graph = useMemo(
    () =>
      buildTopologyBoundaryGraph(topology, {
        apps,
        snapshot,
        selectedZoneIds,
        focusedRouteSlug: selectedRouteSlug,
        showBlockedBoundaries,
        focusedRouteOnly: Boolean(selectedRouteSlug && focusedRouteOnly),
      }),
    [
      topology,
      apps,
      snapshot,
      selectedZoneIds,
      selectedRouteSlug,
      showBlockedBoundaries,
      focusedRouteOnly,
    ]
  );

  // Auto-select newly discovered optional zones (like lan-services / unifi-siem) once
  useEffect(() => {
    const validIds = new Set(graph.zones.map((z) => z.id));
    const newlyDiscovered = graph.zones
      .map((z) => z.id)
      .filter((id) => !knownAvailableIdsRef.current.has(id));

    for (const id of validIds) {
      knownAvailableIdsRef.current.add(id);
    }

    setSelectedZoneIds((prev) => {
      const filtered = prev.filter((id) => validIds.has(id));
      const merged =
        newlyDiscovered.length > 0
          ? [...filtered, ...newlyDiscovered.filter((id) => !filtered.includes(id))]
          : filtered;
      if (
        merged.length === prev.length &&
        merged.every((id, idx) => id === prev[idx])
      ) {
        return prev;
      }
      return merged;
    });
  }, [graph.zones]);

  const selectedZones = useMemo(() => {
    const map = new Map<BoundaryZoneId, BoundaryZoneNode>(
      graph.zones.map((z) => [z.id, z])
    );
    return selectedZoneIds
      .map((id) => map.get(id))
      .filter((z): z is BoundaryZoneNode => Boolean(z));
  }, [graph.zones, selectedZoneIds]);

  const effectiveViewModeByZoneId = useMemo(() => {
    const next: Partial<Record<BoundaryZoneId, BoundaryCardViewMode>> = {};
    for (const id of selectedZoneIds) {
      next[id] = getEffectiveBoundaryViewMode(id, globalViewMode, zoneViewOverrides);
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

  const connections = graph.connections;

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
      connections.find((c) => c.id === 'host->bridges') ??
      connections.find((c) => !c.isBlockedBoundary) ??
      connections[0];
    setActiveConnectionId(preferred?.id ?? null);
  }, [connections, activeConnectionId]);

  const activeConnection = useMemo(
    () => connections.find((c) => c.id === activeConnectionId) ?? null,
    [connections, activeConnectionId]
  );

  useEffect(() => {
    const validIds = new Set(connections.map((c) => c.id));
    setWireAdjustmentsById((prev) => {
      const keys = Object.keys(prev);
      if (keys.every((k) => validIds.has(k))) return prev;
      const next: Record<string, BoundaryWireManualAdjustment> = {};
      for (const k of keys) {
        if (validIds.has(k)) next[k] = prev[k];
      }
      return next;
    });
  }, [connections]);

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

  useEffect(() => {
    if (selectedZones.length === 0) return;
    const syncMeasurements = () => {
      setMeasuredCardSizes((prev) => {
        let changed = false;
        const next: Partial<Record<BoundaryZoneId, { width: number; height: number }>> =
          { ...prev };
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
    const map: Partial<Record<BoundaryZoneId, number>> = {};
    for (const id of Object.keys(measuredCardSizes) as BoundaryZoneId[]) {
      const sz = measuredCardSizes[id];
      if (sz) map[id] = sz.height;
    }
    return map;
  }, [measuredCardSizes]);

  useEffect(() => {
    if (selectedZoneIds.length === 0) {
      setPositionsByZoneId({});
      return;
    }
    setPositionsByZoneId((prev) => {
      const next = hasCustomLayout
        ? mergeIncrementalBoundaryLayout(
            selectedZoneIds,
            prev,
            canvasViewportWidth,
            effectiveViewModeByZoneId,
            measuredHeightMap
          )
        : computeAutoBoundaryLayout(
            selectedZoneIds,
            canvasViewportWidth,
            effectiveViewModeByZoneId,
            measuredHeightMap
          );
      return positionsEqual(prev, next) ? prev : next;
    });
  }, [
    selectedZoneIds,
    canvasViewportWidth,
    effectiveViewModeByZoneId,
    measuredHeightMap,
    hasCustomLayout,
  ]);

  const rectsByZoneId = useMemo(() => {
    const map: Partial<Record<BoundaryZoneId, BoundaryCardRect>> = {};
    for (const z of selectedZones) {
      const mode = effectiveViewModeByZoneId[z.id] ?? globalViewMode;
      const pos = positionsByZoneId[z.id] ?? {
        x: BOUNDARY_CANVAS_PAD,
        y: BOUNDARY_CANVAS_PAD,
      };
      const measured = measuredCardSizes[z.id];
      map[z.id] = {
        x: pos.x,
        y: pos.y,
        width: measured?.width || getBoundaryCardWidth(mode),
        height:
          measured?.height ||
          (mode === 'high-level'
            ? BOUNDARY_ESTIMATED_HIGH_LEVEL_HEIGHT
            : BOUNDARY_ESTIMATED_INSPECTION_HEIGHT),
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
        ? computeBoundaryWireGeometries(
            connections,
            rectsByZoneId,
            wireAdjustmentsById
          )
        : [],
    [selectedZones.length, connections, rectsByZoneId, wireAdjustmentsById]
  );

  const canvasBounds = useMemo(
    () =>
      computeBoundaryCanvasBounds(
        rectsByZoneId,
        wireGeometries,
        canvasViewportWidth,
        460
      ),
    [rectsByZoneId, wireGeometries, canvasViewportWidth]
  );

  const bringCardToFront = useCallback((zoneId: BoundaryZoneId) => {
    setCardStackOrder((prev) => [...prev.filter((id) => id !== zoneId), zoneId]);
  }, []);

  const handleGlobalViewModeChange = (mode: BoundaryCardViewMode) => {
    setGlobalViewMode(mode);
    setZoneViewOverrides({});
    if (!hasCustomLayout) {
      const nextModes: Partial<Record<BoundaryZoneId, BoundaryCardViewMode>> = {};
      for (const id of selectedZoneIds) nextModes[id] = mode;
      setPositionsByZoneId(
        computeAutoBoundaryLayout(selectedZoneIds, canvasViewportWidth, nextModes)
      );
    }
  };

  const handlePerZoneViewModeChange = (
    zoneId: BoundaryZoneId,
    mode: BoundaryCardViewMode
  ) => {
    setZoneViewOverrides((prev) =>
      setBoundaryViewModeOverride(zoneId, mode, globalViewMode, prev)
    );
  };

  const handleAutoArrange = () => {
    setHasCustomLayout(false);
    setDraggingZoneId(null);
    setWireAdjustmentsById({});
    setDraggingWireState(null);
    setPositionsByZoneId(
      computeAutoBoundaryLayout(
        selectedZoneIds,
        canvasViewportWidth,
        effectiveViewModeByZoneId,
        measuredHeightMap
      )
    );
  };

  const toggleZoneSelection = (zoneId: BoundaryZoneId) => {
    setSelectedZoneIds((prev) =>
      prev.includes(zoneId)
        ? prev.filter((id) => id !== zoneId)
        : [...prev, zoneId]
    );
  };

  const applyPresetZones = (presetIds: readonly BoundaryZoneId[]) => {
    const valid = new Set(graph.zones.map((z) => z.id));
    setHasCustomLayout(false);
    setWireAdjustmentsById({});
    setSelectedZoneIds(presetIds.filter((id) => valid.has(id)));
  };

  // Drag handlers on Boundary Zone Card Header
  const handleDragStart = (
    e: React.PointerEvent<HTMLDivElement>,
    zoneId: BoundaryZoneId
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    bringCardToFront(zoneId);
    const currentPos = positionsByZoneId[zoneId] ?? {
      x: BOUNDARY_CANVAS_PAD,
      y: BOUNDARY_CANVAS_PAD,
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
      // Ignore capture unavailability
    }
  };

  const handleDragMove = (
    e: React.PointerEvent<HTMLDivElement>,
    zoneId: BoundaryZoneId
  ) => {
    const session = dragSessionRef.current;
    if (
      !session ||
      session.zoneId !== zoneId ||
      session.pointerId !== e.pointerId
    ) {
      return;
    }
    const dx = e.clientX - session.startClientX;
    const dy = e.clientY - session.startClientY;
    if (!session.moved && Math.hypot(dx, dy) < 3) {
      return;
    }
    session.moved = true;
    setHasCustomLayout(true);
    const clamped = clampBoundaryCardPosition({
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
    zoneId: BoundaryZoneId
  ) => {
    const session = dragSessionRef.current;
    if (
      !session ||
      session.zoneId !== zoneId ||
      session.pointerId !== e.pointerId
    ) {
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
    focusedRule: BoundaryRuleItem | null = null
  ) => {
    const conn = connections.find((c) => c.id === connId) ?? null;
    if (conn) {
      setActiveConnectionId(conn.id);
      setInspectTarget({
        connection: conn,
        focusedRule,
        sourceZone: graph.zones.find((z) => z.id === conn.sourceZoneId) ?? null,
        destinationZone:
          graph.zones.find((z) => z.id === conn.destinationZoneId) ?? null,
      });
    }
  };

  const handleInspectRuleFromCard = (
    rule: BoundaryRuleItem,
    cardZone: BoundaryZoneNode
  ) => {
    const srcZoneId =
      rule.direction === 'IN' && rule.peerZoneId ? rule.peerZoneId : cardZone.id;
    const dstZoneId =
      rule.direction === 'OUT' && rule.peerZoneId
        ? rule.peerZoneId
        : rule.direction === 'IN'
          ? cardZone.id
          : cardZone.id;
    const matchingConn =
      connections.find(
        (c) =>
          c.sourceZoneId === srcZoneId &&
          c.destinationZoneId === dstZoneId &&
          c.rules.some((r) => r.id === rule.id)
      ) ??
      connections.find(
        (c) => c.sourceZoneId === srcZoneId && c.destinationZoneId === dstZoneId
      ) ??
      null;
    if (matchingConn) {
      setActiveConnectionId(matchingConn.id);
    }
    setInspectTarget({
      connection: matchingConn,
      focusedRule: rule,
      sourceZone: graph.zones.find((z) => z.id === srcZoneId) ?? cardZone,
      destinationZone: graph.zones.find((z) => z.id === dstZoneId) ?? cardZone,
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
    return connections.some(
      (c) => c.sourceZoneId === dstId && c.destinationZoneId === srcId
    );
  }, [inspectTarget, connections]);

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
      setInspectTarget({
        connection: revConn,
        focusedRule: null,
        sourceZone: graph.zones.find((z) => z.id === dstId) ?? null,
        destinationZone: graph.zones.find((z) => z.id === srcId) ?? null,
      });
    }
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
      const isDraggingThisWire =
        draggingWireState?.connectionId === connection.id;
      const isFocused = isActive || isHovered || isDraggingThisWire;
      const dimmed =
        (hoveredConnectionId && !isHovered && !isDraggingThisWire) ||
        (!hoveredConnectionId &&
          activeConnectionId &&
          !isActive &&
          !isDraggingThisWire);

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

  const hasLanServicesZone = graph.zones.some((z) => z.id === 'lan-services');

  return (
    <div className="space-y-4">
      {/* Multi-Zone Selector, Route Focus, View Level & Wire Controls */}
      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              WSH Zero-Trust Boundary Flow ({selectedZones.length} active)
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Drag perimeter cards, wire curves, or wire labels to arrange freely. Tap any wire, label, or rule row to inspect boundary enforcement (double-click a wire/label to reset).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <SegmentedControl<BoundaryCardViewMode>
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
              title="Arrange boundary zones in a zero-crossing serpentine ingress flow"
              className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Auto-Arrange</span>
            </button>

            {Object.keys(wireAdjustmentsById).length > 0 && (
              <button
                type="button"
                onClick={() => setWireAdjustmentsById({})}
                title="Reset custom wire bends and label offsets while preserving card positions"
                className="btn-ghost text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Wires</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => applyPresetZones(CORE_BOUNDARY_ZONE_IDS)}
              className="btn-tonal text-xs whitespace-nowrap flex-shrink-0"
            >
              Full Ingress
            </button>

            <button
              type="button"
              onClick={() => applyPresetZones(HOST_DOCKER_PRESET_ZONE_IDS)}
              className="btn-secondary text-xs whitespace-nowrap flex-shrink-0"
            >
              Host &amp; Docker
            </button>

            {hasLanServicesZone && (
              <button
                type="button"
                onClick={() =>
                  applyPresetZones([...CORE_BOUNDARY_ZONE_IDS, 'lan-services'])
                }
                className="btn-secondary text-xs whitespace-nowrap flex-shrink-0"
              >
                All (+ SIEM)
              </button>
            )}

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

        {/* Multi-Select Perimeter Zone Chips */}
        <div className="flex flex-wrap gap-2">
          {graph.zones.map((zone) => {
            const isSelected = selectedZoneIds.includes(zone.id);
            const style = accentStripStyle(zone.accentKey);
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
                <span className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                  {zone.entities.length}
                </span>
                {zone.warningCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-800 dark:text-amber-300 text-[10px] font-mono font-bold tabular-nums">
                    {zone.warningCount}
                  </span>
                )}
                {isSelected && (
                  <Check className="w-3.5 h-3.5 text-[var(--color-brand-text)] shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Active Target Route Strip */}
        {topology.routes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <span className="text-[11px] font-mono font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mr-1">
              <Radio className="w-3.5 h-3.5 text-[var(--color-brand-text)]" />
              Target Route Focus:
            </span>
            <button
              type="button"
              onClick={() => onSelectRouteSlug(null)}
              className={`px-2.5 py-1 rounded-lg border text-xs font-mono transition-all cursor-pointer whitespace-nowrap flex-shrink-0 ${
                selectedRouteSlug === null
                  ? 'bg-[var(--color-brand-subtle)] border-[var(--color-brand)] text-[var(--color-brand-text)] font-semibold'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400'
              }`}
            >
              All Routes ({topology.routes.length})
            </button>
            {topology.routes.map((rt) => {
              const isSelected = selectedRouteSlug === rt.slug;
              return (
                <button
                  key={rt.slug}
                  type="button"
                  onClick={() =>
                    onSelectRouteSlug(isSelected ? null : rt.slug)
                  }
                  className={`px-2.5 py-1 rounded-lg border text-xs font-mono transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap flex-shrink-0 tabular-nums ${
                    isSelected
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-700 dark:text-emerald-300 font-semibold shadow-sm'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      rt.isHealthy ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                  <span>/{rt.slug}</span>
                  <span className="text-[10px] text-slate-400">:{rt.port}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Wire Controls & Legend */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <ToggleSwitch
                size="sm"
                checked={showBlockedBoundaries}
                onChange={setShowBlockedBoundaries}
                activeColor="brand"
              />
              <span className="font-mono text-slate-700 dark:text-slate-300">
                Show Blocked Boundaries
              </span>
            </label>

            {selectedRouteSlug && (
              <label className="flex items-center gap-2 cursor-pointer">
                <ToggleSwitch
                  size="sm"
                  checked={focusedRouteOnly}
                  onChange={setFocusedRouteOnly}
                  activeColor="brand"
                />
                <span className="font-mono text-slate-700 dark:text-slate-300">
                  Focused Route Only (/{selectedRouteSlug})
                </span>
              </label>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-600 dark:text-slate-400 tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-emerald-500 inline-block" /> Verified Flow
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-0.5 border-t-2 border-dashed border-teal-500 inline-block" /> Encrypted Tunnel
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-0.5 border-t-2 border-dashed border-amber-500 inline-block" /> Scoped Pinhole
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-0.5 border-t-2 border-dotted border-rose-500 inline-block" /> Blocked Boundary
            </span>
          </div>
        </div>
      </div>

      {/* Free-Canvas Draggable Perimeter Zone Stage */}
      {selectedZones.length === 0 ? (
        <div className="p-8 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center space-y-2">
          <Network className="w-6 h-6 text-slate-400 mx-auto" />
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Select one or more security perimeter zones above
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Click <strong>Full Ingress</strong> or select individual boundary layers to inspect ports, CGNAT bridges, container isolation, and directional rules.
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
                    { id: 'topo-arrow-verified', color: '#10b981' },
                    { id: 'topo-arrow-tunnel', color: '#14b8a6' },
                    { id: 'topo-arrow-pinhole', color: '#f59e0b' },
                    { id: 'topo-arrow-blocked', color: '#f43f5e' },
                    { id: 'topo-arrow-warning', color: '#f97316' },
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
                    { id: 'overlay-topo-arrow-verified', color: '#10b981' },
                    { id: 'overlay-topo-arrow-tunnel', color: '#14b8a6' },
                    { id: 'overlay-topo-arrow-pinhole', color: '#f59e0b' },
                    { id: 'overlay-topo-arrow-blocked', color: '#f43f5e' },
                    { id: 'overlay-topo-arrow-warning', color: '#f97316' },
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

            {/* Draggable Perimeter Zone Container Cards (z-[10..29]) */}
            {selectedZones.map((zone) => {
              const style = accentStripStyle(zone.accentKey);
              const viewMode =
                effectiveViewModeByZoneId[zone.id] ?? globalViewMode;
              const isHighLevel = viewMode === 'high-level';
              const cardWidth = getBoundaryCardWidth(viewMode);
              const pos = positionsByZoneId[zone.id] ?? {
                x: BOUNDARY_CANVAS_PAD,
                y: BOUNDARY_CANVAS_PAD,
              };
              const stackIdx = cardStackOrder.indexOf(zone.id);
              const isDragging = draggingZoneId === zone.id;
              const zIndex = isDragging
                ? 29
                : 10 + (stackIdx >= 0 ? Math.min(18, stackIdx + 1) : 0);

              const entitySearch = (zoneEntitySearchById[zone.id] ?? '')
                .trim()
                .toLowerCase();
              const visibleEntities = entitySearch
                ? zone.entities.filter((ent) =>
                    [
                      ent.name,
                      ent.subtitle ?? '',
                      ent.primaryAddress ?? '',
                      ent.secondaryAddress ?? '',
                      ent.badge ?? '',
                    ]
                      .join(' ')
                      .toLowerCase()
                      .includes(entitySearch)
                  )
                : zone.entities;

              const outOpenCount = connections.filter(
                (c) => c.sourceZoneId === zone.id && !c.isBlockedBoundary
              ).length;
              const inOpenCount = connections.filter(
                (c) => c.destinationZoneId === zone.id && !c.isBlockedBoundary
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
                  {/* Top Perimeter Accent Strip */}
                  <div className={`h-1 w-full ${style.dotClass}`} />

                  {/* Draggable Header */}
                  <div
                    onPointerDown={(e) => handleDragStart(e, zone.id)}
                    onPointerMove={(e) => handleDragMove(e, zone.id)}
                    onPointerUp={(e) => handleDragEnd(e, zone.id)}
                    onPointerCancel={(e) => handleDragEnd(e, zone.id)}
                    title="Drag header to reposition boundary container"
                    className={`px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-col gap-2 bg-white dark:bg-slate-900 select-none ${
                      isDragging ? 'cursor-grabbing' : 'cursor-grab'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <GripVertical className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${style.dotClass}`}
                        />
                        <h4
                          className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug break-words"
                          title={zone.name}
                        >
                          {zone.name}
                        </h4>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleZoneSelection(zone.id)}
                        onPointerDown={(e) => e.stopPropagation()}
                        aria-label={`Hide ${zone.name} from boundary canvas`}
                        title={`Hide ${zone.name}`}
                        className="min-w-[28px] min-h-[28px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0 -mt-0.5 -mr-1"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pl-6">
                      <span
                        className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-semibold tabular-nums shrink-0 ${style.chipClass}`}
                      >
                        {zone.badgeLabel}
                      </span>

                      <div
                        className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-0.5 text-[10px] font-mono shrink-0"
                        onPointerDown={(e) => e.stopPropagation()}
                      >
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
                    </div>
                  </div>

                  {/* Metadata Sub-Bar with 1-Click Copy Addresses */}
                  <div className="px-3.5 py-1.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
                      {zone.metadataAddresses.map((addr, idx) => (
                        <React.Fragment key={addr}>
                          {idx > 0 && <span>•</span>}
                          <CopyableAddressText text={addr} />
                        </React.Fragment>
                      ))}
                      {zone.metadataSummary && (
                        <span className="text-slate-500 dark:text-slate-400">
                          · {zone.metadataSummary}
                        </span>
                      )}
                    </span>
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
                            <span>Boundary Rules ({zone.rules.length})</span>
                          </div>
                          {zone.warningCount > 0 ? (
                            <StatusBadge
                              label={`${zone.warningCount} Warn`}
                              variant="warning"
                            />
                          ) : (
                            <StatusBadge label="Enforced" variant="success" />
                          )}
                        </div>

                        <div className="max-h-44 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800">
                          {zone.rules.map((rule) => {
                            const peerChip =
                              rule.direction === 'OUT'
                                ? `→ ${rule.peerZoneName || ''}`
                                : rule.direction === 'IN'
                                  ? `← ${rule.peerZoneName || ''}`
                                  : 'LOCAL';

                            return (
                              <button
                                key={`${zone.id}-hl-${rule.id}`}
                                type="button"
                                onClick={() =>
                                  handleInspectRuleFromCard(rule, zone)
                                }
                                className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left transition-colors cursor-pointer group hover:bg-slate-50 dark:hover:bg-slate-800/60"
                              >
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span
                                    className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold shrink-0 ${ruleActionChipClass(
                                      rule.action,
                                      rule.status
                                    )}`}
                                  >
                                    {rule.action}
                                  </span>
                                  <span className="text-[10px] font-mono shrink-0 max-w-[105px] truncate text-slate-500 dark:text-slate-400">
                                    {peerChip}
                                  </span>
                                  <span className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                                    {rule.title}
                                  </span>
                                </div>
                                <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[var(--color-brand-text)] shrink-0" />
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Collapsed Entities Summary Strip */}
                      <div className="px-3.5 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-mono text-[11px] tabular-nums">
                          <Layers className="w-3.5 h-3.5 text-[var(--color-accent-text)] shrink-0" />
                          <span>
                            {zone.entityKindLabel}:{' '}
                            <strong>{zone.entities.length}</strong>
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
                     * INSPECTION DETAILED VIEW (Full Rules + Entities Table)
                     * ========================================================= */
                    <>
                      {/* Rules & Invariants Table */}
                      <div className="flex flex-col border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                        <div className="px-3.5 py-2 bg-slate-100/90 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-700/80 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider tabular-nums">
                            <Shield className="w-3.5 h-3.5 text-[var(--color-brand-text)] shrink-0" />
                            <span>
                              Boundary Controls &amp; Invariants (
                              {zone.rules.length})
                            </span>
                          </div>
                          {zone.warningCount > 0 ? (
                            <StatusBadge
                              label={`${zone.warningCount} Warn`}
                              variant="warning"
                            />
                          ) : (
                            <StatusBadge label="Enforced" variant="success" />
                          )}
                        </div>

                        <div className="max-h-[240px] overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800">
                          {zone.rules.map((rule) => {
                            const dirBadge =
                              rule.direction === 'OUT'
                                ? `OUT → ${rule.peerZoneName || ''}`
                                : rule.direction === 'IN'
                                  ? `IN ← ${rule.peerZoneName || ''}`
                                  : 'LOCAL GUARDRAIL';

                            return (
                              <div
                                key={`${zone.id}-${rule.id}`}
                                role="button"
                                tabIndex={0}
                                onClick={() =>
                                  handleInspectRuleFromCard(rule, zone)
                                }
                                onKeyDown={(e) => {
                                  if (e.target !== e.currentTarget) return;
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleInspectRuleFromCard(rule, zone);
                                  }
                                }}
                                className="w-full px-3.5 py-2.5 text-left space-y-1 transition-colors cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] odd:bg-white dark:odd:bg-slate-900 even:bg-slate-50/70 dark:even:bg-slate-950/60 hover:bg-slate-100/80 dark:hover:bg-slate-800/70"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                    <StatusBadge
                                      label={rule.action}
                                      variant={
                                        rule.action === 'BLOCK' ||
                                        rule.status === 'fail'
                                          ? 'danger'
                                          : rule.action === 'PINHOLE' ||
                                              rule.status === 'warn'
                                            ? 'warning'
                                            : rule.action === 'TUNNEL'
                                              ? 'info'
                                              : 'success'
                                      }
                                    />
                                    <span className="px-1.5 py-0.5 rounded font-mono text-[10px] border bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400">
                                      {dirBadge}
                                    </span>
                                    {rule.invariantId && (
                                      <StatusBadge
                                        label={rule.invariantId}
                                        variant="brand"
                                      />
                                    )}
                                  </div>
                                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[var(--color-brand-text)] shrink-0" />
                                </div>

                                <div className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                                  {rule.title}
                                </div>

                                <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 leading-snug">
                                  <CopyableAddressText
                                    text={
                                      rule.protocol
                                        ? `${rule.protocol} • ${rule.detail}`
                                        : rule.detail
                                    }
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Entities Table */}
                      <div className="flex flex-col bg-white dark:bg-slate-900">
                        <div className="px-3.5 py-2 bg-slate-100/90 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-700/80 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider tabular-nums">
                            <Layers className="w-3.5 h-3.5 text-[var(--color-accent-text)] shrink-0" />
                            <span>
                              {zone.entityKindLabel} ({zone.entities.length})
                            </span>
                          </div>

                          {zone.entities.length > 3 && (
                            <div className="relative w-44">
                              <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                              <input
                                type="text"
                                value={zoneEntitySearchById[zone.id] ?? ''}
                                onChange={(e) =>
                                  setZoneEntitySearchById((prev) => ({
                                    ...prev,
                                    [zone.id]: e.target.value,
                                  }))
                                }
                                placeholder="Filter entries..."
                                className="w-full pl-7 pr-2 py-1 text-[11px] font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
                              />
                            </div>
                          )}
                        </div>

                        {visibleEntities.length === 0 ? (
                          <div className="p-4 text-xs font-mono text-slate-500 text-center">
                            {entitySearch
                              ? 'No entries match your filter.'
                              : 'No active endpoints in this perimeter layer.'}
                          </div>
                        ) : (
                          <div className="max-h-[240px] overflow-y-auto">
                            <table className="w-full text-left border-collapse">
                              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                {visibleEntities.map((ent) => {
                                  const linkedRoute = ent.routeSlug
                                    ? topology.routes.find(
                                        (r) => r.slug === ent.routeSlug
                                      ) ?? null
                                    : null;
                                  const isRouteFocused = Boolean(
                                    ent.routeSlug &&
                                      selectedRouteSlug === ent.routeSlug
                                  );

                                  return (
                                    <tr
                                      key={ent.id}
                                      className={`transition-colors ${
                                        isRouteFocused
                                          ? 'bg-[var(--color-brand-subtle)]/35'
                                          : 'odd:bg-white dark:odd:bg-slate-900 even:bg-slate-50/70 dark:even:bg-slate-950/60 hover:bg-slate-100/80 dark:hover:bg-slate-800/70'
                                      }`}
                                    >
                                      <td className="py-2 px-3 align-middle">
                                        <div className="flex items-center gap-1.5">
                                          <span
                                            className={`w-2 h-2 rounded-full shrink-0 ${
                                              ent.status === 'healthy'
                                                ? 'bg-emerald-500'
                                                : ent.status === 'warning'
                                                  ? 'bg-amber-500'
                                                  : 'bg-slate-400'
                                            }`}
                                          />
                                          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[190px]">
                                            {ent.name}
                                          </span>
                                          {ent.badge && (
                                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[10px] text-slate-600 dark:text-slate-300 tabular-nums">
                                              {ent.badge}
                                            </span>
                                          )}
                                        </div>
                                        {ent.subtitle && (
                                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate max-w-[235px]">
                                            {ent.subtitle}
                                          </div>
                                        )}
                                      </td>

                                      <td className="py-2 px-2 align-middle font-mono tabular-nums">
                                        {ent.primaryAddress && (
                                          <div className="text-xs text-slate-800 dark:text-slate-200">
                                            <CopyableAddressText
                                              text={ent.primaryAddress}
                                            />
                                          </div>
                                        )}
                                        {ent.secondaryAddress && (
                                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                            <CopyableAddressText
                                              text={ent.secondaryAddress}
                                            />
                                          </div>
                                        )}
                                      </td>

                                      <td className="py-2 px-3 align-middle text-right">
                                        <div className="inline-flex items-center gap-1">
                                          {ent.routeSlug && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                onSelectRouteSlug(
                                                  isRouteFocused
                                                    ? null
                                                    : ent.routeSlug || null
                                                )
                                              }
                                              title={
                                                isRouteFocused
                                                  ? 'Clear route focus'
                                                  : `Focus topology on /${ent.routeSlug}`
                                              }
                                              className={`px-2 py-1 rounded-lg border text-[10px] font-mono font-semibold whitespace-nowrap flex-shrink-0 cursor-pointer ${
                                                isRouteFocused
                                                  ? 'bg-[var(--color-brand-subtle)] border-[var(--color-brand)] text-[var(--color-brand-text)]'
                                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-400'
                                              }`}
                                            >
                                              {isRouteFocused
                                                ? 'Focused'
                                                : 'Focus'}
                                            </button>
                                          )}
                                          {(linkedRoute || ent.hop) && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                onOpenInspector(
                                                  linkedRoute,
                                                  ent.hop ?? null
                                                )
                                              }
                                              title="Open Socket & Storage Inspector Drawer"
                                              className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-[var(--color-brand)] text-[10px] font-mono font-semibold whitespace-nowrap flex-shrink-0 cursor-pointer"
                                            >
                                              Drawer
                                            </button>
                                          )}
                                        </div>
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
                  ({
                    connection,
                    anchorX,
                    anchorY,
                    labelX,
                    labelY,
                    tetherNeeded,
                  }) => {
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
                          onMouseEnter={() =>
                            setHoveredConnectionId(connection.id)
                          }
                          onMouseLeave={() => {
                            if (!draggingWireState)
                              setHoveredConnectionId(null);
                          }}
                          onPointerDown={(e) =>
                            handleWirePointerDown(e, connection.id, 'wire')
                          }
                          onPointerMove={(e) =>
                            handleWirePointerMove(e, connection.id)
                          }
                          onPointerUp={(e) =>
                            handleWirePointerUp(e, connection.id)
                          }
                          onPointerCancel={(e) =>
                            handleWirePointerUp(e, connection.id)
                          }
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            handleResetWireAdjustment(connection.id);
                          }}
                        >
                          <circle
                            cx={anchorX}
                            cy={anchorY}
                            r={12}
                            fill="transparent"
                          />
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
                    onPointerMove={(e) =>
                      handleWirePointerMove(e, connection.id)
                    }
                    onPointerUp={(e) =>
                      handleWirePointerUp(e, connection.id)
                    }
                    onPointerCancel={(e) =>
                      handleWirePointerUp(e, connection.id)
                    }
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
                    title={`Drag label to move · Tap to inspect: ${connection.sourceZoneName} → ${connection.destinationZoneName} (${connection.protocolLabel}) · Double-click to reset`}
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
                    <span className="max-w-[70px] truncate text-slate-700 dark:text-slate-200">
                      {connection.sourceZoneName}
                    </span>
                    <ArrowRight className="w-3 h-3 shrink-0" />
                    <span className="max-w-[70px] truncate text-slate-700 dark:text-slate-200">
                      {connection.destinationZoneName}
                    </span>
                    {connection.protocolLabel && (
                      <span className="max-w-[100px] truncate font-normal text-slate-500 dark:text-slate-400">
                        · {connection.protocolLabel}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Compact Active Boundary Bar below Canvas */}
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

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {connections.some(
              (c) =>
                c.sourceZoneId === activeConnection.destinationZoneId &&
                c.destinationZoneId === activeConnection.sourceZoneId
            ) && (
              <button
                type="button"
                onClick={() => {
                  const rev = connections.find(
                    (c) =>
                      c.sourceZoneId === activeConnection.destinationZoneId &&
                      c.destinationZoneId === activeConnection.sourceZoneId
                  );
                  if (rev) setActiveConnectionId(rev.id);
                }}
                className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span>Flip Pair</span>
              </button>
            )}

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

            {focusedRoute && (
              <button
                type="button"
                onClick={() =>
                  onOpenInspector(focusedRoute, activeConnection.hop ?? null)
                }
                className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Socket Drawer</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleOpenConnectionModal(activeConnection.id)}
              className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Inspect Boundary ({activeConnection.rules.length})</span>
            </button>
          </div>
        </div>
      )}

      {/* Tap-to-Inspect Quick Boundary Modal */}
      <BoundaryConnectionInspectModal
        target={inspectTarget}
        onClose={() => setInspectTarget(null)}
        zones={graph.zones}
        focusedRoute={focusedRoute}
        hasReverseConnection={inspectReverseAvailable}
        onInspectReverse={handleFlipInspectReverse}
        onOpenDeepDrawer={onOpenInspector}
        onRunTestHop={onRunTestHop}
      />
    </div>
  );
};
