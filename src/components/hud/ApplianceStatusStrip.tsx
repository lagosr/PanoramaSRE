import { ApplianceStatus, SslFleetSummary } from '../../lib/types';

interface ApplianceStatusStripProps {
  appliances: ApplianceStatus[];
  sslFleet?: SslFleetSummary | null;
}

export function ApplianceStatusStrip({ appliances, sslFleet }: ApplianceStatusStripProps) {
  if (!appliances || appliances.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm mb-6">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Home Lab Appliances (LAN)
        </h4>
        <span className="text-[11px] font-mono text-slate-400">
          {appliances.filter((a) => a.status === 'ONLINE').length} / {appliances.length} Online
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full min-w-0">
        {appliances.map((appliance) => {
          const isOnline = appliance.status === 'ONLINE';
          const sslItem = sslFleet?.items.find(
            (i) =>
              i.domain.toLowerCase() === appliance.host.toLowerCase() ||
              i.device_key.toLowerCase().includes(appliance.key.toLowerCase())
          );

          return (
            <div
              key={appliance.key}
              className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80"
            >
              <div className="min-w-0 pr-2">
                <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                  {appliance.name}
                </p>
                <p className="text-[10px] text-slate-500 font-mono truncate">
                  {appliance.host}
                </p>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isOnline ? 'bg-emerald-400' : 'bg-rose-400'
                  }`}
                />
                <span
                  className={`text-[10px] font-semibold font-mono ${
                    isOnline ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {isOnline ? `${appliance.latency_ms}ms` : 'DOWN'}
                </span>

                {sslItem && sslItem.live_cert.reachable && (
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded border whitespace-nowrap flex-shrink-0 ${
                      sslItem.drift_status === 'DRIFT_DETECTED'
                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/40'
                        : sslItem.live_cert.status === 'CRITICAL'
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                        : sslItem.live_cert.status === 'EXPIRING_SOON'
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    }`}
                    title={`SSL Valid until ${sslItem.live_cert.not_after}. Drift: ${sslItem.drift_status}`}
                  >
                    {sslItem.drift_status === 'DRIFT_DETECTED'
                      ? 'DRIFT'
                      : `SSL ${sslItem.live_cert.days_remaining}d`}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
