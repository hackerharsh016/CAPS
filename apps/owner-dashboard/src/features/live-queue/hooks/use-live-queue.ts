'use client';

/**
 * Custom Hook for Shop Owner Realtime Queue & Metrics.
 * Reconciles authoritative REST/RPC queries with Realtime Wake-up triggers.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  QueueItem,
  QueueFilter,
  QueueSummaryMetrics,
  RealtimeConnectionState
} from '../types';
import { LiveQueueService } from '../live-queue-service';
import { RealtimeQueueClient } from '../realtime-queue-client';
import { useShop } from '../../shop-management/shop-context';
import { useAuth } from '../../auth/auth-context';

export function useLiveQueue(customShopId?: string) {
  const { activeShop } = useShop();
  const { session } = useAuth();

  const shopId = customShopId ?? activeShop?.id ?? null;
  const accessToken = session?.access_token;

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('disconnected');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const queueService = useMemo(() => new LiveQueueService(), []);
  const realtimeClientRef = useRef<RealtimeQueueClient | null>(null);

  // Authoritative fetch function
  const fetchQueue = useCallback(async () => {
    if (!shopId) {
      setQueue([]);
      setIsLoading(false);
      return;
    }

    try {
      const items = await queueService.fetchShopQueue(shopId, accessToken);
      setQueue(items);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch queue.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [shopId, accessToken, queueService]);

  // Setup Realtime client and subscriptions
  useEffect(() => {
    if (!shopId) return;

    setIsLoading(true);
    fetchQueue();

    const client = new RealtimeQueueClient({
      shopId,
      pollingIntervalMs: 8000
    });
    realtimeClientRef.current = client;

    // Listen to connection state
    const unsubState = client.onStateChange(newState => {
      setConnectionState(newState);
    });

    // Realtime wake-up trigger -> Authoritative query reconciliation
    const unsubWakeup = client.onWakeup(_event => {
      fetchQueue();
    });

    // On reconnect -> Authoritative resynchronization
    const unsubReconnect = client.onReconnect(() => {
      fetchQueue();
    });

    client.subscribe();

    return () => {
      unsubState();
      unsubWakeup();
      unsubReconnect();
      client.unsubscribe();
      realtimeClientRef.current = null;
    };
  }, [shopId, fetchQueue]);

  // Filtered queue items
  const filteredQueue = useMemo(() => {
    if (filter === 'all') return queue;
    if (filter === 'urgent') return queue.filter(item => item.priority_tier === 'urgent');
    if (filter === 'flexible') return queue.filter(item => item.priority_tier === 'flexible');
    if (filter === 'executing') return queue.filter(item => item.is_currently_executing);
    return queue;
  }, [queue, filter]);

  // Metrics summary calculation
  const metrics = useMemo<QueueSummaryMetrics>(() => {
    const urgentCount = queue.filter(
      item => item.priority_tier === 'urgent' && !item.is_currently_executing
    ).length;
    const flexibleCount = queue.filter(
      item => item.priority_tier === 'flexible' && !item.is_currently_executing
    ).length;
    const executingCount = queue.filter(item => item.is_currently_executing).length;
    const pendingCount = urgentCount + flexibleCount;

    const totalEstimatedWaitMinutes = queue.reduce(
      (max, item) => Math.max(max, item.estimated_wait_minutes),
      0
    );

    // Mock today revenue & completed metrics for dashboard summary
    const todayRevenuePaise = 284000; // ₹2,840.00
    const todayCompletedCount = 38;

    return {
      pendingCount,
      urgentCount,
      flexibleCount,
      executingCount,
      totalEstimatedWaitMinutes,
      todayCompletedCount,
      todayRevenuePaise
    };
  }, [queue]);

  return {
    queue: filteredQueue,
    rawQueue: queue,
    metrics,
    filter,
    setFilter,
    connectionState,
    isLoading,
    error,
    lastUpdated,
    refreshQueue: fetchQueue,
    realtimeClient: realtimeClientRef.current
  };
}
