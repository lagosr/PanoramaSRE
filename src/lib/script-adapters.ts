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
