import crypto from 'node:crypto';
import type { IPrintJobsRepository } from '../print-jobs/print-jobs.repository.js';
import type { IShopsRepository } from '../shops/shops.repository.js';
import type { IPrintersRepository } from '../printers/printers.repository.js';
import type { PriorityTier, PrintJob } from '../print-jobs/print-jobs.types.js';
import type { Shop } from '../shops/shops.types.js';
import type {
  UrgentSurchargeResult,
  ShopQueueResponse,
  LiveEtaRequest,
  LiveEtaResponse,
  ReassignPrinterRequest,
  QueueJobSummary,
  CustomerRedactedQueueJob,
  UrgentCapStatus,
  ConfigureUrgentPolicyRequest
} from './queue.types.js';
import {
  computeUrgentSurcharge,
  projectQueueSchedule,
  calculateLiveEta,
  evaluateUrgentCapAndFairness
} from './queue.calculator.js';

export class QueueError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'QueueError';
  }
}

export interface GetShopQueueOptions {
  callerCustomerId?: string | undefined;
  callerRole?: string | undefined;
}

export class QueueService {
  private readonly urgentReservations: Map<
    string,
    Array<{ id: string; expiresAtMs: number }>
  > = new Map();
  private readonly locks: Map<string, Promise<void>> = new Map();

  constructor(
    private readonly printJobsRepo: IPrintJobsRepository,
    private readonly shopsRepo: IShopsRepository,
    private readonly printersRepo?: IPrintersRepository
  ) {}

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const currentLock = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const newLock = new Promise<void>(resolve => {
      release = resolve;
    });
    this.locks.set(key, newLock);
    await currentLock;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === newLock) {
        this.locks.delete(key);
      }
    }
  }

  private cleanupReservations(shopId: string, nowMs: number): number {
    const list = this.urgentReservations.get(shopId) ?? [];
    const active = list.filter(r => r.expiresAtMs > nowMs);
    this.urgentReservations.set(shopId, active);
    return active.length;
  }

  /**
   * Evaluates the current urgent cap status (hourly quota, queue depth, fairness guard).
   */
  async getUrgentCapStatus(
    shopId: string,
    nowMs: number = Date.now()
  ): Promise<UrgentCapStatus> {
    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new QueueError('SHOP_NOT_FOUND', `Shop '${shopId}' not found`, 404);
    }

    let allJobs: PrintJob[] = [];
    if (typeof this.printJobsRepo.findAllByShop === 'function') {
      allJobs = await this.printJobsRepo.findAllByShop(shopId);
    } else {
      allJobs = await this.printJobsRepo.findQueueByShop(shopId);
    }

    const status = evaluateUrgentCapAndFairness(
      shopId,
      allJobs,
      shop.urgent_surcharge_config,
      nowMs
    );

    // Account for active reservations in rolling window
    const activeReservations = this.cleanupReservations(shopId, nowMs);
    if (
      status.hourly_cap !== null &&
      status.is_urgent_available &&
      status.hourly_usage + activeReservations >= status.hourly_cap
    ) {
      status.is_urgent_available = false;
      status.hourly_usage += activeReservations;
      status.hourly_remaining = 0;
      status.rejection_details = {
        cap_type: 'hourly',
        limit: status.hourly_cap,
        current_usage: status.hourly_usage,
        fallback_tier: 'flexible',
        message: `Shop urgent order cap of ${status.hourly_cap} jobs/hour has been reached by concurrent checkouts. Please choose standard flexible tier.`
      };
    }

    return status;
  }

  /**
   * Atomically validates admission and reserves an urgent slot to prevent concurrent cap breaches.
   */
  async reserveUrgentAdmission(
    shopId: string,
    nowMs: number = Date.now()
  ): Promise<{ reservation_id: string; cap_status: UrgentCapStatus }> {
    return this.withLock(shopId, async () => {
      const status = await this.getUrgentCapStatus(shopId, nowMs);
      if (!status.is_urgent_available) {
        const code =
          status.rejection_details?.cap_type === 'hourly'
            ? 'URGENT_CAP_EXCEEDED'
            : status.rejection_details?.cap_type === 'queue_depth'
            ? 'URGENT_QUEUE_LIMIT_REACHED'
            : 'FAIRNESS_GUARD_TRIGGERED';

        throw new QueueError(
          code,
          status.rejection_details?.message ?? 'Urgent tier unavailable',
          429,
          status.rejection_details
        );
      }

      const reservationId = crypto.randomUUID();
      const list = this.urgentReservations.get(shopId) ?? [];
      list.push({ id: reservationId, expiresAtMs: nowMs + 10000 }); // 10s reservation window
      this.urgentReservations.set(shopId, list);

      return {
        reservation_id: reservationId,
        cap_status: status
      };
    });
  }

  /**
   * Configures shop urgent surcharge, hourly limits, queue caps, and starvation fairness policies.
   */
  async configureUrgentPolicy(
    shopId: string,
    dto: ConfigureUrgentPolicyRequest
  ): Promise<Shop> {
    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new QueueError('SHOP_NOT_FOUND', `Shop '${shopId}' not found`, 404);
    }

    if (dto.type && dto.type !== 'flat' && dto.type !== 'percentage') {
      throw new QueueError(
        'VALIDATION_ERROR',
        "Surcharge type must be 'flat' or 'percentage'",
        400
      );
    }
    if (typeof dto.amount === 'number' && dto.amount < 0) {
      throw new QueueError(
        'VALIDATION_ERROR',
        'Surcharge amount must be non-negative',
        400
      );
    }
    if (
      typeof dto.max_urgent_jobs_per_hour === 'number' &&
      dto.max_urgent_jobs_per_hour < 0
    ) {
      throw new QueueError(
        'VALIDATION_ERROR',
        'Max urgent jobs per hour must be non-negative',
        400
      );
    }
    if (
      typeof dto.max_urgent_jobs_in_queue === 'number' &&
      dto.max_urgent_jobs_in_queue < 0
    ) {
      throw new QueueError(
        'VALIDATION_ERROR',
        'Max urgent jobs in queue must be non-negative',
        400
      );
    }
    if (
      typeof dto.max_flexible_wait_threshold_seconds === 'number' &&
      dto.max_flexible_wait_threshold_seconds < 0
    ) {
      throw new QueueError(
        'VALIDATION_ERROR',
        'Max flexible wait threshold must be non-negative',
        400
      );
    }

    const updatedConfig = {
      type: dto.type ?? shop.urgent_surcharge_config.type,
      amount: dto.amount ?? shop.urgent_surcharge_config.amount,
      max_urgent_jobs_per_hour:
        dto.max_urgent_jobs_per_hour !== undefined
          ? (dto.max_urgent_jobs_per_hour === null ? undefined : dto.max_urgent_jobs_per_hour)
          : shop.urgent_surcharge_config.max_urgent_jobs_per_hour,
      max_urgent_jobs_in_queue:
        dto.max_urgent_jobs_in_queue !== undefined
          ? (dto.max_urgent_jobs_in_queue === null ? undefined : dto.max_urgent_jobs_in_queue)
          : shop.urgent_surcharge_config.max_urgent_jobs_in_queue,
      fairness_guard_enabled:
        dto.fairness_guard_enabled !== undefined
          ? dto.fairness_guard_enabled
          : shop.urgent_surcharge_config.fairness_guard_enabled,
      max_flexible_wait_threshold_seconds:
        dto.max_flexible_wait_threshold_seconds !== undefined
          ? (dto.max_flexible_wait_threshold_seconds === null ? undefined : dto.max_flexible_wait_threshold_seconds)
          : shop.urgent_surcharge_config.max_flexible_wait_threshold_seconds
    };

    const updatedShop = await this.shopsRepo.update(shopId, {
      urgent_surcharge_config: updatedConfig
    });

    if (!updatedShop) {
      throw new QueueError('SHOP_NOT_FOUND', `Failed to update shop '${shopId}'`, 404);
    }

    return updatedShop;
  }

  /**
   * Calculates urgent surcharge for a given shop and base price, verifying cap eligibility.
   */
  async calculateUrgentSurcharge(
    shopId: string,
    basePricePaise: number,
    tier: PriorityTier,
    nowMs: number = Date.now()
  ): Promise<UrgentSurchargeResult> {
    if (basePricePaise < 0) {
      throw new QueueError(
        'VALIDATION_ERROR',
        'Base price in paise must be non-negative',
        400
      );
    }
    if (tier !== 'urgent' && tier !== 'flexible') {
      throw new QueueError(
        'INVALID_PRIORITY_TIER',
        `Priority tier must be 'urgent' or 'flexible', received '${tier}'`,
        400
      );
    }

    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new QueueError('SHOP_NOT_FOUND', `Shop '${shopId}' not found`, 404);
    }

    const surcharge = computeUrgentSurcharge(
      shopId,
      basePricePaise,
      tier,
      shop.urgent_surcharge_config
    );

    const capStatus = await this.getUrgentCapStatus(shopId, nowMs);

    return {
      ...surcharge,
      urgent_available: tier === 'urgent' ? capStatus.is_urgent_available : true,
      cap_status: capStatus
    };
  }

  /**
   * Retrieves shop queue view with live non-preemptive two-tier ordering and calculated ETAs.
   */
  async getShopQueue(
    shopId: string,
    options: GetShopQueueOptions = {}
  ): Promise<ShopQueueResponse> {
    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new QueueError('SHOP_NOT_FOUND', `Shop '${shopId}' not found`, 404);
    }

    let allJobs: PrintJob[] = [];
    if (typeof this.printJobsRepo.findAllByShop === 'function') {
      allJobs = await this.printJobsRepo.findAllByShop(shopId);
    } else {
      allJobs = await this.printJobsRepo.findQueueByShop(shopId);
    }

    const executingStatuses = new Set([
      'printing',
      'claimed',
      'downloading',
      'submitted'
    ]);
    const currentlyExecuting = allJobs.find(j => executingStatuses.has(j.status)) ?? null;
    const queuedJobs = allJobs.filter(j => j.status === 'queued');

    const schedule = projectQueueSchedule(currentlyExecuting, queuedJobs);

    let activePrintersCount = 1;
    if (this.printersRepo) {
      const printers = await this.printersRepo.findByShopId(shopId);
      const onlinePrinters = printers.filter(
        p => p.status !== 'offline' && p.status !== 'error'
      );
      activePrintersCount = Math.max(1, onlinePrinters.length);
    }

    const urgentCount = queuedJobs.filter(j => j.priority_tier === 'urgent').length;
    const flexibleCount = queuedJobs.filter(j => j.priority_tier === 'flexible').length;

    const isPrivileged =
      options.callerRole === 'owner' || options.callerRole === 'admin';

    const formatJob = (
      job: QueueJobSummary
    ): QueueJobSummary | CustomerRedactedQueueJob => {
      if (isPrivileged) return job;

      const isCallerJob =
        Boolean(options.callerCustomerId) &&
        job.customer_id === options.callerCustomerId;

      const redacted: CustomerRedactedQueueJob = {
        id: job.id,
        priority_tier: job.priority_tier,
        status: job.status,
        queue_position: job.queue_position,
        estimated_wait_seconds: job.estimated_wait_seconds,
        projected_completion_time: job.projected_completion_time,
        is_caller_job: isCallerJob
      };

      if (isCallerJob) {
        redacted.pages = job.pages;
        redacted.copies = job.copies;
        redacted.color_mode = job.color_mode;
        redacted.duplex = job.duplex;
        redacted.binding = job.binding;
        redacted.price_total_paise = job.price_total_paise;
      }

      return redacted;
    };

    const finalPrinting = schedule.currentlyPrintingSummary
      ? formatJob(schedule.currentlyPrintingSummary)
      : null;

    const finalQueue = schedule.scheduledQueue.map(formatJob);

    return {
      shop_id: shopId,
      currently_printing: finalPrinting,
      queue: finalQueue,
      urgent_count: urgentCount,
      flexible_count: flexibleCount,
      total_queued: queuedJobs.length,
      total_estimated_wait_seconds: schedule.totalWaitSeconds,
      active_printers_count: activePrintersCount,
      generated_at: new Date().toISOString()
    };
  }

  /**
   * Calculates live projected queue position and waiting time, noting cap availability.
   */
  async getLiveEta(
    request: LiveEtaRequest,
    nowMs: number = Date.now()
  ): Promise<LiveEtaResponse> {
    if (request.pages <= 0) {
      throw new QueueError(
        'VALIDATION_ERROR',
        'Page count must be greater than zero',
        400
      );
    }
    if ((request.copies ?? 1) <= 0) {
      throw new QueueError(
        'VALIDATION_ERROR',
        'Copy count must be greater than zero',
        400
      );
    }
    if (request.priority_tier !== 'urgent' && request.priority_tier !== 'flexible') {
      throw new QueueError(
        'INVALID_PRIORITY_TIER',
        `Priority tier must be 'urgent' or 'flexible', received '${request.priority_tier}'`,
        400
      );
    }

    const shop = await this.shopsRepo.findById(request.shop_id);
    if (!shop) {
      throw new QueueError('SHOP_NOT_FOUND', `Shop '${request.shop_id}' not found`, 404);
    }

    let allJobs: PrintJob[] = [];
    if (typeof this.printJobsRepo.findAllByShop === 'function') {
      allJobs = await this.printJobsRepo.findAllByShop(request.shop_id);
    } else {
      allJobs = await this.printJobsRepo.findQueueByShop(request.shop_id);
    }

    const executingStatuses = new Set([
      'printing',
      'claimed',
      'downloading',
      'submitted'
    ]);
    const currentlyExecuting = allJobs.find(j => executingStatuses.has(j.status)) ?? null;
    const queuedJobs = allJobs.filter(j => j.status === 'queued');

    const eta = calculateLiveEta(request, currentlyExecuting, queuedJobs, nowMs);

    let urgentAvailable = true;
    let capRejection = undefined;

    if (request.priority_tier === 'urgent') {
      const capStatus = await this.getUrgentCapStatus(request.shop_id, nowMs);
      urgentAvailable = capStatus.is_urgent_available;
      if (!urgentAvailable && capStatus.rejection_details) {
        capRejection = capStatus.rejection_details;
      }
    }

    return {
      ...eta,
      urgent_available: urgentAvailable,
      ...(capRejection !== undefined ? { cap_rejection: capRejection } : {})
    };
  }

  /**
   * Re-evaluates and persists derived queue_position for all active jobs in the shop.
   */
  async recalculateQueue(shopId: string): Promise<ShopQueueResponse> {
    const queueView = await this.getShopQueue(shopId, { callerRole: 'owner' });

    for (const item of queueView.queue) {
      await this.printJobsRepo.update(item.id, {
        queue_position: item.queue_position
      });
    }

    return queueView;
  }

  /**
   * Reassigns a queued job to an alternate printer.
   */
  async reassignPrinter(
    request: ReassignPrinterRequest
  ): Promise<{ job: PrintJob; queue: ShopQueueResponse }> {
    const job = await this.printJobsRepo.findById(request.job_id);
    if (!job) {
      throw new QueueError('JOB_NOT_FOUND', `Job '${request.job_id}' not found`, 404);
    }

    if (job.shop_id !== request.shop_id) {
      throw new QueueError(
        'FORBIDDEN_SHOP_ACCESS',
        `Job does not belong to shop '${request.shop_id}'`,
        403
      );
    }

    if (this.printersRepo) {
      const printer = await this.printersRepo.findById(request.new_printer_id);
      if (!printer) {
        throw new QueueError(
          'PRINTER_NOT_FOUND',
          `Printer '${request.new_printer_id}' not found`,
          404
        );
      }
      if (printer.shop_id !== request.shop_id) {
        throw new QueueError(
          'FORBIDDEN_SHOP_ACCESS',
          `Printer does not belong to shop '${request.shop_id}'`,
          403
        );
      }
      if (printer.status === 'offline' || printer.status === 'error') {
        throw new QueueError(
          'PRINTER_OFFLINE',
          `Cannot assign job to printer with status '${printer.status}'`,
          409
        );
      }
    }

    const updated = await this.printJobsRepo.update(request.job_id, {
      printer_id: request.new_printer_id
    });

    if (!updated) {
      throw new QueueError('JOB_NOT_FOUND', `Failed to update job '${request.job_id}'`, 404);
    }

    const updatedQueue = await this.recalculateQueue(request.shop_id);

    return {
      job: updated,
      queue: updatedQueue
    };
  }
}
