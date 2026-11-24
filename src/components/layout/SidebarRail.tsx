import React from 'react';
import {
  Activity,
  Terminal,
  GitBranch,
  BarChart3,
  Network,
  Server,
  ShieldCheck,
  ShieldAlert,
  Shield,
  MessageSquare,
  HardDrive,
  FlaskConical,
  Settings as SettingsIcon,
  Waypoints,
  Bot,
  PanelLeftClose,
  PanelLeftOpen,
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
  hardeningPassingCount?: number;
  hardeningTotalCount?: number;
  topologyAlertCount?: number;
  topologyAlertSeverity?: 'error' | 'warning' | null;
  smokeFailureCount?: number;
  unreadOptInsCount?: number;
  threatAlertCount?: number;
  threatAlertSeverity?: 'error' | 'warning' | null;
  sslAlertCount?: number;
  sslAlertSeverity?: 'error' | 'warning' | null;
  sslMinDays?: number | null;
  devRunningCount?: number;
  totalAppCount?: number;
  totalAttentionCount?: number;
  totalAttentionSeverity?: 'error' | 'warning' | null;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  showAgentNav?: boolean;
  isInitialSyncComplete?: boolean;
}

interface SidebarNavEntry {
  id: NavItem;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number | string;
  severity?: 'error' | 'warning' | 'success' | 'info';
}

interface SidebarGroup {
  id: string;
  title: string;
  items: SidebarNavEntry[];
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
  hardeningPassingCount,
  hardeningTotalCount = 9,
  topologyAlertCount,
  topologyAlertSeverity,
  smokeFailureCount = 0,
  unreadOptInsCount = 0,
  threatAlertCount = 0,
  threatAlertSeverity = null,
  sslAlertCount = 0,
  sslAlertSeverity = null,
  sslMinDays = null,
  devRunningCount = 0,
  totalAppCount = 0,
  totalAttentionCount,
  totalAttentionSeverity,
  isCollapsed = false,
  onToggleCollapse,
  showAgentNav = false,
  isInitialSyncComplete = true,
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

  const effectiveHudBadge =
    totalAttentionCount !== undefined
      ? totalAttentionCount
      : unhealthyCount > 0
      ? unhealthyCount
      : securityViolationCount;
  const effectiveHudSeverity: 'error' | 'warning' =
    totalAttentionSeverity ||
    (unhealthyCount > 0 || securityViolationCount > 0 ? 'error' : 'warning');

  const hardeningBadge: SidebarNavEntry['badge'] =
    securityViolationCount > 0
      ? securityViolationCount
      : hardeningPassingCount !== undefined && hardeningTotalCount > 0
      ? `${hardeningPassingCount}/${hardeningTotalCount}`
      : undefined;
  const hardeningSeverity: SidebarNavEntry['severity'] =
    securityViolationCount > 0 ? 'error' : 'success';

  const sslBadge: SidebarNavEntry['badge'] =
    sslAlertCount > 0
      ? sslAlertCount
      : sslMinDays !== null && Number.isFinite(sslMinDays)
      ? `${sslMinDays}d`
      : undefined;
  const sslSeverity: SidebarNavEntry['severity'] =
    sslAlertCount > 0 ? sslAlertSeverity || 'warning' : 'success';

  const missionItems: SidebarNavEntry[] = [
    {
      id: 'hud',
      label: 'Command HUD',
      icon: Activity,
      badge: effectiveHudBadge > 0 ? effectiveHudBadge : undefined,
      severity: effectiveHudSeverity,
    },
  ];
  if (showAgentNav) {
    missionItems.push({
      id: 'agent',
      label: 'AI Agent SRE',
      icon: Bot,
    });
  }

  const navGroups: SidebarGroup[] = [
    {
      id: 'mission',
      title: 'MISSION CONTROL',
      items: missionItems,
    },
    {
      id: 'delivery',
      title: 'DELIVERY & VERIFICATION',
      items: [
        {
          id: 'releases',
          label: 'Releases & Drift',
          icon: GitBranch,
          badge: behindReleasesCount > 0 ? behindReleasesCount : undefined,
          severity: unhealthyCount > 0 ? 'error' : 'warning',
        },
        {
          id: 'telemetry',
          label: 'Build Telemetry',
          icon: BarChart3,
          badge: telemetryWarningCount > 0 ? telemetryWarningCount : undefined,
          severity: 'warning',
        },
        {
          id: 'smoke',
          label: 'Smoke Tests',
          icon: FlaskConical,
          badge: smokeFailureCount > 0 ? smokeFailureCount : undefined,
          severity: 'error',
        },
      ],
    },
    {
      id: 'security',
      title: 'SECURITY & GOVERNANCE',
      items: [
        {
          id: 'security',
          label: 'Threat & Zero Trust',
          icon: ShieldAlert,
          badge: threatAlertCount > 0 ? threatAlertCount : undefined,
          severity: threatAlertSeverity || 'warning',
        },
        {
          id: 'hardening',
          label: 'WSH Hardening',
          icon: Shield,
          badge: hardeningBadge,
          severity: hardeningSeverity,
        },
        {
          id: 'edge',
          label: 'PKI & Certificates',
          icon: ShieldCheck,
          badge: sslBadge,
          severity: sslSeverity,
        },
        {
          id: 'opt-ins',
          label: 'SMS Opt-Ins (10DLC)',
          icon: MessageSquare,
          badge: unreadOptInsCount > 0 ? unreadOptInsCount : undefined,
          severity: 'warning',
        },
      ],
    },
    {
      id: 'infra',
      title: 'INFRASTRUCTURE & NETWORK',
      items: [
        {
          id: 'topology',
          label: 'Topology & Ingress',
          icon: Network,
          badge: effectiveTopologyBadge > 0 ? effectiveTopologyBadge : undefined,
          severity: effectiveTopologySeverity || 'warning',
        },
        {
          id: 'unifi-zbf',
          label: 'UniFi Network & ZBF',
          icon: Waypoints,
        },
        {
          id: 'dietpi',
          label: 'DietPi Host & Crons',
          icon: Server,
          badge: effectiveDietPiBadge > 0 ? effectiveDietPiBadge : undefined,
          severity: effectiveDietPiSeverity || 'warning',
        },
        {
          id: 'backups',
          label: 'Backups & DR',
          icon: HardDrive,
          badge: backupFailureCount > 0 ? backupFailureCount : undefined,
          severity: 'error',
        },
      ],
    },
    {
      id: 'workspace',
      title: 'WORKSPACE & SYSTEM',
      items: [
        {
          id: 'local-dev',
          label: 'Local Dev',
          icon: Terminal,
          badge: totalAppCount > 0 ? `${devRunningCount}/${totalAppCount}` : undefined,
          severity: devRunningCount > 0 ? 'info' : 'info',
        },
        {
          id: 'settings',
          label: 'Settings & Logs',
          icon: SettingsIcon,
        },
      ],
    },
  ];

  const badgePillClass = (severity: SidebarNavEntry['severity']) => {
    switch (severity) {
      case 'error':
        return 'bg-rose-700 dark:bg-rose-600 text-white shadow-[0_0_8px_rgba(244,63,94,0.45)] animate-pulse';
      case 'warning':
        return 'bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/40 font-bold';
      case 'success':
        return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/35 font-semibold';
      case 'info':
      default:
        return 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/35 font-semibold';
    }
  };

  const collapsedDotClass = (severity: SidebarNavEntry['severity']) => {
    switch (severity) {
      case 'error':
        return 'bg-rose-500 animate-pulse';
      case 'warning':
        return 'bg-amber-400 animate-pulse';
      case 'success':
        return 'bg-emerald-500';
      case 'info':
      default:
        return 'bg-cyan-400';
    }
  };

  return (
    <aside
      className={`${
        isCollapsed ? 'w-16' : 'w-16 md:w-64'
      } bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 flex flex-col min-h-0 overflow-hidden select-none shrink-0 transition-all duration-150`}
    >
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* App Title / Header (h-14 matches TopLiveSyncBar) */}
        <div
          className={`h-14 flex items-center border-b border-slate-200 dark:border-slate-800 shrink-0 ${
            isCollapsed ? 'justify-center px-2' : 'justify-between px-2.5 md:px-3.5 gap-2'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative shrink-0">
              {isCollapsed && onToggleCollapse ? (
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  title="Expand Sidebar Rail"
                  aria-label="Expand Sidebar Rail from Logo"
                  className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-amber-500/40 dark:border-amber-400/40 hover:border-[var(--color-brand)] flex items-center justify-center shadow-sm overflow-hidden cursor-pointer transition-colors"
                >
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
                </button>
              ) : (
                <div className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-amber-500/40 dark:border-amber-400/40 flex items-center justify-center shadow-sm overflow-hidden">
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
              )}
              <span
                className={`w-2.5 h-2.5 rounded-full absolute -top-0.5 -right-0.5 ring-2 ring-white dark:ring-slate-950 pointer-events-none ${
                  !isInitialSyncComplete
                    ? 'bg-slate-400 dark:bg-slate-500 animate-pulse'
                    : unhealthyCount > 0
                    ? 'bg-rose-500 animate-ping'
                    : 'bg-emerald-500 dark:bg-emerald-400 animate-pulse'
                }`}
                aria-hidden="true"
              />
            </div>

            {!isCollapsed && (
              <div className="hidden md:block min-w-0">
                <div className="text-sm font-bold tracking-tight bg-gradient-to-r from-orange-500 to-amber-500 dark:from-amber-300 dark:to-orange-400 bg-clip-text text-transparent truncate">
                  PanoramaSRE
                </div>
                <p className="text-[10px] text-slate-600 dark:text-slate-400 font-mono tabular-nums truncate">
                  v{APP_VERSION_INFO.version} {APP_VERSION_INFO.buildDate ? `(${APP_VERSION_INFO.buildDate})` : ''}
                </p>
              </div>
            )}
          </div>

          {!isCollapsed && onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="hidden md:flex w-7 h-7 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:border-[var(--color-brand)] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors shrink-0 cursor-pointer"
              title="Collapse Sidebar to Icons"
              aria-label="Collapse Sidebar to Icons"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Dedicated centered expand strip when collapsed inside w-16 rail */}
        {isCollapsed && onToggleCollapse && (
          <div className="px-2 py-1.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-center shrink-0">
            <button
              type="button"
              onClick={onToggleCollapse}
              className="w-10 h-7 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:border-[var(--color-brand)] text-slate-600 dark:text-slate-300 hover:text-[var(--color-brand-text)] transition-colors cursor-pointer"
              title="Expand Sidebar Rail"
              aria-label="Expand Sidebar Rail"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 5-Group Navigation */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-3 custom-scrollbar">
          {navGroups.map((group, groupIndex) => (
            <div
              key={group.id}
              className={
                groupIndex > 0 && isCollapsed
                  ? 'pt-2 border-t border-slate-200 dark:border-slate-800 space-y-0.5'
                  : 'space-y-0.5'
              }
            >
              {!isCollapsed && (
                <div className="hidden md:block px-2.5 pt-1 pb-0.5 text-[10px] font-mono font-bold tracking-wider uppercase text-slate-500 dark:text-slate-500 truncate">
                  {group.title}
                </div>
              )}

              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                const isAlertTab = isInitialSyncComplete && item.id === 'hud' && unhealthyCount > 0;
                const hasBadge =
                  item.badge !== undefined &&
                  (typeof item.badge === 'string' || item.badge > 0) &&
                  (isInitialSyncComplete || item.id === 'local-dev');

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectTab(item.id)}
                    className={`w-full flex items-center ${
                      isCollapsed ? 'justify-center px-2' : 'px-2.5'
                    } py-2 min-h-[40px] rounded-xl text-xs sm:text-[13px] font-medium transition-colors group relative cursor-pointer ${
                      isActive
                        ? isAlertTab
                          ? 'bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-500/40 font-semibold'
                          : 'bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)] border border-[var(--color-brand-ring)] font-semibold shadow-xs'
                        : isAlertTab
                        ? 'text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-rose-500/30'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900 border border-transparent'
                    }`}
                    title={`${group.title}: ${item.label}${hasBadge ? ` (${item.badge})` : ''}`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 transition-colors ${
                        isAlertTab
                          ? 'text-rose-600 dark:text-rose-400 animate-pulse'
                          : isActive
                          ? 'text-[var(--color-brand-text)]'
                          : 'text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200'
                      }`}
                    />
                    {!isCollapsed && (
                      <span className="ml-2.5 hidden md:inline whitespace-nowrap truncate">
                        {item.label}
                      </span>
                    )}

                    {hasBadge && (
                      <>
                        <span
                          className={`${
                            isCollapsed ? 'block' : 'md:hidden'
                          } absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${collapsedDotClass(
                            item.severity
                          )}`}
                        />
                        {!isCollapsed && (
                          <span
                            className={`hidden md:inline-flex items-center justify-center ml-auto px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums shrink-0 ${badgePillClass(
                              item.severity
                            )}`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
};
