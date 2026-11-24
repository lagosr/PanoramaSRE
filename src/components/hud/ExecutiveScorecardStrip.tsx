import React from 'react';
import {
  Activity,
  Bot,
  FlaskConical,
  HardDriveDownload,
  Network,
  Server,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import { HudScorecardCard, HudScorecardTone } from '../../lib/hud-synthesis';
import { NavSectionId } from '../../lib/types';

interface ExecutiveScorecardStripProps {
  cards: HudScorecardCard[];
  onNavigate: (view: NavSectionId, tab?: string) => void;
  agentRibbon?: {
    modeLabel: string;
    detail: string;
    onOpenAgent: () => void;
  } | null;
}

const CARD_ICONS: Record<
  HudScorecardCard['id'],
  React.ComponentType<{ className?: string }>
> = {
  fleet: Activity,
  security: ShieldCheck,
  host: Server,
  network: Network,
  'pki-dr': HardDriveDownload,
  'smoke-compliance': FlaskConical,
};

function getToneStyles(tone: HudScorecardTone): {
  dot: string;
  headline: string;
  border: string;
} {
  switch (tone) {
    case 'critical':
      return {
        dot: 'bg-rose-500 animate-pulse',
        headline: 'text-rose-700 dark:text-rose-300',
        border: 'border-rose-500/50 hover:border-rose-500',
      };
    case 'warning':
      return {
        dot: 'bg-amber-500',
        headline: 'text-amber-700 dark:text-amber-300',
        border: 'border-amber-500/45 hover:border-amber-500',
      };
    case 'healthy':
      return {
        dot: 'bg-emerald-500',
        headline: 'text-emerald-700 dark:text-emerald-400',
        border: 'border-slate-200 dark:border-slate-800 hover:border-[var(--color-brand)]',
      };
    case 'syncing':
    case 'neutral':
    default:
      return {
        dot: 'bg-slate-400 dark:bg-slate-500',
        headline: 'text-slate-700 dark:text-slate-200',
        border: 'border-slate-200 dark:border-slate-800 hover:border-[var(--color-brand)]',
      };
  }
}

export const ExecutiveScorecardStrip: React.FC<ExecutiveScorecardStripProps> = ({
  cards,
  onNavigate,
  agentRibbon = null,
}) => {
  return (
    <section aria-label="6-Domain Executive System Posture Scorecard" className="space-y-3">
      {agentRibbon && (
        <div className="rounded-2xl border border-[var(--color-brand-ring)] bg-white dark:bg-slate-900 px-4 py-2 shadow-sm flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 text-xs">
            <Bot className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
            <span className="font-mono font-bold text-[var(--color-brand-text)] uppercase">
              {agentRibbon.modeLabel}
            </span>
            <span className="text-slate-600 dark:text-slate-300 truncate">{agentRibbon.detail}</span>
          </div>
          <button
            type="button"
            onClick={agentRibbon.onOpenAgent}
            className="btn-ghost text-xs px-2.5 py-1 min-h-[32px] flex items-center gap-1 whitespace-nowrap flex-shrink-0"
          >
            <span>Open AI Agent SRE</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {cards.map((card) => {
          const Icon = CARD_ICONS[card.id];
          const tone = getToneStyles(card.tone);
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onNavigate(card.targetView, card.targetTab)}
              className={`text-left rounded-2xl border bg-white dark:bg-slate-900 p-3.5 shadow-sm transition-colors cursor-pointer group flex flex-col justify-between gap-2 min-w-0 ${tone.border}`}
            >
              <div className="flex items-center justify-between gap-2 w-full">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">
                  {card.label}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`w-2 h-2 rounded-full ${tone.dot}`} />
                  <Icon className="w-3.5 h-3.5 text-slate-400 group-hover:text-[var(--color-brand-text)] transition-colors" />
                </div>
              </div>

              <div className="min-w-0 space-y-0.5">
                <div className={`text-base font-bold font-mono tabular-nums truncate ${tone.headline}`}>
                  {card.headline}
                </div>
                <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 truncate tabular-nums">
                  {card.subtext}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
};
