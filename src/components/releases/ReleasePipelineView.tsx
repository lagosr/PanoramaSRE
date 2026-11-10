import { useState, useEffect, useRef } from 'react';
import { DiscoveredApp } from '../../lib/types';
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
  ArrowRight,
  Loader2,
  Container,
  Check,
  Square,
  Eye,
  XCircle,
  Terminal,
  Copy,
  ChevronDown,
  ChevronUp,
  Trash2,
  X
} from 'lucide-react';
import { BatchDeployModal, BatchDeployOptions } from './BatchDeployModal';
import { CustomSelect } from '../ui/CustomSelect';
import { formatLocalDateTime, formatRelativeTime } from '../../lib/formatters';
import { TerminalTab } from '../layout/SreTerminalDrawer';
import { ReleaseCompositionDrawer } from '../hud/ReleaseCompositionDrawer';
import { BlastRadiusBadge } from '../ui/BlastRadiusBadge';
import { formatConsoleLine } from '../layout/ConsoleColorizer';
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
  onOpenInConsoleDrawer?: (jobId: string) => void;
  onCloseTab?: (id: string) => void;
  onClearTab?: (id: string) => void;
  onTriggerDeploy: (app: DiscoveredApp, bump: string, allowDirty: boolean) => void;
  onTriggerDeployAll: (apps: DiscoveredApp[], bump: string, allowDirty: boolean) => void;
  onTriggerRollback: (app: DiscoveredApp, tag: string) => void;
  isDeployingAll?: boolean;
  onHaltDeployments?: () => void;
}

export function ReleasePipelineView({
  apps,
  terminalTabs = [],
  selectedAppSlug: controlledAppSlug,
  onSelectAppSlug,
  trackedDeployJobIds,
  onTrackDeployJob,
  onDismissDeployJob,
  onOpenInConsoleDrawer,
  onCloseTab,
  onClearTab,
  onTriggerDeploy,
  onTriggerDeployAll,
  onTriggerRollback,
  isDeployingAll = false,
  onHaltDeployments,
}: ReleasePipelineViewProps) {
  const [localSelectedAppSlug, setLocalSelectedAppSlug] = useState<string>(apps[0]?.manifest.slug || '');
  const [localTrackedJobIds, setLocalTrackedJobIds] = useState<Record<string, string>>({});
  const [bumpVersion, setBumpVersion] = useState<string>('none');
  const [allowDirty, setAllowDirty] = useState<boolean>(false);
  const [rollbackTag, setRollbackTag] = useState<string>('');
  const [showDeployAllModal, setShowDeployAllModal] = useState<boolean>(false);
  const [inspectApp, setInspectApp] = useState<DiscoveredApp | null>(null);

  const [copied, setCopied] = useState<boolean>(false);
  const [isStreamCollapsed, setIsStreamCollapsed] = useState<boolean>(false);
  const [showLogTerminal, setShowLogTerminal] = useState<boolean>(true);
  const terminalEndRef = useRef<HTMLDivElement>(null);

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

  const handleDismissJob = (slug: string) => {
    setLocalTrackedJobIds((prev) => {
      const next = { ...prev };
      delete next[slug];
      return next;
    });
    onDismissDeployJob?.(slug);
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
  const comp = selectedApp?.composition;
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

    let maxStage = 1;
    let label = 'Preparing Pre-flight & Git State';
    let subStep = 'Initializing pre-flight environment';

    const lines = tab.lines;
    const fullText = lines.join('\n');

    // Stage 1: SemVer, Git & Pre-flight
    if (fullText.includes('TypeScript') || fullText.includes('database backup')) {
      maxStage = 1;
      label = 'Pre-flight & TypeScript Validation';
      subStep = 'Compiling TypeScript (tsc --noEmit)';
    }

    // Stage 2: Multi-stage Docker Buildx build
    if (/Building and packaging Docker image|docker buildx build|RUN apk|RUN npm|DONE|transferring context|CACHED/i.test(fullText)) {
      maxStage = 2;
      label = 'Building Docker Image (Buildx)';
      const tail = lines.slice(-20).join(' ');
      if (/npm run build|Creating an optimized production build|Compiled successfully/i.test(tail)) {
        subStep = 'Next.js App Build (npm run build)';
      } else if (/npm (?:ci|install)|apk add/i.test(tail)) {
        subStep = 'Installing Dependencies (npm ci)';
      } else if (/exporting to image|writing image|saving/i.test(tail)) {
        subStep = 'Exporting Container Archive to Tar';
      } else if (/transferring context/i.test(tail)) {
        subStep = 'Transferring Build Context';
      } else {
        subStep = 'Compiling ARM64 Container Layers';
      }
    }

    // Stage 3: SSH staging & SCP image transfer
    if (/Preparing remote environment|Uploading archive and configurations|Files staged on server|Invoke-PscpUpload|pscp|scp\.exe/i.test(fullText)) {
      maxStage = 3;
      label = 'Transferring Image to DietPi (SCP)';
      const tail = lines.slice(-20).join(' ');
      if (/Uploading archive|tar|pscp|scp/i.test(tail)) {
        subStep = 'Uploading Docker Tar via SCP to Host';
      } else if (/lighttpd/i.test(tail)) {
        subStep = 'Configuring Ingress Proxy (Lighttpd)';
      } else {
        subStep = 'Staging Artifacts on DietPi';
      }
    }

    // Stage 4: Rolling container swap & zero-downtime startup
    if (/Executing deployment|Deploying container on remote server|docker load|docker compose up|container is live/i.test(fullText)) {
      maxStage = 4;
      label = 'Rolling Container Swap';
      const tail = lines.slice(-20).join(' ');
      if (/docker load/i.test(tail)) {
        subStep = 'Loading Tar into Docker Engine';
      } else if (/docker compose up|Recreate/i.test(tail)) {
        subStep = 'Starting New Container Instance';
      } else if (/retention|prune/i.test(tail)) {
        subStep = 'Pruning Old Tags (N-3 Retention)';
      } else {
        subStep = 'Executing Rolling Container Swap';
      }
    }

    // Stage 5: Post-deployment health verification & probes
    if (/POST-DEPLOYMENT VERIFICATION|Checking Health Endpoint|Checking GEMINI_API_KEY|Checking Auth|Checking Write Permissions|Updated local git tag/i.test(fullText)) {
      maxStage = 5;
      label = 'Validating Health Probes';
      const tail = lines.slice(-20).join(' ');
      if (/Checking Health Endpoint|curl.*\/api\/health/i.test(tail)) {
        subStep = 'Probing /api/health Endpoint';
      } else if (/Checking Auth|Checking GEMINI|Write Permissions/i.test(tail)) {
        subStep = 'Verifying Runtime Configuration';
      } else if (/deployed\/prod/i.test(tail)) {
        subStep = 'Updating Local Git Provenance Tag';
      } else {
        subStep = 'Executing Post-Deploy Checks';
      }
    }

    // Stage 6: Manifest sync with PanoramaAuth IdP
    if (/Notifying PanoramaAuth to sync|Manifest synchronization triggered|Verify at: https/i.test(fullText) || isFinished) {
      maxStage = 6;
      label = 'Syncing Manifest with IdP';
      subStep = isFinished ? 'All 6 Release Stages Completed' : 'Triggering Manifest Webhook';
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

  // Auto-scroll terminal log when active and new lines arrive
  useEffect(() => {
    if (!isStreamCollapsed && showLogTerminal && displayedDeployJob?.isRunning) {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [displayedDeployJob?.lines?.length, displayedDeployJob?.isRunning, isStreamCollapsed, showLogTerminal]);

  const handleCopyLogs = async () => {
    if (!displayedDeployJob?.lines || displayedDeployJob.lines.length === 0) return;
    try {
      await navigator.clipboard.writeText(displayedDeployJob.lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy deployment logs to clipboard:', err);
    }
  };

  const handleClearDisplayedJob = () => {
    if (!displayedDeployJob || !selectedApp) return;
    onClearTab?.(displayedDeployJob.id);
    onCloseTab?.(displayedDeployJob.id);
    handleDismissJob(selectedApp.manifest.slug);
  };

  const handleReopenLatestStream = (slug: string, job: TerminalTab) => {
    handleSelectApp(slug);
    handleTrackJob(slug, job.id);
    setIsStreamCollapsed(false);
    setShowLogTerminal(true);
  };

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
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-emerald-400" />
            6-Stage Release Pipeline & Instant Rollback Engine
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Deploy cryptographic git-backed releases or execute sub-5-second container rollbacks
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectedApp && latestAvailableDeployJob && !displayedDeployJob && (
            <button
              type="button"
              onClick={() => handleReopenLatestStream(selectedApp.manifest.slug, latestAvailableDeployJob)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors whitespace-nowrap flex-shrink-0"
              title="Re-open the deployment stream container for this application"
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>Open Deployment Stream ({latestAvailableDeployJob.lines.length} lines)</span>
            </button>
          )}
          {selectedApp && latestAvailableDeployJob && onOpenInConsoleDrawer && (
            <button
              type="button"
              onClick={() => onOpenInConsoleDrawer(latestAvailableDeployJob.id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors whitespace-nowrap flex-shrink-0"
              title="Open this deployment stream in the bottom SRE Console Drawer"
            >
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span>Open in Console Drawer</span>
            </button>
          )}
          {isDeployingAll && onHaltDeployments ? (
            <button
              onClick={onHaltDeployments}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg transition-all animate-pulse whitespace-nowrap flex-shrink-0"
              title="Immediately halt suite deployments and abort any running deployment job"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Halt All Deployments</span>
            </button>
          ) : (
            <button
              onClick={() => setShowDeployAllModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg transition-all whitespace-nowrap flex-shrink-0"
            >
              <Layers className="w-4 h-4" />
              <span>Batch / Multi-App Deployment...</span>
            </button>
          )}
        </div>
      </div>

      {/* Suite Release Status & Drift Overview Dashboard */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
              Suite Release Status & Deployment Drift Overview
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {apps.filter((a) => (a.composition?.undeployed_commits?.length || 0) > 0 || a.composition?.local_dirty || a.health?.status !== 'healthy' || a.provenanceState === 'PROD_UNREACHABLE').length} of {apps.length} apps have undeployed changes or need remediation
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {apps.map((app) => {
            const appComp = app.composition;
            const undeployedCount = appComp?.undeployed_commits?.length || 0;
            const isLocalDirty = !!appComp?.local_dirty;
            const needsDeploy =
              undeployedCount > 0 ||
              isLocalDirty ||
              appComp?.state === 'AHEAD' ||
              appComp?.state === 'LOCAL_WIP' ||
              app.provenanceState === 'DIRTY_PROD' ||
              app.provenanceState === 'DIVERGED';
            const isDeploying = !!getAppDeployJob(app.manifest.slug);
            const appLatestJob = getAllAppDeployJobs(app.manifest.slug)[0];
            const isSelected = selectedApp?.manifest.slug === app.manifest.slug;
            const isHealthy = app.health?.status === 'healthy';
            const isCritical = !isHealthy || app.provenanceState === 'PROD_UNREACHABLE' || app.provenanceState === 'DIRTY_PROD';
            const appIdent = app.manifest.containerName || app.manifest.slug || app.manifest.appId;
            const appResolvedTel = resolveActiveBuildTelemetry(app.health?.release, appComp);
            const appBuildBadge = evaluateBuildHealthBadge(appResolvedTel.telemetry, appIdent);

            return (
              <div
                key={app.manifest.slug}
                onClick={() => handleSelectApp(app.manifest.slug)}
                className={`p-3.5 rounded-lg border cursor-pointer transition-all flex flex-col justify-between space-y-2.5 ${
                  isCritical
                    ? isSelected
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-500 shadow-[0_0_18px_rgba(244,63,94,0.35)] ring-2 ring-rose-500'
                      : 'bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-950/30 border-rose-500/60 shadow-[0_0_10px_rgba(244,63,94,0.15)]'
                    : needsDeploy
                    ? isSelected
                      ? 'bg-rose-500/10 dark:bg-rose-950/30 border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.4)] ring-2 ring-rose-500/80'
                      : 'bg-rose-500/[0.04] dark:bg-rose-950/20 hover:bg-rose-500/[0.08] dark:hover:bg-rose-950/30 border-rose-500/70 shadow-[0_0_14px_rgba(244,63,94,0.25)]'
                    : isSelected
                    ? 'bg-slate-50 dark:bg-slate-950 border-emerald-500/50 shadow-md ring-1 ring-emerald-500/40'
                    : 'bg-white dark:bg-slate-950/60 hover:bg-slate-50 dark:hover:bg-slate-950 border-slate-200 dark:border-slate-800/90'
                }`}
              >
                {/* App Title & Status Badge */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-emerald-400' : 'bg-rose-500 animate-ping'}`} />
                      {app.manifest.displayName}
                    </h4>
                    <span className="text-[10px] text-slate-500 font-mono block">
                      Prod: {app.health?.release?.semver || app.health?.version || 'v1.0.0'} ({app.health?.release?.commit_short || 'unstamped'})
                    </span>
                  </div>

                  {isCritical ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/50 flex items-center gap-1 shrink-0 animate-pulse">
                      <AlertTriangle className="w-2.5 h-2.5 text-rose-500 dark:text-rose-400" />
                      UNHEALTHY
                    </span>
                  ) : isDeploying ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 flex items-center gap-1 shrink-0 animate-pulse">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      DEPLOYING
                    </span>
                  ) : needsDeploy ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/50 shadow-[0_0_8px_rgba(244,63,94,0.25)] flex items-center gap-1 shrink-0 animate-pulse">
                      <AlertTriangle className="w-2.5 h-2.5 text-rose-500 dark:text-rose-400" />
                      BEHIND ({undeployedCount}{isLocalDirty ? '+' : ''})
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                      SYNCHRONIZED
                    </span>
                  )}
                </div>

                {/* Drift Details & Inspect Diff Trigger */}
                <div className="text-[11px] font-mono flex items-center justify-between gap-1.5 text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-900 pt-2">
                  <div className="flex items-center gap-1.5 truncate">
                    <span>Pending:</span>
                    <span className={`font-bold ${undeployedCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'}`}>
                      {undeployedCount} {isLocalDirty ? '(+ uncommitted)' : ''}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border whitespace-nowrap ${
                        appBuildBadge.tone === 'emerald'
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                          : appBuildBadge.tone === 'amber'
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40'
                          : appBuildBadge.tone === 'rose'
                          ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40'
                          : 'bg-slate-100 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700/80'
                      }`}
                      title={`Build Telemetry: ${appBuildBadge.label}`}
                    >
                      {appBuildBadge.shortLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {appLatestJob && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReopenLatestStream(app.manifest.slug, appLatestJob);
                        }}
                        className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap"
                        title={`Open deployment stream for ${app.manifest.displayName}`}
                      >
                        <Terminal className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
                        <span>Stream</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInspectApp(app);
                      }}
                      className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700/60 transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap"
                      title={`Inspect git diff & provenance for ${app.manifest.displayName}`}
                    >
                      <Eye className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
                      <span>Inspect Diff</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedApp && (
        <div className="space-y-6">
          {/* Deployment Pipeline Progress & Live Stream Container */}
          {displayedDeployJob && (
            <div
              className={`rounded-2xl border shadow-xl overflow-hidden transition-all animate-in fade-in duration-300 ${
                currentStageInfo?.isFailed
                  ? 'border-rose-500/40 bg-white dark:bg-slate-900'
                  : currentStageInfo?.isFinished
                  ? 'border-emerald-500/40 bg-white dark:bg-slate-900'
                  : 'border-amber-500/40 bg-white dark:bg-slate-900'
              }`}
            >
              {/* Header Bar */}
              <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/80 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3.5">
                  <div
                    className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
                      currentStageInfo?.isFailed
                        ? 'bg-rose-500/15 border-rose-500/30 text-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.15)]'
                        : currentStageInfo?.isFinished
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                        : 'bg-amber-500/15 border-amber-500/30 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.15)]'
                    }`}
                  >
                    {currentStageInfo?.isFailed ? (
                      <XCircle className="w-5 h-5 text-rose-400" />
                    ) : currentStageInfo?.isFinished ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
                    )}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <span>
                          {displayedDeployJob.isRunning
                            ? 'Release Pipeline in Progress'
                            : currentStageInfo?.isFinished
                            ? 'Release Pipeline Completed'
                            : 'Release Pipeline Failed'}
                        </span>
                        <span className="text-xs font-mono font-normal text-slate-400">
                          ({selectedApp.manifest.displayName})
                        </span>
                      </h4>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold border flex items-center gap-1.5 ${
                          currentStageInfo?.isFailed
                            ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                            : currentStageInfo?.isFinished
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                            : 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                        }`}
                      >
                        {displayedDeployJob.isRunning && (
                          <span className="w-2 h-2 rounded-full bg-amber-400" />
                        )}
                        {currentStageInfo?.isFailed
                          ? `FAILED (EXIT ${displayedDeployJob.exitCode ?? 1})`
                          : currentStageInfo?.isFinished
                          ? 'COMPLETED (EXIT 0)'
                          : `STAGE ${currentStageInfo?.stage || 1} OF 6`}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        Stage:{' '}
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {currentStageInfo?.label || 'Executing Pipeline'}
                        </span>
                      </p>
                      {currentStageInfo?.subStep && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-900 dark:bg-slate-950/80 text-amber-300 border border-amber-500/30">
                          {currentStageInfo.subStep}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action Toolbar Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* 1. Copy Output */}
                  <button
                    type="button"
                    onClick={handleCopyLogs}
                    disabled={!displayedDeployJob.lines || displayedDeployJob.lines.length === 0}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700/80 transition-colors flex items-center gap-1.5 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0"
                    title="Copy all captured console output to clipboard"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span className="text-emerald-500">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                        <span>Copy Output</span>
                      </>
                    )}
                  </button>

                  {/* 2. Hide Console / Show Console toggle */}
                  <button
                    type="button"
                    onClick={() => setShowLogTerminal(!showLogTerminal)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 ${
                      showLogTerminal
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                    title={showLogTerminal ? 'Hide Terminal Stream' : 'Show Terminal Stream'}
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    <span>{showLogTerminal ? 'Hide Console' : 'Show Console'}</span>
                  </button>

                  {/* 3. Bottom Console button */}
                  {onOpenInConsoleDrawer && (
                    <button
                      type="button"
                      onClick={() => onOpenInConsoleDrawer(displayedDeployJob.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700/80 transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                      title="Open and focus this stream in the bottom global SRE Console Drawer"
                    >
                      <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Bottom Console</span>
                    </button>
                  )}

                  {/* 4. Collapse / Expand chevron */}
                  <button
                    type="button"
                    onClick={() => setIsStreamCollapsed(!isStreamCollapsed)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors whitespace-nowrap flex-shrink-0"
                    title={isStreamCollapsed ? 'Expand Details' : 'Collapse Details'}
                  >
                    {isStreamCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                  </button>

                  {/* 5. Clear Stream trash button */}
                  {(onClearTab || onCloseTab) && (
                    <button
                      type="button"
                      onClick={handleClearDisplayedJob}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors whitespace-nowrap flex-shrink-0"
                      title="Clear & Remove Stream"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}

                  {/* 6. Dismiss (X) button */}
                  <button
                    type="button"
                    onClick={() => handleDismissJob(selectedApp.manifest.slug)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors whitespace-nowrap flex-shrink-0"
                    title="Dismiss Progress Panel"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Body (when !isStreamCollapsed) */}
              {!isStreamCollapsed && (
                <div className="p-4 sm:p-5 space-y-4">
                  {/* 6-Stage Visual Stepper */}
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs font-mono">
                    {[
                      { num: 1, name: 'SemVer & Git', key: 'semver' },
                      { num: 2, name: 'Docker Buildx', key: 'build' },
                      { num: 3, name: 'SSH & SCP', key: 'scp' },
                      { num: 4, name: 'Rolling Swap', key: 'swap' },
                      { num: 5, name: 'Health Probe', key: 'health' },
                      { num: 6, name: 'Manifest Sync', key: 'sync' },
                    ].map((st) => {
                      const currentStageNum = currentStageInfo?.stage || 1;
                      const isDone = currentStageInfo?.isFinished || currentStageNum > st.num;
                      const isActive = !currentStageInfo?.isFinished && !currentStageInfo?.isFailed && currentStageNum === st.num;
                      const isFailed = currentStageInfo?.isFailed && currentStageNum === st.num;

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
                          {isActive && currentStageInfo?.subStep && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400/90 truncate font-mono">
                              {currentStageInfo.subStep}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Collapsible Live Deployment Stream terminal window */}
                  {showLogTerminal && (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 overflow-hidden shadow-inner">
                      <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-slate-400 text-[11px] font-mono">
                        <span className="flex items-center gap-1.5">
                          <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Live Deployment Stream</span>
                          {displayedDeployJob.isRunning && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] border border-amber-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                              LIVE
                            </span>
                          )}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-slate-500">
                            {displayedDeployJob.lines.length} lines captured
                          </span>
                        </div>
                      </div>

                      <div className="max-h-80 min-h-[180px] overflow-y-auto bg-slate-950 p-4 font-mono text-xs space-y-0.5 select-text">
                        {displayedDeployJob.lines.length > 0 ? (
                          displayedDeployJob.lines.map((line, idx) => (
                            <div key={idx}>{formatConsoleLine(line)}</div>
                          ))
                        ) : (
                          <div className="text-slate-500 italic">
                            Waiting for deployment output stream...
                          </div>
                        )}
                        <div ref={terminalEndRef} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Active Production Deployment Card */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Server className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">Active Production Release</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold font-mono ${
                      isHealthy 
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' 
                        : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                    }`}>
                      <Activity className="w-3 h-3" />
                      {selectedApp.health?.status?.toUpperCase() || 'UNREACHABLE'}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mt-0.5">
                    {selectedApp.manifest.displayName}
                    <span className="text-xs font-mono font-normal text-slate-400">({selectedApp.manifest.basePath})</span>
                  </h3>
                </div>
              </div>

              <a
                href={`https://wsh.panoramadr.com${selectedApp.manifest.basePath}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition-colors"
              >
                <Globe className="w-3.5 h-3.5 text-emerald-400" />
                <span>Open in Production</span>
                <ExternalLink className="w-3 h-3 text-slate-500" />
              </a>
            </div>

            {prodRelease || selectedApp.health ? (
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
                    Could not query <code className="text-amber-300">https://wsh.panoramadr.com{selectedApp.manifest.basePath}/api/health</code>. The container may be offline, starting up, or using legacy unstamped release routes.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {/* Build Efficiency & Telemetry Card */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 pb-3.5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                        <Container className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                        <span>Build Efficiency & Telemetry</span>
                      </h3>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                          selectedHealthBadge.tone === 'emerald'
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                            : selectedHealthBadge.tone === 'amber'
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40'
                            : selectedHealthBadge.tone === 'rose'
                            ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                        }`}
                      >
                        {selectedHealthBadge.label}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-100 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        {selectedResolvedTelemetry.source === 'LIVE_PROD'
                          ? 'LIVE PROD'
                          : selectedResolvedTelemetry.source === 'LOCAL_MANIFEST'
                          ? 'LOCAL MANIFEST'
                          : 'TARGETS ARMED'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 font-mono mt-1">
                      Profile: {selectedTelemetry?.profile || 'nextjs-standalone'} • Warm Target: ≤{selectedTelemetryTargets.targetWarmSec}s • Cold Target: ≤{selectedTelemetryTargets.targetColdSec}s • Ceiling: {selectedTelemetryTargets.maxCeilingSec}s
                    </p>
                  </div>
                </div>

                {selectedTelemetry ? (
                  <>
                    {/* 4 KPI Tiles */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80">
                        <span className="text-[10px] uppercase font-sans text-slate-500 block mb-1">
                          Total Build vs Target
                        </span>
                        <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {selectedTelemetry.total_duration_sec}s{' '}
                          <span className="text-xs font-normal text-slate-400">
                            / ≤{selectedTelemetryTargets.activeTargetSec}s
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 block mt-1 uppercase">
                          Posture: {selectedTelemetry.cache_posture}
                        </span>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80">
                        <span className="text-[10px] uppercase font-sans text-slate-500 block mb-1">
                          Baseline Delta (+{selectedTelemetryTargets.regressionThresholdPct}% Gate)
                        </span>
                        <div
                          className={`text-sm font-bold ${
                            typeof selectedTelemetry.regression_pct === 'number' &&
                            selectedTelemetry.regression_pct > selectedTelemetryTargets.regressionThresholdPct
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {typeof selectedTelemetry.regression_pct === 'number'
                            ? `${selectedTelemetry.regression_pct > 0 ? '+' : ''}${selectedTelemetry.regression_pct}%`
                            : 'Baseline Set'}
                        </div>
                        <span className="text-[10px] text-slate-500 block mt-1 truncate">
                          {typeof selectedTelemetry.baseline_duration_sec === 'number'
                            ? `Prev: ${selectedTelemetry.baseline_duration_sec}s (${selectedTelemetry.delta_sec && selectedTelemetry.delta_sec > 0 ? '+' : ''}${selectedTelemetry.delta_sec ?? 0}s)`
                            : 'Initial posture reference'}
                        </span>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80">
                        <span className="text-[10px] uppercase font-sans text-slate-500 block mb-1">
                          Deps Cache & ELF Gate
                        </span>
                        <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          <span
                            className={
                              selectedTelemetry.deps_cache_hit
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }
                          >
                            {selectedTelemetry.deps_cache_hit ? 'CACHED' : `${selectedTelemetry.deps_stage_sec}s`}
                          </span>
                          <span className="text-slate-400"> • </span>
                          <span>{selectedTelemetry.elf_verified_count} ELF</span>
                        </div>
                        <span className="text-[10px] text-slate-500 block mt-1 truncate">
                          aarch64 (0xb7) verified
                        </span>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80">
                        <span className="text-[10px] uppercase font-sans text-slate-500 block mb-1">
                          Context & Pre-Validated Types
                        </span>
                        <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {selectedTelemetry.context_transfer_kb} KB
                        </div>
                        <span className="text-[10px] text-slate-500 block mt-1 truncate">
                          Types: {selectedTelemetry.types_prevalidated ? `Host (${selectedTelemetry.host_typecheck_sec}s)` : 'In-Container'}
                        </span>
                      </div>
                    </div>

                    {/* Multi-Segment Proportional Stage Progress Bar */}
                    {(() => {
                      const hostTsc = Math.max(0, selectedTelemetry.host_typecheck_sec || 0);
                      const depsSec = Math.max(0, selectedTelemetry.deps_stage_sec || 0);
                      const nextSec = Math.max(0, selectedTelemetry.next_build_sec || 0);
                      const tailSec = Math.max(
                        0,
                        (selectedTelemetry.arm64_natives_sec || 0) + (selectedTelemetry.export_tar_sec || 0)
                      );
                      const sumSec = Math.max(0.1, hostTsc + depsSec + nextSec + tailSec);
                      const pctHost = Math.round((hostTsc / sumSec) * 100);
                      const pctDeps = Math.round((depsSec / sumSec) * 100);
                      const pctNext = Math.round((nextSec / sumSec) * 100);
                      const pctTail = Math.max(0, 100 - pctHost - pctDeps - pctNext);

                      return (
                        <div className="space-y-2">
                          <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-950 overflow-hidden flex border border-slate-200 dark:border-slate-800">
                            {pctHost > 0 && (
                              <div
                                style={{ width: `${pctHost}%` }}
                                className="bg-cyan-500 dark:bg-cyan-400 h-full"
                                title={`Host Typecheck (tsc): ${hostTsc}s`}
                              />
                            )}
                            {pctDeps > 0 && (
                              <div
                                style={{ width: `${pctDeps}%` }}
                                className="bg-amber-500 dark:bg-amber-400 h-full"
                                title={`Dependencies (npm ci): ${depsSec}s`}
                              />
                            )}
                            {pctNext > 0 && (
                              <div
                                style={{ width: `${pctNext}%` }}
                                className="bg-emerald-500 dark:bg-emerald-400 h-full"
                                title={`Next.js Build (amd64): ${nextSec}s`}
                              />
                            )}
                            {pctTail > 0 && (
                              <div
                                style={{ width: `${pctTail}%` }}
                                className="bg-indigo-500 dark:bg-indigo-400 h-full"
                                title={`ARM64 Natives & Export: ${Math.round(tailSec * 10) / 10}s`}
                              />
                            )}
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            <span className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-cyan-500 dark:bg-cyan-400" />
                              Host tsc: {hostTsc}s
                            </span>
                            <span className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400" />
                              Deps (npm ci): {selectedTelemetry.deps_cache_hit ? '0s (CACHED)' : `${depsSec}s`}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                              Next.js Build: {nextSec}s (compile {selectedTelemetry.turbopack_compile_sec}s)
                            </span>
                            <span className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-indigo-500 dark:bg-indigo-400" />
                              ARM64 Natives & Export: {Math.round(tailSec * 10) / 10}s
                            </span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* High-Contrast Build Regression & Budget Warnings Banner */}
                    {selectedHealthBadge.warnings.length > 0 && (
                      <div
                        className={`p-3.5 rounded-lg border text-xs font-mono space-y-1.5 ${
                          selectedHealthBadge.tone === 'rose'
                            ? 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                            : 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-bold">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>Build Regression & Budget Warnings ({selectedHealthBadge.warnings.length})</span>
                        </div>
                        <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                          {selectedHealthBadge.warnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80">
                      <span className="text-[10px] uppercase font-sans text-slate-500 block mb-1">Warm Build Target</span>
                      <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        ≤{selectedTelemetryTargets.targetWarmSec}s
                      </span>
                      <span className="text-[10px] text-slate-500 block mt-1">Cached npm + .next/cache</span>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80">
                      <span className="text-[10px] uppercase font-sans text-slate-500 block mb-1">Cold Build Target</span>
                      <span className="text-sm font-bold text-cyan-600 dark:text-cyan-400">
                        ≤{selectedTelemetryTargets.targetColdSec}s
                      </span>
                      <span className="text-[10px] text-slate-500 block mt-1">Lockfile updated</span>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80">
                      <span className="text-[10px] uppercase font-sans text-slate-500 block mb-1">Regression Gate</span>
                      <span className="text-sm font-bold text-amber-600 dark:text-amber-400">
                        +{selectedTelemetryTargets.regressionThresholdPct}%
                      </span>
                      <span className="text-[10px] text-slate-500 block mt-1">Ceiling: {selectedTelemetryTargets.maxCeilingSec}s</span>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80">
                      <span className="text-[10px] uppercase font-sans text-slate-500 block mb-1">Context Budget</span>
                      <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        ≤{selectedTelemetryTargets.maxContextKB} KB
                      </span>
                      <span className="text-[10px] text-slate-500 block mt-1">ELF 0xb7 gate active</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Release Composition Summary */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-5">
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
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-mono">
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

              {/* Undeployed Commits List */}
              <div className="space-y-2">
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
                ) : (
                  <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80 text-center text-xs text-slate-500 font-mono flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    Local working tree is clean and synchronized with production.
                  </div>
                )}
              </div>

              {/* Deploy Trigger Form */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Stage 6: Orchestrate Production Deployment
                  </h4>
                  <div className="flex items-center gap-2">
                    {latestAvailableDeployJob && !displayedDeployJob && (
                      <button
                        type="button"
                        onClick={() => handleReopenLatestStream(selectedApp.manifest.slug, latestAvailableDeployJob)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                      >
                        <Terminal className="w-3 h-3" />
                        <span>Show Deployment Stream ({latestAvailableDeployJob.lines.length} lines)</span>
                      </button>
                    )}
                    {latestAvailableDeployJob && onOpenInConsoleDrawer && (
                      <button
                        type="button"
                        onClick={() => onOpenInConsoleDrawer(latestAvailableDeployJob.id)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                      >
                        <Terminal className="w-3 h-3 text-cyan-400" />
                        <span>Open in Console Drawer</span>
                      </button>
                    )}
                    <span className="text-[11px] text-slate-500 font-mono">Triggers deploy-docker.ps1</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <div className="flex items-center gap-2 min-w-[240px]">
                    <span className="text-slate-400 whitespace-nowrap">SemVer Bump:</span>
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

                  <label className="flex items-center gap-2 cursor-pointer text-slate-400">
                    <input
                      type="checkbox"
                      checked={allowDirty}
                      onChange={(e) => setAllowDirty(e.target.checked)}
                      disabled={!!activeSelectedDeployJob}
                      className="rounded border-slate-700 text-emerald-500 focus:ring-0 disabled:opacity-50"
                    />
                    <span>Allow dirty uncommitted tree</span>
                  </label>
                </div>

                <button
                  onClick={() => onTriggerDeploy(selectedApp, bumpVersion, allowDirty)}
                  disabled={!!activeSelectedDeployJob}
                  className={`w-full py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg ${
                    activeSelectedDeployJob
                      ? 'bg-amber-600/60 text-amber-200 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                >
                  {activeSelectedDeployJob ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
                      <span>Release in Progress ({currentStageInfo?.label || 'Running Pipeline'})...</span>
                    </>
                  ) : (
                    <>
                      <Rocket className="w-4 h-4" />
                      <span>Buildx & Deploy to Production (deploy-docker.ps1)</span>
                    </>
                  )}
                </button>
              </div>
              </div>
            </div>

            {/* Instant Rollback Panel */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                    <RotateCcw className="w-4 h-4 text-rose-400" />
                    Instant Rollback Panel
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Instantly swaps the running WSH container to a previous N-3 cached image tag in under 5 seconds.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-400">Rollback Target Tag:</label>
                  <input
                    type="text"
                    placeholder="e.g. 1.0.0-7bae144"
                    value={rollbackTag}
                    onChange={(e) => setRollbackTag(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg text-xs font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-rose-500"
                  />
                  
                  {/* Candidate Quick-Fill Tags with Date and Status */}
                  {rollbackTagList.length > 0 && (
                    <div className="pt-2">
                      <span className="text-[10px] text-slate-500 uppercase block mb-1.5 font-semibold">
                        Known Release & Rollback Tags:
                      </span>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {rollbackTagList.map((entry) => (
                          <button
                            key={entry.tag}
                            type="button"
                            onClick={() => setRollbackTag(entry.tag)}
                            className={`w-full text-left p-2 rounded text-xs font-mono border transition-all flex items-start justify-between gap-2 ${
                              rollbackTag === entry.tag
                                ? 'bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-200 ring-1 ring-rose-500/50'
                                : 'bg-slate-50 dark:bg-slate-950/80 hover:bg-slate-100 dark:hover:bg-slate-800/80 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 font-bold truncate">
                                <ArrowRight className="w-3 h-3 text-rose-400 shrink-0" />
                                <span className="truncate">{entry.tag}</span>
                                {entry.isDeployed && (
                                  <span className="px-1 py-0.2 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                                    LIVE
                                  </span>
                                )}
                              </div>
                              {entry.subject && (
                                <p className="text-[10px] text-slate-400 truncate mt-0.5">
                                  {entry.subject}
                                </p>
                              )}
                            </div>

                            {entry.committedAt && (
                              <div className="text-right shrink-0">
                                <span className="text-[10px] text-slate-400 block font-sans">
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

                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-rose-400">
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
                className="w-full py-2.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white transition-colors flex items-center justify-center gap-2 mt-auto shadow-md"
              >
                <RotateCcw className="w-4 h-4" />
                Swap Container Tag Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch / Multi-App Deployment Orchestrator Modal */}
      <BatchDeployModal
        isOpen={showDeployAllModal}
        apps={apps}
        onConfirm={(options: BatchDeployOptions) => {
          setShowDeployAllModal(false);
          onTriggerDeployAll(options.selectedApps, options.bumpVersion, options.allowDirty);
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
