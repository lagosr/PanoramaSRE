import { callSrePipe } from '../client/pipeClient.ts';
import {
  ensurePanoramaSreRunning,
  isLocalPortListening,
} from '../client/discovery.ts';
import type { DevStatusResponseData, SreToolDomain } from '../types/ipc.ts';

async function waitForAppPortReady(
  port: number,
  maxWaitMs = 15000
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (await isLocalPortListening(port, 250)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

export const devServersDomain: SreToolDomain = {
  domainId: 'dev_servers',
  description:
    'Supervises local Next.js / web application dev servers across the PanoramaDrSuite ecosystem through PanoramaSRE (status, start, stop, restart) with live UI synchronization.',
  tools: [
    {
      name: 'sre_dev_status',
      description:
        'Queries PanoramaSRE for the real-time status (STOPPED | RUNNING_MANAGED | RUNNING_EXTERNAL), PID, TCP port, local URL, and SQLite database telemetry of all discovered PanoramaDrSuite applications.',
      inputSchema: {
        type: 'object',
        properties: {
          instance: {
            type: 'string',
            description:
              'Target PanoramaSRE instance selector: "auto" (default), "installed", "dev", "portable", or "sre-<pid>".',
            default: 'auto',
          },
        },
      },
      handler: async (args) => {
        const selector = typeof args.instance === 'string' ? args.instance : 'auto';
        const ensured = await ensurePanoramaSreRunning(selector);
        if (!ensured.instance) {
          throw new Error(
            ensured.error || 'No running PanoramaSRE instance is available.'
          );
        }

        const data = await callSrePipe<DevStatusResponseData>(
          ensured.instance.lease,
          'dev.status',
          {}
        );

        return {
          autoLaunchedSre: ensured.launched,
          handledByInstance: {
            instanceId: ensured.instance.ping.instanceId,
            pid: ensured.instance.ping.pid,
            channel: ensured.instance.ping.channel,
          },
          apps: data.apps,
        };
      },
    },
    {
      name: 'sre_dev_start',
      description:
        'Starts one or all PanoramaDrSuite local dev servers inside PanoramaSRE so the process is supervised by the PanoramaSRE UI. Automatically starts PanoramaAuth (:3000) first when required.',
      inputSchema: {
        type: 'object',
        properties: {
          slug: {
            type: 'string',
            description:
              'Application slug to start ("auth", "spendy", "biomed", "water", "basket", "res", or "all").',
          },
          withAuth: {
            type: 'boolean',
            description:
              'Whether to also ensure PanoramaAuth (:3000) is started first. Defaults to the app manifest requiresAuthInDev setting.',
          },
          waitForReady: {
            type: 'boolean',
            description:
              'Wait up to 15 seconds for the local TCP port(s) to begin accepting connections before returning.',
            default: true,
          },
          instance: {
            type: 'string',
            description:
              'Target PanoramaSRE instance selector: "auto" (default), "installed", "dev", or "sre-<pid>".',
            default: 'auto',
          },
        },
        required: ['slug'],
      },
      handler: async (args) => {
        const slug = String(args.slug || '').trim().toLowerCase();
        const selector = typeof args.instance === 'string' ? args.instance : 'auto';
        const waitForReady = args.waitForReady !== false;

        const ensured = await ensurePanoramaSreRunning(selector, slug);
        if (!ensured.instance) {
          throw new Error(
            ensured.error || 'Unable to connect to or launch PanoramaSRE.'
          );
        }

        const params: Record<string, unknown> = { slug };
        if (typeof args.withAuth === 'boolean') {
          params.withAuth = args.withAuth;
        }

        const startResult = await callSrePipe<{
          started: Array<{ slug: string; appId: string; pid: number; port: number }>;
          managedApps: string[];
        }>(ensured.instance.lease, 'dev.start', params, { timeoutMs: 15000 });

        const readiness: Array<{
          slug: string;
          port: number;
          pid: number;
          portListening: boolean;
        }> = [];

        if (waitForReady && Array.isArray(startResult.started)) {
          for (const item of startResult.started) {
            const listening = await waitForAppPortReady(item.port, 15000);
            readiness.push({
              slug: item.slug,
              port: item.port,
              pid: item.pid,
              portListening: listening,
            });
          }
        }

        return {
          autoLaunchedSre: ensured.launched,
          handledByInstance: {
            instanceId: ensured.instance.ping.instanceId,
            pid: ensured.instance.ping.pid,
            channel: ensured.instance.ping.channel,
          },
          started: startResult.started,
          readiness,
          managedApps: startResult.managedApps,
        };
      },
    },
    {
      name: 'sre_dev_stop',
      description:
        'Cleanly stops a running dev server (or "all" dev servers) inside PanoramaSRE and releases its TCP port and .next/lock file. Always call this before running npm run build if the dev server is active.',
      inputSchema: {
        type: 'object',
        properties: {
          slug: {
            type: 'string',
            description:
              'Application slug to stop ("auth", "spendy", "biomed", "water", "basket", "res", or "all").',
          },
          instance: {
            type: 'string',
            description:
              'Target PanoramaSRE instance selector: "auto" (default), "installed", "dev", or "sre-<pid>".',
            default: 'auto',
          },
        },
        required: ['slug'],
      },
      handler: async (args) => {
        const slug = String(args.slug || '').trim().toLowerCase();
        const selector = typeof args.instance === 'string' ? args.instance : 'auto';

        const ensured = await ensurePanoramaSreRunning(selector, slug);
        if (!ensured.instance) {
          throw new Error(
            ensured.error || 'Unable to connect to or launch PanoramaSRE.'
          );
        }

        const stopResult = await callSrePipe<{
          stopped: string[];
          managedApps: string[];
        }>(ensured.instance.lease, 'dev.stop', { slug }, { timeoutMs: 12000 });

        return {
          handledByInstance: {
            instanceId: ensured.instance.ping.instanceId,
            pid: ensured.instance.ping.pid,
            channel: ensured.instance.ping.channel,
          },
          stopped: stopResult.stopped,
          managedApps: stopResult.managedApps,
        };
      },
    },
    {
      name: 'sre_dev_restart',
      description:
        'Cleanly stops and restarts an application dev server inside PanoramaSRE and waits for its TCP port to accept connections.',
      inputSchema: {
        type: 'object',
        properties: {
          slug: {
            type: 'string',
            description:
              'Application slug to restart ("auth", "spendy", "biomed", "water", "basket", "res").',
          },
          waitForReady: {
            type: 'boolean',
            description:
              'Wait up to 15 seconds for the local TCP port to begin accepting connections after restart.',
            default: true,
          },
          instance: {
            type: 'string',
            description:
              'Target PanoramaSRE instance selector: "auto" (default), "installed", "dev", or "sre-<pid>".',
            default: 'auto',
          },
        },
        required: ['slug'],
      },
      handler: async (args) => {
        const slug = String(args.slug || '').trim().toLowerCase();
        const selector = typeof args.instance === 'string' ? args.instance : 'auto';
        const waitForReady = args.waitForReady !== false;

        const ensured = await ensurePanoramaSreRunning(selector, slug);
        if (!ensured.instance) {
          throw new Error(
            ensured.error || 'Unable to connect to or launch PanoramaSRE.'
          );
        }

        const restartResult = await callSrePipe<{
          slug: string;
          appId: string;
          pid: number;
          port: number;
          managedApps: string[];
        }>(ensured.instance.lease, 'dev.restart', { slug }, { timeoutMs: 15000 });

        const portListening = waitForReady
          ? await waitForAppPortReady(restartResult.port, 15000)
          : true;

        return {
          handledByInstance: {
            instanceId: ensured.instance.ping.instanceId,
            pid: ensured.instance.ping.pid,
            channel: ensured.instance.ping.channel,
          },
          ...restartResult,
          portListening,
        };
      },
    },
  ],
};
