/**
 * Queue orchestration service for CAPS.
 * Implements two-tier priority queueing, non-preemption of printing jobs,
 * atomic next-job selection under concurrency, privacy-redacted queue views,
 * live ETA estimation, and urgent cap guardrails.
 */

import crypto from 'node:crypto';
import {
  ApiError,
  AuthError,
  NotFoundError,
  ValidationError
} from '../../plugins/error-handler.js';
import type { IPrintJobsRepository } from '../print-jobs/print-jobs.repository.js';
import type { IShopsRepository } from '../shops/shops.repository.js';
import type { IPrintersRepository } from '../printers/printers.repository.js';
import type { PrintJobRecord, PriorityTier } from '../print-jobs/print-jobs.types.js';
import type { Shop } from '../shops/shops.types.js';
import type {
  ShopQueueResponse,
  LiveEtaRequest,
  LiveEtaResponse,
  ReassignPrinterRequest,
  QueueJobSummary,
  CustomerRedactedQueueJob,
  UrgentCapStatus,
  ConfigureUrgentPolicyRequest,
  UrgentSurchargeResult
} from './queue.types.js';
import {
  sortQueueJobs,
  projectQueueSchedule,
  calculateLiveEta,
  evaluateUrgentCapAndFairness,
  isActivelyExecuting,
  computeUrgentSurcharge
} from './queue.calculator.js';

export class QueueError extends ApiError {
  constructor(arg1: number | string, arg2: string, arg3?: number | string, arg4?: unknown) {
    if (typeof arg1 === 'number') {
      super(arg1, arg2, typeof arg3 === 'string' ? arg3 : '', arg4);
      this.name = 'QueueError';
    } else {
      const code = arg1;
      const message = arg2;
      const statusCode = typeof arg3 === 'number' ? arg3 : 400;
      super(statusCode, code, message, arg4);
      this.name = 'QueueError';
    }
  }
}

export interface GetShopQueueOptions {
  callerCustomerId?: string | undefined;
  callerRole?: string | undefined;
}

export class QueueService {
  private readonly urgentReservations: Map<string, Array<{ id: string; expiresAtMs: number }>> =
    new Map();
  private readonly locks: Map<string, Promise<void>> = new Map();

  constructor(
    private readonly printJobsRepo: IPrintJobsRepository,
    private readonly shopsRepo: IShopsRepository,
    private readonly printersRepo?: IPrintersRepository
  ) {}

  /**
   * Concurrency mutex wrapper guaranteeing atomic isolation per shop.
   */
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
   * Retrieves all jobs for a shop.
   */
  private async fetchAllShopJobs(shopId: string): Promise<PrintJobRecord[]> {
    const result = await this.printJobsRepo.findAll({ shop_id: shopId, limit: 1000 });
    return result.jobs;
  }

  /**
   * Evaluates the current urgent cap status (hourly quota, queue depth, fairness guard).
   */
  async getUrgentCapStatus(shopId: string, nowMs: number = Date.now()): Promise<UrgentCapStatus> {
    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new QueueError('SHOP_NOT_FOUND', `Shop '${shopId}' not found`, 404);
    }

    const allJobs = await this.fetchAllShopJobs(shopId);
    const status = evaluateUrgentCapAndFairness(
      shopId,
      allJobs,
      shop.urgent_surcharge_config,
      nowMs
    );

    // Account for active in-flight reservations
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
      list.push({ id: reservationId, expiresAtMs: nowMs + 10 * 60 * 1000 }); // 10 min TTL
      this.urgentReservations.set(shopId, list);

      return {
        reservation_id: reservationId,
        cap_status: status
      };
    });
  }

  /**
   * Releases an urgent checkout reservation if cancelled or timed out.
   */
  async releaseUrgentReservation(shopId: string, reservationId: string): Promise<void> {
    const list = this.urgentReservations.get(shopId) ?? [];
    const updated = list.filter(r => r.id !== reservationId);
    this.urgentReservations.set(shopId, updated);
  }

  /**
   * Configures shop urgent surcharge, hourly limits, queue caps, and starvation fairness policies.
   */
  async configureUrgentPolicy(shopId: string, dto: ConfigureUrgentPolicyRequest): Promise<Shop> {
    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new QueueError('SHOP_NOT_FOUND', `Shop '${shopId}' not found`, 404);
    }

    if (dto.type && dto.type !== 'flat' && dto.type !== 'percentage') {
      throw new ValidationError("Surcharge type must be 'flat' or 'percentage'");
    }
    if (typeof dto.amount === 'number' && dto.amount < 0) {
      throw new ValidationError('Surcharge amount must be non-negative');
    }
    if (typeof dto.max_urgent_jobs_per_hour === 'number' && dto.max_urgent_jobs_per_hour < 0) {
      throw new ValidationError('Max urgent jobs per hour must be non-negative');
    }
    if (typeof dto.max_urgent_jobs_in_queue === 'number' && dto.max_urgent_jobs_in_queue < 0) {
      throw new ValidationError('Max urgent jobs in queue must be non-negative');
    }
    if (
      typeof dto.max_flexible_wait_threshold_seconds === 'number' &&
      dto.max_flexible_wait_threshold_seconds < 0
    ) {
      throw new ValidationError('Max flexible wait threshold must be non-negative');
    }

    const currentConfig = shop.urgent_surcharge_config ?? {
      enabled: false,
      type: 'flat',
      amount: 0,
      max_urgent_jobs_per_hour: 5,
      max_urgent_jobs_in_queue: 5,
      fairness_guard_enabled: true,
      max_flexible_wait_threshold_seconds: 900
    };

    const updatedConfig = {
      ...currentConfig,
      type: dto.type ?? currentConfig.type,
      amount: dto.amount ?? currentConfig.amount,
      max_urgent_jobs_per_hour:
        dto.max_urgent_jobs_per_hour !== undefined
          ? dto.max_urgent_jobs_per_hour === null
            ? undefined
            : dto.max_urgent_jobs_per_hour
          : currentConfig.max_urgent_jobs_per_hour,
      max_urgent_jobs_in_queue:
        dto.max_urgent_jobs_in_queue !== undefined
          ? dto.max_urgent_jobs_in_queue === null
            ? undefined
            : dto.max_urgent_jobs_in_queue
          : currentConfig.max_urgent_jobs_in_queue,
      fairness_guard_enabled:
        dto.fairness_guard_enabled !== undefined
          ? dto.fairness_guard_enabled
          : currentConfig.fairness_guard_enabled,
      max_flexible_wait_threshold_seconds:
        dto.max_flexible_wait_threshold_seconds !== undefined
          ? dto.max_flexible_wait_threshold_seconds === null
            ? undefined
            : dto.max_flexible_wait_threshold_seconds
          : currentConfig.max_flexible_wait_threshold_seconds
    };

    const updatedShop = await this.shopsRepo.update(shopId, {
      urgent_surcharge_config: updatedConfig
    });

    if (!updatedShop) {
      throw new NotFoundError(`Failed to update shop '${shopId}'`);
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
      throw new ValidationError('Base price in paise must be non-negative');
    }
    if (tier !== 'urgent' && tier !== 'flexible') {
      throw new ValidationError(`Priority tier must be 'urgent' or 'flexible', received '${tier}'`);
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
   * Atomically fetches the next eligible job for execution in exact priority order.
   * Concurrency-safe: multiple simultaneous claims for the same shop will not dispatch
   * duplicate jobs or violate priority ordering.
   */
  async getNextEligibleJob(shopId: string, printerId?: string): Promise<PrintJobRecord | null> {
    return this.withLock(shopId, async () => {
      const shop = await this.shopsRepo.findById(shopId);
      if (!shop) {
        throw new NotFoundError(`Shop '${shopId}' not found.`);
      }

      const allJobs = await this.fetchAllShopJobs(shopId);

      // Eligible jobs must be queued or approved and match printer if specified
      const eligibleJobs = allJobs.filter(job => {
        const isEligibleStatus = job.status === 'queued' || job.status === 'approved';
        if (!isEligibleStatus) return false;
        if (printerId && job.printer_id && job.printer_id !== printerId) return false;
        return true;
      });

      if (eligibleJobs.length === 0) {
        return null;
      }

      // Sort strictly using two-tier priority ordering
      const sorted = sortQueueJobs(eligibleJobs);
      return sorted[0] ?? null;
    });
  }

  /**
   * Retrieves the dynamic priority queue view for a shop.
   * Redacts other customers' sensitive information if the caller is a customer.
   */
  async getShopQueue(
    shopId: string,
    options: GetShopQueueOptions = {},
    nowMs: number = Date.now()
  ): Promise<ShopQueueResponse> {
    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new QueueError('SHOP_NOT_FOUND', `Shop '${shopId}' not found`, 404);
    }

    const allJobs = await this.fetchAllShopJobs(shopId);

    // Active execution statuses: printing, claimed, downloading, submitted
    const currentlyExecuting = allJobs.find(j => isActivelyExecuting(j.status)) ?? null;

    // Queued statuses: queued, approved
    const queuedJobs = allJobs.filter(j => j.status === 'queued' || j.status === 'approved');

    const schedule = projectQueueSchedule(currentlyExecuting, queuedJobs, nowMs);

    const urgentCount = queuedJobs.filter(j => j.priority_tier === 'urgent').length;
    const flexibleCount = queuedJobs.filter(j => j.priority_tier === 'flexible').length;

    let activePrintersCount = 1;
    if (this.printersRepo) {
      const result = await this.printersRepo.findByShopId(shopId);
      activePrintersCount =
        result.printers.filter(p => p.status === 'online' || p.status === 'busy').length || 1;
    }

    const isCustomerCaller = options.callerRole === 'customer';
    const callerCustomerId = options.callerCustomerId;

    const formatJob = (job: QueueJobSummary): QueueJobSummary | CustomerRedactedQueueJob => {
      if (!isCustomerCaller) {
        return job;
      }

      const isCallerJob = Boolean(callerCustomerId && job.customer_id === callerCustomerId);

      if (isCallerJob) {
        return {
          id: job.id,
          priority_tier: job.priority_tier,
          status: job.status,
          queue_position: job.queue_position,
          estimated_wait_seconds: job.estimated_wait_seconds,
          projected_completion_time: job.projected_completion_time,
          is_caller_job: true,
          pages: job.pages,
          copies: job.copies,
          color_mode: job.color_mode,
          duplex: job.duplex,
          binding: job.binding,
          price_total_paise: job.price_total_paise
        };
      }

      // Redact other customers' jobs entirely per privacy policy
      return {
        id: job.id,
        priority_tier: job.priority_tier,
        status: job.status,
        queue_position: job.queue_position,
        estimated_wait_seconds: job.estimated_wait_seconds,
        projected_completion_time: job.projected_completion_time,
        is_caller_job: false
      };
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
      generated_at: new Date(nowMs).toISOString()
    };
  }

  /**
   * Calculates live projected queue position and waiting time, noting urgent cap availability.
   */
  async getLiveEta(request: LiveEtaRequest, nowMs: number = Date.now()): Promise<LiveEtaResponse> {
    if (request.pages <= 0) {
      throw new ValidationError('Page count must be greater than zero.');
    }
    if ((request.copies ?? 1) <= 0) {
      throw new ValidationError('Copy count must be greater than zero.');
    }
    if (request.priority_tier !== 'urgent' && request.priority_tier !== 'flexible') {
      throw new ValidationError(
        `Priority tier must be 'urgent' or 'flexible', received '${request.priority_tier}'.`
      );
    }

    const shop = await this.shopsRepo.findById(request.shop_id);
    if (!shop) {
      throw new NotFoundError(`Shop '${request.shop_id}' not found.`);
    }

    const allJobs = await this.fetchAllShopJobs(request.shop_id);

    const currentlyExecuting = allJobs.find(j => isActivelyExecuting(j.status)) ?? null;
    const queuedJobs = allJobs.filter(j => j.status === 'queued' || j.status === 'approved');

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
   * Recalculates dynamic queue positions and updates the cached queue_position field.
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
   * Reassigns a queued job to an alternate printer within the shop.
   */
  async reassignPrinter(
    request: ReassignPrinterRequest
  ): Promise<{ job: PrintJobRecord; queue: ShopQueueResponse }> {
    const job = await this.printJobsRepo.findById(request.job_id);
    if (!job) {
      throw new NotFoundError(`Job '${request.job_id}' not found.`);
    }

    if (job.shop_id !== request.shop_id) {
      throw new AuthError(403, 'FORBIDDEN', `Job does not belong to shop '${request.shop_id}'.`);
    }

    if (this.printersRepo) {
      const printer = await this.printersRepo.findById(request.new_printer_id);
      if (!printer) {
        throw new NotFoundError(`Printer '${request.new_printer_id}' not found.`);
      }
      if (printer.shop_id !== request.shop_id) {
        throw new AuthError(
          403,
          'FORBIDDEN',
          `Printer does not belong to shop '${request.shop_id}'.`
        );
      }
      if (printer.status === 'offline' || printer.status === 'error') {
        throw new QueueError(
          409,
          'PRINTER_OFFLINE',
          `Cannot assign job to printer with status '${printer.status}'.`
        );
      }
    }

    const updated = await this.printJobsRepo.update(request.job_id, {
      printer_id: request.new_printer_id
    });

    if (!updated) {
      throw new QueueError(500, 'UPDATE_FAILED', `Failed to update job '${request.job_id}'.`);
    }

    const updatedQueue = await this.recalculateQueue(request.shop_id);

    return {
      job: updated,
      queue: updatedQueue
    };
  }
}
