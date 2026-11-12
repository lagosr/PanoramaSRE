import fs from 'node:fs';
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

const SUITE_PATH_TO_SLUG: Array<{ pattern: RegExp; slug: string }> = [
  { pattern: /PanoramaAuth/i, slug: 'auth' },
  { pattern: /SpendyLedger/i, slug: 'spendy' },
  { pattern: /BiomedMaven/i, slug: 'biomed' },
  { pattern: /WaterAnalyzer/i, slug: 'water' },
  { pattern: /TastyBasket/i, slug: 'basket' },
  { pattern: /PanoramaResources/i, slug: 'res' },
];

const PORT_TO_SLUG: Record<string, string> = {
  '3000': 'auth',
  '3001': 'spendy',
  '3002': 'biomed',
  '3003': 'water',
  '3004': 'basket',
  '3005': 'res',
  '4000': 'res',
};

function inferTargetSlug(cmd: string, cwd?: string): string | undefined {
  const combined = `${cmd} ${cwd || ''}`;
  for (const { pattern, slug } of SUITE_PATH_TO_SLUG) {
    if (pattern.test(combined)) {
      return slug;
    }
  }
  const portMatch = cmd.match(/\b(300[0-5]|4000)\b/);
  if (portMatch && PORT_TO_SLUG[portMatch[1]]) {
    return PORT_TO_SLUG[portMatch[1]];
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

  // 2. Intercept direct Next.js / web application dev server startup commands
  const devStartRegex =
    /(?:^|[;&|]\s*|\b)(?:npm(?:\.cmd)?\s+(?:run\s+dev|start)|pnpm\s+(?:run\s+)?(?:dev|start)|yarn\s+(?:dev|start)|npx(?:\.cmd)?\s+next\s+(?:dev|start)|next\s+(?:dev|start)|node(?:\.exe)?\s+[^\r\n]*next[^\r\n]*(?:dev|start))\b/i;

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
  const portKillRegex =
    /\b(?:Get-NetTCPConnection[^\r\n]*(?:300[0-9]|4000)[^\r\n]*Stop-Process|Stop-Process[^\r\n]*(?:-Name\s+['"]?node|300[0-9]|4000)|taskkill(?:\.exe)?[^\r\n]*(?:\/IM\s+node(?:\.exe)?|300[0-9]|4000)|npx(?:\.cmd)?\s+kill-port\s+(?:300[0-9]|4000))\b/i;

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
    /\b(?:Start-Process|Start-Job)\b[^\r\n]*\b(?:npm|npx|node|next|dev)\b/i;

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
