import React, { useEffect, useRef, useState } from 'react';
import { BellOff, ChevronDown } from 'lucide-react';

interface SnoozeSplitButtonProps {
  onSnooze: (days: number) => void;
  disabled?: boolean;
  defaultDays?: number;
  presets?: number[];
  targetLabel?: string;
}

const DEFAULT_PRESETS = [7, 14, 30, 60, 90];

export const SnoozeSplitButton: React.FC<SnoozeSplitButtonProps> = ({
  onSnooze,
  disabled = false,
  defaultDays = 7,
  presets = DEFAULT_PRESETS,
  targetLabel = 'this threat actor',
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const handleSelectDays = (days: number) => {
    setOpen(false);
    onSnooze(days);
  };

  return (
    <div ref={containerRef} className="relative inline-flex items-stretch flex-shrink-0">
      <div className="inline-flex items-stretch rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleSelectDays(defaultDays)}
            className="px-3 min-h-[36px] text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 cursor-pointer disabled:opacity-50"
            title={
              targetLabel === 'this threat actor'
                ? `Snooze this threat actor for ${defaultDays} days (quiets repeat alerts unless an origin 200 breach occurs)`
                : `Snooze ${targetLabel} for ${defaultDays} days`
            }
          >
          <BellOff className="w-3.5 h-3.5 shrink-0" />
          <span className="tabular-nums">Snooze {defaultDays}d</span>
        </button>
        <div className="w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Choose snooze duration"
          onClick={() => setOpen((prev) => !prev)}
          className="px-2 min-h-[36px] min-w-[32px] text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center flex-shrink-0 cursor-pointer disabled:opacity-50"
          title="Pick snooze duration (7, 14, 30, 60, or 90 days)"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-48 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-1.5 z-40 space-y-0.5"
        >
          {presets.map((days) => (
            <button
              key={days}
              type="button"
              role="menuitem"
              onClick={() => handleSelectDays(days)}
              className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center justify-between gap-2 cursor-pointer whitespace-nowrap"
            >
              <span className="tabular-nums">Snooze {days} days</span>
              {days === defaultDays && (
                <span className="text-[10px] font-mono text-[var(--color-brand-text)]">Default</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
