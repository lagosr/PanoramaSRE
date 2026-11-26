import { useEffect, useRef, useState } from 'react';
import { NetworkPosture, McpBridgeStatus, OttoLifecycleSnapshot } from '../../lib/types';
import {
  AlertCircle,
  Sun,
  Moon,
  Bot,
  RefreshCw,
  Search,
  Bell,
  PauseCircle,
  PlayCircle,
  Square,
  Eye,
  MessageSquare,
  Sliders,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { OttoIcon } from '../agent/OttoAvatar';
import type { OttoSubView } from '../agent/OttoAgentView';

interface TopLiveSyncBarProps {
  networkPosture: NetworkPosture;
  devRunningCount: number;
  totalAppCount: number;
  evaluableAppCount?: number;
  prodHealthyCount: number;
  unhealthyCount?: number;
  lastSyncTime: string | null;
  lastSecurityAuditTime?: string | null;
  securityAuditInterval?: string;
  isSyncing: boolean;
  isInitialSyncComplete?: boolean;
  hasResolvedPosture?: boolean;
  onRefresh: () => void;
  backupFailureCount?: number;
  onNavigateToBackups?: () => void;
  securityViolationCount?: number;
  onNavigateToTopology?: () => void;
  mcpStatus?: McpBridgeStatus | null;
  onNavigateToDev?: () => void;
  totalAttentionCount?: number;
  totalAttentionSeverity?: 'error' | 'warning' | null;
  onOpenCommandPalette?: () => void;
  onOpenAlertsDrawer?: () => void;
  ottoLifecycle?: OttoLifecycleSnapshot | null;
  onOpenOtto?: (subView?: OttoSubView) => void;
  onInspectOttoTrace?: (traceRunId: string) => void;
  onToggleOttoKillSwitch?: (active: boolean) => void;
  onAbortOttoStep?: () => void;
}

export function TopLiveSyncBar({
  networkPosture,
  totalAppCount,
  evaluableAppCount,
  prodHealthyCount,
  unhealthyCount,
  lastSyncTime,
  isSyncing,
  isInitialSyncComplete = true,
  hasResolvedPosture = true,
  onRefresh,
  backupFailureCount = 0,
  securityViolationCount = 0,
  mcpStatus,
  onNavigateToDev,
  totalAttentionCount,
  totalAttentionSeverity,
  onOpenCommandPalette,
  onOpenAlertsDrawer,
  ottoLifecycle = null,
  onOpenOtto,
  onInspectOttoTrace,
  onToggleOttoKillSwitch,
  onAbortOttoStep,
}: TopLiveSyncBarProps) {
  const { theme, resolvedTheme, toggleTheme } = useTheme();
  const [ottoPopoverOpen, setOttoPopoverOpen] = useState(false);
  const [ottoElapsedSecs, setOttoElapsedSecs] = useState(0);
  const ottoPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ottoPopoverOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (ottoPopoverRef.current && !ottoPopoverRef.current.contains(e.target as Node)) {
        setOttoPopoverOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOttoPopoverOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [ottoPopoverOpen]);

  useEffect(() => {
    if (!ottoLifecycle?.startedAt) {
      setOttoElapsedSecs(0);
      return;
    }
    const startMs = Date.parse(ottoLifecycle.startedAt);
    if (!Number.isFinite(startMs)) return;
    const tick = () => setOttoElapsedSecs(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [ottoLifecycle?.startedAt]);

  const ottoState = ottoLifecycle?.state ?? 'IDLE';
  const ottoKillSwitch = Boolean(ottoLifecycle?.killSwitchActive);
  const ottoBusy =
    ottoState === 'SENSING' ||
    ottoState === 'STAGE0_EVAL' ||
    ottoState === 'THINKING' ||
    ottoState === 'STAGING' ||
    ottoState === 'ACTING' ||
    ottoState === 'VERIFYING';

  const ottoPillClass =
    ottoKillSwitch || ottoState === 'TRIPPED'
      ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-800 dark:text-rose-300 border-rose-500/45'
      : ottoBusy
      ? 'bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-900 dark:text-cyan-300 border-cyan-500/45'
      : ottoState === 'AWAITING_APPROVAL'
      ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-900 dark:text-amber-300 border-amber-500/45'
      : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700';
  const effectiveEvaluableCount = evaluableAppCount ?? totalAppCount;
  const effectiveUnhealthyCount =
    unhealthyCount !== undefined
      ? unhealthyCount
      : Math.max(0, effectiveEvaluableCount - prodHealthyCount);
  const hasFleetAlert =
    isInitialSyncComplete && effectiveEvaluableCount > 0 && effectiveUnhealthyCount > 0;

  const effectiveAlertCount =
    totalAttentionCount !== undefined
      ? totalAttentionCount
      : effectiveUnhealthyCount + backupFailureCount + securityViolationCount;
  const effectiveAlertSeverity =
    totalAttentionSeverity ??
    (effectiveUnhealthyCount > 0 || backupFailureCount > 0 || securityViolationCount > 0
      ? 'error'
      : null);

  return (
    <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 sm:px-4 md:pl-6 lg:px-6 flex items-center justify-between gap-3 z-10 select-none shrink-0">
      {/* Left: Network Posture, MCP Bridge, Prod Health */}
      <div className="flex items-center gap-2 shrink-0 min-w-0">
        {!hasResolvedPosture ? (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 whitespace-nowrap shrink-0"
            title="Detecting network posture..."
          >
            <RefreshCw className="w-3 h-3 animate-spin text-slate-500 dark:text-slate-400 shrink-0" />
            <span>Checking...</span>
          </span>
        ) : (
          <>
            {networkPosture === 'LAN_DIRECT' && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border border-emerald-500/30 whitespace-nowrap shrink-0"
                title="Network Posture: LAN DIRECT (Host 172.25.25.5 on WSH private subnet)"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400 animate-pulse shrink-0" />
                <span>LAN DIRECT</span>
                <span className="hidden sm:inline font-mono font-medium tabular-nums">
                  172.25.25.5
                </span>
              </span>
            )}
            {networkPosture === 'WAN_CLOUDFLARE' && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-500/15 text-amber-900 dark:text-amber-400 border border-amber-500/30 whitespace-nowrap shrink-0"
                title="Network Posture: WAN (Proxied via Cloudflare Zero Trust Tunnel)"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 shrink-0" />
                <span>WAN (Cloudflare)</span>
              </span>
            )}
            {networkPosture === 'OFFLINE' && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-500/15 text-rose-800 dark:text-rose-400 border border-rose-500/30 whitespace-nowrap shrink-0"
                title="Network Posture: Host is unreachable or offline"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-rose-600 dark:bg-rose-400 shrink-0" />
                <span>HOST OFFLINE</span>
              </span>
            )}
          </>
        )}

        {mcpStatus ? (
          <button
            type="button"
            onClick={onNavigateToDev}
            className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              mcpStatus.isOnline
                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-800 dark:text-emerald-400 border-emerald-500/30'
                : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-800 dark:text-rose-400 border-rose-500/30'
            }`}
            title={`Zero-Trust Named Pipe MCP Bridge (${mcpStatus.pipeName || 'Active'})${
              mcpStatus.pid ? ` • PID ${mcpStatus.pid}` : ''
            }. Click to view Local Dev.`}
          >
            <Bot className="w-3 h-3 shrink-0" />
            <span>MCP: {mcpStatus.isOnline ? 'Online' : 'Offline'}</span>
          </button>
        ) : (
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 shrink-0">
            <Bot className="w-3 h-3 text-slate-500 shrink-0" />
            <span>MCP: Standby</span>
          </span>
        )}

        <div
          className="hidden lg:flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] whitespace-nowrap shrink-0"
          title={`Production Fleet: ${prodHealthyCount} of ${effectiveEvaluableCount} containers healthy`}
        >
          <span className="text-slate-500 dark:text-slate-400">Prod:</span>
          {!isInitialSyncComplete ? (
            <span className="font-mono text-slate-600 dark:text-slate-400">Syncing...</span>
          ) : hasFleetAlert ? (
            <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-300 font-semibold tabular-nums">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span>{effectiveUnhealthyCount} DOWN</span>
            </span>
          ) : (
            <span className="font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
              {prodHealthyCount}/{effectiveEvaluableCount}
            </span>
          )}
        </div>
      </div>

      {/* Center: Global Ctrl+K Command Palette Trigger */}
      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="flex-1 max-w-md flex items-center justify-between gap-2 px-3 py-1.5 min-h-[36px] rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-[var(--color-brand)] text-xs text-slate-500 dark:text-slate-400 transition-colors cursor-pointer min-w-0"
        title="Open Quick Command Palette (Ctrl+K)"
      >
        <span className="flex items-center gap-2 truncate">
          <Search className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Search apps, invariants, VLANs, or SRE actions...</span>
        </span>
        <kbd className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-[10px] text-slate-600 dark:text-slate-300 shrink-0">
          Ctrl+K
        </kbd>
      </button>

      {/* Right: Live Otto State Pill, Unified Alerts Inbox, Sync Status, Theme, Sync Now */}
      <div className="flex items-center gap-2 shrink-0">
        {(ottoLifecycle || onOpenOtto) && (
          <div className="relative" ref={ottoPopoverRef}>
            <button
              type="button"
              data-testid="top-otto-state-pill"
              onClick={() => setOttoPopoverOpen((prev) => !prev)}
              className={`h-9 flex items-center gap-1.5 px-2.5 rounded-xl text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${ottoPillClass}`}
              title={ottoLifecycle?.summary || 'Inspect Otto AI SRE Live Status & Emergency Kill-Switch'}
              aria-expanded={ottoPopoverOpen}
            >
              <OttoIcon className="w-4 h-4" state={ottoState} thinking={ottoBusy} />
              <span className="max-w-[155px] truncate">
                {ottoLifecycle?.phaseLabel || 'Otto: Idle · Shadow'}
              </span>
              {ottoBusy && ottoElapsedSecs > 0 && (
                <span className="font-mono text-[10px] tabular-nums opacity-80">
                  {ottoElapsedSecs}s
                </span>
              )}
            </button>

            {ottoPopoverOpen && (
              <div
                data-testid="top-otto-popover"
                className="absolute right-0 mt-2 w-80 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-4 space-y-3 z-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <OttoIcon className="w-7 h-7" state={ottoState} thinking={ottoBusy} />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                        {ottoLifecycle?.phaseLabel || 'Otto: Idle · Shadow'}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                        {ottoLifecycle?.activeModel
                          ? `${ottoLifecycle.activeModel} (${ottoLifecycle.thinkingLevel || 'auto'})`
                          : `Breaker: ${ottoLifecycle?.circuitBreakerState || 'CLOSED'}`}
                      </div>
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300 leading-snug">
                  {ottoLifecycle?.summary || 'Standing watch in Shadow / Observe mode.'}
                </p>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  {onOpenOtto && (
                    <button
                      type="button"
                      onClick={() => {
                        setOttoPopoverOpen(false);
                        onOpenOtto('ask');
                      }}
                      className="btn-primary text-xs py-1.5 px-2.5 flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Ask Otto</span>
                    </button>
                  )}
                  {onOpenOtto && (
                    <button
                      type="button"
                      onClick={() => {
                        setOttoPopoverOpen(false);
                        onOpenOtto('policies');
                      }}
                      className="btn-secondary text-xs py-1.5 px-2.5 flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>Policies</span>
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                  {ottoLifecycle?.traceRunId && onInspectOttoTrace && (
                    <button
                      type="button"
                      onClick={() => {
                        setOttoPopoverOpen(false);
                        onInspectOttoTrace(ottoLifecycle.traceRunId!);
                      }}
                      className="btn-ghost text-xs py-1.5 px-2.5 flex items-center justify-center gap-1.5 w-full"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Open Latest Deep-Thinking Trace</span>
                    </button>
                  )}

                  {ottoLifecycle?.canAbort && onAbortOttoStep && (
                    <button
                      type="button"
                      onClick={() => {
                        setOttoPopoverOpen(false);
                        onAbortOttoStep();
                      }}
                      className="btn-secondary text-xs py-1.5 px-2.5 flex items-center justify-center gap-1.5 w-full"
                    >
                      <Square className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                      <span>Abort Active Step</span>
                    </button>
                  )}

                  {onToggleOttoKillSwitch && (
                    <button
                      type="button"
                      onClick={() => {
                        setOttoPopoverOpen(false);
                        onToggleOttoKillSwitch(!ottoKillSwitch);
                      }}
                      className={`${
                        ottoKillSwitch ? 'btn-primary' : 'btn-danger'
                      } text-xs py-1.5 px-2.5 flex items-center justify-center gap-1.5 w-full`}
                    >
                      {ottoKillSwitch ? (
                        <>
                          <PlayCircle className="w-3.5 h-3.5" />
                          <span>Resume Otto</span>
                        </>
                      ) : (
                        <>
                          <PauseCircle className="w-3.5 h-3.5" />
                          <span>Engage Emergency Kill-Switch</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {onOpenAlertsDrawer && (
          <button
            type="button"
            onClick={onOpenAlertsDrawer}
            className={`h-9 flex items-center gap-1.5 px-3 rounded-xl text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isInitialSyncComplete && effectiveAlertCount > 0
                ? effectiveAlertSeverity === 'error'
                  ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-800 dark:text-rose-300 border-rose-500/40'
                  : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 border-amber-500/40'
                : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
            }`}
            title="Open Unified Alerts & Attention Queue"
          >
            <Bell className="w-3.5 h-3.5 shrink-0" />
            <span>Alerts</span>
            {isInitialSyncComplete && effectiveAlertCount > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full font-mono text-[10px] font-bold tabular-nums ${
                  effectiveAlertSeverity === 'error'
                    ? 'bg-rose-600 text-white'
                    : 'bg-amber-500 text-slate-950'
                }`}
              >
                {effectiveAlertCount}
              </span>
            )}
          </button>
        )}

        {lastSyncTime && (
          <span
            className="hidden xl:inline text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap"
            title={`Last telemetry sync from host: ${lastSyncTime}`}
          >
            {lastSyncTime}
          </span>
        )}

        <button
          type="button"
          onClick={toggleTheme}
          className="h-9 w-9 flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors shrink-0 cursor-pointer"
          title={`Active theme: ${theme} (resolved: ${resolvedTheme}). Click to toggle.`}
          aria-label="Toggle color theme"
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <Moon className="w-4 h-4 text-slate-700 shrink-0" />
          )}
        </button>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isSyncing}
          className={`h-9 flex items-center gap-2 px-3 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            isSyncing ? 'opacity-50 cursor-not-allowed' : ''
          }`}
          title="Sync telemetry from WSH host and local dev servers now"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 shrink-0 ${
              isSyncing ? 'animate-spin text-[var(--color-brand-text)]' : ''
            }`}
          />
          <span className="hidden sm:inline">{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
        </button>
      </div>
    </header>
  );
}
