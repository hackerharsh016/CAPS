import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import {
  RealtimeQueueClient,
  createClient,
  type PostgresChangesPayload,
  type BroadcastMessagePayload
} from '../queue-client';
import { useQueue, LiveConnectionIndicator } from '../../../hooks/use-queue';
import type { QueueItem } from '../../../types/queue';

describe('RealtimeQueueClient — Supabase Realtime Wire (INT-D2-02)', () => {
  const shopId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://mock-supabase.caps.internal';
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'mock-anon-key-12345';
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('wires Supabase credentials and constructs canonical channel name caps:shop:<shopId>', () => {
    const client = new RealtimeQueueClient({ shopId });
    expect(client.channelName).toBe(`caps:shop:${shopId}`);
    expect(client.shopId).toBe(shopId);
  });

  it('rejects service role key in client environment (security invariant)', () => {
    expect(() => {
      createClient('https://example.com', 'service_role_key_secret');
    }).toThrow(/SECURITY VIOLATION/);
  });

  it('subscribes to channel and registers postgres_changes and broadcast listeners', () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn((cb?: (status: string) => void) => {
        if (cb) cb('SUBSCRIBED');
        return mockChannel;
      }),
      unsubscribe: vi.fn()
    };

    const mockSupabaseClient = {
      channel: vi.fn().mockReturnValue(mockChannel)
    };

    const client = new RealtimeQueueClient({
      shopId,
      supabaseClient: mockSupabaseClient as any
    });

    const stateSpy = vi.fn();
    client.onStateChange(stateSpy);

    client.subscribe();

    expect(mockSupabaseClient.channel).toHaveBeenCalledWith(`caps:shop:${shopId}`);
    expect(mockChannel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: '*',
        schema: 'public',
        table: 'print_jobs',
        filter: `shop_id=eq.${shopId}`
      }),
      expect.any(Function)
    );
    expect(mockChannel.on).toHaveBeenCalledWith(
      'broadcast',
      expect.objectContaining({ event: '*' }),
      expect.any(Function)
    );
    expect(client.getState()).toBe('connected');

    client.unsubscribe();
    expect(mockChannel.unsubscribe).toHaveBeenCalled();
    expect(client.getState()).toBe('disconnected');
  });

  it('receives INSERT event on print_jobs and delivers to onInsert within < 500ms', () => {
    const client = new RealtimeQueueClient({ shopId });
    client.subscribe();

    const insertSpy = vi.fn();
    client.onInsert(insertSpy);

    const startTime = performance.now();

    const payload: PostgresChangesPayload = {
      eventType: 'INSERT',
      commit_timestamp: new Date().toISOString(),
      new: {
        id: 'job-cdc-101',
        shop_id: shopId,
        customer_name: 'Alice Johnson',
        status: 'SUBMITTED',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          copies: 2
        }
      },
      old: {}
    };

    const processed = client.handlePostgresChange(payload);
    const duration = performance.now() - startTime;

    expect(processed).toBe(true);
    expect(duration).toBeLessThan(500); // < 500ms SLA
    expect(insertSpy).toHaveBeenCalledTimes(1);

    const receivedJob: QueueItem = insertSpy.mock.calls[0]![0];
    expect(receivedJob.id).toBe('job-cdc-101');
    expect(receivedJob.status).toBe('SUBMITTED');
    expect(receivedJob.customer_name).toBe('Alice Johnson');
    expect(receivedJob.settings.copies).toBe(2);

    client.unsubscribe();
  });

  it('receives UPDATE event on print_jobs and delivers status change (PRINTING, COMPLETED) to onUpdate', () => {
    const client = new RealtimeQueueClient({ shopId });
    client.subscribe();

    const updateSpy = vi.fn();
    client.onUpdate(updateSpy);

    // 1. Agent starts printing
    const printingPayload: PostgresChangesPayload = {
      eventType: 'UPDATE',
      commit_timestamp: '2026-10-22T07:10:00Z',
      new: {
        id: 'job-cdc-101',
        shop_id: shopId,
        status: 'PRINTING'
      },
      old: {
        id: 'job-cdc-101',
        status: 'QUEUED'
      }
    };

    client.handlePostgresChange(printingPayload);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0].status).toBe('PRINTING');

    // 2. Agent completes printing
    const completedPayload: PostgresChangesPayload = {
      eventType: 'UPDATE',
      commit_timestamp: '2026-10-22T07:11:00Z',
      new: {
        id: 'job-cdc-101',
        shop_id: shopId,
        status: 'COMPLETED'
      },
      old: {
        id: 'job-cdc-101',
        status: 'PRINTING'
      }
    };

    client.handlePostgresChange(completedPayload);
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy.mock.calls[1]![0].status).toBe('COMPLETED');

    client.unsubscribe();
  });

  it('receives Realtime broadcast events (job.created, job.status_updated)', () => {
    const client = new RealtimeQueueClient({ shopId });
    client.subscribe();

    const insertSpy = vi.fn();
    const updateSpy = vi.fn();
    client.onInsert(insertSpy);
    client.onUpdate(updateSpy);

    // Broadcast: job.created
    const bcastCreated: BroadcastMessagePayload = {
      event: 'job.created',
      payload: {
        jobId: 'job-bcast-1',
        shopId: shopId,
        status: 'SUBMITTED',
        customerName: 'Bob Smith'
      }
    };
    client.handleBroadcast(bcastCreated);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy.mock.calls[0]![0].id).toBe('job-bcast-1');
    expect(insertSpy.mock.calls[0]![0].status).toBe('SUBMITTED');

    // Broadcast: job.status_updated
    const bcastUpdated: BroadcastMessagePayload = {
      event: 'job.status_updated',
      payload: {
        jobId: 'job-bcast-1',
        shopId: shopId,
        status: 'PRINTING'
      }
    };
    client.handleBroadcast(bcastUpdated);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0].status).toBe('PRINTING');

    client.unsubscribe();
  });

  it('strictly rejects foreign shop events (tenant isolation)', () => {
    const client = new RealtimeQueueClient({ shopId });
    client.subscribe();

    const insertSpy = vi.fn();
    client.onInsert(insertSpy);

    const foreignPayload: PostgresChangesPayload = {
      eventType: 'INSERT',
      new: {
        id: 'foreign-job-999',
        shop_id: 'other-shop-uuid-002',
        status: 'SUBMITTED'
      },
      old: {}
    };

    const handled = client.handlePostgresChange(foreignPayload);
    expect(handled).toBe(false);
    expect(insertSpy).not.toHaveBeenCalled();

    client.unsubscribe();
  });

  it('deduplicates identical events', () => {
    const client = new RealtimeQueueClient({ shopId });
    client.subscribe();

    const insertSpy = vi.fn();
    client.onInsert(insertSpy);

    const payload: PostgresChangesPayload = {
      eventType: 'INSERT',
      commit_timestamp: '2026-10-22T07:00:00Z',
      new: {
        id: 'job-dedup-1',
        shop_id: shopId,
        status: 'SUBMITTED'
      },
      old: {}
    };

    const first = client.handlePostgresChange(payload);
    const second = client.handlePostgresChange(payload);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(insertSpy).toHaveBeenCalledTimes(1);

    client.unsubscribe();
  });
});

describe('LiveConnectionIndicator & useQueue Hook Integration (INT-D2-02)', () => {
  const shopId = '00000000-0000-0000-0000-000000000001';

  it('renders visual live connection indicator with green dot when connected', () => {
    const htmlLive = renderToStaticMarkup(
      React.createElement(LiveConnectionIndicator, { status: 'connected' })
    );
    expect(htmlLive).toContain('Live Realtime');
    expect(htmlLive).toContain('bg-emerald-500');
    expect(htmlLive).toContain('animate-ping');

    const htmlConnecting = renderToStaticMarkup(
      React.createElement(LiveConnectionIndicator, { status: 'connecting' })
    );
    expect(htmlConnecting).toContain('Connecting...');
    expect(htmlConnecting).toContain('bg-amber-500');

    const htmlOffline = renderToStaticMarkup(
      React.createElement(LiveConnectionIndicator, { status: 'disconnected' })
    );
    expect(htmlOffline).toContain('Offline');
    expect(htmlOffline).toContain('bg-zinc-400');
  });

  it('renders useQueue state within a React component tree', () => {
    let capturedResult: any = null;

    function TestQueueView() {
      const result = useQueue({
        shopId,
        autoSubscribe: false
      });
      capturedResult = result;
      return React.createElement(
        'div',
        null,
        React.createElement('span', { 'data-testid': 'count' }, result.counts.ALL),
        React.createElement(LiveConnectionIndicator, { status: result.connectionState })
      );
    }

    const html = renderToStaticMarkup(React.createElement(TestQueueView));
    expect(html).toContain('Offline');
    expect(capturedResult).not.toBeNull();
    expect(capturedResult.filter).toBe('ALL');
    expect(typeof capturedResult.refresh).toBe('function');
    expect(typeof capturedResult.approveJob).toBe('function');
  });

  it('allows cache updater to be called when real-time events are dispatched', () => {
    const client = new RealtimeQueueClient({ shopId });
    client.subscribe();

    const cacheHistory: QueueItem[][] = [];
    const onCacheUpdate = (updater: (prev: QueueItem[]) => QueueItem[]) => {
      const next = updater([]);
      cacheHistory.push(next);
    };

    // Simulate hook listener registering to client
    client.onInsert(newJob => {
      onCacheUpdate(prev => [newJob, ...prev]);
    });

    client.onUpdate(updatedJob => {
      onCacheUpdate(prev => [updatedJob, ...prev]);
    });

    // Send INSERT
    client.handlePostgresChange({
      eventType: 'INSERT',
      commit_timestamp: new Date().toISOString(),
      new: {
        id: 'job-cache-1',
        shop_id: shopId,
        status: 'SUBMITTED'
      },
      old: {}
    });

    expect(cacheHistory.length).toBe(1);
    expect(cacheHistory[0]?.[0]?.id).toBe('job-cache-1');
    expect(cacheHistory[0]?.[0]?.status).toBe('SUBMITTED');

    // Send UPDATE (PRINTING)
    client.handlePostgresChange({
      eventType: 'UPDATE',
      commit_timestamp: '2026-10-22T07:20:00Z',
      new: {
        id: 'job-cache-1',
        shop_id: shopId,
        status: 'PRINTING'
      },
      old: {
        id: 'job-cache-1',
        status: 'SUBMITTED'
      }
    });

    expect(cacheHistory.length).toBe(2);
    expect(cacheHistory[1]?.[0]?.status).toBe('PRINTING');

    client.unsubscribe();
  });
});
