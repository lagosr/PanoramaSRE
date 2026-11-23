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

export interface WireGeometry {
  connection: ZoneFlowConnection;
  pathD: string;
  labelX: number;
  labelY: number;
}

export const HIGH_LEVEL_CARD_WIDTH = 360;
export const INSPECTION_CARD_WIDTH = 520;
export const ESTIMATED_HIGH_LEVEL_HEIGHT = 270;
export const ESTIMATED_INSPECTION_HEIGHT = 560;
export const CANVAS_PAD = 28;
export const GUTTER_X = 136;
export const GUTTER_Y = 96;

const PILL_COLLISION_WIDTH = 230;
const PILL_COLLISION_HEIGHT = 32;

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

interface LayoutRowItem {
  zoneId: string;
  width: number;
  height: number;
}

export function computeAutoZoneLayout(
  zoneIds: string[],
  availableWidth: number,
  viewModeByZoneId: Record<string, ZoneCardViewMode>,
  measuredHeights?: Record<string, number>
): Record<string, ZoneCardPosition> {
  if (zoneIds.length === 0) return {};

  const safeWidth = Math.max(
    INSPECTION_CARD_WIDTH + CANVAS_PAD * 2,
    Math.round(availableWidth > 0 ? availableWidth : 1200)
  );

  const rows: Array<{
    items: LayoutRowItem[];
    rowWidth: number;
    rowHeight: number;
  }> = [];

  let currentItems: LayoutRowItem[] = [];
  let currentWidth = 0;
  let currentMaxHeight = 0;

  for (const zoneId of zoneIds) {
    const mode = viewModeByZoneId[zoneId] ?? 'high-level';
    const w = getZoneCardWidth(mode);
    const h = estimateCardHeight(zoneId, mode, measuredHeights);
    const nextWidth =
      currentItems.length === 0 ? w : currentWidth + GUTTER_X + w;

    if (
      currentItems.length > 0 &&
      CANVAS_PAD * 2 + nextWidth > safeWidth
    ) {
      rows.push({
        items: currentItems,
        rowWidth: currentWidth,
        rowHeight: currentMaxHeight,
      });
      currentItems = [{ zoneId, width: w, height: h }];
      currentWidth = w;
      currentMaxHeight = h;
    } else {
      currentItems.push({ zoneId, width: w, height: h });
      currentWidth = nextWidth;
      currentMaxHeight = Math.max(currentMaxHeight, h);
    }
  }

  if (currentItems.length > 0) {
    rows.push({
      items: currentItems,
      rowWidth: currentWidth,
      rowHeight: currentMaxHeight,
    });
  }

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
    cursorY += row.rowHeight + GUTTER_Y;
  }

  return positions;
}

export function mergeIncrementalZoneLayout(
  zoneIds: string[],
  existingPositions: Record<string, ZoneCardPosition>,
  availableWidth: number,
  viewModeByZoneId: Record<string, ZoneCardViewMode>,
  measuredHeights?: Record<string, number>
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
    measuredHeights
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

export function computeWireGeometries(
  connections: ZoneFlowConnection[],
  rectsByZoneId: Record<string, ZoneCardRect>
): WireGeometry[] {
  const geometries: WireGeometry[] = [];

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
    const laneOffset = conn.hasOppositeWire ? 22 : 0;

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

  // Iterative midpoint pill collision separation so wire labels never stack invisibly
  for (let pass = 0; pass < 6; pass += 1) {
    let moved = false;
    for (let i = 0; i < geometries.length; i += 1) {
      for (let j = i + 1; j < geometries.length; j += 1) {
        const a = geometries[i];
        const b = geometries[j];
        const overlapX = Math.abs(a.labelX - b.labelX) < PILL_COLLISION_WIDTH;
        const deltaY = Math.abs(a.labelY - b.labelY);
        if (overlapX && deltaY < PILL_COLLISION_HEIGHT) {
          const push = (PILL_COLLISION_HEIGHT - deltaY) / 2 + 2;
          if (a.labelY <= b.labelY) {
            a.labelY = Math.max(18, a.labelY - push);
            b.labelY += push;
          } else {
            b.labelY = Math.max(18, b.labelY - push);
            a.labelY += push;
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  return geometries;
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
    maxRight = Math.max(maxRight, geom.labelX + 140);
    maxBottom = Math.max(maxBottom, geom.labelY + 48);
  }

  return {
    width: Math.ceil(maxRight),
    height: Math.ceil(maxBottom),
  };
}
