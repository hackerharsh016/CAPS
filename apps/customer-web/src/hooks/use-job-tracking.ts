'use client';

/**
 * useJobTracking Hook for CAPS Customer Web (INT-D1-02).
 *
 * Coordinates live job status updates over Supabase Realtime channel `caps:job:<jobId>`:
 * - Subscribes to Realtime status broadcasts (`SUBMITTED` -> `QUEUED` -> `PRINTING` -> `COMPLETED`).
 * - Advances progress stepper (steps 0..3) in real-time as agent reports status.
 * - Recalculates estimated minutes remaining and estimated pickup time dynamically.
 * - Automatically falls back to 10-second periodic polling if connection is interrupted.
 * - Cleans up listeners and channels on unmount.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  RealtimeTrackingClient,
  normalizeCanonicalStatus,
  getTrackingStepIndex,
  calculateEstimatedMinutes,
  type CanonicalJobStatus,
  type RealtimeConnectionState,
  type JobStatusBroadcastPayload
} from '../services/realtime/tracking-client';

export interface UseJobTrackingOptions {
  jobId: string;
  customerId?: string | undefined;
  initialStatus?: CanonicalJobStatus | string | undefined;
  initialTotalPages?: number | undefined;
  enablePollingFallback?: boolean | undefined;
  pollingIntervalMs?: number | undefined; // 10 seconds
  customClient?: RealtimeTrackingClient | undefined;
  onStatusChange?: ((status: CanonicalJobStatus, payload: JobStatusBroadcastPayload) => void) | undefined;
  onPoll?: (() => Promise<void> | void) | undefined;
}

export interface TrackingStepMeta {
  id: string;
  name: string;
  description: string;
  stepIndex: number;
}

export const TRACKING_STEPS: TrackingStepMeta[] = [
  { id: 'submitted', name: 'Order Submitted', description: 'Document uploaded & verified', stepIndex: 0 },
  { id: 'queued', name: 'In Queue', description: 'Queued at shop printer station', stepIndex: 1 },
  { id: 'printing', name: 'Printing', description: 'Actively printing on hardware', stepIndex: 2 },
  { id: 'ready', name: 'Ready for Pickup', description: 'Completed and ready at counter', stepIndex: 3 }
];

export interface UseJobTrackingResult {
  jobId: string;
  status: CanonicalJobStatus;
  currentStep: number;
  steps: TrackingStepMeta[];
  estimatedMinutesRemaining: number;
  estimatedPickupAt: string | null;
  pagesPrinted: number;
  totalPages: number;
  connectionState: RealtimeConnectionState;
  isConnected: boolean;
  isPolling: boolean;
  lastUpdated: Date;
  refresh: () => Promise<void>;
  realtimeClient: RealtimeTrackingClient | null;
}

/**
 * Live WebSocket Connection Status Badge for Customer Order Tracking (INT-D1-02).
 */
export function TrackingConnectionBadge({
  status,
  className = ''
}: {
  status: RealtimeConnectionState;
  className?: string;
}): React.JSX.Element {
  const isConnected = status === 'connected';
  const isPolling = status === 'polling' || status === 'reconnecting';

  return React.createElement(
    'div',
    {
      'data-testid': 'tracking-connection-badge',
      className: `inline-flex items-center gap-2 text-xs font-medium px-2.5 py-1 rounded-full border ${
        isConnected
          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
          : isPolling
            ? 'bg-amber-50 text-amber-800 border-amber-200'
            : 'bg-zinc-50 text-zinc-600 border-zinc-200'
      } ${className}`
    },
    React.createElement(
      'span',
      { className: 'relative flex h-2 w-2' },
      isConnected &&
        React.createElement('span', {
          className: 'animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75'
        }),
      React.createElement('span', {
        className: `relative inline-flex rounded-full h-2 w-2 ${
          isConnected
            ? 'bg-emerald-500'
            : isPolling
              ? 'bg-amber-500 animate-pulse'
              : 'bg-zinc-400'
        }`
      })
    ),
    React.createElement(
      'span',
      null,
      isConnected ? 'Live Updates Active' : isPolling ? '10s Polling Fallback' : 'Offline'
    )
  );
}

export function useJobTracking(
  optionsOrJobId: UseJobTrackingOptions | string
): UseJobTrackingResult {
  const options: UseJobTrackingOptions =
    typeof optionsOrJobId === 'string' ? { jobId: optionsOrJobId } : optionsOrJobId;

  const jobId = options.jobId;
  const customerId = options.customerId;
  const initialCanonical = normalizeCanonicalStatus(options.initialStatus || 'SUBMITTED');
  const initialPages = options.initialTotalPages ?? 1;

  const [status, setStatus] = useState<CanonicalJobStatus>(initialCanonical);
  const [currentStep, setCurrentStep] = useState<number>(getTrackingStepIndex(initialCanonical));
  const [totalPages, setTotalPages] = useState<number>(initialPages);
  const [pagesPrinted, setPagesPrinted] = useState<number>(0);
  const [estimatedMinutesRemaining, setEstimatedMinutesRemaining] = useState<number>(() =>
    calculateEstimatedMinutes(initialCanonical, initialPages)
  );
  const [estimatedPickupAt, setEstimatedPickupAt] = useState<string | null>(() => {
    const mins = calculateEstimatedMinutes(initialCanonical, initialPages);
    return mins > 0 ? new Date(Date.now() + mins * 60000).toISOString() : null;
  });
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('disconnected');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const clientRef = useRef<RealtimeTrackingClient | null>(null);

  const handleStatusUpdate = useCallback(
    (newStatus: CanonicalJobStatus, payload: JobStatusBroadcastPayload) => {
      setStatus(newStatus);
      setCurrentStep(getTrackingStepIndex(newStatus));

      if (payload.totalPages !== undefined) {
        setTotalPages(payload.totalPages);
      }
      if (payload.pagesPrinted !== undefined) {
        setPagesPrinted(payload.pagesPrinted);
      }
      if (payload.estimatedMinutesRemaining !== undefined && payload.estimatedMinutesRemaining !== null) {
        setEstimatedMinutesRemaining(payload.estimatedMinutesRemaining);
      } else {
        const mins = calculateEstimatedMinutes(newStatus, payload.totalPages || totalPages);
        setEstimatedMinutesRemaining(mins);
      }

      if (payload.estimatedPickupAt !== undefined) {
        setEstimatedPickupAt(payload.estimatedPickupAt);
      } else if (newStatus === 'COMPLETED') {
        setEstimatedPickupAt(null);
      }

      setLastUpdated(new Date());

      if (options.onStatusChange) {
        options.onStatusChange(newStatus, payload);
      }
    },
    [totalPages, options]
  );

  const refresh = useCallback(async () => {
    if (options.onPoll) {
      await options.onPoll();
    }
    setLastUpdated(new Date());
  }, [options]);

  useEffect(() => {
    if (!jobId) return;

    const client =
      options.customClient ||
      new RealtimeTrackingClient({
        jobId,
        customerId,
        enableFallbackPolling: options.enablePollingFallback ?? true,
        pollingIntervalMs: options.pollingIntervalMs ?? 10000, // 10s fallback
        onPoll: refresh
      });

    clientRef.current = client;

    // 1. Connection status change listener
    const unsubState = client.onConnectionStateChange(state => {
      setConnectionState(state);
    });

    // 2. Realtime status transition listener
    const unsubStatus = client.onStatusChange((newStatus, payload) => {
      handleStatusUpdate(newStatus, payload);
    });

    // 3. Connect & subscribe to caps:job:<jobId>
    client.subscribe();

    return () => {
      unsubState();
      unsubStatus();
      client.unsubscribe();
      clientRef.current = null;
    };
  }, [jobId, customerId, options.customClient, options.enablePollingFallback, options.pollingIntervalMs, refresh, handleStatusUpdate]);

  return {
    jobId,
    status,
    currentStep,
    steps: TRACKING_STEPS,
    estimatedMinutesRemaining,
    estimatedPickupAt,
    pagesPrinted,
    totalPages,
    connectionState,
    isConnected: connectionState === 'connected',
    isPolling: connectionState === 'polling' || connectionState === 'reconnecting',
    lastUpdated,
    refresh,
    realtimeClient: clientRef.current
  };
}
