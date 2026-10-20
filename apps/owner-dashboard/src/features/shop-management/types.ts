/**
 * Shop Management domain types for CAPS Shop Owner Dashboard.
 * Conforms to CAPS SRS Section 7.2 and Database Migration 20261019000001_create_users_and_shops.sql.
 */

export type ShopStatus = 'open' | 'closed';

export type ShopMemberRole = 'owner' | 'operator';

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
  max_urgent_jobs_per_hour?: number;
}

export interface Shop {
  id: string; // UUID
  owner_id: string; // UUID references profiles
  name: string;
  address: string;
  geo_lat: number;
  geo_lng: number;
  status: ShopStatus;
  pricing_config: PricingConfig;
  urgent_surcharge_config: UrgentSurchargeConfig;
  auto_print_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShopMembership {
  id: string;
  shop_id: string;
  user_id: string;
  role: ShopMemberRole;
  created_at: string;
  shop?: Shop | undefined;
}

export interface ShopContextValue {
  activeShop: Shop | null;
  availableShops: Shop[];
  isLoading: boolean;
  error: string | null;
  setActiveShopId: (shopId: string) => void;
  refreshShops: () => Promise<void>;
  isAuthorizedForShop: (shopId: string) => boolean;
}

export class CrossShopAccessError extends Error {
  readonly code = 'FORBIDDEN_CROSS_SHOP_ACCESS';
  readonly status = 403;
  readonly targetShopId: string;
  readonly ownerId: string;

  constructor(targetShopId: string, ownerId: string) {
    super(`Access denied: User ${ownerId} is not authorized to manage shop ${targetShopId}.`);
    this.name = 'CrossShopAccessError';
    this.targetShopId = targetShopId;
    this.ownerId = ownerId;
  }
}
