/**
 * Shop establishment and discovery domain types for CAPS.
 */

import { PricingConfig, UrgentSurchargeConfig } from './pricing.js';

export type ShopStatus = 'open' | 'closed';

export interface Shop {
  id: string; // UUID
  owner_id: string; // UUID references UserProfile
  name: string;
  address: string;
  geo_lat: number;
  geo_lng: number;
  status: ShopStatus;
  pricing_config: PricingConfig;
  urgent_surcharge_config: UrgentSurchargeConfig;
  auto_print_enabled: boolean;
  allow_pay_at_counter?: boolean | undefined;
  created_at: string;
  updated_at: string;
}

export interface ShopSummary {
  id: string;
  name: string;
  address: string;
  geo_lat: number;
  geo_lng: number;
  status: ShopStatus;
  distance_meters?: number;
  rating?: number;
  pending_queue_count: number;
  estimated_wait_minutes: number;
  supported_paper_sizes: string[];
}
