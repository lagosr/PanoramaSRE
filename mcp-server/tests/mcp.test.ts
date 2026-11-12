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
import { classifyShellCommand, evaluatePreToolUse } from '../src/guard/preToolHook.ts';
import { handleJsonRpcMessage, getAllRegisteredTools } from '../src/index.ts';
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

    // Blocked port/process kill commands
    const kill1 = classifyShellCommand(
      'Get-NetTCPConnection -LocalPort 3002 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'
    );
    expect(kill1.intercepted).toBe(true);
    expect(kill1.category).toBe('DEV_SERVER_KILL');
    expect(kill1.detectedSlug).toBe('biomed');

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
});
