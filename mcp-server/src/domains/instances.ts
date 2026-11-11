import {
  discoverLiveInstances,
  electInstance,
  ensurePanoramaSreRunning,
} from '../client/discovery.ts';
import type { SreToolDomain } from '../types/ipc.ts';

export const instancesDomain: SreToolDomain = {
  domainId: 'instances',
  description:
    'Discovers, inspects, and auto-launches PanoramaSRE desktop control plane instances across installed, portable, and cargo/tauri dev sessions.',
  tools: [
    {
      name: 'sre_instances_list',
      description:
        'Lists all currently running PanoramaSRE instances discovered via zero-trust Windows Named Pipe leases, showing their PID, channel (installed | dev | portable), managed dev servers, and which instance is elected as primary.',
      inputSchema: {
        type: 'object',
        properties: {
          autoLaunchIfNone: {
            type: 'boolean',
            description:
              'If true and no running PanoramaSRE instance is found, automatically verifies Authenticode and launches PanoramaSRE.',
            default: false,
          },
        },
      },
      handler: async (args) => {
        const autoLaunch = Boolean(args.autoLaunchIfNone);
        let instances = await discoverLiveInstances();
        let autoLaunched = false;
        let launchError: string | undefined;

        if (instances.length === 0 && autoLaunch) {
          const res = await ensurePanoramaSreRunning('auto');
          autoLaunched = res.launched;
          launchError = res.error;
          instances = await discoverLiveInstances();
        }

        const primary = electInstance(instances, 'auto');

        return {
          totalInstances: instances.length,
          autoLaunched,
          launchError,
          primaryInstanceId: primary?.ping.instanceId ?? null,
          instances: instances.map((i) => ({
            instanceId: i.ping.instanceId,
            pid: i.ping.pid,
            channel: i.ping.channel,
            version: i.ping.version,
            exePath: i.ping.exePath,
            workspaceRoot: i.ping.workspaceRoot,
            startedAt: i.ping.startedAt,
            managedApps: i.ping.managedApps,
            managedCount: i.ping.managedCount,
            isPrimaryElected: i.ping.instanceId === primary?.ping.instanceId,
          })),
        };
      },
    },
  ],
};
