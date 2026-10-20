import type { IPrintJobsRepository } from '../print-jobs/print-jobs.repository.js';
import type { IShopsRepository } from '../shops/shops.repository.js';
import type { IPrintersRepository } from '../printers/printers.repository.js';
import type { PriorityTier, PrintJob } from '../print-jobs/print-jobs.types.js';
import type {
  UrgentSurchargeResult,
  ShopQueueResponse,
  LiveEtaRequest,
  LiveEtaResponse,
  ReassignPrinterRequest,
  QueueJobSummary,
  CustomerRedactedQueueJob
} from './queue.types.js';
import {
  computeUrgentSurcharge,
  projectQueueSchedule,
  calculateLiveEta
} from './queue.calculator.js';

export class QueueError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
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
  constructor(
    private readonly printJobsRepo: IPrintJobsRepository,
    private readonly shopsRepo: IShopsRepository,
    private readonly printersRepo?: IPrintersRepository
  ) {}

  /**
   * Calculates urgent surcharge for a given shop and base price.
   */
  async calculateUrgentSurcharge(
    shopId: string,
    basePricePaise: number,
    tier: PriorityTier
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

    return computeUrgentSurcharge(
      shopId,
      basePricePaise,
      tier,
      shop.urgent_surcharge_config
    );
  }

  /**
   * Retrieves shop queue view with live non-preemptive two-tier ordering and calculated ETAs.
   * Redacts sensitive job and customer metadata when accessed by customers.
   */
  async getShopQueue(
    shopId: string,
    options: GetShopQueueOptions = {}
  ): Promise<ShopQueueResponse> {
    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new QueueError('SHOP_NOT_FOUND', `Shop '${shopId}' not found`, 404);
    }

    // Partition all shop jobs into currently executing vs pending queued
    let allJobs: PrintJob[] = [];
    if (typeof this.printJobsRepo.findAllByShop === 'function') {
      allJobs = await this.printJobsRepo.findAllByShop(shopId);
    } else {
      allJobs = await this.printJobsRepo.findQueueByShop(shopId);
    }

    const executingStatuses = new Set(['printing', 'claimed', 'downloading', 'submitted']);
    const currentlyExecuting = allJobs.find(j => executingStatuses.has(j.status)) ?? null;
    const queuedJobs = allJobs.filter(j => j.status === 'queued');

    const schedule = projectQueueSchedule(currentlyExecuting, queuedJobs);

    // Active printers count
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

    // Apply privacy redaction unless privileged owner or admin
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
   * Calculates live projected queue position and waiting time for a hypothetical new job.
   */
  async getLiveEta(request: LiveEtaRequest): Promise<LiveEtaResponse> {
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

    const executingStatuses = new Set(['printing', 'claimed', 'downloading', 'submitted']);
    const currentlyExecuting = allJobs.find(j => executingStatuses.has(j.status)) ?? null;
    const queuedJobs = allJobs.filter(j => j.status === 'queued');

    return calculateLiveEta(request, currentlyExecuting, queuedJobs);
  }

  /**
   * Re-evaluates and persists derived queue_position for all active jobs in the shop.
   */
  async recalculateQueue(shopId: string): Promise<ShopQueueResponse> {
    const queueView = await this.getShopQueue(shopId, { callerRole: 'owner' });

    // Persist calculated queue positions back to repository
    for (const item of queueView.queue) {
      await this.printJobsRepo.update(item.id, {
        queue_position: item.queue_position
      });
    }

    return queueView;
  }

  /**
   * Reassigns a queued job to an alternate printer (e.g. after paper jam or device offline).
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
