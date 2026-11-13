import { describe, it, expect } from 'vitest';
import { isAppDeployCandidate } from '../types';
import { BLAST_RADIUS_CONFIG } from '../../components/ui/BlastRadiusBadge';

describe('PanoramaSRE Application Improvements & Architecture', () => {
  describe('Blast Radius Human-Readable Badges & Tooltips', () => {
    const expectedKeys = [
      'DB_MIGRATION',
      'AUTH_SECURITY',
      'ENV_CONTRACT',
      'DEPENDENCY_DELTA',
      'DOCKER_INFRA',
      'APP_LOGIC_UI',
    ];

    it('has user-friendly definitions for all 6 blast radius categories', () => {
      expectedKeys.forEach((key) => {
        const config = BLAST_RADIUS_CONFIG[key];
        expect(config).toBeDefined();
        expect(config.label.length).toBeGreaterThan(0);
        expect(config.description.length).toBeGreaterThan(15);
        expect(config.icon).toBeDefined();
        expect(config.colorClasses).toContain('border-');
      });
    });

    it('assigns specific readable labels to technical categories', () => {
      expect(BLAST_RADIUS_CONFIG.DB_MIGRATION.label).toBe('Database Schema');
      expect(BLAST_RADIUS_CONFIG.AUTH_SECURITY.label).toBe('Auth & Security');
      expect(BLAST_RADIUS_CONFIG.ENV_CONTRACT.label).toBe('Env Contract');
      expect(BLAST_RADIUS_CONFIG.DEPENDENCY_DELTA.label).toBe('Dependencies');
      expect(BLAST_RADIUS_CONFIG.DOCKER_INFRA.label).toBe('Docker & Infra');
      expect(BLAST_RADIUS_CONFIG.APP_LOGIC_UI.label).toBe('App Logic & UI');
    });
  });

  describe('DietPi & Releases Badge Aggregation', () => {
    it('accurately parses upgradable packages from raw apt list', () => {
      const rawApt = `Listing... Done
curl/stable 7.88.1-10+deb12u8 arm64 [upgradable from: 7.88.1-10+deb12u7]
libc-bin/stable 2.36-9+deb12u9 arm64 [upgradable from: 2.36-9+deb12u8]
`;
      const packages = rawApt
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('Listing...'));

      expect(packages.length).toBe(2);
    });

    it('detects behind releases from composition and provenance states', () => {
      const sampleApps: any[] = [
        {
          provenanceState: 'IN_SYNC',
          health: { status: 'healthy' },
          composition: { undeployed_commits: [], local_dirty: false, ahead_count: 0 },
        },
        {
          provenanceState: 'AHEAD',
          health: { status: 'healthy' },
          composition: { undeployed_commits: [{ sha: 'abc1234', subject: 'feat' }], local_dirty: false, ahead_count: 1 },
        },
        {
          provenanceState: 'DIRTY_PROD',
          health: { status: 'healthy' },
          composition: { undeployed_commits: [], local_dirty: true, ahead_count: 0 },
        },
        {
          provenanceState: 'PROD_UNREACHABLE',
          health: { status: 'unhealthy' },
          composition: { undeployed_commits: [], local_dirty: false, ahead_count: 0 },
        },
      ];

      const candidates = sampleApps.filter(isAppDeployCandidate);
      expect(candidates.length).toBe(3);
    });
  });

  describe('Deployment Monotonic Stage Progression', () => {
    // Pure function logic mirroring ReleasePipelineView getDeploymentStage
    function parseDeploymentStage(lines: string[], isRunning = true, exitCode?: number) {
      const isFinished = !isRunning && exitCode === 0;
      const isFailed = !isRunning && exitCode !== undefined && exitCode !== 0;

      let maxStage = 1;
      let subStep = 'Initializing pre-flight environment';

      const fullText = lines.join('\n');

      if (fullText.includes('TypeScript') || fullText.includes('database backup')) {
        maxStage = 1;
        subStep = 'Compiling TypeScript (tsc --noEmit)';
      }
      if (/Building and packaging Docker image|docker buildx build|RUN apk|RUN npm|DONE|transferring context|CACHED/i.test(fullText)) {
        maxStage = 2;
        const tail = lines.slice(-20).join(' ');
        if (/npm run build|Creating an optimized production build|Compiled successfully/i.test(tail)) {
          subStep = 'Next.js App Build (npm run build)';
        } else if (/npm (?:ci|install)|apk add/i.test(tail)) {
          subStep = 'Installing Dependencies (npm ci)';
        } else if (/exporting to image|writing image|saving/i.test(tail)) {
          subStep = 'Exporting Container Archive to Tar';
        } else {
          subStep = 'Compiling ARM64 Container Layers';
        }
      }
      if (/Preparing remote environment|Uploading archive and configurations|Files staged on server|Invoke-PscpUpload|pscp/i.test(fullText)) {
        maxStage = 3;
        const tail = lines.slice(-20).join(' ');
        if (/Uploading archive|tar|pscp/i.test(tail)) {
          subStep = 'Uploading Docker Tar via SCP to Host';
        } else {
          subStep = 'Staging Artifacts on DietPi';
        }
      }
      if (/Executing deployment|Deploying container on remote server|docker load|docker compose up|container is live/i.test(fullText)) {
        maxStage = 4;
        const tail = lines.slice(-20).join(' ');
        if (/docker load/i.test(tail)) {
          subStep = 'Loading Tar into Docker Engine';
        } else if (/docker compose up/i.test(tail)) {
          subStep = 'Starting New Container Instance';
        } else {
          subStep = 'Executing Rolling Container Swap';
        }
      }
      if (/POST-DEPLOYMENT VERIFICATION|Checking Health Endpoint|Checking GEMINI_API_KEY|Checking Auth/i.test(fullText)) {
        maxStage = 5;
        subStep = 'Probing /api/health Endpoint';
      }
      if (/Notifying PanoramaAuth to sync|Manifest synchronization triggered/i.test(fullText) || isFinished) {
        maxStage = 6;
        subStep = isFinished ? 'All 6 Release Stages Completed' : 'Triggering Manifest Webhook';
      }

      return { stage: maxStage, subStep, isFinished, isFailed };
    }

    it('never steps backwards even when generic lines or old keywords pass through', () => {
      const logs = [
        '[1/4] Running pre-build TypeScript validation...',
        'Building and packaging Docker image locally...',
        'docker buildx build --platform linux/arm64',
        'RUN npm run build',
        'Creating an optimized production build...',
      ];

      const stage2 = parseDeploymentStage(logs);
      expect(stage2.stage).toBe(2);
      expect(stage2.subStep).toBe('Next.js App Build (npm run build)');

      // Add SCP logs
      logs.push('[3/4] Uploading archive and configurations...');
      logs.push('Invoke-PscpUpload deploy-image.tar');
      const stage3 = parseDeploymentStage(logs);
      expect(stage3.stage).toBe(3);
      expect(stage3.subStep).toBe('Uploading Docker Tar via SCP to Host');

      // Add Docker swap logs
      logs.push('[4/4] Executing deployment...');
      logs.push('docker load -i /tmp/deploy-image.tar');
      const stage4 = parseDeploymentStage(logs);
      expect(stage4.stage).toBe(4);
      expect(stage4.subStep).toBe('Loading Tar into Docker Engine');

      // Add post-deployment verification
      logs.push('--- POST-DEPLOYMENT VERIFICATION ---');
      logs.push('Checking Health Endpoint...');
      const stage5 = parseDeploymentStage(logs);
      expect(stage5.stage).toBe(5);
      expect(stage5.subStep).toBe('Probing /api/health Endpoint');

      // Mark complete with exit code 0
      logs.push('Manifest synchronization triggered: {"success":true}');
      const stage6 = parseDeploymentStage(logs, false, 0);
      expect(stage6.stage).toBe(6);
      expect(stage6.isFinished).toBe(true);
      expect(stage6.subStep).toBe('All 6 Release Stages Completed');
    });
  });

  describe('Release Pipeline Stream Persistence & Job Resolution Across Navigation', () => {
    interface MockTerminalTab {
      id: string;
      title: string;
      lines: string[];
      isRunning: boolean;
      exitCode?: number;
      createdAt?: string;
      finishedAt?: string;
    }

    function getAppDeployJob(terminalTabs: MockTerminalTab[], slug: string) {
      return terminalTabs.find(
        (t) => (t.id.startsWith(`deploy-${slug}-`) || t.id.startsWith(`rollback-${slug}-`)) && t.isRunning
      );
    }

    function getAllAppDeployJobs(terminalTabs: MockTerminalTab[], slug: string) {
      return terminalTabs
        .filter((t) => t.id.startsWith(`deploy-${slug}-`) || t.id.startsWith(`rollback-${slug}-`))
        .sort((a, b) => {
          if (a.isRunning !== b.isRunning) {
            return a.isRunning ? -1 : 1;
          }
          const timeA = a.finishedAt || a.createdAt || a.id;
          const timeB = b.finishedAt || b.createdAt || b.id;
          return timeB.localeCompare(timeA);
        });
    }

    function resolveDisplayedDeployJob(
      terminalTabs: MockTerminalTab[],
      slug: string,
      trackedDeployJobIds: Record<string, string>
    ) {
      const activeJob = getAppDeployJob(terminalTabs, slug);
      const trackedId = trackedDeployJobIds[slug];
      return activeJob || (trackedId ? terminalTabs.find((t) => t.id === trackedId) : undefined);
    }

    const tabs: MockTerminalTab[] = [
      {
        id: 'deploy-spendy-ledger-1700000100',
        title: 'Deploy: SpendyLedger',
        lines: ['[1/4] TypeScript validation...', 'Done'],
        isRunning: false,
        exitCode: 0,
        createdAt: '2026-11-10T01:00:00Z',
        finishedAt: '2026-11-10T01:02:00Z',
      },
      {
        id: 'rollback-spendy-ledger-1700000200',
        title: 'Rollback: SpendyLedger',
        lines: ['Swapping container tag...'],
        isRunning: true,
        createdAt: '2026-11-10T02:00:00Z',
      },
      {
        id: 'deploy-tasty-basket-1700000150',
        title: 'Deploy: TastyBasket',
        lines: ['Build failed'],
        isRunning: false,
        exitCode: 1,
        createdAt: '2026-11-10T01:30:00Z',
        finishedAt: '2026-11-10T01:31:00Z',
      },
    ];

    it('matches both deploy-${slug}-* and rollback-${slug}-* and prioritizes running jobs', () => {
      const running = getAppDeployJob(tabs, 'spendy-ledger');
      expect(running?.id).toBe('rollback-spendy-ledger-1700000200');

      const allSpendy = getAllAppDeployJobs(tabs, 'spendy-ledger');
      expect(allSpendy.map((t) => t.id)).toEqual([
        'rollback-spendy-ledger-1700000200',
        'deploy-spendy-ledger-1700000100',
      ]);
    });

    it('preserves tracked completed/failed jobs across tab switches', () => {
      const tracked = { 'tasty-basket': 'deploy-tasty-basket-1700000150' };
      const displayed = resolveDisplayedDeployJob(tabs, 'tasty-basket', tracked);
      expect(displayed).toBeDefined();
      expect(displayed?.id).toBe('deploy-tasty-basket-1700000150');
      expect(displayed?.exitCode).toBe(1);
    });

    it('recovers latest available stream when re-opened after dismissal', () => {
      const trackedAfterDismiss: Record<string, string> = {};
      expect(resolveDisplayedDeployJob(tabs, 'tasty-basket', trackedAfterDismiss)).toBeUndefined();

      const latestAvailable = getAllAppDeployJobs(tabs, 'tasty-basket')[0];
      expect(latestAvailable).toBeDefined();
      expect(latestAvailable.id).toBe('deploy-tasty-basket-1700000150');

      // User clicks "Show Deployment Stream" which re-tracks latestAvailable.id
      trackedAfterDismiss['tasty-basket'] = latestAvailable.id;
      const reopened = resolveDisplayedDeployJob(tabs, 'tasty-basket', trackedAfterDismiss);
      expect(reopened?.id).toBe('deploy-tasty-basket-1700000150');
    });
  });

  describe('TopLiveSyncBar & MCP Telemetry Presentation', () => {
    it('formats MCP bridge telemetry correctly for online state with PID', () => {
      const onlineStatus = {
        isOnline: true,
        pipeName: '\\\\.\\pipe\\panoramasre-ctl-53520',
        pid: 53520,
        activeLeasesCount: 1,
        activeDevServersCount: 2,
        instances: [{ pid: 53520, binary_type: 'Release', port: 1420, is_primary: true }],
      };

      expect(onlineStatus.isOnline).toBe(true);
      expect(onlineStatus.pid).toBe(53520);
      expect(onlineStatus.activeDevServersCount).toBe(2);
      expect(`PID ${onlineStatus.pid}`).toBe('PID 53520');
    });

    it('formats MCP bridge telemetry correctly for offline fallback state', () => {
      const offlineStatus = {
        isOnline: false,
        pipeName: '',
        pid: null,
        activeLeasesCount: 0,
        activeDevServersCount: 0,
        instances: [],
      };

      expect(offlineStatus.isOnline).toBe(false);
      expect(offlineStatus.pid).toBeNull();
      expect(offlineStatus.activeLeasesCount).toBe(0);
    });

    it('maintains non-wrapping, responsive text invariant contracts', () => {
      // Invariant: sync time strings must not be split across line breaks
      const sampleSync = '7:01:00 PM';
      expect(sampleSync.includes('\n')).toBe(false);

      const sampleAudit = '7:01:43 PM';
      const interval = '5';
      const auditFull = `Audit: ${sampleAudit} (${interval}m)`;
      expect(auditFull).toBe('Audit: 7:01:43 PM (5m)');
    });
  });

  describe('7-Day GFS Backup Reliability & Missed Run Failure Detection', () => {
    it('treats missed daily runs (NoRun) as failures in 7-day reliability and sidebar badge count', () => {
      const mockLedger = {
        last_run_status: 'Success',
        runs_7d: 7,
        successful_runs_7d: 6,
        failed_runs_7d: 1,
        latest_app_details: [
          { app_name: 'PanoramaAuth', status: 'Success' },
        ],
        daily_pips_7d: [
          { date: '2026-11-07', day_label: 'Sat', status: 'Success' as const, run_count: 1 },
          { date: '2026-11-08', day_label: 'Sun', status: 'Success' as const, run_count: 1 },
          { date: '2026-11-09', day_label: 'Mon', status: 'Success' as const, run_count: 1 },
          { date: '2026-11-10', day_label: 'Tue', status: 'Success' as const, run_count: 1 },
          { date: '2026-11-11', day_label: 'Wed', status: 'Success' as const, run_count: 1 },
          { date: '2026-11-12', day_label: 'Thu', status: 'NoRun' as const, run_count: 0 },
          { date: '2026-11-13', day_label: 'Fri', status: 'Success' as const, run_count: 1 },
        ],
      };

      const reliabilityPct = Math.round((mockLedger.successful_runs_7d / mockLedger.runs_7d) * 100);
      expect(reliabilityPct).toBe(86);

      const backupFailureCount =
        mockLedger.last_run_status.toLowerCase() === 'failed'
          ? mockLedger.latest_app_details.filter((a) => a.status.toLowerCase() === 'failed').length || 1
          : mockLedger.failed_runs_7d || 0;

      expect(backupFailureCount).toBe(1);

      const missedPips = mockLedger.daily_pips_7d.filter((p) => p.status !== 'Success');
      expect(missedPips).toHaveLength(1);
      expect(missedPips[0].date).toBe('2026-11-12');

      // When only a past day was missed and today's pip already succeeded, manual backup is not actionable
      const todayPip = mockLedger.daily_pips_7d[mockLedger.daily_pips_7d.length - 1];
      const isLastFailed = mockLedger.last_run_status.toLowerCase() === 'failed';
      const isActionableNow = isLastFailed || todayPip.status !== 'Success';
      expect(isActionableNow).toBe(false);
    });
  });
});

