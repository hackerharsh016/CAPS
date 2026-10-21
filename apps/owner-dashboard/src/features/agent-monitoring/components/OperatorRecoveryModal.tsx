'use client';

/**
 * OperatorRecoveryModal Component.
 * Operator modal for resolving ambiguous/uncertain print outcomes (requires_review / failed).
 * Invariant: Unknown/ambiguous print execution must NEVER auto-reprint.
 * Mandatory check for physical paper output before approving retry or completion.
 */

import React, { useState } from 'react';
import type { QueueItem } from '../../live-queue/types';
import type { AmbiguousOutcomeResolution } from '../types';

export interface OperatorRecoveryModalProps {
  isOpen: boolean;
  item: QueueItem | null;
  isResolving: boolean;
  onClose: () => void;
  onResolve: (
    jobId: string,
    resolution: AmbiguousOutcomeResolution,
    evidenceConfirmed: boolean,
    notes?: string
  ) => Promise<void> | void;
}

export function OperatorRecoveryModal({
  isOpen,
  item,
  isResolving,
  onClose,
  onResolve
}: OperatorRecoveryModalProps) {
  const [resolution, setResolution] = useState<AmbiguousOutcomeResolution>('retry');
  const [evidenceConfirmed, setEvidenceConfirmed] = useState(false);
  const [notes, setNotes] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!isOpen || !item) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    // Enforce physical paper inspection for retry / mark_completed
    if ((resolution === 'retry' || resolution === 'mark_completed') && !evidenceConfirmed) {
      setValidationError(
        'Physical paper output verification is required. You must inspect the printer output tray before approving retry or completion.'
      );
      return;
    }

    await onResolve(item.id, resolution, evidenceConfirmed, notes);
  };

  const formattedPrice = (item.price_total_paise / 100).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR'
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-modal-title"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-5">
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-3">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-amber-500 text-lg" aria-hidden="true">⚠️</span>
              <h3 id="recovery-modal-title" className="text-base font-bold text-slate-900">
                Operator Review & Incident Recovery
              </h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Uncertain execution outcome detected. Resolve stalled or ambiguous print attempt.
            </p>
          </div>
          <button
            type="button"
            disabled={isResolving}
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:text-slate-600 focus:outline-none"
            aria-label="Close recovery dialog"
          >
            ✕
          </button>
        </div>

        {/* Job Details Card */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-slate-600">Job ID / Token:</span>
            <span className="font-mono font-bold text-slate-900">{item.id}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-semibold text-slate-600">Customer:</span>
            <span className="text-slate-800 font-medium">{item.customer_name}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-semibold text-slate-600">Assigned Printer:</span>
            <span className="text-slate-800">{item.printer_name || 'Default Hardware'}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-semibold text-slate-600">Document & Pages:</span>
            <span className="text-slate-800">
              {item.document_name || 'Document.pdf'} ({item.settings.copies}x, {item.settings.color_mode})
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-semibold text-slate-600">Amount / Status:</span>
            <span className="font-bold text-slate-900">
              {formattedPrice} • <span className="text-amber-700 capitalize">{item.status.replace('_', ' ')}</span>
            </span>
          </div>
        </div>

        {/* Form Controls */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Resolution Options */}
          <div>
            <label className="block font-bold text-slate-800 mb-2">
              Select Operator Recovery Action:
            </label>
            <div className="space-y-2">
              <label
                className={`flex items-start p-3 rounded-lg border cursor-pointer transition-colors ${
                  resolution === 'retry'
                    ? 'border-emerald-600 bg-emerald-50/50'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="resolution"
                  value="retry"
                  checked={resolution === 'retry'}
                  onChange={() => setResolution('retry')}
                  className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                />
                <div className="ml-3">
                  <span className="font-bold text-slate-900">Authorize Controlled Re-Print</span>
                  <p className="mt-0.5 text-slate-500">
                    Resets job to 'approved'. The local agent will re-claim and send to printer.
                  </p>
                </div>
              </label>

              <label
                className={`flex items-start p-3 rounded-lg border cursor-pointer transition-colors ${
                  resolution === 'mark_completed'
                    ? 'border-blue-600 bg-blue-50/50'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="resolution"
                  value="mark_completed"
                  checked={resolution === 'mark_completed'}
                  onChange={() => setResolution('mark_completed')}
                  className="mt-0.5 text-blue-600 focus:ring-blue-500"
                />
                <div className="ml-3">
                  <span className="font-bold text-slate-900">Mark Completed (Physical Verified)</span>
                  <p className="mt-0.5 text-slate-500">
                    Spooler finished and sheets physically printed successfully. Closes job.
                  </p>
                </div>
              </label>

              <label
                className={`flex items-start p-3 rounded-lg border cursor-pointer transition-colors ${
                  resolution === 'cancel'
                    ? 'border-rose-600 bg-rose-50/50'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="resolution"
                  value="cancel"
                  checked={resolution === 'cancel'}
                  onChange={() => setResolution('cancel')}
                  className="mt-0.5 text-rose-600 focus:ring-rose-500"
                />
                <div className="ml-3">
                  <span className="font-bold text-slate-900">Cancel Job (Refund / Abort)</span>
                  <p className="mt-0.5 text-slate-500">
                    Job unrecoverable due to damaged hardware/file error. Initiates customer notification.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Physical Verification Guardrail */}
          {(resolution === 'retry' || resolution === 'mark_completed') && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 space-y-2">
              <label className="flex items-start cursor-pointer">
                <input
                  type="checkbox"
                  checked={evidenceConfirmed}
                  onChange={e => {
                    setEvidenceConfirmed(e.target.checked);
                    if (e.target.checked) setValidationError(null);
                  }}
                  className="mt-0.5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                  aria-describedby="evidence-help"
                />
                <div className="ml-2.5">
                  <span className="font-bold text-amber-900">
                    Physical Evidence Verified (Mandatory)
                  </span>
                  <p id="evidence-help" className="mt-0.5 text-[11px] text-amber-800">
                    I have physically inspected the printer paper output tray and confirm whether
                    pages were printed or jammed.
                  </p>
                </div>
              </label>
            </div>
          )}

          {/* Operator Notes */}
          <div>
            <label htmlFor="recovery-notes" className="block font-semibold text-slate-700 mb-1">
              Operator Incident Notes (Audit Log):
            </label>
            <textarea
              id="recovery-notes"
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Cleared paper jam in Tray 1; pages 1-4 completed, reprinting full set..."
              className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Error Message */}
          {validationError && (
            <div
              role="alert"
              className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs font-semibold text-rose-800"
            >
              {validationError}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              disabled={isResolving}
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Dismiss
            </button>
            <button
              type="submit"
              disabled={isResolving}
              className="inline-flex items-center space-x-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {isResolving && (
                <svg
                  className="h-3.5 w-3.5 animate-spin text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              )}
              <span>{isResolving ? 'Resolving...' : 'Confirm Action'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
