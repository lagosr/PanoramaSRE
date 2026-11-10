import { describe, it, expect } from 'vitest';
import { getTabFinishedDetails, TerminalTab } from '../../components/layout/SreEventsConsolePanel';
import { formatConsoleLine } from '../../components/layout/ConsoleColorizer';
import React from 'react';

describe('Console Stream Finished Details & Ordering', () => {
  it('returns Running now and pins priority timestamp for active streams', () => {
    const tab: TerminalTab = {
      id: 'job-1',
      title: 'Deploy: BiomedMaven',
      lines: ['Deploying...'],
      isRunning: true,
      createdAt: '2026-11-02T19:00:00Z',
    };

    const details = getTabFinishedDetails(tab);
    expect(details.label).toBe('Running now');
    expect(details.timestampMs).toBeGreaterThan(Date.now());
  });

  it('uses finishedAt when present', () => {
    const tab: TerminalTab = {
      id: 'job-2',
      title: 'Deploy: SpendyLedger',
      lines: ['Finished.'],
      isRunning: false,
      exitCode: 0,
      createdAt: '2026-11-02T18:00:00Z',
      finishedAt: '2026-11-02T18:05:00Z',
    };

    const details = getTabFinishedDetails(tab);
    expect(details.label).toContain('2026');
    expect(details.timestampMs).toBe(new Date('2026-11-02T18:05:00Z').getTime());
  });

  it('extracts embedded timestamp from the tail of lines if finishedAt is missing', () => {
    const tab: TerminalTab = {
      id: 'job-3',
      title: 'Snapshot: TastyBasket',
      lines: [
        'Starting backup...',
        'Writing sqlite file...',
        'Completed At: 2026-11-02T17:30:00Z',
        '[RUNNER] Process exited with code: 0',
      ],
      isRunning: false,
      exitCode: 0,
    };

    const details = getTabFinishedDetails(tab);
    expect(details.label).toContain('2026');
    expect(details.timestampMs).toBe(new Date('2026-11-02T17:30:00Z').getTime());
  });

  it('correctly sorts streams newest at the top', () => {
    const tabs: TerminalTab[] = [
      {
        id: 'older',
        title: 'Older Job',
        lines: [],
        isRunning: false,
        finishedAt: '2026-11-02T10:00:00Z',
      },
      {
        id: 'running',
        title: 'Active Job',
        lines: [],
        isRunning: true,
        createdAt: '2026-11-02T12:00:00Z',
      },
      {
        id: 'newer',
        title: 'Newer Job',
        lines: [],
        isRunning: false,
        finishedAt: '2026-11-02T11:00:00Z',
      },
    ];

    const sorted = [...tabs].sort((a, b) => {
      if (a.isRunning && !b.isRunning) return -1;
      if (!a.isRunning && b.isRunning) return 1;
      return getTabFinishedDetails(b).timestampMs - getTabFinishedDetails(a).timestampMs;
    });

    expect(sorted[0].id).toBe('running');
    expect(sorted[1].id).toBe('newer');
    expect(sorted[2].id).toBe('older');
  });

  it('does not false-positive color BuildKit RUN step headers containing console.error, FAIL, or dirty', () => {
    const elfStepHeader = `#25 [runner 9/10] RUN node -e 'if (!isElf) { console.error("[ELF-GATE] FAIL: invalid"); }'`;
    const manifestStepHeader = `#26 [runner 10/10] RUN node -e 'fs.writeFileSync("/app/release-manifest.json", JSON.stringify({git:{dirty:process.env.GIT_DIRTY==="true"}}))'`;

    const el25 = formatConsoleLine(elfStepHeader) as React.ReactElement<{ className?: string; children?: React.ReactNode }>;
    const el26 = formatConsoleLine(manifestStepHeader) as React.ReactElement<{ className?: string; children?: React.ReactNode }>;

    expect(el25.props.className || '').not.toContain('text-rose-600');
    expect(el25.props.className || '').not.toContain('text-amber-700');
    expect(el26.props.className || '').not.toContain('text-rose-600');
    expect(el26.props.className || '').not.toContain('text-amber-700');

    const actualBuildKitErr = formatConsoleLine('#16 ERROR: process "/bin/sh -c npm ci" did not complete successfully: exit code: 1') as React.ReactElement<{ className?: string }>;
    const actualElfFail = formatConsoleLine('1.717 [ELF-GATE] FAIL: /app/node_modules/@img/sharp-linux-x64/lib/sharp.node has invalid architecture') as React.ReactElement<{ className?: string }>;

    expect(actualBuildKitErr.props.className).toContain('text-rose-600');
    expect(actualElfFail.props.className).toContain('text-rose-600');
  });
});
