import { NetworkPosture, McpBridgeStatus } from '../../lib/types';
import { AlertCircle, Sun, Moon, ShieldAlert, ShieldCheck, Bot, RefreshCw } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface TopLiveSyncBarProps {
  networkPosture: NetworkPosture;
  devRunningCount: number;
  totalAppCount: number;
  prodHealthyCount: number;
  lastSyncTime: string | null;
  lastSecurityAuditTime?: string | null;
  securityAuditInterval?: string;
  isSyncing: boolean;
  onRefresh: () => void;
  backupFailureCount?: number;
  onNavigateToBackups?: () => void;
  securityViolationCount?: number;
  onNavigateToTopology?: () => void;
  mcpStatus?: McpBridgeStatus | null;
  onNavigateToDev?: () => void;
}

export function TopLiveSyncBar({
  networkPosture,
  devRunningCount,
  totalAppCount,
  prodHealthyCount,
  lastSyncTime,
  lastSecurityAuditTime,
  securityAuditInterval = '5',
  isSyncing,
  onRefresh,
  backupFailureCount = 0,
  onNavigateToBackups,
  securityViolationCount = 0,
  onNavigateToTopology,
  mcpStatus,
  onNavigateToDev,
}: TopLiveSyncBarProps) {
  const { theme, resolvedTheme, toggleTheme } = useTheme();
  const hasFleetAlert = totalAppCount > 0 && prodHealthyCount < totalAppCount;

  return (
    <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/50 backdrop-blur-md px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 sm:gap-3 lg:gap-4 z-10 select-none overflow-hidden">
      {/* Left: Network Posture Indicator, Fleet Counters & Incident Pills */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 lg:gap-3 shrink-0 min-w-0">
        {/* Network Posture Pill */}
        <div className="flex items-center shrink-0">
          {networkPosture === 'LAN_DIRECT' && (
            <span
              className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border border-emerald-500/30 whitespace-nowrap shrink-0"
              title="Network Posture: LAN DIRECT (Host 172.25.25.5 on WSH private subnet)"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-emerald-400 animate-pulse shrink-0" />
              <span>LAN</span>
              <span className="hidden sm:inline"> DIRECT</span>
              <span className="hidden 2xl:inline"> (172.25.25.5)</span>
            </span>
          )}
          {networkPosture === 'WAN_CLOUDFLARE' && (
            <span
              className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/15 text-amber-900 dark:text-amber-400 border border-amber-500/30 whitespace-nowrap shrink-0"
              title="Network Posture: WAN (Proxied via Cloudflare Zero Trust Tunnel)"
            >
              <span className="w-2 h-2 rounded-full bg-amber-600 dark:bg-amber-400 shrink-0" />
              <span>WAN</span>
              <span className="hidden sm:inline"> (Cloudflare)</span>
            </span>
          )}
          {networkPosture === 'OFFLINE' && (
            <span
              className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-500/15 text-rose-800 dark:text-rose-400 border border-rose-500/30 whitespace-nowrap shrink-0"
              title="Network Posture: Host is unreachable or offline"
            >
              <span className="w-2 h-2 rounded-full bg-rose-600 dark:bg-rose-400 shrink-0" />
              <span className="hidden sm:inline">HOST </span>
              <span>OFFLINE</span>
            </span>
          )}
        </div>

        {/* Dev Servers Compact Counter */}
        <div
          className="flex items-center gap-1 sm:gap-1.5 text-xs text-slate-600 dark:text-slate-400 border-l border-slate-200 dark:border-slate-800 pl-2 sm:pl-2.5 lg:pl-3 shrink-0 whitespace-nowrap"
          title={`Dev Servers: ${devRunningCount} of ${totalAppCount} currently active`}
        >
          <span>Dev:</span>
          <span
            className={`font-mono font-medium ${
              devRunningCount === totalAppCount
                ? 'text-emerald-700 dark:text-emerald-400'
                : devRunningCount > 0
                ? 'text-amber-800 dark:text-amber-300'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {devRunningCount}/{totalAppCount}
            <span className="hidden 2xl:inline"> running</span>
          </span>
        </div>

        {/* Production Fleet Health Counter / Alert */}
        <div
          className="flex items-center gap-1 sm:gap-1.5 text-xs text-slate-600 dark:text-slate-400 border-l border-slate-200 dark:border-slate-800 pl-2 sm:pl-2.5 lg:pl-3 shrink-0 whitespace-nowrap"
          title={`Production Fleet: ${prodHealthyCount} of ${totalAppCount} containers healthy`}
        >
          <span className="hidden sm:inline">Prod:</span>
          {hasFleetAlert ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.3)] animate-pulse font-semibold shrink-0">
              <AlertCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
              <span className="hidden md:inline">CRITICAL: </span>
              <span>{totalAppCount - prodHealthyCount} DOWN</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400 shrink-0" />
              <span className="font-mono font-medium text-emerald-700 dark:text-emerald-400">
                {prodHealthyCount}/{totalAppCount}
                <span className="hidden 2xl:inline"> healthy</span>
              </span>
            </span>
          )}
        </div>

        {/* Agent MCP Bridge Status Pill */}
        {mcpStatus && (
          <button
            onClick={onNavigateToDev}
            className={`inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              mcpStatus.isOnline
                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-800 dark:text-emerald-400 border-emerald-500/30'
                : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-800 dark:text-rose-400 border-rose-500/30'
            }`}
            title={`Zero-Trust Named Pipe MCP Bridge (${mcpStatus.pipeName || 'Active'})${mcpStatus.pid ? ` • PID ${mcpStatus.pid}` : ''}. Click to view Local Dev Supervisor.`}
          >
            <Bot className="w-3.5 h-3.5 shrink-0" />
            <span>
              MCP<span className="hidden md:inline">: {mcpStatus.isOnline ? 'Online' : 'Offline'}</span>
            </span>
            {mcpStatus.pid && (
              <span className="hidden 2xl:inline font-mono text-[10px] text-slate-500 dark:text-slate-400">
                PID {mcpStatus.pid}
              </span>
            )}
          </button>
        )}

        {/* Database Automated Backup Failure Red Flag Banner */}
        {backupFailureCount > 0 && (
          <button
            onClick={onNavigateToBackups}
            className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-0.5 rounded-full bg-rose-500/20 hover:bg-rose-500/30 text-rose-700 dark:text-rose-300 border border-rose-500/60 shadow-[0_0_12px_rgba(244,63,94,0.4)] animate-pulse font-semibold text-xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title={`Automated daily database backup failed for ${backupFailureCount} app(s)! Click to inspect.`}
          >
            <AlertCircle className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400 shrink-0" />
            <span className="hidden xl:inline">BACKUP INCIDENT: </span>
            <span className="hidden sm:inline xl:hidden">BACKUP: </span>
            <span>{backupFailureCount} FAILED</span>
          </button>
        )}

        {/* WSH Network & Container Hardening Security Violation Red Flag */}
        {securityViolationCount > 0 && (
          <button
            onClick={onNavigateToTopology}
            className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-0.5 rounded-full bg-rose-500/20 hover:bg-rose-500/30 text-rose-700 dark:text-rose-300 border border-rose-500/60 shadow-[0_0_12px_rgba(244,63,94,0.4)] animate-pulse font-semibold text-xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title={`WSH Network or Container Security Invariant Violation Detected (${securityViolationCount} checks failed)! Click to inspect topology.`}
          >
            <ShieldAlert className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400 shrink-0" />
            <span className="hidden xl:inline">SECURITY VIOLATION: </span>
            <span className="hidden sm:inline xl:hidden">SECURITY: </span>
            <span>{securityViolationCount} FAILED</span>
          </button>
        )}
      </div>

      {/* Right: Sync Status & Manual Refresh & Theme Toggle */}
      <div className="flex items-center gap-2 sm:gap-2.5 lg:gap-3 shrink-0">
        {lastSyncTime && (
          <span
            className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0"
            title={`Last telemetry sync: ${lastSyncTime}`}
          >
            <span className="hidden xl:inline">Last sync: </span>
            <span className="hidden sm:inline xl:hidden text-slate-400">Sync: </span>
            <span className="font-mono text-slate-700 dark:text-slate-300">{lastSyncTime}</span>
          </span>
        )}

        {lastSecurityAuditTime && (
          <button
            onClick={onNavigateToTopology}
            className="inline-flex items-center gap-1 sm:gap-1.5 text-xs text-slate-500 dark:text-slate-400 border-l border-slate-200 dark:border-slate-800 pl-2 sm:pl-2.5 lg:pl-3 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer select-none whitespace-nowrap shrink-0"
            title={`WSH Network Hardening & Penetration Audit Last Checked at ${lastSecurityAuditTime} (every ${securityAuditInterval}m). Click to inspect topology & rules advisor.`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="hidden lg:inline font-medium text-slate-600 dark:text-slate-400">Audit:</span>
            <span className="font-mono text-slate-700 dark:text-slate-300">{lastSecurityAuditTime}</span>
            <span className="hidden 2xl:inline text-[10px] font-mono text-slate-400">({securityAuditInterval}m)</span>
          </button>
        )}

        {/* Quick Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors shrink-0"
          title={`Active theme: ${theme} (resolved: ${resolvedTheme}). Click to toggle.`}
          aria-label="Toggle color theme"
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <Moon className="w-4 h-4 text-slate-700 shrink-0" />
          )}
        </button>

        {/* Sync Now Button */}
        <button
          onClick={onRefresh}
          disabled={isSyncing}
          className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            isSyncing ? 'opacity-50 cursor-not-allowed' : ''
          }`}
          title="Sync telemetry from WSH host and local dev servers now"
        >
          <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isSyncing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
          <span className="inline sm:hidden">{isSyncing ? '...' : 'Sync'}</span>
        </button>
      </div>
    </header>
  );
}
