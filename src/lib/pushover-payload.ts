import {
  ApplianceStatus,
  BackupLedgerSummary,
  CloudflareTunnelVersionStatus,
  DiscoveredApp,
  SecurityPostureInvariant,
  SmokeTestRun,
  SslFleetSummary,
  SyncAlertEvaluationInput,
  WshSnapshot,
} from './types';

export interface BuildSyncAlertPayloadParams {
  maintenanceSuppressed?: boolean;
  apps?: DiscoveredApp[];
  appliances?: ApplianceStatus[];
  wshSnapshot?: WshSnapshot | null;
  securityViolationCount?: number;
  failingInvariants?: SecurityPostureInvariant[];
  tunnelVersion?: CloudflareTunnelVersionStatus | null;
  sslFleet?: SslFleetSummary | null;
  backupLedger?: BackupLedgerSummary | null;
  backupIncidentKey?: string | null;
  isBackupIncidentDismissed?: boolean;
  latestSmokeRun?: SmokeTestRun | null;
}

/**
 * Normalizes periodic PanoramaSRE telemetry slices into the deterministic DTO
 * consumed by the Rust `evaluate_and_notify_sync` Pushover engine.
 */
export function buildSyncAlertEvaluationInput(
  params: BuildSyncAlertPayloadParams
): SyncAlertEvaluationInput {
  const out: SyncAlertEvaluationInput = {
    maintenanceSuppressed: Boolean(params.maintenanceSuppressed),
  };

  if (params.apps && params.apps.length > 0) {
    out.apps = params.apps
      .filter(
        (a) =>
          !(
            a.manifest.hostingTarget === 'wsh-docker-service' &&
            (!a.health ||
              (a.manifest.service?.optionalDeployment && a.health.status === 'not_deployed'))
          )
      )
      .map((a) => {
        const status = a.health?.status === 'healthy'
          ? 'healthy'
          : a.health
          ? 'unhealthy'
          : 'unreachable';
        return {
          slug: a.manifest.slug,
          displayName: a.manifest.displayName,
          basePath: a.manifest.basePath,
          status,
          detail:
            status === 'healthy'
              ? null
              : a.health?.status
              ? `status=${a.health.status}`
              : 'No /api/health response',
        };
      });
  }

  if (params.appliances && params.appliances.length > 0) {
    out.appliances = params.appliances.map((appl) => ({
      key: appl.key,
      name: appl.name,
      host: appl.host,
      status: appl.status,
    }));
  }

  if (params.wshSnapshot) {
    const snap = params.wshSnapshot;
    out.wsh = {
      dietpiVersion: snap.dietpi_version || '',
      dietpiUpdateAvailable: snap.dietpi_update_available || '',
      rebootRequired: Boolean(snap.reboot_required),
      kernel: snap.kernel || '',
      rpiThrottled: snap.rpi_throttled || '0x0',
      lighttpdStatus: snap.services?.lighttpd || 'unknown',
      dockerStatus: snap.services?.docker || 'unknown',
      sshStatus: snap.services?.ssh || 'unknown',
      aptUpgradableRaw: snap.apt_upgradable_raw || '',
      securityViolationCount: params.securityViolationCount ?? 0,
      failingInvariants: (params.failingInvariants || []).map(
        (inv) => `${inv.id} ${inv.title}`
      ),
    };
  }

  if (params.tunnelVersion && params.tunnelVersion.latestVersion) {
    out.tunnelVersion = {
      runningVersion: params.tunnelVersion.runningVersion ?? null,
      latestVersion: params.tunnelVersion.latestVersion ?? null,
      updateAvailable: Boolean(params.tunnelVersion.updateAvailable),
      releaseUrl: params.tunnelVersion.releaseUrl ?? null,
    };
  }

  if (params.sslFleet && Array.isArray(params.sslFleet.items)) {
    out.sslDomains = params.sslFleet.items.map((item) => {
      const useLive = item.live_cert?.reachable;
      const effectiveStatus = useLive ? item.live_cert.status : item.local_cert.status;
      const effectiveDays = useLive
        ? item.live_cert.days_remaining
        : item.local_cert.days_remaining;
      const effectiveThumb = useLive
        ? item.live_cert.thumbprint
        : item.local_cert.thumbprint;
      return {
        domain: item.domain,
        displayName: item.display_name,
        status: effectiveStatus,
        driftStatus: item.drift_status,
        daysRemaining: effectiveDays,
        liveReachable: Boolean(item.live_cert?.reachable),
        thumbprint: effectiveThumb || '',
      };
    });
  }

  if (params.backupLedger && params.backupLedger.history_file_exists) {
    const failedApps = (params.backupLedger.latest_app_details || [])
      .filter((d) => d.status.toLowerCase() === 'failed')
      .map((d) => d.app_name);
    out.backup = {
      incidentKey: params.isBackupIncidentDismissed
        ? null
        : params.backupIncidentKey ?? null,
      lastRunStatus: params.backupLedger.last_run_status,
      failedRuns7d: params.backupLedger.failed_runs_7d || 0,
      failedApps,
    };
  }

  if (params.latestSmokeRun && !params.latestSmokeRun.envOnly) {
    const run = params.latestSmokeRun;
    const failedChecks = (run.results || [])
      .filter((r) => !r.passed)
      .map((r) => `[${r.category}] ${r.name}: ${r.detail}`);
    out.latestSmokeRun = {
      id: run.id,
      timestamp: run.timestamp,
      triggeredBy: run.triggeredBy,
      total: run.total,
      passed: run.passed,
      failed: run.failed,
      failedChecks,
    };
  }

  return out;
}
