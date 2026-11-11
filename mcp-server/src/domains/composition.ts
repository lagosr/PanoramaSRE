import { callSrePipe } from '../client/pipeClient.ts';
import { ensurePanoramaSreRunning } from '../client/discovery.ts';
import type { SreToolDomain } from '../types/ipc.ts';

export const compositionDomain: SreToolDomain = {
  domainId: 'git_composition',
  description:
    'Inspects git provenance, uncommitted dirty files, ahead/behind counts, blast radius classification badges, and build telemetry across PanoramaDrSuite repositories.',
  tools: [
    {
      name: 'sre_git_composition',
      description:
        'Computes git composition, dirty file status, blast radius badges (DB_MIGRATION, AUTH_SECURITY, ENV_CONTRACT, etc.), and recent release candidates for one or all suite applications.',
      inputSchema: {
        type: 'object',
        properties: {
          slug: {
            type: 'string',
            description:
              'Optional application slug ("auth", "spendy", "biomed", "water", "basket", or "all"). Omit for all apps.',
            default: 'all',
          },
          instance: {
            type: 'string',
            description:
              'Target PanoramaSRE instance selector ("auto", "installed", "dev", or "sre-<pid>").',
            default: 'auto',
          },
        },
      },
      handler: async (args) => {
        const slug = typeof args.slug === 'string' ? args.slug.trim().toLowerCase() : 'all';
        const selector = typeof args.instance === 'string' ? args.instance : 'auto';

        const ensured = await ensurePanoramaSreRunning(selector);
        if (!ensured.instance) {
          throw new Error(
            ensured.error || 'Unable to connect to or launch PanoramaSRE.'
          );
        }

        const res = await callSrePipe<{ reports: unknown[] }>(
          ensured.instance.lease,
          'git.composition',
          { slug },
          { timeoutMs: 12000 }
        );

        return {
          handledByInstance: {
            instanceId: ensured.instance.ping.instanceId,
            pid: ensured.instance.ping.pid,
            channel: ensured.instance.ping.channel,
          },
          reports: res.reports,
        };
      },
    },
  ],
};
