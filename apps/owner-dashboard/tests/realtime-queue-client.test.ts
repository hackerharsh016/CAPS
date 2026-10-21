import { describe, it, expect, vi } from 'vitest';
import { RealtimeQueueClient } from '../src/features/live-queue/realtime-queue-client';
import type { RealtimeQueueEvent } from '../src/features/live-queue/types';

describe('RealtimeQueueClient — Wake-up, Dedup & Reconnect Resilience', () => {
  const shopId = '00000000-0000-0000-0000-000000000001';

  const createEvent = (
    eventId: string,
    sequence: number,
    targetShopId = shopId
  ): RealtimeQueueEvent => ({
    event_id: eventId,
    event_type: 'JOB_ENQUEUED',
    job_id: 'job-uuid-' + sequence,
    shop_id: targetShopId,
    sequence,
    timestamp: new Date().toISOString()
  });

  it('manages subscription lifecycle and emits connection state', () => {
    const client = new RealtimeQueueClient({ shopId });
    const stateSpy = vi.fn();

    const unsub = client.onStateChange(stateSpy);
    expect(stateSpy).toHaveBeenCalledWith('disconnected');

    client.subscribe();
    expect(client.getState()).toBe('connected');

    unsub();
    client.unsubscribe();
    expect(client.getState()).toBe('disconnected');
  });

  it('delivers valid incoming wake-up events to registered listeners', () => {
    const client = new RealtimeQueueClient({ shopId });
    client.subscribe();

    const eventSpy = vi.fn();
    client.onWakeup(eventSpy);

    const event = createEvent('evt-1', 1);
    const processed = client.processIncomingEvent(event);

    expect(processed).toBe(true);
    expect(eventSpy).toHaveBeenCalledTimes(1);
    expect(eventSpy).toHaveBeenCalledWith(event);

    client.unsubscribe();
  });

  it('strictly ignores duplicate events with same event_id (deduplication)', () => {
    const client = new RealtimeQueueClient({ shopId });
    client.subscribe();

    const eventSpy = vi.fn();
    client.onWakeup(eventSpy);

    const event = createEvent('evt-duplicate-1', 1);

    // First delivery -> accepted
    const firstAttempt = client.processIncomingEvent(event);
    expect(firstAttempt).toBe(true);
    expect(eventSpy).toHaveBeenCalledTimes(1);

    // Replay with identical event_id -> dropped
    const secondAttempt = client.processIncomingEvent(event);
    expect(secondAttempt).toBe(false);
    expect(eventSpy).toHaveBeenCalledTimes(1); // not called again!

    client.unsubscribe();
  });

  it('drops events belonging to a different shop (tenant isolation)', () => {
    const client = new RealtimeQueueClient({ shopId });
    client.subscribe();

    const eventSpy = vi.fn();
    client.onWakeup(eventSpy);

    const otherShopEvent = createEvent('evt-other', 1, '00000000-0000-0000-0000-000000000002');
    const processed = client.processIncomingEvent(otherShopEvent);

    expect(processed).toBe(false);
    expect(eventSpy).not.toHaveBeenCalled();

    client.unsubscribe();
  });

  it('drops out-of-order stale sequence events', () => {
    const client = new RealtimeQueueClient({ shopId });
    client.subscribe();

    const eventSpy = vi.fn();
    client.onWakeup(eventSpy);

    const newerEvent: RealtimeQueueEvent = {
      event_id: 'evt-newer',
      event_type: 'JOB_ENQUEUED',
      job_id: 'job-10',
      shop_id: shopId,
      sequence: 10,
      timestamp: new Date(Date.now()).toISOString()
    };
    client.processIncomingEvent(newerEvent);
    expect(eventSpy).toHaveBeenCalledTimes(1);

    // Stale event with older timestamp and smaller sequence
    const olderEvent: RealtimeQueueEvent = {
      event_id: 'evt-older',
      event_type: 'JOB_ENQUEUED',
      job_id: 'job-5',
      shop_id: shopId,
      sequence: 5,
      timestamp: new Date(Date.now() - 10000).toISOString()
    };
    const processed = client.processIncomingEvent(olderEvent);

    expect(processed).toBe(false);
    expect(eventSpy).toHaveBeenCalledTimes(1);

    client.unsubscribe();
  });

  it('triggers reconnect resynchronization for query reconciliation', async () => {
    vi.useFakeTimers();

    const client = new RealtimeQueueClient({
      shopId,
      reconnectDelayMs: 200
    });
    client.subscribe();

    const resyncSpy = vi.fn();
    client.onReconnect(resyncSpy);

    client.triggerReconnect();
    expect(client.getState()).toBe('reconnecting');

    // Fast-forward timer past reconnect delay
    vi.advanceTimersByTime(250);

    expect(client.getState()).toBe('connected');
    expect(resyncSpy).toHaveBeenCalledTimes(1);

    client.unsubscribe();
    vi.useRealTimers();
  });
});
