import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  BatchPreDeploySnapshot,
  BatchSmokeFailureReport,
  CloudflareDeployment,
  DiscoveredApp,
  NetworkPosture,
  TerminalTab,
  UnifiSiemEnvConfigDto,
  WshSnapshot,
  isAppDeployCandidate,
} from '../../lib/types';
import {
  GitBranch,
  Rocket,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Server,
  Activity,
  Clock,
  Tag,
  Globe,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  Play,
  ArrowRight,
  Loader2,
  Container,
  Check,
  Square,
  Eye,
  XCircle,
  Terminal,
  X,
} from 'lucide-react';
import { BatchDeployModal, BatchDeployOptions } from './BatchDeployModal';
import { ReleaseFleetRail } from './ReleaseFleetRail';
import { BuildEfficiencyStrip } from './BuildEfficiencyStrip';
import { CustomSelect } from '../ui/CustomSelect';
import { CopyableValue } from '../ui/CopyableValue';
import { ToggleSwitch } from '@lagosr/panorama-ui-kit';
import { formatLocalDateTime, formatRelativeTime } from '../../lib/formatters';
import { ReleaseCompositionDrawer } from '../hud/ReleaseCompositionDrawer';
import { BlastRadiusBadge } from '../ui/BlastRadiusBadge';
import {
  resolveActiveBuildTelemetry,
  evaluateBuildHealthBadge,
  getAppTelemetryTargets,
} from '../../lib/buildTelemetry';

interface ReleasePipelineViewProps {
  apps: DiscoveredApp[];
  terminalTabs?: TerminalTab[];
  selectedAppSlug?: string;
  onSelectAppSlug?: (slug: string) => void;
  trackedDeployJobIds?: Record<string, string>;
  onTrackDeployJob?: (slug: string, jobId: string) => void;
  onDismissDeployJob?: (slug: string) => void;
  onOpenInBottomConsole?: (jobId?: string) => void;
  onOpenInConsoleDrawer?: (jobId: string) => void;
  onAbortJob?: (jobId: string) => void;
  onCloseTab?: (id: string) => void;
  onClearTab?: (id: string) => void;
  onTriggerDeploy: (
    app: DiscoveredApp,
    bump: string,
    allowDirty: boolean,
    edgeMode?: 'GitCi' | 'Wrangler'
  ) => void;
  onTriggerDeployAll: (
    apps: DiscoveredApp[],
    bump: string,
    allowDirty: boolean,
    autoRollbackOnSmokeFailure?: boolean
  ) => void;
  onTriggerRollback: (app: DiscoveredApp, tag: string) => void;
  isDeployingAll?: boolean;
  onHaltDeployments?: () => void;
  batchSmokeFailureReport?: BatchSmokeFailureReport | null;
  onDismissBatchSmokeFailure?: () => void;
  onRollbackBatchTargets?: (targets: BatchPreDeploySnapshot[]) => void;
  onOpenSmokeTests?: () => void;
  onOpenTelemetry?: (appSlug: string) => void;
  wshSnapshot?: WshSnapshot | null;
  isInitialSyncComplete?: boolean;
  networkPosture?: NetworkPosture;
  onTriggerServiceAction?: (
    app: DiscoveredApp,
    action: 'verify_local' | 'test' | 'status' | 'stop'
  ) => void;
  onReapplyHardening?: () => void;
}

export function ReleasePipelineView({
  apps,
  terminalTabs = [],
  selectedAppSlug: controlledAppSlug,
  onSelectAppSlug,
  trackedDeployJobIds,
  onTrackDeployJob,
  onOpenInBottomConsole,
  onOpenInConsoleDrawer,
  onAbortJob,
  onTriggerDeploy,
  onTriggerDeployAll,
  onTriggerRollback,
  isDeployingAll = false,
  onHaltDeployments,
  batchSmokeFailureReport = null,
  onDismissBatchSmokeFailure,
  onRollbackBatchTargets,
  onOpenSmokeTests,
  onOpenTelemetry,
  wshSnapshot = null,
  isInitialSyncComplete = true,
  networkPosture = 'LAN_DIRECT',
  onTriggerServiceAction,
  onReapplyHardening,
}: ReleasePipelineViewProps) {
  const [localSelectedAppSlug, setLocalSelectedAppSlug] = useState<string>(apps[0]?.manifest.slug || '');
  const [localTrackedJobIds, setLocalTrackedJobIds] = useState<Record<string, string>>({});
  const [bumpVersion, setBumpVersion] = useState<string>('none');
  const [allowDirty, setAllowDirty] = useState<boolean>(false);
  const [edgeDeployMode, setEdgeDeployMode] = useState<'GitCi' | 'Wrangler'>('GitCi');
  const [rollbackTag, setRollbackTag] = useState<string>('');
  const [cfDeployments, setCfDeployments] = useState<CloudflareDeployment[]>([]);
  const [cfDeploymentsLoading, setCfDeploymentsLoading] = useState<boolean>(false);
  const [cfDeploymentsError, setCfDeploymentsError] = useState<string | null>(null);
  const [siemEnvConfig, setSiemEnvConfig] = useState<UnifiSiemEnvConfigDto | null>(null);
  const [showDeployAllModal, setShowDeployAllModal] = useState<boolean>(false);
  const [batchSelectedSlugs, setBatchSelectedSlugs] = useState<Set<string>>(() => new Set());
  const [inspectApp, setInspectApp] = useState<DiscoveredApp | null>(null);

  const toggleBatchSlug = (slug: string) => {
    setBatchSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const selectAllBehindForBatch = () => {
    const behindWsh = apps
      .filter(
        (a) =>
          (!a.manifest.hostingTarget || a.manifest.hostingTarget === 'wsh-docker') &&
          isAppDeployCandidate(a)
      )
      .map((a) => a.manifest.slug);
    setBatchSelectedSlugs(new Set(behindWsh));
  };

  // Helper to detect if an app has an active running deployment/rollback job
  const getAppDeployJob = (slug: string) => {
    return terminalTabs.find(
      (t) => (t.id.startsWith(`deploy-${slug}-`) || t.id.startsWith(`rollback-${slug}-`)) && t.isRunning
    );
  };

  // Helper to list all deployment/rollback jobs for an app sorted newest first (running first)
  const getAllAppDeployJobs = (slug: string) => {
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
  };

  // Resolve active running app slug if any
  const runningApp = apps.find((a) => !!getAppDeployJob(a.manifest.slug));

  const effectiveSelectedSlug =
    (controlledAppSlug && apps.some((a) => a.manifest.slug === controlledAppSlug)
      ? controlledAppSlug
      : undefined) ||
    (!controlledAppSlug && runningApp ? runningApp.manifest.slug : undefined) ||
    (localSelectedAppSlug && apps.some((a) => a.manifest.slug === localSelectedAppSlug)
      ? localSelectedAppSlug
      : undefined) ||
    apps[0]?.manifest.slug ||
    '';

  const handleSelectApp = (slug: string) => {
    setLocalSelectedAppSlug(slug);
    onSelectAppSlug?.(slug);
    setRollbackTag('');
  };

  // Auto-select running app when controlledAppSlug is empty
  useEffect(() => {
    if (!controlledAppSlug && runningApp) {
      setLocalSelectedAppSlug(runningApp.manifest.slug);
      onSelectAppSlug?.(runningApp.manifest.slug);
    }
  }, [controlledAppSlug, runningApp?.manifest.slug]);

  const effectiveTrackedJobIds = trackedDeployJobIds ?? localTrackedJobIds;

  const handleTrackJob = (slug: string, jobId: string) => {
    setLocalTrackedJobIds((prev) => ({ ...prev, [slug]: jobId }));
    onTrackDeployJob?.(slug, jobId);
  };

  // Automatically sync running deployment/rollback jobs into trackedDeployJobIds
  useEffect(() => {
    for (const app of apps) {
      const activeJob = getAppDeployJob(app.manifest.slug);
      if (activeJob && effectiveTrackedJobIds[app.manifest.slug] !== activeJob.id) {
        handleTrackJob(app.manifest.slug, activeJob.id);
      }
    }
  }, [terminalTabs, apps]);

  const selectedApp = apps.find((a) => a.manifest.slug === effectiveSelectedSlug) || apps[0];
  const isEdgeApp = selectedApp?.manifest.hostingTarget === 'cloudflare-pages';
  const isWshService = selectedApp?.manifest.hostingTarget === 'wsh-docker-service';
  const isOptionalNotDeployedService =
    isWshService &&
    Boolean(selectedApp?.manifest.service?.optionalDeployment) &&
    selectedApp?.health?.status === 'not_deployed';
  const matchedServiceContainer = isWshService
    ? (wshSnapshot?.containers || []).find((c) => {
        const clean = (c.Names || '').replace(/^\//, '').toLowerCase();
        return clean === (selectedApp?.manifest.containerName || selectedApp?.manifest.slug || '').toLowerCase();
      }) ?? null
    : null;
  const appPublicUrl = isEdgeApp
    ? (selectedApp?.manifest.cloudflare?.primaryUrl || 'https://www.parakith.com').replace(/\/+$/, '')
    : `https://wsh.panoramadr.com${selectedApp?.manifest.basePath || ''}`;
  const comp = selectedApp?.composition;

  useEffect(() => {
    if (!selectedApp || !isWshService || selectedApp.manifest.slug !== 'unifi-siem') {
      setSiemEnvConfig(null);
      return;
    }
    let cancelled = false;
    invoke<UnifiSiemEnvConfigDto>('get_unifi_siem_env_config')
      .then((dto) => {
        if (!cancelled) setSiemEnvConfig(dto);
      })
      .catch(() => {
        if (!cancelled) setSiemEnvConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedApp?.manifest.slug, isWshService]);

  useEffect(() => {
    if (!selectedApp || !isEdgeApp) {
      setCfDeployments([]);
      setCfDeploymentsError(null);
      return;
    }
    let cancelled = false;
    setCfDeploymentsLoading(true);
    setCfDeploymentsError(null);
    invoke<CloudflareDeployment[]>('list_cloudflare_deployments', {
      workspacePath: selectedApp.workspacePath,
      projectName: selectedApp.manifest.cloudflare?.pagesProject || 'parakith-site',
    })
      .then((list) => {
        if (!cancelled) setCfDeployments(list || []);
      })
      .catch((err) => {
        if (!cancelled) {
          setCfDeployments([]);
          setCfDeploymentsError(String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setCfDeploymentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedApp?.manifest.slug, selectedApp?.workspacePath, isEdgeApp]);
  const prodRelease = selectedApp?.health?.release;
  const isHealthy = selectedApp?.health?.status === 'healthy';
  const selectedAppIdent = selectedApp
    ? selectedApp.manifest.containerName || selectedApp.manifest.slug || selectedApp.manifest.appId
    : '';
  const selectedResolvedTelemetry = resolveActiveBuildTelemetry(prodRelease, comp);
  const selectedTelemetry = selectedResolvedTelemetry.telemetry;
  const selectedHealthBadge = evaluateBuildHealthBadge(selectedTelemetry, selectedAppIdent);
  const selectedTelemetryTargets = getAppTelemetryTargets(
    selectedAppIdent,
    selectedHealthBadge.cachePosture
  );

  // Deterministically and monotonically parse deployment progress & exact build steps
  const getDeploymentStage = (tab?: TerminalTab) => {
    if (!tab) return null;

    const isFinished = !tab.isRunning && tab.exitCode === 0;
    const isFailed = !tab.isRunning && tab.exitCode !== undefined && tab.exitCode !== 0;

    const lines = tab.lines;
    const fullText = lines.join('\n');
    const isServiceUtility =
      isWshService &&
      (/-(verify_local|test|status|stop)-/i.test(tab.id) ||
        /Verify Local|Dry-Run|Collector Status|Stop Service/i.test(tab.title));

    if (isServiceUtility) {
      return {
        stage: 1,
        label: tab.title,
        subStep: isFinished ? 'Completed cleanly' : isFailed ? 'Exited with error' : 'Running service check...',
        icon: Activity,
        isFinished,
        isFailed,
        isSingleStep: true,
      };
    }

    const isServiceDeploy =
      isWshService || /deploy-unifi-siem\.ps1|ARM64 Docker BuildKit Export/i.test(fullText);

    if (isServiceDeploy) {
      let maxStage = 1;
      let label = 'Typecheck & Unit Tests';
      let subStep = 'Running TypeScript & Vitest compliance gate';

      if (/\[STAGE 1\/4\]|TypeScript|vitest/i.test(fullText)) {
        maxStage = 1;
        label = 'Typecheck & Unit Tests';
        subStep = 'Validating service bundle & UDP unit tests';
      }
      if (/\[STAGE 2\/4\]|ARM64 Docker BuildKit Export|docker buildx build/i.test(fullText)) {
        maxStage = 2;
        label = 'ARM64 Image Build';
        subStep = 'Compiling hardened Alpine container archive';
      }
      if (/\[STAGE 3\/4\]|WSH Transfer|scp\.exe|panorama-firewall\.sh/i.test(fullText)) {
        maxStage = 3;
        label = 'Upload & Firewall Sync';
        subStep = 'Staging compose/env & locking DOCKER-USER';
      }
      if (/\[STAGE 4\/4\]|Container Start|docker compose up|\[PASS\] unifi-siem/i.test(fullText) || isFinished) {
        maxStage = 4;
        label = 'Start & Verify';
        subStep = isFinished ? 'All 4 Service Stages Completed' : 'Loading tar & starting service container';
      }

      const icon =
        maxStage === 1 ? Loader2 :
        maxStage === 2 ? Container :
        maxStage === 3 ? ShieldCheck :
        Rocket;

      return {
        stage: maxStage,
        label,
        subStep,
        icon,
        isFinished,
        isFailed,
        isSingleStep: false,
      };
    }

    const isEdgeTab = isEdgeApp || /deploy-cloudflare-pages\.ps1|Cloudflare Pages/i.test(fullText);

    if (isEdgeTab) {
      let maxStage = 1;
      let label = 'Typecheck & Tests';
      let subStep = 'Running tsc & Vitest compliance checks';

      if (/\[STAGE 1\/4\]|Pre-flight Typecheck|npm run typecheck|npm test|Validating Cloudflare Pages rollback/i.test(fullText)) {
        maxStage = 1;
        label = 'Typecheck & Tests';
        subStep = /rollback/i.test(fullText)
          ? 'Validating Cloudflare Pages rollback target'
          : 'Executing TypeScript & Vitest compliance gate';
      }

      if (/\[STAGE 2\/4\]|Static Export|Release Provenance Stamp|npm run build|Skipping rebuild/i.test(fullText)) {
        maxStage = 2;
        label = 'Static Build & Stamp';
        subStep = /Skipping rebuild/i.test(fullText)
          ? 'Skipping rebuild for instant edge rollback'
          : 'Building static out/ & release-info.json';
      }

      if (/\[STAGE 3\/4\]|Cloudflare Pages Edge Publish|wrangler pages deploy|Rolling back Cloudflare Pages/i.test(fullText)) {
        maxStage = 3;
        label = 'Cloudflare Publish';
        subStep = /rollback/i.test(fullText)
          ? 'Re-promoting immutable Cloudflare deployment'
          : 'Publishing bundle to Cloudflare Pages edge';
      }

      if (/\[STAGE 4\/4\]|Stealth Edge Health|5-Route Verification|Verifying public routes|\[PASS\] Cloudflare Pages/i.test(fullText) || isFinished) {
        maxStage = 4;
        label = 'Stealth & Route Gate';
        subStep = isFinished ? 'All 4 Edge Stages Completed' : 'Verifying Stealth 404 & HMAC Probe';
      }

      const icon =
        maxStage === 1 ? Loader2 :
        maxStage === 2 ? Layers :
        maxStage === 3 ? Rocket :
        Activity;

      return {
        stage: maxStage,
        label,
        subStep,
        icon,
        isFinished,
        isFailed,
      };
    }

    let maxStage = 1;
    let label = 'Preparing Pre-flight & Git State';
    let subStep = 'Initializing pre-flight environment';

    // Stage 1: SemVer, Git & Pre-flight
    if (/\[Stage 1\/5\]|Pre-build validation|Executing guided SemVer bump|TypeScript|database backup/i.test(fullText)) {
      maxStage = 1;
      label = 'Pre-flight & TypeScript Validation';
      subStep = /SemVer bump/i.test(fullText)
        ? 'Executing SemVer Bump & Git Provenance'
        : 'Compiling TypeScript (tsc --noEmit)';
    }

    // Stage 2: Multi-stage Docker Buildx build
    if (/\[Stage 2\/5\]|Cross-compiling Docker image|Building and packaging Docker image|docker buildx build|RUN apk|RUN npm|DONE|transferring context|CACHED/i.test(fullText)) {
      maxStage = 2;
      label = 'Building Docker Image (Buildx)';
      const tail = lines.slice(-20).join(' ');
      if (/npm run build|Creating an optimized production build|Compiled successfully/i.test(tail)) {
        subStep = 'Next.js App Build (npm run build)';
      } else if (/npm (?:ci|install)|apk add/i.test(tail)) {
        subStep = 'Installing Dependencies (npm ci)';
      } else if (/exporting to image|exporting to docker image format|writing image|saving/i.test(tail)) {
        subStep = 'Exporting Container Archive to Tar';
      } else if (/transferring context/i.test(tail)) {
        subStep = 'Transferring Build Context';
      } else {
        subStep = 'Compiling ARM64 Container Layers';
      }
    }

    // Stage 3: SSH staging & SCP image transfer
    if (/\[Stage 3\/5\]|\[Stage 4\/5\]|Remote pre-flight|Staging image archive|Files staged at|Preparing remote environment|Uploading archive and configurations|Files staged on server|Invoke-PscpUpload|pscp|scp\.exe/i.test(fullText)) {
      maxStage = 3;
      label = 'Transferring Image to DietPi (SCP)';
      const tail = lines.slice(-20).join(' ');
      if (/Uploading archive|Staging image archive|tar|pscp|scp/i.test(tail)) {
        subStep = 'Uploading Docker Tar via SCP to Host';
      } else if (/lighttpd|pre-flight/i.test(tail)) {
        subStep = 'Configuring Ingress Proxy (Lighttpd)';
      } else {
        subStep = 'Staging Artifacts on DietPi';
      }
    }

    // Stage 4: Rolling container swap & zero-downtime startup
    if (/\[Stage 5\/5\]|Executing transactional container deployment|Capturing pre-deploy SQLite snapshot|Pre-deploy snapshot secured|Container .* swapped to|Executing deployment|Deploying container on remote server|docker load|docker compose up|container is live/i.test(fullText)) {
      maxStage = 4;
      label = 'Rolling Container Swap';
      const tail = lines.slice(-20).join(' ');
      if (/pre-deploy.*snapshot/i.test(tail)) {
        subStep = 'Capturing Pre-Deploy SQLite Snapshot';
      } else if (/docker load/i.test(tail)) {
        subStep = 'Loading Tar into Docker Engine';
      } else if (/docker compose up|Recreate|CONTAINER_STARTED|swapped to/i.test(tail)) {
        subStep = 'Starting New Container Instance';
      } else if (/retention|prune/i.test(tail)) {
        subStep = 'Pruning Old Tags (N-3 Retention)';
      } else {
        subStep = 'Executing Rolling Container Swap';
      }
    }

    // Stage 5: Post-deployment health verification & probes
    if (/POST-DEPLOYMENT VERIFICATION|SUITE SMOKE TEST VERIFICATION GATE|Checking Health Endpoint|Checking GEMINI_API_KEY|Checking Auth|Checking Write Permissions|Updated local git tag/i.test(fullText)) {
      maxStage = 5;
      label = 'Validating Health Probes';
      const tail = lines.slice(-20).join(' ');
      if (/SUITE SMOKE TEST VERIFICATION GATE|\[smoke/i.test(tail)) {
        subStep = 'Running Suite Smoke Test Gate';
      } else if (/Checking Health Endpoint|Health Endpoint Telemetry|curl.*\/api\/health/i.test(tail)) {
        subStep = 'Probing /api/health Endpoint';
      } else if (/Checking Auth|Checking GEMINI|Write Permissions|Security Profile/i.test(tail)) {
        subStep = 'Verifying Runtime Configuration';
      } else if (/deployed\/prod/i.test(tail)) {
        subStep = 'Updating Local Git Provenance Tag';
      } else {
        subStep = 'Executing Post-Deploy Checks';
      }
    }

    // Stage 6: Manifest sync with PanoramaAuth IdP
    if (/Finalizing deployment transaction|Cleaned up pre-deploy database snapshot|Synchronizing application manifest|Manifest sync triggered|Live endpoint: https|Deployment run completed successfully|Notifying PanoramaAuth to sync|Manifest synchronization triggered|Verify at: https/i.test(fullText) || isFinished) {
      maxStage = 6;
      label = 'Syncing Manifest with IdP';
      subStep = isFinished ? 'All 6 Release Stages Completed' : 'Finalizing & Syncing Manifest';
    }

    const icon =
      maxStage === 1 ? Loader2 :
      maxStage === 2 ? Container :
      maxStage === 3 ? Rocket :
      maxStage === 4 ? RotateCcw :
      maxStage === 5 ? Activity :
      Layers;

    return {
      stage: maxStage,
      label,
      subStep,
      icon,
      isFinished,
      isFailed,
    };
  };

  const activeSelectedDeployJob = selectedApp ? getAppDeployJob(selectedApp.manifest.slug) : undefined;
  const allSelectedAppDeployJobs = selectedApp ? getAllAppDeployJobs(selectedApp.manifest.slug) : [];
  const latestAvailableDeployJob = allSelectedAppDeployJobs[0];
  const trackedJobIdForSelected = selectedApp ? effectiveTrackedJobIds[selectedApp.manifest.slug] : undefined;

  const displayedDeployJob =
    activeSelectedDeployJob ||
    (trackedJobIdForSelected
      ? terminalTabs.find((t) => t.id === trackedJobIdForSelected)
      : undefined);

  const currentStageInfo = getDeploymentStage(displayedDeployJob);

  const openBottomConsole = onOpenInBottomConsole ?? onOpenInConsoleDrawer;

  // Candidate rollback tags: derive from git candidates, known release info, and local head
  interface RollbackTagEntry {
    tag: string;
    label: string;
    committedAt?: string;
    isDeployed?: boolean;
    subject?: string;
  }

  const rollbackTagList: RollbackTagEntry[] = [];

  // 1. Live deployed tag
  if (prodRelease?.image_tag) {
    rollbackTagList.push({
      tag: prodRelease.image_tag,
      label: `${prodRelease.image_tag} (Active Prod)`,
      committedAt: prodRelease.deployed_at,
      isDeployed: true,
      subject: prodRelease.commit_subject,
    });
  }

  // 2. Recent git candidates from composition report
  if (comp?.recent_candidates && comp.recent_candidates.length > 0) {
    for (const c of comp.recent_candidates) {
      if (!rollbackTagList.some((t) => t.tag === c.tag || t.tag === c.commit_short)) {
        rollbackTagList.push({
          tag: c.tag,
          label: `${c.tag} • ${c.commit_short}`,
          committedAt: c.committed_at,
          isDeployed: c.is_deployed,
          subject: c.subject,
        });
      }
    }
  }

  // 3. Fallback local head if not yet in list
  if (comp?.local_head_short && !rollbackTagList.some((t) => t.tag === comp.local_head_short)) {
    rollbackTagList.push({
      tag: comp.local_head_short,
      label: `${comp.local_head_short} (Local HEAD)`,
      isDeployed: false,
      subject: 'Current local git commit',
    });
  }

  return (
    <div className="p-6 w-full min-w-0 max-w-[1920px] mx-auto space-y-5">
      {/* Control Tower Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <GitBranch className="w-5 h-5 text-[var(--color-brand-text)] shrink-0" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight truncate">
              Releases &amp; Drift Control Tower
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              {isEdgeApp
                ? '4-Stage Edge Pipeline — publish verified static builds or re-promote immutable Cloudflare Pages deployments'
                : isWshService
                ? '4-Stage WSH Service Pipeline — CGNAT bridge verification, ARM64 BuildKit export, and lifecycle control'
                : '6-Stage Release Pipeline — cryptographic git-backed deploys and sub-5-second N-3 container rollbacks'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
          {isDeployingAll && onHaltDeployments ? (
            <button
              onClick={onHaltDeployments}
              className="btn-danger text-xs font-bold flex items-center gap-2 animate-pulse whitespace-nowrap flex-shrink-0"
              title="Immediately halt suite deployments and abort any running deployment job"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Halt All Deployments</span>
            </button>
          ) : (
            <button
              onClick={() => setShowDeployAllModal(true)}
              className="btn-primary text-xs font-bold flex items-center gap-2 whitespace-nowrap flex-shrink-0"
            >
              <Layers className="w-4 h-4" />
              <span>Batch / Multi-App Deployment...</span>
            </button>
          )}
        </div>
      </div>

      {/* Consolidated Batch Smoke Failure Attribution & Recovery Panel */}
      {batchSmokeFailureReport && (
        <div className="rounded-2xl border border-rose-500/50 bg-white dark:bg-slate-900 p-5 shadow-lg space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-600 dark:text-rose-400 shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Batch Smoke Gate Failure &amp; Targeted Recovery
                </h3>
                <p className="text-xs text-slate-700 dark:text-slate-300 mt-0.5">
                  {batchSmokeFailureReport.attribution.summaryReason}
                </p>
                {batchSmokeFailureReport.autoRollbackSummary && (
                  <p className="text-xs font-mono text-amber-700 dark:text-amber-300 mt-1">
                    {batchSmokeFailureReport.autoRollbackSummary}
                  </p>
                )}
              </div>
            </div>

            {onDismissBatchSmokeFailure && (
              <button
                type="button"
                onClick={onDismissBatchSmokeFailure}
                className="btn-ghost text-xs p-1.5"
                aria-label="Dismiss batch smoke failure alert"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {batchSmokeFailureReport.attribution.blockedByDbMigrationSlugs.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                <strong>DB_MIGRATION Guard Active:</strong> Automatic rollback was paused for{' '}
                <code className="font-mono font-bold">
                  {batchSmokeFailureReport.attribution.blockedByDbMigrationSlugs.join(', ')}
                </code>{' '}
                to avoid downgrading container code over a forward-migrated SQLite schema.
              </span>
            </div>
          )}

          <div className="space-y-1.5 max-h-40 overflow-y-auto font-mono text-xs">
            {batchSmokeFailureReport.failedChecks.map((fc, idx) => (
              <div
                key={idx}
                className="p-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-rose-500/25 flex items-center justify-between gap-3"
              >
                <span className="font-semibold text-rose-700 dark:text-rose-300 truncate">
                  {fc.name}
                </span>
                <span className="text-[11px] text-slate-600 dark:text-slate-400 truncate max-w-[45%]">
                  {fc.detail}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            {onOpenSmokeTests && (
              <button
                type="button"
                onClick={onOpenSmokeTests}
                className="btn-secondary text-xs flex items-center gap-1.5"
              >
                <Activity className="w-3.5 h-3.5" />
                <span>View in Smoke Tests</span>
              </button>
            )}
            {onRollbackBatchTargets &&
              batchSmokeFailureReport.attribution.rollbackPlan.some((t) => Boolean(t.preBatchTag)) && (
                <button
                  type="button"
                  onClick={() =>
                    onRollbackBatchTargets(
                      batchSmokeFailureReport.attribution.rollbackPlan.filter((t) =>
                        Boolean(t.preBatchTag)
                      )
                    )
                  }
                  disabled={isDeployingAll}
                  className="btn-tonal text-xs font-semibold flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>
                    Rollback Implicated Only (
                    {batchSmokeFailureReport.attribution.rollbackPlan.length})
                  </span>
                </button>
              )}
            {onRollbackBatchTargets &&
              batchSmokeFailureReport.deployedApps.some((d) => Boolean(d.preBatchTag)) && (
                <button
                  type="button"
                  onClick={() =>
                    onRollbackBatchTargets(
                      [...batchSmokeFailureReport.deployedApps]
                        .filter((d) => Boolean(d.preBatchTag))
                        .sort((a, b) => b.deployOrderIndex - a.deployOrderIndex)
                    )
                  }
                  disabled={isDeployingAll}
                  className="btn-danger text-xs font-semibold flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Rollback Entire Batch (Reverse Order)</span>
                </button>
              )}
          </div>
        </div>
      )}

      {/* Master-Detail Deployment Control Tower (Left Sticky Rail + Right Workbench) */}
      <div className="flex flex-col lg:flex-row items-start gap-5 w-full min-w-0">
        <ReleaseFleetRail
          apps={apps}
          selectedSlug={selectedApp?.manifest.slug || ''}
          onSelectApp={handleSelectApp}
          batchSelectedSlugs={batchSelectedSlugs}
          onToggleBatchSlug={toggleBatchSlug}
          onSelectAllBehindBatch={selectAllBehindForBatch}
          onClearBatchSelection={() => setBatchSelectedSlugs(new Set())}
          onOpenBatchDeploy={() => setShowDeployAllModal(true)}
          onInspectApp={(app) => setInspectApp(app)}
          getAppDeployJob={getAppDeployJob}
          isInitialSyncComplete={isInitialSyncComplete}
          networkPosture={networkPosture}
          isDeployingAll={isDeployingAll}
        />

      {selectedApp && (
        <div className="flex-1 min-w-0 w-full space-y-4">
          {/* Active Production Deployment Header Card */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 pb-3.5 mb-3.5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Server className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                      {isWshService ? 'Active WSH Service Container' : 'Active Production Release'}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold font-mono ${
                        isHealthy
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                          : isOptionalNotDeployedService
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                          : 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      <Activity className="w-3 h-3" />
                      {isWshService
                        ? isOptionalNotDeployedService
                          ? 'NOT DEPLOYED'
                          : isHealthy
                          ? 'RUNNING'
                          : 'STOPPED'
                        : selectedApp.health?.status?.toUpperCase() || 'UNREACHABLE'}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mt-0.5">
                    {selectedApp.manifest.displayName}
                    {isWshService ? (
                      <span className="text-xs font-mono font-normal text-slate-500 dark:text-slate-400 tabular-nums">
                        ({selectedApp.manifest.service?.bindIp || '172.25.25.5'}:{selectedApp.manifest.port}/
                        {selectedApp.manifest.service?.protocol || 'udp'})
                      </span>
                    ) : (
                      <span className="text-xs font-mono font-normal text-slate-400">
                        ({selectedApp.manifest.basePath})
                      </span>
                    )}
                  </h3>
                </div>
              </div>

              {isWshService ? (
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
                  <span className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700/60">
                    Bind:{' '}
                    <CopyableValue
                      value={`${selectedApp.manifest.service?.bindIp || '172.25.25.5'}:${selectedApp.manifest.port}`}
                      label="service bind endpoint"
                    />
                  </span>
                  {selectedApp.manifest.service?.networkSubnet && (
                    <span className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700/60">
                      {selectedApp.manifest.service.networkName}{' '}
                      (<CopyableValue
                        value={selectedApp.manifest.service.networkSubnet}
                        label="service bridge subnet"
                      />)
                    </span>
                  )}
                </div>
              ) : (
                <a
                  href={appPublicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700/60 transition-colors"
                >
                  <Globe className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Open in Production</span>
                  <ExternalLink className="w-3 h-3 text-slate-500" />
                </a>
              )}
            </div>

            {isWshService ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono tabular-nums">
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80">
                  <span className="text-[10px] uppercase font-sans text-slate-500 block mb-1">Container Status</span>
                  <div className="text-slate-900 dark:text-slate-100 font-bold text-sm truncate">
                    {matchedServiceContainer
                      ? matchedServiceContainer.Status || matchedServiceContainer.State
                      : 'Not Deployed Yet'}
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-1 truncate">
                    Container: {selectedApp.manifest.containerName || selectedApp.manifest.slug}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80">
                  <span className="text-[10px] uppercase font-sans text-slate-500 block mb-1">Bind Target</span>
                  <div className="text-slate-900 dark:text-slate-100 font-bold text-sm">
                    <CopyableValue
                      value={`${selectedApp.manifest.service?.bindIp || '172.25.25.5'}:${selectedApp.manifest.port}`}
                      label="bind endpoint"
                    />
                    /{selectedApp.manifest.service?.protocol || 'udp'}
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-1 truncate">
                    Health: docker-container (non-HTTP)
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80">
                  <span className="text-[10px] uppercase font-sans text-slate-500 block mb-1">CGNAT Isolation Bridge</span>
                  <div className="text-slate-900 dark:text-slate-100 font-bold text-sm truncate">
                    {selectedApp.manifest.service?.networkName || selectedApp.manifest.composeProject}
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-1 truncate">
                    Subnet:{' '}
                    <CopyableValue
                      value={selectedApp.manifest.service?.networkSubnet || '100.64.251.0/24'}
                      label="CGNAT subnet"
                    />
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80">
                  <span className="text-[10px] uppercase font-sans text-slate-500 block mb-1">Host Log &amp; Env</span>
                  <div className="text-slate-900 dark:text-slate-100 font-semibold truncate" title={selectedApp.manifest.service?.hostLogPath || selectedApp.manifest.dataVolume}>
                    {selectedApp.manifest.service?.hostLogPath || selectedApp.manifest.dataVolume}
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-1 truncate" title={selectedApp.manifest.service?.hostEnvPath || selectedApp.manifest.remoteAppRoot}>
                    Env: {selectedApp.manifest.service?.hostEnvPath || selectedApp.manifest.remoteAppRoot}
                  </span>
                </div>
              </div>
            ) : prodRelease || selectedApp.health ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono">
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80">
                  <span className="text-[10px] uppercase font-sans text-slate-500 block mb-1">Production Version</span>
                  <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100 font-bold text-sm">
                    <Tag className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />
                    <span>{prodRelease?.semver || selectedApp.health?.version || 'v1.0.0 (legacy)'}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-1 truncate" title={prodRelease?.image_tag || 'N/A'}>
                    Tag: {prodRelease?.image_tag || 'unversioned'}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80">
                  <span className="text-[10px] uppercase font-sans text-slate-500 block mb-1">Deployed Commit (SHA)</span>
                  <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100 font-bold text-sm">
                    <GitBranch className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />
                    <span>{prodRelease?.commit_short || (comp?.prod_sha ? comp.prod_sha.substring(0, 7) : 'None')}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-1 truncate" title={prodRelease?.commit_subject || 'No commit message'}>
                    {prodRelease?.commit_subject || (prodRelease?.dirty ? 'DIRTY PRODUCTION BUILD' : 'Clean git tree')}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80">
                  <span className="text-[10px] uppercase font-sans text-slate-500 block mb-1">Deployed At</span>
                  <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100 font-medium">
                    <Clock className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
                    <span className="truncate">{formatRelativeTime(prodRelease?.deployed_at || selectedApp.health?.deployed_at)}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-1 truncate" title={formatLocalDateTime(prodRelease?.deployed_at || selectedApp.health?.deployed_at)}>
                    {formatLocalDateTime(prodRelease?.deployed_at || selectedApp.health?.deployed_at)}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80">
                  <span className="text-[10px] uppercase font-sans text-slate-500 block mb-1">Database & Lock SHA</span>
                  <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100 font-medium truncate">
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">DB:</span>
                    <span>{selectedApp.health?.database || 'connected'}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-1 truncate" title={prodRelease?.deps_lock_sha256 || 'N/A'}>
                    Lock: {prodRelease?.deps_lock_sha256 ? prodRelease.deps_lock_sha256.substring(0, 10) : 'standard'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-center gap-3">
                <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
                <div>
                  <p className="font-semibold">Health & Telemetry Endpoint Probing Unreachable</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Could not query <code className="text-amber-300">{appPublicUrl}{selectedApp.manifest.sre?.healthEndpoint || '/api/health'}</code>. The container may be offline, starting up, or using legacy unstamped release routes.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Slim 1-Row Build Efficiency Strip (replaces duplicate 290-line card) */}
          {!isWshService && (
            <BuildEfficiencyStrip
              appSlug={selectedApp.manifest.slug}
              resolvedTelemetry={selectedResolvedTelemetry}
              healthBadge={selectedHealthBadge}
              targets={selectedTelemetryTargets}
              onOpenTelemetry={onOpenTelemetry}
            />
          )}

          {/* Position 5: Decoupled Deployment Stage Stepper (Output Console Dock handles raw logs) */}
          {(() => {
            const stageTab = displayedDeployJob ?? latestAvailableDeployJob;
            const stageInfo = getDeploymentStage(stageTab);
            if (!stageTab || !stageInfo) return null;

            const stageSteps = isWshService
              ? [
                  { num: 1, name: 'Tests & Types', key: 'tests' },
                  { num: 2, name: 'ARM64 Image', key: 'build' },
                  { num: 3, name: 'Upload & Firewall', key: 'upload' },
                  { num: 4, name: 'Start & Verify', key: 'start' },
                ]
              : isEdgeApp
              ? [
                  { num: 1, name: 'Typecheck & Tests', key: 'tests' },
                  { num: 2, name: 'Static Build & Stamp', key: 'build' },
                  { num: 3, name: 'Cloudflare Publish', key: 'publish' },
                  { num: 4, name: 'Stealth & Route Gate', key: 'verify' },
                ]
              : [
                  { num: 1, name: 'SemVer & Git', key: 'semver' },
                  { num: 2, name: 'Docker Buildx', key: 'build' },
                  { num: 3, name: 'SSH & SCP', key: 'scp' },
                  { num: 4, name: 'Rolling Swap', key: 'swap' },
                  { num: 5, name: 'Health Probe', key: 'health' },
                  { num: 6, name: 'Manifest Sync', key: 'sync' },
                ];

            return (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <Terminal className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm truncate">
                      {stageTab.title}
                    </h3>
                    <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                      ({stageTab.lines.length} lines)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {stageTab.isRunning && stageTab.abortable !== false && onAbortJob && (
                      <button
                        type="button"
                        onClick={() => onAbortJob(stageTab.id)}
                        className="btn-danger text-xs flex items-center gap-1.5"
                      >
                        <Square className="w-3 h-3 fill-current" />
                        <span>Abort</span>
                      </button>
                    )}
                    {openBottomConsole && (
                      <button
                        type="button"
                        onClick={() => openBottomConsole(stageTab.id)}
                        className="btn-secondary text-xs flex items-center gap-1.5"
                      >
                        <Terminal className="w-3.5 h-3.5 text-[var(--color-brand-text)]" />
                        <span>View Live Log ▴</span>
                      </button>
                    )}
                  </div>
                </div>

                {'isSingleStep' in stageInfo && stageInfo.isSingleStep ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-slate-700 dark:text-slate-200 font-semibold">
                      {stageInfo.label}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                        stageInfo.isFinished
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                          : stageInfo.isFailed
                          ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30'
                          : 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30'
                      }`}
                    >
                      {stageInfo.subStep}
                    </span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-slate-600 dark:text-slate-300 font-medium">
                        Stage {stageInfo.stage} of {stageSteps.length}:{' '}
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {stageInfo.label}
                        </span>
                      </span>
                      {stageInfo.subStep && (
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                            stageInfo.isFinished
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                              : stageInfo.isFailed
                              ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30'
                              : 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30'
                          }`}
                        >
                          {stageInfo.subStep}
                        </span>
                      )}
                    </div>

                    <div className={`grid grid-cols-2 ${isEdgeApp || isWshService ? 'md:grid-cols-4' : 'md:grid-cols-6'} gap-2 text-xs font-mono`}>
                      {stageSteps.map((st) => {
                        const currentStageNum = stageInfo.stage || 1;
                        const isDone = stageInfo.isFinished || currentStageNum > st.num;
                        const isActive = !stageInfo.isFinished && !stageInfo.isFailed && currentStageNum === st.num;
                        const isFailed = stageInfo.isFailed && currentStageNum === st.num;

                        return (
                          <div
                            key={st.num}
                            className={`p-2.5 rounded-lg border flex flex-col gap-1 transition-all ${
                              isFailed
                                ? 'bg-rose-500/10 border-rose-500/50 text-rose-600 dark:text-rose-300'
                                : isActive
                                ? 'bg-amber-500/15 border-amber-500/50 text-amber-700 dark:text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                                : isDone
                                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                                : 'bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 text-slate-500'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              {isFailed ? (
                                <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                              ) : isActive ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />
                              ) : isDone ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              ) : (
                                <span className="w-3.5 h-3.5 rounded-full border border-slate-400 dark:border-slate-700 flex items-center justify-center text-[10px] shrink-0">
                                  {st.num}
                                </span>
                              )}
                              <span className="truncate font-semibold">{st.name}</span>
                            </div>
                            {isActive && stageInfo.subStep && (
                              <span className="text-[10px] text-amber-600 dark:text-amber-400/90 truncate font-mono">
                                {stageInfo.subStep}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Position 6: Above-the-Fold Side-by-Side Deploy & Instant Rollback Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
            <div className="xl:col-span-7 space-y-4">
              {/* Release Composition & Deploy Form */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                    Release Composition & Local Changes
                  </h3>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">
                    Local HEAD {comp?.local_head_short || 'unknown'} • Branch {comp?.local_branch || 'main'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setInspectApp(selectedApp)}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 transition-colors shadow-xs"
                    title={`Inspect full git diff and file list for ${selectedApp.manifest.displayName}`}
                  >
                    <Eye className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                    <span>Inspect Diff</span>
                  </button>
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold border font-mono ${
                      comp?.state === 'DIRTY_PROD' || comp?.state === 'PROD_UNREACHABLE' || comp?.state === 'DIVERGED'
                        ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30'
                        : comp?.state === 'LOCAL_WIP' || comp?.state === 'AHEAD'
                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                        : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                    }`}
                  >
                    {comp?.state || 'IN_SYNC'}
                  </span>
                </div>
              </div>

              {/* Blast-Radius Badges */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-500">Blast Radius:</span>
                {comp?.blast_radius_badges && comp.blast_radius_badges.length > 0 ? (
                  comp.blast_radius_badges.map((b, idx) => (
                    <BlastRadiusBadge key={idx} badge={b} size="sm" />
                  ))
                ) : (
                  <span className="text-xs text-slate-400 font-mono">No sensitive boundaries detected</span>
                )}
              </div>

              {/* Undeployed Commits & Dirty Working Tree Files */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-400">
                  Pending Commits ({comp?.undeployed_commits.length || 0}):
                </p>
                {comp?.undeployed_commits && comp.undeployed_commits.length > 0 ? (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto font-mono text-xs">
                    {comp.undeployed_commits.map((c, idx) => (
                      <div key={idx} className="p-2 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{c.sha}</span>
                          <span className="text-slate-800 dark:text-slate-300 truncate">{c.subject}</span>
                        </div>
                        <span className="text-slate-500 text-[10px] shrink-0">{c.author}</span>
                      </div>
                    ))}
                  </div>
                ) : !comp?.local_dirty ? (
                  <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80 text-center text-xs text-slate-500 font-mono flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    Local working tree is clean and synchronized with production.
                  </div>
                ) : null}

                {comp?.dirty_files && comp.dirty_files.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                      Uncommitted Working Tree Files ({comp.dirty_files.length}):
                    </p>
                    <div className="space-y-1 max-h-36 overflow-y-auto font-mono text-xs">
                      {comp.dirty_files.map((f, idx) => (
                        <div key={idx} className="p-2 rounded bg-amber-500/10 border border-amber-500/20 flex items-center gap-2">
                          <span className="text-amber-600 dark:text-amber-400 font-bold w-5 shrink-0">{f.status}</span>
                          <span className="text-slate-800 dark:text-slate-200 truncate">{f.path}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Deploy Trigger Form */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    {isWshService
                      ? 'Stage 4: Orchestrate WSH Service Deployment'
                      : isEdgeApp
                      ? 'Stage 4: Orchestrate Cloudflare Pages Release'
                      : 'Stage 6: Orchestrate Production Deployment'}
                  </h4>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                      Triggers {selectedApp.manifest.sre.deployScript || (isEdgeApp ? 'deploy-cloudflare-pages.ps1' : 'deploy-docker.ps1')}
                    </span>
                  </div>
                </div>

                {isWshService && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs font-mono tabular-nums">
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-0.5">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-sans">Bind Target</div>
                      <div className="text-slate-800 dark:text-slate-200 font-semibold">
                        <CopyableValue
                          value={`${selectedApp.manifest.service?.bindIp || '172.25.25.5'}:${selectedApp.manifest.port}`}
                          label="bind endpoint"
                        />
                        /{selectedApp.manifest.service?.protocol || 'udp'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {selectedApp.manifest.service?.networkName || selectedApp.manifest.composeProject} (
                        <CopyableValue
                          value={selectedApp.manifest.service?.networkSubnet || '100.64.251.0/24'}
                          label="CGNAT subnet"
                        />
                        )
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-0.5">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-sans">
                        Allowed Sources (.env.siem / config.json)
                      </div>
                      <div className="text-slate-800 dark:text-slate-200 font-semibold flex flex-wrap gap-x-1.5 gap-y-0.5">
                        {((siemEnvConfig?.allowedIps || siemEnvConfig?.suggestedIps || '172.25.25.1,10.10.1.1,10.10.1.2')
                          .split(/[,\s]+/)
                          .map((s) => s.trim())
                          .filter(Boolean)).map((ip, i) => (
                          <CopyableValue
                            key={`${ip}-${i}`}
                            value={ip}
                            label="allowed syslog source IP"
                          />
                        ))}
                      </div>
                      <div className="text-[11px] text-slate-500">Locked in DOCKER-USER &amp; collector</div>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-0.5">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-sans">Host Output Log</div>
                      <div className="text-slate-800 dark:text-slate-200 font-semibold truncate">
                        {selectedApp.manifest.service?.hostLogPath || '/var/data/unifi-siem/unifi-siem.log'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {siemEnvConfig?.exists ? 'Config: Preconfigured' : 'Config: File-backed'} • NDJSON
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-4 text-xs">
                  {isEdgeApp && (
                    <div className="flex items-center gap-2 min-w-[260px]">
                      <span className="text-slate-600 dark:text-slate-400 whitespace-nowrap">Deploy Mode:</span>
                      <div className="flex-1">
                        <CustomSelect
                          value={edgeDeployMode}
                          options={[
                            { value: 'GitCi', label: 'Git CI Push (origin/main)' },
                            { value: 'Wrangler', label: 'Direct Wrangler Upload' },
                          ]}
                          onChange={(val) => setEdgeDeployMode(val as 'GitCi' | 'Wrangler')}
                        />
                      </div>
                    </div>
                  )}

                  {!isWshService && (
                    <div className="flex items-center gap-2 min-w-[240px]">
                      <span className="text-slate-600 dark:text-slate-400 whitespace-nowrap">SemVer Bump:</span>
                      <div className="flex-1">
                        <CustomSelect
                          value={bumpVersion}
                          options={[
                            { value: 'none', label: 'none (keep current)' },
                            { value: 'patch', label: 'patch (0.0.+1)' },
                            { value: 'minor', label: 'minor (0.+1.0)' },
                            { value: 'major', label: 'major (+1.0.0)' },
                          ]}
                          onChange={(val) => setBumpVersion(val)}
                        />
                      </div>
                    </div>
                  )}

                  <ToggleSwitch
                    size="sm"
                    checked={allowDirty}
                    onChange={setAllowDirty}
                    disabled={!!activeSelectedDeployJob}
                    label="Allow dirty uncommitted tree"
                  />
                </div>

                {isWshService && (onTriggerServiceAction || onReapplyHardening) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {onTriggerServiceAction && selectedApp.manifest.sre.supportsVerifyLocal !== false && (
                      <button
                        type="button"
                        onClick={() => onTriggerServiceAction(selectedApp, 'verify_local')}
                        disabled={!!activeSelectedDeployJob}
                        className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                        title="Run local TypeScript, Vitest, compose hardening, and ARM64 Docker BuildKit check (zero SSH)"
                      >
                        <Terminal className="w-3.5 h-3.5 text-[var(--color-accent-text)]" />
                        <span>Verify Local (-VerifyLocal)</span>
                      </button>
                    )}
                    {onTriggerServiceAction && selectedApp.manifest.sre.supportsDryRun !== false && (
                      <button
                        type="button"
                        onClick={() => onTriggerServiceAction(selectedApp, 'test')}
                        disabled={!!activeSelectedDeployJob}
                        className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                        title="Run read-only SSH dry-run preflight against WSH"
                      >
                        <Terminal className="w-3.5 h-3.5" />
                        <span>Dry-Run (-Test)</span>
                      </button>
                    )}
                    {onTriggerServiceAction && selectedApp.manifest.sre.supportsStatus !== false && (
                      <button
                        type="button"
                        onClick={() => onTriggerServiceAction(selectedApp, 'status')}
                        disabled={!!activeSelectedDeployJob}
                        className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                        title="Query remote service container state and recent log lines on WSH"
                      >
                        <Activity className="w-3.5 h-3.5" />
                        <span>Status (-Status)</span>
                      </button>
                    )}
                    {onReapplyHardening && selectedApp.manifest.service?.requiresWshFirewall && (
                      <button
                        type="button"
                        onClick={onReapplyHardening}
                        disabled={!!activeSelectedDeployJob}
                        className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                        title="Synchronize /usr/local/bin/panorama-firewall.sh on WSH for UDP 5514 source allowlisting"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Re-Apply WSH Firewall</span>
                      </button>
                    )}
                  </div>
                )}

                <button
                  onClick={() =>
                    onTriggerDeploy(
                      selectedApp,
                      isWshService ? 'none' : bumpVersion,
                      allowDirty,
                      isEdgeApp ? edgeDeployMode : undefined
                    )
                  }
                  disabled={!!activeSelectedDeployJob}
                  className={
                    activeSelectedDeployJob
                      ? 'w-full min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 cursor-not-allowed'
                      : 'w-full btn-primary text-xs font-bold justify-center'
                  }
                >
                  {activeSelectedDeployJob ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-amber-600 dark:text-amber-300" />
                      <span>Release in Progress ({currentStageInfo?.label || 'Running Pipeline'})...</span>
                    </>
                  ) : (
                    <>
                      {isWshService ? <Play className="w-4 h-4" /> : <Rocket className="w-4 h-4" />}
                      <span>
                        {isWshService
                          ? `Buildx & Deploy Service (${selectedApp.manifest.sre.deployScript || 'deploy-unifi-siem.ps1'})`
                          : isEdgeApp
                          ? 'Publish to Cloudflare Pages (deploy-cloudflare-pages.ps1)'
                          : 'Buildx & Deploy to Production (deploy-docker.ps1)'}
                      </span>
                    </>
                  )}
                </button>
              </div>
              </div>
            </div>

            {/* Instant Rollback / Service Lifecycle Panel */}
            <div className="xl:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex flex-col justify-between space-y-4">
              {isWshService ? (
                <>
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-[var(--color-brand-text)]" />
                        Service Lifecycle &amp; Network Prerequisites
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        Dedicated non-HTTP WSH container service on an isolated CGNAT bridge with strict <code className="font-mono">DOCKER-USER</code> ingress locking.
                      </p>
                    </div>

                    <div className="space-y-2 text-xs font-mono tabular-nums">
                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                        <span className="text-slate-500 font-sans">WSH Container</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {matchedServiceContainer
                            ? matchedServiceContainer.Status || matchedServiceContainer.State
                            : 'Not Deployed'}
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                        <span className="text-slate-500 font-sans">Isolated Network</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {selectedApp.manifest.service?.networkName || 'unifi-siem-net'} (
                          <CopyableValue
                            value={selectedApp.manifest.service?.networkSubnet || '100.64.251.0/24'}
                            label="subnet CIDR"
                          />
                          )
                        </span>
                      </div>
                      {selectedApp.manifest.service?.hostEnvPath && (
                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                          <span className="text-slate-500 font-sans">Remote Env File</span>
                          <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {selectedApp.manifest.service.hostEnvPath}
                          </span>
                        </div>
                      )}
                    </div>

                    {selectedApp.manifest.slug === 'unifi-siem' && (
                      <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-2">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          UniFi Network Prerequisites (After Deploy)
                        </div>
                        <ol className="list-decimal list-inside space-y-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-400 leading-relaxed">
                          <li>
                            Policy Engine → Zones: Allow{' '}
                            <CopyableValue value="10.10.1.2" label="CloudKey IP" className="text-slate-900 dark:text-slate-100 font-semibold" /> →{' '}
                            <CopyableValue value="172.25.25.5" label="WSH IP" className="text-slate-900 dark:text-slate-100 font-semibold" /> UDP 5514 (Auto Allow Return Traffic: OFF)
                          </li>
                          <li>
                            CyberSecure → Traffic Logging → Activity Logging (Syslog): SIEM Server{' '}
                            <CopyableValue value="172.25.25.5:5514" label="SIEM endpoint" className="text-slate-900 dark:text-slate-100 font-semibold" />
                          </li>
                        </ol>
                      </div>
                    )}

                    {!isOptionalNotDeployedService && (
                      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-800 dark:text-amber-300">
                        <p className="text-[11px] leading-relaxed">
                          Stateless UDP collectors do not keep N-3 database rollback tags; redeploy cleanly from Git HEAD or stop the container below.
                        </p>
                      </div>
                    )}
                  </div>

                  {matchedServiceContainer && onTriggerServiceAction && selectedApp.manifest.sre.supportsStop !== false ? (
                    <button
                      type="button"
                      onClick={() => onTriggerServiceAction(selectedApp, 'stop')}
                      disabled={!!activeSelectedDeployJob}
                      className="w-full btn-danger text-xs font-bold justify-center mt-auto whitespace-nowrap flex-shrink-0"
                    >
                      <Square className="w-4 h-4" />
                      <span>Stop Service Container (-Stop)</span>
                    </button>
                  ) : (
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-500 text-center">
                      Deploy service on the left to enable remote Stop control.
                    </div>
                  )}
                </>
              ) : isEdgeApp ? (
                <>
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                        <RotateCcw className="w-4 h-4 text-rose-400" />
                        Cloudflare Deployment History & Rollback
                      </h3>
                      <p className="text-xs text-slate-500 mt-1">
                        Re-promotes an immutable Cloudflare Pages deployment ID across the global edge via Wrangler.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-slate-400">Target Cloudflare Deployment ID:</label>
                      <input
                        type="text"
                        placeholder="e.g. a1b2c3d4-5678-90ef-..."
                        value={rollbackTag}
                        onChange={(e) => setRollbackTag(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg text-xs font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-rose-500"
                      />

                      {cfDeploymentsLoading ? (
                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 flex items-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
                          <span>Loading Cloudflare Pages deployments...</span>
                        </div>
                      ) : cfDeploymentsError ? (
                        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-700 dark:text-amber-300 font-mono">
                          Unable to fetch deployments via Wrangler: {cfDeploymentsError}
                        </div>
                      ) : cfDeployments.length > 0 ? (
                        <div className="pt-2">
                          <span className="text-[10px] text-slate-500 uppercase block mb-1.5 font-semibold">
                            Recent Edge Deployments ({cfDeployments.length}):
                          </span>
                          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                            {cfDeployments.map((dep) => (
                              <button
                                key={dep.id}
                                type="button"
                                onClick={() => setRollbackTag(dep.id)}
                                className={`w-full text-left p-2 rounded text-xs font-mono border transition-all flex items-start justify-between gap-2 ${
                                  rollbackTag === dep.id
                                    ? 'bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-200 ring-1 ring-rose-500/50'
                                    : 'bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 font-bold truncate">
                                    <ArrowRight className="w-3 h-3 text-rose-400 shrink-0" />
                                    <span className="truncate">{dep.short_id || dep.id.slice(0, 8)}</span>
                                    <span className="px-1 py-0.2 rounded text-[9px] font-mono bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
                                      {dep.environment}
                                    </span>
                                    {dep.status && ['failure', 'failed', 'canceled', 'cancelled'].includes(dep.status.toLowerCase()) && (
                                      <span className="px-1 py-0.2 rounded text-[9px] font-mono bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 shrink-0">
                                        FAILED
                                      </span>
                                    )}
                                    {dep.is_active && (
                                      <span className="px-1 py-0.2 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shrink-0">
                                        LIVE
                                      </span>
                                    )}
                                  </div>
                                  {(dep.commit_message || dep.branch) && (
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                      {dep.branch ? `[${dep.branch}] ` : ''}{dep.commit_message || dep.url}
                                    </p>
                                  )}
                                </div>
                                {dep.created_on && (() => {
                                  const isIsoTimestamp = !Number.isNaN(Date.parse(dep.created_on));
                                  return (
                                    <div className="text-right shrink-0">
                                      <span className="text-[10px] text-slate-400 block font-sans">
                                        {isIsoTimestamp ? formatRelativeTime(dep.created_on) : dep.created_on}
                                      </span>
                                      {isIsoTimestamp && (
                                        <span className="text-[9px] text-slate-500 block">
                                          {formatLocalDateTime(dep.created_on)}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })()}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 font-mono">
                          No deployments returned yet for {selectedApp.manifest.cloudflare?.pagesProject || 'parakith-site'}.
                        </p>
                      )}
                    </div>

                    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-400">
                        <ShieldAlert className="w-4 h-4 shrink-0" />
                        Edge Rollback & Stealth Secret Notice
                      </div>
                      <p className="text-[11px] leading-relaxed">
                        Cloudflare Pages rollbacks re-promote the selected build immediately; D1 schema changes are not reverted automatically and require <code className="font-mono">PARAKITH_PROBE_SECRET</code> to remain configured.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => onTriggerRollback(selectedApp, rollbackTag)}
                    disabled={!rollbackTag.trim() || !!activeSelectedDeployJob}
                    className="w-full btn-danger text-xs font-bold justify-center mt-auto"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Rollback Cloudflare Deployment
                  </button>
                </>
              ) : (
                <>
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                        <RotateCcw className="w-4 h-4 text-rose-500 dark:text-rose-400" />
                        Instant Rollback Panel
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        Instantly swaps the running WSH container to a previous N-3 cached image tag in under 5 seconds.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Rollback Target Tag:</label>
                      <input
                        type="text"
                        placeholder="e.g. 1.0.0-7bae144"
                        value={rollbackTag}
                        onChange={(e) => setRollbackTag(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl text-xs font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-rose-500"
                      />

                      {/* Candidate Quick-Fill Tags with Date and Status */}
                      {rollbackTagList.length > 0 && (
                        <div className="pt-2">
                          <span className="text-[10px] text-slate-600 dark:text-slate-400 uppercase block mb-1.5 font-semibold">
                            Known Release & Rollback Tags:
                          </span>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                            {rollbackTagList.map((entry) => (
                              <button
                                key={entry.tag}
                                type="button"
                                onClick={() => setRollbackTag(entry.tag)}
                                className={`w-full text-left p-2 rounded-xl text-xs font-mono border transition-all flex items-start justify-between gap-2 cursor-pointer ${
                                  rollbackTag === entry.tag
                                    ? 'bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-200 ring-1 ring-rose-500/50'
                                    : 'bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 font-bold truncate tabular-nums">
                                    <ArrowRight className="w-3 h-3 text-rose-500 dark:text-rose-400 shrink-0" />
                                    <span className="truncate">{entry.tag}</span>
                                    {entry.isDeployed && (
                                      <span className="px-1 py-0.2 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 shrink-0">
                                        LIVE
                                      </span>
                                    )}
                                  </div>
                                  {entry.subject && (
                                    <p className="text-[10px] text-slate-600 dark:text-slate-400 truncate mt-0.5">
                                      {entry.subject}
                                    </p>
                                  )}
                                </div>

                                {entry.committedAt && (
                                  <div className="text-right shrink-0 tabular-nums">
                                    <span className="text-[10px] text-slate-600 dark:text-slate-400 block font-sans">
                                      {formatRelativeTime(entry.committedAt)}
                                    </span>
                                    <span className="text-[9px] text-slate-500 block">
                                      {formatLocalDateTime(entry.committedAt)}
                                    </span>
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-700 dark:text-rose-300 space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-rose-800 dark:text-rose-400">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        Schema Safety Gate
                      </div>
                      <p className="text-[11px] leading-relaxed">
                        Rollbacks that downgrade SQLite schema versions are automatically blocked to prevent data corruption.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => onTriggerRollback(selectedApp, rollbackTag)}
                    disabled={!rollbackTag.trim()}
                    className="w-full btn-danger text-xs font-bold justify-center mt-auto"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Swap Container Tag Now
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Batch / Multi-App Deployment Orchestrator Modal */}
      <BatchDeployModal
        isOpen={showDeployAllModal}
        apps={apps}
        initialSelectedSlugs={
          batchSelectedSlugs.size > 0 ? Array.from(batchSelectedSlugs) : undefined
        }
        isInitialSyncComplete={isInitialSyncComplete}
        networkPosture={networkPosture}
        onConfirm={(options: BatchDeployOptions) => {
          setShowDeployAllModal(false);
          setBatchSelectedSlugs(new Set());
          onTriggerDeployAll(
            options.selectedApps,
            options.bumpVersion,
            options.allowDirty,
            options.autoRollbackOnSmokeFailure
          );
        }}
        onCancel={() => setShowDeployAllModal(false)}
      />

      {/* Release Composition & Diff Inspector Drawer */}
      <ReleaseCompositionDrawer
        app={inspectApp}
        isOpen={!!inspectApp}
        onClose={() => setInspectApp(null)}
      />
    </div>
  );
}
