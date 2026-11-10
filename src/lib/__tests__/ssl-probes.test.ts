import { describe, it, expect } from 'vitest';
import { buildSslCertCommand } from '../script-adapters';
import { DomainSslDualProbe, SslFleetSummary } from '../types';
import { getSslStageInfo } from '../../components/edge/ssl-stage-parser';
import { TerminalTab } from '../../components/layout/SreTerminalDrawer';

describe('SSL Dual-Probe & Renewal Adapters', () => {
  const toolsPath = 'C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaDrSuite\\tools';

  it('builds standard unattended renewal command under WSH_REMOTE_MUTATION lock', () => {
    const cmd = buildSslCertCommand(toolsPath, { unattended: true });
    expect(cmd.command).toBe('pwsh.exe');
    expect(cmd.lockType).toBe('WshRemoteMutation');
    expect(cmd.args).toContain('-Unattended');
    expect(cmd.args).not.toContain('-ForceRenewal');
    expect(cmd.scriptPath).toContain('ssl-cert-manager\\Get-SSLCerts.ps1');
  });

  it('builds force renewal command with -ForceRenewal flag', () => {
    const cmd = buildSslCertCommand(toolsPath, { unattended: true, forceRenewal: true });
    expect(cmd.command).toBe('pwsh.exe');
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

  it('correctly supports SELF_SIGNED drift status for unmanaged factory certificates', () => {
    const mockSelfSigned: DomainSslDualProbe = {
      device_key: 'NanoStation_House',
      display_name: 'NanoStation 5AC House',
      domain: 'nano-house.panoramadr.com',
      deploy_target_type: 'SSH_SCP (/etc/server.pem + Reload)',
      local_cert: {
        exists: false,
        domain: 'nano-house.panoramadr.com',
        subject: '',
        issuer: '',
        thumbprint: '',
        serial_number: '',
        not_after: '',
        days_remaining: -1,
        status: 'MISSING',
      },
      live_cert: {
        reachable: true,
        latency_ms: 210,
        domain: 'nano-house.panoramadr.com',
        subject: 'CN=UBNT-F4:E2:C6:94:B8:3F, O=Ubiquiti Networks Inc.',
        issuer: 'CN=UBNT-F4:E2:C6:94:B8:3F, O=Ubiquiti Networks Inc.',
        thumbprint: '006DB0D87329F64F',
        serial_number: 'DF1F5B19',
        not_after: '2038-01-01T00:00:00Z',
        days_remaining: 4070,
        status: 'SELF_SIGNED',
      },
      drift_status: 'SELF_SIGNED',
    };

    expect(mockSelfSigned.drift_status).toBe('SELF_SIGNED');
    expect(mockSelfSigned.live_cert.status).toBe('SELF_SIGNED');
    expect(mockSelfSigned.local_cert.exists).toBe(false);
  });

  it('correctly maps 4-stage lifecycle progression from Get-SSLCerts output lines', () => {
    // Stage 1: Pre-flight
    const tabStage1: TerminalTab = {
      id: 'ssl-renew-1',
      title: 'Renew NanoStation_House',
      lines: [
        '--- SSL Cert Manager Started ---',
        '[12:00:00] [INFO] Base Output Folder: D:\\Google\\My Drive',
        '[12:00:01] [INFO] --- STAGE 1: CERTIFICATE ISSUANCE & RENEWAL ---',
      ],
      isRunning: true,
      createdAt: '2026-11-09T12:00:00Z',
    };
    const s1 = getSslStageInfo(tabStage1);
    expect(s1?.stage).toBe(1);
    expect(s1?.isFinished).toBe(false);

    // Stage 2: ACME DNS-01 challenge
    const tabStage2: TerminalTab = {
      ...tabStage1,
      lines: [
        ...tabStage1.lines,
        'Processing: NanoStation_House',
        'Calling New-PACertificate for Cloudflare DNS-01...',
      ],
    };
    const s2 = getSslStageInfo(tabStage2);
    expect(s2?.stage).toBe(2);
    expect(s2?.label).toBe('ACME DNS-01 Challenge');

    // Stage 3: Appliance Staging & SCP Transport
    const tabStage3: TerminalTab = {
      ...tabStage2,
      lines: [
        ...tabStage2.lines,
        '[12:01:00] [INFO] --- STAGE 2: APPLIANCE DEPLOYMENT ---',
        '[12:01:01] [INFO] Uploading certificates to NanoStation 5AC House...',
        '[12:01:02] [INFO] Checking integrity...',
      ],
    };
    const s3 = getSslStageInfo(tabStage3);
    expect(s3?.stage).toBe(3);
    expect(s3?.label).toBe('Staging & Transport');

    // Stage 4: Atomic Install & Reload
    const tabStage4: TerminalTab = {
      ...tabStage3,
      lines: [
        ...tabStage3.lines,
        '[12:01:05] [INFO] Installing and restarting service on NanoStation 5AC House...',
        '[12:01:06] [OK] JOB COMPLETE. Logs: latest_run.log',
      ],
      isRunning: false,
      exitCode: 0,
    };
    const s4 = getSslStageInfo(tabStage4);
    expect(s4?.stage).toBe(4);
    expect(s4?.isFinished).toBe(true);
    expect(s4?.isFailed).toBe(false);
  });
});
