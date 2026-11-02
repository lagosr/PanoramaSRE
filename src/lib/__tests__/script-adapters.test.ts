import { describe, it, expect } from 'vitest';
import { buildDeployCommand, buildDbManagerCommand, buildSslCertCommand } from '../script-adapters';

describe('script-adapters CLI builders', () => {
  it('correctly constructs deploy-docker arguments with test and allowDirty flags', () => {
    const cmd = buildDeployCommand('C:\\AG Projects\\BiomedMaven', {
      testMode: true,
      allowDirty: true,
      bumpVersion: 'patch',
    });
    expect(cmd.command).toBe('powershell.exe');
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
});
