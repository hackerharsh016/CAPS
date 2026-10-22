'use client';

/**
 * Owner Dashboard Queue Action Buttons Component (INT-D2-03).
 *
 * Implements:
 * - 1-Click Print Approval wired to `POST /api/v1/shops/:shopId/jobs/:jobId/approve`.
 * - Instant single-click disablement and debounced double-click prevention.
 * - Optimistic local state update transitioning row to `QUEUED`.
 * - Automatic rollback and toast alert notification on network or server failure.
 */

import React, { useState, useRef, useCallback } from 'react';
import type { QueueItem, CanonicalJobStatus } from '../../types/queue';
import { QueueService } from '../../services/api/queue.service';

export interface ToastNotification {
  type: 'success' | 'error' | 'info';
  message: string;
}

export interface QueueActionButtonsProps {
  job: QueueItem;
  shopId: string;
  queueService?: QueueService | undefined;
  onApproveSuccess?: ((updatedJob: QueueItem) => void) | undefined;
  onOptimisticUpdate?: ((jobId: string, optimisticStatus: CanonicalJobStatus) => void) | undefined;
  onRollback?: ((jobId: string, originalStatus: CanonicalJobStatus) => void) | undefined;
  onError?: ((error: Error) => void) | undefined;
  debounceMs?: number | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

export function QueueActionButtons({
  job,
  shopId,
  queueService,
  onApproveSuccess,
  onOptimisticUpdate,
  onRollback,
  onError,
  debounceMs = 600,
  disabled = false,
  className = ''
}: QueueActionButtonsProps) {
  const service = useRef<QueueService>(queueService || new QueueService());
  const [currentStatus, setCurrentStatus] = useState<CanonicalJobStatus>(job.status);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastNotification | null>(null);

  // Lock ref for strict synchronous double-click / debounce protection
  const isLockedRef = useRef<boolean>(false);

  // Sync state if job.status prop changes from external sources (e.g. WebSocket realtime)
  React.useEffect(() => {
    setCurrentStatus(job.status);
  }, [job.status]);

  const handleApprove = useCallback(async () => {
    // 1. Double-click debounce guard: reject if already locked or in flight
    if (isLockedRef.current || isApproving || disabled) {
      return;
    }

    // Lock immediately
    isLockedRef.current = true;
    setIsApproving(true);
    setToast(null);

    const originalStatus = currentStatus;
    const optimisticStatus: CanonicalJobStatus = 'QUEUED';

    // 2. Optimistic UI update: advance local row state to QUEUED immediately
    setCurrentStatus(optimisticStatus);
    onOptimisticUpdate?.(job.id, optimisticStatus);

    try {
      // 3. Send authorization-backed approval request to Cloud API
      const response = await service.current.approveJob(shopId, job.id);

      if (response.success && response.job) {
        setCurrentStatus(response.job.status);
        onApproveSuccess?.(response.job);
        setToast({
          type: 'success',
          message: `Job #${job.id.slice(0, 8)} approved and queued for printing.`
        });
      } else {
        throw new Error(response.message || 'Approval response not acknowledged.');
      }
    } catch (err: unknown) {
      // 4. Rollback optimistic state on failure
      const errorObj = err instanceof Error ? err : new Error('Failed to approve print job.');
      setCurrentStatus(originalStatus);
      onRollback?.(job.id, originalStatus);
      onError?.(errorObj);

      setToast({
        type: 'error',
        message: `Approval failed: ${errorObj.message}`
      });
    } finally {
      setIsApproving(false);
      // Release debounce lock after debounceMs to prevent rapid duplicate clicks
      setTimeout(() => {
        isLockedRef.current = false;
      }, debounceMs);
    }
  }, [
    isApproving,
    disabled,
    currentStatus,
    job.id,
    shopId,
    onOptimisticUpdate,
    onApproveSuccess,
    onRollback,
    onError,
    debounceMs
  ]);

  const isApprovable = currentStatus === 'SUBMITTED' || currentStatus === 'OWNER_CONFIRMED';
  const isQueued = currentStatus === 'QUEUED';
  const isPrinting = currentStatus === 'PRINTING';

  return (
    <div className={`inline-flex flex-col items-end gap-1.5 ${className}`}>
      <div className="flex items-center gap-2">
        {isApprovable && (
          <button
            type="button"
            onClick={handleApprove}
            disabled={isApproving || disabled}
            data-testid="approve-print-btn"
            data-job-id={job.id}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-blue-300 disabled:cursor-not-allowed rounded-lg shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer"
          >
            {isApproving ? (
              <>
                <svg
                  className="animate-spin -ml-0.5 h-3.5 w-3.5 text-white"
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
                <span>Approving...</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>Approve & Print</span>
              </>
            )}
          </button>
        )}

        {isQueued && (
          <span
            data-testid="queued-status-badge"
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Queued for Agent
          </span>
        )}

        {isPrinting && (
          <span
            data-testid="printing-status-badge"
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 rounded-lg"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
            Printing Live
          </span>
        )}
      </div>

      {/* Toast Notification Alert */}
      {toast && (
        <div
          role="alert"
          data-testid="action-toast-alert"
          className={`text-[11px] font-medium px-2 py-1 rounded-md flex items-center gap-1.5 animate-in fade-in duration-150 ${
            toast.type === 'error'
              ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
          }`}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="ml-1 text-slate-400 hover:text-slate-600 font-bold"
            aria-label="Dismiss notification"
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
}

export default QueueActionButtons;
