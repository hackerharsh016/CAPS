import { ApiError, NotFoundError, ValidationError } from '../../plugins/error-handler.js';
import type { IShopsRepository } from '../shops/shops.repository.js';
import type { IQuotesRepository } from './quotes.repository.js';
import {
  calculatePriceBreakdown,
  calculateEstimatedWaitMinutes,
  parsePageRange
} from './pricing.calculator.js';
import type { QuoteRequestInput, QuoteResponseData } from './pricing.types.js';

export const QUOTE_EXPIRY_SECONDS = 15 * 60; // 15 minutes (900s)

export class QuoteError extends ApiError {
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(statusCode, code, message, details);
    this.name = 'QuoteError';
  }
}

export class QuotesService {
  constructor(
    private readonly quotesRepo: IQuotesRepository,
    private readonly shopsRepo: IShopsRepository
  ) {}

  async createQuote(
    user: { id: string; role: string } | null,
    input: QuoteRequestInput
  ): Promise<QuoteResponseData> {
    // 1. Verify shop exists
    const shop = await this.shopsRepo.findById(input.shop_id);
    if (!shop) {
      throw new NotFoundError(`Shop "${input.shop_id}" not found.`);
    }

    // 2. Verify shop is open
    if (shop.status === 'closed') {
      throw new QuoteError(
        400,
        'SHOP_CLOSED',
        `Shop "${shop.name}" is currently closed and not accepting quote requests.`
      );
    }

    // 3. Validate page count
    if (
      typeof input.document_page_count !== 'number' ||
      input.document_page_count <= 0 ||
      !Number.isInteger(input.document_page_count)
    ) {
      throw new ValidationError('Document page count must be a positive integer.', {
        document_page_count: input.document_page_count
      });
    }

    // 4. Calculate effective pages based on page range
    const effectivePageCount = parsePageRange(input.settings.page_range, input.document_page_count);

    // 5. Authoritative price breakdown (ignores any client-side price fields)
    const breakdown = calculatePriceBreakdown({
      settings: input.settings,
      priorityTier: input.priority_tier,
      pageCount: effectivePageCount,
      pricingConfig: shop.pricing_config,
      urgentConfig: shop.urgent_surcharge_config
    });

    // 6. Calculate estimated wait time
    const totalPages = effectivePageCount * (input.settings.copies || 1);
    const estimatedWaitMinutes = calculateEstimatedWaitMinutes({
      totalPages,
      priorityTier: input.priority_tier,
      binding: input.settings.binding
    });

    // 7. Calculate quote expiry timestamp (15 minutes)
    const now = Date.now();
    const expiresAt = new Date(now + QUOTE_EXPIRY_SECONDS * 1000).toISOString();

    // 8. Snapshot pricing configuration & store quote record
    const record = await this.quotesRepo.create({
      ...(user ? { customer_id: user.id } : {}),
      shop_id: shop.id,
      ...(input.document_id ? { document_id: input.document_id } : {}),
      settings: input.settings,
      priority_tier: input.priority_tier,
      page_count: effectivePageCount,
      pricing_snapshot: {
        pricing_config: shop.pricing_config,
        urgent_surcharge_config: shop.urgent_surcharge_config
      },
      price_breakdown: breakdown,
      estimated_wait_minutes: estimatedWaitMinutes,
      expires_at: expiresAt
    });

    return {
      quote_id: record.id,
      shop_id: record.shop_id,
      customer_id: record.customer_id,
      settings: record.settings,
      priority_tier: record.priority_tier,
      page_count: record.page_count,
      price_breakdown: record.price_breakdown,
      pricing_snapshot: record.pricing_snapshot,
      estimated_wait_minutes: record.estimated_wait_minutes,
      expires_at: record.expires_at,
      created_at: record.created_at
    };
  }

  async getQuoteById(
    quoteId: string,
    _user?: { id: string; role: string } | null
  ): Promise<QuoteResponseData> {
    const record = await this.quotesRepo.findById(quoteId);
    if (!record) {
      throw new NotFoundError(`Quote "${quoteId}" not found.`);
    }

    // Check expiration
    if (record.status === 'expired' || new Date(record.expires_at).getTime() < Date.now()) {
      if (record.status !== 'expired') {
        await this.quotesRepo.update(quoteId, { status: 'expired' });
      }
      throw new QuoteError(
        410,
        'QUOTE_EXPIRED',
        `Quote "${quoteId}" has expired. Please create a fresh quote request.`
      );
    }

    return {
      quote_id: record.id,
      shop_id: record.shop_id,
      customer_id: record.customer_id,
      settings: record.settings,
      priority_tier: record.priority_tier,
      page_count: record.page_count,
      price_breakdown: record.price_breakdown,
      pricing_snapshot: record.pricing_snapshot,
      estimated_wait_minutes: record.estimated_wait_minutes,
      expires_at: record.expires_at,
      created_at: record.created_at
    };
  }
}
