import { callSrePipe } from '../client/pipeClient.ts';
import { ensurePanoramaSreRunning } from '../client/discovery.ts';
import type { SreToolDomain } from '../types/ipc.ts';

export const diagnosticsDomain: SreToolDomain = {
  domainId: 'ops_diagnostics',
  description:
    'Queries scrubbed system/audit logs, split-DNS network posture (LAN_DIRECT vs WAN_CLOUDFLARE), GFS backup ledger summaries, and 5-domain SSL certificate dual-probe status.',
  tools: [
    {
      name: 'sre_ops_telemetry',
      description:
        'Retrieves operational telemetry from PanoramaSRE: scrubbed system/audit logs ("logs"), network posture ("posture"), GFS database backup ledger ("backups"), or 5-domain SSL certificate drift status ("ssl").',
      inputSchema: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            description:
              'Telemetry domain to query: "logs" | "posture" | "backups" | "ssl" | "smoke" (recent smoke test runs) | "smoke_run" (trigger live smoke test suite).',
            enum: ['logs', 'posture', 'backups', 'ssl', 'smoke', 'smoke_run'],
            default: 'logs',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of log entries to return when domain="logs" (default 50, max 500).',
            default: 50,
          },
          category: {
            type: 'string',
            description:
              'Optional log category filter when domain="logs" (e.g., "DEV_SUPERVISOR", "AGENT_IPC", "SECURITY_ALERT", "SYSTEM").',
          },
          instance: {
            type: 'string',
            description:
              'Target PanoramaSRE instance selector ("auto", "installed", "dev", or "sre-<pid>").',
            default: 'auto',
          },
        },
        required: ['domain'],
      },
      handler: async (args) => {
        const domain = typeof args.domain === 'string' ? args.domain : 'logs';
        const selector = typeof args.instance === 'string' ? args.instance : 'auto';

        const ensured = await ensurePanoramaSreRunning(selector);
        if (!ensured.instance) {
          throw new Error(
            ensured.error || 'Unable to connect to or launch PanoramaSRE.'
          );
        }

        const params: Record<string, unknown> = { domain };
        if (typeof args.limit === 'number') {
          params.limit = args.limit;
        }
        if (typeof args.category === 'string' && args.category.trim() !== '') {
          params.category = args.category.trim();
        }

        const telemetry = await callSrePipe<unknown>(
          ensured.instance.lease,
          'ops.telemetry',
          params,
          { timeoutMs: 15000 }
        );

        return {
          handledByInstance: {
            instanceId: ensured.instance.ping.instanceId,
            pid: ensured.instance.ping.pid,
            channel: ensured.instance.ping.channel,
          },
          domain,
          telemetry,
        };
      },
    },
  ],
};
