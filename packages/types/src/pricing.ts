/**
 * Pricing, quote, and billing domain types for CAPS.
 */

import { PrintSettings } from './settings.js';

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

export interface PaperPriceTable {
  bw_single_paise: number;
  bw_double_paise: number;
  color_single_paise: number;
  color_double_paise: number;
}

export interface PricingConfig {
  A4: PaperPriceTable;
  A3: PaperPriceTable;
  Legal: PaperPriceTable;
  binding_prices_paise: {
    none: 0;
    spiral: number;
    staple: number;
    lamination: number;
  };
  gst_percentage: number;
}

export interface UrgentSurchargeConfig {
  type: 'flat' | 'percentage';
  /** Flat amount in paise, or percentage basis points (e.g. 2000 = 20%) */
  amount: number;
  /** Max urgent jobs allowed per hour to prevent queue starving */
  max_urgent_jobs_per_hour?: number;
}

export interface QuoteRequest {
  shop_id: string;
  settings: PrintSettings;
  priority_tier: 'urgent' | 'flexible';
  document_page_count: number;
}

export interface QuoteResponse {
  quote_id: string;
  shop_id: string;
  settings: PrintSettings;
  priority_tier: 'urgent' | 'flexible';
  page_count: number;
  price_breakdown: PriceBreakdown;
  estimated_wait_minutes: number;
  expires_at: string;
}
