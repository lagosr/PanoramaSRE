import React from 'react';
import { TerminalTab } from '../../lib/types';
import { getSslBatchProgress, DeviceOperationStatus } from './ssl-stage-parser';
import {
  Loader2,
  Check,
  AlertTriangle,
  FolderOpen,
  Cloud,
  Send,
  RefreshCw,
  Server,
  Layers,
  Clock,
} from 'lucide-react';

interface SslProgressInlineProps {
  activeJob?: TerminalTab | null;
}

const SSL_STAGES = [
  { num: 1, name: 'Pre-flight', desc: 'Expiration & Repo Check', icon: FolderOpen },
  { num: 2, name: 'ACME DNS-01', desc: 'Cloudflare Challenge', icon: Cloud },
  { num: 3, name: 'Transport', desc: 'SSH/SMB Staging & Hash', icon: Send },
  { num: 4, name: 'Install & Reload', desc: 'Atomic Swap & Web Reload', icon: RefreshCw },
];

function renderStatusPill(status: DeviceOperationStatus, labelSuccess: string = 'Done') {
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
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <Clock className="w-2.5 h-2.5" />
          Queued
        </span>
      );
  }
}

export const SslProgressInline: React.FC<SslProgressInlineProps> = ({ activeJob }) => {
  if (!activeJob) return null;

  const batchProgress = getSslBatchProgress(activeJob);
  if (!batchProgress) return null;
  const stageInfo = batchProgress.stageInfo;
  const activeDeviceKey = batchProgress.activeDeviceKey;
  const isFinished = stageInfo.isFinished;
  const isFailed = stageInfo.isFailed;
  const currentStageNum = stageInfo.stage;

  return (
    <div className="space-y-4">
      {/* Compact Stage & Device Summary Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
              isFailed
                ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/35'
                : isFinished
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35'
                : 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/35'
            }`}
          >
            {isFailed ? 'FAILED' : isFinished ? 'COMPLETED' : `STAGE ${currentStageNum} OF 4`}
          </span>

          {batchProgress.isBatch && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
              {batchProgress.completedDevices}/{batchProgress.totalDevices} Devices Processed
            </span>
          )}

          <span className="text-slate-600 dark:text-slate-300 font-medium">
            {stageInfo.subStep || 'Processing PKI operation'}
          </span>
        </div>

        {batchProgress.activeDeviceName && (
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-slate-200/80 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700">
            Target: {batchProgress.activeDeviceName}
          </span>
        )}
      </div>

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
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500'
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
                  <Icon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
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

      {/* Multi-Device Progress Checklist */}
      {batchProgress.devices.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-500" />
              <h5 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 font-sans">
                {batchProgress.isBatch ? 'Multi-Device Fleet Batch Checklist' : 'Device Deployment Checklist'}
              </h5>
            </div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {batchProgress.completedDevices} completed • {batchProgress.failedDevices} failed •{' '}
              {Math.max(0, batchProgress.totalDevices - batchProgress.completedDevices - batchProgress.failedDevices)}{' '}
              remaining
            </div>
          </div>

          <div className="divide-y divide-slate-200/80 dark:divide-slate-800/80 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-slate-50/50 dark:bg-slate-950/40">
            {batchProgress.devices.map((dev) => {
              const isCurrent = activeDeviceKey === dev.deviceKey && !isFinished;
              return (
                <div
                  key={dev.deviceKey}
                  className={`p-2.5 flex flex-wrap items-center justify-between gap-3 text-xs transition-colors ${
                    isCurrent
                      ? 'bg-amber-500/10'
                      : 'hover:bg-slate-100/70 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-[200px]">
                    <div className="w-6 h-6 rounded-md bg-slate-200/70 dark:bg-slate-800 flex items-center justify-center text-slate-500 shrink-0">
                      <Server className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <span>{dev.displayName}</span>
                        {isCurrent && (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-slate-500">{dev.domain}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-sans">
                        Issuance:
                      </span>
                      {renderStatusPill(dev.issuanceStatus, 'Signed')}
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-sans">
                        Deploy:
                      </span>
                      {renderStatusPill(dev.deploymentStatus, 'Deployed')}
                    </div>
                  </div>

                  <div className="text-right min-w-[140px]">
                    {dev.error ? (
                      <span
                        className="text-[11px] font-mono text-rose-600 dark:text-rose-400 font-semibold truncate block"
                        title={dev.error}
                      >
                        {dev.error}
                      </span>
                    ) : dev.detail ? (
                      <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400 truncate block">
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
    </div>
  );
};
