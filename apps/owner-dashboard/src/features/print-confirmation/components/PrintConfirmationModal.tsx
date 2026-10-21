'use client';

/**
 * PrintConfirmationModal Component.
 * Optional verification modal for single-tap or explicit approval confirmation.
 * Shows order details, priority tier, page counts, price, and clear actions.
 */

import React from 'react';
import type { QueueItem } from '../../live-queue/types';

export interface PrintConfirmationModalProps {
  isOpen: boolean;
  item: QueueItem | null;
  isConfirming: boolean;
  onClose: () => void;
  onConfirm: (jobId: string) => Promise<void> | void;
}

export function PrintConfirmationModal({
  isOpen,
  item,
  isConfirming,
  onClose,
  onConfirm
}: PrintConfirmationModalProps) {
  if (!isOpen || !item) return null;

  const formattedPrice = (item.price_total_paise / 100).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR'
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-print-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 id="confirm-print-title" className="text-base font-bold text-slate-900">
            Confirm Print Job Dispatch
          </h3>
          <button
            type="button"
            disabled={isConfirming}
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:text-slate-600 focus:outline-none"
            aria-label="Close confirmation dialog"
          >
            ✕
          </button>
        </div>

        {/* Modal Body / Job Specs */}
        <div className="space-y-3 text-sm text-slate-600">
          <div className="rounded-lg bg-slate-50 p-3 space-y-1.5 border border-slate-100">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-700">Token / Job ID:</span>
              <span className="font-mono font-bold text-slate-900">{item.id}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-700">Customer:</span>
              <span>{item.customer_name}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-700">Priority Tier:</span>
              <span
                className={`font-bold uppercase ${
                  item.priority_tier === 'urgent' ? 'text-rose-600' : 'text-slate-700'
                }`}
              >
                {item.priority_tier === 'urgent' ? 'Urgent (+₹50)' : 'Flexible FIFO'}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-700">Specifications:</span>
              <span>
                {item.settings.paper_size} • {item.settings.color_mode} • {item.settings.copies}{' '}
                copy
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-700">Total Price:</span>
              <span className="font-bold text-emerald-700">{formattedPrice}</span>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Clicking <strong>Authorize Print</strong> marks this job approved. The local Raspberry
            Pi / PC print agent will immediately lease and spool this job to the physical printer.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            disabled={isConfirming}
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isConfirming}
            onClick={() => void onConfirm(item.id)}
            className="inline-flex items-center space-x-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {isConfirming && (
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
            <span>{isConfirming ? 'Authorizing...' : 'Authorize Print'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
