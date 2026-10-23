'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { JobTrackingInfo } from './types';
import type { RealtimeConnectionState } from './realtime-types';
import { RealtimeTrackingClient } from './realtime-tracking-client';
import { defaultQueueTrackingService } from './queue-tracking-service';

export interface UseRealtimeTrackingProps {
  jobId: string;
  customerId: string;
  initialTracking?: JobTrackingInfo | undefined;
  enabled?: boolean | undefined;
}

export interface UseRealtimeTrackingResult {
  tracking: JobTrackingInfo | null;
  connectionState: RealtimeConnectionState;
  isRefreshing: boolean;
  lastUpdated: Date;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useRealtimeTracking({
  jobId,
  customerId,
  initialTracking,
  enabled = true
}: UseRealtimeTrackingProps): UseRealtimeTrackingResult {
  const [tracking, setTracking] = useState<JobTrackingInfo | null>(initialTracking || null);
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('connecting');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<RealtimeTrackingClient | null>(null);

  // Authoritative fetch function
  const refresh = useCallback(async () => {
    if (!jobId || !customerId) return;
    setIsRefreshing(true);
    try {
      const updated = await defaultQueueTrackingService.getJobTracking(jobId, customerId);
      setTracking(updated);
      setLastUpdated(new Date());
      setError(null);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to fetch updated tracking information.';
      setError(message);
    } finally {
      setIsRefreshing(false);
    }
  }, [jobId, customerId]);

  useEffect(() => {
    if (initialTracking) {
      setTracking(initialTracking);
    }
  }, [initialTracking]);

  // Active realtime polling heartbeat to guarantee live queue and status updates
  useEffect(() => {
    if (!enabled || !jobId || !customerId) return;
    const interval = setInterval(() => {
      refresh();
    }, 4000);
    return () => clearInterval(interval);
  }, [enabled, jobId, customerId, refresh]);

  useEffect(() => {
    if (!enabled || !jobId || !customerId) {
      setConnectionState('disconnected');
      return;
    }

    // 1. Instantiate tenant-scoped client
    const client = new RealtimeTrackingClient({
      jobId,
      customerId,
      enableFallbackPolling: true,
      pollingIntervalMs: 8000,
      reconnectDelayMs: 2500
    });
    clientRef.current = client;

    // 2. State change listener
    const unsubscribeState = client.onStateChange(state => {
      setConnectionState(state);
    });

    // 3. Wake-up listener (Policy #5: treats events as triggers to fetch authoritative state)
    const unsubscribeWakeup = client.onWakeup(() => {
      refresh();
    });

    // 4. Error listener
    const unsubscribeError = client.onError(err => {
      console.warn('[RealtimeTracking] Error received:', err.message);
    });

    // 5. Connect
    client.subscribe();

    // 6. Subscription Teardown Invariant
    return () => {
      unsubscribeState();
      unsubscribeWakeup();
      unsubscribeError();
      client.unsubscribe();
      clientRef.current = null;
    };
  }, [enabled, jobId, customerId, refresh]);

  return {
    tracking,
    connectionState,
    isRefreshing,
    lastUpdated,
    error,
    refresh
  };
}
