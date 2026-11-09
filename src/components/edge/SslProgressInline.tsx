import React, { useState, useEffect, useRef } from 'react';
import { TerminalTab } from '../layout/SreTerminalDrawer';
import { getSslBatchProgress, DeviceOperationStatus } from './ssl-stage-parser';
import {
  X,
  Loader2,
  Check,
  AlertTriangle,
  FolderOpen,
  Cloud,
  Send,
  RefreshCw,
  Terminal,
  Copy,
  ChevronDown,
  ChevronUp,
  Server,
  Layers,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { formatConsoleLine } from '../layout/ConsoleColorizer';

interface SslProgressInlineProps {
  activeJob?: TerminalTab;
  onRefreshSsl?: () => void;
  onDismiss?: () => void;
}

const SSL_STAGES = [
  { num: 1, name: 'Pre-flight', desc: 'Expiration & Repo Check', icon: FolderOpen },
  { num: 2, name: 'ACME DNS-01', desc: 'Cloudflare Challenge', icon: Cloud },
  { num: 3, name: 'Transport', desc: 'SSH/SMB Staging & Hash', icon: Send },
  { num: 4, name: 'Install & Reload', desc: 'Atomic Swap & Web Reload', icon: RefreshCw },
];

export const SslProgressInline: React.FC<SslProgressInlineProps> = ({
  activeJob,
  onRefreshSsl,
  onDismiss,
}) => {
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showLogTerminal, setShowLogTerminal] = useState(true);

  // Auto-scroll terminal log when active and new lines arrive
  useEffect(() => {
    if (!isCollapsed && showLogTerminal && activeJob?.isRunning) {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeJob?.lines?.length, activeJob?.isRunning, isCollapsed, showLogTerminal]);

  if (!activeJob) return null;

  const batchProgress = getSslBatchProgress(activeJob);
  const stageInfo = batchProgress?.stageInfo;
  const isFinished = stageInfo?.isFinished ?? false;
  const isFailed = stageInfo?.isFailed ?? false;
  const currentStageNum = stageInfo?.stage ?? 1;

  const handleCopyLogs = async () => {
    if (!activeJob.lines || activeJob.lines.length === 0) return;
    try {
      await navigator.clipboard.writeText(activeJob.lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy SSL logs to clipboard:', err);
    }
  };

  const renderStatusPill = (status: DeviceOperationStatus, labelSuccess: string = 'Done') => {
    switch (status) {
      case 'in_progress':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 animate-pulse">
            <Loader2 className="w-2.5 h-2.5 animate-spin text-amber-500" />
            Active
          </span>
        );
      case 'success':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
            <Check className="w-2.5 h-2.5 text-emerald-500" />
            {labelSuccess}
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30">
            <AlertTriangle className="w-2.5 h-2.5 text-rose-500" />
            Failed
          </span>
        );
      case 'skipped':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-slate-500 bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
            Skipped
          </span>
        );
      case 'pending':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-slate-400 dark:text-slate-600 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <Clock className="w-2.5 h-2.5" />
            Queued
          </span>
        );
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl overflow-hidden transition-all animate-in fade-in duration-300">
      {/* Top Banner Header */}
      <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/80 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <div
            className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
              isFailed
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.15)]'
                : isFinished
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.15)]'
            }`}
          >
            {isFailed ? (
              <AlertTriangle className="w-5 h-5 text-rose-500" />
            ) : isFinished ? (
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
            ) : (
              <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span>{activeJob.title}</span>
              </h4>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                  isFailed
                    ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                    : isFinished
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                }`}
              >
                {isFailed ? 'FAILED' : isFinished ? 'COMPLETED' : `STAGE ${currentStageNum} OF 4`}
              </span>
              {batchProgress?.isBatch && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                  {batchProgress.completedDevices}/{batchProgress.totalDevices} Devices Processed
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Action: <span className="font-semibold text-slate-800 dark:text-slate-200">{stageInfo?.subStep || 'Processing'}</span>
              </span>
              {batchProgress?.activeDeviceName && (
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-slate-200/80 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700">
                  Target: {batchProgress.activeDeviceName}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Global Action Controls */}
        <div className="flex items-center gap-2">
          {/* Copy Logs */}
          <button
            type="button"
            onClick={handleCopyLogs}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700/80 transition-colors flex items-center gap-1.5 shadow-xs"
            title="Copy all captured console output to clipboard"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-500">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                <span>Copy Output</span>
              </>
            )}
          </button>

          {/* Toggle Log Terminal View */}
          <button
            type="button"
            onClick={() => setShowLogTerminal(!showLogTerminal)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
              showLogTerminal
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
            }`}
            title={showLogTerminal ? 'Hide Terminal Stream' : 'Show Terminal Stream'}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>{showLogTerminal ? 'Hide Console' : 'Show Console'}</span>
          </button>

          {/* Toggle Collapse */}
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
            title={isCollapsed ? 'Expand Details' : 'Collapse Details'}
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>

          {/* Dismiss button */}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
              title="Dismiss Progress Panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <div className="p-4 sm:p-5 space-y-5">
          {/* 4-Stage Stepper Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 font-mono text-xs">
            {SSL_STAGES.map((st) => {
              const Icon = st.icon;
              const isDone = isFinished || currentStageNum > st.num;
              const isActive = !isFinished && currentStageNum === st.num;
              const isStageFailed = isFailed && currentStageNum === st.num;

              return (
                <div
                  key={st.num}
                  className={`p-2.5 rounded-xl border flex flex-col gap-1 transition-all ${
                    isStageFailed
                      ? 'bg-rose-500/10 border-rose-500/40 text-rose-700 dark:text-rose-300'
                      : isActive
                      ? 'bg-amber-500/10 border-amber-500/40 text-amber-800 dark:text-amber-300 ring-1 ring-amber-500/30'
                      : isDone
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                      : 'bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold tracking-wider">STAGE {st.num}</span>
                    {isStageFailed ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    ) : isActive ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500 shrink-0" />
                    ) : isDone ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <Icon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-600 shrink-0" />
                    )}
                  </div>
                  <div className="font-sans font-bold text-xs truncate text-slate-900 dark:text-slate-100">
                    {st.name}
                  </div>
                  <div className="text-[10px] opacity-75 truncate">{st.desc}</div>
                </div>
              );
            })}
          </div>

          {/* Multi-Device Progress Checklist (renders for batch runs or single target) */}
          {batchProgress && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-500" />
                  <h5 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 font-sans">
                    {batchProgress.isBatch ? 'Multi-Device Fleet Batch Checklist' : 'Device Deployment Checklist'}
                  </h5>
                </div>
                <div className="text-[11px] font-mono text-slate-500">
                  {batchProgress.completedDevices} completed • {batchProgress.failedDevices} failed • {batchProgress.totalDevices - batchProgress.completedDevices - batchProgress.failedDevices} remaining
                </div>
              </div>

              <div className="divide-y divide-slate-200/80 dark:divide-slate-800/80 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-white dark:bg-slate-900">
                {batchProgress.devices.map((dev) => {
                  const isCurrent = batchProgress.activeDeviceKey === dev.deviceKey && !isFinished;
                  return (
                    <div
                      key={dev.deviceKey}
                      className={`p-3 flex flex-wrap items-center justify-between gap-3 text-xs transition-colors ${
                        isCurrent
                          ? 'bg-amber-500/5 dark:bg-amber-500/10'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-[200px]">
                        <div className="w-6 h-6 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 shrink-0">
                          <Server className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                            <span>{dev.displayName}</span>
                            {isCurrent && (
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                            )}
                          </div>
                          <div className="font-mono text-[10px] text-slate-500">
                            {dev.domain}
                          </div>
                        </div>
                      </div>

                      {/* Operation Stages */}
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400 uppercase font-sans">Issuance:</span>
                          {renderStatusPill(dev.issuanceStatus, 'Signed')}
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400 uppercase font-sans">Deploy:</span>
                          {renderStatusPill(dev.deploymentStatus, 'Deployed')}
                        </div>
                      </div>

                      {/* Status / Error Detail */}
                      <div className="text-right min-w-[140px]">
                        {dev.error ? (
                          <span className="text-[11px] font-mono text-rose-600 dark:text-rose-400 font-semibold truncate block" title={dev.error}>
                            {dev.error}
                          </span>
                        ) : dev.detail ? (
                          <span className="text-[11px] font-mono text-slate-500 truncate block">
                            {dev.detail}
                          </span>
                        ) : (
                          <span className="text-[11px] font-mono text-slate-400 truncate block">
                            Pending
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Terminal Log Output Window */}
          {showLogTerminal && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 overflow-hidden shadow-inner">
              <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-slate-400 text-[11px] font-mono">
                <span className="flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Live Deployment Stream</span>
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-slate-500">
                    {activeJob.lines?.length || 0} lines captured
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyLogs}
                    className="hover:text-emerald-400 transition-colors flex items-center gap-1"
                    title="Copy log text"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </button>
                </div>
              </div>

              <div className="p-4 font-mono text-xs max-h-72 min-h-[160px] overflow-y-auto select-text space-y-0.5">
                {activeJob.lines && activeJob.lines.length > 0 ? (
                  activeJob.lines.map((line, idx) => (
                    <div key={idx}>{formatConsoleLine(line)}</div>
                  ))
                ) : (
                  <div className="text-slate-600 italic">Waiting for command runner output...</div>
                )}
                <div ref={terminalEndRef} />
              </div>
            </div>
          )}

          {/* Footer Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-100 dark:border-slate-800/80">
            <div className="text-xs font-mono text-slate-500">
              {activeJob.isRunning ? (
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Execution in progress under resource lock
                </span>
              ) : isFinished ? (
                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                  <Check className="w-3.5 h-3.5" />
                  Execution completed successfully (code 0)
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-rose-500 font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Execution exited with code {activeJob.exitCode ?? 'ERROR'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isFinished && onRefreshSsl && (
                <button
                  type="button"
                  onClick={onRefreshSsl}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-all flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Re-probe Fleet Now
                </button>
              )}
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
