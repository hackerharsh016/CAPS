'use client';

/**
 * useQueue Hook for CAPS Shop Owner Dashboard (INT-D2-02).
 *
 * Coordinates REST API queue fetching with live Supabase Realtime subscriptions:
 * - Subscribes to channel `caps:shop:<shopId>` on print_jobs (INSERT, UPDATE).
 * - Delivers new customer submissions to the queue list in < 500ms.
 * - Reflects agent status transitions (PRINTING, COMPLETED) live without page reload.
 * - Updates local state and React Query / SWR cache immediately on event arrival.
 * - Provides live connection indicator (green pulsing dot) for WebSocket health.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { QueueItem, QueueFilter, CanonicalJobStatus } from '../types/queue';
import { QueueService } from '../services/api/queue.service';
import {
  RealtimeQueueClient,
  type RealtimeConnectionState
} from '../services/realtime/queue-client';

export interface UseQueueOptions {
  shopId?: string | undefined;
  initialFilter?: QueueFilter | undefined;
  queueService?: QueueService | undefined;
  realtimeClient?: RealtimeQueueClient | undefined;
  autoSubscribe?: boolean | undefined;
  onCacheUpdate?: ((updater: (prev: QueueItem[]) => QueueItem[]) => void) | undefined;
}

export interface UseQueueResult {
  queue: QueueItem[];
  filteredQueue: QueueItem[];
  filter: QueueFilter;
  setFilter: (filter: QueueFilter) => void;
  counts: Record<QueueFilter, number>;
  connectionState: RealtimeConnectionState;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  approveJob: (jobId: string) => Promise<boolean>;
  realtimeClient: RealtimeQueueClient | null;
}

/**
 * Visual WebSocket Connection Health Indicator Component (Step 4).
 * Shows green pulsating dot when connected, amber when connecting, zinc when disconnected.
 */
export function LiveConnectionIndicator({
  status,
  className = ''
}: {
  status: RealtimeConnectionState;
  className?: string;
}): React.JSX.Element {
  const isConnected = status === 'connected';
  const isPending = status === 'connecting' || status === 'reconnecting';

  return React.createElement(
    'div',
    {
      'data-testid': 'live-connection-indicator',
      className: `inline-flex items-center gap-2 text-xs font-medium px-2.5 py-1 rounded-full border ${
        isConnected
          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
          : isPending
            ? 'bg-amber-50 text-amber-800 border-amber-200'
            : 'bg-zinc-50 text-zinc-600 border-zinc-200'
      } ${className}`
    },
    React.createElement(
      'span',
      { className: 'relative flex h-2 w-2' },
      isConnected &&
        React.createElement('span', {
          className:
            'animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75'
        }),
      React.createElement('span', {
        className: `relative inline-flex rounded-full h-2 w-2 ${
          isConnected ? 'bg-emerald-500' : isPending ? 'bg-amber-500 animate-pulse' : 'bg-zinc-400'
        }`
      })
    ),
    React.createElement(
      'span',
      null,
      isConnected ? 'Live Realtime' : isPending ? 'Connecting...' : 'Offline'
    )
  );
}

export function useQueue(options: UseQueueOptions | string = {}): UseQueueResult {
  const opts: UseQueueOptions = typeof options === 'string' ? { shopId: options } : options;
  const shopId = opts.shopId || '';
  const autoSubscribe = opts.autoSubscribe ?? true;
  const onCacheUpdate = opts.onCacheUpdate;

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [filter, setFilter] = useState<QueueFilter>(opts.initialFilter || 'ALL');
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('disconnected');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const queueService = useMemo(() => opts.queueService || new QueueService(), [opts.queueService]);

  const clientRef = useRef<RealtimeQueueClient | null>(null);

  // Authoritative fetch from backend REST endpoint
  const fetchQueue = useCallback(async () => {
    if (!shopId) {
      setQueue([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const items = await queueService.getQueue(shopId);
      setQueue(items);
      setError(null);
      if (onCacheUpdate) {
        onCacheUpdate(() => items);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch queue.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [shopId, queueService, onCacheUpdate]);

  // Initial load
  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  // Wire up Realtime Client subscription
  useEffect(() => {
    if (!shopId || !autoSubscribe) return;

    const client =
      opts.realtimeClient ||
      new RealtimeQueueClient({
        shopId
      });

    clientRef.current = client;

    // 1. Connection status change listener
    const unsubState = client.onStateChange(newState => {
      setConnectionState(newState);
    });

    // 2. Immediate INSERT event listener (< 500ms delivery to UI)
    const unsubInsert = client.onInsert(newJob => {
      setQueue(prev => {
        // Prevent duplicate entries
        if (prev.some(j => j.id === newJob.id)) {
          return prev;
        }
        const updated = [newJob, ...prev];
        if (onCacheUpdate) {
          onCacheUpdate(() => updated);
        }
        return updated;
      });
    });

    // 3. Immediate UPDATE event listener (live status transitions: PRINTING, COMPLETED, etc.)
    const unsubUpdate = client.onUpdate(updatedJob => {
      setQueue(prev => {
        const index = prev.findIndex(j => j.id === updatedJob.id);
        if (index === -1) {
          // If job was not in list yet, append it
          const updated = [updatedJob, ...prev];
          if (onCacheUpdate) {
            onCacheUpdate(() => updated);
          }
          return updated;
        }
        const updated = [...prev];
        updated[index] = { ...updated[index], ...updatedJob };
        if (onCacheUpdate) {
          onCacheUpdate(() => updated);
        }
        return updated;
      });
    });

    // 4. On reconnect: trigger authoritative query reconciliation
    const unsubReconnect = client.onReconnect(() => {
      fetchQueue();
    });

    client.subscribe();

    return () => {
      unsubState();
      unsubInsert();
      unsubUpdate();
      unsubReconnect();
      client.unsubscribe();
      clientRef.current = null;
    };
  }, [shopId, autoSubscribe, opts.realtimeClient, fetchQueue, onCacheUpdate]);

  // Approve a job
  const approveJob = useCallback(
    async (jobId: string): Promise<boolean> => {
      if (!shopId) return false;
      try {
        const res = await queueService.approveJob(shopId, jobId);
        if (res.success && res.job) {
          // Update locally
          setQueue(prev =>
            prev.map(j => (j.id === jobId ? { ...j, status: 'QUEUED' as CanonicalJobStatus } : j))
          );
        }
        return res.success;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to approve job.';
        setError(msg);
        return false;
      }
    },
    [shopId, queueService]
  );

  // Compute status counts for all canonical filters
  const counts = useMemo(() => {
    const map: Record<QueueFilter, number> = {
      ALL: queue.length,
      SUBMITTED: 0,
      OWNER_CONFIRMED: 0,
      QUEUED: 0,
      PRINTING: 0,
      COMPLETED: 0,
      FAILED: 0,
      CANCELLED: 0
    };

    for (const item of queue) {
      if (item.status in map) {
        map[item.status]++;
      }
    }

    return map;
  }, [queue]);

  // Filtered queue items
  const filteredQueue = useMemo(() => {
    if (filter === 'ALL') return queue;
    return queue.filter(item => item.status === filter);
  }, [queue, filter]);

  return {
    queue,
    filteredQueue,
    filter,
    setFilter,
    counts,
    connectionState,
    isConnected: connectionState === 'connected',
    isLoading,
    error,
    refresh: fetchQueue,
    approveJob,
    realtimeClient: clientRef.current
  };
}
