import React from 'react';
import { 
  Activity, 
  Terminal, 
  GitBranch, 
  BarChart3,
  Network, 
  Server, 
  ShieldCheck, 
  MessageSquare,
  HardDrive, 
  FlaskConical,
  Settings as SettingsIcon
} from 'lucide-react';
import { APP_VERSION_INFO } from '../../lib/version';
import { NavSectionId } from '../../lib/types';

export type NavItem = NavSectionId;

interface SidebarRailProps {
  activeTab: NavItem;
  onSelectTab: (tab: NavItem) => void;
  unhealthyCount: number;
  backupFailureCount?: number;
  behindReleasesCount?: number;
  telemetryWarningCount?: number;
  dietpiPackagesCount?: number;
  dietpiAlertCount?: number;
  dietpiAlertSeverity?: 'error' | 'warning' | null;
  securityViolationCount?: number;
  topologyAlertCount?: number;
  topologyAlertSeverity?: 'error' | 'warning' | null;
  smokeFailureCount?: number;
  unreadOptInsCount?: number;
}

export const SidebarRail: React.FC<SidebarRailProps> = ({
  activeTab,
  onSelectTab,
  unhealthyCount,
  backupFailureCount = 0,
  behindReleasesCount = 0,
  telemetryWarningCount = 0,
  dietpiPackagesCount = 0,
  dietpiAlertCount,
  dietpiAlertSeverity,
  securityViolationCount = 0,
  topologyAlertCount,
  topologyAlertSeverity,
  smokeFailureCount = 0,
  unreadOptInsCount = 0,
}) => {
  const effectiveTopologyBadge =
    topologyAlertCount !== undefined ? topologyAlertCount : securityViolationCount;
  const effectiveTopologySeverity =
    topologyAlertSeverity !== undefined
      ? topologyAlertSeverity
      : securityViolationCount > 0
      ? 'error'
      : null;

  const effectiveDietPiBadge =
    dietpiAlertCount !== undefined ? dietpiAlertCount : dietpiPackagesCount;
  const effectiveDietPiSeverity =
    dietpiAlertSeverity !== undefined
      ? dietpiAlertSeverity
      : dietpiPackagesCount > 0
      ? 'warning'
      : null;

  const navItems: {
    id: NavItem;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
    severity?: 'error' | 'warning';
  }[] = [
    {
      id: 'hud',
      label: 'Command HUD',
      icon: Activity,
      badge: unhealthyCount > 0 ? unhealthyCount : securityViolationCount > 0 ? securityViolationCount : undefined,
      severity: 'error',
    },
    { id: 'local-dev', label: 'Local Dev Supervisor', icon: Terminal },
    { id: 'releases', label: 'Releases & Drift', icon: GitBranch, badge: behindReleasesCount, severity: 'warning' },
    {
      id: 'telemetry',
      label: 'Build Telemetry',
      icon: BarChart3,
      badge: telemetryWarningCount > 0 ? telemetryWarningCount : undefined,
      severity: 'warning',
    },
    {
      id: 'topology',
      label: 'Topology & Stacks',
      icon: Network,
      badge: effectiveTopologyBadge > 0 ? effectiveTopologyBadge : undefined,
      severity: effectiveTopologySeverity || 'warning',
    },
    {
      id: 'dietpi',
      label: 'DietPi Host',
      icon: Server,
      badge: effectiveDietPiBadge > 0 ? effectiveDietPiBadge : undefined,
      severity: effectiveDietPiSeverity || 'warning',
    },
    { id: 'edge', label: 'PKI & Certificates', icon: ShieldCheck },
    {
      id: 'opt-ins',
      label: 'SMS Opt-Ins',
      icon: MessageSquare,
      badge: unreadOptInsCount > 0 ? unreadOptInsCount : undefined,
      severity: 'warning',
    },
    { id: 'backups', label: 'Database Backups & DR', icon: HardDrive, badge: backupFailureCount, severity: 'error' },
    { id: 'smoke', label: 'Smoke Tests', icon: FlaskConical, badge: smokeFailureCount > 0 ? smokeFailureCount : undefined, severity: 'error' },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <aside className="w-16 md:w-64 bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 flex flex-col min-h-0 overflow-hidden select-none shrink-0">
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* App Title / Header */}
        <div className="h-16 flex items-center px-2.5 md:px-4 border-b border-slate-200 dark:border-slate-800 space-x-3 shrink-0">
          <div className="relative shrink-0">
            <div className="w-11 h-11 rounded-xl bg-white dark:bg-slate-900 border border-amber-500/40 dark:border-amber-400/40 flex items-center justify-center shadow-md shadow-amber-500/10 overflow-hidden">
              <img
                src="/logo-dark.png"
                alt="PanoramaSRE"
                className="w-full h-full object-cover hidden dark:block"
              />
              <img
                src="/logo-light.png"
                alt="PanoramaSRE"
                className="w-full h-full object-cover block dark:hidden"
              />
            </div>
            <span
              className={`w-2.5 h-2.5 rounded-full absolute -top-0.5 -right-0.5 ring-2 ring-white dark:ring-slate-950 ${
                unhealthyCount > 0
                  ? 'bg-rose-500 animate-ping'
                  : 'bg-emerald-500 dark:bg-emerald-400 animate-pulse'
              }`}
              aria-hidden="true"
            />
          </div>
          <div className="hidden md:block">
            <h1 className="text-sm font-bold tracking-tight bg-gradient-to-r from-orange-500 to-amber-500 dark:from-amber-300 dark:to-orange-400 bg-clip-text text-transparent">
              PanoramaSRE
            </h1>
            <p className="text-[10px] text-slate-600 dark:text-slate-400 font-mono tabular-nums">
              Control Plane v{APP_VERSION_INFO.version} {APP_VERSION_INFO.buildDate ? `(${APP_VERSION_INFO.buildDate})` : ''}
            </p>
          </div>
        </div>

        {/* Navigation links */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const isAlertTab = item.id === 'hud' && unhealthyCount > 0;

            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center px-3 py-2.5 min-h-[44px] rounded-xl text-sm font-medium transition-colors group relative cursor-pointer ${
                  isActive
                    ? isAlertTab
                      ? 'bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-500/40 ring-1 ring-rose-500/40 font-semibold'
                      : 'bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)] border border-[var(--color-brand-ring)] font-semibold shadow-sm'
                    : isAlertTab
                    ? 'text-rose-700 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-rose-500/30'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900 border border-transparent'
                }`}
                title={item.label}
              >
                <Icon className={`w-5 h-5 shrink-0 transition-colors ${
                  isAlertTab ? 'text-rose-600 dark:text-rose-400 animate-pulse' : isActive ? 'text-[var(--color-brand-text)]' : 'text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200'
                }`} />
                <span className="ml-3 hidden md:inline whitespace-nowrap">{item.label}</span>

                {item.badge !== undefined && item.badge > 0 && (
                  <>
                    <span
                      className={`md:hidden absolute top-2 right-2 w-2 h-2 rounded-full ${
                        item.severity === 'error'
                          ? 'bg-rose-500 animate-pulse'
                          : 'bg-amber-400 animate-pulse'
                      }`}
                    />
                    <span
                      className={`hidden md:inline-flex items-center justify-center ml-auto px-2 py-0.5 rounded-full text-[11px] font-mono font-bold tabular-nums shrink-0 ${
                        item.severity === 'error'
                          ? 'bg-rose-700 dark:bg-rose-600 text-white shadow-[0_0_8px_rgba(244,63,94,0.45)] animate-pulse'
                          : 'bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/40 shadow-[0_0_6px_rgba(245,158,11,0.25)] font-bold'
                      }`}
                    >
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
