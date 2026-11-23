import { describe, it, expect } from 'vitest';
import {
  CANVAS_PAD,
  HIGH_LEVEL_CARD_WIDTH,
  INSPECTION_CARD_WIDTH,
  clampCardPosition,
  computeAutoZoneLayout,
  computeCanvasBounds,
  computeWireGeometries,
  getEffectiveZoneViewMode,
  getZoneCardWidth,
  mergeIncrementalZoneLayout,
  setZoneViewModeOverride,
  type ZoneCardRect,
} from '../unifi-zone-layout';
import type { ZoneFlowConnection } from '../unifi-zbf';

function makeConnection(
  src: string,
  dst: string,
  hasOppositeWire = false
): ZoneFlowConnection {
  return {
    id: `${src}->${dst}`,
    sourceZoneId: src,
    destinationZoneId: dst,
    sourceZoneName: src,
    destinationZoneName: dst,
    verdict: 'ALLOW',
    summary: 'Allowed traffic',
    primaryRuleName: `Allow ${src} to ${dst}`,
    rules: [],
    customRuleCount: 1,
    hasOppositeWire,
  };
}

describe('unifi-zone-layout', () => {
  it('resolves holistic vs per-zone view overrides cleanly', () => {
    expect(getZoneCardWidth('high-level')).toBe(HIGH_LEVEL_CARD_WIDTH);
    expect(getZoneCardWidth('inspection')).toBe(INSPECTION_CARD_WIDTH);

    let overrides: Record<string, 'high-level' | 'inspection'> = {};
    expect(getEffectiveZoneViewMode('z1', 'high-level', overrides)).toBe(
      'high-level'
    );

    overrides = setZoneViewModeOverride('z1', 'inspection', 'high-level', overrides);
    expect(getEffectiveZoneViewMode('z1', 'high-level', overrides)).toBe(
      'inspection'
    );
    expect(getEffectiveZoneViewMode('z2', 'high-level', overrides)).toBe(
      'high-level'
    );
    expect(Object.keys(overrides)).toEqual(['z1']);

    // Setting back to match holistic globalMode removes redundant override key
    overrides = setZoneViewModeOverride('z1', 'high-level', 'high-level', overrides);
    expect(Object.keys(overrides)).toHaveLength(0);
  });

  it('packs zones into non-overlapping centered rows across high-level, inspection, and mixed modes', () => {
    const ids = ['z1', 'z2', 'z3', 'z4'];
    const modes: Record<string, 'high-level' | 'inspection'> = {
      z1: 'high-level',
      z2: 'inspection',
      z3: 'high-level',
      z4: 'high-level',
    };

    const layout = computeAutoZoneLayout(ids, 1280, modes);
    expect(Object.keys(layout)).toEqual(ids);

    // First row fits z1 (360) + gutter (136) + z2 (520) = 1016 inside 1280; z3 wraps cleanly to row 2
    expect(layout.z1.y).toBe(CANVAS_PAD);
    expect(layout.z2.y).toBe(CANVAS_PAD);
    expect(layout.z2.x).toBeGreaterThan(layout.z1.x + HIGH_LEVEL_CARD_WIDTH);
    expect(layout.z3.y).toBeGreaterThan(layout.z1.y);
    expect(layout.z4.y).toBe(layout.z3.y);

    // Every pair of placed cards is strictly non-overlapping
    const rects: Record<string, ZoneCardRect> = {};
    for (const id of ids) {
      rects[id] = {
        x: layout[id].x,
        y: layout[id].y,
        width: getZoneCardWidth(modes[id]),
        height: modes[id] === 'high-level' ? 270 : 560,
      };
    }
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = rects[ids[i]];
        const b = rects[ids[j]];
        const overlapsX = a.x < b.x + b.width && a.x + a.width > b.x;
        const overlapsY = a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlapsX && overlapsY).toBe(false);
      }
    }
  });

  it('clamps dragged coordinates and preserves custom user positions on incremental merges', () => {
    expect(clampCardPosition({ x: -40, y: 4.4 })).toEqual({ x: 16, y: 16 });
    expect(clampCardPosition({ x: 245.7, y: 180.2 })).toEqual({ x: 246, y: 180 });

    const existing = {
      z1: { x: 420, y: 95 },
      z2: { x: 40, y: 210 },
      zRemoved: { x: 700, y: 300 },
    };
    const merged = mergeIncrementalZoneLayout(
      ['z1', 'z2', 'z3'],
      existing,
      1280,
      { z1: 'high-level', z2: 'high-level', z3: 'inspection' },
      { z1: 240, z2: 310 }
    );

    expect(merged.zRemoved).toBeUndefined();
    expect(merged.z1).toEqual({ x: 420, y: 95 });
    expect(merged.z2).toEqual({ x: 40, y: 210 });
    // Newly added card z3 lands below existing cards (maxBottom 210 + 310 = 520 + gutter)
    expect(merged.z3.y).toBeGreaterThanOrEqual(520);
  });

  it('computes separated bidirectional wires, de-overlaps colliding pills, and sizes canvas bounds', () => {
    const rects: Record<string, ZoneCardRect> = {
      z1: { x: 30, y: 30, width: 360, height: 260 },
      z2: { x: 560, y: 30, width: 360, height: 260 },
    };
    const conns = [
      makeConnection('z1', 'z2', true),
      makeConnection('z2', 'z1', true),
    ];

    const geoms = computeWireGeometries(conns, rects);
    expect(geoms).toHaveLength(2);
    expect(geoms[0].pathD).not.toBe(geoms[1].pathD);
    // Pill separation ensures midpoint labels stay clearly legible apart
    expect(Math.abs(geoms[0].labelY - geoms[1].labelY)).toBeGreaterThanOrEqual(30);

    const bounds = computeCanvasBounds(rects, geoms, 900, 460);
    expect(bounds.width).toBeGreaterThanOrEqual(560 + 360 + 96);
    expect(bounds.height).toBeGreaterThanOrEqual(460);
  });
});
