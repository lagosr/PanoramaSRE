import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  canonicalizeParams,
  signIpcRequest,
  buildCanonicalSigningPayload,
} from '../src/client/crypto.ts';
import { callSrePipe } from '../src/client/pipeClient.ts';
import {
  discoverLiveInstances,
  electInstance,
} from '../src/client/discovery.ts';
import { classifyShellCommand, evaluatePreToolUse, getDiscoveredAppMappings } from '../src/guard/preToolHook.ts';
import { handleJsonRpcMessage, getAllRegisteredTools } from '../src/index.ts';
import {
  FALLBACK_HEADLESS_EXIT_CODE,
  triggerSmokeViaSreBridge,
} from '../src/cli/triggerSmokeRun.ts';
import type {
  IpcRequest,
  LiveSreInstance,
  SreInstanceLease,
} from '../src/types/ipc.ts';

describe('PanoramaSRE MCP Server & Zero-Trust Named Pipe Client', () => {
  const activeServers: net.Server[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const srv of activeServers.splice(0)) {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
    for (const dir of tempDirs.splice(0)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup races
      }
    }
  });

  it('canonicalizes nested JSON keys alphabetically to match Rust BTreeMap serialization', () => {
    const unsorted = {
      withAuth: true,
      slug: 'biomed',
      nested: { z: 1, a: 2 },
    };
    const canonical = canonicalizeParams(unsorted);
    expect(canonical).toBe('{"nested":{"a":2,"z":1},"slug":"biomed","withAuth":true}');
    expect(canonicalizeParams({})).toBe('{}');
    expect(canonicalizeParams(null)).toBe('{}');

    const payload = buildCanonicalSigningPayload(
      1762897000,
      'nonce-1234567890',
      'dev.start',
      { withAuth: true, slug: 'biomed' }
    );
    expect(payload).toBe(
      '1762897000.nonce-1234567890.dev.start.{"slug":"biomed","withAuth":true}'
    );

    const sig1 = signIpcRequest('supersecret', 1762897000, 'nonce-1234567890', 'dev.start', {
      withAuth: true,
      slug: 'biomed',
    });
    const sig2 = signIpcRequest('supersecret', 1762897000, 'nonce-1234567890', 'dev.start', {
      slug: 'biomed',
      withAuth: true,
    });
    expect(sig1).toBe(sig2);
    expect(sig1).toHaveLength(64);
  });

  it('elects the right PanoramaSRE instance across multiple running sessions', () => {
    const devInst: LiveSreInstance = {
      leaseFilePath: 'lease-1001.json',
      lease: {
        instanceId: 'sre-dev-1001',
        pid: 1001,
        pipeName: '\\\\.\\pipe\\sre-1001',
        version: '1.3.1',
        channel: 'dev',
        exePath: 'C:\\target\\debug\\panorama-sre.exe',
        workspaceRoot: 'C:\\AG Projects',
        startedAt: '2026-11-11T10:00:00Z',
        hmacSecret: 'sec1',
      },
      ping: {
        instanceId: 'sre-dev-1001',
        pid: 1001,
        version: '1.3.1',
        channel: 'dev',
        exePath: 'C:\\target\\debug\\panorama-sre.exe',
        workspaceRoot: 'C:\\AG Projects',
        startedAt: '2026-11-11T10:00:00Z',
        managedApps: ['biomed'],
        managedCount: 1,
      },
    };

    const installedInst: LiveSreInstance = {
      leaseFilePath: 'lease-2002.json',
      lease: {
        instanceId: 'sre-installed-2002',
        pid: 2002,
        pipeName: '\\\\.\\pipe\\sre-2002',
        version: '1.3.1',
        channel: 'installed',
        exePath: 'C:\\Users\\rodrigo\\AppData\\Local\\PanoramaSRE\\panorama-sre.exe',
        workspaceRoot: 'C:\\AG Projects',
        startedAt: '2026-11-11T09:00:00Z',
        hmacSecret: 'sec2',
      },
      ping: {
        instanceId: 'sre-installed-2002',
        pid: 2002,
        version: '1.3.1',
        channel: 'installed',
        exePath: 'C:\\Users\\rodrigo\\AppData\\Local\\PanoramaSRE\\panorama-sre.exe',
        workspaceRoot: 'C:\\AG Projects',
        startedAt: '2026-11-11T09:00:00Z',
        managedApps: ['auth', 'spendy'],
        managedCount: 2,
      },
    };

    // 1. Active Supervisor Affinity: targeting "biomed" routes to devInst (1001) because it already manages biomed!
    const affinityChosen = electInstance([devInst, installedInst], 'auto', 'biomed');
    expect(affinityChosen?.ping.instanceId).toBe('sre-dev-1001');

    // 2. General "auto" routes to installedInst (2002) because it has higher managedCount (2 > 1)
    const autoChosen = electInstance([devInst, installedInst], 'auto');
    expect(autoChosen?.ping.instanceId).toBe('sre-installed-2002');

    // 3. Explicit selector "dev" or "1001" routes to devInst
    expect(electInstance([devInst, installedInst], 'dev')?.ping.instanceId).toBe('sre-dev-1001');
    expect(electInstance([devInst, installedInst], '1001')?.ping.instanceId).toBe('sre-dev-1001');

    // 4. Tie-breaker when both have 0 managed apps: "installed" beats "dev"
    const idleDev = {
      ...devInst,
      ping: { ...devInst.ping, managedApps: [], managedCount: 0 },
    };
    const idleInstalled = {
      ...installedInst,
      ping: { ...installedInst.ping, managedApps: [], managedCount: 0 },
    };
    expect(electInstance([idleDev, idleInstalled], 'auto')?.ping.instanceId).toBe(
      'sre-installed-2002'
    );
  });

  it('prunes dead-PID lease files and discovers live Named Pipe instances', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sre-ipc-test-'));
    tempDirs.push(tmpDir);

    // 1. Write a stale lease with a guaranteed non-existent PID
    const staleLeasePath = path.join(tmpDir, 'lease-99999999.json');
    fs.writeFileSync(
      staleLeasePath,
      JSON.stringify({
        instanceId: 'sre-stale-99999999',
        pid: 99999999,
        pipeName: '\\\\.\\pipe\\panoramasre-stale',
        version: '1.3.1',
        channel: 'installed',
        exePath: 'panorama-sre.exe',
        workspaceRoot: '.',
        startedAt: '2026-11-11T00:00:00Z',
        hmacSecret: 'deadbeef',
      })
    );

    // 2. Start a mock Named Pipe server representing the current process PID
    const pipeName = `\\\\.\\pipe\\panoramasre-test-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    const secret = crypto.randomBytes(32).toString('hex');

    const server = net.createServer((socket) => {
      let buf = '';
      socket.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        if (buf.includes('\n')) {
          const req = JSON.parse(buf.trim()) as IpcRequest;
          const expectedSig = signIpcRequest(
            secret,
            req.ts,
            req.nonce,
            req.action,
            req.params
          );
          if (req.sig !== expectedSig) {
            socket.write(
              `${JSON.stringify({
                id: req.id,
                ok: false,
                error: { code: 'AUTH_HMAC_INVALID', message: 'Invalid signature' },
              })}\n`
            );
            return;
          }
          socket.write(
            `${JSON.stringify({
              id: req.id,
              ok: true,
              data: {
                instanceId: `sre-dev-${process.pid}`,
                pid: process.pid,
                version: '1.3.1',
                channel: 'dev',
                exePath: process.execPath,
                workspaceRoot: process.cwd(),
                startedAt: '2026-11-11T12:00:00Z',
                managedApps: ['auth', 'biomed'],
                managedCount: 2,
              },
            })}\n`
          );
        }
      });
    });
    activeServers.push(server);

    await new Promise<void>((resolve) => server.listen(pipeName, () => resolve()));

    const liveLease: SreInstanceLease = {
      instanceId: `sre-dev-${process.pid}`,
      pid: process.pid,
      pipeName,
      version: '1.3.1',
      channel: 'dev',
      exePath: process.execPath,
      workspaceRoot: process.cwd(),
      startedAt: '2026-11-11T12:00:00Z',
      hmacSecret: secret,
    };
    fs.writeFileSync(
      path.join(tmpDir, `lease-${process.pid}.json`),
      JSON.stringify(liveLease)
    );

    const discovered = await discoverLiveInstances(tmpDir);
    expect(fs.existsSync(staleLeasePath)).toBe(false); // Dead PID lease pruned!
    expect(discovered).toHaveLength(1);
    expect(discovered[0].ping.instanceId).toBe(`sre-dev-${process.pid}`);
    expect(discovered[0].ping.managedApps).toEqual(['auth', 'biomed']);

    // Verify wrong HMAC secret is rejected by server
    const badLease: SreInstanceLease = { ...liveLease, hmacSecret: 'wrong-secret' };
    await expect(callSrePipe(badLease, 'instances.ping', {})).rejects.toThrow(
      /AUTH_HMAC_INVALID/
    );
  });

  it('classifies dev server start/kill shell commands accurately in PreToolUse guard', () => {
    // Blocked dev server start commands
    const start1 = classifyShellCommand(
      'Set-Location "c:\\Users\\rodrigo\\Documents\\AG Projects\\BiomedMaven"; npm run dev'
    );
    expect(start1.intercepted).toBe(true);
    expect(start1.category).toBe('DEV_SERVER_START');
    expect(start1.detectedSlug).toBe('biomed');

    const start2 = classifyShellCommand('npx next dev -p 3001');
    expect(start2.intercepted).toBe(true);
    expect(start2.category).toBe('DEV_SERVER_START');
    expect(start2.detectedSlug).toBe('spendy');

    const start3 = classifyShellCommand('npm run preview', 'C:\\ParakithSite');
    expect(start3.intercepted).toBe(true);
    expect(start3.category).toBe('DEV_SERVER_START');
    expect(start3.detectedSlug).toBe('parakith');

    const start4 = classifyShellCommand('npx wrangler pages dev out --port 3500');
    expect(start4.intercepted).toBe(true);
    expect(start4.category).toBe('DEV_SERVER_START');
    expect(start4.detectedSlug).toBe('parakith');

    // Blocked port/process kill commands
    const kill1 = classifyShellCommand(
      'Get-NetTCPConnection -LocalPort 3002 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'
    );
    expect(kill1.intercepted).toBe(true);
    expect(kill1.category).toBe('DEV_SERVER_KILL');
    expect(kill1.detectedSlug).toBe('biomed');

    const kill3 = classifyShellCommand(
      'Get-NetTCPConnection -LocalPort 3500 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'
    );
    expect(kill3.intercepted).toBe(true);
    expect(kill3.category).toBe('DEV_SERVER_KILL');
    expect(kill3.detectedSlug).toBe('parakith');

    const kill2 = classifyShellCommand('taskkill /F /IM node.exe');
    expect(kill2.intercepted).toBe(true);
    expect(kill2.category).toBe('DEV_SERVER_KILL');

    // Blocked background daemon spawns (IsDaemon=true or Start-Process npm)
    const daemon1 = classifyShellCommand('node server.ts', 'C:\\BiomedMaven', true);
    expect(daemon1.intercepted).toBe(true);
    expect(daemon1.category).toBe('BACKGROUND_DAEMON_SPAWN');
    expect(daemon1.detectedSlug).toBe('biomed');

    const daemon2 = classifyShellCommand('Start-Process npm -ArgumentList "run","dev"');
    expect(daemon2.intercepted).toBe(true);
    expect(daemon2.category).toBe('BACKGROUND_DAEMON_SPAWN');

    // Blocked direct smoke test executions (must use sre_ops_telemetry({ domain: "smoke_run" }))
    const smoke1 = classifyShellCommand(
      'pwsh -File "c:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaDrSuite\\tools\\smoke-tester\\Run-SmokeTests.ps1"'
    );
    expect(smoke1.intercepted).toBe(true);
    expect(smoke1.category).toBe('SMOKE_TEST_EXECUTION');

    const smoke2 = classifyShellCommand(
      'node --experimental-strip-types smoke-tests.ts --target https://wsh.panoramadr.com'
    );
    expect(smoke2.intercepted).toBe(true);
    expect(smoke2.category).toBe('SMOKE_TEST_EXECUTION');

    // Allowed OS schedule registration flag & git commands mentioning the script
    expect(
      classifyShellCommand('./Run-SmokeTests.ps1 -RegisterDailyTask').intercepted
    ).toBe(false);
    expect(
      classifyShellCommand('git commit -m "update Run-SmokeTests.ps1 and smoke-tests.ts"').intercepted
    ).toBe(false);

    // Allowed commands (Tauri dev, builds, tests, git, tsc)
    expect(classifyShellCommand('npm run tauri dev').intercepted).toBe(false);
    expect(classifyShellCommand('cargo test --offline').intercepted).toBe(false);
    expect(classifyShellCommand('npm run build').intercepted).toBe(false);
    expect(classifyShellCommand('npx vitest run').intercepted).toBe(false);
    expect(classifyShellCommand('npx tsc --noEmit').intercepted).toBe(false);
  });

  it('outputs strict protojson decision and reason in evaluatePreToolUse for Antigravity hook contract', async () => {
    const allowed = await evaluatePreToolUse({
      toolCall: {
        name: 'run_command',
        args: { CommandLine: 'npx tsc --noEmit' },
      },
    });
    expect(allowed).toEqual({ decision: 'allow' });
  });

  it('registers all 7 MCP tools across the 4 extensible domains and answers JSON-RPC initialize & tools/list', async () => {
    const tools = getAllRegisteredTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      'sre_instances_list',
      'sre_dev_status',
      'sre_dev_start',
      'sre_dev_stop',
      'sre_dev_restart',
      'sre_git_composition',
      'sre_ops_telemetry',
    ]);

    const initResp = await handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });
    expect(initResp?.result).toBeDefined();

    const listResp = await handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    const listedTools = (listResp?.result as { tools: Array<{ name: string }> }).tools;
    expect(listedTools).toHaveLength(7);
  });

  it('routes scheduled smoke runs over Named Pipe when PanoramaSRE is live and falls back (exit=2) when closed', async () => {
    const emptyLeaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sre-smoke-empty-'));
    tempDirs.push(emptyLeaseDir);

    const noSreResult = await triggerSmokeViaSreBridge({
      targetUrl: 'https://wsh.panoramadr.com',
      triggeredBy: 'scheduled',
      leaseDir: emptyLeaseDir,
    });
    expect(noSreResult.routedViaSre).toBe(false);
    expect(noSreResult.exitCode).toBe(FALLBACK_HEADLESS_EXIT_CODE);

    const liveLeaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sre-smoke-live-'));
    tempDirs.push(liveLeaseDir);

    const pipeName = `\\\\.\\pipe\\panoramasre-test-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    const hmacSecret = crypto.randomBytes(32).toString('hex');
    const capturedRequests: IpcRequest[] = [];
    let mockFailedCount = 0;

    const server = net.createServer((socket) => {
      let buf = '';
      socket.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        const idx = buf.indexOf('\n');
        if (idx === -1) return;
        const req = JSON.parse(buf.slice(0, idx)) as IpcRequest;
        capturedRequests.push(req);

        if (req.action === 'instances.ping') {
          socket.end(
            `${JSON.stringify({
              id: req.id,
              ok: true,
              data: {
                instanceId: `sre-installed-${process.pid}`,
                pid: process.pid,
                version: '1.5.8',
                channel: 'installed',
                exePath: process.execPath,
                workspaceRoot: 'C:\\AG Projects',
                startedAt: '2026-11-15T08:00:00Z',
                managedApps: [],
                managedCount: 0,
              },
            })}\n`
          );
          return;
        }

        if (req.action === 'ops.telemetry') {
          socket.end(
            `${JSON.stringify({
              id: req.id,
              ok: true,
              data: {
                id: 'smoke_mock_1',
                total: 32,
                passed: 32 - mockFailedCount,
                failed: mockFailedCount,
              },
            })}\n`
          );
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(pipeName, resolve));
    activeServers.push(server);

    const lease: SreInstanceLease = {
      instanceId: `sre-installed-${process.pid}`,
      pid: process.pid,
      pipeName,
      version: '1.5.8',
      channel: 'installed',
      exePath: process.execPath,
      workspaceRoot: 'C:\\AG Projects',
      startedAt: '2026-11-15T08:00:00Z',
      hmacSecret,
    };
    fs.writeFileSync(
      path.join(liveLeaseDir, `lease-${process.pid}.json`),
      JSON.stringify(lease),
      'utf8'
    );

    const passRes = await triggerSmokeViaSreBridge({
      targetUrl: 'https://wsh.panoramadr.com',
      triggeredBy: 'scheduled',
      leaseDir: liveLeaseDir,
    });
    expect(passRes.routedViaSre).toBe(true);
    expect(passRes.exitCode).toBe(0);

    const smokeReq = capturedRequests.find((r) => r.action === 'ops.telemetry');
    expect(smokeReq?.params).toEqual({
      domain: 'smoke_run',
      targetUrl: 'https://wsh.panoramadr.com',
      triggeredBy: 'scheduled',
    });

    mockFailedCount = 1;
    const failRes = await triggerSmokeViaSreBridge({
      targetUrl: 'https://wsh.panoramadr.com',
      triggeredBy: 'scheduled',
      forceSms: true,
      leaseDir: liveLeaseDir,
    });
    expect(failRes.routedViaSre).toBe(true);
    expect(failRes.exitCode).toBe(1);
    const forceReq = capturedRequests.filter((r) => r.action === 'ops.telemetry')[1];
    expect(forceReq?.params).toEqual({
      domain: 'smoke_run',
      forceSms: true,
      targetUrl: 'https://wsh.panoramadr.com',
      triggeredBy: 'scheduled',
    });
  });

  it('discovers manifest slugs and maps port 3005 to energy and 4000 to res dynamically', () => {
    const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'sre-manifest-scan-'));
    tempDirs.push(tmpWs);
    fs.mkdirSync(path.join(tmpWs, 'FutureGridApp'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpWs, 'FutureGridApp', 'panorama.app.json'),
      JSON.stringify({ slug: 'futuregrid', port: 3012 }),
      'utf8'
    );

    const prevRoot = process.env.PANORAMA_WORKSPACE_ROOT;
    process.env.PANORAMA_WORKSPACE_ROOT = tmpWs;
    try {
      const discovered = getDiscoveredAppMappings(true);
      expect(discovered.some((m) => m.slug === 'futuregrid' && m.port === 3012)).toBe(true);

      const energyCmd = classifyShellCommand('npx next dev -p 3005');
      expect(energyCmd.intercepted).toBe(true);
      expect(energyCmd.detectedSlug).toBe('energy');

      const resCmd = classifyShellCommand('npx next dev -p 4000');
      expect(resCmd.intercepted).toBe(true);
      expect(resCmd.detectedSlug).toBe('res');

      const futureCmd = classifyShellCommand('npm run dev', path.join(tmpWs, 'FutureGridApp'));
      expect(futureCmd.intercepted).toBe(true);
      expect(futureCmd.detectedSlug).toBe('futuregrid');

      const futureKill = classifyShellCommand('npx kill-port 3012');
      expect(futureKill.intercepted).toBe(true);
      expect(futureKill.detectedSlug).toBe('futuregrid');
    } finally {
      if (prevRoot === undefined) {
        delete process.env.PANORAMA_WORKSPACE_ROOT;
      } else {
        process.env.PANORAMA_WORKSPACE_ROOT = prevRoot;
      }
      getDiscoveredAppMappings(true);
    }
  });
});
