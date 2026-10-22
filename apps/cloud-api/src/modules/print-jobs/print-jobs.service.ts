import {
  ApiError,
  AuthError,
  NotFoundError,
  ValidationError
} from '../../plugins/error-handler.js';
import type { IShopsRepository } from '../shops/shops.repository.js';
import type { IQuotesRepository } from '../pricing/quotes.repository.js';
import type { IDocumentsRepository } from '../documents/documents.repository.js';
import type { IPrintJobsRepository } from './print-jobs.repository.js';
import { assertValidTransition } from './print-jobs.state-machine.js';
import { calculatePriceBreakdown } from '../pricing/pricing.calculator.js';
import type {
  PrintJobRecord,
  CreatePrintJobInput,
  ListPrintJobsFilter,
  JobStatus,
  PrintSettings
} from './print-jobs.types.js';

export class PrintJobError extends ApiError {
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(statusCode, code, message, details);
    this.name = 'PrintJobError';
  }
}

export class PrintJobsService {
  constructor(
    private readonly jobsRepo: IPrintJobsRepository,
    private readonly shopsRepo: IShopsRepository,
    private readonly quotesRepo: IQuotesRepository,
    private readonly documentsRepo: IDocumentsRepository
  ) {}

  async createPrintJob(
    user: { id: string; role: string },
    input: CreatePrintJobInput,
    idempotencyKey?: string
  ): Promise<{ job: PrintJobRecord; isIdempotentReplay: boolean }> {
    // 1. Idempotency Check: if identical idempotencyKey exists for customer, return existing job
    if (idempotencyKey) {
      const existing = await this.jobsRepo.findByIdempotencyKey(idempotencyKey, user.id);
      if (existing) {
        return { job: existing, isIdempotentReplay: true };
      }
    }

    // 2. Validate shop exists and is open
    const shop = await this.shopsRepo.findById(input.shop_id);
    if (!shop) {
      throw new NotFoundError(`Shop "${input.shop_id}" not found.`);
    }

    if (shop.status === 'closed') {
      throw new PrintJobError(
        400,
        'SHOP_CLOSED',
        `Shop "${shop.name}" is currently closed and not accepting print orders.`
      );
    }

    // 3. Resolve document and storage key
    let storageKey = input.document_storage_key;
    if (input.document_id) {
      const doc = await this.documentsRepo.findById(input.document_id);
      if (!doc) {
        throw new NotFoundError(`Document "${input.document_id}" not found.`);
      }
      if (doc.status === 'purged') {
        throw new PrintJobError(410, 'DOCUMENT_PURGED', 'Document has already been purged.');
      }
      if (doc.status !== 'ready') {
        throw new ValidationError(
          `Document "${input.document_id}" is not ready for printing (status: ${doc.status}).`
        );
      }
      if (user.role !== 'admin' && doc.customer_id !== user.id) {
        throw new AuthError(
          403,
          'FORBIDDEN',
          `Forbidden: You do not own document "${input.document_id}".`
        );
      }
      storageKey = doc.storage_key;
    }

    if (!storageKey) {
      throw new ValidationError(
        'Either a valid document_id or document_storage_key must be provided.'
      );
    }

    // 4. Resolve settings, pricing, and quote snapshot
    let settings = input.settings;
    let priorityTier = input.priority_tier || 'flexible';
    let priceTotalPaise = 0;
    let priceBreakdown = {
      base_pages_paise: 0,
      color_surcharge_paise: 0,
      duplex_discount_paise: 0,
      binding_fee_paise: 0,
      urgent_surcharge_paise: 0,
      subtotal_paise: 0,
      gst_paise: 0,
      total_paise: 0
    };

    let quote = null;
    if (input.quote_id) {
      quote = await this.quotesRepo.findById(input.quote_id);
      if (!quote && !settings) {
        throw new NotFoundError(`Quote "${input.quote_id}" not found.`);
      }
    }

    if (quote) {
      if (new Date(quote.expires_at).getTime() < Date.now() || quote.status === 'expired') {
        throw new PrintJobError(
          410,
          'QUOTE_EXPIRED',
          `Quote "${input.quote_id}" has expired. Please obtain a fresh quote.`
        );
      }
      if (quote.shop_id !== input.shop_id) {
        throw new ValidationError(
          `Quote "${input.quote_id}" was generated for shop "${quote.shop_id}", not "${input.shop_id}".`
        );
      }

      // Canonical immutable settings and pricing locked from authoritative quote snapshot
      settings = quote.settings;
      priorityTier = quote.priority_tier;
      priceTotalPaise = quote.price_breakdown.total_paise;
      priceBreakdown = quote.price_breakdown;

      // Mark quote consumed
      await this.quotesRepo.update(input.quote_id!, { status: 'consumed' });
    } else {
      // Direct settings provided (or quote was generated client-side): compute authoritative price server-side
      if (!settings) {
        throw new ValidationError('Print settings are required when quote_id is not provided.');
      }
      const pageCount = input.document_page_count || input.page_count || 1;
      priceBreakdown = calculatePriceBreakdown({
        settings: settings as unknown as PrintSettings,
        priorityTier,
        pageCount,
        pricingConfig: shop.pricing_config,
        urgentConfig: shop.urgent_surcharge_config
      });
      priceTotalPaise = priceBreakdown.total_paise;
    }

    // 5. Expiration deadline (Strict 24h transient auto-delete deadline per ADR 0007)
    const documentExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // 6. Create job record
    const job = await this.jobsRepo.create({
      shop_id: shop.id,
      customer_id: user.id,
      printer_id: input.printer_id,
      document_id: input.document_id,
      document_storage_key: storageKey,
      settings,
      priority_tier: priorityTier,
      price_total_paise: priceTotalPaise,
      price_breakdown: priceBreakdown,
      status: 'pending_payment',
      idempotency_key: idempotencyKey,
      document_expires_at: documentExpiresAt
    });

    // 7. Audit log initial creation event
    await this.jobsRepo.recordEvent({
      job_id: job.id,
      actor_id: user.id,
      actor_type: 'customer',
      to_status: 'pending_payment',
      reason: 'Order created'
    });

    return { job, isIdempotentReplay: false };
  }

  async getPrintJobById(
    user: { id: string; role: string },
    jobId: string
  ): Promise<PrintJobRecord> {
    const job = await this.jobsRepo.findById(jobId);
    if (!job) {
      throw new NotFoundError(`Print job "${jobId}" not found.`);
    }

    // Role-scoped access enforcement
    if (user.role === 'customer' && job.customer_id !== user.id) {
      throw new AuthError(403, 'FORBIDDEN', `Forbidden: Access denied to print job "${jobId}".`);
    }

    if (user.role === 'shop_owner') {
      const shop = await this.shopsRepo.findById(job.shop_id);
      if (shop?.owner_id !== user.id) {
        throw new AuthError(
          403,
          'FORBIDDEN',
          `Forbidden: You do not own shop "${job.shop_id}" associated with print job "${jobId}".`
        );
      }
    }

    return job;
  }

  async listPrintJobs(
    user: { id: string; role: string },
    filter: ListPrintJobsFilter = {}
  ): Promise<{ jobs: PrintJobRecord[]; total: number }> {
    const scopedFilter: ListPrintJobsFilter = { ...filter };

    if (user.role === 'customer') {
      // Customers can strictly only view their own jobs
      scopedFilter.customer_id = user.id;
    } else if (user.role === 'shop_owner') {
      // Owners can strictly only view jobs for shops they own
      const ownerShops = await this.shopsRepo.findByOwnerId(user.id);
      const ownerShopIds = new Set(ownerShops.map(s => s.id));

      if (scopedFilter.shop_id) {
        if (!ownerShopIds.has(scopedFilter.shop_id)) {
          throw new AuthError(
            403,
            'FORBIDDEN',
            `Forbidden: You do not own shop "${scopedFilter.shop_id}".`
          );
        }
      } else {
        // If no specific shop requested, fetch all and filter by owner's shops
        const result = await this.jobsRepo.findAll(scopedFilter);
        const filtered = result.jobs.filter(j => ownerShopIds.has(j.shop_id));
        return { jobs: filtered, total: filtered.length };
      }
    }

    return this.jobsRepo.findAll(scopedFilter);
  }

  async approvePrintJob(
    user: { id: string; role: string },
    jobId: string
  ): Promise<PrintJobRecord> {
    const job = await this.jobsRepo.findById(jobId);
    if (!job) {
      throw new NotFoundError(`Print job "${jobId}" not found.`);
    }

    // Owner authorization (ADR 0004)
    if (user.role !== 'admin') {
      const shop = await this.shopsRepo.findById(job.shop_id);
      if (shop?.owner_id !== user.id) {
        throw new AuthError(
          403,
          'FORBIDDEN',
          `Forbidden: Only the shop owner can approve print job "${jobId}".`
        );
      }
    }

    // State transition validation (e.g. from queued -> approved)
    assertValidTransition(job.status, 'approved');

    const updated = await this.jobsRepo.update(jobId, {
      status: 'approved'
    });

    if (!updated) {
      throw new PrintJobError(500, 'INTERNAL_ERROR', `Failed to approve job "${jobId}".`);
    }

    await this.jobsRepo.recordEvent({
      job_id: jobId,
      actor_id: user.id,
      actor_type: user.role === 'admin' ? 'system' : 'owner',
      from_status: job.status,
      to_status: 'approved',
      reason: 'Shop owner confirmed job for printing'
    });

    return updated;
  }

  async cancelPrintJob(
    user: { id: string; role: string },
    jobId: string,
    reason?: string
  ): Promise<PrintJobRecord> {
    const job = await this.jobsRepo.findById(jobId);
    if (!job) {
      throw new NotFoundError(`Print job "${jobId}" not found.`);
    }

    // Role check & cancellation permission
    if (user.role === 'customer') {
      if (job.customer_id !== user.id) {
        throw new AuthError(403, 'FORBIDDEN', `Forbidden: You do not own print job "${jobId}".`);
      }
      if (['claimed', 'downloading', 'printing', 'completed'].includes(job.status)) {
        throw new PrintJobError(
          400,
          'CANNOT_CANCEL',
          `Print job cannot be cancelled because it is already in "${job.status}" state.`
        );
      }
    } else if (user.role === 'shop_owner') {
      const shop = await this.shopsRepo.findById(job.shop_id);
      if (shop?.owner_id !== user.id) {
        throw new AuthError(
          403,
          'FORBIDDEN',
          `Forbidden: You do not own the shop for job "${jobId}".`
        );
      }
    }

    assertValidTransition(job.status, 'cancelled');

    const updated = await this.jobsRepo.update(jobId, {
      status: 'cancelled'
    });

    if (!updated) {
      throw new PrintJobError(500, 'INTERNAL_ERROR', `Failed to cancel job "${jobId}".`);
    }

    await this.jobsRepo.recordEvent({
      job_id: jobId,
      actor_id: user.id,
      actor_type: user.role === 'shop_owner' ? 'owner' : 'customer',
      from_status: job.status,
      to_status: 'cancelled',
      reason: reason || 'Job cancelled by user'
    });

    return updated;
  }

  async transitionJobStatus(
    user: { id: string; role: string },
    jobId: string,
    toStatus: JobStatus,
    reason?: string,
    metadata?: Record<string, unknown>
  ): Promise<PrintJobRecord> {
    const job = await this.jobsRepo.findById(jobId);
    if (!job) {
      throw new NotFoundError(`Print job "${jobId}" not found.`);
    }

    // Role authorization for specific state transitions
    if (user.role === 'customer') {
      if (toStatus !== 'cancelled') {
        throw new AuthError(
          403,
          'FORBIDDEN',
          'Forbidden: Customers may only initiate cancellation of their own jobs.'
        );
      }
    } else if (user.role === 'agent') {
      const agentAllowedTargets: JobStatus[] = [
        'claimed',
        'downloading',
        'printing',
        'completed',
        'failed',
        'approved'
      ];
      if (!agentAllowedTargets.includes(toStatus)) {
        throw new AuthError(
          403,
          'FORBIDDEN',
          `Forbidden: Print agents cannot transition jobs directly to "${toStatus}".`
        );
      }
    }

    // State machine graph check
    assertValidTransition(job.status, toStatus);

    const updatePayload: Partial<PrintJobRecord> = { status: toStatus };
    if (toStatus === 'queued' && !job.enqueued_at) {
      updatePayload.enqueued_at = new Date().toISOString();
    }
    if (toStatus === 'claimed') {
      updatePayload.claimed_at = new Date().toISOString();
      updatePayload.claimed_by_agent_id = user.id;
    }
    if (toStatus === 'completed') {
      updatePayload.completed_at = new Date().toISOString();
    }
    if (toStatus === 'failed' && reason) {
      updatePayload.failed_reason = reason;
    }

    const updated = await this.jobsRepo.update(jobId, updatePayload);
    if (!updated) {
      throw new PrintJobError(500, 'INTERNAL_ERROR', `Failed to update job "${jobId}".`);
    }

    await this.jobsRepo.recordEvent({
      job_id: jobId,
      actor_id: user.id,
      actor_type:
        user.role === 'agent'
          ? 'agent'
          : user.role === 'shop_owner'
            ? 'owner'
            : user.role === 'customer'
              ? 'customer'
              : 'system',
      from_status: job.status,
      to_status: toStatus,
      reason,
      metadata
    });

    return updated;
  }
}
