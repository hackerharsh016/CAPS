import type { PriorityTier, PrintJob } from '../print-jobs/print-jobs.types.js';
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

/**
 * Extracts normalized print settings from arbitrary job settings JSON.
 */
export function extractJobSettings(settings: Record<string, unknown> | undefined): ExtractedJobSettings {
  if (!settings) {
    return {
      pages: 1,
      copies: 1,
      color_mode: 'bw',
      duplex: false,
      binding: 'none'
    };
  }

  const rawPages = settings['pages'];
  const pages = typeof rawPages === 'number' && rawPages > 0 ? rawPages : 1;

  const rawCopies = settings['copies'];
  const copies = typeof rawCopies === 'number' && rawCopies > 0 ? rawCopies : 1;

  const rawColorMode = settings['color_mode'];
  const rawColor = settings['color'];
  const color_mode = rawColorMode === 'color' || rawColor === true ? 'color' : 'bw';

  const rawDuplex = settings['duplex'];
  const rawSides = settings['sides'];
  const duplex = rawDuplex === true || rawSides === 'double';

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
  const bindingTimeSeconds =
    THROUGHPUT_CONSTANTS.BINDING_OVERHEAD_SECONDS[binding] ?? 0;

  return (
    THROUGHPUT_CONSTANTS.WARMUP_OVERHEAD_SECONDS +
    printTimeSeconds +
    bindingTimeSeconds
  );
}

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

/**
 * Evaluates the remaining execution duration in seconds for an active printing job.
 */
export function getRemainingJobDurationSeconds(
  job: PrintJob,
  nowMs: number = Date.now()
): number {
  const norm = extractJobSettings(job.settings);
  const totalDuration = calculatePrintDurationSeconds(norm);

  const startTimeMs = new Date(job.updated_at ?? job.created_at).getTime();
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startTimeMs) / 1000));

  // Non-preemptive execution: ensure a minimum of 5 seconds remaining until completion event arrives
  return Math.max(5, totalDuration - elapsedSeconds);
}

/**
 * Deterministically sorts queued jobs using CAPS two-tier priority queue discipline:
 * 1. Urgent tier first (0) ahead of Flexible tier (1)
 * 2. Strict FIFO by enqueued_at timestamp within each tier
 * 3. Deterministic tie-breaker by job id
 */
export function sortQueueTwoTier(jobs: PrintJob[]): PrintJob[] {
  return [...jobs].sort((a, b) => {
    const tierA = a.priority_tier === 'urgent' ? 0 : 1;
    const tierB = b.priority_tier === 'urgent' ? 0 : 1;
    if (tierA !== tierB) return tierA - tierB;

    const timeA = new Date(a.enqueued_at ?? a.created_at).getTime();
    const timeB = new Date(b.enqueued_at ?? b.created_at).getTime();
    if (timeA !== timeB) return timeA - timeB;

    return a.id.localeCompare(b.id);
  });
}

/**
 * Calculates live projected positions and cumulative ETAs for all jobs in a shop's queue.
 */
export function projectQueueSchedule(
  currentlyPrinting: PrintJob | null,
  queuedJobs: PrintJob[],
  nowMs: number = Date.now()
): {
  currentlyPrintingSummary: QueueJobSummary | null;
  scheduledQueue: QueueJobSummary[];
  totalWaitSeconds: number;
} {
  let currentlyPrintingSummary: QueueJobSummary | null = null;
  let cumulativeWaitSeconds = 0;

  if (currentlyPrinting) {
    const norm = extractJobSettings(currentlyPrinting.settings);
    const totalDuration = calculatePrintDurationSeconds(norm);
    const remainingSeconds = getRemainingJobDurationSeconds(currentlyPrinting, nowMs);
    cumulativeWaitSeconds = remainingSeconds;

    currentlyPrintingSummary = {
      id: currentlyPrinting.id,
      shop_id: currentlyPrinting.shop_id,
      customer_id: currentlyPrinting.customer_id,
      printer_id: currentlyPrinting.printer_id,
      priority_tier: currentlyPrinting.priority_tier,
      status: currentlyPrinting.status,
      queue_position: 0, // Currently executing
      enqueued_at: currentlyPrinting.enqueued_at ?? currentlyPrinting.created_at,
      pages: norm.pages,
      copies: norm.copies,
      color_mode: norm.color_mode,
      duplex: norm.duplex,
      binding: norm.binding,
      estimated_print_duration_seconds: totalDuration,
      estimated_wait_seconds: 0,
      projected_completion_time: new Date(nowMs + remainingSeconds * 1000).toISOString(),
      price_total_paise: currentlyPrinting.price_total_paise
    };
  }

  const sortedQueued = sortQueueTwoTier(queuedJobs);
  const scheduledQueue: QueueJobSummary[] = [];

  for (let i = 0; i < sortedQueued.length; i++) {
    const job = sortedQueued[i]!;
    const norm = extractJobSettings(job.settings);
    const duration = calculatePrintDurationSeconds(norm);

    const waitSecondsForThisJob = cumulativeWaitSeconds;
    cumulativeWaitSeconds += duration;

    const projectedCompletion = new Date(nowMs + cumulativeWaitSeconds * 1000).toISOString();

    scheduledQueue.push({
      id: job.id,
      shop_id: job.shop_id,
      customer_id: job.customer_id,
      printer_id: job.printer_id,
      priority_tier: job.priority_tier,
      status: job.status,
      queue_position: i + 1, // 1-based dynamic position
      enqueued_at: job.enqueued_at ?? job.created_at,
      pages: norm.pages,
      copies: norm.copies,
      color_mode: norm.color_mode,
      duplex: norm.duplex,
      binding: norm.binding,
      estimated_print_duration_seconds: duration,
      estimated_wait_seconds: waitSecondsForThisJob,
      projected_completion_time: projectedCompletion,
      price_total_paise: job.price_total_paise
    });
  }

  return {
    currentlyPrintingSummary,
    scheduledQueue,
    totalWaitSeconds: cumulativeWaitSeconds
  };
}

/**
 * Calculates live projected queue position and ETA for a prospective job before order confirmation.
 */
export function calculateLiveEta(
  request: LiveEtaRequest,
  currentlyPrinting: PrintJob | null,
  queuedJobs: PrintJob[],
  nowMs: number = Date.now()
): LiveEtaResponse {
  const normNewJob = {
    pages: request.pages,
    copies: request.copies ?? 1,
    color_mode: request.color_mode ?? 'bw',
    duplex: request.duplex ?? false,
    binding: request.binding ?? 'none'
  };
  const newJobDuration = calculatePrintDurationSeconds(normNewJob);

  const activeWaitSeconds = currentlyPrinting
    ? getRemainingJobDurationSeconds(currentlyPrinting, nowMs)
    : 0;

  const sortedQueued = sortQueueTwoTier(queuedJobs);

  let waitSeconds = activeWaitSeconds;
  let aheadUrgent = 0;
  let aheadFlexible = 0;
  let projectedPosition = 1;

  if (request.priority_tier === 'urgent') {
    // An urgent job jumps ahead of all flexible jobs, but queues behind:
    // 1. The currently printing job (non-preemption)
    // 2. Preexisting urgent jobs (FIFO within urgent)
    for (const job of sortedQueued) {
      if (job.priority_tier === 'urgent') {
        aheadUrgent++;
        const norm = extractJobSettings(job.settings);
        waitSeconds += calculatePrintDurationSeconds(norm);
      }
      // Flexible jobs are skipped! Urgent job goes ahead of them.
    }
    projectedPosition = aheadUrgent + 1;
  } else {
    // A flexible job queues behind:
    // 1. The currently printing job
    // 2. All urgent jobs (both current and future ones that might arrive before print)
    // 3. Preexisting flexible jobs (FIFO within flexible)
    for (const job of sortedQueued) {
      const norm = extractJobSettings(job.settings);
      const duration = calculatePrintDurationSeconds(norm);
      if (job.priority_tier === 'urgent') {
        aheadUrgent++;
      } else {
        aheadFlexible++;
      }
      waitSeconds += duration;
    }
    projectedPosition = aheadUrgent + aheadFlexible + 1;
  }

  const projectedStartTime = new Date(nowMs + waitSeconds * 1000).toISOString();
  const projectedCompletionTime = new Date(
    nowMs + (waitSeconds + newJobDuration) * 1000
  ).toISOString();

  return {
    shop_id: request.shop_id,
    priority_tier: request.priority_tier,
    projected_queue_position: projectedPosition,
    estimated_wait_seconds: waitSeconds,
    estimated_print_duration_seconds: newJobDuration,
    projected_start_time: projectedStartTime,
    projected_completion_time: projectedCompletionTime,
    ahead_urgent_jobs: aheadUrgent,
    ahead_flexible_jobs: aheadFlexible,
    is_currently_printing_ahead: currentlyPrinting !== null
  };
}

/**
 * Evaluates whether an urgent job can currently be admitted under the shop's
 * configured hourly cap, per-queue cap, and starvation fairness guard.
 */
export function evaluateUrgentCapAndFairness(
  shopId: string,
  allShopJobs: PrintJob[],
  config: UrgentSurchargeConfig,
  nowMs: number = Date.now()
): UrgentCapStatus {
  const ONE_HOUR_MS = 3600 * 1000;
  const windowStartMs = nowMs - ONE_HOUR_MS;

  // Active / accepted jobs considered for hourly quota
  const activeStatuses = new Set([
    'queued',
    'approved',
    'claimed',
    'downloading',
    'submitted',
    'printing',
    'completed'
  ]);

  const urgentJobsInWindow: { job: PrintJob; timestampMs: number }[] = [];
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
  const hourlyRemaining =
    hourlyCap !== null ? Math.max(0, hourlyCap - hourlyUsage) : null;

  // Queued urgent jobs count
  const currentlyQueuedUrgent = allShopJobs.filter(
    j => j.priority_tier === 'urgent' && j.status === 'queued'
  ).length;

  const queueCap =
    typeof config.max_urgent_jobs_in_queue === 'number' && config.max_urgent_jobs_in_queue > 0
      ? config.max_urgent_jobs_in_queue
      : null;
  const queueRemaining =
    queueCap !== null ? Math.max(0, queueCap - currentlyQueuedUrgent) : null;

  // Fairness check: oldest flexible job wait
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
    // Find the earliest job in the window that will roll off
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
