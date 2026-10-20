/**
 * Pure Pricing Calculation Engine for CAPS (P04-M05-F01).
 * Computes authoritative price breakdowns, taxes (18% GST),
 * priority tier surcharges, and wait time estimates.
 */

import type {
  PriceBreakdown,
  PriorityTier,
  QuoteRequest,
  QuoteResponse
} from './types';
import type { PrintSettings, PaperSize } from '../print-settings/types';
import { parsePageRange, calculateEstimatedSheets } from '../print-settings/validation';

export const GST_RATE_PERCENTAGE = 18;
export const QUOTE_VALIDITY_DURATION_MS = 15 * 60 * 1000; // 15 Minutes

export interface ShopPricingRates {
  bw_per_page_paise: number;
  color_per_page_paise: number;
  duplex_discount_paise: number;
  spiral_binding_paise: number;
  staple_binding_paise: number;
  lamination_paise: number;
  urgent_surcharge_paise: number;
}

export const DEFAULT_PRICING_RATES: ShopPricingRates = {
  bw_per_page_paise: 150, // ₹1.50
  color_per_page_paise: 1000, // ₹10.00
  duplex_discount_paise: 25, // ₹0.25
  spiral_binding_paise: 3500, // ₹35.00
  staple_binding_paise: 1000, // ₹10.00
  lamination_paise: 2000, // ₹20.00
  urgent_surcharge_paise: 2000 // ₹20.00
};

export const PAPER_SIZE_MULTIPLIERS: Record<PaperSize, number> = {
  A4: 1.0,
  A3: 2.0,
  Legal: 1.25
};

/**
 * Calculates itemized price breakdown from print settings and priority tier.
 */
export function calculatePriceBreakdown(
  settings: PrintSettings,
  priorityTier: PriorityTier,
  totalDocumentPages: number,
  customRates: Partial<ShopPricingRates> = {}
): PriceBreakdown {
  const rates: ShopPricingRates = { ...DEFAULT_PRICING_RATES, ...customRates };

  // 1. Resolve effective pages to print
  let pagesList: number[];
  try {
    pagesList = parsePageRange(settings.page_range, totalDocumentPages);
  } catch {
    pagesList = Array.from({ length: Math.max(1, totalDocumentPages) }, (_, i) => i + 1);
  }

  const effectivePagesPerCopy = pagesList.length;
  const copies = Math.max(1, settings.copies || 1);
  const totalPagesPrinted = effectivePagesPerCopy * copies;

  // 2. Paper size factor
  const sizeMultiplier = PAPER_SIZE_MULTIPLIERS[settings.paper_size] || 1.0;

  // 3. Base pages cost (B&W basis)
  const baseRatePerSheet = Math.round(rates.bw_per_page_paise * sizeMultiplier);
  const base_pages_paise = totalPagesPrinted * baseRatePerSheet;

  // 4. Color surcharge
  let color_surcharge_paise = 0;
  if (settings.color_mode === 'color') {
    const colorRatePerSheet = Math.round(rates.color_per_page_paise * sizeMultiplier);
    // Surcharge is the difference between color rate and base monochrome rate
    const surchargePerSheet = Math.max(0, colorRatePerSheet - baseRatePerSheet);
    color_surcharge_paise = totalPagesPrinted * surchargePerSheet;
  }

  // 5. Duplex discount (saves physical paper sheets)
  let duplex_discount_paise = 0;
  if (settings.sides === 'double') {
    const singleSheets = totalPagesPrinted;
    const doubleSheets = calculateEstimatedSheets(effectivePagesPerCopy, 'double', copies);
    const sheetsSaved = Math.max(0, singleSheets - doubleSheets);
    duplex_discount_paise = sheetsSaved * rates.duplex_discount_paise;
  }

  // 6. Finishing / Binding fee
  let binding_fee_paise = 0;
  if (settings.binding === 'spiral') {
    binding_fee_paise = rates.spiral_binding_paise * copies;
  } else if (settings.binding === 'staple') {
    binding_fee_paise = rates.staple_binding_paise * copies;
  } else if (settings.binding === 'lamination') {
    binding_fee_paise = rates.lamination_paise * totalPagesPrinted;
  }

  // 7. Urgent priority surcharge
  const urgent_surcharge_paise =
    priorityTier === 'urgent' ? rates.urgent_surcharge_paise : 0;

  // 8. Pre-tax subtotal
  const subtotal_paise = Math.max(
    0,
    base_pages_paise +
      color_surcharge_paise -
      duplex_discount_paise +
      binding_fee_paise +
      urgent_surcharge_paise
  );

  // 9. Goods & Services Tax (18%)
  const gst_paise = Math.round((subtotal_paise * GST_RATE_PERCENTAGE) / 100);

  // 10. Total payable
  const total_paise = subtotal_paise + gst_paise;

  return {
    base_pages_paise,
    color_surcharge_paise,
    duplex_discount_paise,
    binding_fee_paise,
    urgent_surcharge_paise,
    subtotal_paise,
    gst_paise,
    total_paise
  };
}

/**
 * Calculates estimated queue wait time in minutes.
 */
export function estimateWaitTimeMinutes(
  effectivePages: number,
  copies: number,
  priorityTier: PriorityTier,
  baseQueueLoadMinutes: number = 10
): number {
  const totalPages = effectivePages * copies;
  // Standard print throughput estimate: ~15 pages per minute
  const printTimeMinutes = Math.max(1, Math.ceil(totalPages / 15));

  if (priorityTier === 'urgent') {
    // Priority jump puts job at top of queue ahead of all flexible jobs
    return Math.max(2, printTimeMinutes + 2);
  }

  // Standard flexible queue wait time includes existing backlog
  return Math.max(5, baseQueueLoadMinutes + printTimeMinutes);
}

/**
 * Generates a full server-authoritative QuoteResponse.
 */
export function generateAuthoritativeQuote(
  req: QuoteRequest,
  customRates?: Partial<ShopPricingRates>,
  baseQueueLoadMinutes?: number
): QuoteResponse {
  const quote_id = crypto.randomUUID ? crypto.randomUUID() : `quote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const price_breakdown = calculatePriceBreakdown(
    req.settings,
    req.priority_tier,
    req.document_page_count,
    customRates
  );

  let pagesList: number[];
  try {
    pagesList = parsePageRange(req.settings.page_range, req.document_page_count);
  } catch {
    pagesList = [1];
  }

  const estimated_wait_minutes = estimateWaitTimeMinutes(
    pagesList.length,
    req.settings.copies,
    req.priority_tier,
    baseQueueLoadMinutes
  );

  const expires_at = new Date(Date.now() + QUOTE_VALIDITY_DURATION_MS).toISOString();

  return {
    quote_id,
    shop_id: req.shop_id,
    settings: req.settings,
    priority_tier: req.priority_tier,
    page_count: pagesList.length,
    price_breakdown,
    estimated_wait_minutes,
    expires_at
  };
}
