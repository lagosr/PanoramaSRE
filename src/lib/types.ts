export type NavSectionId =
  | 'hud'
  | 'agent'
  | 'local-dev'
  | 'releases'
  | 'telemetry'
  | 'topology'
  | 'unifi-zbf'
  | 'dietpi'
  | 'edge'
  | 'security'
  | 'hardening'
  | 'opt-ins'
  | 'backups'
  | 'smoke'
  | 'settings';

export type HostingTarget = 'wsh-docker' | 'wsh-docker-service' | 'cloudflare-pages';

export type AutoOpenTier = 'A' | 'B' | 'C';
export type ConsoleAutoOpenMode = 'smart' | 'errors' | 'manual';
export type ConsoleDockSide = 'bottom' | 'right';
export type ConsoleScopeMode = 'page' | 'all';

export interface ReturnBreadcrumb {
  view: NavSectionId;
  label: string;
  tab?: string;
}

export interface NavigateContext {
  tab?: string;
  appSlug?: string;
  highlightId?: string;
  returnFromCurrent?: boolean;
  preserveReturn?: boolean;
}

export interface CloudflareAppConfig {
  pagesProject: string;
  primaryUrl: string;
  domains: string[];
  d1Binding?: string;
  d1DatabaseName?: string;
  d1DatabaseId?: string;
  deployMode?: string;
}

export interface ServiceAppConfig {
  protocol: 'udp' | 'tcp' | 'both' | 'none';
  bindIp: string;
  networkName: string;
  networkSubnet: string;
  hostEnvPath?: string;
  hostLogPath?: string;
  optionalDeployment?: boolean;
  requiresWshFirewall?: boolean;
}

export type WorkStreamSource = 'ui' | 'mcp' | 'scheduled' | 'supervisor' | 'agent';

export interface TerminalTab {
  id: string;
  title: string;
  lines: string[];
  isRunning: boolean;
  exitCode?: number;
  createdAt?: string;
  finishedAt?: string;
  pageScope?: NavSectionId;
  source?: WorkStreamSource;
  appSlug?: string;
  abortable?: boolean;
  autoOpenTier?: AutoOpenTier;
  batchGroupId?: string;
}

export interface CronJobDeclaration {
  id: string;
  description: string;
  schedule: string;
  script: string;
  args?: string[];
  shell?: '/bin/sh' | '/bin/bash' | string;
  user?: string;
  logRedirect?: string;
  enabled?: boolean;
  localScriptExists?: boolean;
  localScriptSha256?: string | null;
}

export interface WshCronFileTelemetry {
  name: string;
  mode: string;
  owner: string;
  has_crlf: boolean;
  ends_with_newline: boolean;
  content_sha256: string;
  content_raw: string;
}

export interface WshAppScriptTelemetry {
  app_dir: string;
  script_name: string;
  path: string;
  mode: string;
  owner: string;
  has_crlf: boolean;
  sha256: string;
  syntax_ok: boolean;
}

export interface WshCronTelemetry {
  cron_d_files: WshCronFileTelemetry[];
  app_scripts: WshAppScriptTelemetry[];
  recent_runs_raw: string;
}

export type CronAuditStatus =
  | 'IN_SYNC'
  | 'MISSING'
  | 'DRIFTED'
  | 'LEGACY_UNMIGRATED'
  | 'INVALID_FORMAT'
  | 'DAEMON_DOWN'
  | 'UNKNOWN';

export interface CronJobAuditResult {
  job: CronJobDeclaration;
  scriptName: string;
  remoteScriptPath: string;
  liveScript: WshAppScriptTelemetry | null;
  scriptExistsOnWsh: boolean;
  permissionsOk: boolean;
  crlfClean: boolean;
  syntaxOk: boolean;
  shaMatch: boolean;
  lastRunLine: string | null;
  issues: string[];
}

export interface AppCronAuditReport {
  app: DiscoveredApp;
  slug: string;
  displayName: string;
  remoteAppRoot: string;
  expectedCronFileName: string;
  expectedCronContent: string;
  expectedCronSha256: string;
  liveCronFile: WshCronFileTelemetry | null;
  liveLegacyFiles: WshCronFileTelemetry[];
  status: CronAuditStatus;
  jobs: CronJobAuditResult[];
  issues: string[];
  recentLogLines: string[];
}

export interface FleetCronAuditSummary {
  cronServiceStatus: string;
  cronServiceActive: boolean;
  apps: AppCronAuditReport[];
  inSyncCount: number;
  attentionCount: number;
  unmanagedCronFiles: WshCronFileTelemetry[];
}

export interface AppManifest {
  schemaVersion: number;
  appId: string;
  slug: string;
  hostingTarget?: HostingTarget;
  displayName: string;
  portalTitle: string;
  description: string;
  basePath: string;
  port: number;
  containerName: string;
  composeProject: string;
  remoteAppRoot: string;
  dataVolume: string;
  localSqlitePath: string;
  themeColor: string;
  icon: string;
  hasDatabase?: boolean;
  portalOrder: number;
  roles: string[];
  cloudflare?: CloudflareAppConfig;
  service?: ServiceAppConfig;
  auth?: {
    slug: string;
    basePath: string;
    port: number;
  };
  sre: {
    deployScript: string;
    dbScript: string;
    devCommand: string;
    previewCommand?: string;
    healthEndpoint: string;
    healthCheckMode?: 'http' | 'docker-container';
    healthAuthMode?: string;
    manifestEndpoint?: string;
    testCommand: string;
    typecheckCommand: string;
    requiresAuthInDev: boolean;
    automatedBackupDefault: boolean;
    exposeInRemotePortal: boolean;
    syncManifestOnDeploy?: boolean;
    supportsRollback?: boolean;
    supportsDryRun?: boolean;
    supportsVerifyLocal?: boolean;
    supportsStatus?: boolean;
    supportsStop?: boolean;
    cronJobs?: CronJobDeclaration[];
    cronLegacyFiles?: string[];
  };
}

export type BuildTelemetryStatus = 'OPTIMAL' | 'WARN_REGRESSION' | 'WARN_BUDGET' | 'WARN_CEILING';

export interface DeployStageTimings {
  stage1_typecheck_sec: number;
  semver_bump_sec: number;
  stage2_build_sec: number;
  stage3_preflight_sec: number;
  stage4_upload_sec: number;
  stage5_snapshot_sec: number;
  stage5_swap_sec: number;
  stage5_verify_sec: number;
  stage5_smoke_sec: number;
  stage5_finalize_sec: number;
  stage5_cron_sec: number;
  stage5_manifest_sync_sec: number;
  total_deploy_sec: number;
}

export interface BuildTelemetry {
  profile: string;
  cache_posture: 'cached' | 'warm' | 'cold';
  status: BuildTelemetryStatus;
  total_duration_sec: number;
  host_typecheck_sec: number;
  types_prevalidated: boolean;
  context_transfer_kb: number;
  deps_stage_sec: number;
  deps_cache_hit: boolean;
  next_build_sec: number;
  turbopack_compile_sec: number;
  next_typecheck_sec: number;
  page_data_sec: number;
  arm64_natives_sec: number;
  arm64_natives_cache_hit: boolean;
  elf_verified_count: number;
  elf_gate_cache_hit?: boolean;
  export_tar_sec: number;
  baseline_duration_sec?: number | null;
  delta_sec?: number | null;
  regression_pct?: number | null;
  warnings: string[];
  deploy_stages?: DeployStageTimings | null;
}

export interface DeployTelemetryRunRecord {
  id: string;
  console_session_id?: string | null;
  app_slug: string;
  app_name: string;
  started_at: string;
  finished_at?: string | null;
  wall_duration_sec?: number | null;
  exit_code?: number | null;
  engine_version?: string | null;
  release_id?: string | null;
  cache_posture: 'cached' | 'warm' | 'cold' | 'static' | 'legacy' | string;
  status: string;
  host_typecheck_sec?: number | null;
  semver_bump_sec?: number | null;
  build_total_sec?: number | null;
  deps_stage_sec?: number | null;
  deps_cache_hit?: boolean | null;
  next_build_sec?: number | null;
  arm64_natives_sec?: number | null;
  arm64_natives_cache_hit?: boolean | null;
  export_tar_sec?: number | null;
  context_transfer_kb?: number | null;
  elf_verified_count?: number | null;
  stage3_preflight_sec?: number | null;
  stage4_upload_sec?: number | null;
  stage5_snapshot_sec?: number | null;
  stage5_swap_sec?: number | null;
  stage5_verify_sec?: number | null;
  stage5_smoke_sec?: number | null;
  stage5_finalize_sec?: number | null;
  stage5_cron_sec?: number | null;
  stage5_manifest_sync_sec?: number | null;
  bumped: boolean;
  ran_smoke: boolean;
  warnings: string[];
  source: 'sre-ui' | 'cli' | 'backfill' | string;
}

export interface DockerDiskCategoryUsage {
  total_count: number;
  active_count: number;
  size_bytes: number;
  reclaimable_bytes: number;
}

export interface LocalDockerDiskUsage {
  images: DockerDiskCategoryUsage;
  containers: DockerDiskCategoryUsage;
  volumes: DockerDiskCategoryUsage;
  build_cache: DockerDiskCategoryUsage;
  captured_at: string;
  error?: string | null;
}

export interface BatchPreDeploySnapshot {
  slug: string;
  displayName: string;
  preBatchTag: string | null;
  hasDbMigration: boolean;
  deployOrderIndex: number;
}

export type BatchRollbackDecisionAction =
  | 'TARGETED_AUTO_ROLLBACK'
  | 'MANUAL_RECOVERY_REQUIRED'
  | 'EXTERNAL_OR_NON_BATCH_FAILURE';

export interface BatchSmokeAttributionResult {
  action: BatchRollbackDecisionAction;
  implicatedBatchSlugs: string[];
  rollbackPlan: BatchPreDeploySnapshot[];
  idpFirstRollbackNeeded: boolean;
  blockedByDbMigrationSlugs: string[];
  missingTagSlugs: string[];
  nonBatchFailedChecks: SmokeCheckResult[];
  externalFailedChecks: SmokeCheckResult[];
  unattributableFailedChecks: SmokeCheckResult[];
  summaryReason: string;
}

export interface BatchSmokeFailureReport {
  triggeredAt: string;
  smokeRunId?: string | null;
  triggeredBy: string;
  deployedApps: BatchPreDeploySnapshot[];
  failedChecks: SmokeCheckResult[];
  attribution: BatchSmokeAttributionResult;
  autoRollbackAttempted: boolean;
  autoRollbackSummary?: string | null;
}

export interface ReleaseInfo {
  release_id: string;
  semver: string;
  image_tag: string;
  commit_sha: string;
  commit_short: string;
  commit_subject: string;
  branch: string;
  dirty: boolean;
  deployed_at: string;
  deps_lock_sha256?: string;
  build_telemetry?: BuildTelemetry | null;
}

export interface AppHealth {
  status: string;
  version?: string;
  deployed_at?: string;
  database?: string;
  timestamp?: string;
  release?: ReleaseInfo;
  metrics?: Record<string, unknown>;
}

export interface PendingCommit {
  sha: string;
  subject: string;
  author: string;
  committed_at: string;
}

export interface ChangedFileItem {
  status: string;
  path: string;
}

export interface GitReleaseCandidate {
  tag: string;
  commit_short: string;
  committed_at: string;
  subject: string;
  is_deployed: boolean;
}

export interface AppCompositionReport {
  app_id: string;
  state: 'IN_SYNC' | 'LOCAL_WIP' | 'AHEAD' | 'DIRTY_PROD' | 'DIVERGED' | 'LEGACY_UNSTAMPED' | 'PROD_UNREACHABLE';
  local_head_sha: string;
  local_head_short: string;
  local_branch: string;
  local_dirty: boolean;
  dirty_files: ChangedFileItem[];
  prod_sha: string | null;
  prod_release_id: string | null;
  prod_dirty: boolean;
  ahead_count: number;
  behind_count: number;
  undeployed_commits: PendingCommit[];
  changed_files_since_prod: ChangedFileItem[];
  blast_radius_badges: string[];
  new_env_keys: string[];
  recent_candidates?: GitReleaseCandidate[];
  local_build_telemetry?: BuildTelemetry | null;
}

export type DevServerStatus = 'STOPPED' | 'RUNNING_MANAGED' | 'RUNNING_EXTERNAL';

export interface DevServerInfo {
  app_id: string;
  status: DevServerStatus;
  pid: number | null;
  port: number;
  base_path: string;
  local_url: string;
  sqlite_path: string | null;
  sqlite_size_bytes: number | null;
  sqlite_user_version: number | null;
}

export interface DayBackupStatus {
  date: string;
  day_label: string;
  status: 'Success' | 'Failed' | 'NoRun';
  run_count: number;
}

export interface GfsTiersBreakdown {
  daily_count: number;
  weekly_count: number;
  monthly_count: number;
  total_archives: number;
}

export interface LocalBackupArchive {
  file_name: string;
  full_path: string;
  size_bytes: number;
  schema_version: number;
  date_str: string;
  timestamp_str: string;
  is_auto_gfs: boolean;
  gfs_tier: 'Daily' | 'Weekly' | 'Monthly' | string;
  health_snapshot: Record<string, unknown> | null;
}

export interface BackupScanResult {
  backup_dir: string;
  archives: LocalBackupArchive[];
  gfs_breakdown: GfsTiersBreakdown;
}

export interface DiscoveredApp {
  manifest: AppManifest;
  workspacePath: string;
  health?: AppHealth;
  devServer?: DevServerInfo;
  provenanceState: 'IN_SYNC' | 'AHEAD' | 'LOCAL_WIP' | 'DIRTY_PROD' | 'DIVERGED' | 'LEGACY_UNSTAMPED' | 'PROD_UNREACHABLE' | 'UNKNOWN';
  composition?: AppCompositionReport;
  latencyMs?: number;
}

export type NetworkPosture = 'LAN_DIRECT' | 'WAN_CLOUDFLARE' | 'OFFLINE';

export interface ApplianceStatus {
  key: string;
  name: string;
  host: string;
  status: 'ONLINE' | 'OFFLINE';
  http_code: number | null;
  latency_ms: number;
}

export interface AppBackupDetail {
  app_name: string;
  status: string;
  file: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  error?: string | null;
}

export interface BackupRecord {
  timestamp: string;
  status: 'Success' | 'Failed';
  run_type?: string | null;
  total_apps: number;
  total_size_bytes: number | null;
  destination: string;
  app_details?: AppBackupDetail[];
  pruned_files?: Record<string, string[]>;
}

export interface PageantStatus {
  is_running: boolean;
  has_key_loaded: boolean;
  key_path: string;
  pageant_executable: string;
  message: string;
}

export interface BackupLedgerSummary {
  history_file_exists: boolean;
  ledger_source_path: string;
  total_runs: number;
  successful_runs: number;
  failed_runs: number;
  runs_7d: number;
  successful_runs_7d: number;
  failed_runs_7d: number;
  daily_pips_7d: DayBackupStatus[];
  total_pruned_count: number;
  pruned_per_app?: Record<string, number>;
  last_run_timestamp: string | null;
  last_run_status: string | null;
  latest_app_details: AppBackupDetail[];
  recent_records: BackupRecord[];
}

export interface DockerNetworkContainerAttachment {
  Name: string;
  EndpointID?: string;
  MacAddress: string;
  IPv4Address: string;
  IPv6Address?: string;
}

export interface DockerNetworkDetail {
  Name: string;
  Id: string;
  Created?: string;
  Scope: string;
  Driver: string;
  EnableIPv6?: boolean;
  IPAM?: {
    Driver?: string;
    Config?: Array<{
      Subnet?: string;
      Gateway?: string;
    }>;
  };
  Internal?: boolean;
  Attachable?: boolean;
  Containers?: Record<string, DockerNetworkContainerAttachment>;
  Options?: Record<string, string>;
  Labels?: Record<string, string>;
}

export interface NetworkInterfaceAddrInfo {
  family: string;
  local: string;
  prefixlen: number;
  broadcast?: string;
  scope: string;
  label?: string;
}

export interface NetworkInterfaceDetail {
  ifindex?: number;
  ifname: string;
  flags: string[];
  mtu: number;
  qdisc?: string;
  operstate: string;
  group?: string;
  txqlen?: number;
  link_type?: string;
  address?: string;
  broadcast?: string;
  addr_info?: NetworkInterfaceAddrInfo[];
}

export interface NetworkRouteDetail {
  dst: string;
  dev: string;
  protocol?: string;
  scope?: string;
  prefsrc?: string;
  gateway?: string;
  flags?: string[];
}

export interface SecurityPostureInvariant {
  id: 'SEC-01' | 'SEC-02' | 'SEC-03' | 'SEC-04' | 'SEC-05' | 'SEC-06' | 'SEC-07' | 'SEC-08' | 'SEC-09';
  title: string;
  category: 'ROUTING' | 'PORT' | 'FIREWALL' | 'CONTAINMENT';
  status: 'PASS' | 'FAIL' | 'WARN';
  details: string;
  remediation: string;
  commandSnippet?: string;
  evidence?: string;
  evaluatedAt?: string;
}

export interface WshSnapshot {
  mode: string;
  hostname: string;
  kernel: string;
  uptime_secs: number;
  dietpi_version: string;
  dietpi_update_available: string;
  reboot_required: boolean;
  rpi_throttled: string;
  services: {
    lighttpd?: string;
    docker?: string;
    ssh?: string;
    cron?: string;
  };
  listening_ports: number[];
  lighttpd_routes_raw: string;
  containers: Array<{
    ID?: string;
    Names?: string;
    Image?: string;
    Status?: string;
    State?: string;
    Ports?: string;
  }>;
  container_stats: Array<{
    Name?: string;
    CPUPerc?: string;
    MemUsage?: string;
    MemPerc?: string;
    NetIO?: string;
    BlockIO?: string;
  }>;
  images: Array<{
    Repository?: string;
    Tag?: string;
    ID?: string;
    Size?: string;
  }>;
  cloudflared: {
    version_raw?: string;
    recent_logs?: string;
  };
  apt_upgradable_raw: string;
  data_volumes_raw: string;
  docker_df: Array<Record<string, unknown>>;
  release_ledgers: Record<string, unknown>;
  docker_networks?: DockerNetworkDetail[];
  network_interfaces?: NetworkInterfaceDetail[];
  network_routes?: NetworkRouteDetail[];
  listening_sockets_raw?: string;
  security_invariants?: SecurityPostureInvariant[];
  firewall_rules_raw?: string;
  docker_daemon_raw?: string;
  cron_telemetry?: WshCronTelemetry;
}

export type SslHealthStatus = 'HEALTHY' | 'EXPIRING_SOON' | 'CRITICAL' | 'EXPIRED' | 'MISSING' | 'SELF_SIGNED' | 'ERROR';

export type CertificateDriftStatus = 'IN_SYNC' | 'DRIFT_DETECTED' | 'LOCAL_ONLY' | 'LIVE_ONLY' | 'SELF_SIGNED' | 'UNREACHABLE' | 'UNKNOWN';

export interface SslCertificateDetails {
  exists: boolean;
  domain: string;
  subject: string;
  issuer: string;
  thumbprint: string;
  serial_number: string;
  not_after: string;
  days_remaining: number;
  status: SslHealthStatus;
  error?: string | null;
}

export interface LiveTlsProbeDetails {
  reachable: boolean;
  latency_ms: number;
  http_status?: number | null;
  domain: string;
  subject: string;
  issuer: string;
  thumbprint: string;
  serial_number: string;
  not_after: string;
  days_remaining: number;
  status: SslHealthStatus;
  error?: string | null;
}

export interface DomainSslDualProbe {
  device_key: string;
  display_name: string;
  domain: string;
  local_target_folder?: string | null;
  deploy_target_type: string;
  local_cert: SslCertificateDetails;
  live_cert: LiveTlsProbeDetails;
  drift_status: CertificateDriftStatus;
}

export interface SslFleetSummary {
  total_domains: number;
  healthy_count: number;
  expiring_soon_count: number;
  critical_count: number;
  drift_count: number;
  min_days_remaining: number;
  base_output_folder?: string | null;
  items: DomainSslDualProbe[];
  probed_at: string;
}

export type AppOperationalHealth =
  | 'healthy'
  | 'unhealthy'
  | 'optional_not_deployed'
  | 'pending_sync'
  | 'telemetry_unavailable';

export interface AppHealthEvalOptions {
  isInitialSyncComplete?: boolean;
  networkPosture?: NetworkPosture;
}

/**
 * Canonical evaluation of a discovered app's operational health across initial startup
 * sync, optional/telemetry-unavailable WSH services, and live HTTP or container probes.
 */
export function getAppOperationalHealth(
  app: DiscoveredApp,
  options: AppHealthEvalOptions = {}
): AppOperationalHealth {
  const isInitialSyncComplete = options.isInitialSyncComplete !== false;
  const isWshService = app.manifest?.hostingTarget === 'wsh-docker-service';
  const isHealthy = app.health?.status === 'healthy';

  if (!isInitialSyncComplete) {
    return isHealthy && app.provenanceState !== 'PROD_UNREACHABLE' ? 'healthy' : 'pending_sync';
  }

  if (isWshService) {
    if (isHealthy) {
      return 'healthy';
    }
    if (
      app.health?.status === 'not_deployed' &&
      Boolean(app.manifest?.service?.optionalDeployment)
    ) {
      return 'optional_not_deployed';
    }
    if (!app.health) {
      return 'telemetry_unavailable';
    }
    return 'unhealthy';
  }

  return isHealthy && app.provenanceState !== 'PROD_UNREACHABLE' ? 'healthy' : 'unhealthy';
}

export function isAppUnhealthy(
  app: DiscoveredApp,
  options: AppHealthEvalOptions = {}
): boolean {
  return getAppOperationalHealth(app, options) === 'unhealthy';
}

export function isAppCritical(
  app: DiscoveredApp,
  options: AppHealthEvalOptions = {}
): boolean {
  const op = getAppOperationalHealth(app, options);
  const isInitialSyncComplete = options.isInitialSyncComplete !== false;
  return (
    op === 'unhealthy' ||
    (isInitialSyncComplete && op === 'healthy' && app.provenanceState === 'DIRTY_PROD')
  );
}

export function isAppEvaluableForFleetCount(
  app: DiscoveredApp,
  options: AppHealthEvalOptions = {}
): boolean {
  const op = getAppOperationalHealth(app, options);
  return op === 'healthy' || op === 'unhealthy';
}

/**
 * Authoritative check to determine if an app has unreleased changes, local drift,
 * or is in an unhealthy / unreachable production state that requires deployment.
 */
export function isAppDeployCandidate(app: DiscoveredApp): boolean {
  const opHealth = getAppOperationalHealth(app, { isInitialSyncComplete: true });
  const isCritical =
    opHealth === 'unhealthy' ||
    (opHealth === 'healthy' && app.provenanceState === 'DIRTY_PROD');
  const hasDrift =
    (app.composition?.undeployed_commits?.length || 0) > 0 ||
    (app.composition?.ahead_count || 0) > 0 ||
    !!app.composition?.local_dirty ||
    app.provenanceState === 'AHEAD' ||
    app.provenanceState === 'LOCAL_WIP' ||
    app.provenanceState === 'DIVERGED';

  return isCritical || hasDrift;
}

/**
 * Derives live container-backed health and provenance state for `wsh-docker-service`
 * apps (such as headless UDP syslog collectors) from the latest WSH snapshot without
 * making HTTP `/api/health` requests.
 */
export function reconcileServiceAppsFromSnapshot(
  appList: DiscoveredApp[],
  snapshot: WshSnapshot | null | undefined
): DiscoveredApp[] {
  const containers = snapshot?.containers || [];
  return appList.map((app) => {
    if (app.manifest.hostingTarget !== 'wsh-docker-service') {
      return app;
    }
    const targetName = (app.manifest.containerName || app.manifest.slug).toLowerCase();
    const matched = containers.find((c) => {
      const cleanName = (c.Names || '').replace(/^\//, '').toLowerCase();
      return cleanName === targetName;
    });

    const dirty = Boolean(app.composition?.local_dirty);
    const hasPending = (app.composition?.undeployed_commits?.length || 0) > 0;

    if (matched && matched.State?.toLowerCase() === 'running') {
      return {
        ...app,
        health: {
          status: 'healthy',
          version: '1.0.0',
          deployed_at: matched.Status || 'Running',
          database: 'none',
        },
        provenanceState: dirty ? 'LOCAL_WIP' : 'IN_SYNC',
      };
    }

    if (matched) {
      return {
        ...app,
        health: {
          status: 'unhealthy',
          version: '1.0.0',
          deployed_at: matched.Status || matched.State || 'Stopped',
          database: 'none',
        },
        provenanceState: 'PROD_UNREACHABLE',
      };
    }

    if (!snapshot) {
      return {
        ...app,
        provenanceState: dirty ? 'LOCAL_WIP' : hasPending ? 'AHEAD' : 'UNKNOWN',
      };
    }

    return {
      ...app,
      health: {
        status: 'not_deployed',
        version: '',
        deployed_at: '',
        database: 'none',
      },
      provenanceState: dirty ? 'LOCAL_WIP' : hasPending ? 'AHEAD' : 'UNKNOWN',
    };
  });
}

export interface AgentActionSummary {
  action: string;
  slug?: string;
  timestamp: string;
  success: boolean;
  message?: string;
}

export interface McpBridgeStatus {
  isOnline: boolean;
  instanceId: string;
  pid: number;
  channel: 'installed' | 'dev' | 'portable';
  pipeName: string;
  totalRequests: number;
  activeConnections: number;
  securityAlerts: number;
  lastAction?: AgentActionSummary | null;
  siblingInstances: number;
  isPrimaryElected: boolean;
}

export interface SmokeCheckResult {
  name: string;
  category: string;
  passed: boolean;
  durationMs: number;
  detail: string;
}

export interface SmokeTestRun {
  id: string;
  timestamp: string;
  targetUrl: string;
  triggeredBy: string;
  envOnly: boolean;
  total: number;
  passed: number;
  failed: number;
  results: SmokeCheckResult[];
}

export interface CloudflareTunnelVersionStatus {
  runningVersion?: string | null;
  runningRaw?: string | null;
  latestVersion?: string | null;
  releaseUrl?: string | null;
  publishedAt?: string | null;
  isUpToDate?: boolean | null;
  updateAvailable: boolean;
  etag?: string | null;
  checkedAtIso: string;
  checkedAtEpoch: number;
  source: string;
  error?: string | null;
}

export interface CloudflareDeployment {
  id: string;
  short_id: string;
  environment: string;
  status?: string;
  url: string;
  created_on: string;
  branch?: string | null;
  commit_hash?: string | null;
  commit_message?: string | null;
  is_active: boolean;
}

export interface ParakithOptInRecord {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  consent: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  syncedAt?: string | null;
}

export interface OptInComplianceSnapshot {
  records: ParakithOptInRecord[];
  totalCount: number;
  consentedCount: number;
  declinedCount: number;
  last7dCount: number;
  maxId: number;
  lastSeenId: number;
  unreadCount: number;
  lastSyncedAt?: string | null;
  databaseName: string;
  syncError?: string | null;
}

export type TrustedNetworkState =
  | 'TRUSTED_HOME_OR_VPN'
  | 'ROAMING_UNTRUSTED'
  | 'ROAMING_DISCONNECTED'
  | 'OFFLINE';

export interface TrustedNetworkVerdict {
  state: TrustedNetworkState;
  isTrusted: boolean;
  wshResolvedIps: string[];
  matchedExpectedWshIp: boolean;
  wshReachable: boolean;
  canaryReachable: boolean;
  reason: string;
}

export interface PushoverCategoryPrefs {
  systemUpdates: boolean;
  appAndHostFailures: boolean;
  smokeFailures: boolean;
  sslAlerts: boolean;
  backupFailures: boolean;
  optInEvents: boolean;
  recoveryAlerts: boolean;
  ottoL2AutoActions?: boolean;
  ottoL3Approvals?: boolean;
  ottoCircuitBreaker?: boolean;
}

export interface PushoverPreferences {
  enabled: boolean;
  device: string;
  updateSound: string;
  failureSound: string;
  recoverySound: string;
  failurePriority: number;
  expectedWshIp: string;
  canaryHost: string;
  categories: PushoverCategoryPrefs;
}

export interface PushoverSettingsViewDto {
  configured: boolean;
  credentialSource: 'dpapi' | 'env_local_keys' | 'env' | 'none' | string;
  maskedToken: string;
  maskedUser: string;
  preferences: PushoverPreferences;
  networkGate: TrustedNetworkVerdict;
  trackedStateCount: number;
}

export interface SavePushoverSettingsInput {
  apiToken?: string | null;
  userKey?: string | null;
  clearStoredCredentials?: boolean;
  preferences: PushoverPreferences;
}

export interface PushoverSendReceipt {
  requestId: string;
  status: number;
  title: string;
}

export interface SyncAlertEvaluationInput {
  maintenanceSuppressed: boolean;
  apps?: Array<{
    slug: string;
    displayName: string;
    basePath: string;
    status: string;
    detail?: string | null;
  }>;
  appliances?: Array<{
    key: string;
    name: string;
    host: string;
    status: string;
  }>;
  wsh?: {
    dietpiVersion: string;
    dietpiUpdateAvailable: string;
    rebootRequired: boolean;
    kernel: string;
    rpiThrottled: string;
    lighttpdStatus: string;
    dockerStatus: string;
    sshStatus: string;
    aptUpgradableRaw: string;
    securityViolationCount: number;
    failingInvariants: string[];
  };
  tunnelVersion?: {
    runningVersion?: string | null;
    latestVersion?: string | null;
    updateAvailable: boolean;
    releaseUrl?: string | null;
  };
  sslDomains?: Array<{
    domain: string;
    displayName: string;
    status: string;
    driftStatus: string;
    daysRemaining: number;
    liveReachable: boolean;
    thumbprint: string;
  }>;
  backup?: {
    incidentKey?: string | null;
    lastRunStatus?: string | null;
    failedRuns7d: number;
    failedApps: string[];
  };
  latestSmokeRun?: {
    id: string;
    timestamp: string;
    triggeredBy: string;
    total: number;
    passed: number;
    failed: number;
    failedChecks: string[];
  };
}

export interface SyncEvaluationSummaryDto {
  skipped: boolean;
  skipReason?: string | null;
  networkState: TrustedNetworkState;
  dispatchedBatches: number;
  notifiedKeys: string[];
}

// ============================================================================
// 360° Threat Intelligence & Zero Trust Monitor DTOs
// ============================================================================

export type ThreatSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string;

export type IntrusionVerdict =
  | 'NO_EVIDENCE'
  | 'SUSPICIOUS_ACTIVITY'
  | 'LIKELY_INTRUSION'
  | 'LIKELY_COMPROMISE'
  | 'CONFIRMED_COMPROMISE'
  | string;

export interface ThreatIntelPreferences {
  enabled: boolean;
  cadenceHours: number;
  tier1Model: string;
  tier2Model: string;
  dailyCarbonCap: number;
  pushoverThreshold: string;
  unifiBaseUrl: string;
}

export interface ThreatIntelSettingsViewDto {
  cfConfigured: boolean;
  cfSource: 'dpapi' | 'env_local_keys' | 'env' | 'none' | string;
  maskedCfToken: string;
  cfAccountId: string;
  geminiConfigured: boolean;
  geminiSource: 'dpapi' | 'env_local_keys' | 'env' | 'none' | string;
  maskedGeminiKey: string;
  unifiConfigured: boolean;
  unifiSource: 'dpapi' | 'env_local_keys' | 'env' | 'none' | string;
  maskedUnifiKey: string;
  preferences: ThreatIntelPreferences;
  carbonUsedLast24h: number;
  windowsAutostartEnabled: boolean;
}

export interface SaveThreatIntelSettingsInput {
  cfApiToken?: string | null;
  cfAccountId?: string | null;
  geminiApiKey?: string | null;
  unifiApiKey?: string | null;
  clearCfToken?: boolean | null;
  clearGeminiKey?: boolean | null;
  clearUnifiKey?: boolean | null;
  preferences: ThreatIntelPreferences;
}

export interface ThreatAuditRunRow {
  id: string;
  startedAt: string;
  completedAt?: string | null;
  windowStart: string;
  windowEnd: string;
  windowHours: number;
  triggerSource: string;
  status: string;
  overallSeverity: ThreatSeverity;
  intrusionVerdict: IntrusionVerdict;
  tier1Model?: string | null;
  tier2Model?: string | null;
  escalatedToTier2: boolean;
  escalationReasonsJson?: string | null;
  collectorStatusesJson?: string | null;
  zonesSummaryJson?: string | null;
  zeroTrustSummaryJson?: string | null;
  internalSummaryJson?: string | null;
  geminiBriefJson?: string | null;
  tokenUsageJson?: string | null;
  errorMessage?: string | null;
}

export interface ThreatActorRow {
  id: string;
  actorType: string;
  ipAddress?: string | null;
  asn?: string | null;
  asOrg?: string | null;
  country?: string | null;
  intelTagsJson: string;
  intelSummary?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  runsSeen: number;
  totalRequests: number;
  totalOrigin200s: number;
  highestSeverity: ThreatSeverity;
  latestClassification?: string | null;
  targetHostsJson: string;
  samplePathsJson: string;
  disposition: 'ACTIVE' | 'SNOOZED' | 'ALLOWLISTED' | 'RESOLVED' | 'EXPIRED' | string;
  snoozedUntil?: string | null;
}

export interface ThreatFindingRow {
  id: string;
  runId: string;
  sourceLayer: string;
  ruleId: string;
  severity: ThreatSeverity;
  category: string;
  title: string;
  summary: string;
  host?: string | null;
  actorIp?: string | null;
  actorAsn?: string | null;
  rayIdsJson: string;
  evidenceJson: string;
  createdAt: string;
  disposition?: 'ACTIVE' | 'RESOLVED' | 'SNOOZED' | 'DISMISSED' | string;
  snoozedUntil?: string | null;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
}

export interface ThreatRunDetailDto {
  run: ThreatAuditRunRow;
  findings: ThreatFindingRow[];
}

export interface LanClientBaselineRow {
  macAddress: string;
  ipAddress?: string | null;
  hostname?: string | null;
  networkVlan?: string | null;
  ouiVendor?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  isTrusted: boolean;
  label: string;
}

export interface ThreatAllowlistRow {
  id: string;
  entryType: string;
  value: string;
  label: string;
  createdAt: string;
}

export interface CollectorStatuses {
  cloudflare: string;
  unifi: string;
  wshAuth: string;
}

export interface CfZoneSummary {
  id: string;
  name: string;
  plan: string;
  totalRequests: number;
  totalBytes: number;
  error4xx5xx: number;
  firewallEventsCount: number;
  untrustedOrigin200s: number;
}

export interface CfTunnelInfo {
  id: string;
  name: string;
  status: string;
  activeConnections: number;
}

export interface CfAccessPolicyGrantDto {
  appUid: string;
  appName: string;
  appDomain: string;
  policyId: string;
  policyName: string;
  decision: string;
  precedence: number;
  reusable: boolean;
  sessionDuration?: string | null;
  policyCreatedAt?: string | null;
  policyUpdatedAt?: string | null;
  viaGroupId?: string | null;
  viaGroupName?: string | null;
}

export interface CfAttachedAccessPolicyDto {
  appUid: string;
  appName: string;
  appDomain: string;
  policyId: string;
  policyName: string;
  decision: string;
  precedence: number;
  reusable: boolean;
  sessionDuration?: string | null;
  policyCreatedAt?: string | null;
  policyUpdatedAt?: string | null;
  emailCount: number;
  emails: string[];
  broadRules: string[];
}

export interface QuarantinedAccessEmailRow {
  email: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REMOVED' | string;
  policyGrantsJson: string;
  firstSeenAt: string;
  lastSeenAt: string;
  reviewedAt?: string | null;
  removedAt?: string | null;
  reviewNote?: string | null;
}

export interface CfAccessPolicySyncResultDto {
  syncOk: boolean;
  permissionHint?: string | null;
  attachedPolicies: CfAttachedAccessPolicyDto[];
  quarantinedEmails: QuarantinedAccessEmailRow[];
  newlyQuarantinedCount: number;
  pendingCount: number;
  autoRevokedCount: number;
}

export interface VerifiedFamilySessionDto {
  email: string;
  ipAddress: string;
  asn?: string;
  asOrg?: string;
  country?: string;
  authSource: string;
  requests: number;
  origin200s: number;
  hosts: string[];
}

export interface ZeroTrustSummary {
  accessAppCount: number;
  accessAllowed: number;
  accessDenied: number;
  tunnels: CfTunnelInfo[];
  auditMutations: number;
  verifiedFamilySessions?: VerifiedFamilySessionDto[];
  attachedAccessPolicies?: CfAttachedAccessPolicyDto[];
  accessPoliciesSyncOk?: boolean;
  accessPoliciesPermissionHint?: string | null;
}

export interface InternalNetworkSummary {
  unifiDevicesTotal: number;
  unifiOfflineDevices: string[];
  unifiClientsTotal: number;
  newUnknownLanMacs: string[];
  unifiPoliciesTotal: number;
  panoramaAuthAvailable: boolean;
  panoramaAuthAnomalies: number;
  sshAnomalyCount: number;
  unifiSiemCefEvents: number;
  unifiCefSecurityAlerts: number;
}

export interface GeminiCampaignDto {
  name: string;
  severity: ThreatSeverity;
  sourceLayers: string[];
  targetHosts: string[];
  pattern: string;
  countEstimate: number;
  sampleRayIds: string[];
  suggestedWafExpression?: string | null;
}

export interface GeminiActorAssessmentDto {
  identifier: string;
  classification: string;
  threatScore: number;
  intentSummary: string;
  isRepeatEscalating: boolean;
}

export interface GeminiActionDto {
  priority: 'IMMEDIATE' | 'SOON' | 'MONITOR' | string;
  surface: string;
  action: string;
  rationale: string;
  wafRuleSnippet?: string | null;
}

export interface GeminiBriefDto {
  overallSeverity: ThreatSeverity;
  intrusionVerdict: IntrusionVerdict;
  escalateToTier2: boolean;
  escalationReasons: string[];
  suspectIps: string[];
  suspectMacs: string[];
  executiveSummary: string;
  zeroTrustAssessment: string;
  internalNetworkAssessment: string;
  attackCampaigns: GeminiCampaignDto[];
  actorAssessments: GeminiActorAssessmentDto[];
  recommendedActions: GeminiActionDto[];
}

export interface UnifiSiemEnvConfigDto {
  envPath: string;
  exists: boolean;
  allowedIps: string;
  suggestedIps: string;
}

export interface ThreatAuditProgressEvent {
  runId: string;
  stage:
    | 'init'
    | 'collectors'
    | 'stage0'
    | 'stage1'
    | 'forensics'
    | 'stage2'
    | 'persist'
    | 'done'
    | 'error'
    | string;
  label: string;
  message: string;
  level: 'INFO' | 'PASS' | 'WARN' | 'ERROR' | string;
  timestamp: string;
}

export interface UnifiNetworkDto {
  id: string;
  name: string;
  vlanId?: number | null;
  enabled: boolean;
  isDefault: boolean;
  zoneId?: string | null;
  zoneName?: string | null;
  subnetCidr?: string | null;
  gatewayIp?: string | null;
  isolationEnabled: boolean;
  internetAccessEnabled: boolean;
  mdnsForwardingEnabled: boolean;
  origin: string;
  clientCount: number;
}

export interface UnifiZoneDto {
  id: string;
  name: string;
  origin: string;
  networkIds: string[];
  networkNames: string[];
  vlanIds: number[];
  clientCount: number;
}

export interface UnifiPolicyDto {
  id: string;
  name: string;
  action: string;
  enabled: boolean;
  description?: string | null;
  index: number;
  origin: string;
  sourceZoneId?: string | null;
  destinationZoneId?: string | null;
  allowReturnTraffic: boolean;
  hasSourceFilter: boolean;
  sourceFilterSummary?: string | null;
  hasDestinationFilter: boolean;
  destinationFilterSummary?: string | null;
  protocol?: string | null;
  connectionStates: string[];
  loggingEnabled: boolean;
  scheduleMode?: string | null;
}

export interface UnifiClientTopologyDto {
  id: string;
  macAddress: string;
  ipAddress?: string | null;
  name?: string | null;
  hostname?: string | null;
  networkName?: string | null;
  vlanId?: number | null;
  zoneName?: string | null;
  ouiVendor?: string | null;
  clientType?: string | null;
}

export interface UnifiTopologySnapshotDto {
  baseUrl: string;
  appVersion: string;
  capturedAt: string;
  sites: Array<{ id: string; name: string; internalReference?: string | null }>;
  devices: Array<{
    id: string;
    name: string;
    macAddress: string;
    ipAddress?: string | null;
    model?: string | null;
    state: string;
    firmwareVersion?: string | null;
  }>;
  clients: UnifiClientTopologyDto[];
  policies: UnifiPolicyDto[];
  networks: UnifiNetworkDto[];
  zones: UnifiZoneDto[];
}

export interface CfWafRuleDto {
  id: string;
  zoneId: string;
  zoneName: string;
  description: string;
  action: string;
  expression: string;
  enabled: boolean;
  source: 'cloudflare_live' | 'manual_override' | string;
}

export interface CfZoneWafBudgetDto {
  zoneId: string;
  zoneName: string;
  plan: string;
  freePlanLimit: number;
  rulesUsed: number;
  enabledRules: number;
  readStatus: 'ok' | 'forbidden' | 'error' | string;
  statusMessage?: string | null;
}

export interface CloudflareWafSnapshotDto {
  capturedAt: string;
  wafReadOk: boolean;
  wafReadStatus: 'ok' | 'forbidden' | 'not_configured' | 'error' | string;
  permissionHint?: string | null;
  zones: CfZoneWafBudgetDto[];
  rules: CfWafRuleDto[];
}

export interface SreDbStats {
  dbPath: string;
  dbSizeBytes: number;
  walSizeBytes: number;
  shmSizeBytes: number;
  totalSizeBytes: number;
  logCount: number;
  consoleSessionCount: number;
  threatRunCount: number;
  journalMode: string;
}

// ============================================================================
// Otto — Autonomous AI Agent SRE (Phase 1+ Contracts)
// ============================================================================

export type OttoRuntimePhase =
  | 'IDLE'
  | 'SENSING'
  | 'STAGE0_EVAL'
  | 'THINKING'
  | 'STAGING'
  | 'ACTING'
  | 'VERIFYING'
  | 'AWAITING_APPROVAL'
  | 'TRIPPED'
  | 'PAUSED';

export interface OttoLifecycleSnapshot {
  state: OttoRuntimePhase;
  phaseLabel: string;
  activeModel?: string | null;
  thinkingLevel?: string | null;
  currentTarget?: string | null;
  summary: string;
  startedAt?: string | null;
  traceRunId?: string | null;
  canAbort: boolean;
  killSwitchActive: boolean;
  circuitBreakerState: string;
  pendingApprovalsCount: number;
  activeSoaksCount: number;
  dailyT1Calls: number;
  dailyT2Calls: number;
  droppedNoise24hCount: number;
}

export interface OttoAgentStateRow {
  killSwitchActive: boolean;
  circuitBreakerState: string;
  trippedReason?: string | null;
  trippedAt?: string | null;
  consecutiveFailures: number;
  dailyT1Calls: number;
  dailyT2Calls: number;
  budgetDateUtc: string;
  droppedNoise24hCount: number;
  updatedAt: string;
}

export interface SuricataGatekeeperStatusDto {
  usedLast120s: number;
  maxPer120s: number;
  windowSecs: number;
  remaining: number;
  nextSlotInSecs: number;
  gatekeeperKeyPath: string;
  gatekeeperKeyExists: boolean;
  gatekeeperVerified: boolean;
  lastProbeAt?: string | null;
  lastProbeDetail: string;
}

export interface OttoStatusDto {
  lifecycle: OttoLifecycleSnapshot;
  agentState: OttoAgentStateRow;
  suricata: SuricataGatekeeperStatusDto;
  geminiConfigured: boolean;
  defaultTier1Model: string;
  defaultTier2Model: string;
  dailyT2Cap: number;
}

export interface OttoPolicyRow {
  actionId: string;
  domain: string;
  label: string;
  description: string;
  assetTier: string;
  mode: string;
  maxAllowedMode: string;
  cooldownSecs: number;
  shadowRunsCount: number;
  shadowAgreedCount: number;
  promotedAt?: string | null;
  updatedAt: string;
}

export interface OttoL4Invariant {
  id: string;
  category: string;
  title: string;
  detail: string;
}

export interface OttoTraceRunRow {
  id: string;
  triggerKind: string;
  domain: string;
  assetSlug?: string | null;
  finalState: string;
  modelUsed?: string | null;
  thinkingLevel?: string | null;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  durationMs: number;
  outcomeSummary: string;
  errorText?: string | null;
  startedAt: string;
  completedAt?: string | null;
}

export interface OttoTraceStepRow {
  id: string;
  traceRunId: string;
  stepIndex: number;
  stepType: string;
  title: string;
  status: string;
  durationMs: number;
  thinkingSummaryMd?: string | null;
  structuredPayloadJson?: string | null;
  createdAt: string;
}

export interface OttoTraceDetailDto {
  run: OttoTraceRunRow;
  steps: OttoTraceStepRow[];
}

export interface OttoTraceDebugBundleDto {
  traceRunId: string;
  markdown: string;
  json: string;
}

export interface OttoProposalRow {
  id: string;
  traceRunId?: string | null;
  domain: string;
  classification: string;
  assetSlug: string;
  assetTier: string;
  actionId: string;
  paramsJson: string;
  title: string;
  severity: string;
  confidence: number;
  rcaSummary: string;
  evidenceJson: string;
  diffPreview?: string | null;
  rollbackPlanJson?: string | null;
  blastRadiusFlagsJson: string;
  status: string;
  snoozedUntil?: string | null;
  createdAt: string;
  decidedAt?: string | null;
  executedAt?: string | null;
  verificationResultJson?: string | null;
}

export interface OttoChatThreadRow {
  id: string;
  title: string;
  contextSeedJson?: string | null;
  originView?: string | null;
  originEntityId?: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface OttoToolUsePill {
  tool: string;
  summary: string;
  itemsCount: number;
  durationMs: number;
}

export interface OttoChatMessageRow {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | string;
  contentMd: string;
  modelUsed?: string | null;
  thinkingLevel?: string | null;
  thinkingSummaryMd?: string | null;
  toolsUsedJson?: string | null;
  inlineProposalId?: string | null;
  traceRunId?: string | null;
  tokenUsageJson?: string | null;
  createdAt: string;
}

export interface OttoSavedPromptRow {
  id: string;
  title: string;
  promptText: string;
  category: string;
  createdAt: string;
}

export interface OttoContextSeed {
  kind:
    | 'threat_finding'
    | 'threat_actor'
    | 'quarantined_email'
    | 'hud_incident'
    | 'wsh_invariant'
    | 'app_release'
    | 'soak_session'
    | 'smoke_failure'
    | 'telemetry_alert'
    | 'dietpi_host'
    | 'backup_failure'
    | 'general';
  entityId: string;
  originView: NavSectionId;
  title: string;
  severity?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  starterPrompts: string[];
}

export interface OttoSoakSample {
  timestamp: string;
  healthy: boolean;
  latencyMs?: number | null;
  containerState?: string | null;
  detail: string;
}

export interface OttoSoakSessionRow {
  id: string;
  appSlug: string;
  hostingTarget: string;
  releaseId: string;
  previousImageTag?: string | null;
  hasDbMigration: boolean;
  startedAt: string;
  endsAt: string;
  status:
    | 'SOAKING'
    | 'HEALTHY_VERIFIED'
    | 'DEGRADED_SHADOW'
    | 'ESCALATED_L3'
    | 'ROLLING_BACK'
    | 'RECOVERING'
    | 'ROLLED_BACK'
    | 'CANCELLED'
    | 'SUPERSEDED'
    | string;
  samplesJson: string;
  traceRunId?: string | null;
  updatedAt: string;
}

export interface OttoSteadyStateResult {
  traceRunId: string;
  evaluatedChecks: number;
  proposalsCreated: string[];
  actionsExecuted: string[];
  summary: string;
}

export interface SendOttoChatMessageResult {
  userMessage: OttoChatMessageRow;
  assistantMessage: OttoChatMessageRow;
  traceRunId: string;
  inlineProposal?: OttoProposalRow | null;
  lifecycle: OttoLifecycleSnapshot;
}

export interface OttoLogDeltaProbeResult {
  ok: boolean;
  verb: string;
  detail: string;
  lineCount: number;
  preview: string;
  suricata: SuricataGatekeeperStatusDto;
}



