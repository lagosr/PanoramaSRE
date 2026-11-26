import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { StatusBadge } from '@lagosr/panorama-ui-kit';
import {
  Bookmark,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  MessageSquarePlus,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { ConfirmDangerModal } from '../ui/ConfirmDangerModal';
import { CustomSelect } from '../ui/CustomSelect';
import { formatLocalDateTime, formatRelativeTime } from '../../lib/formatters';
import type {
  DiscoveredApp,
  OttoChatMessageRow,
  OttoChatThreadRow,
  OttoContextSeed,
  OttoProposalRow,
  OttoRuntimePhase,
  OttoSavedPromptRow,
  OttoToolUsePill,
  SendOttoChatMessageResult,
} from '../../lib/types';
import { OttoIcon } from './OttoAvatar';
import { OttoMarkdownRenderer } from './OttoMarkdownRenderer';

interface AskOttoPanelProps {
  apps: DiscoveredApp[];
  runtimeState: OttoRuntimePhase;
  geminiConfigured: boolean;
  pendingContextSeed?: OttoContextSeed | null;
  pendingContextNonce?: number;
  onConsumeContextSeed?: () => void;
  proposals: OttoProposalRow[];
  onRefreshOtto: () => Promise<void>;
  onInspectTrace: (traceRunId: string) => void;
  onDecideProposal: (proposalId: string, decision: string) => Promise<void>;
  onAbortStep: () => Promise<void>;
  onNavigateToSettings?: () => void;
}

function safeParseSeed(raw?: string | null): OttoContextSeed | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OttoContextSeed;
  } catch {
    return null;
  }
}

function safeParseTools(raw?: string | null): OttoToolUsePill[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OttoToolUsePill[]) : [];
  } catch {
    return [];
  }
}

function safeParseUsage(
  raw?: string | null
): { inputTokens?: number; outputTokens?: number; thoughtTokens?: number; durationMs?: number } | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const DEFAULT_STARTERS = [
  'Audit our latest inside-perimeter alerts: are any of them detection code defects or false positives?',
  'Which external Threat Actors are genuine material threats against our Next.js/SQLite/CF-Pages stack vs. safe-to-drop background noise?',
  'Summarize recent deploy telemetry, WSH posture, and any operational risks across the fleet.',
  'Review my active Otto policies, Suricata SSH SYN budget, and L4 hard-blocked safety boundaries.',
];

export const AskOttoPanel: React.FC<AskOttoPanelProps> = ({
  apps,
  runtimeState,
  geminiConfigured,
  pendingContextSeed = null,
  pendingContextNonce = 0,
  onConsumeContextSeed,
  proposals,
  onRefreshOtto,
  onInspectTrace,
  onDecideProposal,
  onAbortStep,
  onNavigateToSettings,
}) => {
  const [threads, setThreads] = useState<OttoChatThreadRow[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<OttoChatMessageRow[]>([]);
  const [savedPrompts, setSavedPrompts] = useState<OttoSavedPromptRow[]>([]);
  const [draft, setDraft] = useState('');
  const [modelChoice, setModelChoice] = useState<string>('auto');
  const [thinkingLevel, setThinkingLevel] = useState<string>('auto');
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [expandedThinkingIds, setExpandedThinkingIds] = useState<Record<string, boolean>>({});
  const [showSavePromptForm, setShowSavePromptForm] = useState(false);
  const [newPromptTitle, setNewPromptTitle] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [confirmApproveProposal, setConfirmApproveProposal] = useState<OttoProposalRow | null>(null);
  const [isApprovingProposal, setIsApprovingProposal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastConsumedSeedNonceRef = useRef<number>(0);

  const loadThreadsAndPrompts = useCallback(async () => {
    try {
      const [tList, pList] = await Promise.all([
        invoke<OttoChatThreadRow[]>('get_otto_chat_threads', { limit: 50 }),
        invoke<OttoSavedPromptRow[]>('get_otto_saved_prompts'),
      ]);
      setThreads(Array.isArray(tList) ? tList : []);
      setSavedPrompts(Array.isArray(pList) ? pList : []);
      if (Array.isArray(tList) && tList.length > 0) {
        setActiveThreadId((prev) => (prev && tList.some((t) => t.id === prev) ? prev : tList[0].id));
      }
    } catch (err) {
      console.warn('[AskOtto] Failed to load threads/prompts:', err);
    }
  }, []);

  const loadMessages = useCallback(async (threadId: string) => {
    try {
      const list = await invoke<OttoChatMessageRow[]>('get_otto_chat_messages', { threadId });
      setMessages(Array.isArray(list) ? list : []);
    } catch (err) {
      console.warn('[AskOtto] Failed to load messages:', err);
    }
  }, []);

  useEffect(() => {
    void loadThreadsAndPrompts();
  }, [loadThreadsAndPrompts]);

  useEffect(() => {
    if (activeThreadId) {
      void loadMessages(activeThreadId);
    } else {
      setMessages([]);
    }
  }, [activeThreadId, loadMessages]);

  // Handle cross-tab "Ask Otto" deep-link context seed
  useEffect(() => {
    if (!pendingContextSeed || pendingContextNonce <= 0) return;
    if (lastConsumedSeedNonceRef.current === pendingContextNonce) return;
    lastConsumedSeedNonceRef.current = pendingContextNonce;

    const createSeededThread = async () => {
      try {
        const created = await invoke<OttoChatThreadRow>('create_otto_chat_thread', {
          input: {
            title: pendingContextSeed.title.slice(0, 100),
            contextSeedJson: JSON.stringify(pendingContextSeed),
            originView: pendingContextSeed.originView,
            originEntityId: pendingContextSeed.entityId,
          },
        });
        setThreads((prev) => [created, ...prev]);
        setActiveThreadId(created.id);
        setMessages([]);
        setChatError(null);
        onConsumeContextSeed?.();
        setTimeout(() => textareaRef.current?.focus(), 60);
      } catch (err) {
        setChatError(`Failed to open context-seeded Otto thread: ${String(err)}`);
      }
    };
    void createSeededThread();
  }, [pendingContextSeed, pendingContextNonce, onConsumeContextSeed]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isSending]);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId]
  );

  const activeSeed = useMemo(
    () => safeParseSeed(activeThread?.contextSeedJson),
    [activeThread]
  );

  const entitySuggestions = useMemo(() => {
    const items: Array<{ token: string; label: string }> = [
      ...apps.map((a) => ({
        token: `@app:${a.manifest.slug}`,
        label: `${a.manifest.displayName} (/${a.manifest.slug})`,
      })),
      { token: '@host:wsh', label: 'DietPi WSH Host (172.25.25.5)' },
      { token: '@inv:SEC-01', label: 'SEC-01 Loopback Socket Confinement' },
      { token: '@inv:SEC-09', label: 'SEC-09 UniFi SIEM UDP 5514 Lock' },
      { token: '@finding:latest', label: 'Latest Threat SOC Findings' },
      { token: '@actor:active', label: 'Active External Threat Actors' },
    ];
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return items
      .filter((i) => i.token.toLowerCase().includes(q) || i.label.toLowerCase().includes(q))
      .slice(0, 6);
  }, [apps, mentionQuery]);

  const handleCreateNewThread = async () => {
    try {
      const created = await invoke<OttoChatThreadRow>('create_otto_chat_thread', {
        input: {
          title: `SRE Session ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          contextSeedJson: null,
          originView: 'agent',
          originEntityId: null,
        },
      });
      setThreads((prev) => [created, ...prev]);
      setActiveThreadId(created.id);
      setMessages([]);
      setChatError(null);
      setTimeout(() => textareaRef.current?.focus(), 50);
    } catch (err) {
      setChatError(String(err));
    }
  };

  const handleDeleteThread = async (threadId: string) => {
    try {
      await invoke('delete_otto_chat_thread', { threadId });
      setThreads((prev) => {
        const next = prev.filter((t) => t.id !== threadId);
        if (activeThreadId === threadId) {
          setActiveThreadId(next[0]?.id ?? null);
        }
        return next;
      });
    } catch (err) {
      setChatError(String(err));
    }
  };

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? draft).trim();
    if (!text || isSending) return;
    setChatError(null);
    setMentionQuery(null);

    let targetThreadId = activeThreadId;
    if (!targetThreadId) {
      try {
        const created = await invoke<OttoChatThreadRow>('create_otto_chat_thread', {
          input: {
            title: text.slice(0, 72),
            contextSeedJson: null,
            originView: 'agent',
            originEntityId: null,
          },
        });
        setThreads((prev) => [created, ...prev]);
        setActiveThreadId(created.id);
        targetThreadId = created.id;
      } catch (err) {
        setChatError(String(err));
        return;
      }
    }

    if (!overrideText) setDraft('');
    setIsSending(true);
    try {
      const res = await invoke<SendOttoChatMessageResult>('send_otto_chat_message', {
        input: {
          threadId: targetThreadId,
          userMessage: text,
          modelChoice,
          thinkingLevel,
          contextSeedJson: activeThread?.contextSeedJson ?? null,
        },
      });
      setMessages((prev) => [...prev, res.userMessage, res.assistantMessage]);
      await Promise.all([loadThreadsAndPrompts(), onRefreshOtto()]);
    } catch (err) {
      setChatError(String(err));
      await onRefreshOtto();
    } finally {
      setIsSending(false);
    }
  };

  const handleDraftChange = (val: string) => {
    setDraft(val);
    const match = val.match(/@([a-zA-Z0-9:_-]*)$/);
    if (match) {
      setMentionQuery(match[1] ?? '');
    } else {
      setMentionQuery(null);
    }
  };

  const handleInsertMention = (token: string) => {
    setDraft((prev) => prev.replace(/@[a-zA-Z0-9:_-]*$/, `${token} `));
    setMentionQuery(null);
    textareaRef.current?.focus();
  };

  const handleSaveCurrentPrompt = async () => {
    if (!newPromptTitle.trim() || !draft.trim()) return;
    try {
      const saved = await invoke<OttoSavedPromptRow>('save_otto_prompt', {
        title: newPromptTitle.trim(),
        promptText: draft.trim(),
        category: 'CUSTOM',
      });
      setSavedPrompts((prev) => [saved, ...prev]);
      setNewPromptTitle('');
      setShowSavePromptForm(false);
    } catch (err) {
      setChatError(String(err));
    }
  };

  const handleDeletePrompt = async (id: string) => {
    try {
      await invoke('delete_otto_prompt', { id });
      setSavedPrompts((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setChatError(String(err));
    }
  };

  const starterChips = activeSeed?.starterPrompts?.length
    ? activeSeed.starterPrompts
    : DEFAULT_STARTERS;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-5 min-h-[620px]">
      {/* Left Rail: Conversations & Saved SRE Prompts */}
      <div className="lg:col-span-1 flex flex-col gap-4 min-w-0">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Conversations ({threads.length})
            </h2>
            <button
              type="button"
              onClick={() => void handleCreateNewThread()}
              className="btn-primary text-xs px-2.5 py-1 min-h-[34px] flex items-center gap-1 whitespace-nowrap flex-shrink-0"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              <span>New</span>
            </button>
          </div>

          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
            {threads.length === 0 ? (
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                Start a free-form SRE investigation or click <strong>Ask Otto</strong> on any Threat SOC finding.
              </div>
            ) : (
              threads.map((t) => {
                const isSelected = t.id === activeThreadId;
                return (
                  <div
                    key={t.id}
                    className={`group flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-xl border transition-colors ${
                      isSelected
                        ? 'bg-[var(--color-brand-subtle)] border-[var(--color-brand-ring)] text-[var(--color-brand-text)]'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveThreadId(t.id)}
                      className="flex-1 text-left min-w-0 cursor-pointer"
                    >
                      <div className="text-xs font-semibold truncate">{t.title}</div>
                      <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 tabular-nums flex items-center gap-1.5">
                        <span>{t.messageCount} msgs</span>
                        {t.originView && t.originView !== 'agent' && (
                          <span className="uppercase text-[var(--color-accent-text)]">
                            · {t.originView}
                          </span>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteThread(t.id)}
                      aria-label={`Delete thread ${t.title}`}
                      className="p-1 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 opacity-70 group-hover:opacity-100 cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Saved Prompts Library */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Bookmark className="w-3.5 h-3.5 text-[var(--color-brand-text)]" />
              <span>Saved Prompts</span>
            </h2>
          </div>

          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
            {savedPrompts.map((p) => (
              <div
                key={p.id}
                className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1"
              >
                <div className="flex items-start justify-between gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(p.promptText);
                      textareaRef.current?.focus();
                    }}
                    className="text-left text-xs font-semibold text-slate-900 dark:text-slate-100 hover:text-[var(--color-brand-text)] cursor-pointer leading-snug"
                  >
                    {p.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeletePrompt(p.id)}
                    aria-label={`Delete saved prompt ${p.title}`}
                    className="p-0.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer shrink-0"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 line-clamp-2">
                  {p.promptText}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Canvas: Conversational SRE Thread */}
      <div className="lg:col-span-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm flex flex-col overflow-hidden min-w-0">
        {/* Conversation Toolbar */}
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <OttoIcon
              className="w-7 h-7"
              state={isSending ? 'THINKING' : runtimeState}
              thinking={isSending}
            />
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                {activeThread?.title || 'Ask Otto — Free-Form SRE Assistant'}
              </div>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                Read-only SQLite + Threat SOC + Policy Kernel · Every turn writes a Deep-Thinking Trace
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="w-56">
              <CustomSelect
                value={modelChoice}
                onChange={setModelChoice}
                options={[
                  { value: 'auto', label: 'Auto (Hydrogen → Neon)' },
                  { value: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (Fast)' },
                  { value: 'gemini-4-neon', label: 'Gemini 4 Neon (Deep)' },
                  { value: 'gemini-4-carbon', label: 'Gemini 4 Carbon (Heavy)' },
                ]}
              />
            </div>
            <div className="w-40">
              <CustomSelect
                value={thinkingLevel}
                onChange={setThinkingLevel}
                options={[
                  { value: 'auto', label: 'Thinking: Auto' },
                  { value: 'low', label: 'Thinking: Low' },
                  { value: 'medium', label: 'Thinking: Medium' },
                  { value: 'high', label: 'Thinking: High' },
                  { value: 'xhigh', label: 'Thinking: xHigh' },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Pinned Event Context Seed Card (when launched from Threat SOC / HUD / Hardening) */}
        {activeSeed && (
          <div
            data-testid="otto-pinned-context-card"
            className="mx-4 mt-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border-2 border-[var(--color-brand-ring)] space-y-1.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge label={`CONTEXT: ${activeSeed.kind.toUpperCase()}`} variant="info" />
                {activeSeed.severity && (
                  <StatusBadge
                    label={activeSeed.severity}
                    variant={
                      activeSeed.severity === 'CRITICAL' || activeSeed.severity === 'HIGH'
                        ? 'danger'
                        : 'warning'
                    }
                  />
                )}
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  {activeSeed.title}
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                Origin: {activeSeed.originView} · {activeSeed.entityId}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">{activeSeed.summary}</p>
          </div>
        )}

        {/* Missing Gemini Key Notice */}
        {!geminiConfigured && (
          <div className="mx-4 mt-4 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/40 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-amber-900 dark:text-amber-300 font-medium">
              Gemini API key is not configured yet. Add your DPAPI-encrypted key in Settings to chat with Otto.
            </span>
            {onNavigateToSettings && (
              <button
                type="button"
                onClick={onNavigateToSettings}
                className="btn-secondary text-xs whitespace-nowrap flex-shrink-0"
              >
                Open AI Connectors →
              </button>
            )}
          </div>
        )}

        {/* Messages Transcript */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[340px] max-h-[540px]">
          {messages.length === 0 ? (
            <div className="py-6 space-y-4">
              <div className="flex flex-col items-center text-center max-w-lg mx-auto space-y-2">
                <OttoIcon className="w-14 h-14" state={runtimeState} />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {activeSeed
                    ? 'Event context pinned — ask Otto anything about this incident'
                    : 'Hi, I’m Otto — your PanoramaDrSuite AI SRE'}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  I inspect Threat SOC findings, deploy telemetry, system logs, and Policy Matrix guardrails read-only, check for detection code defects before blaming external actors, and show my full Gemini 4 Deep-Thinking rundown on every reply.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-w-3xl mx-auto">
                {starterChips.map((chip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={isSending || !geminiConfigured}
                    onClick={() => void handleSend(chip)}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:border-[var(--color-brand)] text-left text-xs text-slate-700 dark:text-slate-300 transition-colors cursor-pointer disabled:opacity-50 flex items-start gap-2"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[var(--color-brand-text)] shrink-0 mt-0.5" />
                    <span className="leading-snug">{chip}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              const tools = safeParseTools(msg.toolsUsedJson);
              const usage = safeParseUsage(msg.tokenUsageJson);
              const isThinkingExpanded = Boolean(expandedThinkingIds[msg.id]);
              const linkedProposal = msg.inlineProposalId
                ? proposals.find((p) => p.id === msg.inlineProposalId) ?? null
                : null;

              return (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  {!isUser && <OttoIcon className="w-7 h-7 mt-1" />}
                  <div
                    className={`min-w-0 max-w-[90%] rounded-2xl p-4 space-y-2.5 border ${
                      isUser
                        ? 'bg-[var(--color-brand-subtle)] border-[var(--color-brand-ring)] text-slate-900 dark:text-slate-100'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {/* Read-only inspection tool pills */}
                    {!isUser && tools.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {tools.map((tool, i) => (
                          <span
                            key={`${msg.id}-tool-${i}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 tabular-nums"
                            title={tool.summary}
                          >
                            <Wrench className="w-2.5 h-2.5 text-[var(--color-brand-text)]" />
                            <span>{tool.tool}</span>
                            <span className="text-slate-400">({tool.itemsCount})</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Collapsible Native Gemini Deep-Thinking Rundown */}
                    {!isUser && msg.thinkingSummaryMd && (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedThinkingIds((prev) => ({
                              ...prev,
                              [msg.id]: !prev[msg.id],
                            }))
                          }
                          className="w-full px-3 py-2 flex items-center justify-between gap-2 text-[11px] font-mono font-semibold text-[var(--color-accent-text)] hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                        >
                          <span className="flex items-center gap-1.5">
                            {isThinkingExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                            <BrainCircuit className="w-3.5 h-3.5" />
                            <span>
                              Deep-Thinking Rundown
                              {usage?.thoughtTokens
                                ? ` (${usage.thoughtTokens.toLocaleString()} thought tokens)`
                                : ''}
                            </span>
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {isThinkingExpanded ? 'Collapse' : 'Expand'}
                          </span>
                        </button>
                        {isThinkingExpanded && (
                          <div className="px-3 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#050b14] text-emerald-900 dark:text-emerald-400 font-mono max-h-64 overflow-y-auto">
                            <OttoMarkdownRenderer
                              markdown={msg.thinkingSummaryMd}
                              variant="thinking"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Message Body */}
                    {isUser ? (
                      <div className="text-xs sm:text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                        {msg.contentMd}
                      </div>
                    ) : (
                      <OttoMarkdownRenderer markdown={msg.contentMd} variant="chat" />
                    )}

                    {/* Inline Policy-Validated Proposal Card */}
                    {linkedProposal && (
                      <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-[var(--color-brand-ring)] space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge
                              label={linkedProposal.status}
                              variant={
                                linkedProposal.status === 'PENDING_APPROVAL'
                                  ? 'warning'
                                  : linkedProposal.status === 'VERIFIED' ||
                                    linkedProposal.status === 'ROLLED_BACK' ||
                                    linkedProposal.status.includes('APPROVED') ||
                                    linkedProposal.status === 'SHADOW_AGREED'
                                  ? 'success'
                                  : linkedProposal.status === 'FAILED' ||
                                    linkedProposal.status === 'REJECTED' ||
                                    linkedProposal.status === 'BLOCKED'
                                  ? 'danger'
                                  : 'info'
                              }
                            />
                            <StatusBadge label={linkedProposal.classification} variant="accent" />
                            <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                              {linkedProposal.title}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-slate-500">
                            {linkedProposal.actionId} · {linkedProposal.assetSlug}
                          </span>
                        </div>
                        {linkedProposal.rcaSummary && (
                          <p className="text-[11px] text-slate-600 dark:text-slate-400">
                            {linkedProposal.rcaSummary}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {linkedProposal.status === 'SHADOW_LOGGED' && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  void onDecideProposal(linkedProposal.id, 'SHADOW_AGREE')
                                }
                                className="btn-primary text-xs py-1 px-2.5 whitespace-nowrap flex-shrink-0"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Agree (Shadow)</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void onDecideProposal(linkedProposal.id, 'SHADOW_DISAGREE')
                                }
                                className="btn-secondary text-xs py-1 px-2.5 whitespace-nowrap flex-shrink-0"
                              >
                                Disagree
                              </button>
                            </>
                          )}
                          {linkedProposal.status === 'PENDING_APPROVAL' && (
                            <>
                              <button
                                type="button"
                                onClick={() => setConfirmApproveProposal(linkedProposal)}
                                className="btn-primary text-xs py-1 px-2.5 whitespace-nowrap flex-shrink-0"
                              >
                                Approve &amp; Execute
                              </button>
                              <button
                                type="button"
                                onClick={() => void onDecideProposal(linkedProposal.id, 'SNOOZE_24H')}
                                className="btn-secondary text-xs py-1 px-2.5 whitespace-nowrap flex-shrink-0"
                              >
                                Snooze 24h
                              </button>
                              <button
                                type="button"
                                onClick={() => void onDecideProposal(linkedProposal.id, 'REJECT')}
                                className="btn-danger text-xs py-1 px-2.5 whitespace-nowrap flex-shrink-0"
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Message Footer Metadata + Inspect Full Trace */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                      <span title={formatLocalDateTime(msg.createdAt)}>
                        {formatRelativeTime(msg.createdAt)}
                        {!isUser && msg.modelUsed ? ` · ${msg.modelUsed} (${msg.thinkingLevel || 'auto'})` : ''}
                        {!isUser && usage?.durationMs ? ` · ${(usage.durationMs / 1000).toFixed(1)}s` : ''}
                      </span>
                      {!isUser && msg.traceRunId && (
                        <button
                          type="button"
                          onClick={() => onInspectTrace(msg.traceRunId!)}
                          className="inline-flex items-center gap-1 text-[var(--color-brand-text)] hover:underline cursor-pointer"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Inspect Full Trace</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {isSending && (
            <div className="flex items-center gap-3">
              <OttoIcon className="w-7 h-7" state="THINKING" thinking />
              <div className="px-3.5 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-[var(--color-brand-ring)] flex items-center gap-3 text-xs font-mono text-slate-700 dark:text-slate-300">
                <span>Otto is gathering context &amp; deep-thinking with Gemini 4...</span>
                <button
                  type="button"
                  onClick={() => void onAbortStep()}
                  className="btn-danger text-[11px] px-2 py-1 min-h-[28px] flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                >
                  <Square className="w-3 h-3" />
                  <span>Abort</span>
                </button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Error Banner */}
        {chatError && (
          <div className="mx-4 mb-2 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-500/40 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{chatError}</span>
            </span>
            <button
              type="button"
              onClick={() => setChatError(null)}
              className="p-1 hover:text-rose-900 dark:hover:text-rose-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Composer + @Entity Autocomplete */}
        <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 space-y-2 relative">
          {entitySuggestions.length > 0 && (
            <div className="p-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-lg flex flex-wrap gap-1.5">
              {entitySuggestions.map((s) => (
                <button
                  key={s.token}
                  type="button"
                  onClick={() => handleInsertMention(s.token)}
                  className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-[var(--color-brand-subtle)] text-xs font-mono text-slate-800 dark:text-slate-200 cursor-pointer"
                >
                  <span className="font-bold text-[var(--color-brand-text)]">{s.token}</span>{' '}
                  <span className="text-[10px] text-slate-500">{s.label}</span>
                </button>
              ))}
            </div>
          )}

          {showSavePromptForm && (
            <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              <input
                type="text"
                value={newPromptTitle}
                onChange={(e) => setNewPromptTitle(e.target.value)}
                placeholder="Saved prompt title..."
                className="flex-1 min-w-[180px] px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() => void handleSaveCurrentPrompt()}
                className="btn-primary text-xs py-1 px-2.5 whitespace-nowrap flex-shrink-0"
              >
                Save Prompt
              </button>
              <button
                type="button"
                onClick={() => setShowSavePromptForm(false)}
                className="btn-ghost text-xs py-1 px-2"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="flex items-end gap-2 min-w-0">
            <textarea
              ref={textareaRef}
              rows={2}
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Ask Otto about Threat SOC false positives, @app:auth, @host:wsh, @inv:SEC-09, or fleet health... (Enter to send, Shift+Enter for newline)"
              className="flex-1 min-w-0 resize-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            />
            <div className="flex flex-col sm:flex-row items-center gap-1.5 shrink-0">
              {draft.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSavePromptForm((prev) => !prev)}
                  title="Save draft to Saved Prompts library"
                  className="btn-secondary text-xs px-2.5 py-2 whitespace-nowrap flex-shrink-0"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                disabled={isSending || !draft.trim() || !geminiConfigured}
                onClick={() => void handleSend()}
                className="btn-primary text-xs px-3.5 py-2 flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* L3 Desktop Approval Confirmation Gate for Inline Chat Proposals */}
      <ConfirmDangerModal
        isOpen={Boolean(confirmApproveProposal)}
        title={
          confirmApproveProposal
            ? `Approve & Execute: ${confirmApproveProposal.title}`
            : 'Approve L3 Action'
        }
        description={
          confirmApproveProposal
            ? `Otto will re-validate "${confirmApproveProposal.actionId}" targeting "${confirmApproveProposal.assetSlug}" (${confirmApproveProposal.assetTier}) through the compiled Rust Policy Kernel, stream live output in Tier A Console Dock, and run Post-Action Outcome Verification.\n\nSummary: ${confirmApproveProposal.rcaSummary || confirmApproveProposal.title}`
            : ''
        }
        confirmWord={
          confirmApproveProposal?.assetTier === 'TIER0_CRITICAL' ? 'CONFIRM' : undefined
        }
        confirmLabel="Approve & Execute"
        isProcessing={isApprovingProposal}
        onCancel={() => {
          if (!isApprovingProposal) setConfirmApproveProposal(null);
        }}
        onConfirm={() => {
          if (!confirmApproveProposal) return;
          setIsApprovingProposal(true);
          void onDecideProposal(confirmApproveProposal.id, 'APPROVE').finally(() => {
            setIsApprovingProposal(false);
            setConfirmApproveProposal(null);
          });
        }}
      />
    </div>
  );
};
