import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { synthesizeTopology } from '../topology-synthesizer';
import { buildRemoteSshCommand } from '../script-adapters';
import { APP_VERSION_INFO } from '../version';
import { DiscoveredApp, WshSnapshot } from '../types';

const SSH_KEY_PATH = 'C:/Users/rodrigo/.ssh/rsa-key-deployment';
const REMOTE_HOST = 'root@wsh.panoramadr.com';

function isHostReachable(): boolean {
  try {
    const res = spawnSync('ssh.exe', [
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=3',
      '-i', SSH_KEY_PATH,
      REMOTE_HOST,
      'echo CONNECTIVITY_OK'
    ], { encoding: 'utf-8', timeout: 5000 });
    return res.status === 0 && res.stdout.includes('CONNECTIVITY_OK');
  } catch {
    return false;
  }
}

describe('Live Network & Topology Integration Suite', () => {
  let liveSnapshot: WshSnapshot | null = null;
  let hostOnline = false;

  const mockApps: DiscoveredApp[] = [
    {
      manifest: {
        schemaVersion: 1,
        appId: 'auth',
        slug: 'auth',
        displayName: 'PanoramaAuth',
        portalTitle: 'PanoramaAuth',
        description: 'Identity Provider',
        basePath: '/auth',
        port: 3000,
        containerName: 'panorama-auth',
        composeProject: 'panorama-auth',
        remoteAppRoot: '/opt/panorama-auth',
        dataVolume: 'panorama-auth',
        localSqlitePath: '',
        themeColor: '#0ea5e9',
        icon: 'Shield',
        portalOrder: 1,
        roles: ['admin'],
        sre: {
          deployScript: '',
          dbScript: '',
          devCommand: '',
          healthEndpoint: '/api/health',
          manifestEndpoint: '/api/auth/manifest',
          testCommand: '',
          typecheckCommand: '',
          requiresAuthInDev: false,
          automatedBackupDefault: true,
          exposeInRemotePortal: true,
        },
      },
      workspacePath: 'c:\\test\\auth',
      provenanceState: 'IN_SYNC',
      health: { status: 'healthy' },
    },
    {
      manifest: {
        schemaVersion: 1,
        appId: 'spendy',
        slug: 'spendy',
        displayName: 'SpendyLedger',
        portalTitle: 'SpendyLedger',
        description: 'Finance Tracker',
        basePath: '/spendy',
        port: 3001,
        containerName: 'spendy-ledger',
        composeProject: 'spendy-ledger',
        remoteAppRoot: '/opt/spendy-ledger',
        dataVolume: 'spendy-ledger',
        localSqlitePath: '',
        themeColor: '#10b981',
        icon: 'CreditCard',
        portalOrder: 2,
        roles: ['admin'],
        sre: {
          deployScript: '',
          dbScript: '',
          devCommand: '',
          healthEndpoint: '/api/health',
          manifestEndpoint: '/api/auth/manifest',
          testCommand: '',
          typecheckCommand: '',
          requiresAuthInDev: false,
          automatedBackupDefault: true,
          exposeInRemotePortal: true,
        },
      },
      workspacePath: 'c:\\test\\spendy',
      provenanceState: 'IN_SYNC',
      health: { status: 'healthy' },
    },
    {
      manifest: {
        schemaVersion: 1,
        appId: 'biomed',
        slug: 'biomed',
        displayName: 'BiomedMaven',
        portalTitle: 'BiomedMaven',
        description: 'Biomedical Telemetry',
        basePath: '/biomed',
        port: 3002,
        containerName: 'biomed-maven',
        composeProject: 'biomed-maven',
        remoteAppRoot: '/opt/biomed-maven',
        dataVolume: 'biomed-maven',
        localSqlitePath: '',
        themeColor: '#06b6d4',
        icon: 'Activity',
        portalOrder: 3,
        roles: ['admin'],
        sre: {
          deployScript: '',
          dbScript: '',
          devCommand: '',
          healthEndpoint: '/api/health',
          manifestEndpoint: '/api/auth/manifest',
          testCommand: '',
          typecheckCommand: '',
          requiresAuthInDev: false,
          automatedBackupDefault: true,
          exposeInRemotePortal: true,
        },
      },
      workspacePath: 'c:\\test\\biomed',
      provenanceState: 'IN_SYNC',
      health: { status: 'healthy' },
    },
    {
      manifest: {
        schemaVersion: 1,
        appId: 'water',
        slug: 'water',
        displayName: 'WaterAnalyzer',
        portalTitle: 'WaterAnalyzer',
        description: 'Water Quality Telemetry',
        basePath: '/water',
        port: 3003,
        containerName: 'water-analyzer',
        composeProject: 'water-analyzer',
        remoteAppRoot: '/opt/water-analyzer',
        dataVolume: 'water-analyzer',
        localSqlitePath: '',
        themeColor: '#3b82f6',
        icon: 'Droplet',
        portalOrder: 4,
        roles: ['admin'],
        sre: {
          deployScript: '',
          dbScript: '',
          devCommand: '',
          healthEndpoint: '/api/health',
          manifestEndpoint: '/api/auth/manifest',
          testCommand: '',
          typecheckCommand: '',
          requiresAuthInDev: false,
          automatedBackupDefault: true,
          exposeInRemotePortal: true,
        },
      },
      workspacePath: 'c:\\test\\water',
      provenanceState: 'IN_SYNC',
      health: { status: 'healthy' },
    },
    {
      manifest: {
        schemaVersion: 1,
        appId: 'basket',
        slug: 'basket',
        displayName: 'TastyBasket',
        portalTitle: 'TastyBasket',
        description: 'Pantry & Recipe Manager',
        basePath: '/basket',
        port: 3004,
        containerName: 'tasty-basket',
        composeProject: 'tasty-basket',
        remoteAppRoot: '/opt/tasty-basket',
        dataVolume: 'tasty-basket',
        localSqlitePath: '',
        themeColor: '#f59e0b',
        icon: 'ShoppingBag',
        portalOrder: 5,
        roles: ['admin'],
        sre: {
          deployScript: '',
          dbScript: '',
          devCommand: '',
          healthEndpoint: '/api/health',
          manifestEndpoint: '/api/auth/manifest',
          testCommand: '',
          typecheckCommand: '',
          requiresAuthInDev: false,
          automatedBackupDefault: true,
          exposeInRemotePortal: true,
        },
      },
      workspacePath: 'c:\\test\\basket',
      provenanceState: 'IN_SYNC',
      health: { status: 'healthy' },
    },
    {
      manifest: {
        schemaVersion: 1,
        appId: 'resources',
        slug: 'resources',
        displayName: 'PanoramaResources',
        portalTitle: 'PanoramaResources',
        description: 'Resource Center',
        basePath: '/resources',
        port: 4000,
        containerName: 'panorama-resources',
        composeProject: 'panorama-resources',
        remoteAppRoot: '/opt/panorama-resources',
        dataVolume: 'panorama-resources',
        localSqlitePath: '',
        themeColor: '#8b5cf6',
        icon: 'BookOpen',
        portalOrder: 6,
        roles: ['admin'],
        sre: {
          deployScript: '',
          dbScript: '',
          devCommand: '',
          healthEndpoint: '/api/health',
          manifestEndpoint: '/api/auth/manifest',
          testCommand: '',
          typecheckCommand: '',
          requiresAuthInDev: false,
          automatedBackupDefault: true,
          exposeInRemotePortal: true,
        },
      },
      workspacePath: 'c:\\test\\resources',
      provenanceState: 'IN_SYNC',
      health: { status: 'healthy' },
    },
  ];

  beforeAll(() => {
    hostOnline = isHostReachable();
    if (hostOnline) {
      const scriptPath = path.resolve(__dirname, '../../../scripts/wsh_snapshot.sh');
      const scriptContent = fs.readFileSync(scriptPath, 'utf-8').replace(/\r\n/g, '\n');

      const res = spawnSync('ssh.exe', [
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-i', SSH_KEY_PATH,
        REMOTE_HOST,
        'bash', '-s', '--', '--fast'
      ], {
        input: scriptContent,
        encoding: 'utf-8',
        timeout: 15000,
        maxBuffer: 10 * 1024 * 1024,
      });

      if (res.status === 0 && res.stdout) {
        try {
          liveSnapshot = JSON.parse(res.stdout);
        } catch (e) {
          console.warn('Failed to parse live snapshot output:', e);
        }
      }
    }
  });

  it('validates version synchronization between package.json, tauri.conf.json, and APP_VERSION_INFO', () => {
    const pkgPath = path.resolve(__dirname, '../../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    const tauriConfPath = path.resolve(__dirname, '../../../src-tauri/tauri.conf.json');
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'));

    expect(APP_VERSION_INFO.version).toBe(pkg.version);
    expect(tauriConf.version).toBe(pkg.version);
    expect(APP_VERSION_INFO.fullVersionString).toContain(`v${pkg.version}`);
  });

  it('guarantees zero false security violations during initial un-snapshotted bootstrapping', () => {
    const bootstrapTopology = synthesizeTopology(mockApps, null);
    expect(bootstrapTopology.securityAudit.securityViolationCount).toBe(0);
    expect(bootstrapTopology.securityAudit.score).toBe(100);

    const failing = bootstrapTopology.securityAudit.invariants.filter((i) => i.status === 'FAIL');
    expect(failing).toHaveLength(0);
  });

  it('executes live snapshot contract against wsh.panoramadr.com and validates network schema', () => {
    if (!hostOnline || !liveSnapshot) {
      console.warn('Skipping live snapshot contract: Host unreachable');
      return;
    }

    expect(liveSnapshot.hostname).toBe('wsh');
    expect(liveSnapshot.kernel).toMatch(/rpi|\d+\.\d+|linux/i);
    expect(liveSnapshot.containers).toBeDefined();
    expect(liveSnapshot.containers!.length).toBeGreaterThanOrEqual(7);

    // Verify raw firewall rules contain hardened chains
    expect(liveSnapshot.firewall_rules_raw).toBeDefined();
    expect(liveSnapshot.firewall_rules_raw).toContain('DOCKER-USER');
    expect(liveSnapshot.firewall_rules_raw).toContain('PANORAMA-INPUT');

    // Verify CGNAT 100.64.0.0/16 subnets in docker networks
    expect(liveSnapshot.docker_networks).toBeDefined();
    const cgnatNets = liveSnapshot.docker_networks!.filter((n) =>
      n.IPAM?.Config?.[0]?.Subnet?.startsWith('100.64.')
    );
    expect(cgnatNets.length).toBeGreaterThanOrEqual(6);

    // Verify Cloudflare tunnel telemetry
    expect(liveSnapshot.cloudflared).toBeDefined();
    expect(liveSnapshot.cloudflared!.version_raw).toMatch(/cloudflared version/i);
  });

  it('validates synthesizeTopology against actual live host telemetry (100% score, 0 violations)', () => {
    if (!hostOnline || !liveSnapshot) {
      console.warn('Skipping live topology validation: Host unreachable');
      return;
    }

    const topology = synthesizeTopology(mockApps, liveSnapshot);

    expect(topology.securityAudit.score).toBe(100);
    expect(topology.securityAudit.securityViolationCount).toBe(0);
    expect(topology.securityAudit.zeroBindViolations).toHaveLength(0);

    // Assert all 8 security invariants strictly pass
    const invMap = new Map(topology.securityAudit.invariants.map((i) => [i.id, i.status]));
    expect(invMap.get('SEC-01')).toBe('PASS');
    expect(invMap.get('SEC-02')).toBe('PASS');
    expect(invMap.get('SEC-03')).toBe('PASS');
    expect(invMap.get('SEC-04')).toBe('PASS');
    expect(invMap.get('SEC-05')).toBe('PASS');
    expect(invMap.get('SEC-06')).toBe('PASS');
    expect(invMap.get('SEC-07')).toBe('PASS');
    expect(invMap.get('SEC-08')).toBe('PASS');

    // Verify cloudflared network mode reflects cf-egress-net bridge
    expect(topology.cloudflared.networkMode).toBe('cf-egress-net (100.64.250.0/24)');
  });

  it('verifies that all 8 invariant commandSnippets execute cleanly over SSH without timeouts or errors', () => {
    if (!hostOnline || !liveSnapshot) {
      console.warn('Skipping live snippet execution: Host unreachable');
      return;
    }

    const topology = synthesizeTopology(mockApps, liveSnapshot);

    for (const inv of topology.securityAudit.invariants) {
      expect(inv.commandSnippet).toBeDefined();
      const sshSpec = buildRemoteSshCommand(inv.commandSnippet!);

      const res = spawnSync(sshSpec.command, sshSpec.args, {
        encoding: 'utf-8',
        timeout: 10000,
      });

      expect(res.status, `Snippet for ${inv.id} failed: ${res.stderr || res.stdout}`).toBe(0);
      expect(res.stderr).not.toContain('command not found');
      expect(res.stderr).not.toContain('cannot attach stdin to a TTY');
    }
  });
});
