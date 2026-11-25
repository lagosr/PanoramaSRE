import {
  ApplianceStatus,
  BackupLedgerSummary,
  CloudflareTunnelVersionStatus,
  DiscoveredApp,
  FleetCronAuditSummary,
  NavSectionId,
  NetworkPosture,
  OptInComplianceSnapshot,
  SecurityPostureInvariant,
  SmokeTestRun,
  SslFleetSummary,
  ThreatAuditRunRow,
  WshSnapshot,
  getAppOperationalHealth,
  isAppDeployCandidate,
  isAppEvaluableForFleetCount,
  isAppUnhealthy,
} from './types';

export type HudIncidentDomain =
  | 'apps'
  | 'hardening'
  | 'backups'
  | 'threat'
  | 'smoke'
  | 'ssl'
  | 'dietpi';

export type HudIncidentActionKind =
  | 'inspect_app'
  | 'open_releases'
  | 'reapply_hardening'
  | 'pen_audit'
  | 'open_hardening'
  | 'retry_backup'
  | 'open_backups'
  | 'open_threat'
  | 'open_smoke'
  | 'open_pki'
  | 'open_dietpi'
  | 'open_crons';

export interface HudIncidentAction {
  label: string;
  kind: HudIncidentActionKind;
  targetSlug?: string;
  threatTab?: 'overview' | 'external' | 'internal';
  threatFocusId?: string;
}

export interface HudIncidentItem {
  id: string;
  domain: HudIncidentDomain;
  domainLabel: string;
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
  meta?: string;
  todayProtectedLabel?: string;
  primaryAction: HudIncidentAction;
  secondaryAction?: HudIncidentAction;
}

export type HudScorecardTone = 'healthy' | 'warning' | 'critical' | 'syncing' | 'neutral';

export interface HudScorecardCard {
  id: 'fleet' | 'security' | 'host' | 'network' | 'pki-dr' | 'smoke-compliance';
  label: string;
  tone: HudScorecardTone;
  headline: string;
  subtext: string;
  badge?: string;
  targetView: NavSectionId;
  targetTab?: string;
}

export interface HudSynthesisInput {
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
  topThreatTargetTab?: 'overview' | 'external' | 'internal';
  topThreatFocusId?: string | null;
  securityViolationCount?: number;
  failingInvariants?: SecurityPostureInvariant[];
  hardeningPassingCount?: number;
  hardeningTotalCount?: number;
  isInitialSyncComplete: boolean;
  networkPosture?: NetworkPosture;
  scheduleSlots?: string[];
}

export function formatUptimeCompact(totalSeconds?: number | null): string {
  if (totalSeconds === undefined || totalSeconds === null || totalSeconds < 0) {
    return '--';
  }
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function countAptUpgradable(raw?: string | null): number {
  if (!raw) return 0;
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('Listing...')).length;
}

export function getNextSmokeScheduleSlot(
  slots: string[] = ['08:00', '13:00', '17:00', '22:00'],
  now: Date = new Date()
): string {
  const safeSlots = slots.length > 0 ? slots : ['08:00', '13:00', '17:00', '22:00'];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  for (const slot of safeSlots) {
    const [hStr, mStr] = slot.split(':');
    const h = parseInt(hStr || '0', 10);
    const m = parseInt(mStr || '0', 10);
    if (Number.isFinite(h) && Number.isFinite(m) && h * 60 + m > currentMinutes) {
      return `Today ${slot}`;
    }
  }
  return `Tomorrow ${safeSlots[0]}`;
}

export function buildHudIncidentQueue(input: HudSynthesisInput): HudIncidentItem[] {
  if (!input.isInitialSyncComplete) {
    return [];
  }

  const posture = input.networkPosture ?? 'LAN_DIRECT';
  const items: HudIncidentItem[] = [];

  // 1. Production Apps
  const unhealthyApps = input.apps.filter((app) =>
    isAppUnhealthy(app, { isInitialSyncComplete: true, networkPosture: posture })
  );
  if (unhealthyApps.length > 0) {
    items.push({
      id: 'inc-apps',
      domain: 'apps',
      domainLabel: 'APPS',
      severity: 'critical',
      title: `${unhealthyApps.length} Production Application${unhealthyApps.length > 1 ? 's' : ''} Unhealthy`,
      detail: `Unreachable or degraded: ${unhealthyApps.map((a) => a.manifest.displayName).join(', ')}`,
      primaryAction: {
        label: 'Inspect Releases',
        kind: 'open_releases',
        targetSlug: unhealthyApps[0].manifest.slug,
      },
      secondaryAction: {
        label: `Inspect ${unhealthyApps[0].manifest.displayName}`,
        kind: 'inspect_app',
        targetSlug: unhealthyApps[0].manifest.slug,
      },
    });
  }

  // 2. WSH Hardening
  const secViolations = input.securityViolationCount ?? 0;
  const failingInvs = input.failingInvariants ?? [];
  if (secViolations > 0) {
    items.push({
      id: 'inc-hardening',
      domain: 'hardening',
      domainLabel: 'HARDENING',
      severity: 'critical',
      title: `${secViolations} WSH Network & Container Security Invariant${secViolations > 1 ? 's' : ''} Failed`,
      detail:
        failingInvs.length > 0
          ? failingInvs.map((inv) => `${inv.id}: ${inv.title}`).join('; ')
          : 'Host firewall or container bridge containment invariant is out of policy.',
      meta: 'WSH Hardening Monitor',
      primaryAction: {
        label: 'Re-Apply Hardening',
        kind: 'reapply_hardening',
      },
      secondaryAction: {
        label: 'Inspect Rules',
        kind: 'open_hardening',
      },
    });
  }

  // 3. Database Backups & DR
  const backupLedger = input.backupLedger;
  const isLastBackupFailed = backupLedger?.last_run_status?.toLowerCase() === 'failed';
  const failedBackupApps =
    backupLedger?.latest_app_details.filter((a) => a.status.toLowerCase() === 'failed') || [];
  const dailyPips = backupLedger?.daily_pips_7d || [];
  const todayPip = dailyPips.length > 0 ? dailyPips[dailyPips.length - 1] : undefined;
  const isTodayActionable =
    isLastBackupFailed || (todayPip !== undefined && todayPip.status !== 'Success');
  const missedOrFailed7dPips = dailyPips.filter((p) => p.status !== 'Success');
  const hasBackupIncident =
    !input.isBackupIncidentDismissed &&
    ((isLastBackupFailed && failedBackupApps.length > 0) || (backupLedger?.failed_runs_7d || 0) > 0);

  if (hasBackupIncident) {
    const detail =
      isLastBackupFailed && failedBackupApps.length > 0
        ? `Automated night backup job failed for: ${failedBackupApps.map((a) => a.app_name).join(', ')}.`
        : `Scheduled daily GFS backup was missed or failed on: ${missedOrFailed7dPips
            .map((p) => `${p.day_label} (${p.date})`)
            .join(', ')}.${
            !isTodayActionable && todayPip
              ? ` (Today's snapshot ${todayPip.date} is verified; past day cannot be backfilled).`
              : ''
          }`;

    items.push({
      id: 'inc-backups',
      domain: 'backups',
      domainLabel: 'BACKUPS & DR',
      severity: 'critical',
      title:
        isLastBackupFailed && failedBackupApps.length > 0
          ? `Automated Database Backup Failed Across ${failedBackupApps.length} App${failedBackupApps.length > 1 ? 's' : ''}`
          : `Automated Database Backup Missed or Failed (${backupLedger?.failed_runs_7d ?? 0} of ${backupLedger?.runs_7d || 7} Days)`,
      detail,
      meta: isLastBackupFailed ? 'Latest GFS Run' : '7-Day GFS Window',
      todayProtectedLabel:
        !isTodayActionable && todayPip ? `Today Protected (${todayPip.date})` : undefined,
      primaryAction: isTodayActionable
        ? {
            label: isLastBackupFailed ? 'Retry Backup' : "Run Today's Backup",
            kind: 'retry_backup',
          }
        : {
            label: 'Inspect Ledger',
            kind: 'open_backups',
          },
      secondaryAction: isTodayActionable
        ? {
            label: 'Inspect Ledger',
            kind: 'open_backups',
          }
        : undefined,
    });
  }

  // 4. 360 Threat & Zero Trust
  const threatCount = input.threatAlertCount ?? 0;
  if (threatCount > 0) {
    const verdict = input.latestThreatRun?.intrusionVerdict;
    const defaultTitle = `${threatCount} Actionable Security Finding${threatCount > 1 ? 's' : ''} Require Triage`;
    const defaultDetail = verdict
      ? `Latest 360° Threat verdict: ${verdict}. Review unmitigated edge actors or internal SIEM events.`
      : 'Unmitigated Cloudflare WAF / Zero Trust or internal UniFi SIEM findings detected.';
    const title = input.topThreatTitle
      ? threatCount === 1
        ? input.topThreatTitle
        : `${threatCount} Actionable Security Threats — ${input.topThreatTitle}`
      : defaultTitle;
    const detail = input.topThreatDetail || defaultDetail;
    items.push({
      id: 'inc-threat',
      domain: 'threat',
      domainLabel: 'THREAT SOC',
      severity: input.threatAlertSeverity === 'error' ? 'critical' : 'warning',
      title,
      detail,
      primaryAction: {
        label: input.topThreatFocusId ? 'Inspect High Threat' : 'Open Threat SOC',
        kind: 'open_threat',
        threatTab: input.topThreatTargetTab,
        threatFocusId: input.topThreatFocusId || undefined,
      },
    });
  }

  // 5. Production Smoke Tests
  const latestSmoke = input.smokeRuns?.[0];
  if (latestSmoke && latestSmoke.failed > 0) {
    items.push({
      id: 'inc-smoke',
      domain: 'smoke',
      domainLabel: 'SMOKE TESTS',
      severity: 'critical',
      title: `${latestSmoke.failed} of ${latestSmoke.total} Production Smoke Check${latestSmoke.failed > 1 ? 's' : ''} Failed`,
      detail: `Latest verification run (${latestSmoke.triggeredBy}) reported ${latestSmoke.failed} failing assertion${latestSmoke.failed > 1 ? 's' : ''}.`,
      primaryAction: {
        label: 'Inspect Smoke Run',
        kind: 'open_smoke',
      },
    });
  }

  // 6. PKI & SSL Certificates
  const ssl = input.sslFleet;
  const sslIssueCount = ssl
    ? ssl.critical_count + ssl.expiring_soon_count + ssl.drift_count
    : 0;
  if (ssl && sslIssueCount > 0) {
    items.push({
      id: 'inc-ssl',
      domain: 'ssl',
      domainLabel: 'PKI & TLS',
      severity: ssl.critical_count > 0 ? 'critical' : 'warning',
      title: `${sslIssueCount} Certificate Alert${sslIssueCount > 1 ? 's' : ''} (Min ${ssl.min_days_remaining}d Remaining)`,
      detail: `${ssl.critical_count} critical (<7d), ${ssl.expiring_soon_count} expiring (<30d), ${ssl.drift_count} live SHA-256 drift.`,
      primaryAction: {
        label: 'Open PKI Matrix',
        kind: 'open_pki',
      },
    });
  }

  // 7. DietPi Host & Crons
  if (input.wshSnapshot?.reboot_required) {
    items.push({
      id: 'inc-dietpi-reboot',
      domain: 'dietpi',
      domainLabel: 'DIETPI HOST',
      severity: 'warning',
      title: 'DietPi WSH Kernel / Library Reboot Required',
      detail: '/var/run/reboot-required is present on wsh.panoramadr.com after system updates.',
      primaryAction: {
        label: 'Open DietPi Host',
        kind: 'open_dietpi',
      },
    });
  }

  if (input.cronSummary && input.cronSummary.attentionCount > 0) {
    const daemonDown = !input.cronSummary.cronServiceActive;
    items.push({
      id: 'inc-dietpi-cron',
      domain: 'dietpi',
      domainLabel: 'HOST CRONS',
      severity: daemonDown ? 'critical' : 'warning',
      title: `Host Cron Attention Required (${input.cronSummary.attentionCount} ${input.cronSummary.attentionCount === 1 ? 'Target' : 'Targets'})`,
      detail: daemonDown
        ? `DietPi host cron daemon is '${input.cronSummary.cronServiceStatus}'.`
        : `Pending sync/migration: ${input.cronSummary.apps
            .filter((a) => a.status !== 'IN_SYNC')
            .map((a) => `${a.displayName} (${a.status})`)
            .join(', ')}.`,
      primaryAction: {
        label: 'Inspect & Sync Crons',
        kind: 'open_crons',
      },
    });
  }

  return items.sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === 'critical' ? -1 : 1;
  });
}

export function buildHudScorecard(input: HudSynthesisInput): HudScorecardCard[] {
  const posture = input.networkPosture ?? 'LAN_DIRECT';
  const synced = input.isInitialSyncComplete;
  const evalOpts = { isInitialSyncComplete: synced, networkPosture: posture };

  // 1. Production Fleet
  const evaluableApps = input.apps.filter((a) => isAppEvaluableForFleetCount(a, evalOpts));
  const healthyApps = evaluableApps.filter((a) => getAppOperationalHealth(a, evalOpts) === 'healthy');
  const unhealthyCount = synced
    ? input.apps.filter((a) => isAppUnhealthy(a, evalOpts)).length
    : 0;
  const behindCount = synced ? input.apps.filter(isAppDeployCandidate).length : 0;

  const fleetCard: HudScorecardCard = {
    id: 'fleet',
    label: 'Production Fleet',
    tone: !synced
      ? 'syncing'
      : unhealthyCount > 0
      ? 'critical'
      : behindCount > 0
      ? 'warning'
      : 'healthy',
    headline: !synced
      ? 'Syncing...'
      : `${healthyApps.length}/${evaluableApps.length || input.apps.length} UP`,
    subtext: !synced
      ? 'Polling fleet & git drift'
      : behindCount > 0
      ? `${behindCount} release candidate${behindCount > 1 ? 's' : ''}`
      : 'All releases in sync',
    targetView: 'releases',
  };

  // 2. Threat & Hardening
  const secViolations = input.securityViolationCount ?? 0;
  const hardeningTotal =
    input.hardeningTotalCount ?? input.wshSnapshot?.security_invariants?.length ?? 9;
  const hardeningPass =
    input.hardeningPassingCount ?? Math.max(0, hardeningTotal - secViolations);
  const threatCount = input.threatAlertCount ?? 0;
  const verdict = input.latestThreatRun?.intrusionVerdict || 'CLEAN';

  const securityCard: HudScorecardCard = {
    id: 'security',
    label: 'Threat & Hardening',
    tone: !synced
      ? 'syncing'
      : secViolations > 0 || input.threatAlertSeverity === 'error'
      ? 'critical'
      : threatCount > 0
      ? 'warning'
      : 'healthy',
    headline: !synced ? 'Checking...' : verdict,
    subtext: !synced
      ? 'Awaiting SOC & WSH scan'
      : `${hardeningPass}/${hardeningTotal} Hardened · ${threatCount} actionable`,
    targetView: secViolations > 0 && threatCount === 0 ? 'hardening' : 'security',
  };

  // 3. DietPi WSH Host
  const snap = input.wshSnapshot;
  const aptCount = countAptUpgradable(snap?.apt_upgradable_raw);
  const throttled = snap?.rpi_throttled && snap.rpi_throttled !== '0x0';
  const cronAttn = input.cronSummary?.attentionCount ?? 0;
  const cronDown = input.cronSummary ? !input.cronSummary.cronServiceActive : false;

  const hostCard: HudScorecardCard = {
    id: 'host',
    label: 'DietPi WSH Host',
    tone: !synced
      ? 'syncing'
      : cronDown || throttled
      ? 'critical'
      : !snap
      ? 'neutral'
      : snap.reboot_required || aptCount > 0 || cronAttn > 0
      ? 'warning'
      : 'healthy',
    headline: !synced
      ? 'Probing...'
      : !snap
      ? posture === 'WAN_CLOUDFLARE'
        ? 'LAN Required'
        : 'Host Unreachable'
      : snap.reboot_required
      ? 'Reboot Req'
      : throttled
      ? `Throttled (${snap.rpi_throttled})`
      : `Up ${formatUptimeCompact(snap.uptime_secs)}`,
    subtext: !synced
      ? 'Kernel, APT & cron check'
      : !snap
      ? 'Direct SSH telemetry paused'
      : `${aptCount} APT pkg · ${cronAttn > 0 ? `${cronAttn} cron drift` : 'Crons OK'}`,
    targetView: 'dietpi',
  };

  // 4. Network & Tunnel
  const tunnelContainer = snap?.containers?.find((c) =>
    (c.Names || '').toLowerCase().includes('cloudflared')
  );
  const tunnelRunning = tunnelContainer
    ? tunnelContainer.State === 'running'
    : undefined;
  const tunnelUpdate = Boolean(input.tunnelVersionStatus?.updateAvailable);
  const onlineAppliances = input.appliances.filter((a) => a.status === 'ONLINE').length;

  const networkCard: HudScorecardCard = {
    id: 'network',
    label: 'Network & Tunnel',
    tone: !synced
      ? 'syncing'
      : tunnelRunning === false
      ? 'critical'
      : tunnelUpdate || (input.appliances.length > 0 && onlineAppliances < input.appliances.length)
      ? 'warning'
      : posture === 'OFFLINE'
      ? 'critical'
      : 'healthy',
    headline: !synced
      ? 'Probing...'
      : tunnelRunning === true
      ? tunnelUpdate
        ? 'Tunnel Update'
        : 'Tunnel Up'
      : tunnelRunning === false
      ? 'Tunnel Down'
      : posture === 'WAN_CLOUDFLARE'
      ? 'WAN Cloudflare'
      : 'Ingress Ready',
    subtext: `${onlineAppliances}/${input.appliances.length} LAN Appliances`,
    targetView: 'topology',
  };

  // 5. PKI & Backups DR
  const ledger = input.backupLedger;
  const runs7d = ledger?.runs_7d ?? 0;
  const success7d = ledger?.successful_runs_7d ?? 0;
  const reliabilityPct = runs7d > 0 ? Math.round((success7d / runs7d) * 100) : null;
  const hasActiveBackupErr =
    synced && !input.isBackupIncidentDismissed && (ledger?.failed_runs_7d ?? 0) > 0;
  const ssl = input.sslFleet;
  const sslCrit = (ssl?.critical_count ?? 0) > 0;
  const sslWarn = ((ssl?.expiring_soon_count ?? 0) + (ssl?.drift_count ?? 0)) > 0;

  const pkiDrCard: HudScorecardCard = {
    id: 'pki-dr',
    label: 'PKI & Backups DR',
    tone: !synced
      ? 'syncing'
      : hasActiveBackupErr || sslCrit
      ? 'critical'
      : sslWarn
      ? 'warning'
      : 'healthy',
    headline: !synced
      ? 'Checking...'
      : reliabilityPct !== null
      ? `${reliabilityPct}% GFS (7d)`
      : 'GFS Ready',
    subtext: !synced
      ? 'Probing SSL & GFS ledger'
      : ssl
      ? `SSL min ${ssl.min_days_remaining}d${ssl.drift_count > 0 ? ` · ${ssl.drift_count} drift` : ''}`
      : 'SSL awaiting probe',
    targetView: hasActiveBackupErr ? 'backups' : 'edge',
  };

  // 6. Smoke & Compliance
  const latestSmoke = input.smokeRuns?.[0];
  const optInTotal = input.optInSnapshot?.totalCount ?? 0;
  const nextSlot = getNextSmokeScheduleSlot(input.scheduleSlots);

  const smokeCard: HudScorecardCard = {
    id: 'smoke-compliance',
    label: 'Smoke & Compliance',
    tone: !synced
      ? 'syncing'
      : latestSmoke && latestSmoke.failed > 0
      ? 'critical'
      : latestSmoke
      ? 'healthy'
      : 'neutral',
    headline: latestSmoke
      ? latestSmoke.failed > 0
        ? `${latestSmoke.failed} FAIL (${latestSmoke.passed}/${latestSmoke.total})`
        : `${latestSmoke.passed}/${latestSmoke.total} PASS`
      : 'No Smoke Runs',
    subtext: `Next ${nextSlot} · ${optInTotal} Opt-Ins`,
    targetView: 'smoke',
  };

  return [fleetCard, securityCard, hostCard, networkCard, pkiDrCard, smokeCard];
}
