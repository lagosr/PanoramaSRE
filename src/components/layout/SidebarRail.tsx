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
}

export const SidebarRail: React.FC<SidebarRailProps> = ({
  activeTab,
  onSelectTab,
  unhealthyCount,
}) => {
  const navItems: { id: NavItem; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number; badgeColor?: string }[] = [
    { id: 'hud', label: 'Command HUD', icon: Activity, badge: unhealthyCount, badgeColor: 'bg-red-500' },
    { id: 'local-dev', label: 'Local Dev Supervisor', icon: Terminal },
    { id: 'releases', label: 'Releases & Drift', icon: GitBranch },
    { id: 'topology', label: 'Topology & Stacks', icon: Network },
    { id: 'dietpi', label: 'DietPi Host', icon: Server },
    { id: 'edge', label: 'Edge & PKI', icon: ShieldCheck },
    { id: 'backups', label: 'Database Backups & DR', icon: HardDrive },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <aside className="w-16 md:w-64 bg-slate-950 border-r border-slate-800 flex flex-col justify-between select-none shrink-0">
      <div>
        {/* App Title / Header */}
        <div className="h-14 flex items-center px-4 border-b border-slate-800 space-x-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <CircleDot className="w-4 h-4 text-emerald-400 animate-pulse" />
          </div>
          <div className="hidden md:block">
            <h1 className="text-sm font-bold tracking-tight text-slate-100">PanoramaSRE</h1>
            <p className="text-[10px] text-slate-400 font-mono">
              Control Plane v1.0.0 {APP_VERSION_INFO.buildDate ? `(${APP_VERSION_INFO.buildDate})` : ''}
            </p>
          </div>
        </div>

        {/* Navigation links */}
        <nav className="p-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group relative ${
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
                title={item.label}
              >
                <Icon className={`w-5 h-5 shrink-0 transition-colors ${isActive ? 'text-emerald-400' : 'text-slate-400 group-hover:text-slate-200'}`} />
                <span className="ml-3 hidden md:inline whitespace-nowrap">{item.label}</span>

                {item.badge !== undefined && item.badge > 0 && (
                  <span className={`hidden md:inline-flex items-center justify-center ml-auto px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold shrink-0 ${
                    item.id === 'local-dev'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : item.id === 'hud'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : (item.badgeColor || 'bg-slate-700 text-white')
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
};
