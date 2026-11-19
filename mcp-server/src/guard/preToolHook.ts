import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverLiveInstances,
  electInstance,
  ensurePanoramaSreRunning,
} from '../client/discovery.ts';

export interface CommandInterceptionAnalysis {
  intercepted: boolean;
  category?:
    | 'DEV_SERVER_START'
    | 'DEV_SERVER_KILL'
    | 'BACKGROUND_DAEMON_SPAWN'
    | 'SMOKE_TEST_EXECUTION';
  detectedSlug?: string;
  reason?: string;
}

interface DiscoveredManifestEntry {
  dirPattern: RegExp;
  slug: string;
  port: number;
}

const BASELINE_ENTRIES: DiscoveredManifestEntry[] = [
  { dirPattern: /PanoramaAuth/i, slug: 'auth', port: 3000 },
  { dirPattern: /SpendyLedger/i, slug: 'spendy', port: 3001 },
  { dirPattern: /BiomedMaven/i, slug: 'biomed', port: 3002 },
  { dirPattern: /WaterAnalyzer/i, slug: 'water', port: 3003 },
  { dirPattern: /TastyBasket/i, slug: 'basket', port: 3004 },
  { dirPattern: /EnergyAnalyzer/i, slug: 'energy', port: 3005 },
  { dirPattern: /ParakithSite/i, slug: 'parakith', port: 3500 },
  { dirPattern: /PanoramaResources/i, slug: 'res', port: 4000 },
];

const MANIFEST_CACHE_TTL_MS = 60_000;
let cachedManifestEntries: DiscoveredManifestEntry[] | null = null;
let cachedManifestTimestamp = 0;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getWorkspaceRootCandidate(): string {
  if (process.env.PANORAMA_WORKSPACE_ROOT) {
    return process.env.PANORAMA_WORKSPACE_ROOT;
  }
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(__dirname, '../../../..');
}

/**
 * Dynamically scans sibling `<app>/panorama.app.json` manifests (with a 60s TTL cache)
 * so new suite apps like EnergyAnalyzer (:3005) are auto-discovered without code edits.
 */
export function getDiscoveredAppMappings(forceRefresh = false): DiscoveredManifestEntry[] {
  const now = Date.now();
  if (!forceRefresh && cachedManifestEntries && now - cachedManifestTimestamp < MANIFEST_CACHE_TTL_MS) {
    return cachedManifestEntries;
  }

  const bySlug = new Map<string, DiscoveredManifestEntry>();
  for (const base of BASELINE_ENTRIES) {
    bySlug.set(base.slug, base);
  }

  try {
    const workspaceRoot = getWorkspaceRootCandidate();
    if (fs.existsSync(workspaceRoot)) {
      const dirs = fs.readdirSync(workspaceRoot, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const manifestPath = path.join(workspaceRoot, dir.name, 'panorama.app.json');
        if (!fs.existsSync(manifestPath)) continue;
        try {
          const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
            slug?: string;
            port?: number;
          };
          if (typeof parsed?.slug === 'string' && typeof parsed?.port === 'number') {
            const slug = parsed.slug.trim().toLowerCase();
            bySlug.set(slug, {
              dirPattern: new RegExp(escapeRegex(dir.name), 'i'),
              slug,
              port: parsed.port,
            });
          }
        } catch {
          // Ignore malformed manifest JSON
        }
      }
    }
  } catch {
    // Non-fatal fallback to baseline mappings
  }

  cachedManifestEntries = Array.from(bySlug.values());
  cachedManifestTimestamp = now;
  return cachedManifestEntries;
}

function inferTargetSlug(cmd: string, cwd?: string): string | undefined {
  const mappings = getDiscoveredAppMappings();
  const combined = `${cmd} ${cwd || ''}`;
  for (const entry of mappings) {
    if (entry.dirPattern.test(combined)) {
      return entry.slug;
    }
  }
  const portsPattern = Array.from(new Set(mappings.map((m) => String(m.port)))).join('|');
  const portMatch = cmd.match(new RegExp(`\\b(${portsPattern})\\b`));
  if (portMatch) {
    const portNum = Number(portMatch[1]);
    const hit = mappings.find((m) => m.port === portNum);
    if (hit) return hit.slug;
  }
  return undefined;
}

/**
 * Deterministic classifier for shell commands passed to `run_command`.
 * Intercepts:
 * 1. Unmanaged web dev server startups (`npm run dev`, `npm start`, `npx next dev`, etc.)
 * 2. Unmanaged port/process kills targeting PanoramaDrSuite ports (`3000`–`3009`, `4000`) or `node`
 * 3. Background daemon spawns (`IsDaemon: true`, `Start-Process`, `Start-Job`)
 * Explicitly exempts `PanoramaSRE` Tauri desktop development (`tauri dev`, `cargo`, `vite`)
 * as well as build/test/typecheck commands (`npm run build`, `vitest`, `tsc`).
 */
export function classifyShellCommand(
  commandLine: string,
  cwd?: string,
  isDaemon?: boolean
): CommandInterceptionAnalysis {
  const trimmed = (commandLine || '').trim();
  if (!trimmed && !isDaemon) {
    return { intercepted: false };
  }

  // 1. Explicit Exemption: Developing or testing PanoramaSRE desktop app itself (Tauri / Cargo / Vite)
  if (
    /\b(tauri\s+dev|cargo\s+(tauri|run|test|check|build)|npx\s+tauri)\b/i.test(trimmed) ||
    (/PanoramaSRE/i.test(`${trimmed} ${cwd || ''}`) && /\b(vite|npm\s+run\s+dev)\b/i.test(trimmed))
  ) {
    return { intercepted: false };
  }

  // 2. Intercept direct Next.js / Wrangler Pages / web application dev server startup commands
  const devStartRegex =
    /(?:^|[;&|]\s*|\b)(?:npm(?:\.cmd)?\s+(?:run\s+(?:dev|preview)|start)|pnpm\s+(?:run\s+)?(?:dev|preview|start)|yarn\s+(?:dev|preview|start)|npx(?:\.cmd)?\s+(?:next\s+(?:dev|start)|wrangler\s+pages\s+dev)|next\s+(?:dev|start)|wrangler\s+pages\s+dev|node(?:\.exe)?\s+[^\r\n]*next[^\r\n]*(?:dev|start))\b/i;

  if (devStartRegex.test(trimmed)) {
    const slug = inferTargetSlug(trimmed, cwd);
    return {
      intercepted: true,
      category: 'DEV_SERVER_START',
      detectedSlug: slug,
      reason: `Direct shell dev server execution ('${trimmed}') bypasses PanoramaSRE supervision.`,
    };
  }

  // 3. Intercept manual port-killing or blanket node process termination targeting suite dev servers
  const portUnion = Array.from(
    new Set(['300[0-9]', '3500', '4000', ...getDiscoveredAppMappings().map((m) => String(m.port))])
  ).join('|');
  const portKillRegex = new RegExp(
    `\\b(?:Get-NetTCPConnection[^\\r\\n]*(?:${portUnion})[^\\r\\n]*Stop-Process|Stop-Process[^\\r\\n]*(?:-Name\\s+['"]?node|${portUnion})|taskkill(?:\\.exe)?[^\\r\\n]*(?:\\/IM\\s+node(?:\\.exe)?|${portUnion})|npx(?:\\.cmd)?\\s+kill-port\\s+(?:${portUnion}))\\b`,
    'i'
  );

  if (portKillRegex.test(trimmed)) {
    const slug = inferTargetSlug(trimmed, cwd);
    return {
      intercepted: true,
      category: 'DEV_SERVER_KILL',
      detectedSlug: slug,
      reason: `Direct shell process/port termination ('${trimmed}') desynchronizes PanoramaSRE supervision.`,
    };
  }

  // 4. Intercept direct smoke test execution via run_command (must run inside PanoramaSRE via MCP)
  const smokeTestExecRegex =
    /(?:^|[;&|]\s*)(?:pwsh(?:\.exe)?|powershell(?:\.exe)?|node(?:\.exe)?|npx(?:\.cmd)?|tsx(?:\.cmd)?|&|\.[\\/])[^\r\n]*\b(?:Run-SmokeTests\.ps1|smoke-tests\.ts)\b/i;

  if (smokeTestExecRegex.test(trimmed) && !/-RegisterDailyTask\b/i.test(trimmed)) {
    return {
      intercepted: true,
      category: 'SMOKE_TEST_EXECUTION',
      reason: `Direct shell smoke test execution ('${trimmed}') bypasses PanoramaSRE live telemetry streaming and run history.`,
    };
  }

  // 5. Intercept background process / daemon spawning in conversation threads
  const bgProcessRegex =
    /\b(?:Start-Process|Start-Job)\b[^\r\n]*\b(?:npm|npx|node|next|wrangler|dev|preview)\b/i;

  if (isDaemon === true || bgProcessRegex.test(trimmed)) {
    const slug = inferTargetSlug(trimmed, cwd);
    return {
      intercepted: true,
      category: 'BACKGROUND_DAEMON_SPAWN',
      detectedSlug: slug,
      reason: `Spawning background daemon processes via run_command (${isDaemon ? 'IsDaemon=true' : 'Start-Process/Start-Job'}) is prohibited; all background servers must be supervised by PanoramaSRE.`,
    };
  }

  return { intercepted: false };
}

export interface HookOutputPayload {
  decision: 'allow' | 'deny' | 'ask';
  reason?: string;
}

function buildHookDecision(
  decision: 'allow' | 'deny' | 'ask',
  reason?: string
): HookOutputPayload {
  return {
    decision,
    ...(reason ? { reason } : {}),
  };
}

/**
 * Evaluates a `PreToolUse` hook event for `run_command`.
 */
export async function evaluatePreToolUse(
  input: Record<string, unknown>
): Promise<HookOutputPayload> {
  const toolName = String(
    input.tool_name ||
      (input.toolCall as Record<string, unknown> | undefined)?.name ||
      ''
  );

  if (toolName && toolName !== 'run_command') {
    return buildHookDecision('allow');
  }

  const toolInput =
    (input.tool_input as Record<string, unknown> | undefined) ||
    ((input.toolCall as Record<string, unknown> | undefined)?.args as
      | Record<string, unknown>
      | undefined) ||
    input;

  const commandLine = String(
    toolInput.CommandLine || toolInput.command || toolInput.cmd || ''
  );
  const isDaemon = Boolean(toolInput.IsDaemon);
  const cwd = typeof input.cwd === 'string' ? input.cwd : undefined;

  const analysis = classifyShellCommand(commandLine, cwd, isDaemon);
  if (!analysis.intercepted) {
    return buildHookDecision('allow');
  }

  const slugHint = analysis.detectedSlug || '<slug>';
  const isSmokeTest = analysis.category === 'SMOKE_TEST_EXECUTION';
  const recommendedTool = isSmokeTest
    ? `sre_ops_telemetry({ domain: "smoke_run" }) (or domain: "smoke" to inspect recent run history)`
    : analysis.category === 'DEV_SERVER_KILL'
    ? `sre_dev_stop({ slug: "${slugHint}" }) or sre_dev_restart({ slug: "${slugHint}" })`
    : `sre_dev_start({ slug: "${slugHint}" }) or sre_dev_restart({ slug: "${slugHint}" })`;

  // Check if PanoramaSRE is already running
  const liveInstances = await discoverLiveInstances();
  if (liveInstances.length > 0) {
    const primary = electInstance(liveInstances, 'auto', analysis.detectedSlug);
    const summaryList = liveInstances
      .map(
        (i) =>
          `${i.ping.instanceId} (PID ${i.ping.pid}, channel=${i.ping.channel}, managing=[${i.ping.managedApps.join(', ') || 'none'}])`
      )
      .join('; ');

    return buildHookDecision(
      'deny',
      `[PanoramaSRE Control Plane Guard] ${analysis.reason} ` +
        `Active PanoramaSRE instance(s): ${summaryList} (elected primary: ${primary?.ping.instanceId}). ` +
        (isSmokeTest
          ? `Instead of running smoke tests directly via run_command, invoke the PanoramaSRE MCP tool: ${recommendedTool} so execution streams live inside PanoramaSRE.`
          : `Instead of starting or killing dev servers via run_command, invoke the PanoramaSRE MCP tool: ${recommendedTool} (or sre_dev_status() to inspect ports).`)
    );
  }

  // Option A: No running PanoramaSRE instance — auto-verify Authenticode and launch PanoramaSRE!
  const autoLaunch = await ensurePanoramaSreRunning('auto', analysis.detectedSlug);
  if (autoLaunch.instance) {
    return buildHookDecision(
      'deny',
      `[PanoramaSRE Auto-Launched] PanoramaSRE was not running and has now been automatically verified and launched ` +
        `(instance ${autoLaunch.instance.ping.instanceId}, PID ${autoLaunch.instance.ping.pid}, channel=${autoLaunch.instance.ping.channel}). ` +
        (isSmokeTest
          ? `Do NOT run smoke tests via run_command — now call the PanoramaSRE MCP tool: ${recommendedTool}.`
          : `Do NOT start or kill dev servers via run_command — now call the PanoramaSRE MCP tool: ${recommendedTool}.`)
    );
  }

  // Fallback if binary was missing or failed Authenticode verification
  return buildHookDecision(
    'ask',
    `[PanoramaSRE Guard] ${analysis.reason} PanoramaSRE is not running and could not be auto-launched (${autoLaunch.error || 'unknown error'}). ` +
      `Ask the developer whether to launch PanoramaSRE or proceed manually.`
  );
}

async function runCliHook(): Promise<void> {
  try {
    const rawStdin = fs.readFileSync(0, 'utf8').trim();
    const parsed = rawStdin ? (JSON.parse(rawStdin) as Record<string, unknown>) : {};
    const result = await evaluatePreToolUse(parsed);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    // Fail-safe allow if stdin is non-JSON so unrelated commands are not bricked
    process.stdout.write(`${JSON.stringify(buildHookDecision('allow'))}\n`);
  }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('guard/preToolHook.ts')) {
  runCliHook();
}
