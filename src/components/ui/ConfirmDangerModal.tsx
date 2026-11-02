import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

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
  const [inputWord, setInputWord] = React.useState('');

  if (!isOpen) return null;

  const isConfirmed = confirmWord ? inputWord.trim().toUpperCase() === confirmWord.toUpperCase() : true;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-red-500/30 rounded-xl shadow-2xl p-6 relative">
        <button
          onClick={onCancel}
          disabled={isProcessing}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 text-red-400 mb-4">
          <div className="p-2 bg-red-500/10 rounded-lg">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
        </div>

        <p className="text-sm text-slate-300 mb-4">{description}</p>

        {confirmWord && (
          <div className="mb-4">
            <label className="block text-xs font-mono text-slate-400 mb-1">
              Type <span className="text-red-400 font-bold">{confirmWord}</span> to confirm:
            </label>
            <input
              type="text"
              value={inputWord}
              onChange={(e) => setInputWord(e.target.value)}
              disabled={isProcessing}
              placeholder={confirmWord}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 font-mono focus:border-red-500 focus:outline-none"
            />
          </div>
        )}

        <div className="flex justify-end space-x-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className="px-4 py-2 text-sm bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!isConfirmed || isProcessing}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            {isProcessing ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
