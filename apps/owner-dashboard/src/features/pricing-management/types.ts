/**
 * Pricing Management domain types and form structures for CAPS Owner Dashboard.
 * Conforms to Master Plan §4 & §5.4 and packages/types pricing schema.
 */

import type {
  PricingConfig,
  PaperPriceTable,
  UrgentSurchargeConfig,
  Shop,
  ShopStatus
} from '../shop-management/types';

export type PaperSize = 'A4' | 'A3' | 'Legal';
export type BindingType = 'spiral' | 'staple' | 'lamination';

export interface PricingFormErrors {
  general?: string | undefined;
  'A4.bw_single'?: string | undefined;
  'A4.bw_double'?: string | undefined;
  'A4.color_single'?: string | undefined;
  'A4.color_double'?: string | undefined;
  'A3.bw_single'?: string | undefined;
  'A3.bw_double'?: string | undefined;
  'A3.color_single'?: string | undefined;
  'A3.color_double'?: string | undefined;
  'Legal.bw_single'?: string | undefined;
  'Legal.bw_double'?: string | undefined;
  'Legal.color_single'?: string | undefined;
  'Legal.color_double'?: string | undefined;
  'binding.spiral'?: string | undefined;
  'binding.staple'?: string | undefined;
  'binding.lamination'?: string | undefined;
  gst_percentage?: string | undefined;
  'urgent.amount'?: string | undefined;
  'urgent.max_jobs'?: string | undefined;
  shop_name?: string | undefined;
  shop_address?: string | undefined;
}

export interface PricingFormData {
  pricing_config: PricingConfig;
  urgent_surcharge_config: UrgentSurchargeConfig;
  auto_print_enabled: boolean;
  pay_at_counter_enabled: boolean;
  status: ShopStatus;
  name: string;
  address: string;
}

/**
 * Currency conversion helpers:
 * 1 INR = 100 Paise.
 */
export function paiseToRupees(paise: number): number {
  return Number((paise / 100).toFixed(2));
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export type { PricingConfig, PaperPriceTable, UrgentSurchargeConfig, Shop, ShopStatus };
