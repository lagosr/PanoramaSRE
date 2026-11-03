import { useState } from 'react';
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
  Square
} from 'lucide-react';
import { BatchDeployModal, BatchDeployOptions } from './BatchDeployModal';
import { CustomSelect } from '../ui/CustomSelect';
import { formatLocalDateTime, formatRelativeTime } from '../../lib/formatters';
import { TerminalTab } from '../layout/SreTerminalDrawer';

interface ReleasePipelineViewProps {
  apps: DiscoveredApp[];
  terminalTabs?: TerminalTab[];
  onTriggerDeploy: (app: DiscoveredApp, bump: string, allowDirty: boolean) => void;
  onTriggerDeployAll: (apps: DiscoveredApp[], bump: string, allowDirty: boolean) => void;
  onTriggerRollback: (app: DiscoveredApp, tag: string) => void;
  isDeployingAll?: boolean;
  onHaltDeployments?: () => void;
}

export function ReleasePipelineView({
  apps,
  terminalTabs = [],
  onTriggerDeploy,
  onTriggerDeployAll,
  onTriggerRollback,
  isDeployingAll = false,
  onHaltDeployments,
}: ReleasePipelineViewProps) {
  const [selectedAppSlug, setSelectedAppSlug] = useState<string>(apps[0]?.manifest.slug || '');
  const [bumpVersion, setBumpVersion] = useState<string>('none');
  const [allowDirty, setAllowDirty] = useState<boolean>(false);
  const [rollbackTag, setRollbackTag] = useState<string>('');
  const [showDeployAllModal, setShowDeployAllModal] = useState<boolean>(false);

  const selectedApp = apps.find((a) => a.manifest.slug === selectedAppSlug) || apps[0];
  const comp = selectedApp?.composition;
  const prodRelease = selectedApp?.health?.release;
  const isHealthy = selectedApp?.health?.status === 'healthy';

  // Helper to detect if an app has an active running deployment job and inspect its logs
  const getAppDeployJob = (slug: string) => {
    return terminalTabs.find(
      (t) => t.id.startsWith(`deploy-${slug}`) && t.isRunning
    );
  };

  // Inspect last lines of active job to determine current stage
  const getDeploymentStage = (tab?: TerminalTab) => {
    if (!tab) return null;
    const allText = tab.lines.slice(-15).join(' ');
    if (/transferring context|RUN apk|RUN npm|DONE|deps/i.test(allText)) {
      return { stage: 2, label: 'Building Docker Image (Buildx)', icon: Container };
    }
    if (/transferring image|scp|tar/i.test(allText)) {
      return { stage: 3, label: 'Transferring Image to DietPi (SSH)', icon: Rocket };
    }
    if (/rolling swap|container swap|docker-compose up|pull/i.test(allText)) {
      return { stage: 4, label: 'Rolling Container Swap', icon: RotateCcw };
    }
    if (/sync webhook|POST \/auth\/api\/admin\/apps\/sync/i.test(allText)) {
      return { stage: 5, label: 'Syncing Manifest with IdP', icon: Layers };
    }
    if (/health check|verifying health|probing/i.test(allText)) {
      return { stage: 6, label: 'Validating Health Probes', icon: Activity };
    }
    return { stage: 1, label: 'Preparing Build Context', icon: Loader2 };
  };

  const activeSelectedDeployJob = selectedApp ? getAppDeployJob(selectedApp.manifest.slug) : undefined;
  const currentStageInfo = getDeploymentStage(activeSelectedDeployJob);

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

        <div className="flex items-center gap-2">
          {isDeployingAll && onHaltDeployments ? (
            <button
              onClick={onHaltDeployments}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg transition-all animate-pulse"
              title="Immediately halt suite deployments and abort any running deployment job"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Halt All Deployments</span>
            </button>
          ) : (
            <button
              onClick={() => setShowDeployAllModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg transition-all"
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
            {apps.filter((a) => (a.composition?.undeployed_commits?.length || 0) > 0 || a.composition?.local_dirty).length} of {apps.length} apps have undeployed changes
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {apps.map((app) => {
            const appComp = app.composition;
            const undeployedCount = appComp?.undeployed_commits?.length || 0;
            const isLocalDirty = !!appComp?.local_dirty;
            const needsDeploy = undeployedCount > 0 || isLocalDirty || appComp?.state === 'AHEAD' || appComp?.state === 'LOCAL_WIP';
            const isDeploying = !!getAppDeployJob(app.manifest.slug);
            const isSelected = selectedApp?.manifest.slug === app.manifest.slug;
            const isHealthy = app.health?.status === 'healthy';
            const isCritical = !isHealthy || app.provenanceState === 'PROD_UNREACHABLE' || app.provenanceState === 'DIRTY_PROD';

            return (
              <div
                key={app.manifest.slug}
                onClick={() => {
                  setSelectedAppSlug(app.manifest.slug);
                  setRollbackTag('');
                }}
                className={`p-3.5 rounded-lg border cursor-pointer transition-all flex flex-col justify-between space-y-2.5 ${
                  isCritical
                    ? isSelected
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-500 shadow-[0_0_16px_rgba(244,63,94,0.3)] ring-1 ring-rose-500'
                      : 'bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-950/30 border-rose-500/60 shadow-[0_0_10px_rgba(244,63,94,0.15)]'
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
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 shrink-0">
                      BEHIND ({undeployedCount})
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                      SYNCHRONIZED
                    </span>
                  )}
                </div>

                {/* Drift Details */}
                <div className="text-[11px] font-mono flex items-center justify-between text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-900 pt-2">
                  <span>Pending Commits:</span>
                  <span className={`font-bold ${undeployedCount > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                    {undeployedCount} {isLocalDirty ? '(+ uncommitted)' : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedApp && (
        <div className="space-y-6">
          {/* Active Live Deployment Progress Banner (when deployment is executing) */}
          {activeSelectedDeployJob && (
            <div className="p-4 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-500/10 via-slate-900 to-slate-900 shadow-lg space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                      <span>Release Pipeline in Progress</span>
                      <span className="text-xs font-mono font-normal text-slate-400">
                        ({selectedApp.manifest.displayName})
                      </span>
                    </h4>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Current Stage: <span className="font-semibold text-emerald-400">{currentStageInfo?.label || 'Executing Pipeline'}</span>
                    </p>
                  </div>
                </div>

                <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1.5 animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  STAGE {currentStageInfo?.stage || 1} OF 6
                </span>
              </div>

              {/* 6-Stage Visual Stepper */}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 pt-2 border-t border-slate-800/80 text-xs font-mono">
                {[
                  { num: 1, name: 'SemVer & Git', done: (currentStageInfo?.stage || 1) > 1, active: (currentStageInfo?.stage || 1) === 1 },
                  { num: 2, name: 'Buildx Image', done: (currentStageInfo?.stage || 1) > 2, active: (currentStageInfo?.stage || 1) === 2 },
                  { num: 3, name: 'SSH & SCP', done: (currentStageInfo?.stage || 1) > 3, active: (currentStageInfo?.stage || 1) === 3 },
                  { num: 4, name: 'Rolling Swap', done: (currentStageInfo?.stage || 1) > 4, active: (currentStageInfo?.stage || 1) === 4 },
                  { num: 5, name: 'Manifest Sync', done: (currentStageInfo?.stage || 1) > 5, active: (currentStageInfo?.stage || 1) === 5 },
                  { num: 6, name: 'Health Probe', done: false, active: (currentStageInfo?.stage || 1) === 6 },
                ].map((st) => (
                  <div
                    key={st.num}
                    className={`p-2 rounded border flex items-center gap-2 ${
                      st.active
                        ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                        : st.done
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : 'bg-slate-950/40 border-slate-800 text-slate-500'
                    }`}
                  >
                    {st.active ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />
                    ) : st.done ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <span className="w-3.5 h-3.5 rounded-full border border-slate-700 flex items-center justify-center text-[10px] shrink-0">{st.num}</span>
                    )}
                    <span className="truncate">{st.name}</span>
                  </div>
                ))}
              </div>
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
            {/* Release Composition Summary */}
            <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                    Release Composition & Local Changes
                  </h3>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">
                    Local HEAD {comp?.local_head_short || 'unknown'} • Branch {comp?.local_branch || 'main'}
                  </p>
                </div>

                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-mono">
                  {comp?.state || 'IN_SYNC'}
                </span>
              </div>

              {/* Blast-Radius Badges */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-500">Blast Radius:</span>
                {comp?.blast_radius_badges && comp.blast_radius_badges.length > 0 ? (
                  comp.blast_radius_badges.map((b, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30"
                    >
                      {b}
                    </span>
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
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Stage 6: Orchestrate Production Deployment
                  </h4>
                  <span className="text-[11px] text-slate-500 font-mono">Triggers deploy-docker.ps1</span>
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
    </div>
  );
}
