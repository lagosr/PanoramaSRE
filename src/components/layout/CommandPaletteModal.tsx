import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, X, CornerDownLeft, Terminal, GitBranch, Shield, Layers } from 'lucide-react';

export interface CommandPaletteEntry {
  id: string;
  kind: string;
  label: string;
  hint?: string;
  keywords?: string;
  category: 'view' | 'app' | 'invariant' | 'action' | 'console';
  onExecute: () => void;
}

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: CommandPaletteEntry[];
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  onClose,
  entries,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      const timer = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.slice(0, 14);
    return entries
      .filter((entry) => {
        const haystack = `${entry.label} ${entry.kind} ${entry.hint || ''} ${entry.keywords || ''}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 16);
  }, [entries, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (filtered.length > 0 ? (prev + 1) % filtered.length : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filtered.length > 0 ? (prev - 1 + filtered.length) % filtered.length : 0
      );
      return;
    }
    if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      filtered[selectedIndex].onExecute();
      onClose();
    }
  };

  const renderIcon = (cat: CommandPaletteEntry['category']) => {
    switch (cat) {
      case 'app':
        return <GitBranch className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />;
      case 'invariant':
        return <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />;
      case 'console':
      case 'action':
        return <Terminal className="w-4 h-4 text-[var(--color-accent-text)] shrink-0" />;
      default:
        return <Layers className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-slate-900/80 backdrop-blur-sm flex items-start justify-center pt-16 sm:pt-20 px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Global Command Palette"
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
          <Search className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to view, deploy app, inspect SEC-01..09, toggle console, or trigger SRE action..."
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[10px] text-slate-600 dark:text-slate-300 cursor-pointer"
          >
            ESC
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Command Palette"
            className="p-1 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400 font-mono">
              No matching views, fleet targets, invariants, or commands.
            </div>
          ) : (
            filtered.map((entry, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    entry.onExecute();
                    onClose();
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--color-brand-subtle)] border border-[var(--color-brand-ring)] text-slate-900 dark:text-slate-100'
                      : 'border border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/70 text-slate-800 dark:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {renderIcon(entry.category)}
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">{entry.label}</div>
                      {entry.hint && (
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                          {entry.hint}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[10px] text-slate-600 dark:text-slate-300 uppercase">
                      {entry.kind}
                    </span>
                    {isSelected && (
                      <CornerDownLeft className="w-3.5 h-3.5 text-[var(--color-brand-text)]" />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400">
          <span>↑↓ Navigate • Enter Run • Esc Close</span>
          <span>Global Toggle Console: Ctrl+`</span>
        </div>
      </div>
    </div>
  );
};
