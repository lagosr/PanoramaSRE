import React from 'react';
import { McpBridgeStatus } from '../../lib/types';
import { Bot, ShieldCheck, ShieldAlert, Radio, Activity } from 'lucide-react';
import { formatRelativeTime } from '../../lib/formatters';

interface McpBridgeBannerProps {
  status: McpBridgeStatus | null;
  onRefresh?: () => void;
}

export const McpBridgeBanner: React.FC<McpBridgeBannerProps> = ({ status }) => {
  if (!status) {
    return null;
  }

  const isOnline = status.isOnline;
  const channelLabel = status.channel === 'installed' ? 'Release' : status.channel === 'dev' ? 'Pre-Release (Dev)' : 'Portable';
  const lastAction = status.lastAction;

  return (
    <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4.5 transition-all">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Left: Identity and Transport */}
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
            isOnline
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400'
          }`}>
            <Bot className="w-5 h-5" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                Antigravity Agent MCP Bridge
              </span>
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold tracking-wide border ${
                isOnline
                  ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border-emerald-500/30'
                  : 'bg-rose-500/15 text-rose-800 dark:text-rose-400 border-rose-500/30'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-600 dark:bg-emerald-400 animate-pulse' : 'bg-rose-600 dark:bg-rose-400'}`} />
                {isOnline ? 'ONLINE' : 'OFFLINE'}
              </span>

              {status.isPrimaryElected && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20">
                  Primary Elected
                </span>
              )}
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">PID {status.pid}</span>
              <span>•</span>
              <span>Channel: <span className="font-medium text-slate-700 dark:text-slate-300">{channelLabel}</span></span>
              <span>•</span>
              <span>Transport: <span className="font-medium text-slate-700 dark:text-slate-300">Named Pipe (Zero-TCP)</span></span>
            </p>
          </div>
        </div>

        {/* Right: Metrics & Telemetry Badges */}
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 w-full md:w-auto justify-start md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-slate-100 dark:border-slate-800/80">
          {/* Requests Count */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 text-xs">
            <Activity className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
            <span className="text-slate-500 dark:text-slate-400">Requests:</span>
            <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{status.totalRequests}</span>
          </div>

          {/* Security & Incursions */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs ${
            status.securityAlerts > 0
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300'
              : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200/80 dark:border-slate-700/60 text-slate-600 dark:text-slate-300'
          }`}>
            {status.securityAlerts > 0 ? (
              <ShieldAlert className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
            )}
            <span className="text-slate-500 dark:text-slate-400">Security:</span>
            <span className="font-medium">
              {status.securityAlerts > 0 ? `${status.securityAlerts} blocked` : 'Kernel DACL + HMAC'}
            </span>
          </div>

          {/* Last Agent Action */}
          {lastAction && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 text-xs max-w-xs truncate" title={`${lastAction.action}${lastAction.slug ? ` (${lastAction.slug})` : ''} at ${lastAction.timestamp}`}>
              <Radio className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400 shrink-0 animate-pulse" />
              <span className="text-slate-500 dark:text-slate-400">Last Action:</span>
              <span className="font-mono font-medium text-slate-800 dark:text-slate-200 truncate">
                {lastAction.action}{lastAction.slug ? `(${lastAction.slug})` : ''}
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {formatRelativeTime(lastAction.timestamp)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
