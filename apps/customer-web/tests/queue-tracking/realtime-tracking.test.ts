import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealtimeTrackingClient } from '../../src/features/queue-tracking/realtime-tracking-client';
import type { RealtimeJobEvent } from '../../src/features/queue-tracking/realtime-types';

describe('Realtime Job Subscription & Resync (P04-M06-F02)', () => {
  const jobId = 'job-101e4567-e89b-12d3-a456-426614174001';
  const customerId = 'usr-customer-alpha';
  const otherCustomerId = 'usr-customer-BETA-ANOTHER-TENANT';

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Happy Path: Subscription & Wake-up Emission', () => {
    it('establishes subscription, transitions to connected, and dispatches wake-up event', () => {
      const client = new RealtimeTrackingClient({
        jobId,
        customerId
      });

      const stateTransitions: string[] = [];
      client.onStateChange((state) => stateTransitions.push(state));

      expect(stateTransitions).toContain('disconnected');

      client.subscribe();
      expect(stateTransitions).toContain('connecting');

      // Fast-forward handshake timer
      vi.advanceTimersByTime(60);
      expect(client.getState()).toBe('connected');

      const wakeUpSpy = vi.fn();
      client.onWakeup(wakeUpSpy);

      const event: RealtimeJobEvent = {
        job_id: jobId,
        customer_id: customerId,
        shop_id: 'shop-8888-campus-xerox',
        event_type: 'status_changed',
        status: 'printing',
        timestamp: new Date().toISOString(),
        sequence_number: 1
      };

      const accepted = client.handleIncomingEvent(event);
      expect(accepted).toBe(true);
      expect(wakeUpSpy).toHaveBeenCalledTimes(1);
      expect(wakeUpSpy).toHaveBeenCalledWith(event);

      client.unsubscribe();
    });
  });

  describe('Subscription Teardown Invariant', () => {
    it('cleans up all listeners, resets state to disconnected, and ignores incoming events', () => {
      const client = new RealtimeTrackingClient({
        jobId,
        customerId
      });

      client.subscribe();
      vi.advanceTimersByTime(60);
      expect(client.getState()).toBe('connected');

      const wakeUpSpy = vi.fn();
      client.onWakeup(wakeUpSpy);

      // Teardown
      client.unsubscribe();
      expect(client.getState()).toBe('disconnected');

      // Any subsequent events must be rejected/ignored
      const event: RealtimeJobEvent = {
        job_id: jobId,
        customer_id: customerId,
        shop_id: 'shop-8888-campus-xerox',
        event_type: 'status_changed',
        status: 'ready',
        timestamp: new Date().toISOString(),
        sequence_number: 2
      };

      const accepted = client.handleIncomingEvent(event);
      expect(accepted).toBe(false);
      expect(wakeUpSpy).not.toHaveBeenCalled();
    });
  });

  describe('Replay & Out-of-Order Event Protection', () => {
    it('rejects stale events with timestamps older than previous watermark', () => {
      const client = new RealtimeTrackingClient({
        jobId,
        customerId
      });
      client.subscribe();
      vi.advanceTimersByTime(60);

      const wakeUpSpy = vi.fn();
      client.onWakeup(wakeUpSpy);

      const t1 = new Date('2026-10-20T10:00:00Z').toISOString();
      const t0Stale = new Date('2026-10-20T09:59:59Z').toISOString();
      const t2Newer = new Date('2026-10-20T10:00:05Z').toISOString();

      // 1. Initial event at T1
      const accepted1 = client.handleIncomingEvent({
        job_id: jobId,
        customer_id: customerId,
        shop_id: 'shop-8888-campus-xerox',
        event_type: 'status_changed',
        timestamp: t1
      });
      expect(accepted1).toBe(true);
      expect(wakeUpSpy).toHaveBeenCalledTimes(1);

      // 2. Out-of-order event at T0 (older) -> MUST BE REJECTED
      const acceptedStale = client.handleIncomingEvent({
        job_id: jobId,
        customer_id: customerId,
        shop_id: 'shop-8888-campus-xerox',
        event_type: 'status_changed',
        timestamp: t0Stale
      });
      expect(acceptedStale).toBe(false);
      expect(wakeUpSpy).toHaveBeenCalledTimes(1); // Not incremented

      // 3. Newer event at T2 -> ACCEPTED
      const accepted2 = client.handleIncomingEvent({
        job_id: jobId,
        customer_id: customerId,
        shop_id: 'shop-8888-campus-xerox',
        event_type: 'status_changed',
        timestamp: t2Newer
      });
      expect(accepted2).toBe(true);
      expect(wakeUpSpy).toHaveBeenCalledTimes(2);

      client.unsubscribe();
    });

    it('rejects duplicate or non-increasing sequence numbers', () => {
      const client = new RealtimeTrackingClient({
        jobId,
        customerId
      });
      client.subscribe();
      vi.advanceTimersByTime(60);

      const wakeUpSpy = vi.fn();
      client.onWakeup(wakeUpSpy);

      const timestamp = new Date('2026-10-20T10:00:00Z').toISOString();

      // Sequence 5
      expect(
        client.handleIncomingEvent({
          job_id: jobId,
          customer_id: customerId,
          shop_id: 'shop-8888-campus-xerox',
          event_type: 'status_changed',
          sequence_number: 5,
          timestamp
        })
      ).toBe(true);

      // Replay of Sequence 5 -> MUST BE REJECTED
      expect(
        client.handleIncomingEvent({
          job_id: jobId,
          customer_id: customerId,
          shop_id: 'shop-8888-campus-xerox',
          event_type: 'status_changed',
          sequence_number: 5,
          timestamp: new Date('2026-10-20T10:00:01Z').toISOString()
        })
      ).toBe(false);

      // Regressive Sequence 4 -> MUST BE REJECTED
      expect(
        client.handleIncomingEvent({
          job_id: jobId,
          customer_id: customerId,
          shop_id: 'shop-8888-campus-xerox',
          event_type: 'status_changed',
          sequence_number: 4,
          timestamp: new Date('2026-10-20T10:00:02Z').toISOString()
        })
      ).toBe(false);

      expect(wakeUpSpy).toHaveBeenCalledTimes(1);
      client.unsubscribe();
    });
  });

  describe('Security & Tenant Boundary Isolation', () => {
    it('drops cross-tenant events and emits security violation error', () => {
      const client = new RealtimeTrackingClient({
        jobId,
        customerId
      });
      client.subscribe();
      vi.advanceTimersByTime(60);

      const wakeUpSpy = vi.fn();
      const errorSpy = vi.fn();
      client.onWakeup(wakeUpSpy);
      client.onError(errorSpy);

      // Event belonging to a different customer
      const crossTenantEvent: RealtimeJobEvent = {
        job_id: jobId,
        customer_id: otherCustomerId,
        shop_id: 'shop-8888-campus-xerox',
        event_type: 'status_changed',
        timestamp: new Date().toISOString()
      };

      const accepted = client.handleIncomingEvent(crossTenantEvent);
      expect(accepted).toBe(false);
      expect(wakeUpSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const firstCall = errorSpy.mock.calls[0];
      expect(firstCall?.[0]?.message).toContain('SECURITY VIOLATION');

      client.unsubscribe();
    });

    it('rejects initialization without customerId or jobId', () => {
      expect(() => new RealtimeTrackingClient({ jobId: '', customerId })).toThrow();
      expect(() => new RealtimeTrackingClient({ jobId, customerId: '' })).toThrow();
    });
  });

  describe('Fetch-On-Reconnect & Fallback Polling', () => {
    it('triggers immediate fetch-on-reconnect wake-up upon connection recovery', () => {
      const client = new RealtimeTrackingClient({
        jobId,
        customerId
      });
      client.subscribe();
      vi.advanceTimersByTime(60);

      const wakeUpSpy = vi.fn();
      client.onWakeup(wakeUpSpy);

      // 1. Simulate network drop
      client.simulateDisconnect();
      expect(client.getState()).toBe('reconnecting');
      expect(wakeUpSpy).not.toHaveBeenCalled();

      // 2. Simulate reconnect
      client.simulateReconnect();
      expect(client.getState()).toBe('connected');

      // Fetch-on-reconnect wake-up must be dispatched
      expect(wakeUpSpy).toHaveBeenCalledTimes(1);
      const firstWakeUpCall = wakeUpSpy.mock.calls[0];
      const wakeUpEvent = firstWakeUpCall?.[0] as RealtimeJobEvent;
      expect(wakeUpEvent.event_type).toBe('wake_up');
      expect(wakeUpEvent.metadata?.['reason']).toBe('fetch_on_reconnect');

      client.unsubscribe();
    });

    it('activates fallback polling when connection enters polling state', () => {
      const client = new RealtimeTrackingClient({
        jobId,
        customerId,
        enableFallbackPolling: true,
        pollingIntervalMs: 5000
      });
      client.subscribe();
      vi.advanceTimersByTime(60);

      const wakeUpSpy = vi.fn();
      client.onWakeup(wakeUpSpy);

      // Simulate failure transitioning to polling mode
      client.simulateFailure(new Error('WebSocket transport unavailable'));
      expect(client.getState()).toBe('polling');

      // Advance time by 5s polling interval
      vi.advanceTimersByTime(5000);
      expect(wakeUpSpy).toHaveBeenCalledTimes(1);
      const pollCall1 = wakeUpSpy.mock.calls[0];
      const pollEvent1 = pollCall1?.[0] as RealtimeJobEvent;
      expect(pollEvent1.metadata?.['reason']).toBe('fallback_polling');

      // Advance by another 5s
      vi.advanceTimersByTime(5000);
      expect(wakeUpSpy).toHaveBeenCalledTimes(2);

      // Reconnect stops polling timer
      client.simulateReconnect();
      expect(client.getState()).toBe('connected');

      // Advance time further: polling should not fire additional timers
      vi.advanceTimersByTime(10000);
      // Only 3 total (2 from polling + 1 from fetch-on-reconnect)
      expect(wakeUpSpy).toHaveBeenCalledTimes(3);

      client.unsubscribe();
    });
  });
});
