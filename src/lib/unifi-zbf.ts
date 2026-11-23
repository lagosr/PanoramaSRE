import type { UnifiPolicyDto, UnifiZoneDto } from './types';

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
