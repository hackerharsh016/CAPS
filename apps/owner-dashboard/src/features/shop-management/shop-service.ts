/**
 * Shop Management Service for CAPS Owner Dashboard.
 * Queries owner-scoped shops and enforces strict tenant boundaries.
 */

import type { Shop, ShopUpdateInput, CreateShopInput, PricingConfig, UrgentSurchargeConfig } from './types';
import { CrossShopAccessError } from './types';
import { getSupabaseEnv } from '../../lib/supabase';

export const ACTIVE_SHOP_STORAGE_KEY = 'caps_active_shop_id';
export const ACTIVE_SHOP_COOKIE = 'caps_active_shop_id';

export const DEFAULT_SHOP_PRICING_CONFIG: PricingConfig = {
  A4: {
    bw_single_paise: 200,
    bw_double_paise: 300,
    color_single_paise: 1000,
    color_double_paise: 1800
  },
  A3: {
    bw_single_paise: 400,
    bw_double_paise: 600,
    color_single_paise: 2000,
    color_double_paise: 3600
  },
  Legal: {
    bw_single_paise: 250,
    bw_double_paise: 350,
    color_single_paise: 1200,
    color_double_paise: 2000
  },
  binding_prices_paise: {
    none: 0,
    spiral: 3500,
    staple: 500,
    lamination: 2000
  },
  gst_percentage: 18
};

export const DEFAULT_URGENT_CONFIG: UrgentSurchargeConfig = {
  type: 'flat',
  amount: 2000,
  max_urgent_jobs_per_hour: 5
};

export interface ShopServiceConfig {
  customFetch?: typeof fetch | undefined;
  supabaseUrl?: string | undefined;
  supabaseAnonKey?: string | undefined;
}

export class ShopService {
  private readonly supabaseUrl: string;
  private readonly supabaseAnonKey: string;
  private readonly fetchFn: typeof fetch;
  private memoryActiveShopId: string | null = null;

  constructor(config?: ShopServiceConfig) {
    const env = getSupabaseEnv();
    this.supabaseUrl = (config?.supabaseUrl ?? env.supabaseUrl).replace(/\/$/, '');
    this.supabaseAnonKey = config?.supabaseAnonKey ?? env.supabaseAnonKey;
    this.fetchFn =
      config?.customFetch ??
      (typeof fetch !== 'undefined'
        ? fetch.bind(globalThis)
        : (undefined as unknown as typeof fetch));
  }

  /**
   * Fetches all shops owned by or delegated to the given owner user ID.
   */
  async fetchOwnerShops(ownerId: string, accessToken?: string): Promise<Shop[]> {
    if (!ownerId) {
      return [];
    }

    const endpoint = `${this.supabaseUrl}/rest/v1/shops?owner_id=eq.${ownerId}&select=*`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.supabaseAnonKey
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    try {
      const response = await this.fetchFn(endpoint, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        // Fall back to empty array if no tables or network offline
        return [];
      }

      const shops = (await response.json()) as Shop[];
      return shops;
    } catch {
      return [];
    }
  }

  /**
   * Updates shop configuration, pricing, or settings.
   * Enforces owner authorization and tenant boundaries.
   */
  async updateShop(
    shopId: string,
    updates: ShopUpdateInput,
    ownerId: string,
    authorizedShops: Shop[],
    accessToken?: string,
    isAdmin = false
  ): Promise<Shop> {
    this.validateShopAccess(ownerId, shopId, authorizedShops, isAdmin);

    const endpoint = `${this.supabaseUrl}/rest/v1/shops?id=eq.${shopId}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.supabaseAnonKey,
      Prefer: 'return=representation'
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const payload: Record<string, unknown> = {
      ...updates,
      updated_at: new Date().toISOString()
    };

    let response = await this.fetchFn(endpoint, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(payload)
    });

    // If the database schema cache does not have allow_pay_at_counter, retry without it
    if (!response.ok && 'allow_pay_at_counter' in payload) {
      try {
        const clone = response.clone();
        const errBody = (await clone.json()) as { message?: string; details?: string };
        const msg = (errBody.message || errBody.details || '').toLowerCase();
        if (msg.includes('allow_pay_at_counter') || msg.includes('schema cache')) {
          delete payload['allow_pay_at_counter'];
          response = await this.fetchFn(endpoint, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(payload)
          });
        }
      } catch {
        // ignore json parse errors
      }
    }

    if (!response.ok) {
      let errMessage = `Failed to update shop (status: ${response.status})`;
      try {
        const errBody = (await response.json()) as { message?: string; details?: string };
        errMessage = errBody.message || errBody.details || errMessage;
      } catch {
        // ignore json parse errors
      }
      throw new Error(errMessage);
    }

    const data = (await response.json()) as Shop[];
    if (!data[0]) {
      throw new Error('Shop record not found or could not be updated.');
    }
    return data[0];
  }

  /**
   * Registers a new shop outlet linked to the owner.
   * Conforms to database schema and RLS policies on `public.shops`.
   */
  async createShop(
    input: CreateShopInput,
    ownerId: string,
    accessToken?: string
  ): Promise<Shop> {
    const pricingConfig = input.pricing_config ?? DEFAULT_SHOP_PRICING_CONFIG;
    const urgentConfig = input.urgent_surcharge_config ?? DEFAULT_URGENT_CONFIG;
    const shopRecord: Record<string, any> = {
      owner_id: ownerId,
      name: input.name.trim(),
      address: input.address.trim(),
      geo_lat: Number(input.geo_lat),
      geo_lng: Number(input.geo_lng),
      status: input.status ?? 'open',
      pricing_config: pricingConfig,
      urgent_surcharge_config: urgentConfig,
      auto_print_enabled: input.auto_print_enabled ?? false
    };

    if (input.allow_pay_at_counter !== undefined) {
      shopRecord['allow_pay_at_counter'] = input.allow_pay_at_counter;
    }

    const endpoint = `${this.supabaseUrl}/rest/v1/shops`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.supabaseAnonKey,
      Prefer: 'return=representation'
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    // 1. Try Cloud API endpoint first if available (uses service-role client, bypassing RLS recursion)
    const apiUrl =
      typeof process !== 'undefined'
        ? process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000'
        : 'http://localhost:4000';

    if (accessToken && apiUrl) {
      try {
        const apiHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        };
        const apiRes = await this.fetchFn(`${apiUrl.replace(/\/$/, '')}/api/v1/shops`, {
          method: 'POST',
          headers: apiHeaders,
          body: JSON.stringify(shopRecord)
        });
        if (apiRes.ok) {
          const apiJson = (await apiRes.json()) as { data?: Shop; shop?: Shop };
          const createdShop = apiJson.data || apiJson.shop;
          if (createdShop?.id) {
            this.setActiveShopId(createdShop.id);
            return createdShop;
          }
        }
      } catch {
        // Fall back to direct Supabase REST below
      }
    }

    let response = await this.fetchFn(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(shopRecord)
    });

    // If the database schema cache does not have allow_pay_at_counter, retry without it
    if (!response.ok && 'allow_pay_at_counter' in shopRecord) {
      try {
        const clone = response.clone();
        const errBody = (await clone.json()) as { message?: string; details?: string };
        const msg = (errBody.message || errBody.details || '').toLowerCase();
        if (msg.includes('allow_pay_at_counter') || msg.includes('schema cache')) {
          delete shopRecord['allow_pay_at_counter'];
          response = await this.fetchFn(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(shopRecord)
          });
        }
      } catch {
        // ignore json parse errors
      }
    }

    if (!response.ok) {
      let errMessage = `Failed to create shop (status: ${response.status})`;
      try {
        const errBody = (await response.json()) as { message?: string; details?: string };
        errMessage = errBody.message || errBody.details || errMessage;
      } catch {
        // ignore json parse errors
      }
      throw new Error(errMessage);
    }

    const data = (await response.json()) as Shop[];
    if (data[0]) {
      this.setActiveShopId(data[0].id);
      return data[0];
    }

    throw new Error('Unexpected response while creating shop.');
  }

  /**
   * Asserts that a given target shop is authorized for the given owner/admin.
   * Throws CrossShopAccessError on cross-shop unauthorized access.
   */
  validateShopAccess(
    userId: string,
    targetShopId: string,
    authorizedShops: Shop[],
    isAdmin = false
  ): void {
    if (isAdmin) return;

    const isAuthorized = authorizedShops.some(s => s.id === targetShopId);
    if (!isAuthorized) {
      throw new CrossShopAccessError(targetShopId, userId);
    }
  }

  /**
   * Retrieves active shop ID from memory, storage, or cookies.
   */
  getActiveShopId(): string | null {
    if (this.memoryActiveShopId) {
      return this.memoryActiveShopId;
    }

    if (typeof window !== 'undefined') {
      try {
        const stored = window.localStorage.getItem(ACTIVE_SHOP_STORAGE_KEY);
        if (stored) return stored;
      } catch {
        // Ignore storage errors
      }
    }

    if (typeof document !== 'undefined') {
      const match = document.cookie
        .split(';')
        .map(c => c.trim())
        .find(c => c.startsWith(`${ACTIVE_SHOP_COOKIE}=`));
      if (match) {
        const value = match.split('=')[1];
        if (value) {
          return decodeURIComponent(value);
        }
      }
    }

    return null;
  }

  /**
   * Persists active shop ID to memory, storage, and cookie.
   */
  setActiveShopId(shopId: string): void {
    this.memoryActiveShopId = shopId;

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(ACTIVE_SHOP_STORAGE_KEY, shopId);
      } catch {
        // Ignore
      }
    }

    if (typeof document !== 'undefined') {
      document.cookie = `${ACTIVE_SHOP_COOKIE}=${encodeURIComponent(shopId)}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
    }
  }

  /**
   * Clears active shop ID.
   */
  clearActiveShopId(): void {
    this.memoryActiveShopId = null;

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(ACTIVE_SHOP_STORAGE_KEY);
      } catch {
        // Ignore
      }
    }

    if (typeof document !== 'undefined') {
      document.cookie = `${ACTIVE_SHOP_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    }
  }
}
