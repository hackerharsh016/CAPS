'use client';

/**
 * ConfirmPrintButton Component.
 * One-tap confirmation button with built-in:
 * - In-flight disabled states and loading spinner
 * - Double-click / spam prevention
 * - Non-head queue position disablement with accessible tooltips
 */

import React from 'react';

export interface ConfirmPrintButtonProps {
  jobId: string;
  isNextInQueue: boolean;
  isExecuting?: boolean | undefined;
  isConfirming?: boolean | undefined;
  onConfirm: (jobId: string) => Promise<void> | void;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

export function ConfirmPrintButton({
  jobId,
  isNextInQueue,
  isExecuting = false,
  isConfirming = false,
  onConfirm,
  disabled = false,
  className = ''
}: ConfirmPrintButtonProps) {
  const isDisabled = disabled || isConfirming || isExecuting || !isNextInQueue;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (isDisabled) return;
    void onConfirm(jobId);
  };

  if (isExecuting) {
    return (
      <button
        type="button"
        disabled
        aria-label="Job is currently printing"
        className={`inline-flex items-center space-x-1.5 rounded-lg bg-emerald-100 px-4 py-2 text-xs font-semibold text-emerald-800 cursor-default ${className}`}
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-600" />
        <span>Spooling / Printing</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={handleClick}
      aria-busy={isConfirming}
      aria-label={
        isConfirming
          ? 'Confirming print job...'
          : !isNextInQueue
            ? 'Cannot confirm out of order. Wait for preceding jobs.'
            : 'Confirm & Print next job'
      }
      title={!isNextInQueue ? 'Priority rule: Must confirm earlier waiting jobs first' : undefined}
      className={`inline-flex items-center justify-center space-x-1.5 rounded-lg px-5 py-2 text-xs font-bold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${
        isDisabled
          ? 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-60'
          : 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95'
      } ${className}`}
    >
      {isConfirming && (
        <svg
          className="h-3.5 w-3.5 animate-spin text-white"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
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
      <span>{isConfirming ? 'Confirming...' : 'Confirm & Print'}</span>
    </button>
  );
}
