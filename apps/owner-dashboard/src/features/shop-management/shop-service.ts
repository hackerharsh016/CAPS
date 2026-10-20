/**
 * Shop Management Service for CAPS Owner Dashboard.
 * Queries owner-scoped shops and enforces strict tenant boundaries.
 */

import type { Shop } from './types';
import { CrossShopAccessError } from './types';
import { getSupabaseEnv } from '../../lib/supabase';

export const ACTIVE_SHOP_STORAGE_KEY = 'caps_active_shop_id';
export const ACTIVE_SHOP_COOKIE = 'caps_active_shop_id';

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
    this.fetchFn = config?.customFetch ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (undefined as unknown as typeof fetch));
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
