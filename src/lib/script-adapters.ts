export interface ScriptActionExecution {
  scriptPath: string;
  command: string;
  args: string[];
  lockType: 'WshRemoteMutation' | 'LocalBackupIo' | 'PortainerApi' | 'PesterRunner' | 'None';
  elevated: boolean;
  workingDir?: string;
}

export function buildDeployCommand(
  appPath: string,
  options: {
    testMode?: boolean;
    fastMode?: boolean;
    allowDirty?: boolean;
    bumpVersion?: 'none' | 'patch' | 'minor' | 'major';
    rollbackToTag?: string;
  }
): ScriptActionExecution {
  const args: string[] = ['-ExecutionPolicy', 'Bypass', '-File', '.\\deploy-docker.ps1'];

  if (options.testMode) args.push('-Test');
  if (options.fastMode) args.push('-Fast');
  if (options.allowDirty) args.push('-AllowDirty');
  if (options.bumpVersion && options.bumpVersion !== 'none') {
    args.push('-BumpVersion', options.bumpVersion);
  }
  if (options.rollbackToTag) {
    args.push('-RollbackToTag', options.rollbackToTag);
  }

  return {
    scriptPath: `${appPath}\\deploy-docker.ps1`,
    command: 'pwsh.exe',
    args,
    lockType: 'WshRemoteMutation',
    elevated: false,
    workingDir: appPath,
  };
}

export function buildCloudflarePagesDeployCommand(
  appPath: string,
  options: {
    mode?: 'GitCi' | 'Wrangler';
    bumpVersion?: 'none' | 'patch' | 'minor' | 'major';
    allowDirty?: boolean;
    skipSmoke?: boolean;
    rollbackDeploymentId?: string;
    testMode?: boolean;
  }
): ScriptActionExecution {
  const args: string[] = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    '.\\deploy-cloudflare-pages.ps1',
  ];

  if (options.rollbackDeploymentId) {
    args.push('-RollbackDeploymentId', options.rollbackDeploymentId);
  } else {
    args.push('-Mode', options.mode || 'GitCi');
    if (options.bumpVersion && options.bumpVersion !== 'none') {
      args.push('-BumpVersion', options.bumpVersion);
    }
    if (options.allowDirty) args.push('-AllowDirty');
    if (options.skipSmoke) args.push('-SkipSmoke');
  }
  if (options.testMode) args.push('-Test');

  return {
    scriptPath: `${appPath}\\deploy-cloudflare-pages.ps1`,
    command: 'pwsh.exe',
    args,
    lockType: 'None',
    elevated: false,
    workingDir: appPath,
  };
}

export function buildDbManagerCommand(
  appPath: string,
  action: 'backup' | 'history' | 'apply-local',
  options?: {
    unattended?: boolean;
    archiveFile?: string;
  }
): ScriptActionExecution {
  const args: string[] = ['-ExecutionPolicy', 'Bypass', '-File', '.\\db-manager.ps1'];

  if (options?.unattended) args.push('-Unattended');
  if (action === 'backup') args.push('-Action', 'Backup');
  if (action === 'history') args.push('-Action', 'History');
  if (action === 'apply-local') {
    args.push('-Action', 'ApplyLocal');
    if (options?.archiveFile) args.push('-ArchiveFile', options.archiveFile);
  }

  return {
    scriptPath: `${appPath}\\db-manager.ps1`,
    command: 'pwsh.exe',
    args,
    lockType: action === 'backup' ? 'WshRemoteMutation' : 'LocalBackupIo',
    elevated: false,
    workingDir: appPath,
  };
}

export function buildSslCertCommand(
  toolsPath: string,
  options: {
    unattended?: boolean;
    forceRenewal?: boolean;
    skipDeploy?: boolean;
    skipRenew?: boolean;
    deployTargets?: string[];
    targetDevice?: string;
  }
): ScriptActionExecution {
  const scriptPath = `${toolsPath}\\ssl-cert-manager\\Get-SSLCerts.ps1`;
  const args: string[] = ['-ExecutionPolicy', 'Bypass', '-File', scriptPath];

  if (options.unattended) args.push('-Unattended');
  if (options.forceRenewal) args.push('-ForceRenewal');
  if (options.skipDeploy) args.push('-SkipDeploy');
  if (options.skipRenew) args.push('-SkipRenew');
  if (options.targetDevice) {
    args.push('-TargetDevice', options.targetDevice);
  }
  if (options.deployTargets && options.deployTargets.length > 0) {
    args.push('-DeployTargets', options.deployTargets.join(','));
  }

  return {
    scriptPath,
    command: 'pwsh.exe',
    args,
    lockType: 'WshRemoteMutation',
    elevated: false,
    workingDir: `${toolsPath}\\ssl-cert-manager`,
  };
}

export function buildCloudflareTunnelCommand(
  toolsPath: string,
  action: 'status' | 'check_update' | 'update' | 'update_force' | 'test'
): ScriptActionExecution {
  const scriptPath = `${toolsPath}\\cloudflare-tunnel\\deploy-cloudflare-tunnel.ps1`;
  const args: string[] = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];

  if (action === 'status') args.push('-Status');
  if (action === 'check_update') args.push('-CheckUpdate');
  if (action === 'update') args.push('-Update');
  if (action === 'update_force') args.push('-Update', '-Force');
  if (action === 'test') args.push('-Test');

  return {
    scriptPath,
    command: 'pwsh.exe',
    args,
    lockType: action === 'update' || action === 'update_force' ? 'WshRemoteMutation' : 'None',
    elevated: false,
    workingDir: `${toolsPath}\\cloudflare-tunnel`,
  };
}

export type ServiceLifecycleAction = 'verify_local' | 'status' | 'deploy' | 'test' | 'stop';

export function buildServiceScriptCommand(
  workspacePath: string,
  deployScript = './deploy-unifi-siem.ps1',
  action: ServiceLifecycleAction,
  options: { allowDirty?: boolean } = {}
): ScriptActionExecution {
  const normalizedScript = deployScript.startsWith('./') || deployScript.startsWith('.\\')
    ? deployScript.replace(/\//g, '\\')
    : `.\\${deployScript.replace(/^[./\\]+/, '').replace(/\//g, '\\')}`;
  const cleanDir = workspacePath.replace(/[\\/]+$/, '');
  const scriptPath = `${cleanDir}\\${normalizedScript.replace(/^\.\\/, '')}`;
  const args: string[] = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', normalizedScript];

  if (action === 'verify_local') args.push('-VerifyLocal');
  if (action === 'status') args.push('-Status');
  if (action === 'test') args.push('-Test');
  if (action === 'stop') args.push('-Stop');
  if (action === 'deploy' && options.allowDirty) args.push('-AllowDirty');

  return {
    scriptPath,
    command: 'pwsh.exe',
    args,
    lockType: action === 'deploy' || action === 'stop' ? 'WshRemoteMutation' : 'None',
    elevated: false,
    workingDir: cleanDir,
  };
}

export function buildRemoteSshCommand(remoteBashCommand: string): {
  command: string;
  args: string[];
} {
  const defaultKeyPath = 'C:\\Users\\rodrigo\\.ssh\\rsa-key-deployment';
  return {
    command: 'ssh.exe',
    args: [
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-i',
      defaultKeyPath,
      'root@wsh.panoramadr.com',
      remoteBashCommand,
    ],
  };
}

export function resolveSuiteRootFromAppPath(appPath: string): string {
  const normalized = appPath.replace(/[\\/]+$/, '');
  const lastSep = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  return lastSep > 0 ? normalized.slice(0, lastSep) : 'C:\\Users\\rodrigo\\Documents\\AG Projects';
}

const VALID_CRON_JOB_ID_REGEX = /^[a-z0-9][a-z0-9-]{1,31}$/;

export function buildCronSyncCommand(
  suiteRoot: string,
  options: {
    appPath?: string;
    allApps?: boolean;
    testMode?: boolean;
    testRunJobId?: string;
  }
): ScriptActionExecution {
  const engineRoot = `${suiteRoot.replace(/[\\/]+$/, '')}\\PanoramaDeployEngine\\engine`;
  const scriptPath = `${engineRoot}\\Invoke-CronSync.ps1`;
  const args: string[] = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];

  if (options.allApps) {
    args.push('-AllApps');
  } else if (options.appPath) {
    args.push('-AppPath', options.appPath);
  }

  if (options.testMode) {
    args.push('-Test');
  }
  if (options.testRunJobId !== undefined) {
    if (!VALID_CRON_JOB_ID_REGEX.test(options.testRunJobId)) {
      throw new Error(
        `Invalid cron job ID '${options.testRunJobId}': must match ${VALID_CRON_JOB_ID_REGEX.source}.`
      );
    }
    args.push('-TestRunJobId', options.testRunJobId);
  }

  return {
    scriptPath,
    command: 'pwsh.exe',
    args,
    lockType: options.testMode ? 'None' : 'WshRemoteMutation',
    elevated: false,
    workingDir: options.appPath || engineRoot,
  };
}
