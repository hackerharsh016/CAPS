'use client';

/**
 * usePrintConfirmation Hook for CAPS Owner Dashboard.
 * Encapsulates:
 * - Single-flight asynchronous lock preventing concurrent requests (double-click safeguard)
 * - Cryptographic/UUID-based idempotency key generation per confirmation attempt
 * - Optimistic or verified queue update notifications
 * - Error reporting and toast/banner management
 */

import { useState, useCallback, useRef } from 'react';
import { confirmPrintJob, PrintConfirmationError } from '../confirmation-service';
import type { QueueItem } from '../../live-queue/types';
import type { PrintConfirmationResponse } from '../types';

export interface UsePrintConfirmationOptions {
  shopId: string;
  onSuccess?: ((response: PrintConfirmationResponse) => void) | undefined;
  onError?: ((error: Error) => void) | undefined;
}

export interface UsePrintConfirmationReturn {
  isConfirming: boolean;
  confirmingJobId: string | null;
  error: string | null;
  lastConfirmedJob: PrintConfirmationResponse | null;
  confirmJob: (
    jobId: string,
    currentQueue?: QueueItem[]
  ) => Promise<PrintConfirmationResponse | null>;
  clearError: () => void;
}

export function usePrintConfirmation({
  shopId,
  onSuccess,
  onError
}: UsePrintConfirmationOptions): UsePrintConfirmationReturn {
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmingJobId, setConfirmingJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastConfirmedJob, setLastConfirmedJob] = useState<PrintConfirmationResponse | null>(null);

  // Single-flight lock reference to prevent concurrent clicks in the same event tick
  const inFlightLockRef = useRef<boolean>(false);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const confirmJob = useCallback(
    async (
      jobId: string,
      currentQueue?: QueueItem[]
    ): Promise<PrintConfirmationResponse | null> => {
      // Prevent concurrent invocations (double-click guard)
      if (inFlightLockRef.current) {
        return null;
      }

      inFlightLockRef.current = true;
      setIsConfirming(true);
      setConfirmingJobId(jobId);
      setError(null);

      // Generate robust client idempotency key
      const idempotencyKey =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `confirm-${jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      try {
        const response = await confirmPrintJob(
          {
            jobId,
            shopId,
            idempotencyKey
          },
          currentQueue
        );

        setLastConfirmedJob(response);
        onSuccess?.(response);
        return response;
      } catch (err: unknown) {
        let errorMessage = 'An unexpected error occurred while confirming print job.';
        if (err instanceof PrintConfirmationError) {
          errorMessage = err.message;
        } else if (err instanceof Error) {
          errorMessage = err.message;
        }

        setError(errorMessage);
        if (onError && err instanceof Error) {
          onError(err);
        }
        return null;
      } finally {
        setIsConfirming(false);
        setConfirmingJobId(null);
        inFlightLockRef.current = false;
      }
    },
    [shopId, onSuccess, onError]
  );

  return {
    isConfirming,
    confirmingJobId,
    error,
    lastConfirmedJob,
    confirmJob,
    clearError
  };
}
