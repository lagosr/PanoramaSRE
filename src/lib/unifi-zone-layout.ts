import type { ZoneFlowConnection } from './unifi-zbf';

export type ZoneCardViewMode = 'high-level' | 'inspection';

export interface ZoneCardPosition {
  x: number;
  y: number;
}

export interface ZoneCardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WireManualAdjustment {
  wireDx: number;
  wireDy: number;
  labelDx: number;
  labelDy: number;
}

export interface WireGeometry {
  connection: ZoneFlowConnection;
  pathD: string;
  anchorX: number;
  anchorY: number;
  labelX: number;
  labelY: number;
  tetherNeeded: boolean;
  isManuallyAdjusted: boolean;
}

export const HIGH_LEVEL_CARD_WIDTH = 360;
export const INSPECTION_CARD_WIDTH = 520;
export const ESTIMATED_HIGH_LEVEL_HEIGHT = 368;
export const ESTIMATED_INSPECTION_HEIGHT = 640;
export const CANVAS_PAD = 44;
export const GUTTER_X = 240;
export const GUTTER_Y = 148;

const PILL_HALF_WIDTH = 120;
const PILL_HALF_HEIGHT = 16;
const PILL_COLLISION_WIDTH = 244;
const PILL_COLLISION_HEIGHT = 34;

export function getZoneCardWidth(mode: ZoneCardViewMode): number {
  return mode === 'high-level' ? HIGH_LEVEL_CARD_WIDTH : INSPECTION_CARD_WIDTH;
}

export function getEffectiveZoneViewMode(
  zoneId: string,
  globalMode: ZoneCardViewMode,
  overrides: Record<string, ZoneCardViewMode>
): ZoneCardViewMode {
  return overrides[zoneId] ?? globalMode;
}

export function setZoneViewModeOverride(
  zoneId: string,
  mode: ZoneCardViewMode,
  globalMode: ZoneCardViewMode,
  prev: Record<string, ZoneCardViewMode>
): Record<string, ZoneCardViewMode> {
  const next = { ...prev };
  if (mode === globalMode) {
    delete next[zoneId];
  } else {
    next[zoneId] = mode;
  }
  return next;
}

export function clampCardPosition(pos: ZoneCardPosition): ZoneCardPosition {
  return {
    x: Math.max(16, Math.round(pos.x)),
    y: Math.max(16, Math.round(pos.y)),
  };
}

export function formatWirePillRuleSuffix(conn: ZoneFlowConnection): string | null {
  const raw = (conn.primaryRuleName ?? '').trim();
  if (!raw) return null;

  const normalizedRule = raw.toLowerCase().replace(/\s+/g, ' ');
  if (
    normalizedRule === 'default allow' ||
    normalizedRule === 'default block' ||
    normalizedRule === 'return traffic only'
  ) {
    return null;
  }

  const src = conn.sourceZoneName.trim().toLowerCase().replace(/\s+/g, ' ');
  const dst = conn.destinationZoneName.trim().toLowerCase().replace(/\s+/g, ' ');
  if (
    normalizedRule === `allow ${src} to ${dst}` ||
    normalizedRule === `block ${src} to ${dst}`
  ) {
    return null;
  }

  return raw;
}

function estimateCardHeight(
  zoneId: string,
  mode: ZoneCardViewMode,
  measuredHeights?: Record<string, number>
): number {
  const measured = measuredHeights?.[zoneId];
  if (typeof measured === 'number' && Number.isFinite(measured) && measured > 0) {
    return measured;
  }
  return mode === 'high-level'
    ? ESTIMATED_HIGH_LEVEL_HEIGHT
    : ESTIMATED_INSPECTION_HEIGHT;
}

function buildTopologyAffinity(
  zoneIds: string[],
  connections?: ZoneFlowConnection[]
): {
  neighborsById: Map<string, Set<string>>;
  edgeWeightById: Map<string, number>;
} {
  const validSet = new Set(zoneIds);
  const neighborsById = new Map<string, Set<string>>();
  const edgeWeightById = new Map<string, number>();

  for (const id of zoneIds) {
    neighborsById.set(id, new Set());
    edgeWeightById.set(id, 0);
  }

  for (const conn of connections ?? []) {
    if (
      conn.sourceZoneId === conn.destinationZoneId ||
      !validSet.has(conn.sourceZoneId) ||
      !validSet.has(conn.destinationZoneId)
    ) {
      continue;
    }
    neighborsById.get(conn.sourceZoneId)?.add(conn.destinationZoneId);
    neighborsById.get(conn.destinationZoneId)?.add(conn.sourceZoneId);
    edgeWeightById.set(
      conn.sourceZoneId,
      (edgeWeightById.get(conn.sourceZoneId) ?? 0) + 1
    );
    edgeWeightById.set(
      conn.destinationZoneId,
      (edgeWeightById.get(conn.destinationZoneId) ?? 0) + 1
    );
  }

  return { neighborsById, edgeWeightById };
}

function orderByAffinity(
  ids: string[],
  neighborsById: Map<string, Set<string>>,
  edgeWeightById: Map<string, number>
): string[] {
  if (ids.length <= 1) return [...ids];
  const originalIdx = new Map(ids.map((id, i) => [id, i]));
  const sortedByDegree = [...ids].sort((a, b) => {
    const degA = neighborsById.get(a)?.size ?? 0;
    const degB = neighborsById.get(b)?.size ?? 0;
    if (degB !== degA) return degB - degA;
    const wA = edgeWeightById.get(a) ?? 0;
    const wB = edgeWeightById.get(b) ?? 0;
    if (wB !== wA) return wB - wA;
    return (originalIdx.get(a) ?? 0) - (originalIdx.get(b) ?? 0);
  });

  const remaining = new Set(sortedByDegree);
  const ordered: string[] = [];

  while (remaining.size > 0) {
    const seed = sortedByDegree.find((id) => remaining.has(id));
    if (!seed) break;
    ordered.push(seed);
    remaining.delete(seed);

    let last = seed;
    while (remaining.size > 0) {
      const neighbors = neighborsById.get(last);
      const next = sortedByDegree.find(
        (cand) => remaining.has(cand) && neighbors?.has(cand)
      );
      if (!next) break;
      ordered.push(next);
      remaining.delete(next);
      last = next;
    }
  }

  return ordered;
}

interface LayoutRowItem {
  zoneId: string;
  mode: ZoneCardViewMode;
  width: number;
  height: number;
}

export function computeAutoZoneLayout(
  zoneIds: string[],
  availableWidth: number,
  viewModeByZoneId: Record<string, ZoneCardViewMode>,
  measuredHeights?: Record<string, number>,
  connections?: ZoneFlowConnection[]
): Record<string, ZoneCardPosition> {
  if (zoneIds.length === 0) return {};

  const safeWidth = Math.max(
    INSPECTION_CARD_WIDTH + CANVAS_PAD * 2,
    Math.round(availableWidth > 0 ? availableWidth : 1360)
  );

  const getDim = (id: string): LayoutRowItem => {
    const mode = viewModeByZoneId[id] ?? 'high-level';
    return {
      zoneId: id,
      mode,
      width: getZoneCardWidth(mode),
      height: estimateCardHeight(id, mode, measuredHeights),
    };
  };

  const { neighborsById, edgeWeightById } = buildTopologyAffinity(
    zoneIds,
    connections
  );
  const connectedIds = zoneIds.filter(
    (id) => (neighborsById.get(id)?.size ?? 0) > 0
  );
  const isolatedIds = zoneIds.filter(
    (id) => (neighborsById.get(id)?.size ?? 0) === 0
  );
  const orderedConnected = orderByAffinity(
    connectedIds,
    neighborsById,
    edgeWeightById
  );
  const orderedAll = [...orderedConnected, ...isolatedIds];

  // 1-zone layout: centered horizontally at top
  if (orderedAll.length === 1) {
    const d = getDim(orderedAll[0]);
    const x = Math.max(CANVAS_PAD, Math.round((safeWidth - d.width) / 2));
    return { [d.zoneId]: clampCardPosition({ x, y: CANVAS_PAD }) };
  }

  // 2-zone layout: side-by-side when availableWidth fits cleanly, else vertical stack
  if (orderedAll.length === 2) {
    const [a, b] = [getDim(orderedAll[0]), getDim(orderedAll[1])];
    if (a.width + b.width + GUTTER_X + CANVAS_PAD * 2 <= safeWidth) {
      const rowWidth = a.width + GUTTER_X + b.width;
      const startX = Math.max(CANVAS_PAD, Math.round((safeWidth - rowWidth) / 2));
      return {
        [a.zoneId]: clampCardPosition({ x: startX, y: CANVAS_PAD }),
        [b.zoneId]: clampCardPosition({ x: startX + a.width + GUTTER_X, y: CANVAS_PAD }),
      };
    }
    const ax = Math.max(CANVAS_PAD, Math.round((safeWidth - a.width) / 2));
    const bx = Math.max(CANVAS_PAD, Math.round((safeWidth - b.width) / 2));
    return {
      [a.zoneId]: clampCardPosition({ x: ax, y: CANVAS_PAD }),
      [b.zoneId]: clampCardPosition({ x: bx, y: CANVAS_PAD + a.height + GUTTER_Y }),
    };
  }

  // 3-zone inverted triangle formation:
  // Two cards on Row 1 separated by wide corridor, highest-degree hub centered underneath on Row 2
  // so every pairwise wire has a clear unobstructed path without passing behind a middle card.
  if (orderedAll.length === 3) {
    const sortedHub = [...orderedAll].sort((a, b) => {
      const degA = neighborsById.get(a)?.size ?? 0;
      const degB = neighborsById.get(b)?.size ?? 0;
      if (degB !== degA) return degB - degA;
      const wA = edgeWeightById.get(a) ?? 0;
      const wB = edgeWeightById.get(b) ?? 0;
      if (wB !== wA) return wB - wA;
      return zoneIds.indexOf(a) - zoneIds.indexOf(b);
    });
    const hubId =
      (neighborsById.get(sortedHub[0])?.size ?? 0) > 0
        ? sortedHub[0]
        : orderedAll[2];
    const topPairIds = orderedAll.filter((id) => id !== hubId);
    const left = getDim(topPairIds[0]);
    const right = getDim(topPairIds[1]);
    const hub = getDim(hubId);

    const triGutterX = Math.max(GUTTER_X, 260);
    const row1Width = left.width + triGutterX + right.width;
    const row1X = Math.max(CANVAS_PAD, Math.round((safeWidth - row1Width) / 2));
    const row1MaxH = Math.max(left.height, right.height);
    const hubX = Math.max(
      CANVAS_PAD,
      Math.round(row1X + (row1Width - hub.width) / 2)
    );
    const hubY = CANVAS_PAD + row1MaxH + GUTTER_Y;

    return {
      [left.zoneId]: clampCardPosition({ x: row1X, y: CANVAS_PAD }),
      [right.zoneId]: clampCardPosition({
        x: row1X + left.width + triGutterX,
        y: CANVAS_PAD,
      }),
      [hub.zoneId]: clampCardPosition({ x: hubX, y: hubY }),
    };
  }

  // 4-zone clean 2x2 matrix grid
  if (orderedAll.length === 4) {
    const [d0, d1, d2, d3] = orderedAll.map(getDim);
    const gridGutterX = Math.max(GUTTER_X, 240);
    const gridGutterY = Math.max(GUTTER_Y, 156);
    const col0W = Math.max(d0.width, d2.width);
    const col1W = Math.max(d1.width, d3.width);
    const totalW = col0W + gridGutterX + col1W;
    const baseX = Math.max(CANVAS_PAD, Math.round((safeWidth - totalW) / 2));
    const row1H = Math.max(d0.height, d1.height);
    const row2Y = CANVAS_PAD + row1H + gridGutterY;

    return {
      [d0.zoneId]: clampCardPosition({
        x: baseX + Math.round((col0W - d0.width) / 2),
        y: CANVAS_PAD,
      }),
      [d1.zoneId]: clampCardPosition({
        x: baseX + col0W + gridGutterX + Math.round((col1W - d1.width) / 2),
        y: CANVAS_PAD,
      }),
      [d2.zoneId]: clampCardPosition({
        x: baseX + Math.round((col0W - d2.width) / 2),
        y: row2Y,
      }),
      [d3.zoneId]: clampCardPosition({
        x: baseX + col0W + gridGutterX + Math.round((col1W - d3.width) / 2),
        y: row2Y,
      }),
    };
  }

  // 5+ zones: adaptive row packing keeping connected zones grouped cleanly before isolated zones
  const packGroup = (
    groupIds: string[]
  ): Array<{ items: LayoutRowItem[]; rowWidth: number; rowHeight: number }> => {
    const rows: Array<{
      items: LayoutRowItem[];
      rowWidth: number;
      rowHeight: number;
    }> = [];
    let currentItems: LayoutRowItem[] = [];
    let currentWidth = 0;
    let currentMaxHeight = 0;

    for (const id of groupIds) {
      const item = getDim(id);
      const nextWidth =
        currentItems.length === 0 ? item.width : currentWidth + GUTTER_X + item.width;
      const allHighLevelRow =
        currentItems.every((i) => i.mode === 'high-level') &&
        item.mode === 'high-level';
      const maxCols = safeWidth >= 1650 && allHighLevelRow ? 3 : 2;

      if (
        currentItems.length > 0 &&
        (currentItems.length >= maxCols || CANVAS_PAD * 2 + nextWidth > safeWidth)
      ) {
        rows.push({
          items: currentItems,
          rowWidth: currentWidth,
          rowHeight: currentMaxHeight,
        });
        currentItems = [item];
        currentWidth = item.width;
        currentMaxHeight = item.height;
      } else {
        currentItems.push(item);
        currentWidth = nextWidth;
        currentMaxHeight = Math.max(currentMaxHeight, item.height);
      }
    }

    if (currentItems.length > 0) {
      rows.push({
        items: currentItems,
        rowWidth: currentWidth,
        rowHeight: currentMaxHeight,
      });
    }
    return rows;
  };

  const rows = [
    ...packGroup(orderedConnected),
    ...packGroup(isolatedIds),
  ];

  const rowGutterY = Math.max(GUTTER_Y, 156);
  const positions: Record<string, ZoneCardPosition> = {};
  let cursorY = CANVAS_PAD;

  for (const row of rows) {
    let cursorX = Math.max(
      CANVAS_PAD,
      Math.round((safeWidth - row.rowWidth) / 2)
    );
    for (const item of row.items) {
      positions[item.zoneId] = clampCardPosition({ x: cursorX, y: cursorY });
      cursorX += item.width + GUTTER_X;
    }
    cursorY += row.rowHeight + rowGutterY;
  }

  return positions;
}

export function mergeIncrementalZoneLayout(
  zoneIds: string[],
  existingPositions: Record<string, ZoneCardPosition>,
  availableWidth: number,
  viewModeByZoneId: Record<string, ZoneCardViewMode>,
  measuredHeights?: Record<string, number>,
  connections?: ZoneFlowConnection[]
): Record<string, ZoneCardPosition> {
  const next: Record<string, ZoneCardPosition> = {};
  const missingIds: string[] = [];
  let maxBottom = 0;
  let keptCount = 0;

  for (const zoneId of zoneIds) {
    const existing = existingPositions[zoneId];
    if (
      existing &&
      Number.isFinite(existing.x) &&
      Number.isFinite(existing.y)
    ) {
      const clamped = clampCardPosition(existing);
      next[zoneId] = clamped;
      const mode = viewModeByZoneId[zoneId] ?? 'high-level';
      const h = estimateCardHeight(zoneId, mode, measuredHeights);
      maxBottom = Math.max(maxBottom, clamped.y + h);
      keptCount += 1;
    } else {
      missingIds.push(zoneId);
    }
  }

  if (missingIds.length === 0) {
    return next;
  }

  const addedLayout = computeAutoZoneLayout(
    missingIds,
    availableWidth,
    viewModeByZoneId,
    measuredHeights,
    connections
  );
  const offsetY = keptCount === 0 ? 0 : maxBottom + GUTTER_Y - CANVAS_PAD;

  for (const zoneId of missingIds) {
    const pos = addedLayout[zoneId] ?? { x: CANVAS_PAD, y: CANVAS_PAD };
    next[zoneId] = clampCardPosition({
      x: pos.x,
      y: pos.y + offsetY,
    });
  }

  return next;
}

function pointInsideRect(
  px: number,
  py: number,
  r: ZoneCardRect,
  pad: number
): boolean {
  return (
    px >= r.x - pad &&
    px <= r.x + r.width + pad &&
    py >= r.y - pad &&
    py <= r.y + r.height + pad
  );
}

function pillOverlapsRect(
  lx: number,
  ly: number,
  r: ZoneCardRect,
  pad: number
): boolean {
  return (
    lx + PILL_HALF_WIDTH > r.x - pad &&
    lx - PILL_HALF_WIDTH < r.x + r.width + pad &&
    ly + PILL_HALF_HEIGHT > r.y - pad &&
    ly - PILL_HALF_HEIGHT < r.y + r.height + pad
  );
}

function pillsCollide(
  ax: number,
  ay: number,
  bx: number,
  by: number
): boolean {
  return (
    Math.abs(ax - bx) < PILL_COLLISION_WIDTH &&
    Math.abs(ay - by) < PILL_COLLISION_HEIGHT
  );
}

function evalCubic(
  t: number,
  sx: number,
  sy: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  ex: number,
  ey: number
): { x: number; y: number } {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * sx + 3 * mt2 * t * c1x + 3 * mt * t2 * c2x + t2 * t * ex,
    y: mt2 * mt * sy + 3 * mt2 * t * c1y + 3 * mt * t2 * c2y + t2 * t * ey,
  };
}

function evalQuadratic(
  t: number,
  sx: number,
  sy: number,
  qx: number,
  qy: number,
  ex: number,
  ey: number
): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: mt * mt * sx + 2 * mt * t * qx + t * t * ex,
    y: mt * mt * sy + 2 * mt * t * qy + t * t * ey,
  };
}

export function computeWireGeometries(
  connections: ZoneFlowConnection[],
  rectsByZoneId: Record<string, ZoneCardRect>,
  adjustmentsByConnectionId?: Record<string, WireManualAdjustment>
): WireGeometry[] {
  const allRects = Object.values(rectsByZoneId).filter(
    (r) => r.width > 0 && r.height > 0
  );
  const rawResults: Array<WireGeometry & { hasManualLabel: boolean }> = [];
  const placedPills: Array<{ x: number; y: number }> = [];
  let detourStaggerCount = 0;

  for (const conn of connections) {
    const sRect = rectsByZoneId[conn.sourceZoneId];
    const dRect = rectsByZoneId[conn.destinationZoneId];
    if (!sRect || !dRect || sRect.width <= 0 || dRect.width <= 0) {
      continue;
    }

    const sCenterX = sRect.x + sRect.width / 2;
    const sCenterY = sRect.y + sRect.height / 2;
    const dCenterX = dRect.x + dRect.width / 2;
    const dCenterY = dRect.y + dRect.height / 2;

    const dx = dCenterX - sCenterX;
    const dy = dCenterY - sCenterY;
    const dist = Math.hypot(dx, dy);
    if (!Number.isFinite(dist) || dist < 1) continue;

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
        x1 = sRect.x + sRect.width;
        x2 = dRect.x;
        tx1 = 1;
        tx2 = -1;
      } else {
        x1 = sRect.x;
        x2 = dRect.x + dRect.width;
        tx1 = -1;
        tx2 = 1;
      }
      y1 = sCenterY;
      y2 = dCenterY;
    } else {
      if (dy >= 0) {
        y1 = sRect.y + sRect.height;
        y2 = dRect.y;
        ty1 = 1;
        ty2 = -1;
      } else {
        y1 = sRect.y;
        y2 = dRect.y + dRect.height;
        ty1 = -1;
        ty2 = 1;
      }
      x1 = sCenterX;
      x2 = dCenterX;
    }

    const edgeDx = x2 - x1;
    const edgeDy = y2 - y1;
    const edgeDist = Math.max(1, Math.hypot(edgeDx, edgeDy));
    const nx = -edgeDy / edgeDist;
    const ny = edgeDx / edgeDist;
    const laneOffset = conn.hasOppositeWire ? 24 : 0;

    const sx = x1 + nx * laneOffset;
    const sy = y1 + ny * laneOffset;
    const ex = x2 + nx * laneOffset;
    const ey = y2 + ny * laneOffset;

    const curveHandle = Math.max(46, Math.min(130, edgeDist * 0.42));
    const archBoost = conn.hasOppositeWire ? 28 : 0;
    const c1x = sx + tx1 * curveHandle + nx * archBoost;
    const c1y = sy + ty1 * curveHandle + ny * archBoost;
    const c2x = ex + tx2 * curveHandle + nx * archBoost;
    const c2y = ey + ty2 * curveHandle + ny * archBoost;

    const baseMid = evalCubic(0.5, sx, sy, c1x, c1y, c2x, c2y, ex, ey);
    if (!Number.isFinite(baseMid.x) || !Number.isFinite(baseMid.y)) continue;

    const adj = adjustmentsByConnectionId?.[conn.id];
    const wireDx = adj?.wireDx ?? 0;
    const wireDy = adj?.wireDy ?? 0;
    const labelDx = adj?.labelDx ?? 0;
    const labelDy = adj?.labelDy ?? 0;
    const hasManualWire = wireDx !== 0 || wireDy !== 0;
    const hasManualLabel = labelDx !== 0 || labelDy !== 0;

    let pathD = '';
    let anchorX = baseMid.x;
    let anchorY = baseMid.y;
    let sampleCurve: (t: number) => { x: number; y: number } = (t) =>
      evalCubic(t, sx, sy, c1x, c1y, c2x, c2y, ex, ey);

    if (hasManualWire) {
      anchorX = Math.max(24, baseMid.x + wireDx);
      anchorY = Math.max(24, baseMid.y + wireDy);
      const qx = 2 * anchorX - 0.5 * (sx + ex);
      const qy = 2 * anchorY - 0.5 * (sy + ey);
      pathD = `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`;
      sampleCurve = (t) => evalQuadratic(t, sx, sy, qx, qy, ex, ey);
    } else {
      // Check third-party zone cards that block the default spline corridor
      const otherRects = Object.entries(rectsByZoneId)
        .filter(([zId, r]) => zId !== conn.sourceZoneId && zId !== conn.destinationZoneId && r.width > 0 && r.height > 0)
        .map(([, r]) => r);

      const blockers: ZoneCardRect[] = [];
      for (const r of otherRects) {
        let hit = false;
        for (let step = 3; step <= 17; step += 1) {
          const pt = evalCubic(step / 20, sx, sy, c1x, c1y, c2x, c2y, ex, ey);
          if (pointInsideRect(pt.x, pt.y, r, 18)) {
            hit = true;
            break;
          }
        }
        if (hit) blockers.push(r);
      }

      if (blockers.length > 0) {
        const minX = Math.min(...blockers.map((r) => r.x));
        const minY = Math.min(...blockers.map((r) => r.y));
        const maxX = Math.max(...blockers.map((r) => r.x + r.width));
        const maxY = Math.max(...blockers.map((r) => r.y + r.height));
        const stagger = detourStaggerCount * 32 + (conn.hasOppositeWire ? 18 : 0);
        detourStaggerCount += 1;

        let detourX = baseMid.x;
        let detourY = baseMid.y;

        if (horizontalPrimary) {
          const aboveY = Math.max(28, minY - 46 - stagger);
          const belowY = maxY + 46 + stagger;
          const midY = (sy + ey) / 2;
          const pickAbove =
            minY >= 96 && Math.abs(aboveY - midY) <= Math.abs(belowY - midY);
          detourX = Math.max(28, Math.min(minX, maxX) + (maxX - minX) / 2);
          detourY = pickAbove ? aboveY : belowY;
        } else {
          const leftX = Math.max(28, minX - 48 - stagger);
          const rightX = maxX + 48 + stagger;
          const midX = (sx + ex) / 2;
          const pickLeft =
            minX >= 110 && Math.abs(leftX - midX) <= Math.abs(rightX - midX);
          detourX = pickLeft ? leftX : rightX;
          detourY = Math.max(28, minY + (maxY - minY) / 2);
        }

        anchorX = detourX;
        anchorY = detourY;
        const qx = 2 * detourX - 0.5 * (sx + ex);
        const qy = 2 * detourY - 0.5 * (sy + ey);
        pathD = `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`;
        sampleCurve = (t) => evalQuadratic(t, sx, sy, qx, qy, ex, ey);
      } else {
        pathD = `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`;
      }
    }

    let labelX = anchorX;
    let labelY = anchorY;

    if (hasManualLabel) {
      labelX = Math.max(90, anchorX + labelDx);
      labelY = Math.max(20, anchorY + labelDy);
    } else {
      const candidates: Array<{ x: number; y: number }> = [
        { x: anchorX, y: anchorY },
      ];
      for (const t of [0.42, 0.58, 0.34, 0.66, 0.26, 0.74]) {
        candidates.push(sampleCurve(t));
      }
      candidates.push(
        { x: anchorX + nx * 34, y: anchorY + ny * 34 },
        { x: anchorX - nx * 34, y: anchorY - ny * 34 },
        { x: anchorX, y: Math.max(22, anchorY - 40) },
        { x: anchorX, y: anchorY + 40 }
      );

      let bestScore = Infinity;
      let bestPoint = candidates[0];
      for (const cand of candidates) {
        const cx = Math.max(90, cand.x);
        const cy = Math.max(20, cand.y);
        let score = Math.hypot(cx - anchorX, cy - anchorY) * 0.5;
        for (const r of allRects) {
          if (pillOverlapsRect(cx, cy, r, 12)) {
            score += 10000;
          }
        }
        for (const p of placedPills) {
          if (pillsCollide(cx, cy, p.x, p.y)) {
            score += 500;
          }
        }
        if (score < bestScore) {
          bestScore = score;
          bestPoint = { x: cx, y: cy };
        }
      }
      labelX = bestPoint.x;
      labelY = bestPoint.y;
    }

    placedPills.push({ x: labelX, y: labelY });

    rawResults.push({
      connection: conn,
      pathD,
      anchorX,
      anchorY,
      labelX,
      labelY,
      tetherNeeded: false,
      isManuallyAdjusted: hasManualWire || hasManualLabel,
      hasManualLabel,
    });
  }

  // Iterative midpoint pill separation pass for auto-placed labels only
  for (let pass = 0; pass < 6; pass += 1) {
    let moved = false;
    for (let i = 0; i < rawResults.length; i += 1) {
      for (let j = i + 1; j < rawResults.length; j += 1) {
        const a = rawResults[i];
        const b = rawResults[j];
        if (!pillsCollide(a.labelX, a.labelY, b.labelX, b.labelY)) {
          continue;
        }
        const deltaY = Math.abs(b.labelY - a.labelY);
        const overlapY = PILL_COLLISION_HEIGHT - deltaY;
        if (!a.hasManualLabel && !b.hasManualLabel) {
          const push = overlapY / 2 + 2;
          if (a.labelY <= b.labelY) {
            a.labelY = Math.max(20, a.labelY - push);
            b.labelY += push;
          } else {
            b.labelY = Math.max(20, b.labelY - push);
            a.labelY += push;
          }
          moved = true;
        } else if (!a.hasManualLabel) {
          a.labelY =
            a.labelY <= b.labelY
              ? Math.max(20, b.labelY - PILL_COLLISION_HEIGHT - 2)
              : b.labelY + PILL_COLLISION_HEIGHT + 2;
          moved = true;
        } else if (!b.hasManualLabel) {
          b.labelY =
            b.labelY <= a.labelY
              ? Math.max(20, a.labelY - PILL_COLLISION_HEIGHT - 2)
              : a.labelY + PILL_COLLISION_HEIGHT + 2;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  return rawResults.map(({ hasManualLabel: _ignored, ...geom }) => ({
    ...geom,
    tetherNeeded: Math.hypot(geom.labelX - geom.anchorX, geom.labelY - geom.anchorY) > 14,
  }));
}

export function computeCanvasBounds(
  rectsByZoneId: Record<string, ZoneCardRect>,
  geometries: WireGeometry[],
  minWidth: number,
  minHeight = 460
): { width: number; height: number } {
  let maxRight = Math.max(minWidth, 320);
  let maxBottom = Math.max(minHeight, 320);

  for (const rect of Object.values(rectsByZoneId)) {
    maxRight = Math.max(maxRight, rect.x + rect.width + 96);
    maxBottom = Math.max(maxBottom, rect.y + rect.height + 96);
  }

  for (const geom of geometries) {
    maxRight = Math.max(maxRight, geom.anchorX + 96, geom.labelX + 140);
    maxBottom = Math.max(maxBottom, geom.anchorY + 64, geom.labelY + 48);
  }

  return {
    width: Math.ceil(maxRight),
    height: Math.ceil(maxBottom),
  };
}
