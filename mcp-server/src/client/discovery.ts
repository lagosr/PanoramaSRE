import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { callSrePipe } from './pipeClient.ts';
import type {
  InstancePingData,
  LiveSreInstance,
  SreChannel,
  SreInstanceLease,
} from '../types/ipc.ts';

/**
 * Resolves the IPC lease directory `%LOCALAPPDATA%\com.panoramadr.sre\ipc`.
 */
export function resolveLeaseDirectory(overrideDir?: string): string {
  if (overrideDir) {
    return overrideDir;
  }
  const localAppData =
    process.env.LOCALAPPDATA ||
    (process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, 'AppData', 'Local')
      : '');
  if (localAppData) {
    return path.join(localAppData, 'com.panoramadr.sre', 'ipc');
  }
  return path.resolve('data/ipc');
}

/**
 * Checks whether a process PID is currently alive on the OS.
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM means the process exists but belongs to another privilege context
    return code === 'EPERM';
  }
}

/**
 * Checks if a local TCP port is actively accepting connections on 127.0.0.1.
 */
export async function isLocalPortListening(port: number, timeoutMs = 250): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (result: boolean) => {
      if (!done) {
        done = true;
        socket.destroy();
        resolve(result);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, '127.0.0.1');
  });
}

/**
 * Reads all `lease-*.json` files, prunes stale dead-PID leases, and pings each live instance.
 */
export async function discoverLiveInstances(overrideDir?: string): Promise<LiveSreInstance[]> {
  const leaseDir = resolveLeaseDirectory(overrideDir);
  if (!fs.existsSync(leaseDir)) {
    return [];
  }

  let files: string[] = [];
  try {
    files = fs
      .readdirSync(leaseDir)
      .filter((f) => f.startsWith('lease-') && f.endsWith('.json'));
  } catch {
    return [];
  }

  const candidates: Array<{ lease: SreInstanceLease; filePath: string }> = [];

  for (const file of files) {
    const fullPath = path.join(leaseDir, file);
    try {
      const raw = fs.readFileSync(fullPath, 'utf8');
      const lease = JSON.parse(raw) as SreInstanceLease;
      if (!lease || !lease.pid || !lease.pipeName || !lease.hmacSecret) {
        fs.unlinkSync(fullPath);
        continue;
      }
      if (!isPidAlive(lease.pid)) {
        try {
          fs.unlinkSync(fullPath);
        } catch {
          // Ignore delete race
        }
        continue;
      }
      candidates.push({ lease, filePath: fullPath });
    } catch {
      // Ignore malformed or locked file
    }
  }

  const pingResults = await Promise.all(
    candidates.map(async ({ lease, filePath }): Promise<LiveSreInstance | null> => {
      try {
        const ping = await callSrePipe<InstancePingData>(
          lease,
          'instances.ping',
          {},
          { timeoutMs: 2000 }
        );
        return {
          lease,
          ping,
          leaseFilePath: filePath,
        };
      } catch {
        return null;
      }
    })
  );

  return pingResults.filter((item): item is LiveSreInstance => item !== null);
}

const CHANNEL_PRIORITY: Record<SreChannel, number> = {
  installed: 3,
  portable: 2,
  dev: 1,
};

/**
 * Deterministic Multi-Instance Election Algorithm:
 * 1. If explicit `selector` ("installed", "dev", "portable", "sre-<pid>", "<pid>") is provided, match it.
 * 2. In "auto" mode:
 *    a. Active Supervisor Affinity: If `targetSlug` is already managed by an instance, select it immediately.
 *    b. Highest active `managedCount` (> 0).
 *    c. Channel priority tie-breaker: `installed` > `portable` > `dev`.
 *    d. Earliest `startedAt` timestamp.
 */
export function electInstance(
  instances: LiveSreInstance[],
  selector = 'auto',
  targetSlug?: string
): LiveSreInstance | null {
  if (instances.length === 0) {
    return null;
  }

  const cleanSelector = (selector || 'auto').trim().toLowerCase();

  if (cleanSelector !== 'auto') {
    const byExactMatch = instances.find(
      (i) =>
        i.ping.instanceId.toLowerCase() === cleanSelector ||
        String(i.ping.pid) === cleanSelector ||
        `sre-${i.ping.pid}` === cleanSelector ||
        i.ping.channel.toLowerCase() === cleanSelector
    );
    if (byExactMatch) {
      return byExactMatch;
    }
  }

  // 2a. Active Supervisor Affinity for targetSlug
  if (targetSlug && targetSlug !== 'all') {
    const cleanSlug = targetSlug.trim().toLowerCase();
    const affinityMatch = instances.find((inst) =>
      inst.ping.managedApps.some((appId) => appId.toLowerCase() === cleanSlug)
    );
    if (affinityMatch) {
      return affinityMatch;
    }
  }

  // 2b/c/d. Sort by managedCount DESC, channel priority DESC, startedAt ASC
  const sorted = [...instances].sort((a, b) => {
    if (b.ping.managedCount !== a.ping.managedCount) {
      return b.ping.managedCount - a.ping.managedCount;
    }
    const prioA = CHANNEL_PRIORITY[a.ping.channel] ?? 0;
    const prioB = CHANNEL_PRIORITY[b.ping.channel] ?? 0;
    if (prioB !== prioA) {
      return prioB - prioA;
    }
    return a.ping.startedAt.localeCompare(b.ping.startedAt);
  });

  return sorted[0] ?? null;
}

/**
 * Resolves candidate PanoramaSRE executable paths on disk for auto-launch.
 */
export function getCandidateSreExecutablePaths(): string[] {
  const candidates: string[] = [];
  const localAppData =
    process.env.LOCALAPPDATA ||
    (process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, 'AppData', 'Local')
      : '');

  if (localAppData) {
    candidates.push(path.join(localAppData, 'PanoramaSRE', 'panorama-sre.exe'));
    candidates.push(path.join(localAppData, 'Programs', 'PanoramaSRE', 'panorama-sre.exe'));
  }

  if (process.env.ProgramFiles) {
    candidates.push(path.join(process.env.ProgramFiles, 'PanoramaSRE', 'panorama-sre.exe'));
  }

  candidates.push(
    'C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaSRE\\src-tauri\\target\\release\\panorama-sre.exe',
    'C:\\Users\\rodrigo\\Documents\\AG Projects\\PanoramaSRE\\src-tauri\\target\\debug\\panorama-sre.exe'
  );

  return candidates.filter((p) => fs.existsSync(p));
}

export interface AuthenticodeCheckResult {
  trusted: boolean;
  status: string;
  signerSubject: string;
  reason: string;
}

/**
 * Verifies the X.509 Authenticode signature of `exePath` before auto-launching.
 */
export function verifyExecutableAuthenticode(exePath: string): AuthenticodeCheckResult {
  if (!fs.existsSync(exePath)) {
    return {
      trusted: false,
      status: 'FileNotFound',
      signerSubject: '',
      reason: `Executable does not exist: ${exePath}`,
    };
  }

  try {
    const psScript = `
      $sig = Get-AuthenticodeSignature -LiteralPath $env:SRE_VERIFY_EXE
      $subj = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '' }
      @{
        Status = [string]$sig.Status
        Subject = [string]$subj
      } | ConvertTo-Json -Compress
    `;

    const stdout = execFileSync(
      'pwsh.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      {
        env: { ...process.env, SRE_VERIFY_EXE: exePath },
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      }
    );

    const parsed = JSON.parse(stdout.trim()) as { Status?: string; Subject?: string };
    const status = parsed.Status || 'Unknown';
    const subject = parsed.Subject || '';

    // 1. Valid trusted signature
    if (status === 'Valid') {
      return {
        trusted: true,
        status,
        signerSubject: subject,
        reason: 'Valid X.509 Authenticode signature',
      };
    }

    // 2. Signed by PanoramaDrSuite Dev / Enterprise Root CA (even if root isn't in machine store yet), provided hash is not tampered
    if (
      status !== 'HashMismatch' &&
      status !== 'NotSigned' &&
      subject.toLowerCase().includes('panorama')
    ) {
      return {
        trusted: true,
        status,
        signerSubject: subject,
        reason: `Signed by Panorama certificate (${subject})`,
      };
    }

    // 3. Local Rust target\release or target\debug build inside trusted workspace
    const normPath = exePath.replace(/\//g, '\\').toLowerCase();
    if (
      status === 'NotSigned' &&
      normPath.includes('\\panoramasre\\src-tauri\\target\\')
    ) {
      return {
        trusted: true,
        status,
        signerSubject: 'Local Cargo Target Build',
        reason: 'Trusted local workspace Cargo build output',
      };
    }

    return {
      trusted: false,
      status,
      signerSubject: subject,
      reason: `Untrusted Authenticode status '${status}' (Subject: '${subject || 'none'}')`,
    };
  } catch (err) {
    return {
      trusted: false,
      status: 'VerificationError',
      signerSubject: '',
      reason: `Failed to verify Authenticode signature: ${(err as Error).message}`,
    };
  }
}

export interface AutoLaunchResult {
  launched: boolean;
  instance: LiveSreInstance | null;
  exePath?: string;
  error?: string;
}

/**
 * Ensures at least one live `PanoramaSRE` instance is running and responsive over Named Pipe.
 * If none is running, verifies Authenticode on the best available binary, spawns it detached,
 * and polls for up to 5.5 seconds until its Named Pipe lease comes online.
 */
export async function ensurePanoramaSreRunning(
  selector = 'auto',
  targetSlug?: string
): Promise<AutoLaunchResult> {
  const existing = await discoverLiveInstances();
  if (existing.length > 0) {
    return {
      launched: false,
      instance: electInstance(existing, selector, targetSlug),
    };
  }

  const candidates = getCandidateSreExecutablePaths();
  if (candidates.length === 0) {
    return {
      launched: false,
      instance: null,
      error:
        'No PanoramaSRE executable found in %LOCALAPPDATA%\\PanoramaSRE or workspace target directory.',
    };
  }

  let verifiedExe: string | null = null;
  let lastVerifyReason = '';

  for (const candidate of candidates) {
    const check = verifyExecutableAuthenticode(candidate);
    if (check.trusted) {
      verifiedExe = candidate;
      break;
    }
    lastVerifyReason = `${candidate}: ${check.reason}`;
  }

  if (!verifiedExe) {
    return {
      launched: false,
      instance: null,
      error: `Refusing to auto-launch PanoramaSRE due to Authenticode check failure: ${lastVerifyReason}`,
    };
  }

  try {
    const child = spawn(verifiedExe, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      cwd: path.dirname(verifiedExe),
    });
    child.unref();
  } catch (spawnErr) {
    return {
      launched: false,
      instance: null,
      exePath: verifiedExe,
      error: `Failed to spawn PanoramaSRE (${verifiedExe}): ${(spawnErr as Error).message}`,
    };
  }

  const deadline = Date.now() + 5500;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const live = await discoverLiveInstances();
    if (live.length > 0) {
      return {
        launched: true,
        instance: electInstance(live, selector, targetSlug),
        exePath: verifiedExe,
      };
    }
  }

  return {
    launched: true,
    instance: null,
    exePath: verifiedExe,
    error: `Spawned PanoramaSRE (${verifiedExe}), but IPC lease did not become ready within 5.5s.`,
  };
}
