import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { computeIsNearBottom } from '../../hooks/useSmartAutoScroll';
import { filterTabsForScope, inferPageScopeFromJob } from '../stream-utils';
import { NavSectionId, TerminalTab } from '../types';
import {
  getStreamStatusMeta,
  shouldAutoExpandStream,
  WorkStreamContainer,
} from '../../components/ui/WorkStreamContainer';
import { SslProgressInline } from '../../components/edge/SslProgressInline';

describe('Smart Auto-Scroll & Stream Routing Utilities', () => {
  it('detects near-bottom scroll pin state accurately within the 32px threshold', () => {
    expect(computeIsNearBottom(500, 800, 270)).toBe(true); // 30px <= 32px
    expect(computeIsNearBottom(498, 800, 270)).toBe(true); // exact 32px boundary
    expect(computeIsNearBottom(497, 800, 270)).toBe(false); // 33px > 32px (scrolled upward)
    expect(computeIsNearBottom(0, 100, 240)).toBe(true); // short viewport
  });

  it('infers all 9 page scopes deterministically and honors explicit pageScope override', () => {
    const cases: Array<[string, NavSectionId]> = [
      ['hud-sync-1', 'hud'],
      ['dev-spendy-1', 'local-dev'],
      ['deploy-biomed-1', 'releases'],
      ['rollback-water-1', 'releases'],
      ['cf-tunnel-restart-1', 'topology'],
      ['audit-penetration-1', 'topology'],
      ['reboot-wsh-1', 'dietpi'],
      ['ssl-renew-1', 'edge'],
      ['gfs-backup-1', 'backups'],
      ['smoke-1', 'smoke'],
      ['settings-op-1', 'settings'],
    ];

    for (const [id, expected] of cases) {
      expect(inferPageScopeFromJob(id)).toBe(expected);
    }

    // Explicit pageScope always wins over ID heuristic (e.g., HUD triggering backup/hardening)
    expect(inferPageScopeFromJob('gfs-backup-1', 'hud')).toBe('hud');
    expect(inferPageScopeFromJob('reapply-hardening-1', 'topology')).toBe('topology');
  });

  it('filters stream tabs by pageScope and optional appSlugFilter', () => {
    const tabs: TerminalTab[] = [
      {
        id: 'deploy-spendy-1',
        title: 'Deploy: SpendyLedger',
        lines: ['Building SpendyLedger...'],
        isRunning: false,
        exitCode: 0,
        pageScope: 'releases',
        appSlug: 'spendy',
      },
      {
        id: 'deploy-biomed-1',
        title: 'Deploy: BiomedMaven',
        lines: ['Building BiomedMaven...'],
        isRunning: true,
        pageScope: 'releases',
        appSlug: 'biomed',
      },
      {
        id: 'smoke-1',
        title: 'Smoke Tests (sre-manual)',
        lines: ['[PASS] All checks ok'],
        isRunning: false,
        exitCode: 0,
        pageScope: 'smoke',
      },
    ];

    const biomedOnly = filterTabsForScope(tabs, 'releases', 'biomed');
    expect(biomedOnly).toHaveLength(1);
    expect(biomedOnly[0].id).toBe('deploy-biomed-1');

    const smokeOnly = filterTabsForScope(tabs, 'smoke');
    expect(smokeOnly).toHaveLength(1);
    expect(smokeOnly[0].id).toBe('smoke-1');
  });
});

describe('WorkStreamContainer Rest/Active Behavior & Markup', () => {
  it('classifies stream status metadata and auto-expand transitions accurately', () => {
    expect(getStreamStatusMeta(null).state).toBe('idle');
    expect(getStreamStatusMeta(null).label).toBe('STANDBY');

    expect(
      getStreamStatusMeta({
        id: 'j1',
        title: 'Build',
        lines: [],
        isRunning: true,
      }).state
    ).toBe('running');

    expect(
      getStreamStatusMeta({
        id: 'j2',
        title: 'Build',
        lines: ['done'],
        isRunning: false,
        exitCode: 0,
      }).label
    ).toContain('EXIT 0');

    expect(
      getStreamStatusMeta({
        id: 'j3',
        title: 'Build',
        lines: ['boom'],
        isRunning: false,
        exitCode: 2,
      }).label
    ).toBe('FAILED (EXIT 2)');

    expect(shouldAutoExpandStream(false, true, null, 'j1')).toBe(true);
    expect(shouldAutoExpandStream(true, true, 'j1', 'j2')).toBe(true);
    expect(shouldAutoExpandStream(true, false, 'j1', null)).toBe(false);
    expect(shouldAutoExpandStream(false, false, 'j1', 'j1')).toBe(false);
  });

  it('renders Rest state with anchored controls but hides stream log viewport', () => {
    const completedTab: TerminalTab = {
      id: 'smoke-100',
      title: 'Smoke Tests (sre-manual)',
      lines: ['[PASS] Gateway OK'],
      isRunning: false,
      exitCode: 0,
      pageScope: 'smoke',
      createdAt: '2026-11-13T10:00:00Z',
      finishedAt: '2026-11-13T10:00:05Z',
    };

    const html = renderToStaticMarkup(
      <WorkStreamContainer
        pageScope="smoke"
        title="Smoke Test Execution Stream"
        tabs={[completedTab]}
        onOpenInBottomConsole={() => {}}
      />
    );

    expect(html).toContain('data-stream-state="rest"');
    expect(html).toContain('Smoke Test Execution Stream');
    expect(html).toContain('Copy Output');
    expect(html).toContain('Bottom Console');
    expect(html).toContain('Show Stream');
    expect(html).not.toContain('role="log"');
    expect(html.toLowerCase()).not.toContain('<select');
  });

  it('renders Active state automatically when a job is running and includes progressSlot without native select', () => {
    const runningTab: TerminalTab = {
      id: 'deploy-biomed-200',
      title: 'Deploy: BiomedMaven',
      lines: ['\x1b[32m[PASS] TypeScript pre-check\x1b[0m', 'Building Docker layers...'],
      isRunning: true,
      pageScope: 'releases',
      source: 'ui',
      appSlug: 'biomed',
      abortable: true,
      createdAt: '2026-11-13T10:05:00Z',
    };

    const html = renderToStaticMarkup(
      <WorkStreamContainer
        pageScope="releases"
        appSlugFilter="biomed"
        title="Release & Rollback Stream"
        tabs={[runningTab]}
        progressSlot={<div data-testid="stage-stepper">Stage 2 of 6: Docker Buildx</div>}
        onOpenInBottomConsole={() => {}}
        onAbortJob={() => {}}
        onClearTab={() => {}}
      />
    );

    expect(html).toContain('data-stream-state="active"');
    expect(html).toContain('role="log"');
    expect(html).toContain('Collapse');
    expect(html).toContain('Pinned');
    expect(html).toContain('Abort');
    expect(html).toContain('Stage 2 of 6: Docker Buildx');
    expect(html.replace(/<[^>]+>/g, '')).toContain('[PASS] TypeScript pre-check');
    expect(html).toContain('Building Docker layers...');
    expect(html).not.toContain('\x1b');
    expect(html.toLowerCase()).not.toContain('<select');
  });

  it('guards Edge PKI progressSlot against showing ACME device checklist on probe/sync runs', () => {
    const probeTab: TerminalTab = {
      id: 'ssl-probe-123',
      title: 'Re-probe 7-Domain SSL Fleet',
      lines: ['[PASS] SSL fleet dual-probe verification completed.'],
      isRunning: false,
      exitCode: 0,
      pageScope: 'edge',
    };

    const probeHtml = renderToStaticMarkup(
      <WorkStreamContainer
        pageScope="edge"
        title="PKI Certificate Issuance & Fleet Deployment Stream"
        tabs={[probeTab]}
        defaultExpandedOnMount={true}
        progressSlot={(tab) =>
          tab && tab.id.startsWith('ssl-renew-') ? <SslProgressInline activeJob={tab} /> : null
        }
      />
    );
    expect(probeHtml).toContain('Re-probe 7-Domain SSL Fleet');
    expect(probeHtml).not.toContain('Device Deployment Checklist');
    expect(probeHtml).not.toContain('STAGE 1 OF 4');

    const renewTab: TerminalTab = {
      id: 'ssl-renew-124',
      title: 'SSL Fleet Renewal',
      lines: ['Initiating Cloudflare DNS-01 challenge...'],
      isRunning: true,
      pageScope: 'edge',
    };

    const renewHtml = renderToStaticMarkup(
      <WorkStreamContainer
        pageScope="edge"
        title="PKI Certificate Issuance & Fleet Deployment Stream"
        tabs={[renewTab]}
        progressSlot={(tab) =>
          tab && tab.id.startsWith('ssl-renew-') ? <SslProgressInline activeJob={tab} /> : null
        }
      />
    );
    expect(renewHtml).toContain('Checklist');
    expect(renewHtml).toContain('ACME DNS-01');
  });
});
