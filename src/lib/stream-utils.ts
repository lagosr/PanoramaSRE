import { parseUtcDate, formatLocalDateTime } from './formatters';
import { NavSectionId, TerminalTab } from './types';

export const PAGE_SCOPE_BADGE_LABELS: Record<NavSectionId, string> = {
  hud: 'HUD',
  'local-dev': 'DEV',
  releases: 'REL',
  topology: 'TOPO',
  dietpi: 'HOST',
  edge: 'SSL',
  backups: 'DR',
  smoke: 'SMOKE',
  settings: 'CFG',
};

const VALID_SCOPES = new Set<NavSectionId>(Object.keys(PAGE_SCOPE_BADGE_LABELS) as NavSectionId[]);

/**
 * Resolve the owning PanoramaSRE page for any live or persisted work stream session.
 */
export function inferPageScopeFromJob(
  id: string,
  explicitScope?: NavSectionId | string | null,
  title?: string
): NavSectionId {
  if (explicitScope && VALID_SCOPES.has(explicitScope as NavSectionId)) {
    return explicitScope as NavSectionId;
  }

  const lowerId = (id || '').toLowerCase();
  if (lowerId.startsWith('hud-')) return 'hud';
  if (lowerId.startsWith('dev-') || lowerId.startsWith('local-dev-')) return 'local-dev';
  if (lowerId.startsWith('deploy-') || lowerId.startsWith('rollback-')) return 'releases';
  if (
    lowerId.startsWith('cf-tunnel-') ||
    lowerId.startsWith('audit-') ||
    lowerId.startsWith('reapply-hardening-') ||
    lowerId.startsWith('topology-') ||
    lowerId.startsWith('hop-') ||
    lowerId.startsWith('probe-')
  ) {
    return 'topology';
  }
  if (lowerId.startsWith('reboot-') || lowerId.startsWith('dietpi-') || lowerId.startsWith('action-')) {
    return 'dietpi';
  }
  if (lowerId.startsWith('ssl-')) return 'edge';
  if (
    lowerId.startsWith('gfs-backup-') ||
    lowerId.startsWith('backup-app-') ||
    lowerId.startsWith('apply-local-') ||
    lowerId.startsWith('restore-prod-') ||
    lowerId.startsWith('backups-')
  ) {
    return 'backups';
  }
  if (lowerId.startsWith('smoke-')) return 'smoke';
  if (lowerId.startsWith('settings-') || lowerId.startsWith('workspace-')) return 'settings';

  const lowerTitle = (title || '').toLowerCase();
  if (lowerTitle.includes('dev server')) return 'local-dev';
  if (lowerTitle.includes('deploy:') || lowerTitle.includes('rollback:')) return 'releases';
  if (lowerTitle.includes('cert') || lowerTitle.includes('ssl') || lowerTitle.includes('pki')) return 'edge';
  if (lowerTitle.includes('smoke')) return 'smoke';
  if (
    lowerTitle.includes('snapshot') ||
    lowerTitle.includes('backup') ||
    lowerTitle.includes('applylocal') ||
    lowerTitle.includes('restoreprod')
  ) {
    return 'backups';
  }
  if (lowerTitle.includes('reboot') || lowerTitle.includes('dietpi') || lowerTitle.includes('apt')) {
    return 'dietpi';
  }
  if (
    lowerTitle.includes('tunnel') ||
    lowerTitle.includes('penetration') ||
    lowerTitle.includes('hardening') ||
    lowerTitle.includes('firewall')
  ) {
    return 'topology';
  }
  if (lowerTitle.includes('workspace') || lowerTitle.includes('settings')) return 'settings';

  return 'hud';
}

export function getTabCategory(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes('dev server')) return 'Dev Supervisor';
  if (lower.includes('deploy')) return 'Deployments';
  if (lower.includes('rollback')) return 'Rollbacks';
  if (lower.includes('tunnel') || lower.includes('cloudflare')) return 'Cloudflare Tunnel';
  if (lower.includes('ssl') || lower.includes('cert') || lower.includes('pki') || lower.includes('renew')) {
    return 'PKI & SSL';
  }
  if (lower.includes('snapshot') || lower.includes('backup') || lower.includes('restore') || lower.includes('apply')) {
    return 'Database / DR';
  }
  if (lower.includes('smoke')) return 'Smoke Suite';
  if (lower.includes('reboot') || lower.includes('apt') || lower.includes('dietpi') || lower.includes('package')) {
    return 'Host & APT';
  }
  if (lower.includes('audit') || lower.includes('hardening') || lower.includes('probe') || lower.includes('hop')) {
    return 'Security & Network';
  }
  if (lower.includes('build') || lower.includes('test')) return 'Build & Test';
  return 'Operations';
}

export function getTabFinishedDetails(tab: TerminalTab): { label: string; timestampMs: number } {
  if (tab.isRunning) {
    return {
      label: 'Running now',
      timestampMs: Date.now() + 1000000000,
    };
  }

  let dateObj = parseUtcDate(tab.finishedAt);

  if (!dateObj && tab.lines && tab.lines.length > 0) {
    for (let i = tab.lines.length - 1; i >= Math.max(0, tab.lines.length - 15); i--) {
      const line = tab.lines[i];
      const matchIso = line.match(
        /(?:completed at|finished at|timestamp)[\s:=]+([0-9]{4}-[0-9]{2}-[0-9]{2}[T\s][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:?[0-9]{2})?)/i
      );
      if (matchIso && matchIso[1]) {
        dateObj = parseUtcDate(matchIso[1]);
        if (dateObj) break;
      }
      const matchStandard = line.match(/\b([0-9]{4}-[0-9]{2}-[0-9]{2}[\sT][0-9]{2}:[0-9]{2}:[0-9]{2})\b/);
      if (matchStandard && matchStandard[1]) {
        dateObj = parseUtcDate(matchStandard[1]);
        if (dateObj) break;
      }
    }
  }

  if (!dateObj && tab.createdAt) {
    dateObj = parseUtcDate(tab.createdAt);
  }

  if (!dateObj) {
    const numMatch = tab.id.match(/(\d{10,13})/);
    if (numMatch) {
      const ms = parseInt(numMatch[1], 10);
      const testDate = new Date(ms < 10000000000 ? ms * 1000 : ms);
      if (!isNaN(testDate.getTime())) {
        dateObj = testDate;
      }
    }
  }

  if (dateObj) {
    return {
      label: formatLocalDateTime(dateObj),
      timestampMs: dateObj.getTime(),
    };
  }

  return {
    label: 'Completed',
    timestampMs: 0,
  };
}

export function sortStreamTabs(tabs: TerminalTab[]): TerminalTab[] {
  return [...tabs].sort((a, b) => {
    if (a.isRunning && !b.isRunning) return -1;
    if (!a.isRunning && b.isRunning) return 1;
    const timeA = getTabFinishedDetails(a).timestampMs;
    const timeB = getTabFinishedDetails(b).timestampMs;
    return timeB - timeA;
  });
}

export function filterTabsForScope(
  tabs: TerminalTab[],
  pageScope: NavSectionId,
  appSlugFilter?: string
): TerminalTab[] {
  const normalizedFilter = appSlugFilter && appSlugFilter !== 'all' ? appSlugFilter.toLowerCase() : null;
  const matched = tabs.filter((tab) => {
    const scope = inferPageScopeFromJob(tab.id, tab.pageScope, tab.title);
    if (scope !== pageScope) return false;
    if (!normalizedFilter) return true;
    const matchesSlug = tab.appSlug?.toLowerCase() === normalizedFilter;
    const matchesId = tab.id.toLowerCase().includes(normalizedFilter);
    const matchesTitle = tab.title.toLowerCase().includes(normalizedFilter);
    return Boolean(matchesSlug || matchesId || matchesTitle);
  });
  return sortStreamTabs(matched);
}
