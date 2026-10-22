import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import {
  RealtimeTrackingClient,
  createClient,
  getTrackingStepIndex,
  calculateEstimatedMinutes,
  normalizeCanonicalStatus
} from '../tracking-client';
import { useJobTracking, TrackingConnectionBadge } from '../../../hooks/use-job-tracking';

describe('RealtimeTrackingClient — Order Tracking Realtime Wire (INT-D1-02)', () => {
  const jobId = 'job-tracking-uuid-001';

  beforeEach(() => {
    process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://mock-supabase.caps.internal';
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'mock-anon-key-customer-123';
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('constructs canonical channel caps:job:<jobId> and validates credentials', () => {
    const client = new RealtimeTrackingClient({ jobId });
    expect(client.channelName).toBe(`caps:job:${jobId}`);
    expect(client.jobId).toBe(jobId);
    expect(client.pollingIntervalMs).toBe(10000); // 10s fallback polling
  });

  it('rejects service role key in customer web bundle (security invariant)', () => {
    expect(() => {
      createClient('https://example.com', 'service_role_secret_key');
    }).toThrow(/SECURITY VIOLATION/);
  });

  it('subscribes to channel and listens for status transition broadcasts', () => {
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

    const client = new RealtimeTrackingClient({
      jobId,
      supabaseClient: mockSupabaseClient as any
    });

    const stateSpy = vi.fn();
    client.onConnectionStateChange(stateSpy);

    client.subscribe();

    expect(mockSupabaseClient.channel).toHaveBeenCalledWith(`caps:job:${jobId}`);
    expect(mockChannel.on).toHaveBeenCalledWith(
      'broadcast',
      expect.objectContaining({ event: '*' }),
      expect.any(Function)
    );
    expect(mockChannel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: '*',
        schema: 'public',
        table: 'print_jobs',
        filter: `id=eq.${jobId}`
      }),
      expect.any(Function)
    );
    expect(client.getState()).toBe('connected');

    client.unsubscribe();
    expect(mockChannel.unsubscribe).toHaveBeenCalled();
    expect(client.getState()).toBe('disconnected');
  });

  it('advances through status progression (SUBMITTED -> QUEUED -> PRINTING -> COMPLETED)', () => {
    const client = new RealtimeTrackingClient({ jobId });
    client.subscribe();

    const statusSpy = vi.fn();
    client.onStatusChange(statusSpy);

    // 1. Initial SUBMITTED state
    client.handleBroadcastMessage('job.created', {
      jobId,
      status: 'SUBMITTED',
      totalPages: 4
    });
    expect(client.currentStatus).toBe('SUBMITTED');
    expect(client.currentStep).toBe(0);
    expect(client.estimatedMinutesRemaining).toBeGreaterThan(0);
    expect(statusSpy).toHaveBeenCalledTimes(1);

    // 2. Shop owner approves -> QUEUED
    client.handleBroadcastMessage('job.approved', {
      jobId,
      status: 'QUEUED',
      totalPages: 4
    });
    expect(client.currentStatus).toBe('QUEUED');
    expect(client.currentStep).toBe(1);
    expect(statusSpy).toHaveBeenCalledTimes(2);

    // 3. Print agent starts printing -> PRINTING
    client.handleBroadcastMessage('job.status_updated', {
      jobId,
      status: 'PRINTING',
      pagesPrinted: 1,
      totalPages: 4
    });
    expect(client.currentStatus).toBe('PRINTING');
    expect(client.currentStep).toBe(2);
    expect(statusSpy).toHaveBeenCalledTimes(3);

    // 4. Print agent completes job -> COMPLETED
    client.handleBroadcastMessage('job.status_updated', {
      jobId,
      status: 'COMPLETED',
      pagesPrinted: 4,
      totalPages: 4
    });
    expect(client.currentStatus).toBe('COMPLETED');
    expect(client.currentStep).toBe(3);
    expect(client.estimatedMinutesRemaining).toBe(0);
    expect(statusSpy).toHaveBeenCalledTimes(4);

    client.unsubscribe();
  });

  it('activates 10-second fallback polling when WebSocket connection drops (Step 4)', () => {
    vi.useFakeTimers();

    const pollSpy = vi.fn();
    const client = new RealtimeTrackingClient({
      jobId,
      enableFallbackPolling: true,
      pollingIntervalMs: 10000,
      reconnectDelayMs: 30000,
      onPoll: pollSpy
    });

    client.subscribe();
    vi.advanceTimersByTime(60);
    expect(client.getState()).toBe('connected');
    expect(pollSpy).not.toHaveBeenCalled();

    // Trigger disconnect
    client.simulateDisconnect();
    expect(client.getState()).toBe('polling');

    // Advance 10 seconds in time
    vi.advanceTimersByTime(10000);
    expect(pollSpy).toHaveBeenCalledTimes(1);

    // Advance another 10 seconds
    vi.advanceTimersByTime(10000);
    expect(pollSpy).toHaveBeenCalledTimes(2);

    client.unsubscribe();
    vi.useRealTimers();
  });

  it('strictly rejects events for mismatched job_id (scoping security)', () => {
    const client = new RealtimeTrackingClient({ jobId });
    client.subscribe();

    const statusSpy = vi.fn();
    client.onStatusChange(statusSpy);

    const handled = client.handleBroadcastMessage('job.status_updated', {
      jobId: 'foreign-job-999',
      status: 'PRINTING'
    });

    expect(handled).toBe(false);
    expect(statusSpy).not.toHaveBeenCalled();
    expect(client.currentStatus).toBe('SUBMITTED'); // unmutated

    client.unsubscribe();
  });

  it('normalizes status strings and maps steps accurately', () => {
    expect(normalizeCanonicalStatus('pending')).toBe('SUBMITTED');
    expect(normalizeCanonicalStatus('in_queue')).toBe('QUEUED');
    expect(normalizeCanonicalStatus('printing')).toBe('PRINTING');
    expect(normalizeCanonicalStatus('ready')).toBe('COMPLETED');

    expect(getTrackingStepIndex('SUBMITTED')).toBe(0);
    expect(getTrackingStepIndex('QUEUED')).toBe(1);
    expect(getTrackingStepIndex('PRINTING')).toBe(2);
    expect(getTrackingStepIndex('COMPLETED')).toBe(3);

    expect(calculateEstimatedMinutes('COMPLETED')).toBe(0);
    expect(calculateEstimatedMinutes('PRINTING', 2)).toBeGreaterThanOrEqual(1);
  });
});

describe('useJobTracking Hook & TrackingConnectionBadge (INT-D1-02)', () => {
  const jobId = 'job-tracking-uuid-002';

  it('renders visual connection badge for connected, polling, and offline states', () => {
    const htmlLive = renderToStaticMarkup(
      React.createElement(TrackingConnectionBadge, { status: 'connected' })
    );
    expect(htmlLive).toContain('Live Updates Active');
    expect(htmlLive).toContain('bg-emerald-500');
    expect(htmlLive).toContain('animate-ping');

    const htmlPolling = renderToStaticMarkup(
      React.createElement(TrackingConnectionBadge, { status: 'polling' })
    );
    expect(htmlPolling).toContain('10s Polling Fallback');
    expect(htmlPolling).toContain('bg-amber-500');

    const htmlOffline = renderToStaticMarkup(
      React.createElement(TrackingConnectionBadge, { status: 'disconnected' })
    );
    expect(htmlOffline).toContain('Offline');
    expect(htmlOffline).toContain('bg-zinc-400');
  });

  it('initializes useJobTracking hook within a React component tree', () => {
    let hookResult: any = null;

    function TestTrackingView() {
      const result = useJobTracking({
        jobId,
        initialStatus: 'SUBMITTED',
        enablePollingFallback: true
      });
      hookResult = result;

      return React.createElement(
        'div',
        null,
        React.createElement('span', { 'data-testid': 'step' }, result.currentStep),
        React.createElement(TrackingConnectionBadge, { status: result.connectionState })
      );
    }

    const html = renderToStaticMarkup(React.createElement(TestTrackingView));
    expect(html).toContain('Offline');
    expect(hookResult).not.toBeNull();
    expect(hookResult.jobId).toBe(jobId);
    expect(hookResult.status).toBe('SUBMITTED');
    expect(hookResult.currentStep).toBe(0);
    expect(hookResult.steps.length).toBe(4);
  });

  it('updates hook state dynamically when realtime status transitions occur', () => {
    const customClient = new RealtimeTrackingClient({ jobId });
    customClient.subscribe();

    let hookResult: any = null;

    function TestLiveView() {
      const result = useJobTracking({
        jobId,
        customClient,
        initialStatus: 'SUBMITTED'
      });
      hookResult = result;
      return React.createElement('div', null, result.status);
    }

    renderToStaticMarkup(React.createElement(TestLiveView));
    expect(hookResult).not.toBeNull();
    expect(hookResult.status).toBe('SUBMITTED');

    // Simulate agent begins printing
    customClient.handleBroadcastMessage('job.status_updated', {
      jobId,
      status: 'PRINTING',
      pagesPrinted: 1,
      totalPages: 2
    });

    expect(customClient.currentStatus).toBe('PRINTING');
    expect(customClient.currentStep).toBe(2);

    // Simulate completion
    customClient.handleBroadcastMessage('job.status_updated', {
      jobId,
      status: 'COMPLETED',
      pagesPrinted: 2,
      totalPages: 2
    });

    expect(customClient.currentStatus).toBe('COMPLETED');
    expect(customClient.currentStep).toBe(3);

    customClient.unsubscribe();
  });
});
