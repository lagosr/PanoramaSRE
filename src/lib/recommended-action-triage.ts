import { classifyActionSurface } from './threat-utils';
import type { GeminiActionDto } from './types';

export const RECOMMENDED_ACTION_STORAGE_KEY = 'panorama_sre_threat_action_dispositions';

export interface RecommendedActionDisposition {
  key: string;
  status: 'SNOOZED' | 'DISMISSED';
  snoozedUntil?: string | null;
  updatedAt: string;
  actionLabel: string;
  surface: string;
}

export type RecommendedActionDispositionMap = Record<string, RecommendedActionDisposition>;

function normalizeToken(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/g, '')
    .trim();
}

export function buildRecommendedActionKey(
  act: Pick<GeminiActionDto, 'surface' | 'action' | 'wafRuleSnippet'>
): string {
  const surfaceDomain = classifyActionSurface(act.surface || '');
  const actionNorm = normalizeToken(act.action);
  const snippetNorm = normalizeToken(act.wafRuleSnippet);
  return snippetNorm
    ? `${surfaceDomain}::${actionNorm}::${snippetNorm}`
    : `${surfaceDomain}::${actionNorm}`;
}

export function loadRecommendedActionDispositions(): RecommendedActionDispositionMap {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(RECOMMENDED_ACTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const clean: RecommendedActionDispositionMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const rec = v as Partial<RecommendedActionDisposition>;
      if (rec.status !== 'SNOOZED' && rec.status !== 'DISMISSED') continue;
      clean[k] = {
        key: k,
        status: rec.status,
        snoozedUntil: rec.snoozedUntil ?? null,
        updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : '',
        actionLabel: typeof rec.actionLabel === 'string' ? rec.actionLabel : k,
        surface: typeof rec.surface === 'string' ? rec.surface : '',
      };
    }
    return clean;
  } catch {
    return {};
  }
}

export function saveRecommendedActionDispositions(
  dispositions: RecommendedActionDispositionMap
): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(RECOMMENDED_ACTION_STORAGE_KEY, JSON.stringify(dispositions));
  } catch {
    // Ignore storage quota errors
  }
}

export function isRecommendedActionSuppressed(
  disposition?: RecommendedActionDisposition | null,
  nowMs = Date.now()
): { suppressed: boolean; status: 'ACTIVE' | 'SNOOZED' | 'DISMISSED' } {
  if (!disposition) {
    return { suppressed: false, status: 'ACTIVE' };
  }
  if (disposition.status === 'DISMISSED') {
    return { suppressed: true, status: 'DISMISSED' };
  }
  if (disposition.status === 'SNOOZED') {
    const untilMs = disposition.snoozedUntil ? Date.parse(disposition.snoozedUntil) : NaN;
    if (!Number.isNaN(untilMs) && untilMs > nowMs) {
      return { suppressed: true, status: 'SNOOZED' };
    }
  }
  return { suppressed: false, status: 'ACTIVE' };
}

export function partitionRecommendedActions<T extends { action: GeminiActionDto }>(
  items: T[],
  dispositions: RecommendedActionDispositionMap,
  nowMs = Date.now()
): {
  active: T[];
  hidden: Array<T & { disposition: RecommendedActionDisposition; key: string }>;
} {
  const active: T[] = [];
  const hidden: Array<T & { disposition: RecommendedActionDisposition; key: string }> = [];

  for (const item of items) {
    const key = buildRecommendedActionKey(item.action);
    const disp = dispositions[key];
    const check = isRecommendedActionSuppressed(disp, nowMs);
    if (check.suppressed && disp) {
      hidden.push({ ...item, disposition: disp, key });
    } else {
      active.push(item);
    }
  }

  return { active, hidden };
}
