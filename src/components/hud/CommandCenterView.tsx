import { useMemo, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { SegmentedControl } from '@lagosr/panorama-ui-kit';
import { Activity, LayoutGrid, RefreshCw, Rocket, Table2 } from 'lucide-react';
import {
  ApplianceStatus,
  BackupLedgerSummary,
  CloudflareTunnelVersionStatus,
  DiscoveredApp,
  FleetCronAuditSummary,
  NavSectionId,
  NetworkPosture,
  OptInComplianceSnapshot,
  OttoContextSeed,
  OttoLifecycleSnapshot,
  OttoSoakSessionRow,
  QuarantinedAccessEmailRow,
  SecurityPostureInvariant,
  SmokeTestRun,
  SslFleetSummary,
  TerminalTab,
  ThreatAuditRunRow,
  WshSnapshot,
  isAppDeployCandidate,
} from '../../lib/types';
import {
  HudIncidentAction,
  buildHudIncidentQueue,
  buildHudScorecard,
} from '../../lib/hud-synthesis';
import { FleetAppCard } from './FleetAppCard';
import { FleetAppTable } from './FleetAppTable';
import { ApplianceStatusStrip } from './ApplianceStatusStrip';
import { PriorityAttentionQueue } from './PriorityAttentionQueue';
import { ExecutiveScorecardStrip } from './ExecutiveScorecardStrip';
import { ReleaseCompositionDrawer } from './ReleaseCompositionDrawer';
import { BatchDeployModal } from '../releases/BatchDeployModal';

interface CommandCenterViewProps {
  apps: DiscoveredApp[];
  appliances: ApplianceStatus[];
  wshSnapshot?: WshSnapshot | null;
  tunnelVersionStatus?: CloudflareTunnelVersionStatus | null;
  sslFleet?: SslFleetSummary | null;
  backupLedger?: BackupLedgerSummary | null;
  isBackupIncidentDismissed?: boolean;
  optInSnapshot?: OptInComplianceSnapshot | null;
  cronSummary?: FleetCronAuditSummary | null;
  smokeRuns?: SmokeTestRun[];
  latestThreatRun?: ThreatAuditRunRow | null;
  threatAlertCount?: number;
  threatAlertSeverity?: 'error' | 'warning' | null;
  topThreatTitle?: string | null;
  topThreatDetail?: string | null;
  topThreatTargetTab?: 'overview' | 'external' | 'internal' | 'allowlist';
  topThreatFocusId?: string | null;
  pendingQuarantinedEmails?: QuarantinedAccessEmailRow[];
  terminalTabs?: TerminalTab[];
  isLoading: boolean;
  isInitialSyncComplete?: boolean;
  networkPosture?: NetworkPosture;
  onNavigateToBackups?: () => void;
  onNavigateToOptIns?: () => void;
  onNavigateToCrons?: () => void;
  onNavigateToDietPi?: () => void;
  onNavigateToRelease?: (slug: string) => void;
  onTriggerFullGfsBackup?: () => void;
  securityViolationCount?: number;
  failingInvariants?: SecurityPostureInvariant[];
  hardeningPassingCount?: number;
  hardeningTotalCount?: number;
  onReapplyHardening?: () => void;
  onRunPenetrationAudit?: () => void;
  onNavigateToTopology?: () => void;
  onNavigateToHardening?: () => void;
  onNavigateToThreat?: (opts?: {
    tab?: 'overview' | 'external' | 'internal' | 'allowlist';
    focusId?: string;
  }) => void;
  onNavigateToSmoke?: () => void;
  onNavigateToPki?: () => void;
  isDeployingAll?: boolean;
  onTriggerDeployAll?: (
    appsToDeploy: DiscoveredApp[],
    bump: string,
    allowDirty: boolean,
    autoRollback: boolean
  ) => void;
  onOpenInBottomConsole?: (tabId?: string) => void;
  onAbortJob?: (id: string) => void;
  onClearTab?: (id: string) => void;
  ottoLifecycle?: OttoLifecycleSnapshot | null;
  ottoSoaks?: OttoSoakSessionRow[];
  onOpenOtto?: () => void;
  onOpenOttoApprovals?: () => void;
  onAskOtto?: (seed: OttoContextSeed) => void;
}

const HUD_VIEW_STORAGE_KEY = 'panoramasre_hud_fleet_view';

export function CommandCenterView({
  apps,
  appliances,
  wshSnapshot = null,
  tunnelVersionStatus = null,
  sslFleet,
  backupLedger,
  isBackupIncidentDismissed = false,
  optInSnapshot,
  cronSummary,
  smokeRuns = [],
  latestThreatRun = null,
  threatAlertCount = 0,
  threatAlertSeverity = null,
  topThreatTitle = null,
  topThreatDetail = null,
  topThreatTargetTab,
  topThreatFocusId = null,
  pendingQuarantinedEmails = [],
  isLoading,
  isInitialSyncComplete = true,
  networkPosture = 'LAN_DIRECT',
  onNavigateToBackups,
  onNavigateToOptIns,
  onNavigateToCrons,
  onNavigateToDietPi,
  onNavigateToRelease,
  onTriggerFullGfsBackup,
  securityViolationCount = 0,
  failingInvariants = [],
  hardeningPassingCount,
  hardeningTotalCount,
  onReapplyHardening,
  onRunPenetrationAudit,
  onNavigateToTopology,
  onNavigateToHardening,
  onNavigateToThreat,
  onNavigateToSmoke,
  onNavigateToPki,
  isDeployingAll = false,
  onTriggerDeployAll,
  ottoLifecycle = null,
  ottoSoaks = [],
  onOpenOtto,
  onOpenOttoApprovals,
  onAskOtto,
}: CommandCenterViewProps) {
  const [selectedApp, setSelectedApp] = useState<DiscoveredApp | null>(null);
  const [showBatchDeployModal, setShowBatchDeployModal] = useState<boolean>(false);
  const [fleetViewMode, setFleetViewMode] = useState<'cards' | 'table'>(() => {
    try {
      if (typeof window !== 'undefined') {
        const stored = window.localStorage.getItem(HUD_VIEW_STORAGE_KEY);
        if (stored === 'table') return 'table';
      }
    } catch {
      // ignore storage unavailability
    }
    return 'cards';
  });

  const handleFleetViewChange = (mode: 'cards' | 'table') => {
    setFleetViewMode(mode);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(HUD_VIEW_STORAGE_KEY, mode);
      }
    } catch {
      // ignore storage unavailability
    }
  };

  const handleOpenApp = async (url: string) => {
    try {
      await openUrl(url);
    } catch {
      window.open(url, '_blank');
    }
  };

  const handleInspectComposition = (app: DiscoveredApp) => {
    setSelectedApp(app);
  };

  const synthesisInput = useMemo(
    () => ({
      apps,
      appliances,
      wshSnapshot,
      tunnelVersionStatus,
      sslFleet,
      backupLedger,
      isBackupIncidentDismissed,
      optInSnapshot,
      cronSummary,
      smokeRuns,
      latestThreatRun,
      threatAlertCount,
      threatAlertSeverity,
      topThreatTitle,
      topThreatDetail,
      topThreatTargetTab,
      topThreatFocusId,
      pendingQuarantinedEmails,
      securityViolationCount,
      failingInvariants,
      hardeningPassingCount,
      hardeningTotalCount,
      isInitialSyncComplete,
      networkPosture,
    }),
    [
      apps,
      appliances,
      wshSnapshot,
      tunnelVersionStatus,
      sslFleet,
      backupLedger,
      isBackupIncidentDismissed,
      optInSnapshot,
      cronSummary,
      smokeRuns,
      latestThreatRun,
      threatAlertCount,
      threatAlertSeverity,
      topThreatTitle,
      topThreatDetail,
      topThreatTargetTab,
      topThreatFocusId,
      pendingQuarantinedEmails,
      securityViolationCount,
      failingInvariants,
      hardeningPassingCount,
      hardeningTotalCount,
      isInitialSyncComplete,
      networkPosture,
    ]
  );

  const incidentQueue = useMemo(() => buildHudIncidentQueue(synthesisInput), [synthesisInput]);
  const scorecardCards = useMemo(() => buildHudScorecard(synthesisInput), [synthesisInput]);

  const allBehindApps = useMemo(() => {
    if (!isInitialSyncComplete) return [];
    return apps.filter(isAppDeployCandidate);
  }, [apps, isInitialSyncComplete]);

  const behindWshApps = useMemo(() => {
    if (!isInitialSyncComplete) return [];
    return allBehindApps.filter(
      (a) => !a.manifest.hostingTarget || a.manifest.hostingTarget === 'wsh-docker'
    );
  }, [allBehindApps, isInitialSyncComplete]);

  const handleIncidentAction = (action: HudIncidentAction) => {
    switch (action.kind) {
      case 'open_releases':
        if (action.targetSlug) onNavigateToRelease?.(action.targetSlug);
        break;
      case 'inspect_app': {
        const match = action.targetSlug
          ? apps.find((a) => a.manifest.slug === action.targetSlug)
          : undefined;
        if (match) setSelectedApp(match);
        else if (action.targetSlug) onNavigateToRelease?.(action.targetSlug);
        break;
      }
      case 'reapply_hardening':
        onReapplyHardening?.();
        break;
      case 'pen_audit':
        onRunPenetrationAudit?.();
        break;
      case 'open_hardening':
        (onNavigateToHardening ?? onNavigateToTopology)?.();
        break;
      case 'retry_backup':
        onTriggerFullGfsBackup?.();
        break;
      case 'open_backups':
        onNavigateToBackups?.();
        break;
      case 'open_threat':
        onNavigateToThreat?.({ tab: action.threatTab, focusId: action.threatFocusId });
        break;
      case 'open_smoke':
        onNavigateToSmoke?.();
        break;
      case 'open_pki':
        onNavigateToPki?.();
        break;
      case 'open_dietpi':
        (onNavigateToDietPi ?? onNavigateToCrons)?.();
        break;
      case 'open_crons':
        onNavigateToCrons?.();
        break;
    }
  };

  const handleScorecardNavigate = (view: NavSectionId) => {
    switch (view) {
      case 'releases':
        onNavigateToRelease?.(allBehindApps[0]?.manifest.slug ?? apps[0]?.manifest.slug ?? '');
        break;
      case 'security':
        if (threatAlertCount > 0 && topThreatTargetTab) {
          onNavigateToThreat?.({
            tab: topThreatTargetTab,
            focusId: topThreatFocusId ?? undefined,
          });
        } else if (pendingQuarantinedEmails.some((q) => q.status === 'PENDING')) {
          onNavigateToThreat?.({ tab: 'allowlist' });
        } else {
          onNavigateToThreat?.();
        }
        break;
      case 'hardening':
        (onNavigateToHardening ?? onNavigateToTopology)?.();
        break;
      case 'dietpi':
        (onNavigateToDietPi ?? onNavigateToCrons)?.();
        break;
      case 'topology':
        onNavigateToTopology?.();
        break;
      case 'backups':
        onNavigateToBackups?.();
        break;
      case 'edge':
        onNavigateToPki?.();
        break;
      case 'smoke':
        onNavigateToSmoke?.();
        break;
      default:
        break;
    }
  };

  return (
    <div className="p-6 max-w-[1920px] mx-auto w-full min-w-0 space-y-6">
      {/* Executive Command HUD Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Activity className="w-5 h-5 text-[var(--color-brand-text)] shrink-0" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight truncate">
              Command HUD
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              360° Executive Glass Cockpit — Unified Incident Triage, Fleet Posture, and LAN Appliances
            </p>
          </div>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0">
          {!isInitialSyncComplete && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 whitespace-nowrap">
              <RefreshCw className="w-3 h-3 animate-spin text-[var(--color-brand-text)] shrink-0" />
              <span>Syncing initial telemetry...</span>
            </span>
          )}
          <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
            {apps.length} Applications Registered
          </span>
        </div>
      </div>

      {/* Zone 1: Unified Priority Attention Queue (All 7 Domains) */}
      <PriorityAttentionQueue
        incidents={incidentQueue}
        isInitialSyncComplete={isInitialSyncComplete}
        pendingAgentApprovalsCount={ottoLifecycle?.pendingApprovalsCount ?? 0}
        onAction={handleIncidentAction}
        onRunPenetrationAudit={onRunPenetrationAudit}
        onAskOtto={onAskOtto}
        onOpenOttoApprovals={onOpenOttoApprovals ?? onOpenOtto}
      />

      {/* Zone 2: Symmetric 6-Domain Executive System Posture Scorecard */}
      {(() => {
        const activeSoaks = ottoSoaks.filter((s) => s.status === 'SOAKING');
        const firstSoak = activeSoaks[0];
        const soakMinsLeft = firstSoak
          ? Math.max(1, Math.ceil((Date.parse(firstSoak.endsAt) - Date.now()) / 60000))
          : 0;
        const ribbonModeLabel =
          activeSoaks.length > 0
            ? `SOAKING ${soakMinsLeft}m · ${firstSoak.appSlug.toUpperCase()}`
            : ottoLifecycle?.phaseLabel || 'Otto: Idle';
        const ribbonDetail =
          activeSoaks.length > 0
            ? `Monitoring ${activeSoaks.length} post-deploy soak window${activeSoaks.length === 1 ? '' : 's'} (${firstSoak.releaseId}${firstSoak.hasDbMigration ? ' · DB_MIGRATION L3-only' : ' · DB-Safe N-3 ready'})`
            : ottoLifecycle?.summary || '';
        return (
          <ExecutiveScorecardStrip
            cards={scorecardCards}
            onNavigate={handleScorecardNavigate}
            agentRibbon={
              (ottoLifecycle || activeSoaks.length > 0) && onOpenOtto
                ? {
                    modeLabel: ribbonModeLabel,
                    detail: ribbonDetail,
                    onOpenAgent: onOpenOtto,
                  }
                : null
            }
          />
        );
      })()}

      {/* Zone 3: Panorama Suite Fleet Matrix (Cards | Compact Table Toggle + Batch Deploy) */}
      <section aria-label="Panorama Suite Applications" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
              Panorama Suite Applications
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Real-time Git provenance drift, container health, backup compliance, and release orchestration
            </p>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0">
            {allBehindApps.length > 0 && behindWshApps.length === 0 && onNavigateToRelease && (
              <button
                type="button"
                onClick={() => onNavigateToRelease(allBehindApps[0].manifest.slug)}
                className="inline-flex items-center gap-1.5 text-xs font-mono font-bold py-1.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-sm whitespace-nowrap flex-shrink-0 cursor-pointer transition-colors"
              >
                <Rocket className="w-3.5 h-3.5" />
                <span>
                  Release Ready: {allBehindApps[0].manifest.displayName}
                  {(allBehindApps[0].composition?.ahead_count ?? 0) > 0
                    ? ` (+${allBehindApps[0].composition?.ahead_count})`
                    : ''} →
                </span>
              </button>
            )}
            {behindWshApps.length > 0 && onTriggerDeployAll && (
              <button
                type="button"
                disabled={isDeployingAll}
                onClick={() => setShowBatchDeployModal(true)}
                className="btn-primary text-xs py-1.5 px-3 whitespace-nowrap flex-shrink-0"
              >
                <Rocket className="w-3.5 h-3.5" />
                <span>Deploy All Behind ({behindWshApps.length})</span>
              </button>
            )}

            <SegmentedControl<'cards' | 'table'>
              activeVariant="brand"
              size="sm"
              value={fleetViewMode}
              onChange={handleFleetViewChange}
              options={[
                {
                  value: 'cards',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <LayoutGrid className="w-3.5 h-3.5" />
                      <span>Cards</span>
                    </span>
                  ),
                },
                {
                  value: 'table',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <Table2 className="w-3.5 h-3.5" />
                      <span>Table</span>
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </div>

        {isLoading && apps.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 w-full min-w-0">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-64 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 animate-pulse"
              />
            ))}
          </div>
        ) : fleetViewMode === 'table' ? (
          <FleetAppTable
            apps={apps}
            backupLedger={backupLedger}
            optInSnapshot={optInSnapshot}
            isInitialSyncComplete={isInitialSyncComplete}
            networkPosture={networkPosture}
            onOpenApp={handleOpenApp}
            onInspectComposition={handleInspectComposition}
            onNavigateToOptIns={onNavigateToOptIns}
            onNavigateToRelease={onNavigateToRelease}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 w-full min-w-0">
            {apps.map((app) => {
              const appBackup = backupLedger?.latest_app_details.find(
                (b) =>
                  b.app_name.toLowerCase() === app.manifest.displayName.toLowerCase() ||
                  b.app_name.toLowerCase() === app.manifest.appId.toLowerCase() ||
                  b.app_name.toLowerCase() === app.manifest.slug.toLowerCase()
              );
              const activeSoak = ottoSoaks.find(
                (s) =>
                  s.status === 'SOAKING' &&
                  s.appSlug.toLowerCase() === app.manifest.slug.toLowerCase()
              );
              const soakBadge = activeSoak
                ? {
                    kind: 'soaking' as const,
                    label: `SOAKING ${Math.max(
                      1,
                      Math.ceil((Date.parse(activeSoak.endsAt) - Date.now()) / 60000)
                    )}m`,
                  }
                : null;

              return (
                <FleetAppCard
                  key={app.manifest.slug}
                  app={app}
                  backupStatus={appBackup}
                  optInSnapshot={
                    app.manifest.hostingTarget === 'cloudflare-pages' ? optInSnapshot : undefined
                  }
                  isInitialSyncComplete={isInitialSyncComplete}
                  networkPosture={networkPosture}
                  agentBadge={soakBadge}
                  onOpenApp={handleOpenApp}
                  onInspectComposition={handleInspectComposition}
                  onNavigateToOptIns={onNavigateToOptIns}
                  onNavigateToRelease={onNavigateToRelease}
                  onAskOtto={onAskOtto}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* Zone 4: Compact Home Lab Appliances Strip (Bottom Edge) */}
      {isInitialSyncComplete && (
        <ApplianceStatusStrip
          appliances={appliances}
          sslFleet={sslFleet}
          onNavigateToPki={onNavigateToPki}
        />
      )}

      {/* Release Composition Inspector Drawer */}
      <ReleaseCompositionDrawer
        app={selectedApp}
        isOpen={!!selectedApp}
        onClose={() => setSelectedApp(null)}
      />

      {/* Batch Deploy Modal (triggered from Deploy All Behind) */}
      {onTriggerDeployAll && (
        <BatchDeployModal
          isOpen={showBatchDeployModal}
          apps={apps}
          isProcessing={isDeployingAll}
          isInitialSyncComplete={isInitialSyncComplete}
          networkPosture={networkPosture}
          onCancel={() => setShowBatchDeployModal(false)}
          onConfirm={(opts) => {
            setShowBatchDeployModal(false);
            onTriggerDeployAll(
              opts.selectedApps,
              opts.bumpVersion,
              opts.allowDirty,
              opts.autoRollbackOnSmokeFailure
            );
          }}
        />
      )}
    </div>
  );
}
