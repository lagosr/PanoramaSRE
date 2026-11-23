import { WshSnapshot, TerminalTab, DiscoveredApp, FleetCronAuditSummary } from '../../lib/types';
import { RefreshCw, Server, Terminal, ShieldAlert, Cpu, Clock } from 'lucide-react';
import { SegmentedControl } from '@lagosr/panorama-ui-kit';
import { buildRemoteSshCommand } from '../../lib/script-adapters';
import { auditFleetCrons, computeDietPiBadges, type DietPiTabBadge } from '../../lib/cron-auditor';
import { WorkStreamContainer } from '../ui/WorkStreamContainer';
import { CronManagerPanel, type CronActionRequest } from './CronManagerPanel';

interface DietPiHostViewProps {
  snapshot: WshSnapshot | null;
  apps?: DiscoveredApp[];
  cronSummary?: FleetCronAuditSummary;
  subTab?: 'host' | 'crons';
  onSelectSubTab?: (tab: 'host' | 'crons') => void;
  isLoading: boolean;
  isCronActionBusy?: boolean;
  terminalTabs?: TerminalTab[];
  onRefresh: () => void;
  onTriggerAction: (actionLabel: string, cmd: string, args: string[]) => void;
  onTriggerCronAction?: (req: CronActionRequest) => void;
  onTriggerReboot: () => void;
  onOpenInBottomConsole?: (tabId?: string) => void;
  onAbortJob?: (id: string) => void;
  onClearTab?: (id: string) => void;
  isRebooting?: boolean;
}

export function DietPiHostView({
  snapshot,
  apps = [],
  cronSummary,
  subTab = 'host',
  onSelectSubTab,
  isLoading,
  isCronActionBusy = false,
  terminalTabs = [],
  onRefresh,
  onTriggerAction,
  onTriggerCronAction,
  onTriggerReboot,
  onOpenInBottomConsole,
  onAbortJob,
  onClearTab,
  isRebooting = false,
}: DietPiHostViewProps) {
  const effectiveCronSummary = cronSummary ?? auditFleetCrons(apps, snapshot);
  const dietpiBadges = computeDietPiBadges(snapshot, effectiveCronSummary);

  const renderTabBadge = (badge: DietPiTabBadge) => {
    if (badge.count <= 0) return undefined;
    return (
      <span
        className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold tabular-nums leading-none whitespace-nowrap flex-shrink-0 ${
          badge.severity === 'error'
            ? 'bg-rose-600 text-white shadow-[0_0_6px_rgba(244,63,94,0.45)] animate-pulse'
            : 'bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/40'
        }`}
      >
        {badge.count}
      </span>
    );
  };
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
    <div className="p-8 w-full min-w-0 max-w-[1920px] mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Server className="w-5 h-5 text-[var(--color-brand-text)]" />
            DietPi Web Services Host (WSH)
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Raspberry Pi 5 OS health, APT packages, system services, and maintenance actions
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onTriggerReboot}
            disabled={isRebooting}
            className="btn-danger text-xs py-1.5 px-3"
            title="Initiate graceful reboot of DietPi WSH and verify recovery"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRebooting ? 'animate-spin' : ''}`} />
            {isRebooting ? 'Rebooting...' : 'Reboot Host'}
          </button>

          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="btn-secondary text-xs py-1.5 px-3"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh Snapshot
          </button>
        </div>
      </div>

      {/* Reboot Banner if needed */}
      {(snapshot?.reboot_required || isRebooting) && (
        <div className="rounded-2xl border border-rose-300 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0 animate-pulse" />
            <div>
              <p className="text-sm font-semibold text-rose-900 dark:text-rose-200">
                {isRebooting ? 'Reboot In Progress' : 'Reboot Required'}
              </p>
              <p className="text-xs text-rose-800 dark:text-rose-300/80">
                {isRebooting
                  ? 'Host is restarting and verifying recovery of SSH, Lighttpd, Docker, and apps...'
                  : 'Kernel or system libraries have been upgraded (/var/run/reboot-required)'}
              </p>
            </div>
          </div>
          <button
            onClick={onTriggerReboot}
            disabled={isRebooting}
            className="btn-danger text-xs py-1.5 px-3"
          >
            {isRebooting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Verifying Reboot...
              </>
            ) : (
              'Reboot WSH Now'
            )}
          </button>
        </div>
      )}

      {/* Host Metrics & Hardware */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-400">DietPi Version</p>
          <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1 font-mono">
            {snapshot?.dietpi_version || 'Loading...'}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 font-mono">Linux {snapshot?.kernel || 'kernel'}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Host Uptime</p>
          <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1 font-mono">
            {snapshot ? formatUptime(snapshot.uptime_secs) : 'Loading...'}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">Host: {snapshot?.hostname || 'wsh'}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-400">RPi 5 Thermal State</p>
          <div className="flex items-center gap-2 mt-1">
            <Cpu className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
            <span className="text-lg font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
              {snapshot?.rpi_throttled === '0x0' ? 'Normal (0x0)' : snapshot?.rpi_throttled || 'OK'}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">vcgencmd get_throttled</p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-400">System Services</p>
          <div className="mt-1 space-y-1 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Lighttpd:</span>
              <span className={snapshot?.services.lighttpd === 'active' ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-slate-600 dark:text-slate-400'}>
                {snapshot?.services.lighttpd || 'Checking'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Docker:</span>
              <span className={snapshot?.services.docker === 'active' ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-slate-600 dark:text-slate-400'}>
                {snapshot?.services.docker || 'Checking'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Cron:</span>
              <span className={snapshot?.services.cron === 'active' ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-rose-700 dark:text-rose-400 font-semibold'}>
                {snapshot?.services.cron || 'Checking'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-view Switcher: Host & APT vs Scheduled Crons & Heartbeats */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<'host' | 'crons'>
          value={subTab}
          onChange={(val) => onSelectSubTab?.(val)}
          size="md"
          options={[
            {
              value: 'host',
              label: 'Host & APT Packages',
              icon: <Server className="w-3.5 h-3.5" />,
              badge: renderTabBadge(dietpiBadges.tabs.host),
            },
            {
              value: 'crons',
              label: 'Scheduled Crons & Heartbeats',
              icon: <Clock className="w-3.5 h-3.5" />,
              badge: renderTabBadge(dietpiBadges.tabs.crons),
            },
          ]}
        />
      </div>

      {subTab === 'crons' ? (
        <CronManagerPanel
          summary={effectiveCronSummary}
          hasSnapshot={snapshot !== null}
          isBusy={isCronActionBusy}
          onTriggerCronAction={(req) => onTriggerCronAction?.(req)}
        />
      ) : (
        /* Upgradable APT Packages */
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2 tabular-nums">
              <Terminal className="w-4 h-4 text-[var(--color-brand-text)]" />
              Upgradable Debian APT Packages ({upgradablePkgs.length})
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Cached from apt list --upgradable via stateless read-only snapshot
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const sshCmd = buildRemoteSshCommand(
                  'DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get dist-upgrade -y'
                );
                onTriggerAction('Upgrade APT Packages', sshCmd.command, sshCmd.args);
              }}
              className="btn-primary text-xs py-1.5 px-3"
            >
              Upgrade All Packages
            </button>
          </div>
        </div>

        {upgradablePkgs.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-600 dark:text-slate-400 font-mono">
            All system packages are fully up-to-date.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                  <th className="pb-2">Package Name</th>
                  <th className="pb-2">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {upgradablePkgs.map((pkg, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2 text-emerald-700 dark:text-emerald-400 font-semibold">{pkg.pkg}</td>
                    <td className="py-2 text-slate-600 dark:text-slate-400 truncate max-w-xl">{pkg.raw}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* Position 4: DietPi Host Maintenance & Reboot Recovery Stream */}
      <WorkStreamContainer
        pageScope="dietpi"
        tabs={terminalTabs}
        title="DietPi Host Reboot, APT Upgrade & Telemetry Stream"
        description="Streams 4-stage graceful reboots, SSH recovery polling, apt-get dist-upgrade runs, and manual snapshot refreshes."
        emptyHint="Click Refresh Snapshot, Upgrade All Packages, or Reboot Host above to stream host operations here."
        onOpenInBottomConsole={onOpenInBottomConsole}
        onAbortJob={onAbortJob}
        onClearTab={onClearTab}
      />
    </div>
  );
}
