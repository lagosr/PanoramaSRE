export interface AppManifest {
  schemaVersion: number;
  appId: string;
  slug: string;
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
  portalOrder: number;
  roles: string[];
  sre: {
    deployScript: string;
    dbScript: string;
    devCommand: string;
    healthEndpoint: string;
    manifestEndpoint: string;
    testCommand: string;
    typecheckCommand: string;
    requiresAuthInDev: boolean;
    automatedBackupDefault: boolean;
    exposeInRemotePortal: boolean;
    syncManifestOnDeploy?: boolean;
  };
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

export interface LocalBackupArchive {
  file_name: string;
  full_path: string;
  size_bytes: number;
  schema_version: number;
  date_str: string;
  timestamp_str: string;
  is_auto_gfs: boolean;
  health_snapshot: Record<string, unknown> | null;
}

export interface BackupScanResult {
  backup_dir: string;
  archives: LocalBackupArchive[];
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

export interface BackupLedgerSummary {
  history_file_exists: boolean;
  ledger_source_path: string;
  total_runs: number;
  successful_runs: number;
  failed_runs: number;
  last_run_timestamp: string | null;
  last_run_status: string | null;
  latest_app_details: AppBackupDetail[];
  recent_records: BackupRecord[];
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
}

export type SslHealthStatus = 'HEALTHY' | 'EXPIRING_SOON' | 'CRITICAL' | 'EXPIRED' | 'MISSING' | 'ERROR';

export type CertificateDriftStatus = 'IN_SYNC' | 'DRIFT_DETECTED' | 'LOCAL_ONLY' | 'LIVE_ONLY' | 'UNREACHABLE' | 'UNKNOWN';

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
  items: DomainSslDualProbe[];
  probed_at: string;
}
