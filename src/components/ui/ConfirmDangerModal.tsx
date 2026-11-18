import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { BottomSheetModal, ConfirmModal } from '@lagosr/panorama-ui-kit';

interface ConfirmDangerModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmWord?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isProcessing?: boolean;
}

export const ConfirmDangerModal: React.FC<ConfirmDangerModalProps> = ({
  isOpen,
  title,
  description,
  confirmWord,
  confirmLabel = 'Execute Destruction',
  onConfirm,
  onCancel,
  isProcessing = false,
}) => {
  const [inputWord, setInputWord] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setInputWord('');
    }
  }, [isOpen]);

  if (!confirmWord) {
    return (
      <ConfirmModal
        isOpen={isOpen}
        title={title}
        message={description}
        confirmText={isProcessing ? 'Processing...' : confirmLabel}
        variant="danger"
        isLoading={isProcessing}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
  }

  const isConfirmed = inputWord.trim().toUpperCase() === confirmWord.toUpperCase();

  return (
    <BottomSheetModal
      isOpen={isOpen}
      onClose={onCancel}
      closeDisabled={isProcessing}
      title={title}
      icon={<AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />}
      maxWidthClass="max-w-md"
      footer={
        <div className="flex items-center justify-end gap-3 w-full">
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className="btn-secondary text-xs sm:text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!isConfirmed || isProcessing}
            className="btn-danger text-xs sm:text-sm"
          >
            {isProcessing ? 'Processing...' : confirmLabel}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{description}</p>
        <div>
          <label
            htmlFor="confirm-danger-word-input"
            className="block text-xs font-mono text-slate-600 dark:text-slate-400 mb-1.5"
          >
            Type <span className="text-rose-700 dark:text-rose-400 font-bold">{confirmWord}</span> to confirm:
          </label>
          <input
            id="confirm-danger-word-input"
            type="text"
            value={inputWord}
            onChange={(e) => setInputWord(e.target.value)}
            disabled={isProcessing}
            placeholder={confirmWord}
            className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-danger,#be123c)] transition-colors"
          />
        </div>
      </div>
    </BottomSheetModal>
  );
};
