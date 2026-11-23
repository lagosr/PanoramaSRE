import { describe, it, expect } from 'vitest';
import {
  CANVAS_PAD,
  ESTIMATED_HIGH_LEVEL_HEIGHT,
  ESTIMATED_INSPECTION_HEIGHT,
  HIGH_LEVEL_CARD_WIDTH,
  clampCardPosition,
  computeAutoZoneLayout,
  computeCanvasBounds,
  computeWireGeometries,
  formatWirePillRuleSuffix,
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
  hasOppositeWire = false,
  primaryRuleName = `Allow ${src} to ${dst}`
): ZoneFlowConnection {
  return {
    id: `${src}->${dst}`,
    sourceZoneId: src,
    destinationZoneId: dst,
    sourceZoneName: src,
    destinationZoneName: dst,
    verdict: 'ALLOW',
    summary: 'Allowed traffic',
    primaryRuleName,
    rules: [],
    customRuleCount: 1,
    hasOppositeWire,
  };
}

function rectsOverlap(a: ZoneCardRect, b: ZoneCardRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

describe('unifi-zone-layout', () => {
  it('resolves holistic vs per-zone view overrides cleanly', () => {
    expect(getZoneCardWidth('high-level')).toBe(HIGH_LEVEL_CARD_WIDTH);
    expect(getZoneCardWidth('inspection')).toBe(520);

    let overrides: Record<string, 'high-level' | 'inspection'> = {};
    expect(getEffectiveZoneViewMode('z1', 'high-level', overrides)).toBe(
      'high-level'
    );

    overrides = setZoneViewModeOverride(
      'z1',
      'inspection',
      'high-level',
      overrides
    );
    expect(getEffectiveZoneViewMode('z1', 'high-level', overrides)).toBe(
      'inspection'
    );
    expect(getEffectiveZoneViewMode('z2', 'high-level', overrides)).toBe(
      'high-level'
    );
    expect(Object.keys(overrides)).toEqual(['z1']);

    overrides = setZoneViewModeOverride(
      'z1',
      'high-level',
      'high-level',
      overrides
    );
    expect(Object.keys(overrides)).toHaveLength(0);
  });

  it('arranges 3 connected zones in a non-overlapping inverted triangle centered on the hub', () => {
    const ids = ['Adult', 'Internal', 'Untrusted'];
    const modes: Record<string, 'high-level' | 'inspection'> = {
      Adult: 'high-level',
      Internal: 'high-level',
      Untrusted: 'high-level',
    };
    const conns = [
      makeConnection('Adult', 'Internal'),
      makeConnection('Untrusted', 'Internal'),
    ];

    const layout = computeAutoZoneLayout(ids, 1400, modes, undefined, conns);
    // Internal has degree 2 -> placed centered on Row 2 beneath Row 1 leaves
    expect(layout.Adult.y).toBe(CANVAS_PAD);
    expect(layout.Untrusted.y).toBe(CANVAS_PAD);
    expect(layout.Internal.y).toBeGreaterThan(
      layout.Adult.y + ESTIMATED_HIGH_LEVEL_HEIGHT
    );
    expect(layout.Internal.x).toBeGreaterThan(layout.Adult.x);
    expect(layout.Internal.x).toBeLessThan(layout.Untrusted.x);
  });

  it('packs 4 zones into a 2x2 non-overlapping grid across mixed high-level and inspection views', () => {
    const ids = ['z1', 'z2', 'z3', 'z4'];
    const modes: Record<string, 'high-level' | 'inspection'> = {
      z1: 'high-level',
      z2: 'inspection',
      z3: 'high-level',
      z4: 'high-level',
    };

    const layout = computeAutoZoneLayout(ids, 1480, modes);
    expect(Object.keys(layout)).toEqual(ids);
    expect(layout.z1.y).toBe(CANVAS_PAD);
    expect(layout.z2.y).toBe(CANVAS_PAD);
    expect(layout.z3.y).toBeGreaterThan(layout.z1.y);
    expect(layout.z4.y).toBe(layout.z3.y);

    const rects: Record<string, ZoneCardRect> = {};
    for (const id of ids) {
      rects[id] = {
        x: layout[id].x,
        y: layout[id].y,
        width: getZoneCardWidth(modes[id]),
        height:
          modes[id] === 'high-level'
            ? ESTIMATED_HIGH_LEVEL_HEIGHT
            : ESTIMATED_INSPECTION_HEIGHT,
      };
    }
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        expect(rectsOverlap(rects[ids[i]], rects[ids[j]])).toBe(false);
      }
    }
  });

  it('clamps dragged coordinates and preserves custom user positions on incremental merges', () => {
    expect(clampCardPosition({ x: -40, y: 4.4 })).toEqual({ x: 16, y: 16 });
    expect(clampCardPosition({ x: 245.7, y: 180.2 })).toEqual({
      x: 246,
      y: 180,
    });

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
    expect(merged.z3.y).toBeGreaterThanOrEqual(520);
  });

  it('routes wires around intervening obstacle cards and avoids placing labels inside zone cards', () => {
    const rects: Record<string, ZoneCardRect> = {
      left: { x: 40, y: 180, width: 320, height: 240 },
      middle: { x: 500, y: 180, width: 320, height: 240 },
      right: { x: 960, y: 180, width: 320, height: 240 },
    };
    const conns = [makeConnection('left', 'right')];

    const geoms = computeWireGeometries(conns, rects);
    expect(geoms).toHaveLength(1);
    const g = geoms[0];

    // Wire anchor and label should detour above or below middle card (y: 180..420), not sit inside it
    expect(g.pathD).toContain(' Q ');
    const anchorOutsideMiddle =
      g.anchorY < rects.middle.y ||
      g.anchorY > rects.middle.y + rects.middle.height;
    expect(anchorOutsideMiddle).toBe(true);

    for (const r of Object.values(rects)) {
      const insideCard =
        g.labelX >= r.x &&
        g.labelX <= r.x + r.width &&
        g.labelY >= r.y &&
        g.labelY <= r.y + r.height;
      expect(insideCard).toBe(false);
    }
  });

  it('supports manual wire bending and independent pill dragging with dashed leader tether', () => {
    const rects: Record<string, ZoneCardRect> = {
      z1: { x: 40, y: 40, width: 360, height: 260 },
      z2: { x: 620, y: 40, width: 360, height: 260 },
    };
    const conns = [
      makeConnection('z1', 'z2', true),
      makeConnection('z2', 'z1', true),
    ];

    const autoGeoms = computeWireGeometries(conns, rects);
    expect(autoGeoms).toHaveLength(2);
    expect(
      Math.abs(autoGeoms[0].labelY - autoGeoms[1].labelY)
    ).toBeGreaterThanOrEqual(30);
    expect(autoGeoms[0].isManuallyAdjusted).toBe(false);

    const adjustedGeoms = computeWireGeometries(conns, rects, {
      'z1->z2': {
        wireDx: 0,
        wireDy: -95,
        labelDx: 65,
        labelDy: -30,
      },
    });
    const customWire = adjustedGeoms.find((g) => g.connection.id === 'z1->z2');
    expect(customWire).toBeDefined();
    expect(customWire!.isManuallyAdjusted).toBe(true);
    expect(customWire!.pathD).toContain(' Q ');
    expect(customWire!.tetherNeeded).toBe(true);
    expect(customWire!.labelX - customWire!.anchorX).toBe(65);
    expect(customWire!.labelY - customWire!.anchorY).toBe(-30);

    const bounds = computeCanvasBounds(rects, adjustedGeoms, 900, 460);
    expect(bounds.width).toBeGreaterThanOrEqual(620 + 360 + 96);
    expect(bounds.height).toBeGreaterThanOrEqual(460);
  });

  it('strips redundant rule suffixes in wire pills while preserving specific custom names', () => {
    expect(
      formatWirePillRuleSuffix(
        makeConnection('Adult', 'Internal', false, 'Allow Adult to Internal')
      )
    ).toBeNull();
    expect(
      formatWirePillRuleSuffix(
        makeConnection('Kids', 'Internal', false, 'Block Kids to Internal')
      )
    ).toBeNull();
    expect(
      formatWirePillRuleSuffix(
        makeConnection('Adult', 'Internal', false, 'Default Allow')
      )
    ).toBeNull();
    expect(
      formatWirePillRuleSuffix(
        makeConnection('Internal', 'Adult', false, 'Return Traffic Only')
      )
    ).toBeNull();
    expect(
      formatWirePillRuleSuffix(
        makeConnection(
          'Untrusted & IoT systems',
          'Internal',
          false,
          'Allow HomeAssistant to UNVR'
        )
      )
    ).toBe('Allow HomeAssistant to UNVR');
  });
});
