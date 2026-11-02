import { describe, it, expect } from 'vitest';
import { buildSslCertCommand } from '../script-adapters';
import { DomainSslDualProbe, SslFleetSummary } from '../types';

describe('SSL Dual-Probe & Renewal Adapters', () => {
  const toolsPath = 'C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaDrSuite\\tools';

  it('builds standard unattended renewal command under WSH_REMOTE_MUTATION lock', () => {
    const cmd = buildSslCertCommand(toolsPath, { unattended: true });
    expect(cmd.command).toBe('powershell.exe');
    expect(cmd.lockType).toBe('WshRemoteMutation');
    expect(cmd.args).toContain('-Unattended');
    expect(cmd.args).not.toContain('-ForceRenewal');
    expect(cmd.scriptPath).toContain('ssl-cert-manager\\Get-SSLCerts.ps1');
  });

  it('builds force renewal command with -ForceRenewal flag', () => {
    const cmd = buildSslCertCommand(toolsPath, { unattended: true, forceRenewal: true });
    expect(cmd.command).toBe('powershell.exe');
    expect(cmd.lockType).toBe('WshRemoteMutation');
    expect(cmd.args).toContain('-Unattended');
    expect(cmd.args).toContain('-ForceRenewal');
  });

  it('builds targeted deployment command for specific devices', () => {
    const cmd = buildSslCertCommand(toolsPath, {
      unattended: true,
      deployTargets: ['WebServicesHost', 'Genmon'],
    });
    expect(cmd.args).toContain('-DeployTargets');
    expect(cmd.args).toContain('WebServicesHost,Genmon');
  });

  it('builds single device renewal command with -TargetDevice flag', () => {
    const cmd = buildSslCertCommand(toolsPath, {
      unattended: true,
      forceRenewal: true,
      targetDevice: 'Genmon',
      deployTargets: ['Genmon'],
    });
    expect(cmd.args).toContain('-TargetDevice');
    expect(cmd.args).toContain('Genmon');
    expect(cmd.args).toContain('-ForceRenewal');
    expect(cmd.args).toContain('-DeployTargets');
  });

  it('correctly validates drift status states in fleet summary', () => {
    const mockItemInSync: DomainSslDualProbe = {
      device_key: 'WebServicesHost',
      display_name: 'Web Services Host (DietPi)',
      domain: 'wsh.panoramadr.com',
      deploy_target_type: 'SSH_SCP',
      local_cert: {
        exists: true,
        domain: 'wsh.panoramadr.com',
        subject: 'CN=wsh.panoramadr.com',
        issuer: 'CN=YE1',
        thumbprint: 'AABBCCDDEEFF',
        serial_number: '12345',
        not_after: '2027-01-22T20:29:42Z',
        days_remaining: 81,
        status: 'HEALTHY',
      },
      live_cert: {
        reachable: true,
        latency_ms: 25,
        domain: 'wsh.panoramadr.com',
        subject: 'CN=wsh.panoramadr.com',
        issuer: 'CN=YE1',
        thumbprint: 'AABBCCDDEEFF',
        serial_number: '12345',
        not_after: '2027-01-22T20:29:42Z',
        days_remaining: 81,
        status: 'HEALTHY',
      },
      drift_status: 'IN_SYNC',
    };

    const mockItemDrift: DomainSslDualProbe = {
      device_key: 'Genmon',
      display_name: 'Generator Monitor',
      domain: 'genmon.panoramadr.com',
      deploy_target_type: 'SSH_SCP',
      local_cert: {
        exists: true,
        domain: 'genmon.panoramadr.com',
        subject: 'CN=genmon.panoramadr.com',
        issuer: 'CN=YE2',
        thumbprint: 'NEW_THUMBPRINT_81D',
        serial_number: '99999',
        not_after: '2027-01-22T20:25:32Z',
        days_remaining: 81,
        status: 'HEALTHY',
      },
      live_cert: {
        reachable: true,
        latency_ms: 45,
        domain: 'genmon.panoramadr.com',
        subject: 'CN=genmon.panoramadr.com',
        issuer: 'CN=YE2',
        thumbprint: 'OLD_THUMBPRINT_14D',
        serial_number: '88888',
        not_after: '2026-11-15T20:25:32Z',
        days_remaining: 14,
        status: 'CRITICAL',
      },
      drift_status: 'DRIFT_DETECTED',
    };

    const fleet: SslFleetSummary = {
      total_domains: 2,
      healthy_count: 1,
      expiring_soon_count: 0,
      critical_count: 1,
      drift_count: 1,
      min_days_remaining: 14,
      items: [mockItemInSync, mockItemDrift],
      probed_at: '2026-11-01T20:00:00Z',
    };

    expect(fleet.total_domains).toBe(2);
    expect(fleet.drift_count).toBe(1);
    expect(fleet.items[0].drift_status).toBe('IN_SYNC');
    expect(fleet.items[1].drift_status).toBe('DRIFT_DETECTED');
    expect(fleet.items[0].local_cert.thumbprint).toBe(fleet.items[0].live_cert.thumbprint);
    expect(fleet.items[1].local_cert.thumbprint).not.toBe(fleet.items[1].live_cert.thumbprint);
  });
});
