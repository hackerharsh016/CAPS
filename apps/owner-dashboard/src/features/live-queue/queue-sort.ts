/**
 * Authoritative Two-Tier Queue Ordering & Position Calculation for CAPS.
 * Implements non-preemptive priority discipline:
 * 1. Currently executing jobs (printing/claimed/downloading) stay at head (pos: 0)
 * 2. Urgent tier FIFO (enqueued_at ASC, id ASC)
 * 3. Flexible tier FIFO (enqueued_at ASC, id ASC)
 *
 * Conforms to PostgreSQL stored procedure get_shop_queue (Migration 005).
 */

import type { QueueItem, JobStatus } from './types';

export const EXECUTING_STATUSES: readonly JobStatus[] = ['claimed', 'downloading', 'printing'] as const;

export function isJobExecuting(status: JobStatus): boolean {
  return EXECUTING_STATUSES.includes(status);
}

/**
 * Sorts queue items according to CAPS two-tier non-preemptive priority rules.
 * Does not mutate the source array.
 */
export function sortQueueItems(items: readonly QueueItem[]): QueueItem[] {
  return [...items].sort((a, b) => {
    const aExecuting = isJobExecuting(a.status) || a.is_currently_executing;
    const bExecuting = isJobExecuting(b.status) || b.is_currently_executing;

    // 1. Executing jobs always come first (non-preempted)
    if (aExecuting && !bExecuting) return -1;
    if (!aExecuting && bExecuting) return 1;

    // If both are executing, order by enqueued/started time
    if (aExecuting && bExecuting) {
      const aTime = new Date(a.enqueued_at || a.created_at).getTime();
      const bTime = new Date(b.enqueued_at || b.created_at).getTime();
      if (aTime !== bTime) return aTime - bTime;
      return a.id.localeCompare(b.id);
    }

    // 2. Urgent tier precedes Flexible tier
    if (a.priority_tier === 'urgent' && b.priority_tier !== 'urgent') return -1;
    if (a.priority_tier !== 'urgent' && b.priority_tier === 'urgent') return 1;

    // 3. Within same priority tier, strict FIFO by enqueued_at, tie-break by ID
    const aTime = new Date(a.enqueued_at || a.created_at).getTime();
    const bTime = new Date(b.enqueued_at || b.created_at).getTime();
    if (aTime !== bTime) return aTime - bTime;

    return a.id.localeCompare(b.id);
  });
}

/**
 * Recalculates dynamic queue positions after sorting.
 * Executing jobs receive position 0.
 * Waiting jobs receive 1, 2, 3...
 */
export function calculateQueuePositions(items: readonly QueueItem[]): QueueItem[] {
  const sorted = sortQueueItems(items);
  let waitingCounter = 1;

  return sorted.map(item => {
    const executing = isJobExecuting(item.status) || item.is_currently_executing;
    const position = executing ? 0 : waitingCounter++;

    return {
      ...item,
      is_currently_executing: executing,
      queue_position: position
    };
  });
}

/**
 * Estimates waiting time (in minutes) for each queue item.
 * Assumption: ~15 pages per minute printer baseline speed + 0.5m buffer per job.
 */
export function computeQueueETAs(
  items: readonly QueueItem[],
  speedPagesPerMinute = 15
): QueueItem[] {
  let cumulativeSeconds = 0;

  return items.map(item => {
    // Estimate job page count from copies or settings
    const copies = item.settings.copies || 1;
    const estimatedPages = Math.max(1, copies * 5); // baseline fallback if page count not parsed
    const printDurationSeconds = Math.ceil((estimatedPages / speedPagesPerMinute) * 60) + 30; // 30s warmup/finishing buffer

    if (item.is_currently_executing) {
      cumulativeSeconds += Math.ceil(printDurationSeconds / 2); // remaining half
      return {
        ...item,
        estimated_wait_minutes: 0 // currently printing
      };
    }

    const waitMinutes = Math.max(1, Math.ceil(cumulativeSeconds / 60));
    cumulativeSeconds += printDurationSeconds;

    return {
      ...item,
      estimated_wait_minutes: waitMinutes
    };
  });
}
