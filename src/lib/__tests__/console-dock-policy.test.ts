import { describe, it, expect } from 'vitest';
import {
  shouldAutoOpenOnJobStart,
  shouldAutoOpenOnJobFinish,
  shouldAutoCollapseDockOnNavigate,
  computeVisibleDockTabs,
  resolveResponsiveDockLayout,
  getLastMeaningfulLine,
} from '../console-dock-policy';
import { TerminalTab } from '../types';

function makeTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 'job-1',
    title: 'Sample Job',
    lines: ['[INFO] Running step 1'],
    isRunning: false,
    createdAt: '2026-11-24T12:00:00.000Z',
    pageScope: 'releases',
    source: 'ui',
    ...overrides,
  };
}

describe('console-dock-policy', () => {
  describe('shouldAutoOpenOnJobStart', () => {
    it('opens Tier A UI jobs in smart mode when not dismissed', () => {
      expect(
        shouldAutoOpenOnJobStart({
          tier: 'A',
          source: 'ui',
          mode: 'smart',
          jobId: 'deploy-auth-1',
          dismissedIds: new Set(),
        })
      ).toBe(true);
    });

    it('never auto-opens Tier B or Tier C jobs on start', () => {
      expect(
        shouldAutoOpenOnJobStart({
          tier: 'B',
          source: 'ui',
          mode: 'smart',
          jobId: 'smoke-1',
          dismissedIds: new Set(),
        })
      ).toBe(false);
      expect(
        shouldAutoOpenOnJobStart({
          tier: 'C',
          source: 'ui',
          mode: 'smart',
          jobId: 'dev-boot-1',
          dismissedIds: new Set(),
        })
      ).toBe(false);
    });

    it('never auto-opens non-UI (mcp/scheduled/supervisor) triggers', () => {
      expect(
        shouldAutoOpenOnJobStart({
          tier: 'A',
          source: 'mcp',
          mode: 'smart',
          jobId: 'deploy-auth-2',
          dismissedIds: new Set(),
        })
      ).toBe(false);
    });

    it('respects errors and manual modes by suppressing start auto-open', () => {
      expect(
        shouldAutoOpenOnJobStart({
          tier: 'A',
          source: 'ui',
          mode: 'errors',
          jobId: 'deploy-auth-3',
          dismissedIds: new Set(),
        })
      ).toBe(false);
      expect(
        shouldAutoOpenOnJobStart({
          tier: 'A',
          source: 'ui',
          mode: 'manual',
          jobId: 'deploy-auth-4',
          dismissedIds: new Set(),
        })
      ).toBe(false);
    });

    it('honors Manual-Dismiss Memory by jobId and batchGroupId', () => {
      expect(
        shouldAutoOpenOnJobStart({
          tier: 'A',
          source: 'ui',
          mode: 'smart',
          jobId: 'deploy-auth-5',
          dismissedIds: new Set(['deploy-auth-5']),
        })
      ).toBe(false);

      expect(
        shouldAutoOpenOnJobStart({
          tier: 'A',
          source: 'ui',
          mode: 'smart',
          jobId: 'deploy-spendy-2',
          batchGroupId: 'deploy-batch-99',
          dismissedIds: new Set(['deploy-batch-99']),
        })
      ).toBe(false);
    });
  });

  describe('shouldAutoOpenOnJobFinish (Tier D)', () => {
    it('escalates unexpected non-zero UI failures in smart and errors modes', () => {
      expect(
        shouldAutoOpenOnJobFinish({ exitCode: 1, source: 'ui', mode: 'smart' })
      ).toBe(true);
      expect(
        shouldAutoOpenOnJobFinish({ exitCode: -1, source: 'ui', mode: 'errors' })
      ).toBe(true);
    });

    it('suppresses escalation in manual mode, on clean exit 0, and on user abort 130', () => {
      expect(
        shouldAutoOpenOnJobFinish({ exitCode: 1, source: 'ui', mode: 'manual' })
      ).toBe(false);
      expect(
        shouldAutoOpenOnJobFinish({ exitCode: 0, source: 'ui', mode: 'smart' })
      ).toBe(false);
      expect(
        shouldAutoOpenOnJobFinish({ exitCode: 130, source: 'ui', mode: 'smart' })
      ).toBe(false);
      expect(
        shouldAutoOpenOnJobFinish({
          exitCode: 1,
          source: 'ui',
          mode: 'smart',
          isAborted: true,
        })
      ).toBe(false);
    });

    it('suppresses background MCP/scheduled failures (shown via ticker instead)', () => {
      expect(
        shouldAutoOpenOnJobFinish({ exitCode: 1, source: 'scheduled', mode: 'smart' })
      ).toBe(false);
    });
  });

  describe('computeVisibleDockTabs', () => {
    it('filters by active page scope while keeping running and unread failure tabs visible', () => {
      const tabs = [
        makeTab({ id: 'rel-1', pageScope: 'releases', isRunning: false }),
        makeTab({ id: 'smoke-running', pageScope: 'smoke', isRunning: true }),
        makeTab({ id: 'sec-failed', pageScope: 'security', isRunning: false, exitCode: 1 }),
        makeTab({ id: 'topo-done', pageScope: 'topology', isRunning: false, exitCode: 0 }),
      ];

      const visible = computeVisibleDockTabs({
        tabs,
        activePageScope: 'releases',
        scopeMode: 'page',
        unreadFailureTabId: 'sec-failed',
      });

      const ids = visible.map((t) => t.id);
      expect(ids).toContain('rel-1');
      expect(ids).toContain('smoke-running');
      expect(ids).toContain('sec-failed');
      expect(ids).not.toContain('topo-done');
    });

    it('returns all suite tabs when scopeMode is all', () => {
      const tabs = [
        makeTab({ id: 'rel-1', pageScope: 'releases' }),
        makeTab({ id: 'topo-done', pageScope: 'topology' }),
      ];
      const visible = computeVisibleDockTabs({
        tabs,
        activePageScope: 'releases',
        scopeMode: 'all',
      });
      expect(visible).toHaveLength(2);
    });
  });

  describe('shouldAutoCollapseDockOnNavigate', () => {
    it('collapses finished deploy dock when navigating from releases to agent in page scope', () => {
      const tabs = [
        makeTab({ id: 'deploy-auth-1', pageScope: 'releases', isRunning: false, exitCode: 0 }),
        makeTab({ id: 'otto-old-fail', pageScope: 'agent', isRunning: false, exitCode: 1 }),
      ];
      expect(
        shouldAutoCollapseDockOnNavigate({
          dockOpen: true,
          fromPage: 'releases',
          toPage: 'agent',
          tabs,
          activeTabId: 'deploy-auth-1',
          scopeMode: 'page',
        })
      ).toBe(true);
    });

    it('keeps dock open if any job is still actively running', () => {
      const tabs = [
        makeTab({ id: 'deploy-auth-1', pageScope: 'releases', isRunning: true }),
        makeTab({ id: 'otto-old-fail', pageScope: 'agent', isRunning: false, exitCode: 1 }),
      ];
      expect(
        shouldAutoCollapseDockOnNavigate({
          dockOpen: true,
          fromPage: 'releases',
          toPage: 'agent',
          tabs,
          activeTabId: 'deploy-auth-1',
          scopeMode: 'page',
          forceFocusTargetView: true,
        })
      ).toBe(false);
    });

    it('collapses finished dock on Ask Otto deep-link even in all-suite mode', () => {
      const tabs = [
        makeTab({ id: 'deploy-auth-1', pageScope: 'releases', isRunning: false, exitCode: 0 }),
      ];
      expect(
        shouldAutoCollapseDockOnNavigate({
          dockOpen: true,
          fromPage: 'releases',
          toPage: 'agent',
          tabs,
          activeTabId: 'deploy-auth-1',
          scopeMode: 'all',
          forceFocusTargetView: true,
        })
      ).toBe(true);
    });

    it('keeps dock open in all-suite mode during normal sidebar navigation', () => {
      const tabs = [
        makeTab({ id: 'deploy-auth-1', pageScope: 'releases', isRunning: false, exitCode: 0 }),
      ];
      expect(
        shouldAutoCollapseDockOnNavigate({
          dockOpen: true,
          fromPage: 'releases',
          toPage: 'agent',
          tabs,
          activeTabId: 'deploy-auth-1',
          scopeMode: 'all',
        })
      ).toBe(false);
    });
  });

  describe('resolveResponsiveDockLayout', () => {
    it('forces bottom dock when viewportWidth < 1280px', () => {
      const res = resolveResponsiveDockLayout({
        viewportWidth: 1180,
        dockOpen: true,
        dockSide: 'right',
        sidebarCollapsed: false,
        sidebarAutoCollapsed: false,
      });
      expect(res.canDockRight).toBe(false);
      expect(res.effectiveDockSide).toBe('bottom');
      expect(res.nextSidebarCollapsed).toBe(false);
    });

    it('auto-collapses expanded sidebar when docking right at 1280-1599px and restores on close', () => {
      const opened = resolveResponsiveDockLayout({
        viewportWidth: 1440,
        dockOpen: true,
        dockSide: 'right',
        sidebarCollapsed: false,
        sidebarAutoCollapsed: false,
      });
      expect(opened.canDockRight).toBe(true);
      expect(opened.effectiveDockSide).toBe('right');
      expect(opened.nextSidebarCollapsed).toBe(true);
      expect(opened.nextSidebarAutoCollapsed).toBe(true);

      const closed = resolveResponsiveDockLayout({
        viewportWidth: 1440,
        dockOpen: false,
        dockSide: 'right',
        sidebarCollapsed: true,
        sidebarAutoCollapsed: true,
      });
      expect(closed.nextSidebarCollapsed).toBe(false);
      expect(closed.nextSidebarAutoCollapsed).toBe(false);
    });

    it('keeps sidebar expanded alongside right dock at >=1600px', () => {
      const res = resolveResponsiveDockLayout({
        viewportWidth: 1720,
        dockOpen: true,
        dockSide: 'right',
        sidebarCollapsed: false,
        sidebarAutoCollapsed: false,
      });
      expect(res.canDockRight).toBe(true);
      expect(res.effectiveDockSide).toBe('right');
      expect(res.nextSidebarCollapsed).toBe(false);
    });
  });

  describe('getLastMeaningfulLine', () => {
    it('returns the last non-empty ANSI-stripped line', () => {
      expect(
        getLastMeaningfulLine([
          '[INFO] line one',
          '\u001b[32m[PASS] Build succeeded\u001b[0m',
          '   ',
          '',
        ])
      ).toBe('[PASS] Build succeeded');
    });

    it('returns empty string when all lines are whitespace', () => {
      expect(getLastMeaningfulLine(['', '   '])).toBe('');
    });
  });
});
