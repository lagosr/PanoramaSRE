import { stripAnsiCodes } from '../components/layout/ConsoleColorizer';
import { inferPageScopeFromJob, sortStreamTabs } from './stream-utils';
import {
  AutoOpenTier,
  ConsoleAutoOpenMode,
  ConsoleDockSide,
  ConsoleScopeMode,
  NavSectionId,
  TerminalTab,
  WorkStreamSource,
} from './types';

/**
 * Determine whether launching a console stream job should automatically open
 * the Unified Output Console Dock based on tier, source, user override mode,
 * and manual-dismiss memory.
 */
export function shouldAutoOpenOnJobStart(params: {
  tier: AutoOpenTier;
  source: WorkStreamSource;
  mode: ConsoleAutoOpenMode;
  jobId: string;
  batchGroupId?: string;
  dismissedIds: ReadonlySet<string>;
}): boolean {
  const { tier, source, mode, jobId, batchGroupId, dismissedIds } = params;
  if (mode !== 'smart') return false;
  if (source !== 'ui') return false;
  if (tier !== 'A') return false;
  if (dismissedIds.has(jobId)) return false;
  if (batchGroupId && dismissedIds.has(batchGroupId)) return false;
  return true;
}

/**
 * Determine whether a finished job should escalate and auto-open the Unified
 * Output Console Dock (Tier D unexpected non-zero failure escalation).
 */
export function shouldAutoOpenOnJobFinish(params: {
  exitCode: number;
  source: WorkStreamSource;
  mode: ConsoleAutoOpenMode;
  isAborted?: boolean;
}): boolean {
  const { exitCode, source, mode, isAborted = false } = params;
  if (source !== 'ui') return false;
  if (isAborted || exitCode === 0 || exitCode === 130) return false;
  return mode === 'smart' || mode === 'errors';
}

/**
 * Compute visible tabs for the Unified Output Console Dock.
 * In `'page'` mode, filters to the active page scope while always keeping any
 * actively running job or unread failure tab pinned across page switches.
 */
export function computeVisibleDockTabs(params: {
  tabs: TerminalTab[];
  activePageScope: NavSectionId;
  scopeMode: ConsoleScopeMode;
  unreadFailureTabId?: string | null;
}): TerminalTab[] {
  const { tabs, activePageScope, scopeMode, unreadFailureTabId } = params;
  const sorted = sortStreamTabs(tabs);
  if (scopeMode === 'all') {
    return sorted;
  }
  return sorted.filter((t) => {
    if (t.isRunning) return true;
    if (unreadFailureTabId && t.id === unreadFailureTabId) return true;
    return inferPageScopeFromJob(t.id, t.pageScope, t.title) === activePageScope;
  });
}

/**
 * Resolve responsive desktop layout geometry for Right vs. Bottom console docking
 * and automatic soft-collapse of the sidebar on medium viewports (1280px–1599px).
 */
export function resolveResponsiveDockLayout(params: {
  viewportWidth: number;
  dockOpen: boolean;
  dockSide: ConsoleDockSide;
  sidebarCollapsed: boolean;
  sidebarAutoCollapsed: boolean;
}): {
  effectiveDockSide: ConsoleDockSide;
  canDockRight: boolean;
  nextSidebarCollapsed: boolean;
  nextSidebarAutoCollapsed: boolean;
} {
  const {
    viewportWidth,
    dockOpen,
    dockSide,
    sidebarCollapsed,
    sidebarAutoCollapsed,
  } = params;

  const canDockRight = viewportWidth >= 1280;
  const effectiveDockSide: ConsoleDockSide =
    dockSide === 'right' && canDockRight ? 'right' : 'bottom';

  if (dockOpen && effectiveDockSide === 'right' && viewportWidth < 1600) {
    if (!sidebarCollapsed) {
      return {
        effectiveDockSide,
        canDockRight,
        nextSidebarCollapsed: true,
        nextSidebarAutoCollapsed: true,
      };
    }
    return {
      effectiveDockSide,
      canDockRight,
      nextSidebarCollapsed: true,
      nextSidebarAutoCollapsed: sidebarAutoCollapsed,
    };
  }

  if (sidebarAutoCollapsed) {
    return {
      effectiveDockSide,
      canDockRight,
      nextSidebarCollapsed: false,
      nextSidebarAutoCollapsed: false,
    };
  }

  return {
    effectiveDockSide,
    canDockRight,
    nextSidebarCollapsed: sidebarCollapsed,
    nextSidebarAutoCollapsed: false,
  };
}

/**
 * Extract the last non-empty ANSI-stripped output line for the collapsed 36px
 * Live Activity Ticker preview.
 */
export function getLastMeaningfulLine(lines: string[]): string {
  for (let i = lines.length - 1; i >= 0; i--) {
    const clean = stripAnsiCodes(lines[i] || '').trim();
    if (clean.length > 0) {
      return clean;
    }
  }
  return '';
}
