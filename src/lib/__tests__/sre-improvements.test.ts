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
});
