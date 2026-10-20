/**
 * Domain types and DTOs for CAPS Server-Side Authoritative Pricing and Quotes.
 * Conforms to Master Plan §5.4 & §5.5, packages/types, and packages/validation.
 */

export type PaperSize = 'A4' | 'A3' | 'Legal';
export type ColorMode = 'bw' | 'color';
export type SideMode = 'single' | 'double';
export type Orientation = 'portrait' | 'landscape';
export type BindingType = 'none' | 'spiral' | 'staple' | 'lamination';
export type PriorityTier = 'urgent' | 'flexible';

export interface PrintSettings {
  paper_size: PaperSize;
  color_mode: ColorMode;
  sides: SideMode;
  orientation: Orientation;
  copies: number;
  page_range: string;
  binding: BindingType;
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
  amount: number;
  max_urgent_jobs_per_hour?: number | undefined;
}

export interface PriceBreakdown {
  base_pages_paise: number;
  color_surcharge_paise: number;
  duplex_discount_paise: number;
  binding_fee_paise: number;
  urgent_surcharge_paise: number;
  subtotal_paise: number;
  gst_paise: number;
  total_paise: number;
}

export interface QuoteRequestInput {
  shop_id: string;
  settings: PrintSettings;
  priority_tier: PriorityTier;
  document_page_count: number;
  document_id?: string | undefined;
}

export interface QuoteResponseData {
  quote_id: string;
  shop_id: string;
  customer_id?: string | undefined;
  settings: PrintSettings;
  priority_tier: PriorityTier;
  page_count: number;
  price_breakdown: PriceBreakdown;
  pricing_snapshot: {
    pricing_config: PricingConfig;
    urgent_surcharge_config: UrgentSurchargeConfig;
  };
  estimated_wait_minutes: number;
  expires_at: string;
  created_at: string;
}

export type QuoteStatus = 'active' | 'expired' | 'consumed';

export interface QuoteRecord {
  id: string;
  customer_id?: string | undefined;
  shop_id: string;
  document_id?: string | undefined;
  settings: PrintSettings;
  priority_tier: PriorityTier;
  page_count: number;
  pricing_snapshot: {
    pricing_config: PricingConfig;
    urgent_surcharge_config: UrgentSurchargeConfig;
  };
  price_breakdown: PriceBreakdown;
  estimated_wait_minutes: number;
  status: QuoteStatus;
  created_at: string;
  expires_at: string;
}
