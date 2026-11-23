import type {
  UnifiClientTopologyDto,
  UnifiNetworkDto,
  UnifiPolicyDto,
  UnifiZoneDto,
} from './types';

export type ZbfCellVerdict =
  | 'ALLOW'
  | 'ALLOW_WITH_BLOCKS'
  | 'RESTRICTED_ALLOW'
  | 'RETURN_ONLY'
  | 'BLOCKED';

export interface ZbfMatrixCell {
  sourceZoneId: string;
  destinationZoneId: string;
  verdict: ZbfCellVerdict;
  summary: string;
  rules: UnifiPolicyDto[];
  userRuleCount: number;
  systemRuleCount: number;
  allowRuleCount: number;
  blockRuleCount: number;
  hasReverseReturnPath: boolean;
  defaultAction: 'ALLOW' | 'BLOCK' | 'UNKNOWN';
}

export interface ZbfMatrixResult {
  zones: UnifiZoneDto[];
  cells: Record<string, Record<string, ZbfMatrixCell>>;
  customPolicies: UnifiPolicyDto[];
}

export interface ZoneReachabilitySummary {
  canReach: string[];
  limitedTo: string[];
  blockedFrom: string[];
  returnOnlyTo: string[];
}

export interface VlanBadgeStyle {
  chipClass: string;
  borderAccentClass: string;
  dotClass: string;
}

const VLAN_PALETTE: VlanBadgeStyle[] = [
  {
    chipClass: 'bg-sky-500/10 text-sky-800 dark:text-sky-300 border-sky-500/30',
    borderAccentClass: 'border-l-4 border-l-sky-500',
    dotClass: 'bg-sky-500',
  },
  {
    chipClass: 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30',
    borderAccentClass: 'border-l-4 border-l-amber-500',
    dotClass: 'bg-amber-500',
  },
  {
    chipClass: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/30',
    borderAccentClass: 'border-l-4 border-l-emerald-500',
    dotClass: 'bg-emerald-500',
  },
  {
    chipClass: 'bg-rose-500/10 text-rose-800 dark:text-rose-300 border-rose-500/30',
    borderAccentClass: 'border-l-4 border-l-rose-500',
    dotClass: 'bg-rose-500',
  },
  {
    chipClass: 'bg-violet-500/10 text-violet-800 dark:text-violet-300 border-violet-500/30',
    borderAccentClass: 'border-l-4 border-l-violet-500',
    dotClass: 'bg-violet-500',
  },
  {
    chipClass: 'bg-indigo-500/10 text-indigo-800 dark:text-indigo-300 border-indigo-500/30',
    borderAccentClass: 'border-l-4 border-l-indigo-500',
    dotClass: 'bg-indigo-500',
  },
  {
    chipClass: 'bg-teal-500/10 text-teal-800 dark:text-teal-300 border-teal-500/30',
    borderAccentClass: 'border-l-4 border-l-teal-500',
    dotClass: 'bg-teal-500',
  },
  {
    chipClass: 'bg-orange-500/10 text-orange-800 dark:text-orange-300 border-orange-500/30',
    borderAccentClass: 'border-l-4 border-l-orange-500',
    dotClass: 'bg-orange-500',
  },
];

export function getVlanBadgeStyle(vlanLabelOrId: string | number | null | undefined): VlanBadgeStyle {
  if (vlanLabelOrId === null || vlanLabelOrId === undefined || `${vlanLabelOrId}`.trim() === '') {
    return {
      chipClass: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700',
      borderAccentClass: 'border-l-4 border-l-slate-400',
      dotClass: 'bg-slate-400',
    };
  }
  const raw = String(vlanLabelOrId).trim();
  const vlanNumMatch = raw.match(/vlan\s*(\d+)/i) || raw.match(/^(\d+)$/);
  if (vlanNumMatch) {
    const vid = Number.parseInt(vlanNumMatch[1], 10);
    // Spread common VLAN IDs across visually distinct hues
    const bucketMap: Record<number, number> = {
      1: 5, // indigo (Default / Internal)
      20: 1, // amber (Untrusted)
      50: 6, // teal (Guest)
      100: 3, // rose (Kids)
      200: 4, // violet (Cameras)
      300: 2, // emerald (IoT Safe)
      400: 0, // sky (Control)
      500: 7, // orange (Compute)
      1620: 5, // indigo (Adult Secure)
    };
    const idx = bucketMap[vid] ?? vid % VLAN_PALETTE.length;
    return VLAN_PALETTE[idx];
  }

  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return VLAN_PALETTE[hash % VLAN_PALETTE.length];
}

function zoneSortRank(zone: UnifiZoneDto): [number, number, string] {
  const nameLower = zone.name.trim().toLowerCase();
  const isSystem = zone.origin.toUpperCase() === 'SYSTEM_DEFINED';
  if (!isSystem) {
    const minVlan = zone.vlanIds.length > 0 ? Math.min(...zone.vlanIds) : 9999;
    return [0, minVlan, nameLower];
  }
  if (nameLower === 'internal') return [1, 1, nameLower];
  if (nameLower === 'vpn') return [2, 2, nameLower];
  if (nameLower === 'gateway') return [3, 3, nameLower];
  if (nameLower === 'external') return [4, 4, nameLower];
  return [5, 9999, nameLower];
}

function isAlwaysActiveSystemZone(zone: UnifiZoneDto): boolean {
  const n = zone.name.trim().toLowerCase();
  return n === 'internal' || n === 'vpn' || n === 'gateway' || n === 'external';
}

function isCatchAllRule(rule: UnifiPolicyDto): boolean {
  const nameLower = rule.name.trim().toLowerCase();
  if (rule.index >= 2_000_000_000) return true;
  return (
    rule.origin.toUpperCase() === 'SYSTEM_DEFINED' &&
    !rule.hasSourceFilter &&
    !rule.hasDestinationFilter &&
    rule.connectionStates.length === 0 &&
    (nameLower === 'allow all traffic' || nameLower === 'block all traffic')
  );
}

function isReturnTrafficRule(rule: UnifiPolicyDto): boolean {
  const states = rule.connectionStates.map((s) => s.toUpperCase());
  if (states.includes('ESTABLISHED') || states.includes('RELATED')) {
    return true;
  }
  return rule.name.trim().toLowerCase().includes('allow return');
}

function isInvalidStateHygieneRule(rule: UnifiPolicyDto): boolean {
  return (
    rule.origin.toUpperCase() === 'SYSTEM_DEFINED' &&
    rule.action.toUpperCase() === 'BLOCK' &&
    rule.connectionStates.length === 1 &&
    rule.connectionStates[0].toUpperCase() === 'INVALID'
  );
}

function isUnfilteredAllowAllOverride(rule: UnifiPolicyDto): boolean {
  return (
    rule.action.toUpperCase() === 'ALLOW' &&
    !isReturnTrafficRule(rule) &&
    !rule.hasSourceFilter &&
    !rule.hasDestinationFilter &&
    rule.connectionStates.length === 0 &&
    (!rule.protocol || rule.protocol.toLowerCase() === 'all protocols')
  );
}

function isUnfilteredBlockAllOverride(rule: UnifiPolicyDto): boolean {
  return (
    (rule.action.toUpperCase() === 'BLOCK' || rule.action.toUpperCase() === 'REJECT') &&
    !isInvalidStateHygieneRule(rule) &&
    !rule.hasSourceFilter &&
    !rule.hasDestinationFilter &&
    rule.connectionStates.length === 0 &&
    (!rule.protocol || rule.protocol.toLowerCase() === 'all protocols')
  );
}

export function buildZbfMatrix(
  zones: UnifiZoneDto[],
  policies: UnifiPolicyDto[],
  options?: { activeOnly?: boolean }
): ZbfMatrixResult {
  const activeOnly = options?.activeOnly ?? true;

  const filteredZones = zones
    .filter((z) => {
      if (!activeOnly) return true;
      if (z.origin.toUpperCase() !== 'SYSTEM_DEFINED') return true;
      return z.networkIds.length > 0 || z.networkNames.length > 0 || isAlwaysActiveSystemZone(z);
    })
    .slice()
    .sort((a, b) => {
      const [gA, vA, nA] = zoneSortRank(a);
      const [gB, vB, nB] = zoneSortRank(b);
      if (gA !== gB) return gA - gB;
      if (vA !== vB) return vA - vB;
      return nA.localeCompare(nB);
    });

  const enabledPolicies = policies.filter((p) => p.enabled);

  const pairMap = new Map<string, UnifiPolicyDto[]>();
  for (const pol of enabledPolicies) {
    if (!pol.sourceZoneId || !pol.destinationZoneId) continue;
    const key = `${pol.sourceZoneId}::${pol.destinationZoneId}`;
    const arr = pairMap.get(key) || [];
    arr.push(pol);
    pairMap.set(key, arr);
  }
  for (const arr of pairMap.values()) {
    arr.sort((a, b) => a.index - b.index);
  }

  const cells: Record<string, Record<string, ZbfMatrixCell>> = {};

  for (const src of filteredZones) {
    cells[src.id] = {};
    for (const dst of filteredZones) {
      const rules = pairMap.get(`${src.id}::${dst.id}`) || [];
      const reverseRules = pairMap.get(`${dst.id}::${src.id}`) || [];

      const catchAllRules = rules.filter(isCatchAllRule);
      const lastCatchAll = catchAllRules[catchAllRules.length - 1];
      const defaultAction: 'ALLOW' | 'BLOCK' | 'UNKNOWN' = lastCatchAll
        ? lastCatchAll.action.toUpperCase() === 'ALLOW'
          ? 'ALLOW'
          : 'BLOCK'
        : 'UNKNOWN';

      const returnRules = rules.filter(isReturnTrafficRule);
      const hasReverseReturnPath = reverseRules.some(
        (r) => r.action.toUpperCase() === 'ALLOW' && r.allowReturnTraffic && !isReturnTrafficRule(r)
      );

      const meaningfulNonCatchAll = rules.filter(
        (r) => !isCatchAllRule(r) && !isReturnTrafficRule(r) && !isInvalidStateHygieneRule(r)
      );

      const customAllows = meaningfulNonCatchAll.filter((r) => r.action.toUpperCase() === 'ALLOW');
      const customBlocks = meaningfulNonCatchAll.filter((r) => {
        const a = r.action.toUpperCase();
        return a === 'BLOCK' || a === 'REJECT';
      });

      const userRuleCount = rules.filter((r) => r.origin.toUpperCase() === 'USER_DEFINED').length;
      const systemRuleCount = rules.length - userRuleCount;

      // Determine effective broad baseline when unfiltered user override precedes catch-all
      let broadBaseline: 'ALLOW' | 'BLOCK' = defaultAction === 'ALLOW' ? 'ALLOW' : 'BLOCK';
      for (const r of meaningfulNonCatchAll) {
        if (isUnfilteredBlockAllOverride(r)) {
          broadBaseline = 'BLOCK';
          break;
        }
        if (isUnfilteredAllowAllOverride(r)) {
          broadBaseline = 'ALLOW';
          break;
        }
      }

      let verdict: ZbfCellVerdict;
      let summary: string;

      if (broadBaseline === 'ALLOW') {
        if (customBlocks.length > 0) {
          verdict = 'ALLOW_WITH_BLOCKS';
          summary = `Allowed by default, with ${customBlocks.length} block carve-out(s)`;
        } else {
          verdict = 'ALLOW';
          summary = 'All new & return traffic allowed';
        }
      } else if (customAllows.length > 0) {
        verdict = 'RESTRICTED_ALLOW';
        summary = `Blocked by default • ${customAllows.length} allow pinhole(s)`;
      } else if (returnRules.length > 0 || hasReverseReturnPath) {
        verdict = 'RETURN_ONLY';
        summary = 'Blocked for new connections • Return traffic allowed';
      } else {
        verdict = 'BLOCKED';
        summary =
          customBlocks.length > 0
            ? `All traffic blocked (${customBlocks.length} explicit block rule(s))`
            : 'All traffic blocked';
      }

      cells[src.id][dst.id] = {
        sourceZoneId: src.id,
        destinationZoneId: dst.id,
        verdict,
        summary,
        rules,
        userRuleCount,
        systemRuleCount,
        allowRuleCount: customAllows.length,
        blockRuleCount: customBlocks.length,
        hasReverseReturnPath,
        defaultAction,
      };
    }
  }

  const customPolicies = enabledPolicies
    .filter((p) => p.origin.toUpperCase() === 'USER_DEFINED')
    .slice()
    .sort((a, b) => a.index - b.index || a.name.localeCompare(b.name));

  return { zones: filteredZones, cells, customPolicies };
}

export function computeZoneReachability(
  matrix: ZbfMatrixResult,
  zoneId: string
): ZoneReachabilitySummary {
  const row = matrix.cells[zoneId] || {};
  const canReach: string[] = [];
  const limitedTo: string[] = [];
  const blockedFrom: string[] = [];
  const returnOnlyTo: string[] = [];

  for (const dst of matrix.zones) {
    if (dst.id === zoneId) continue;
    const cell = row[dst.id];
    if (!cell) continue;
    switch (cell.verdict) {
      case 'ALLOW':
        canReach.push(dst.name);
        break;
      case 'ALLOW_WITH_BLOCKS':
      case 'RESTRICTED_ALLOW':
        limitedTo.push(dst.name);
        break;
      case 'RETURN_ONLY':
        returnOnlyTo.push(dst.name);
        break;
      case 'BLOCKED':
        blockedFrom.push(dst.name);
        break;
    }
  }

  return { canReach, limitedTo, blockedFrom, returnOnlyTo };
}

export interface ZoneFlowConnection {
  id: string;
  sourceZoneId: string;
  destinationZoneId: string;
  sourceZoneName: string;
  destinationZoneName: string;
  verdict: ZbfCellVerdict;
  summary: string;
  primaryRuleName: string;
  rules: UnifiPolicyDto[];
  customRuleCount: number;
  hasOppositeWire: boolean;
}

export interface ZoneScopedRuleItem {
  policy: UnifiPolicyDto;
  direction: 'OUT' | 'IN' | 'INTRA';
  peerZoneId: string | null;
  peerZoneName: string;
  connectsSelectedZone: boolean;
  isCustom: boolean;
}

function resolvePrimaryRuleName(cell: ZbfMatrixCell): string {
  const meaningful = cell.rules.filter(
    (r) => !isCatchAllRule(r) && !isReturnTrafficRule(r) && !isInvalidStateHygieneRule(r)
  );
  const custom = meaningful.find((r) => r.origin.toUpperCase() === 'USER_DEFINED');
  if (custom) return custom.name;
  if (meaningful.length > 0) return meaningful[0].name;
  if (cell.verdict === 'ALLOW') return 'Default Allow';
  if (cell.verdict === 'RETURN_ONLY') return 'Return Traffic Only';
  if (cell.verdict === 'BLOCKED') return 'Default Block';
  return cell.summary;
}

/**
 * Computes directed Zone-Based Firewall flow wires among selected zones.
 */
export function buildZoneFlowConnections(
  matrix: ZbfMatrixResult,
  selectedZoneIds: string[],
  options?: {
    showReturnWires?: boolean;
    showBlockedWires?: boolean;
    customRulesOnly?: boolean;
  }
): ZoneFlowConnection[] {
  const showReturnWires = options?.showReturnWires ?? false;
  const showBlockedWires = options?.showBlockedWires ?? false;
  const customRulesOnly = options?.customRulesOnly ?? false;

  const uniqueIds = Array.from(new Set(selectedZoneIds)).filter((id) => Boolean(matrix.cells[id]));
  const zoneMap = new Map(matrix.zones.map((z) => [z.id, z]));
  const rawEdges: ZoneFlowConnection[] = [];

  for (const srcId of uniqueIds) {
    const row = matrix.cells[srcId];
    const srcZone = zoneMap.get(srcId);
    if (!row || !srcZone) continue;
    for (const dstId of uniqueIds) {
      if (srcId === dstId) continue;
      const cell = row[dstId];
      const dstZone = zoneMap.get(dstId);
      if (!cell || !dstZone) continue;

      if (cell.verdict === 'RETURN_ONLY' && !showReturnWires) continue;
      if (cell.verdict === 'BLOCKED' && !showBlockedWires) continue;
      if (customRulesOnly && cell.userRuleCount === 0) continue;

      rawEdges.push({
        id: `${srcId}->${dstId}`,
        sourceZoneId: srcId,
        destinationZoneId: dstId,
        sourceZoneName: srcZone.name,
        destinationZoneName: dstZone.name,
        verdict: cell.verdict,
        summary: cell.summary,
        primaryRuleName: resolvePrimaryRuleName(cell),
        rules: cell.rules,
        customRuleCount: cell.userRuleCount,
        hasOppositeWire: false,
      });
    }
  }

  const edgeKeys = new Set(rawEdges.map((e) => `${e.sourceZoneId}::${e.destinationZoneId}`));
  return rawEdges.map((edge) => ({
    ...edge,
    hasOppositeWire: edgeKeys.has(`${edge.destinationZoneId}::${edge.sourceZoneId}`),
  }));
}

/**
 * Lists all enabled firewall rules affecting a given zone card (outgoing, incoming, or intra-zone).
 */
export function getZoneScopedRules(
  zoneId: string,
  policies: UnifiPolicyDto[],
  zones: UnifiZoneDto[],
  selectedZoneIds: string[],
  options?: { selectedPeersOnly?: boolean; customOnly?: boolean }
): ZoneScopedRuleItem[] {
  const selectedPeersOnly = options?.selectedPeersOnly ?? false;
  const customOnly = options?.customOnly ?? false;
  const zoneMap = new Map(zones.map((z) => [z.id, z]));
  const selectedSet = new Set(selectedZoneIds);

  const items: ZoneScopedRuleItem[] = [];
  for (const pol of policies) {
    if (!pol.enabled) continue;
    const isSrc = pol.sourceZoneId === zoneId;
    const isDst = pol.destinationZoneId === zoneId;
    if (!isSrc && !isDst) continue;

    const isCustom = pol.origin.toUpperCase() === 'USER_DEFINED';
    if (!isCustom && isInvalidStateHygieneRule(pol)) continue;
    if (customOnly && !isCustom) continue;

    const direction: 'OUT' | 'IN' | 'INTRA' = isSrc && isDst ? 'INTRA' : isSrc ? 'OUT' : 'IN';
    const peerZoneId =
      direction === 'INTRA' ? zoneId : isSrc ? (pol.destinationZoneId ?? null) : (pol.sourceZoneId ?? null);
    const peerZoneName = peerZoneId ? zoneMap.get(peerZoneId)?.name ?? peerZoneId : 'Any Zone';
    const connectsSelectedZone =
      direction === 'INTRA'
        ? selectedSet.has(zoneId)
        : Boolean(peerZoneId && selectedSet.has(peerZoneId));

    if (selectedPeersOnly && !connectsSelectedZone) continue;

    items.push({
      policy: pol,
      direction,
      peerZoneId,
      peerZoneName,
      connectsSelectedZone,
      isCustom,
    });
  }

  return items.sort((a, b) => {
    if (a.connectsSelectedZone !== b.connectsSelectedZone) {
      return a.connectsSelectedZone ? -1 : 1;
    }
    if (a.isCustom !== b.isCustom) return a.isCustom ? -1 : 1;
    const aCatch = isCatchAllRule(a.policy) ? 1 : 0;
    const bCatch = isCatchAllRule(b.policy) ? 1 : 0;
    if (aCatch !== bCatch) return aCatch - bCatch;
    return a.policy.index - b.policy.index || a.policy.name.localeCompare(b.policy.name);
  });
}

/**
 * Matches all LAN clients belonging to a UniFi security zone via zone name, VLAN ID, or network mapping.
 */
export function getClientsForZone(
  zone: UnifiZoneDto,
  clients: UnifiClientTopologyDto[],
  networks: UnifiNetworkDto[]
): UnifiClientTopologyDto[] {
  const zoneNameLower = zone.name.trim().toLowerCase();
  const zoneVlanSet = new Set(zone.vlanIds);
  const netNames = new Set(zone.networkNames.map((n) => n.trim().toLowerCase()));
  for (const net of networks) {
    if (net.zoneId === zone.id) {
      netNames.add(net.name.trim().toLowerCase());
      if (net.vlanId != null) {
        zoneVlanSet.add(net.vlanId);
        netNames.add(`${net.name.trim().toLowerCase()} (vlan ${net.vlanId})`);
      }
    }
  }

  return clients
    .filter((cli) => {
      const cliZone = (cli.zoneName || '').trim().toLowerCase();
      if (cliZone && cliZone === zoneNameLower) return true;
      if (cli.vlanId != null && zoneVlanSet.has(cli.vlanId)) return true;
      const cliNet = (cli.networkName || '').trim().toLowerCase();
      return Boolean(cliNet && netNames.has(cliNet));
    })
    .slice()
    .sort((a, b) => {
      const aLabel = (a.name || a.hostname || a.macAddress).toLowerCase();
      const bLabel = (b.name || b.hostname || b.macAddress).toLowerCase();
      return aLabel.localeCompare(bLabel);
    });
}

/**
 * Picks up to `maxZones` high-signal active zones (with cross-zone rules + clients) to seed the Zone Flow Explorer.
 */
export function pickDefaultFlowZoneIds(matrix: ZbfMatrixResult, maxZones = 3): string[] {
  if (matrix.zones.length === 0 || maxZones <= 0) return [];
  const scored = matrix.zones.map((z) => {
    let crossScore = 0;
    for (const other of matrix.zones) {
      if (other.id === z.id) continue;
      const outCell = matrix.cells[z.id]?.[other.id];
      const inCell = matrix.cells[other.id]?.[z.id];
      if (outCell && outCell.userRuleCount > 0) crossScore += 3;
      if (inCell && inCell.userRuleCount > 0) crossScore += 3;
      if (outCell && (outCell.verdict === 'ALLOW' || outCell.verdict === 'RESTRICTED_ALLOW')) crossScore += 1;
    }
    const isUser = z.origin.toUpperCase() !== 'SYSTEM_DEFINED';
    const hasClients = z.clientCount > 0 || z.vlanIds.length > 0;
    const score =
      (isUser ? 10 : z.name.trim().toLowerCase() === 'internal' ? 8 : 0) +
      (hasClients ? 6 : 0) +
      crossScore;
    return { id: z.id, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxZones)
    .map((s) => s.id);
}
