export type ShopStatus = 'open' | 'closed';

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

export interface Shop {
  id: string; // UUID
  owner_id: string; // UUID referencing UserProfile
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

export interface CreateShopDto {
  owner_id: string;
  name: string;
  address: string;
  geo_lat: number;
  geo_lng: number;
  pricing_config: PricingConfig;
  urgent_surcharge_config: UrgentSurchargeConfig;
  auto_print_enabled?: boolean | undefined;
  allow_pay_at_counter?: boolean | undefined;
}

export interface UpdateShopDto {
  name?: string | undefined;
  address?: string | undefined;
  geo_lat?: number | undefined;
  geo_lng?: number | undefined;
  status?: ShopStatus | undefined;
  pricing_config?: PricingConfig | undefined;
  urgent_surcharge_config?: UrgentSurchargeConfig | undefined;
  auto_print_enabled?: boolean | undefined;
  allow_pay_at_counter?: boolean | undefined;
}

export interface ListShopsQuery {
  status?: ShopStatus | undefined;
  page?: number | undefined;
  limit?: number | undefined;
  search?: string | undefined;
}
