/**
 * Domain types for Pricing, Live Quotes, and Billing in CAPS Customer Web (P04-M05-F01).
 * Strictly mirrors the frozen contract from @caps/types/pricing.
 */

import type { PrintSettings } from '../print-settings/types';

export type PriorityTier = 'urgent' | 'flexible';

export interface PriceBreakdown {
  /** Base document pages cost in paise (1 INR = 100 paise) */
  base_pages_paise: number;
  /** Additional charge for color printing if requested */
  color_surcharge_paise: number;
  /** Discount applied for duplex printing */
  duplex_discount_paise: number;
  /** Additional manual finishing/binding fee */
  binding_fee_paise: number;
  /** Surcharge applied for Urgent priority queue jump */
  urgent_surcharge_paise: number;
  /** Subtotal before tax in paise */
  subtotal_paise: number;
  /** Goods & Services Tax (GST) in paise */
  gst_paise: number;
  /** Final payable total in paise */
  total_paise: number;
}

export interface QuoteRequest {
  shop_id: string;
  settings: PrintSettings;
  priority_tier: PriorityTier;
  document_page_count: number;
}

export interface QuoteResponse {
  quote_id: string;
  shop_id: string;
  settings: PrintSettings;
  priority_tier: PriorityTier;
  page_count: number;
  price_breakdown: PriceBreakdown;
  estimated_wait_minutes: number;
  expires_at: string;
}

export type QuoteStatus = 'idle' | 'loading' | 'success' | 'error' | 'expired';

export interface LiveQuoteState {
  status: QuoteStatus;
  quote: QuoteResponse | null;
  error: string | null;
  isStale: boolean;
  timeRemainingSeconds: number;
}

/**
 * Formats a paise integer (e.g. 150) into a readable Indian Rupee string (e.g. "₹1.50").
 */
export function formatPaiseToRupees(paise: number): string {
  if (isNaN(paise) || paise < 0) return '₹0.00';
  const rupees = (paise / 100).toFixed(2);
  return `₹${rupees}`;
}
