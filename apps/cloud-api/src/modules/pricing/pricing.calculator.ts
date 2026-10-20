import type {
  PriceBreakdown,
  PricingConfig,
  PrintSettings,
  PriorityTier,
  UrgentSurchargeConfig,
  BindingType
} from './pricing.types.js';

/**
 * Parses user-specified page range (e.g. 'all', '1-5, 8') and calculates
 * the number of selected pages within 1..documentPageCount.
 */
export function parsePageRange(pageRange: string | undefined, documentPageCount: number): number {
  if (!pageRange || pageRange.trim().toLowerCase() === 'all') {
    return Math.max(1, documentPageCount);
  }

  const selectedPages = new Set<number>();
  const tokens = pageRange.split(',').map(t => t.trim()).filter(Boolean);

  for (const token of tokens) {
    if (token.includes('-')) {
      const parts = token.split('-').map(p => p.trim());
      const start = parseInt(parts[0] ?? '', 10);
      const end = parseInt(parts[1] ?? '', 10);
      if (!isNaN(start) && !isNaN(end) && start <= end) {
        for (let p = Math.max(1, start); p <= Math.min(documentPageCount, end); p++) {
          selectedPages.add(p);
        }
      }
    } else {
      const p = parseInt(token, 10);
      if (!isNaN(p) && p >= 1 && p <= documentPageCount) {
        selectedPages.add(p);
      }
    }
  }

  return selectedPages.size > 0 ? selectedPages.size : Math.max(1, documentPageCount);
}

export interface CalculatePriceInput {
  settings: PrintSettings;
  priorityTier: PriorityTier;
  pageCount: number;
  pricingConfig: PricingConfig;
  urgentConfig: UrgentSurchargeConfig;
}

/**
 * Authoritative Server-Side Price Calculator.
 * Calculates exact paise values for pages, color, duplex, binding, urgent surcharge,
 * GST, and final payable total, completely ignoring any client price tampering.
 */
export function calculatePriceBreakdown(input: CalculatePriceInput): PriceBreakdown {
  const { settings, priorityTier, pageCount, pricingConfig, urgentConfig } = input;

  const paperTable = pricingConfig[settings.paper_size] || pricingConfig.A4;
  const copies = Math.max(1, Math.min(100, Math.floor(settings.copies || 1)));
  const totalPages = pageCount * copies;

  // 1. Base pages cost (Standard black & white single-sided cost per page)
  const base_pages_paise = totalPages * paperTable.bw_single_paise;

  // 2. Color surcharge & duplex discount
  let color_surcharge_paise = 0;
  let duplex_discount_paise = 0;

  if (settings.sides === 'single') {
    duplex_discount_paise = 0;
    if (settings.color_mode === 'color') {
      color_surcharge_paise = Math.max(
        0,
        totalPages * (paperTable.color_single_paise - paperTable.bw_single_paise)
      );
    }
  } else {
    // Double-sided (duplex)
    if (settings.color_mode === 'color') {
      color_surcharge_paise = Math.max(
        0,
        totalPages * (paperTable.color_single_paise - paperTable.bw_single_paise)
      );
      duplex_discount_paise = Math.max(
        0,
        totalPages * (paperTable.color_single_paise - paperTable.color_double_paise)
      );
    } else {
      color_surcharge_paise = 0;
      duplex_discount_paise = Math.max(
        0,
        totalPages * (paperTable.bw_single_paise - paperTable.bw_double_paise)
      );
    }
  }

  // 3. Finishing / Binding fee
  const bindingUnitFee = pricingConfig.binding_prices_paise[settings.binding] ?? 0;
  const binding_fee_paise = bindingUnitFee * copies;

  // 4. Subtotal before urgent surcharge
  const subtotalBeforeUrgent =
    base_pages_paise + color_surcharge_paise - duplex_discount_paise + binding_fee_paise;

  // 5. Urgent surcharge
  let urgent_surcharge_paise = 0;
  if (priorityTier === 'urgent') {
    if (urgentConfig.type === 'flat') {
      urgent_surcharge_paise = Math.max(0, Math.round(urgentConfig.amount));
    } else if (urgentConfig.type === 'percentage') {
      const rate =
        urgentConfig.amount > 100
          ? urgentConfig.amount / 10000 // Basis points (e.g. 2000 = 20%)
          : urgentConfig.amount / 100; // Direct percentage (e.g. 20 = 20%)
      urgent_surcharge_paise = Math.max(0, Math.round(subtotalBeforeUrgent * rate));
    }
  }

  // 6. Subtotal before tax
  const subtotal_paise = Math.max(
    0,
    subtotalBeforeUrgent + urgent_surcharge_paise
  );

  // 7. Configurable GST (rounded to nearest integer paise)
  const gstRate = Math.max(0, pricingConfig.gst_percentage ?? 0) / 100;
  const gst_paise = Math.round(subtotal_paise * gstRate);

  // 8. Total payable in paise (guaranteed positive integer)
  const total_paise = Math.max(1, subtotal_paise + gst_paise);

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
 * Calculates estimated wait time in minutes based on total page count,
 * finishing services, and queue priority tier.
 */
export function calculateEstimatedWaitMinutes(options: {
  totalPages: number;
  priorityTier: PriorityTier;
  binding: BindingType;
}): number {
  const { totalPages, priorityTier, binding } = options;

  // Base print duration (~20 ppm)
  const printMinutes = totalPages * 0.05;

  // Finishing duration
  const bindingMinutes = binding !== 'none' ? 2 : 0;

  // Priority queue wait duration
  const queueDelayMinutes = priorityTier === 'urgent' ? 2 : 5;

  const totalMinutes = Math.ceil(printMinutes + bindingMinutes + queueDelayMinutes);
  return Math.max(1, totalMinutes);
}
