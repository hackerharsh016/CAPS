/**
 * Queue calculation engine, two-tier priority ordering, and live ETA projector.
 * Strictly enforces:
 * - Urgent before Flexible FIFO within tier.
 * - Non-preemption of currently printing or claimed jobs.
 * - Stable immutable enqueued_at timestamps.
 * - Deterministic tie-breaking on UUIDs.
 * - Dynamic queue position derivation without sorting on mutable columns.
 */

import type {
  PrintJobRecord,
  JobStatus,
  PriceBreakdown,
  PrintSettings
} from '../print-jobs/print-jobs.types.js';
import type { PriorityTier } from '../pricing/pricing.types.js';
import type { UrgentSurchargeConfig } from '../shops/shops.types.js';
import type {
  UrgentSurchargeResult,
  LiveEtaRequest,
  LiveEtaResponse,
  QueueJobSummary,
  UrgentCapStatus,
  UrgentCapRejectionDetails
} from './queue.types.js';

export const THROUGHPUT_CONSTANTS = {
  WARMUP_OVERHEAD_SECONDS: 15,
  BW_SIMPLEX_SECONDS_PER_PAGE: 2.0,
  BW_DUPLEX_SECONDS_PER_PAGE: 3.0,
  COLOR_SIMPLEX_SECONDS_PER_PAGE: 4.0,
  COLOR_DUPLEX_SECONDS_PER_PAGE: 5.5,
  BINDING_OVERHEAD_SECONDS: {
    none: 0,
    staple: 20,
    spiral: 120,
    lamination: 90
  }
} as const;

export interface ExtractedJobSettings {
  pages: number;
  copies: number;
  color_mode: 'bw' | 'color';
  duplex: boolean;
  binding: 'none' | 'spiral' | 'staple' | 'lamination';
}

const ACTIVE_EXECUTION_STATUSES = new Set<JobStatus>(['printing', 'claimed', 'downloading']);

/**
 * Checks whether a job status represents an actively claimed or executing print job
 * that must NEVER be preempted by newly arriving jobs.
 */
export function isActivelyExecuting(status: JobStatus): boolean {
  return ACTIVE_EXECUTION_STATUSES.has(status);
}

/**
 * Normalizes print settings from job record.
 */
export function extractJobSettings(
  settings: Record<string, unknown> | undefined
): ExtractedJobSettings {
  if (!settings) {
    return {
      pages: 1,
      copies: 1,
      color_mode: 'bw',
      duplex: false,
      binding: 'none'
    };
  }

  const rawPages = settings['pages'] ?? settings['page_count'];
  const pages = typeof rawPages === 'number' && rawPages > 0 ? rawPages : 1;

  const rawCopies = settings['copies'];
  const copies = typeof rawCopies === 'number' && rawCopies > 0 ? rawCopies : 1;

  const rawColorMode = settings['color_mode'] ?? settings['color'];
  const color_mode = rawColorMode === 'color' || rawColorMode === true ? 'color' : 'bw';

  const rawDuplex = settings['duplex'] ?? settings['sides'];
  const duplex = rawDuplex === true || rawDuplex === 'double';

  let binding: 'none' | 'spiral' | 'staple' | 'lamination' = 'none';
  const rawBinding = settings['binding'];
  if (typeof rawBinding === 'string') {
    const b = rawBinding.toLowerCase();
    if (b === 'spiral' || b === 'staple' || b === 'lamination') {
      binding = b;
    }
  }

  return { pages, copies, color_mode, duplex, binding };
}

/**
 * Computes estimated print duration in seconds based on hardware throughput specifications.
 */
export function calculatePrintDurationSeconds(settings: {
  pages: number;
  copies?: number | undefined;
  color_mode?: 'bw' | 'color' | undefined;
  duplex?: boolean | undefined;
  binding?: 'none' | 'spiral' | 'staple' | 'lamination' | undefined;
}): number {
  const pages = Math.max(1, settings.pages);
  const copies = Math.max(1, settings.copies ?? 1);
  const colorMode = settings.color_mode ?? 'bw';
  const duplex = settings.duplex ?? false;
  const binding = settings.binding ?? 'none';

  let secondsPerPage: number;
  if (colorMode === 'color') {
    secondsPerPage = duplex
      ? THROUGHPUT_CONSTANTS.COLOR_DUPLEX_SECONDS_PER_PAGE
      : THROUGHPUT_CONSTANTS.COLOR_SIMPLEX_SECONDS_PER_PAGE;
  } else {
    secondsPerPage = duplex
      ? THROUGHPUT_CONSTANTS.BW_DUPLEX_SECONDS_PER_PAGE
      : THROUGHPUT_CONSTANTS.BW_SIMPLEX_SECONDS_PER_PAGE;
  }

  const printTimeSeconds = Math.round(pages * copies * secondsPerPage);
  const bindingTimeSeconds = THROUGHPUT_CONSTANTS.BINDING_OVERHEAD_SECONDS[binding] ?? 0;

  return THROUGHPUT_CONSTANTS.WARMUP_OVERHEAD_SECONDS + printTimeSeconds + bindingTimeSeconds;
}

/**
 * Evaluates the remaining execution duration in seconds for an active printing job.
 */
export function getRemainingJobDurationSeconds(
  job: PrintJobRecord,
  nowMs: number = Date.now()
): number {
  const norm = extractJobSettings(job.settings as unknown as Record<string, unknown> | undefined);
  const totalDuration = calculatePrintDurationSeconds(norm);

  const startTimeStr = job.claimed_at ?? job.updated_at ?? job.created_at;
  const startTimeMs = new Date(startTimeStr).getTime();
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startTimeMs) / 1000));

  return Math.max(1, totalDuration - elapsedSeconds);
}

/**
 * Pure comparator implementing the two-tier atomic queue discipline:
 * 1. Actively executing jobs come before queued jobs (non-preemption).
 * 2. Urgent tier jobs come before Flexible tier jobs.
 * 3. Strict FIFO within each tier based on stable `enqueued_at` (or `created_at`).
 * 4. Deterministic tie-breaker on job `id ASC`.
 *
 * NOTE: Never sorts by mutable `queue_position`.
 */
export function compareQueueJobs(a: PrintJobRecord, b: PrintJobRecord): number {
  const aExec = isActivelyExecuting(a.status);
  const bExec = isActivelyExecuting(b.status);

  // Active execution takes precedence over non-active (non-preemption guarantee)
  if (aExec && !bExec) return -1;
  if (!aExec && bExec) return 1;

  // Urgent tier takes precedence over flexible
  const aTierScore = a.priority_tier === 'urgent' ? 0 : 1;
  const bTierScore = b.priority_tier === 'urgent' ? 0 : 1;
  if (aTierScore !== bTierScore) {
    return aTierScore - bTierScore;
  }

  // Strict FIFO within tier based on immutable enqueued_at timestamp
  const aTime = new Date(a.enqueued_at ?? a.created_at).getTime();
  const bTime = new Date(b.enqueued_at ?? b.created_at).getTime();
  if (aTime !== bTime) {
    return aTime - bTime;
  }

  // Deterministic tie-breaker on UUID string comparison
  return a.id.localeCompare(b.id);
}

/**
 * Sorts jobs according to the two-tier atomic queue invariant.
 */
export function sortQueueJobs(jobs: PrintJobRecord[]): PrintJobRecord[] {
  return [...jobs].sort(compareQueueJobs);
}

export const sortQueueTwoTier = sortQueueJobs;

/**
 * Computes urgent surcharge and itemized total in integer paise.
 */
export function computeUrgentSurcharge(
  shopId: string,
  basePaise: number,
  tier: PriorityTier,
  config: UrgentSurchargeConfig
): UrgentSurchargeResult {
  if (tier !== 'urgent') {
    return {
      shop_id: shopId,
      priority_tier: 'flexible',
      base_price_paise: basePaise,
      urgent_surcharge_paise: 0,
      total_price_paise: basePaise,
      surcharge_type: 'none',
      surcharge_rate: 0
    };
  }

  let surcharge = 0;
  if (config.type === 'flat') {
    surcharge = Math.max(0, Math.round(config.amount));
  } else if (config.type === 'percentage') {
    surcharge = Math.max(0, Math.round(basePaise * (config.amount / 100)));
  }

  return {
    shop_id: shopId,
    priority_tier: 'urgent',
    base_price_paise: basePaise,
    urgent_surcharge_paise: surcharge,
    total_price_paise: basePaise + surcharge,
    surcharge_type: config.type,
    surcharge_rate: config.amount
  };
}

export interface QueueScheduleResult {
  currentlyPrintingSummary: QueueJobSummary | null;
  scheduledQueue: QueueJobSummary[];
  totalWaitSeconds: number;
}

/**
 * Projects dynamic queue schedule and ETA from currently executing and waiting jobs.
 * Assigns dynamic 1-based sequential `queue_position` to waiting jobs.
 */
export function projectQueueSchedule(
  currentlyExecuting: PrintJobRecord | null,
  queuedJobs: PrintJobRecord[],
  nowMs: number = Date.now()
): QueueScheduleResult {
  let accumulatedWaitSeconds = 0;
  let currentlyPrintingSummary: QueueJobSummary | null = null;

  if (currentlyExecuting) {
    const remainingSeconds = getRemainingJobDurationSeconds(currentlyExecuting, nowMs);
    const norm = extractJobSettings(
      currentlyExecuting.settings as unknown as Record<string, unknown> | undefined
    );
    const completionTime = new Date(nowMs + remainingSeconds * 1000).toISOString();

    currentlyPrintingSummary = {
      id: currentlyExecuting.id,
      shop_id: currentlyExecuting.shop_id,
      customer_id: currentlyExecuting.customer_id,
      printer_id: currentlyExecuting.printer_id,
      document_storage_key: currentlyExecuting.document_storage_key,
      priority_tier: currentlyExecuting.priority_tier,
      status: currentlyExecuting.status,
      queue_position: 0,
      enqueued_at: currentlyExecuting.enqueued_at ?? currentlyExecuting.created_at,
      pages: norm.pages,
      copies: norm.copies,
      color_mode: norm.color_mode,
      duplex: norm.duplex,
      binding: norm.binding,
      estimated_print_duration_seconds: remainingSeconds,
      estimated_wait_seconds: 0,
      projected_completion_time: completionTime,
      price_total_paise: currentlyExecuting.price_total_paise,
      price_breakdown: currentlyExecuting.price_breakdown as PriceBreakdown | undefined,
      settings: currentlyExecuting.settings as PrintSettings | undefined
    };

    accumulatedWaitSeconds += remainingSeconds;
  }

  // Sort queued jobs by strict two-tier priority ordering
  const sortedQueued = sortQueueJobs(queuedJobs);
  const scheduledQueue: QueueJobSummary[] = [];

  for (let i = 0; i < sortedQueued.length; i++) {
    const job = sortedQueued[i]!;
    const norm = extractJobSettings(job.settings as unknown as Record<string, unknown> | undefined);
    const durationSeconds = calculatePrintDurationSeconds(norm);
    const waitSecondsForThisJob = accumulatedWaitSeconds;
    const projectedCompletion = new Date(
      nowMs + (waitSecondsForThisJob + durationSeconds) * 1000
    ).toISOString();

    scheduledQueue.push({
      id: job.id,
      shop_id: job.shop_id,
      customer_id: job.customer_id,
      printer_id: job.printer_id,
      document_storage_key: job.document_storage_key,
      priority_tier: job.priority_tier,
      status: job.status,
      queue_position: i + 1, // Dynamic 1-based derived position
      enqueued_at: job.enqueued_at ?? job.created_at,
      pages: norm.pages,
      copies: norm.copies,
      color_mode: norm.color_mode,
      duplex: norm.duplex,
      binding: norm.binding,
      estimated_print_duration_seconds: durationSeconds,
      estimated_wait_seconds: waitSecondsForThisJob,
      projected_completion_time: projectedCompletion,
      price_total_paise: job.price_total_paise,
      price_breakdown: job.price_breakdown as PriceBreakdown | undefined,
      settings: job.settings as PrintSettings | undefined
    });

    accumulatedWaitSeconds += durationSeconds;
  }

  return {
    currentlyPrintingSummary,
    scheduledQueue,
    totalWaitSeconds: accumulatedWaitSeconds
  };
}

/**
 * Calculates live projected queue position and waiting time for a prospective or enqueued job.
 */
export function calculateLiveEta(
  request: LiveEtaRequest,
  currentlyExecuting: PrintJobRecord | null,
  queuedJobs: PrintJobRecord[],
  nowMs: number = Date.now()
): LiveEtaResponse {
  const norm = {
    pages: request.pages,
    copies: request.copies ?? 1,
    color_mode: request.color_mode ?? 'bw',
    duplex: request.duplex ?? false,
    binding: request.binding ?? 'none'
  };

  const estimatedPrintDuration = calculatePrintDurationSeconds(norm);
  let accumulatedWaitSeconds = 0;

  if (currentlyExecuting) {
    accumulatedWaitSeconds += getRemainingJobDurationSeconds(currentlyExecuting, nowMs);
  }

  const sortedQueued = sortQueueJobs(queuedJobs);
  const urgentJobs = sortedQueued.filter(j => j.priority_tier === 'urgent');
  const flexibleJobs = sortedQueued.filter(j => j.priority_tier === 'flexible');

  let aheadUrgent = 0;
  let aheadFlexible = 0;

  if (request.priority_tier === 'urgent') {
    // Urgent jumps ahead of all flexible jobs, placed strictly behind active print + existing urgent
    aheadUrgent = urgentJobs.length;
    aheadFlexible = 0;

    for (const j of urgentJobs) {
      accumulatedWaitSeconds += calculatePrintDurationSeconds(
        extractJobSettings(j.settings as unknown as Record<string, unknown> | undefined)
      );
    }
  } else {
    // Flexible waits behind active print + all urgent + all existing flexible
    aheadUrgent = urgentJobs.length;
    aheadFlexible = flexibleJobs.length;

    for (const j of sortedQueued) {
      accumulatedWaitSeconds += calculatePrintDurationSeconds(
        extractJobSettings(j.settings as unknown as Record<string, unknown> | undefined)
      );
    }
  }

  const projectedPosition = (currentlyExecuting ? 1 : 0) + aheadUrgent + aheadFlexible + 1;
  const projectedStartTime = new Date(nowMs + accumulatedWaitSeconds * 1000).toISOString();
  const projectedCompletionTime = new Date(
    nowMs + (accumulatedWaitSeconds + estimatedPrintDuration) * 1000
  ).toISOString();

  return {
    shop_id: request.shop_id,
    priority_tier: request.priority_tier,
    projected_queue_position: projectedPosition,
    estimated_wait_seconds: accumulatedWaitSeconds,
    estimated_print_duration_seconds: estimatedPrintDuration,
    projected_start_time: projectedStartTime,
    projected_completion_time: projectedCompletionTime,
    ahead_urgent_jobs: aheadUrgent,
    ahead_flexible_jobs: aheadFlexible,
    is_currently_printing_ahead: currentlyExecuting !== null
  };
}

/**
 * Evaluates rolling-window urgent quota limits, queue-depth limits, and fairness guard.
 */
export function evaluateUrgentCapAndFairness(
  shopId: string,
  allShopJobs: PrintJobRecord[],
  config: UrgentSurchargeConfig,
  nowMs: number = Date.now()
): UrgentCapStatus {
  const ONE_HOUR_MS = 3600 * 1000;
  const windowStartMs = nowMs - ONE_HOUR_MS;

  const activeStatuses = new Set<JobStatus>([
    'queued',
    'approved',
    'claimed',
    'downloading',
    'printing',
    'completed'
  ]);

  const urgentJobsInWindow: { job: PrintJobRecord; timestampMs: number }[] = [];
  for (const job of allShopJobs) {
    if (job.priority_tier === 'urgent' && activeStatuses.has(job.status)) {
      const t = new Date(job.enqueued_at ?? job.created_at).getTime();
      if (t >= windowStartMs && t <= nowMs) {
        urgentJobsInWindow.push({ job, timestampMs: t });
      }
    }
  }

  const hourlyUsage = urgentJobsInWindow.length;
  const hourlyCap =
    typeof config.max_urgent_jobs_per_hour === 'number' && config.max_urgent_jobs_per_hour > 0
      ? config.max_urgent_jobs_per_hour
      : null;
  const hourlyRemaining = hourlyCap !== null ? Math.max(0, hourlyCap - hourlyUsage) : null;

  const currentlyQueuedUrgent = allShopJobs.filter(
    j => j.priority_tier === 'urgent' && j.status === 'queued'
  ).length;

  const queueCap =
    typeof config.max_urgent_jobs_in_queue === 'number' && config.max_urgent_jobs_in_queue > 0
      ? config.max_urgent_jobs_in_queue
      : null;
  const queueRemaining = queueCap !== null ? Math.max(0, queueCap - currentlyQueuedUrgent) : null;

  const queuedFlexibleJobs = allShopJobs.filter(
    j => j.priority_tier === 'flexible' && j.status === 'queued'
  );
  let oldestFlexibleWaitSeconds: number | null = null;
  if (queuedFlexibleJobs.length > 0) {
    let maxWait = 0;
    for (const j of queuedFlexibleJobs) {
      const t = new Date(j.enqueued_at ?? j.created_at).getTime();
      const wait = Math.max(0, Math.floor((nowMs - t) / 1000));
      if (wait > maxWait) maxWait = wait;
    }
    oldestFlexibleWaitSeconds = maxWait;
  }

  const fairnessThresholdSeconds =
    typeof config.max_flexible_wait_threshold_seconds === 'number' &&
    config.max_flexible_wait_threshold_seconds > 0
      ? config.max_flexible_wait_threshold_seconds
      : 1800; // 30 mins default

  let rejectionDetails: UrgentCapRejectionDetails | null = null;
  let windowResetsAt: string | null = null;
  let retryAfterSeconds: number | null = null;

  // 1. Hourly cap check
  if (hourlyCap !== null && hourlyUsage >= hourlyCap) {
    const timestamps = urgentJobsInWindow.map(u => u.timestampMs);
    const earliestTimestamp = Math.min(...timestamps);
    const resetTimeMs = earliestTimestamp + ONE_HOUR_MS;
    windowResetsAt = new Date(resetTimeMs).toISOString();
    retryAfterSeconds = Math.max(1, Math.ceil((resetTimeMs - nowMs) / 1000));

    rejectionDetails = {
      cap_type: 'hourly',
      limit: hourlyCap,
      current_usage: hourlyUsage,
      reset_at: windowResetsAt,
      retry_after_seconds: retryAfterSeconds,
      fallback_tier: 'flexible',
      message: `Shop urgent order cap of ${hourlyCap} jobs/hour has been reached. Urgent tier resumes in ${retryAfterSeconds}s.`
    };
  } else if (queueCap !== null && currentlyQueuedUrgent >= queueCap) {
    // 2. Queue depth cap check
    rejectionDetails = {
      cap_type: 'queue_depth',
      limit: queueCap,
      current_usage: currentlyQueuedUrgent,
      fallback_tier: 'flexible',
      message: `Shop queue limit of ${queueCap} concurrent urgent jobs reached. Please choose standard flexible tier.`
    };
  } else if (
    config.fairness_guard_enabled &&
    oldestFlexibleWaitSeconds !== null &&
    oldestFlexibleWaitSeconds >= fairnessThresholdSeconds
  ) {
    // 3. Fairness starvation guard
    rejectionDetails = {
      cap_type: 'fairness_guard',
      limit: fairnessThresholdSeconds,
      current_usage: oldestFlexibleWaitSeconds,
      fallback_tier: 'flexible',
      message: `Urgent tier is temporarily paused to ensure pending flexible orders waiting over ${Math.floor(fairnessThresholdSeconds / 60)} minutes are printed fairly. Please proceed with standard flexible tier.`
    };
  }

  return {
    shop_id: shopId,
    is_urgent_available: rejectionDetails === null,
    hourly_cap: hourlyCap,
    hourly_usage: hourlyUsage,
    hourly_remaining: hourlyRemaining,
    queue_cap: queueCap,
    current_urgent_queued: currentlyQueuedUrgent,
    queue_remaining: queueRemaining,
    fairness_guard_active: Boolean(config.fairness_guard_enabled),
    oldest_flexible_wait_seconds: oldestFlexibleWaitSeconds,
    window_resets_at: windowResetsAt,
    retry_after_seconds: retryAfterSeconds,
    rejection_details: rejectionDetails
  };
}
