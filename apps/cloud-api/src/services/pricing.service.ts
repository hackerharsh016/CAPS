/**
 * Pricing Service for CAPS Cloud API (INT-D3-06).
 *
 * Implements:
 * - Authoritative quote calculation strictly in integer paise (1 INR = 100 paise).
 * - Multipliers for paper size (A4, A3, Legal), color mode (bw, color), sides/duplex, and binding.
 * - Idempotent payment recording and database event processing.
 */

export interface PricingRuleConfig {
  basePageBwPaise: number; // e.g. 200 (₹2.00)
  basePageColorPaise: number; // e.g. 1000 (₹10.00)
  duplexMultiplier: number; // e.g. 0.9 (10% discount for double-sided)
  paperSizeMultipliers: Record<string, number>;
  bindingPricesPaise: Record<string, number>;
}

export const DEFAULT_PRICING_CONFIG: PricingRuleConfig = {
  basePageBwPaise: 200, // ₹2.00 per page B&W
  basePageColorPaise: 1000, // ₹10.00 per page Color
  duplexMultiplier: 0.9, // 10% discount on print cost for duplex
  paperSizeMultipliers: {
    a4: 1.0,
    a3: 2.0,
    legal: 1.2
  },
  bindingPricesPaise: {
    none: 0,
    staple: 500, // ₹5.00
    spiral: 3000, // ₹30.00
    lamination: 2000 // ₹20.00
  }
};

export interface QuoteCalculationInput {
  totalPages: number;
  copies?: number | undefined;
  colorMode?: 'bw' | 'color' | 'monochrome' | 'grayscale' | undefined;
  sides?: 'single' | 'double' | 'simplex' | 'duplex_long' | 'duplex_short' | undefined;
  paperSize?: string | undefined;
  binding?: string | undefined;
}

export interface QuoteCalculationResult {
  subtotalPaise: number;
  bindingPaise: number;
  totalPaise: number;
  pricePerCopyPaise: number;
  breakdown: {
    pagePricePaise: number;
    pages: number;
    copies: number;
    colorMode: string;
    sides: string;
    paperSize: string;
    binding: string;
  };
}

export class PricingService {
  private readonly config: PricingRuleConfig;
  private readonly supabaseClient?: any | undefined;

  constructor(
    options: {
      config?: Partial<PricingRuleConfig> | undefined;
      supabaseClient?: any | undefined;
    } = {}
  ) {
    this.config = {
      ...DEFAULT_PRICING_CONFIG,
      ...options.config
    };
    this.supabaseClient = options.supabaseClient;
  }

  /**
   * Authoritative calculation of print job quote.
   * Invariant: All financial amounts are integer paise.
   */
  public calculateQuote(input: QuoteCalculationInput): QuoteCalculationResult {
    const pages = Math.max(1, Math.floor(input.totalPages || 1));
    const copies = Math.max(1, Math.floor(input.copies || 1));

    const color = input.colorMode?.toLowerCase() || 'bw';
    const isColor = color === 'color';
    const basePagePrice = isColor ? this.config.basePageColorPaise : this.config.basePageBwPaise;

    const paperSize = (input.paperSize || 'a4').toLowerCase();
    const paperMultiplier = this.config.paperSizeMultipliers[paperSize] ?? 1.0;

    const sides = (input.sides || 'single').toLowerCase();
    const isDuplex = sides === 'double' || sides.startsWith('duplex');
    const duplexFactor = isDuplex ? this.config.duplexMultiplier : 1.0;

    // Per-page price in paise
    const pagePricePaise = Math.round(basePagePrice * paperMultiplier * duplexFactor);

    // Binding price per copy
    const bindingType = (input.binding || 'none').toLowerCase();
    const bindingPaise = this.config.bindingPricesPaise[bindingType] ?? 0;

    const printCostPerCopy = pagePricePaise * pages;
    const pricePerCopyPaise = printCostPerCopy + bindingPaise;

    const subtotalPaise = printCostPerCopy * copies;
    const totalBindingPaise = bindingPaise * copies;
    const totalPaise = subtotalPaise + totalBindingPaise;

    return {
      subtotalPaise,
      bindingPaise: totalBindingPaise,
      totalPaise,
      pricePerCopyPaise,
      breakdown: {
        pagePricePaise,
        pages,
        copies,
        colorMode: isColor ? 'color' : 'bw',
        sides: isDuplex ? 'double' : 'single',
        paperSize,
        binding: bindingType
      }
    };
  }

  /**
   * Invokes transactional stored procedure for idempotent payment event recording.
   */
  public async recordPaymentEventIdempotent(params: {
    eventId: string;
    paymentId?: string | undefined;
    jobId: string;
    amountPaise: number;
    paymentMethod: string;
    status: string;
    idempotencyKey?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<{ success: boolean; is_idempotent_replay: boolean; data?: any }> {
    if (this.supabaseClient && typeof this.supabaseClient.rpc === 'function') {
      try {
        const { data, error } = await this.supabaseClient.rpc('record_payment_event_idempotent', {
          p_event_id: params.eventId,
          p_payment_id: params.paymentId ?? null,
          p_job_id: params.jobId,
          p_amount_paise: params.amountPaise,
          p_payment_method: params.paymentMethod,
          p_status: params.status,
          p_idempotency_key: params.idempotencyKey ?? null,
          p_metadata: params.metadata ?? {}
        });

        if (error) {
          return { success: false, is_idempotent_replay: false };
        }

        return {
          success: true,
          is_idempotent_replay: Boolean(data?.is_idempotent_replay),
          data
        };
      } catch {
        // Fall back to direct database table operation
      }
    }

    // Direct table operation fallback with unique event_id constraint
    if (this.supabaseClient && typeof this.supabaseClient.from === 'function') {
      try {
        const { error } = await this.supabaseClient.from('payment_events').insert({
          event_id: params.eventId,
          payment_id: params.paymentId,
          job_id: params.jobId,
          amount_paise: params.amountPaise,
          method: params.paymentMethod,
          status: params.status,
          metadata: params.metadata || {},
          created_at: new Date().toISOString()
        });

        if (error && (error.code === '23505' || error.message?.includes('duplicate'))) {
          // Unique constraint violation -> safely recognized as duplicate delivery
          return { success: true, is_idempotent_replay: true };
        }

        return { success: !error, is_idempotent_replay: false };
      } catch {
        return { success: true, is_idempotent_replay: true };
      }
    }

    return { success: true, is_idempotent_replay: false };
  }
}
