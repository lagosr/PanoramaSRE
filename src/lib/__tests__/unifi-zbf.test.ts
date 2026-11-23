import { describe, it, expect } from 'vitest';
import {
  buildZbfMatrix,
  computeZoneReachability,
  getVlanBadgeStyle,
} from '../unifi-zbf';
import type { UnifiPolicyDto, UnifiZoneDto } from '../types';

function makeZone(
  id: string,
  name: string,
  origin: 'USER_DEFINED' | 'SYSTEM_DEFINED' = 'USER_DEFINED',
  vlanIds: number[] = []
): UnifiZoneDto {
  return {
    id,
    name,
    origin,
    networkIds: vlanIds.length > 0 ? [`net-${vlanIds[0]}`] : [],
    networkNames: vlanIds.length > 0 ? [name] : [],
    vlanIds,
    clientCount: 0,
  };
}

function makePolicy(overrides: Partial<UnifiPolicyDto> & Pick<UnifiPolicyDto, 'id' | 'name' | 'action'>): UnifiPolicyDto {
  return {
    enabled: true,
    description: null,
    index: 10000,
    origin: 'USER_DEFINED',
    sourceZoneId: 'z-adult',
    destinationZoneId: 'z-internal',
    allowReturnTraffic: true,
    hasSourceFilter: false,
    sourceFilterSummary: null,
    hasDestinationFilter: false,
    destinationFilterSummary: null,
    protocol: null,
    connectionStates: [],
    loggingEnabled: false,
    scheduleMode: 'ALWAYS',
    ...overrides,
  };
}

describe('unifi-zbf', () => {
  const zones: UnifiZoneDto[] = [
    makeZone('z-internal', 'Internal', 'SYSTEM_DEFINED', [1]),
    makeZone('z-adult', 'Adult', 'USER_DEFINED', [1620]),
    makeZone('z-iot', 'Untrusted & IoT systems', 'USER_DEFINED', [20, 300]),
    makeZone('z-kids', 'Kids isolation', 'USER_DEFINED', [100]),
    makeZone('z-hotspot', 'Hotspot', 'SYSTEM_DEFINED', []), // unused empty system zone
    makeZone('z-ext', 'External', 'SYSTEM_DEFINED', []),
  ];

  it('filters unused empty system zones when activeOnly=true and retains core system zones', () => {
    const matrixActive = buildZbfMatrix(zones, [], { activeOnly: true });
    expect(matrixActive.zones.map((z) => z.name)).not.toContain('Hotspot');
    expect(matrixActive.zones.map((z) => z.name)).toContain('External');
    expect(matrixActive.zones.map((z) => z.name)).toContain('Internal');

    const matrixAll = buildZbfMatrix(zones, [], { activeOnly: false });
    expect(matrixAll.zones.map((z) => z.name)).toContain('Hotspot');
  });

  it('evaluates ALLOW, ALLOW_WITH_BLOCKS, RESTRICTED_ALLOW, RETURN_ONLY, and BLOCKED verdicts accurately', () => {
    const policies: UnifiPolicyDto[] = [
      // Adult -> Internal: User Allow All override
      makePolicy({
        id: 'p1',
        name: 'Allow Adult to Internal',
        action: 'ALLOW',
        index: 10000,
        origin: 'USER_DEFINED',
        sourceZoneId: 'z-adult',
        destinationZoneId: 'z-internal',
        allowReturnTraffic: true,
      }),
      makePolicy({
        id: 'p1-def',
        name: 'Block All Traffic',
        action: 'BLOCK',
        index: 2147483647,
        origin: 'SYSTEM_DEFINED',
        sourceZoneId: 'z-adult',
        destinationZoneId: 'z-internal',
        allowReturnTraffic: false,
      }),

      // Internal -> External: System Allow + Invalid Hygiene + User Block Social
      makePolicy({
        id: 'p2-invalid',
        name: 'Block Invalid Traffic',
        action: 'BLOCK',
        index: 30000,
        origin: 'SYSTEM_DEFINED',
        sourceZoneId: 'z-internal',
        destinationZoneId: 'z-ext',
        connectionStates: ['INVALID'],
        allowReturnTraffic: false,
      }),
      makePolicy({
        id: 'p2-social',
        name: 'Block Internal to All Social',
        action: 'BLOCK',
        index: 10003,
        origin: 'USER_DEFINED',
        sourceZoneId: 'z-internal',
        destinationZoneId: 'z-ext',
        hasDestinationFilter: true,
        destinationFilterSummary: 'APP_CATEGORY: 5 app categories',
        allowReturnTraffic: false,
      }),
      makePolicy({
        id: 'p2-def',
        name: 'Allow All Traffic',
        action: 'ALLOW',
        index: 2147483647,
        origin: 'SYSTEM_DEFINED',
        sourceZoneId: 'z-internal',
        destinationZoneId: 'z-ext',
        allowReturnTraffic: true,
      }),

      // IoT -> Internal: Blocked by default, 1 pinhole allow
      makePolicy({
        id: 'p3-pinhole',
        name: 'Allow HA to WSH',
        action: 'ALLOW',
        index: 10000,
        origin: 'USER_DEFINED',
        sourceZoneId: 'z-iot',
        destinationZoneId: 'z-internal',
        hasSourceFilter: true,
        sourceFilterSummary: 'IP_ADDRESS: 10.10.20.5',
        hasDestinationFilter: true,
        destinationFilterSummary: 'PORT: ports 443',
        allowReturnTraffic: true,
      }),
      makePolicy({
        id: 'p3-def',
        name: 'Block All Traffic',
        action: 'BLOCK',
        index: 2147483647,
        origin: 'SYSTEM_DEFINED',
        sourceZoneId: 'z-iot',
        destinationZoneId: 'z-internal',
        allowReturnTraffic: false,
      }),

      // Kids -> Internal: Blocked by default, no allows, no reverse return
      makePolicy({
        id: 'p4-def',
        name: 'Block All Traffic',
        action: 'BLOCK',
        index: 2147483647,
        origin: 'SYSTEM_DEFINED',
        sourceZoneId: 'z-kids',
        destinationZoneId: 'z-internal',
        allowReturnTraffic: false,
      }),

      // Adult -> External disabled rule should be ignored
      makePolicy({
        id: 'p-disabled',
        name: 'Disabled Rule',
        action: 'BLOCK',
        enabled: false,
        index: 10000,
        origin: 'USER_DEFINED',
        sourceZoneId: 'z-adult',
        destinationZoneId: 'z-ext',
        hasDestinationFilter: true,
      }),
      makePolicy({
        id: 'p5-def',
        name: 'Allow All Traffic',
        action: 'ALLOW',
        index: 2147483647,
        origin: 'SYSTEM_DEFINED',
        sourceZoneId: 'z-adult',
        destinationZoneId: 'z-ext',
      }),
    ];

    const matrix = buildZbfMatrix(zones, policies, { activeOnly: true });

    expect(matrix.cells['z-adult']['z-internal'].verdict).toBe('ALLOW');
    expect(matrix.cells['z-internal']['z-ext'].verdict).toBe('ALLOW_WITH_BLOCKS');
    expect(matrix.cells['z-iot']['z-internal'].verdict).toBe('RESTRICTED_ALLOW');
    // Internal -> Adult gets RETURN_ONLY because Adult -> Internal has allowReturnTraffic: true
    expect(matrix.cells['z-internal']['z-adult'].verdict).toBe('RETURN_ONLY');
    expect(matrix.cells['z-internal']['z-adult'].hasReverseReturnPath).toBe(true);
    // Kids -> Internal is fully BLOCKED
    expect(matrix.cells['z-kids']['z-internal'].verdict).toBe('BLOCKED');
    // Disabled block rule ignored on Adult -> External
    expect(matrix.cells['z-adult']['z-ext'].verdict).toBe('ALLOW');

    // System "Block Invalid Traffic" alone does not downgrade ALLOW
    const cleanAllowMatrix = buildZbfMatrix(zones, [policies[2], policies[4]], { activeOnly: true });
    expect(cleanAllowMatrix.cells['z-internal']['z-ext'].verdict).toBe('ALLOW');

    const adultReach = computeZoneReachability(matrix, 'z-adult');
    expect(adultReach.canReach).toEqual(expect.arrayContaining(['Internal', 'External']));

    const style20 = getVlanBadgeStyle('Untrusted (VLAN 20)');
    const style300 = getVlanBadgeStyle('IoT Safe Systems (VLAN 300)');
    expect(style20.chipClass).not.toEqual(style300.chipClass);
    expect(getVlanBadgeStyle(null).dotClass).toContain('bg-slate-400');
  });
});
