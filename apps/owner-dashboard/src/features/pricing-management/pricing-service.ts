/**
 * Pricing & Shop Settings API Service for CAPS Owner Dashboard.
 * Interacts with backend API and guarantees tenant isolation.
 */

import type {
  Shop,
  PricingConfig,
  UrgentSurchargeConfig,
  ShopUpdateInput
} from '../shop-management/types';
import { ShopService } from '../shop-management/shop-service';
import { validatePricingConfig, validateUrgentConfig, validateShopProfile } from './validation';

export interface UpdatePricingOptions {
  shopId: string;
  ownerId: string;
  authorizedShops: Shop[];
  pricingConfig?: PricingConfig | undefined;
  urgentConfig?: UrgentSurchargeConfig | undefined;
  payAtCounterEnabled?: boolean | undefined;
  autoPrintEnabled?: boolean | undefined;
  status?: 'open' | 'closed' | undefined;
  name?: string | undefined;
  address?: string | undefined;
  accessToken?: string | undefined;
  isAdmin?: boolean | undefined;
}

export class PricingService {
  private readonly shopService: ShopService;

  constructor(shopService?: ShopService) {
    this.shopService = shopService ?? new ShopService();
  }

  /**
   * Updates pricing configuration, service catalog, and operational toggles.
   * Enforces business validation and tenant authorization boundaries.
   */
  async updatePricingAndSettings(options: UpdatePricingOptions): Promise<Shop> {
    const {
      shopId,
      ownerId,
      authorizedShops,
      pricingConfig,
      urgentConfig,
      payAtCounterEnabled,
      autoPrintEnabled,
      status,
      name,
      address,
      accessToken,
      isAdmin = false
    } = options;

    // 1. Authorization check: Cross-shop access guard
    this.shopService.validateShopAccess(ownerId, shopId, authorizedShops, isAdmin);

    // 2. Business validation
    if (pricingConfig) {
      const { isValid, errors } = validatePricingConfig(pricingConfig);
      if (!isValid) {
        const firstError = Object.values(errors)[0] || 'Invalid pricing configuration.';
        throw new Error(`Validation Error: ${firstError}`);
      }
    }

    if (urgentConfig) {
      const { isValid, errors } = validateUrgentConfig(urgentConfig);
      if (!isValid) {
        const firstError = Object.values(errors)[0] || 'Invalid urgent surcharge configuration.';
        throw new Error(`Validation Error: ${firstError}`);
      }
    }

    if (name !== undefined || address !== undefined) {
      const currentShop = authorizedShops.find(s => s.id === shopId);
      const targetName = name ?? currentShop?.name ?? '';
      const targetAddress = address ?? currentShop?.address ?? '';
      const { isValid, errors } = validateShopProfile(targetName, targetAddress);
      if (!isValid) {
        const firstError = Object.values(errors)[0] || 'Invalid shop profile details.';
        throw new Error(`Validation Error: ${firstError}`);
      }
    }

    // 3. Assemble updates payload
    const updates: ShopUpdateInput = {};
    if (pricingConfig) updates.pricing_config = pricingConfig;
    if (urgentConfig) updates.urgent_surcharge_config = urgentConfig;
    if (payAtCounterEnabled !== undefined) updates.pay_at_counter_enabled = payAtCounterEnabled;
    if (autoPrintEnabled !== undefined) updates.auto_print_enabled = autoPrintEnabled;
    if (status !== undefined) updates.status = status;
    if (name !== undefined) updates.name = name;
    if (address !== undefined) updates.address = address;

    // 4. Send to backend via shop service
    return this.shopService.updateShop(
      shopId,
      updates,
      ownerId,
      authorizedShops,
      accessToken,
      isAdmin
    );
  }
}
