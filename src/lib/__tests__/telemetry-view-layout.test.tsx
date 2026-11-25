import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StageWaterfallChart } from '../../components/telemetry/StageWaterfallChart';
import { BuildTelemetryView } from '../../components/telemetry/BuildTelemetryView';
import type { StageWaterfallRow, TelemetryActionableAlert } from '../deployHistoryAnalytics';
import type { DiscoveredApp } from '../types';

describe('Telemetry UI stability and actionable callouts', () => {
  it('renders StageWaterfallChart with a fixed-height hover readout container and zero layout shift classes', () => {
    const rows: StageWaterfallRow[] = [
      {
        slug: 'basket',
        displayName: 'TastyBasket',
        runCount: 18,
        avgTotalWallSec: 47.9,
        typecheckSec: 4.1,
        bumpSec: 1.2,
        depsSec: 6.5,
        nextBuildSec: 18.2,
        exportTailSec: 3.1,
        uploadSec: 4.2,
        snapshotSec: 1.5,
        swapSec: 3.8,
        verifySec: 1.1,
        smokeSec: 2.0,
        cronFinalizeSec: 0.4,
        untrackedNonDockerSec: 1.8,
      },
    ];

    const html = renderToStaticMarkup(
      <StageWaterfallChart rows={rows} onSelectApp={vi.fn()} />
    );

    expect(html).toContain('data-testid="stage-waterfall-hover-readout"');
    expect(html).toContain('h-[76px]');
    expect(html).toContain('shrink-0');
    expect(html).toContain('Hover any application bar above to inspect its exact per-stage breakdown');
  });

  it('renders BuildTelemetryView actionable issue banner with 1:1 triage controls and omits it when clean', () => {
    const apps = [
      {
        manifest: { slug: 'parakith', displayName: 'ParakithSite' },
      } as unknown as DiscoveredApp,
    ];

    const alert: TelemetryActionableAlert = {
      id: 'run:deploy-parakith-fail',
      kind: 'failed_deploy',
      severity: 'error',
      appSlug: 'parakith',
      appName: 'ParakithSite',
      title: 'ParakithSite latest deploy failed (exit 1)',
      detail: 'Run deploy-parakith-fail (static) exited with status FAILED.',
      startedAt: '2026-11-25 00:05:06',
      consoleSessionId: 'deploy-parakith-fail',
      warnings: [],
    };

    const withAlertHtml = renderToStaticMarkup(
      <BuildTelemetryView
        apps={apps}
        runs={[]}
        dockerDiskUsage={null}
        terminalTabs={[]}
        onRefresh={vi.fn()}
        onPruneBuildKitCache={vi.fn()}
        onOpenInReleases={vi.fn()}
        actionableAlerts={[alert]}
        onDismissAlert={vi.fn()}
      />
    );

    expect(withAlertHtml).toContain('data-testid="telemetry-action-banner"');
    expect(withAlertHtml).toContain('1 Actionable Build Telemetry Issue');
    expect(withAlertHtml).toContain('ParakithSite latest deploy failed (exit 1)');
    expect(withAlertHtml).toContain('Open in Releases');
    expect(withAlertHtml).toContain('Filter Ledger');
    expect(withAlertHtml).toContain('Dismiss');
    expect(withAlertHtml).toContain('Prune Stale BuildKit Cache (&gt;3d)');

    const cleanHtml = renderToStaticMarkup(
      <BuildTelemetryView
        apps={apps}
        runs={[]}
        dockerDiskUsage={null}
        terminalTabs={[]}
        onRefresh={vi.fn()}
        onPruneBuildKitCache={vi.fn()}
        actionableAlerts={[]}
      />
    );

    expect(cleanHtml).not.toContain('data-testid="telemetry-action-banner"');
  });
});
