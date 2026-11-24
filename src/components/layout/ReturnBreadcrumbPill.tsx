import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { ReturnBreadcrumb } from '../../lib/types';

interface ReturnBreadcrumbPillProps {
  returnTo: ReturnBreadcrumb | null;
  onNavigateBack: () => void;
}

export const ReturnBreadcrumbPill: React.FC<ReturnBreadcrumbPillProps> = ({
  returnTo,
  onNavigateBack,
}) => {
  if (!returnTo) return null;

  return (
    <div className="px-6 pt-3 pb-0 max-w-[1920px] mx-auto w-full">
      <button
        type="button"
        onClick={onNavigateBack}
        className="inline-flex items-center gap-1.5 min-h-[32px] px-3 py-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[var(--color-brand)] text-xs font-mono text-slate-600 dark:text-slate-300 hover:text-[var(--color-brand-text)] transition-colors shadow-xs cursor-pointer"
        title={`Return to ${returnTo.label}`}
      >
        <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
        <span>Back to {returnTo.label}</span>
      </button>
    </div>
  );
};
