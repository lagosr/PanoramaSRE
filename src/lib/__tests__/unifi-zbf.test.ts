import { describe, it, expect } from 'vitest';
import {
  buildZbfMatrix,
  buildZoneFlowConnections,
  computeZoneReachability,
  getClientsForZone,
  getVlanBadgeStyle,
  getZoneScopedRules,
  pickDefaultFlowZoneIds,
} from '../unifi-zbf';
import type {
  UnifiClientTopologyDto,
  UnifiNetworkDto,
  UnifiPolicyDto,
  UnifiZoneDto,
} from '../types';

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

  it('builds directional zone flow wires, zone-scoped rules, client memberships, and smart default zones', () => {
    const policies: UnifiPolicyDto[] = [
      makePolicy({
        id: 'p-adult-internal',
        name: 'Allow Adult to Internal',
        action: 'ALLOW',
        index: 10000,
        origin: 'USER_DEFINED',
        sourceZoneId: 'z-adult',
        destinationZoneId: 'z-internal',
        allowReturnTraffic: true,
      }),
      makePolicy({
        id: 'p-adult-internal-def',
        name: 'Block All Traffic',
        action: 'BLOCK',
        index: 2147483647,
        origin: 'SYSTEM_DEFINED',
        sourceZoneId: 'z-adult',
        destinationZoneId: 'z-internal',
      }),
      makePolicy({
        id: 'p-iot-internal',
        name: 'Allow HA to WSH',
        action: 'ALLOW',
        index: 10001,
        origin: 'USER_DEFINED',
        sourceZoneId: 'z-iot',
        destinationZoneId: 'z-internal',
        allowReturnTraffic: true,
      }),
      makePolicy({
        id: 'p-internal-adult-ret',
        name: 'Allow Return Traffic',
        action: 'ALLOW',
        index: 30000,
        origin: 'DERIVED',
        sourceZoneId: 'z-internal',
        destinationZoneId: 'z-adult',
        connectionStates: ['ESTABLISHED', 'RELATED'],
      }),
    ];

    const richZones = zones.map((z) =>
      z.id === 'z-adult'
        ? { ...z, clientCount: 7 }
        : z.id === 'z-iot'
        ? { ...z, clientCount: 61 }
        : z.id === 'z-internal'
        ? { ...z, clientCount: 5 }
        : z
    );

    const matrix = buildZbfMatrix(richZones, policies, { activeOnly: true });
    const defaults = pickDefaultFlowZoneIds(matrix, 3);
    expect(defaults).toHaveLength(3);
    expect(defaults).toEqual(expect.arrayContaining(['z-adult', 'z-iot', 'z-internal']));

    // Without showReturnWires / showBlockedWires, only Adult->Internal and IoT->Internal appear
    const defaultWires = buildZoneFlowConnections(matrix, ['z-adult', 'z-internal', 'z-kids']);
    expect(defaultWires.map((w) => w.id)).toEqual(['z-adult->z-internal']);
    expect(defaultWires[0].primaryRuleName).toBe('Allow Adult to Internal');
    expect(defaultWires[0].hasOppositeWire).toBe(false);

    // Enabling showReturnWires adds Internal->Adult and flips hasOppositeWire on both
    const withReturn = buildZoneFlowConnections(matrix, ['z-adult', 'z-internal', 'z-kids'], {
      showReturnWires: true,
    });
    expect(withReturn.map((w) => w.id)).toEqual([
      'z-adult->z-internal',
      'z-internal->z-adult',
    ]);
    expect(withReturn.every((w) => w.hasOppositeWire)).toBe(true);

    // Enabling showBlockedWires shows blocked Kids edges too
    const withBlocked = buildZoneFlowConnections(matrix, ['z-adult', 'z-kids'], {
      showBlockedWires: true,
    });
    expect(withBlocked.map((w) => `${w.id}:${w.verdict}`)).toEqual([
      'z-adult->z-kids:BLOCKED',
      'z-kids->z-adult:BLOCKED',
    ]);

    // Zone-scoped rules sort selected-peer custom rules first
    const scopedAdult = getZoneScopedRules('z-adult', policies, richZones, ['z-adult', 'z-internal']);
    expect(scopedAdult[0].policy.name).toBe('Allow Adult to Internal');
    expect(scopedAdult[0].direction).toBe('OUT');
    expect(scopedAdult[0].connectsSelectedZone).toBe(true);

    // Client lookup maps by zoneName, vlanId, or network mapping
    const nets: UnifiNetworkDto[] = [
      {
        id: 'net-20',
        name: 'Untrusted',
        vlanId: 20,
        enabled: true,
        isDefault: false,
        zoneId: 'z-iot',
        zoneName: 'Untrusted & IoT systems',
        subnetCidr: '10.10.20.0/24',
        gatewayIp: '10.10.20.1',
        isolationEnabled: true,
        internetAccessEnabled: true,
        mdnsForwardingEnabled: true,
        origin: 'USER_DEFINED',
        clientCount: 2,
      },
    ];
    const clients: UnifiClientTopologyDto[] = [
      {
        id: 'c1',
        macAddress: 'AA:BB:CC:DD:EE:01',
        ipAddress: '10.10.20.9',
        name: 'Solar Assistant',
        vlanId: 20,
        networkName: 'Untrusted (VLAN 20)',
        zoneName: 'Untrusted & IoT systems',
      },
      {
        id: 'c2',
        macAddress: 'AA:BB:CC:DD:EE:02',
        ipAddress: '10.10.100.5',
        name: 'Kid Tablet',
        vlanId: 100,
        networkName: 'Kid Safe (VLAN 100)',
        zoneName: 'Kids isolation',
      },
    ];
    const iotClients = getClientsForZone(richZones[2], clients, nets);
    expect(iotClients.map((c) => c.id)).toEqual(['c1']);
  });
});
