import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { StatusBadge } from '@lagosr/panorama-ui-kit';
import {
  BrainCircuit,
  Check,
  Clock,
  Copy,
  FileCode2,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import { formatLocalDateTime } from '../../lib/formatters';
import type { OttoTraceDebugBundleDto, OttoTraceDetailDto } from '../../lib/types';
import { OttoIcon } from './OttoAvatar';

interface OttoTraceInspectorDrawerProps {
  traceRunId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

function stepBadgeVariant(status: string): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
  const s = status.toUpperCase();
  if (s === 'OK' || s === 'COMPLETED') return 'success';
  if (s === 'FAILED' || s === 'BLOCKED') return 'danger';
  if (s === 'ABORTED') return 'warning';
  if (s === 'RUNNING') return 'info';
  return 'neutral';
}

function stepIcon(stepType: string) {
  switch (stepType.toUpperCase()) {
    case 'LLM_THINKING':
      return <BrainCircuit className="w-4 h-4 text-[var(--color-accent-text)] shrink-0" />;
    case 'POLICY_CHECK':
      return <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />;
    case 'TOOL_CALL':
      return <Wrench className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />;
    default:
      return <Terminal className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />;
  }
}

export const OttoTraceInspectorDrawer: React.FC<OttoTraceInspectorDrawerProps> = ({
  traceRunId,
  isOpen,
  onClose,
}) => {
  const [detail, setDetail] = useState<OttoTraceDetailDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [copiedMode, setCopiedMode] = useState<'md' | 'json' | null>(null);

  useEffect(() => {
    if (!isOpen || !traceRunId) return;
    let active = true;
    setIsLoading(true);
    setErrorText(null);
    void invoke<OttoTraceDetailDto | null>('get_otto_trace_detail', { traceRunId })
      .then((res) => {
        if (!active) return;
        setDetail(res);
        if (!res) setErrorText(`Trace run '${traceRunId}' was not found in sre.sqlite.`);
      })
      .catch((err) => {
        if (!active) return;
        setErrorText(String(err));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, traceRunId]);

  if (!isOpen || !traceRunId) return null;

  const handleCopyBundle = async (format: 'md' | 'json') => {
    try {
      const bundle = await invoke<OttoTraceDebugBundleDto>('export_otto_trace_bundle', {
        traceRunId,
      });
      const content = format === 'md' ? bundle.markdown : bundle.json;
      await navigator.clipboard.writeText(content);
      setCopiedMode(format);
      setTimeout(() => setCopiedMode(null), 2000);
    } catch (err) {
      setErrorText(`Failed to copy debug bundle: ${String(err)}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[85] bg-slate-900/80 backdrop-blur-sm flex justify-end"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Otto Verbose Trace & Deep-Thinking Inspector"
    >
      <div
        className="w-full max-w-3xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Solid M3 Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <OttoIcon className="w-7 h-7" title="Otto Trace Inspector" />
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                Otto Verbose Execution Trace &amp; Deep-Thinking Rundown
              </h2>
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                {traceRunId}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleCopyBundle('md')}
              className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              title="Copy scrubbed Markdown debug bundle for Antigravity or issue reports"
            >
              {copiedMode === 'md' ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedMode === 'md' ? 'Copied MD' : 'Copy Debug MD'}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleCopyBundle('json')}
              className="btn-ghost text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              title="Copy scrubbed JSON trace payload"
            >
              {copiedMode === 'json' ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <FileCode2 className="w-3.5 h-3.5" />
              )}
              <span>{copiedMode === 'json' ? 'Copied JSON' : 'JSON'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Trace Inspector"
              className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isLoading ? (
            <div className="p-8 text-center text-xs font-mono text-slate-500 dark:text-slate-400">
              Loading trace steps &amp; Deep-Thinking rundown...
            </div>
          ) : errorText ? (
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-500/40 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{errorText}</span>
            </div>
          ) : detail ? (
            <>
              {/* Run Summary KPI Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 tabular-nums">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400">
                    State / Trigger
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <StatusBadge
                      label={detail.run.finalState}
                      variant={stepBadgeVariant(detail.run.finalState)}
                    />
                    <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                      {detail.run.triggerKind}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400">
                    Model &amp; Thinking
                  </div>
                  <div className="mt-1 text-xs font-mono font-bold text-slate-900 dark:text-slate-100 truncate">
                    {detail.run.modelUsed || 'Deterministic'}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    level: {detail.run.thinkingLevel || 'n/a'}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400">
                    Token Breakdown
                  </div>
                  <div className="mt-1 text-xs font-mono font-bold text-slate-900 dark:text-slate-100">
                    {detail.run.inputTokens.toLocaleString()} in · {detail.run.outputTokens.toLocaleString()} out
                  </div>
                  <div className="text-[11px] font-mono text-[var(--color-accent-text)] font-semibold">
                    {detail.run.thoughtTokens.toLocaleString()} thought tokens
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400">
                    Wall Duration
                  </div>
                  <div className="mt-1 text-xs font-mono font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>{(detail.run.durationMs / 1000).toFixed(2)}s</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                    {formatLocalDateTime(detail.run.startedAt)}
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-1">
                <div className="font-mono text-[10px] uppercase text-slate-500 dark:text-slate-400">
                  Outcome Summary
                </div>
                <p className="text-slate-800 dark:text-slate-200 font-medium">
                  {detail.run.outcomeSummary || 'Completed'}
                </p>
                {detail.run.errorText && (
                  <p className="text-rose-700 dark:text-rose-300 font-mono text-[11px]">
                    Error: {detail.run.errorText}
                  </p>
                )}
              </div>

              {/* Chronological Step Timeline */}
              <div className="space-y-3">
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Execution Timeline ({detail.steps.length} steps)
                </h3>

                {detail.steps.map((step) => (
                  <div
                    key={step.id}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-mono font-bold flex items-center justify-center tabular-nums text-slate-700 dark:text-slate-300 shrink-0">
                          {step.stepIndex + 1}
                        </span>
                        {stepIcon(step.stepType)}
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100 break-words">
                          {step.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 tabular-nums">
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {step.stepType} · {step.durationMs}ms
                        </span>
                        <StatusBadge label={step.status} variant={stepBadgeVariant(step.status)} />
                      </div>
                    </div>

                    {step.thinkingSummaryMd && (
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-mono font-semibold text-[var(--color-accent-text)] flex items-center gap-1.5">
                          <BrainCircuit className="w-3.5 h-3.5" />
                          <span>Native Gemini Deep-Thinking Rundown (Scrubbed)</span>
                        </div>
                        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#050b14] border border-slate-200/90 dark:border-slate-800 text-emerald-900 dark:text-emerald-400 font-mono text-xs whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
                          {step.thinkingSummaryMd}
                        </div>
                      </div>
                    )}

                    {step.structuredPayloadJson && (
                      <details className="group">
                        <summary className="text-[11px] font-mono text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer select-none">
                          Inspect Structured Step Payload (JSON)
                        </summary>
                        <pre className="mt-2 p-3 rounded-xl bg-slate-50 dark:bg-[#050b14] border border-slate-200/90 dark:border-slate-800 text-emerald-900 dark:text-emerald-400 font-mono text-xs overflow-x-auto max-h-64 overflow-y-auto">
                          {(() => {
                            try {
                              return JSON.stringify(JSON.parse(step.structuredPayloadJson), null, 2);
                            } catch {
                              return step.structuredPayloadJson;
                            }
                          })()}
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
