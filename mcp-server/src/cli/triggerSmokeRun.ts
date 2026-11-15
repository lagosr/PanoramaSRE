import { discoverLiveInstances, electInstance } from '../client/discovery.ts';
import { callSrePipe } from '../client/pipeClient.ts';

export const FALLBACK_HEADLESS_EXIT_CODE = 2;

export interface TriggerSmokeBridgeOptions {
  targetUrl?: string;
  triggeredBy?: string;
  forceSms?: boolean;
  leaseDir?: string;
  timeoutMs?: number;
}

export interface TriggerSmokeBridgeResult {
  routedViaSre: boolean;
  instanceId?: string;
  pid?: number;
  exitCode: number;
  message: string;
}

interface SmokeRunResponse {
  id?: string;
  total?: number;
  passed?: number;
  failed?: number;
}

function isPipeTransportUnavailableError(message: string): boolean {
  return (
    message.startsWith('Named Pipe connection error') ||
    message.startsWith('Named Pipe closed before response was received')
  );
}

/**
 * Triggers a production smoke test run through an already-running PanoramaSRE desktop
 * instance over its Zero-Trust Named Pipe bridge so output streams live into the UI.
 * Never auto-launches PanoramaSRE; returns exitCode=2 when no instance is open so
 * callers (e.g., Windows Task Scheduler) can fall back to headless execution.
 */
export async function triggerSmokeViaSreBridge(
  options: TriggerSmokeBridgeOptions = {}
): Promise<TriggerSmokeBridgeResult> {
  const targetUrl = (options.targetUrl || 'https://wsh.panoramadr.com').trim();
  const triggeredBy = (options.triggeredBy || 'scheduled').trim() || 'scheduled';
  const forceSms = Boolean(options.forceSms);
  const timeoutMs = options.timeoutMs ?? 90_000;

  const instances = await discoverLiveInstances(options.leaseDir);
  if (instances.length === 0) {
    return {
      routedViaSre: false,
      exitCode: FALLBACK_HEADLESS_EXIT_CODE,
      message: 'No active PanoramaSRE instance found; falling back to headless smoke runner.',
    };
  }

  const elected = electInstance(instances, 'auto');
  if (!elected) {
    return {
      routedViaSre: false,
      exitCode: FALLBACK_HEADLESS_EXIT_CODE,
      message: 'Unable to elect an active PanoramaSRE instance; falling back to headless smoke runner.',
    };
  }

  const params: Record<string, unknown> = {
    domain: 'smoke_run',
    targetUrl,
    triggeredBy,
  };
  if (forceSms) {
    params.forceSms = true;
  }

  try {
    const run = await callSrePipe<SmokeRunResponse>(elected.lease, 'ops.telemetry', params, {
      timeoutMs,
    });
    const failed = typeof run?.failed === 'number' ? run.failed : 0;
    const passed = typeof run?.passed === 'number' ? run.passed : 0;
    const total = typeof run?.total === 'number' ? run.total : passed + failed;
    const exitCode = failed === 0 ? 0 : 1;

    return {
      routedViaSre: true,
      instanceId: elected.ping.instanceId,
      pid: elected.ping.pid,
      exitCode,
      message: `[PanoramaSRE Bridge] Smoke tests via ${elected.ping.instanceId} (PID ${elected.ping.pid}, trigger=${triggeredBy}): ${passed}/${total} passed (${failed} failed).`,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (isPipeTransportUnavailableError(errMsg)) {
      return {
        routedViaSre: false,
        instanceId: elected.ping.instanceId,
        pid: elected.ping.pid,
        exitCode: FALLBACK_HEADLESS_EXIT_CODE,
        message: `PanoramaSRE Named Pipe became unavailable (${errMsg}); falling back to headless smoke runner.`,
      };
    }

    return {
      routedViaSre: true,
      instanceId: elected.ping.instanceId,
      pid: elected.ping.pid,
      exitCode: 1,
      message: `[PanoramaSRE Bridge] Smoke execution via ${elected.ping.instanceId} failed: ${errMsg}`,
    };
  }
}

function parseCliArgs(argv: string[]): TriggerSmokeBridgeOptions {
  const opts: TriggerSmokeBridgeOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--target' && argv[i + 1]) {
      opts.targetUrl = argv[++i];
    } else if (arg === '--triggered-by' && argv[i + 1]) {
      opts.triggeredBy = argv[++i];
    } else if (arg === '--force-sms') {
      opts.forceSms = true;
    } else if (arg === '--lease-dir' && argv[i + 1]) {
      opts.leaseDir = argv[++i];
    }
  }
  return opts;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('cli/triggerSmokeRun.ts')) {
  triggerSmokeViaSreBridge(parseCliArgs(process.argv.slice(2)))
    .then((result) => {
      if (result.exitCode === 1) {
        console.error(result.message);
      } else {
        console.log(result.message);
      }
      process.exit(result.exitCode);
    })
    .catch((err) => {
      console.error(
        `[PanoramaSRE Bridge] Unexpected bridge failure: ${err instanceof Error ? err.message : String(err)}`
      );
      process.exit(FALLBACK_HEADLESS_EXIT_CODE);
    });
}
