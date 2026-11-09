import React from 'react';
import { 
  Activity, 
  Terminal, 
  GitBranch, 
  Network, 
  Server, 
  ShieldCheck, 
  HardDrive, 
  Settings as SettingsIcon,
  CircleDot
} from 'lucide-react';
import { APP_VERSION_INFO } from '../../lib/version';

export type NavItem = 
  | 'hud'
  | 'local-dev'
  | 'releases'
  | 'topology'
  | 'dietpi'
  | 'edge'
  | 'backups'
  | 'settings';

interface SidebarRailProps {
  activeTab: NavItem;
  onSelectTab: (tab: NavItem) => void;
  unhealthyCount: number;
  backupFailureCount?: number;
  behindReleasesCount?: number;
  dietpiPackagesCount?: number;
  securityViolationCount?: number;
}

export const SidebarRail: React.FC<SidebarRailProps> = ({
  activeTab,
  onSelectTab,
  unhealthyCount,
  backupFailureCount = 0,
  behindReleasesCount = 0,
  dietpiPackagesCount = 0,
  securityViolationCount = 0,
}) => {
  const navItems: { id: NavItem; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number; badgeColor?: string }[] = [
    {
      id: 'hud',
      label: 'Command HUD',
      icon: Activity,
      badge: unhealthyCount > 0 ? unhealthyCount : securityViolationCount > 0 ? securityViolationCount : undefined,
      badgeColor: 'bg-rose-500',
    },
    { id: 'local-dev', label: 'Local Dev Supervisor', icon: Terminal },
    { id: 'releases', label: 'Releases & Drift', icon: GitBranch, badge: behindReleasesCount, badgeColor: 'bg-amber-500' },
    {
      id: 'topology',
      label: 'Topology & Stacks',
      icon: Network,
      badge: securityViolationCount > 0 ? securityViolationCount : undefined,
      badgeColor: 'bg-rose-500 animate-pulse',
    },
    { id: 'dietpi', label: 'DietPi Host', icon: Server, badge: dietpiPackagesCount, badgeColor: 'bg-amber-500' },
    { id: 'edge', label: 'PKI & Certificates', icon: ShieldCheck },
    { id: 'backups', label: 'Database Backups & DR', icon: HardDrive, badge: backupFailureCount, badgeColor: 'bg-rose-500' },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <aside className="w-16 md:w-64 bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between select-none shrink-0">
      <div>
        {/* App Title / Header */}
        <div className="h-14 flex items-center px-4 border-b border-slate-200 dark:border-slate-800 space-x-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
            unhealthyCount > 0
              ? 'bg-rose-500/10 border-rose-500/40'
              : 'bg-emerald-500/10 border-emerald-500/30'
          }`}>
            <CircleDot className={`w-4 h-4 ${unhealthyCount > 0 ? 'text-rose-400 animate-ping' : 'text-emerald-500 dark:text-emerald-400 animate-pulse'}`} />
          </div>
          <div className="hidden md:block">
            <h1 className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">PanoramaSRE</h1>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
              Control Plane v{APP_VERSION_INFO.version} {APP_VERSION_INFO.buildDate ? `(${APP_VERSION_INFO.buildDate})` : ''}
            </p>
          </div>
        </div>

        {/* Navigation links */}
        <nav className="p-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const isAlertTab = item.id === 'hud' && unhealthyCount > 0;

            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group relative ${
                  isActive
                    ? isAlertTab
                      ? 'bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-500/40 ring-1 ring-rose-500/40 font-semibold'
                      : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border border-emerald-500/30 dark:border-emerald-500/20 font-semibold shadow-sm'
                    : isAlertTab
                    ? 'text-rose-700 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-rose-500/30'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900 border border-transparent'
                }`}
                title={item.label}
              >
                <Icon className={`w-5 h-5 shrink-0 transition-colors ${
                  isAlertTab ? 'text-rose-600 dark:text-rose-400 animate-pulse' : isActive ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200'
                }`} />
                <span className="ml-3 hidden md:inline whitespace-nowrap">{item.label}</span>

                {item.badge !== undefined && item.badge > 0 && (
                  <>
                    <span className={`md:hidden absolute top-2 right-2 w-2 h-2 rounded-full ${
                      item.id === 'hud' || item.id === 'backups' ? 'bg-rose-500 animate-pulse' : 'bg-amber-400'
                    }`} />
                    <span className={`hidden md:inline-flex items-center justify-center ml-auto px-2 py-0.5 rounded-full text-[11px] font-mono font-bold shrink-0 ${
                      item.id === 'hud' || item.id === 'backups'
                        ? 'bg-rose-500 text-white shadow-[0_0_8px_rgba(244,63,94,0.6)] animate-pulse'
                        : item.id === 'releases'
                        ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 shadow-[0_0_6px_rgba(245,158,11,0.25)] font-bold'
                        : item.id === 'dietpi'
                        ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40'
                        : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40'
                    }`}>
                      {item.badge}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
};
