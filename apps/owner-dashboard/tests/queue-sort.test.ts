import { describe, it, expect } from 'vitest';
import {
  sortQueueItems,
  calculateQueuePositions,
  computeQueueETAs,
  isJobExecuting
} from '../src/features/live-queue/queue-sort';
import type { QueueItem } from '../src/features/live-queue/types';

describe('Queue Sorting & Two-Tier Priority Discipline', () => {
  const createMockItem = (
    id: string,
    tier: 'urgent' | 'flexible',
    status: QueueItem['status'],
    enqueuedOffsetSeconds: number
  ): QueueItem => {
    const baseTime = 1700000000000;
    return {
      id,
      shop_id: '00000000-0000-0000-0000-000000000001',
      customer_id: 'cust-1',
      customer_name: 'Customer ' + id,
      document_storage_key: 'doc/' + id,
      settings: {
        paper_size: 'A4',
        color_mode: 'bw',
        sides: 'single',
        orientation: 'portrait',
        copies: 1,
        page_range: '1-5',
        binding: 'none'
      },
      priority_tier: tier,
      price_total_paise: 1000,
      price_breakdown: {
        base_pages_paise: 1000,
        color_surcharge_paise: 0,
        duplex_discount_paise: 0,
        binding_fee_paise: 0,
        urgent_surcharge_paise: tier === 'urgent' ? 2000 : 0,
        subtotal_paise: 1000,
        gst_paise: 0,
        total_paise: 1000
      },
      status,
      payment_status: 'paid',
      queue_position: 1,
      is_currently_executing: isJobExecuting(status),
      estimated_wait_minutes: 5,
      enqueued_at: new Date(baseTime + enqueuedOffsetSeconds * 1000).toISOString(),
      created_at: new Date(baseTime + enqueuedOffsetSeconds * 1000).toISOString(),
      updated_at: new Date().toISOString()
    };
  };

  it('correctly detects executing jobs (non-preemption invariant)', () => {
    expect(isJobExecuting('printing')).toBe(true);
    expect(isJobExecuting('claimed')).toBe(true);
    expect(isJobExecuting('downloading')).toBe(true);
    expect(isJobExecuting('queued')).toBe(false);
    expect(isJobExecuting('approved')).toBe(false);
    expect(isJobExecuting('completed')).toBe(false);
  });

  it('places currently executing jobs at the head, ahead of arriving urgent jobs', () => {
    const executingFlexible = createMockItem('job-exec', 'flexible', 'printing', 10);
    const lateUrgent = createMockItem('job-urgent', 'urgent', 'queued', 20);

    const sorted = sortQueueItems([lateUrgent, executingFlexible]);

    expect(sorted[0]?.id).toBe('job-exec');
    expect(sorted[1]?.id).toBe('job-urgent');
  });

  it('places Urgent tier jobs ahead of Flexible tier jobs in FIFO order', () => {
    const earlyFlexible = createMockItem('flex-1', 'flexible', 'queued', 10);
    const midFlexible = createMockItem('flex-2', 'flexible', 'queued', 20);
    const lateUrgent = createMockItem('urg-1', 'urgent', 'queued', 30);
    const veryLateUrgent = createMockItem('urg-2', 'urgent', 'queued', 40);

    const sorted = sortQueueItems([veryLateUrgent, midFlexible, earlyFlexible, lateUrgent]);

    expect(sorted.map(s => s.id)).toEqual(['urg-1', 'urg-2', 'flex-1', 'flex-2']);
  });

  it('maintains strict FIFO order within the same tier by enqueued timestamp', () => {
    const item1 = createMockItem('flex-first', 'flexible', 'queued', 10);
    const item2 = createMockItem('flex-second', 'flexible', 'queued', 20);
    const item3 = createMockItem('flex-third', 'flexible', 'queued', 30);

    const sorted = sortQueueItems([item3, item1, item2]);

    expect(sorted.map(s => s.id)).toEqual(['flex-first', 'flex-second', 'flex-third']);
  });

  it('correctly assigns dynamic queue positions (0 for executing, 1..N for waiting)', () => {
    const executing = createMockItem('exec-1', 'flexible', 'printing', 5);
    const urg1 = createMockItem('urg-1', 'urgent', 'queued', 10);
    const urg2 = createMockItem('urg-2', 'urgent', 'queued', 20);
    const flex1 = createMockItem('flex-1', 'flexible', 'queued', 30);

    const positioned = calculateQueuePositions([flex1, urg2, executing, urg1]);

    expect(positioned[0]?.id).toBe('exec-1');
    expect(positioned[0]?.queue_position).toBe(0);
    expect(positioned[0]?.is_currently_executing).toBe(true);

    expect(positioned[1]?.id).toBe('urg-1');
    expect(positioned[1]?.queue_position).toBe(1);

    expect(positioned[2]?.id).toBe('urg-2');
    expect(positioned[2]?.queue_position).toBe(2);

    expect(positioned[3]?.id).toBe('flex-1');
    expect(positioned[3]?.queue_position).toBe(3);
  });

  it('computes realistic ETAs for waiting jobs', () => {
    const executing = createMockItem('exec-1', 'flexible', 'printing', 5);
    const waiting1 = createMockItem('wait-1', 'urgent', 'queued', 10);
    const waiting2 = createMockItem('wait-2', 'flexible', 'queued', 20);

    const withETAs = computeQueueETAs(calculateQueuePositions([executing, waiting1, waiting2]));

    expect(withETAs[0]?.estimated_wait_minutes).toBe(0); // currently executing
    expect(withETAs[1]?.estimated_wait_minutes).toBeGreaterThan(0);
    expect(withETAs[2]?.estimated_wait_minutes).toBeGreaterThan(
      withETAs[1]?.estimated_wait_minutes || 0
    );
  });
});
