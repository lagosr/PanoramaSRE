import { describe, it, expect } from 'vitest';
import {
  buildDeployCommand,
  buildCloudflarePagesDeployCommand,
  buildDbManagerCommand,
  buildSslCertCommand,
  buildCloudflareTunnelCommand,
  buildServiceScriptCommand,
  buildRemoteSshCommand,
} from '../script-adapters';

describe('script-adapters CLI builders', () => {
  it('correctly constructs deploy-docker arguments with test and allowDirty flags', () => {
    const cmd = buildDeployCommand('C:\\AG Projects\\BiomedMaven', {
      testMode: true,
      allowDirty: true,
      bumpVersion: 'patch',
    });
    expect(cmd.command).toBe('pwsh.exe');
    expect(cmd.args).toContain('-Test');
    expect(cmd.args).toContain('-AllowDirty');
    expect(cmd.args).toContain('-BumpVersion');
    expect(cmd.args).toContain('patch');
    expect(cmd.lockType).toBe('WshRemoteMutation');
  });

  it('correctly constructs rollback arguments', () => {
    const cmd = buildDeployCommand('C:\\AG Projects\\TastyBasket', {
      rollbackToTag: '0.2.0-8f3c2a1',
    });
    expect(cmd.args).toContain('-RollbackToTag');
    expect(cmd.args).toContain('0.2.0-8f3c2a1');
  });

  it('correctly constructs db-manager ApplyLocal arguments', () => {
    const cmd = buildDbManagerCommand('C:\\AG Projects\\SpendyLedger', 'apply-local', {
      unattended: true,
      archiveFile: 'D:\\Backups\\backup.tar.gz',
    });
    expect(cmd.args).toContain('-Unattended');
    expect(cmd.args).toContain('ApplyLocal');
    expect(cmd.args).toContain('D:\\Backups\\backup.tar.gz');
    expect(cmd.lockType).toBe('LocalBackupIo');
  });

  it('correctly constructs Get-SSLCerts arguments', () => {
    const cmd = buildSslCertCommand('C:\\AG Projects\\PanoramaDrSuite\\tools', {
      unattended: true,
      forceRenewal: true,
      deployTargets: ['WebServicesHost', 'Genmon'],
    });
    expect(cmd.args).toContain('-Unattended');
    expect(cmd.args).toContain('-ForceRenewal');
    expect(cmd.args).toContain('WebServicesHost,Genmon');
  });

  it('correctly constructs deploy-cloudflare-tunnel arguments', () => {
    const checkCmd = buildCloudflareTunnelCommand('C:\\AG Projects\\PanoramaDrSuite\\tools', 'check_update');
    expect(checkCmd.command).toBe('pwsh.exe');
    expect(checkCmd.args).toContain('-CheckUpdate');
    expect(checkCmd.lockType).toBe('None');

    const updateCmd = buildCloudflareTunnelCommand('C:\\AG Projects\\PanoramaDrSuite\\tools', 'update');
    expect(updateCmd.args).toContain('-Update');
    expect(updateCmd.lockType).toBe('WshRemoteMutation');

    const forceCmd = buildCloudflareTunnelCommand('C:\\AG Projects\\PanoramaDrSuite\\tools', 'update_force');
    expect(forceCmd.args).toContain('-Update');
    expect(forceCmd.args).toContain('-Force');
    expect(forceCmd.lockType).toBe('WshRemoteMutation');
  });

  it('correctly constructs remote SSH command with OpenSSH batch mode flags', () => {
    const sshCmd = buildRemoteSshCommand('apt-get update');
    expect(sshCmd.command).toBe('ssh.exe');
    expect(sshCmd.args).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-i',
      'C:\\Users\\rodrigo\\.ssh\\rsa-key-deployment',
      'root@wsh.panoramadr.com',
      'apt-get update',
    ]);
  });

  it('correctly constructs deploy-cloudflare-pages arguments for GitCi, Wrangler, and rollback', () => {
    const gitCiCmd = buildCloudflarePagesDeployCommand('C:\\AG Projects\\ParakithSite', {
      mode: 'GitCi',
      bumpVersion: 'patch',
      allowDirty: true,
    });
    expect(gitCiCmd.command).toBe('pwsh.exe');
    expect(gitCiCmd.lockType).toBe('None');
    expect(gitCiCmd.args).toContain('.\\deploy-cloudflare-pages.ps1');
    expect(gitCiCmd.args).toContain('-Mode');
    expect(gitCiCmd.args).toContain('GitCi');
    expect(gitCiCmd.args).toContain('-BumpVersion');
    expect(gitCiCmd.args).toContain('patch');
    expect(gitCiCmd.args).toContain('-AllowDirty');

    const wranglerCmd = buildCloudflarePagesDeployCommand('C:\\AG Projects\\ParakithSite', {
      mode: 'Wrangler',
    });
    expect(wranglerCmd.lockType).toBe('None');
    expect(wranglerCmd.args).toContain('Wrangler');
    expect(wranglerCmd.args).not.toContain('-BumpVersion');

    const rollbackCmd = buildCloudflarePagesDeployCommand('C:\\AG Projects\\ParakithSite', {
      rollbackDeploymentId: 'cf-dep-987654',
    });
    expect(rollbackCmd.lockType).toBe('None');
    expect(rollbackCmd.args).toContain('-RollbackDeploymentId');
    expect(rollbackCmd.args).toContain('cf-dep-987654');
    expect(rollbackCmd.args).not.toContain('-Mode');
  });

  it('correctly constructs wsh-docker-service lifecycle arguments across all actions', () => {
    const wsDir = 'C:\\AG Projects\\PanoramaDrSuite\\tools\\unifi-siem';

    const verifyCmd = buildServiceScriptCommand(wsDir, 'deploy-unifi-siem.ps1', 'verify_local');
    expect(verifyCmd.command).toBe('pwsh.exe');
    expect(verifyCmd.workingDir).toBe(wsDir);
    expect(verifyCmd.args).toContain('-VerifyLocal');
    expect(verifyCmd.lockType).toBe('None');

    const statusCmd = buildServiceScriptCommand(wsDir, 'deploy-unifi-siem.ps1', 'status');
    expect(statusCmd.args).toContain('-Status');
    expect(statusCmd.lockType).toBe('None');

    const testCmd = buildServiceScriptCommand(wsDir, 'deploy-unifi-siem.ps1', 'test');
    expect(testCmd.args).toContain('-Test');
    expect(testCmd.lockType).toBe('None');

    const deployCmd = buildServiceScriptCommand(wsDir, 'deploy-unifi-siem.ps1', 'deploy', {
      allowDirty: true,
    });
    expect(deployCmd.args).toContain('.\\deploy-unifi-siem.ps1');
    expect(deployCmd.args).toContain('-AllowDirty');
    expect(deployCmd.args).not.toContain('-VerifyLocal');
    expect(deployCmd.args).not.toContain('-Stop');
    expect(deployCmd.lockType).toBe('WshRemoteMutation');

    const stopCmd = buildServiceScriptCommand(wsDir, 'deploy-unifi-siem.ps1', 'stop');
    expect(stopCmd.args).toContain('-Stop');
    expect(stopCmd.lockType).toBe('WshRemoteMutation');
  });
});
