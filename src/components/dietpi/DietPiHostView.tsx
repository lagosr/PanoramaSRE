import { WshSnapshot } from '../../lib/types';
import { RefreshCw, Server, Terminal, ShieldAlert, Cpu } from 'lucide-react';

interface DietPiHostViewProps {
  snapshot: WshSnapshot | null;
  isLoading: boolean;
  onRefresh: () => void;
  onTriggerAction: (actionLabel: string, cmd: string, args: string[]) => void;
}

export function DietPiHostView({
  snapshot,
  isLoading,
  onRefresh,
  onTriggerAction,
}: DietPiHostViewProps) {
  const formatUptime = (totalSeconds: number) => {
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  };

  const parseAptList = (raw: string) => {
    if (!raw) return [];
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('Listing...'))
      .map((line) => {
        const parts = line.split(' ');
        const pkg = parts[0] || '';
        return {
          pkg,
          raw: line,
        };
      });
  };

  const upgradablePkgs = parseAptList(snapshot?.apt_upgradable_raw || '');

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Server className="w-5 h-5 text-emerald-400" />
            DietPi Web Services Host (WSH)
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Raspberry Pi 5 OS health, APT packages, system services, and maintenance actions
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh Snapshot
          </button>
        </div>
      </div>

      {/* Reboot Banner if needed */}
      {snapshot?.reboot_required && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-rose-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-rose-200">Reboot Required</p>
              <p className="text-xs text-rose-300/80">Kernel or system libraries have been upgraded (/var/run/reboot-required)</p>
            </div>
          </div>
          <button
            onClick={() =>
              onTriggerAction('Reboot WSH', 'powershell.exe', [
                '-NoProfile',
                '-Command',
                'plink.exe -batch -ssh -i "D:\\Google\\My Drive\\RSA\\rsa-key-deployment.ppk" root@wsh.panoramadr.com "reboot"',
              ])
            }
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white whitespace-nowrap"
          >
            Reboot WSH Now
          </button>
        </div>
      )}

      {/* Host Metrics & Hardware */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">DietPi Version</p>
          <p className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-1 font-mono">
            {snapshot?.dietpi_version || 'Loading...'}
          </p>
          <p className="text-xs text-slate-400 mt-0.5 font-mono">Linux {snapshot?.kernel || 'kernel'}</p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Host Uptime</p>
          <p className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-1 font-mono">
            {snapshot ? formatUptime(snapshot.uptime_secs) : 'Loading...'}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">Host: {snapshot?.hostname || 'wsh'}</p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">RPi 5 Thermal State</p>
          <div className="flex items-center gap-2 mt-1">
            <Cpu className="w-5 h-5 text-emerald-400" />
            <span className="text-lg font-bold font-mono text-emerald-400">
              {snapshot?.rpi_throttled === '0x0' ? 'Normal (0x0)' : snapshot?.rpi_throttled || 'OK'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">vcgencmd get_throttled</p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">System Services</p>
          <div className="mt-1 space-y-1 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Lighttpd:</span>
              <span className={snapshot?.services.lighttpd === 'active' ? 'text-emerald-400' : 'text-slate-400'}>
                {snapshot?.services.lighttpd || 'Checking'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Docker:</span>
              <span className={snapshot?.services.docker === 'active' ? 'text-emerald-400' : 'text-slate-400'}>
                {snapshot?.services.docker || 'Checking'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Upgradable APT Packages */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              Upgradable Debian APT Packages ({upgradablePkgs.length})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Cached from apt list --upgradable via stateless read-only snapshot
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                onTriggerAction('Upgrade APT Packages', 'powershell.exe', [
                  '-NoProfile',
                  '-Command',
                  'plink.exe -batch -ssh -i "D:\\Google\\My Drive\\RSA\\rsa-key-deployment.ppk" root@wsh.panoramadr.com "DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y"',
                ])
              }
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
            >
              Upgrade All Packages
            </button>
          </div>
        </div>

        {upgradablePkgs.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-500 font-mono">
            All system packages are fully up-to-date.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500">
                  <th className="pb-2">Package Name</th>
                  <th className="pb-2">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {upgradablePkgs.map((pkg, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2 text-emerald-400 font-semibold">{pkg.pkg}</td>
                    <td className="py-2 text-slate-400 truncate max-w-xl">{pkg.raw}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
