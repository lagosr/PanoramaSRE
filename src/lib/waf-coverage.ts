import { extractRootZone, normalizeHostname, safeParseJson } from './threat-utils';
import type {
  CfWafRuleDto,
  GeminiActionDto,
  GeminiCampaignDto,
  ThreatActorRow,
  ThreatFindingRow,
} from './types';

export type WafCoverageStatus = 'COVERED' | 'PARTIAL' | 'UNCOVERED';

export interface WafCoverageMatch {
  status: WafCoverageStatus;
  matchedRules: CfWafRuleDto[];
  primaryRuleName?: string;
  uncoveredPaths: string[];
  reason: string;
}

export interface WafActionEvaluation extends WafCoverageMatch {
  isWafAddAction: boolean;
}

export interface PartitionedExternalActions {
  visibleActions: Array<{ action: GeminiActionDto; coverage: WafActionEvaluation }>;
  suppressedCoveredCount: number;
  suppressedRuleNames: string[];
}

interface PathPredicate {
  op: 'eq' | 'contains' | 'starts_with' | 'matches';
  value: string;
}

interface ParsedWafRule {
  rule: CfWafRuleDto;
  hosts: string[];
  hostZone: string;
  requiresNonUs: boolean;
  pathPredicates: PathPredicate[];
  ips: Set<string>;
  asns: Set<string>;
  isCatchAllHostBlock: boolean;
}

const MITIGATING_ACTIONS = new Set([
  'block',
  'managed_challenge',
  'js_challenge',
  'challenge',
  'interactive_challenge',
  'drop',
]);

const KNOWN_CLOUDFLARE_ZONES = ['panoramadr.com', 'parakith.com'];

function isMitigatingRule(rule: CfWafRuleDto): boolean {
  if (!rule.enabled) return false;
  return MITIGATING_ACTIONS.has((rule.action || '').trim().toLowerCase());
}

function normalizeAsnDigits(raw: string): string {
  const clean = raw.trim().toUpperCase().replace(/^AS/, '');
  return /^\d+$/.test(clean) ? clean : '';
}

function unquote(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, '').trim();
}

function parseBraceList(raw: string): string[] {
  const out: string[] = [];
  const tokenRe = /"([^"]*)"|'([^']*)'|([^\s{}]+)/g;
  let m: RegExpExecArray | null = tokenRe.exec(raw);
  while (m !== null) {
    const val = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (val) out.push(val);
    m = tokenRe.exec(raw);
  }
  return out;
}

/**
 * Parses a Cloudflare wirefilter WAF rule expression into structured host, geo, path, IP, and ASN predicates.
 */
export function parseWafRuleExpression(rule: CfWafRuleDto): ParsedWafRule {
  const expr = rule.expression || '';
  const exprLower = expr.toLowerCase();

  const hosts: string[] = [];
  const hostEqRe = /http\.host\s+(?:eq|contains|starts_with)\s+("[^"]+"|'[^']+')/gi;
  let hm: RegExpExecArray | null = hostEqRe.exec(expr);
  while (hm !== null) {
    const h = normalizeHostname(unquote(hm[1]));
    if (h) hosts.push(h);
    hm = hostEqRe.exec(expr);
  }
  const hostInRe = /http\.host\s+in\s+\{([^}]+)\}/gi;
  hm = hostInRe.exec(expr);
  while (hm !== null) {
    for (const token of parseBraceList(hm[1])) {
      const h = normalizeHostname(token);
      if (h) hosts.push(h);
    }
    hm = hostInRe.exec(expr);
  }

  const requiresNonUs =
    /ip\.geoip\.country\s+ne\s+["']US["']/i.test(expr) ||
    /not\s+ip\.geoip\.country\s+in\s+\{[^}]*["']?US["']?[^}]*\}/i.test(expr) ||
    /ip\.src\.country\s+ne\s+["']US["']/i.test(expr);

  const pathPredicates: PathPredicate[] = [];
  const pathOpRe =
    /(?:lower\(\s*)?(?:http\.request\.uri\.path|http\.request\.full_uri|http\.request\.uri)(?:\s*\))?\s+(eq|contains|starts_with|matches|~)\s+("[^"]+"|'[^']+'|r#"[^"]+"#)/gi;
  let pm: RegExpExecArray | null = pathOpRe.exec(expr);
  while (pm !== null) {
    const rawOp = pm[1].toLowerCase();
    const op: PathPredicate['op'] =
      rawOp === 'eq'
        ? 'eq'
        : rawOp === 'starts_with'
        ? 'starts_with'
        : rawOp === 'matches' || rawOp === '~'
        ? 'matches'
        : 'contains';
    const rawVal = pm[2].startsWith('r#"') ? pm[2].slice(3, -2) : unquote(pm[2]);
    if (rawVal) {
      pathPredicates.push({ op, value: rawVal });
    }
    pm = pathOpRe.exec(expr);
  }

  const pathInRe =
    /(?:lower\(\s*)?(?:http\.request\.uri\.path|http\.request\.uri)(?:\s*\))?\s+in\s+\{([^}]+)\}/gi;
  pm = pathInRe.exec(expr);
  while (pm !== null) {
    for (const token of parseBraceList(pm[1])) {
      if (token) {
        pathPredicates.push({ op: 'eq', value: token });
      }
    }
    pm = pathInRe.exec(expr);
  }

  const ips = new Set<string>();
  const ipEqRe = /ip\.src\s+eq\s+([0-9a-fA-F:./"']+)/gi;
  let im: RegExpExecArray | null = ipEqRe.exec(expr);
  while (im !== null) {
    const clean = unquote(im[1]).toLowerCase();
    if (clean) ips.add(clean);
    im = ipEqRe.exec(expr);
  }
  const ipInRe = /ip\.src\s+in\s+\{([^}]+)\}/gi;
  im = ipInRe.exec(expr);
  while (im !== null) {
    for (const token of parseBraceList(im[1])) {
      ips.add(token.toLowerCase());
    }
    im = ipInRe.exec(expr);
  }

  const asns = new Set<string>();
  const asnEqRe = /ip\.(?:geoip|src)\.asnum\s+eq\s+(\d+)/gi;
  let am: RegExpExecArray | null = asnEqRe.exec(expr);
  while (am !== null) {
    const d = normalizeAsnDigits(am[1]);
    if (d) asns.add(d);
    am = asnEqRe.exec(expr);
  }
  const asnInRe = /ip\.(?:geoip|src)\.asnum\s+in\s+\{([^}]+)\}/gi;
  am = asnInRe.exec(expr);
  while (am !== null) {
    for (const token of parseBraceList(am[1])) {
      const d = normalizeAsnDigits(token);
      if (d) asns.add(d);
    }
    am = asnInRe.exec(expr);
  }

  const hostZone = normalizeHostname(rule.zoneName);
  const isCatchAllHostBlock =
    hosts.length > 0 &&
    !requiresNonUs &&
    pathPredicates.length === 0 &&
    ips.size === 0 &&
    asns.size === 0 &&
    !exprLower.includes('not ');

  return {
    rule,
    hosts: Array.from(new Set(hosts)),
    hostZone,
    requiresNonUs,
    pathPredicates,
    ips,
    asns,
    isCatchAllHostBlock,
  };
}

function ruleAppliesToHost(parsed: ParsedWafRule, targetHosts: string[]): boolean {
  const cleanTargets = targetHosts.map(normalizeHostname).filter(Boolean);
  if (cleanTargets.length === 0) return true;

  if (parsed.hosts.length > 0) {
    return cleanTargets.some((t) =>
      parsed.hosts.some((rh) => t === rh || t.endsWith(`.${rh}`))
    );
  }

  if (parsed.hostZone) {
    return cleanTargets.some(
      (t) =>
        t === parsed.hostZone ||
        t.endsWith(`.${parsed.hostZone}`) ||
        extractRootZone(t, KNOWN_CLOUDFLARE_ZONES) === parsed.hostZone
    );
  }

  return true;
}

/**
 * Evaluates whether a parsed WAF rule matches a specific HTTP request path (without hiding // double-slash bypasses on `eq`).
 */
export function ruleMatchesPath(parsed: ParsedWafRule, rawPath: string): boolean {
  const cleanPath = rawPath.trim().toLowerCase();
  if (!cleanPath) return false;
  if (parsed.isCatchAllHostBlock) return true;

  for (const pred of parsed.pathPredicates) {
    const valLower = pred.value.toLowerCase();
    if (pred.op === 'eq') {
      if (cleanPath === valLower) return true;
    } else if (pred.op === 'starts_with') {
      if (cleanPath.startsWith(valLower)) return true;
    } else if (pred.op === 'contains') {
      if (cleanPath.includes(valLower)) return true;
    } else if (pred.op === 'matches') {
      try {
        if (new RegExp(pred.value, 'i').test(rawPath)) return true;
      } catch {
        // Ignore malformed regex from custom expressions gracefully
      }
    }
  }
  return false;
}

/**
 * Extracts explicit path or WP filename tokens from pattern/action prose or WAF snippets.
 */
export function extractCandidatePathsFromText(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const slashPathRe = /(?:^|[\s(`"',])(\/{1,2}[A-Za-z0-9._~/-]*[A-Za-z0-9._~/])/g;
  let m: RegExpExecArray | null = slashPathRe.exec(text);
  while (m !== null) {
    const p = m[1].replace(/[.,;:'")]+$/, '');
    if (p.length > 1) found.add(p);
    m = slashPathRe.exec(text);
  }

  if (/wlwmanifest\.xml/i.test(text) && !Array.from(found).some((p) => p.includes('wlwmanifest.xml'))) {
    found.add('/wp-includes/wlwmanifest.xml');
  }
  if (/xmlrpc\.php/i.test(text) && !Array.from(found).some((p) => p.includes('xmlrpc.php'))) {
    found.add('/xmlrpc.php');
  }
  if (/wp-login\.php/i.test(text) && !Array.from(found).some((p) => p.includes('wp-login.php'))) {
    found.add('/wp-login.php');
  }
  if (/wp-admin/i.test(text) && !Array.from(found).some((p) => p.includes('wp-admin'))) {
    found.add('/wp-admin/install.php');
  }

  return Array.from(found);
}

function extractIpTokens(text: string): string[] {
  const matches = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
  return Array.from(new Set(matches));
}

function buildResult(
  matched: CfWafRuleDto[],
  uncoveredPaths: string[],
  reason: string,
  forcePartial = false
): WafCoverageMatch {
  const uniqueMatched = Array.from(
    new Map(matched.map((r) => [r.id || `${r.zoneName}:${r.description}`, r])).values()
  );
  if (uniqueMatched.length === 0) {
    return {
      status: 'UNCOVERED',
      matchedRules: [],
      uncoveredPaths,
      reason,
    };
  }
  const status: WafCoverageStatus =
    forcePartial || uncoveredPaths.length > 0 ? 'PARTIAL' : 'COVERED';
  return {
    status,
    matchedRules: uniqueMatched,
    primaryRuleName: uniqueMatched[0].description || uniqueMatched[0].zoneName,
    uncoveredPaths,
    reason,
  };
}

/**
 * Evaluates whether active Cloudflare WAF rules cover a Gemini attack campaign (and detects partial slip-through paths).
 */
export function evaluateCampaignWafCoverage(
  campaign: GeminiCampaignDto,
  rules: CfWafRuleDto[],
  observedPaths: string[] = []
): WafCoverageMatch {
  const mitigating = rules.filter(isMitigatingRule).map(parseWafRuleExpression);
  if (mitigating.length === 0) {
    return buildResult([], [], 'No active blocking/challenging WAF rules deployed.');
  }

  const targetHosts = campaign.targetHosts.map(normalizeHostname).filter(Boolean);
  const hostScoped = mitigating.filter((p) => ruleAppliesToHost(p, targetHosts));
  if (hostScoped.length === 0) {
    return buildResult([], [], 'No active WAF rules scoped to target host(s).');
  }

  const blob = `${campaign.name} ${campaign.pattern} ${campaign.suggestedWafExpression || ''}`;
  const blobLower = blob.toLowerCase();
  const isNonUsCampaign =
    blobLower.includes('non-us') ||
    blobLower.includes('country ne "us"') ||
    blobLower.includes("country ne 'us'");

  const candidatePaths = Array.from(
    new Set([
      ...observedPaths.filter((p) => p && p.trim() !== '/'),
      ...extractCandidatePathsFromText(blob),
    ])
  );

  const matchedRules: CfWafRuleDto[] = [];
  if (isNonUsCampaign) {
    for (const p of hostScoped) {
      if (p.requiresNonUs || p.isCatchAllHostBlock) {
        matchedRules.push(p.rule);
      }
    }
  }

  if (candidatePaths.length > 0) {
    const uncovered: string[] = [];
    for (const path of candidatePaths) {
      const covering = hostScoped.filter((p) => ruleMatchesPath(p, path));
      if (covering.length > 0) {
        for (const c of covering) matchedRules.push(c.rule);
      } else {
        uncovered.push(path);
      }
    }
    if (matchedRules.length > 0) {
      return buildResult(
        matchedRules,
        uncovered,
        uncovered.length === 0
          ? `All ${candidatePaths.length} campaign path(s) covered by active WAF rules.`
          : `${uncovered.length} path(s) fell outside current WAF expression.`
      );
    }
  }

  if (matchedRules.length > 0) {
    return buildResult(matchedRules, [], 'Geo/host WAF rule covers this campaign.');
  }

  return buildResult([], [], 'No active WAF rule covers this campaign pattern.');
}

/**
 * Evaluates WAF coverage (and partial slip-through alerts) for a Cloudflare deterministic finding.
 */
export function evaluateFindingWafCoverage(
  finding: ThreatFindingRow,
  rules: CfWafRuleDto[]
): WafCoverageMatch {
  const mitigating = rules.filter(isMitigatingRule).map(parseWafRuleExpression);
  if (mitigating.length === 0) {
    return buildResult([], [], 'No active WAF rules deployed.');
  }

  const targetHosts = finding.host ? [finding.host] : [];
  const hostScoped = mitigating.filter((p) => ruleAppliesToHost(p, targetHosts));
  const evidence = safeParseJson<{
    paths?: string[];
    blockedHits?: number;
    unblockedHits?: number;
    partialWafRule?: string | null;
  }>(finding.evidenceJson, {});

  const matchedRules: CfWafRuleDto[] = [];
  const actorIpLower = (finding.actorIp || '').trim().toLowerCase();
  const actorAsnDigits = normalizeAsnDigits(finding.actorAsn || '');

  for (const p of hostScoped) {
    if (actorIpLower && p.ips.has(actorIpLower)) {
      matchedRules.push(p.rule);
    } else if (actorAsnDigits && p.asns.has(actorAsnDigits)) {
      matchedRules.push(p.rule);
    }
  }

  const isNonUsFinding =
    finding.ruleId === 'STRICT_PRIVATE_NON_US_PROBE' ||
    finding.ruleId === 'ZT_UNEXPECTED_ACCESS' ||
    finding.title.toLowerCase().includes('non-us');

  if (isNonUsFinding) {
    for (const p of hostScoped) {
      if (p.requiresNonUs || p.isCatchAllHostBlock) {
        matchedRules.push(p.rule);
      }
    }
    if (matchedRules.length > 0) {
      const hasSlipThrough =
        (evidence.unblockedHits ?? 0) > 0 ||
        Boolean(evidence.partialWafRule) ||
        finding.title.toLowerCase().includes('partial waf coverage');
      return buildResult(
        matchedRules,
        [],
        hasSlipThrough
          ? 'Non-US rule exists, but unblocked requests reached edge (check path/Access).'
          : '100% covered by active non-US WAF rule.',
        hasSlipThrough
      );
    }
  }

  const evidencePaths = Array.isArray(evidence.paths)
    ? evidence.paths.filter((p) => p && p.trim() !== '/')
    : [];
  const paths =
    evidencePaths.length > 0
      ? evidencePaths
      : extractCandidatePathsFromText(`${finding.title} ${finding.summary}`);

  if (paths.length > 0) {
    const uncovered: string[] = [];
    for (const path of paths) {
      const covering = hostScoped.filter((p) => ruleMatchesPath(p, path));
      if (covering.length > 0) {
        for (const c of covering) matchedRules.push(c.rule);
      } else {
        uncovered.push(path);
      }
    }
    if (matchedRules.length > 0) {
      const unblockedPartial = (evidence.unblockedHits ?? 0) > 0 && uncovered.length > 0;
      return buildResult(
        matchedRules,
        uncovered,
        uncovered.length === 0
          ? 'Finding paths covered by active WAF rule(s).'
          : 'Some finding paths slipped past current WAF rule.',
        unblockedPartial
      );
    }
  }

  if (matchedRules.length > 0) {
    return buildResult(matchedRules, [], 'Matched by IP/ASN WAF rule.');
  }

  return buildResult([], [], 'Not yet covered by active WAF rules.');
}

/**
 * Evaluates WAF coverage for a recurring external Threat Actor (IP, ASN, host/path coverage).
 */
export function evaluateActorWafCoverage(
  actor: ThreatActorRow,
  rules: CfWafRuleDto[]
): WafCoverageMatch {
  const mitigating = rules.filter(isMitigatingRule).map(parseWafRuleExpression);
  if (mitigating.length === 0) {
    return buildResult([], [], 'No active WAF rules deployed.');
  }

  const hosts = safeParseJson<string[]>(actor.targetHostsJson, []);
  const hostScoped = mitigating.filter((p) => ruleAppliesToHost(p, hosts));
  const ipLower = (actor.ipAddress || actor.id || '').trim().toLowerCase();
  const asnDigits = normalizeAsnDigits(actor.asn || '');
  const countryUpper = (actor.country || '').trim().toUpperCase();

  const matchedRules: CfWafRuleDto[] = [];
  for (const p of hostScoped) {
    if (ipLower && p.ips.has(ipLower)) matchedRules.push(p.rule);
    if (asnDigits && p.asns.has(asnDigits)) matchedRules.push(p.rule);
    if (p.isCatchAllHostBlock) matchedRules.push(p.rule);
    if (p.requiresNonUs && countryUpper && countryUpper !== 'US') {
      // Only full non-US coverage when actor didn't also target a zone without that geo rule
      if (hosts.length > 0 && hosts.every((h) => ruleAppliesToHost(p, [h]))) {
        matchedRules.push(p.rule);
      }
    }
  }

  if (matchedRules.length > 0) {
    return buildResult(matchedRules, [], 'Actor matched by active IP, ASN, or geo WAF rule.');
  }

  const rawPaths = safeParseJson<string[]>(actor.samplePathsJson, []).filter(
    (p) => p && p.trim() !== '/'
  );
  if (rawPaths.length > 0) {
    const uncovered: string[] = [];
    for (const path of rawPaths) {
      const covering = hostScoped.filter((p) => ruleMatchesPath(p, path));
      if (covering.length > 0) {
        for (const c of covering) matchedRules.push(c.rule);
      } else {
        uncovered.push(path);
      }
    }
    if (matchedRules.length > 0) {
      return buildResult(
        matchedRules,
        uncovered,
        uncovered.length === 0
          ? 'All observed probe paths are covered by active WAF rules.'
          : `${uncovered.length} actor probe path(s) remain uncovered.`
      );
    }
  }

  return buildResult([], [], 'Actor not covered by active WAF rules.');
}

/**
 * Evaluates whether a recommended external action proposes adding a WAF rule that is already covered.
 */
export function evaluateActionWafCoverage(
  action: GeminiActionDto,
  rules: CfWafRuleDto[],
  campaigns: GeminiCampaignDto[] = []
): WafActionEvaluation {
  const textBlob = `${action.action} ${action.rationale} ${action.wafRuleSnippet || ''}`;
  const isWafAddAction =
    Boolean(action.wafRuleSnippet?.trim()) ||
    action.surface.toUpperCase().includes('CLOUDFLARE_WAF') ||
    /\b(deploy waf|add .*waf|block .*at (the )?waf|create .*waf|managed challenge)\b/i.test(
      action.action
    );

  if (!isWafAddAction) {
    return {
      isWafAddAction: false,
      ...buildResult([], [], 'Not a WAF-rule creation action.'),
    };
  }

  const mitigating = rules.filter(isMitigatingRule).map(parseWafRuleExpression);
  if (mitigating.length === 0) {
    return {
      isWafAddAction: true,
      ...buildResult([], [], 'No active WAF rules deployed.'),
    };
  }

  const targetHosts = Array.from(
    new Set([
      ...(textBlob.match(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) ?? [])
        .map(normalizeHostname)
        .filter((h) => h.endsWith('panoramadr.com') || h.endsWith('parakith.com')),
    ])
  );
  const hostScoped = mitigating.filter((p) => ruleAppliesToHost(p, targetHosts));
  if (hostScoped.length === 0) {
    return {
      isWafAddAction: true,
      ...buildResult([], [], 'No active WAF rule on target host(s).'),
    };
  }

  const snippet = action.wafRuleSnippet || '';
  const snippetRule = snippet
    ? parseWafRuleExpression({
        id: 'snippet',
        zoneId: '',
        zoneName: targetHosts[0] || '',
        description: 'snippet',
        action: 'block',
        expression: snippet,
        enabled: true,
        source: 'manual_override',
      })
    : null;

  const isGeoNonUs =
    Boolean(snippetRule?.requiresNonUs) ||
    textBlob.toLowerCase().includes('non-us');

  const matchedRules: CfWafRuleDto[] = [];
  if (isGeoNonUs) {
    for (const p of hostScoped) {
      if (p.requiresNonUs || p.isCatchAllHostBlock) {
        matchedRules.push(p.rule);
      }
    }
    if (matchedRules.length > 0) {
      return {
        isWafAddAction: true,
        ...buildResult(matchedRules, [], 'Geo non-US WAF rule already active on this host.'),
      };
    }
  }

  const snippetIps = snippetRule ? Array.from(snippetRule.ips) : extractIpTokens(textBlob);
  if (snippetIps.length > 0) {
    const uncoveredIps: string[] = [];
    for (const ip of snippetIps) {
      const covering = hostScoped.filter((p) => p.ips.has(ip));
      if (covering.length > 0) {
        for (const c of covering) matchedRules.push(c.rule);
      } else {
        uncoveredIps.push(ip);
      }
    }
    if (matchedRules.length > 0) {
      return {
        isWafAddAction: true,
        ...buildResult(
          matchedRules,
          uncoveredIps,
          uncoveredIps.length === 0 ? 'Target IP(s) already covered.' : 'Only subset of IPs covered.'
        ),
      };
    }
  }

  const linkedCampaigns = campaigns.filter((c) =>
    targetHosts.length === 0
      ? false
      : c.targetHosts.some((ch) => targetHosts.includes(normalizeHostname(ch)))
  );
  const pathCandidates = Array.from(
    new Set([
      ...(snippetRule?.pathPredicates.map((p) => p.value) ?? []),
      ...extractCandidatePathsFromText(textBlob),
      ...linkedCampaigns.flatMap((c) => extractCandidatePathsFromText(`${c.name} ${c.pattern}`)),
    ])
  );

  if (pathCandidates.length > 0) {
    const uncovered: string[] = [];
    for (const rawPath of pathCandidates) {
      const probePath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
      const covering = hostScoped.filter(
        (p) => ruleMatchesPath(p, rawPath) || ruleMatchesPath(p, probePath)
      );
      if (covering.length > 0) {
        for (const c of covering) matchedRules.push(c.rule);
      } else {
        uncovered.push(rawPath);
      }
    }
    if (matchedRules.length > 0) {
      return {
        isWafAddAction: true,
        ...buildResult(
          matchedRules,
          uncovered,
          uncovered.length === 0
            ? 'WAF rule already covers these paths.'
            : `Existing rule leaves ${uncovered.length} path(s) exposed — tighten instead of duplicating.`
        ),
      };
    }
  }

  return {
    isWafAddAction: true,
    ...buildResult([], [], 'Action proposes new WAF coverage.'),
  };
}

/**
 * Filters out redundant "Add WAF Rule" actions when already `COVERED`, while retaining `PARTIAL` (tighten) and uncovered actions.
 */
export function partitionExternalActions(
  actions: GeminiActionDto[],
  rules: CfWafRuleDto[],
  campaigns: GeminiCampaignDto[] = []
): PartitionedExternalActions {
  const visibleActions: Array<{ action: GeminiActionDto; coverage: WafActionEvaluation }> = [];
  let suppressedCoveredCount = 0;
  const suppressedNames = new Set<string>();

  for (const act of actions) {
    const coverage = evaluateActionWafCoverage(act, rules, campaigns);
    if (coverage.isWafAddAction && coverage.status === 'COVERED') {
      suppressedCoveredCount += 1;
      if (coverage.primaryRuleName) suppressedNames.add(coverage.primaryRuleName);
      continue;
    }
    visibleActions.push({ action: act, coverage });
  }

  return {
    visibleActions,
    suppressedCoveredCount,
    suppressedRuleNames: Array.from(suppressedNames),
  };
}
