'use client';

/**
 * Shop Management React Context for CAPS Owner Dashboard.
 * Maintains the active scoped shop and prevents cross-shop operations.
 */

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import type { Shop, ShopContextValue, ShopUpdateInput } from './types';
import { ShopService } from './shop-service';
import { useAuth } from '../auth/auth-context';

const ShopContext = createContext<ShopContextValue | null>(null);

const DEFAULT_DEMO_SHOP: Shop = {
  id: '00000000-0000-0000-0000-000000000001',
  owner_id: '00000000-0000-0000-0000-000000000002',
  name: 'Campus Xerox & Digital Station',
  address: '12 North Campus Road, Near Metro Gate 2, Delhi',
  geo_lat: 28.6923,
  geo_lng: 77.2145,
  status: 'open',
  pricing_config: {
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
      spiral: 4000,
      staple: 500,
      lamination: 2000
    },
    gst_percentage: 18
  },
  urgent_surcharge_config: {
    type: 'flat',
    amount: 2000,
    max_urgent_jobs_per_hour: 5
  },
  auto_print_enabled: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

export interface ShopProviderProps {
  children: React.ReactNode;
  shopService?: ShopService | undefined;
  initialShops?: Shop[] | undefined;
}

export function ShopProvider({
  children,
  shopService: customShopService,
  initialShops
}: ShopProviderProps) {
  const { user, session, isAuthenticated, profile } = useAuth();
  const shopService = useMemo(() => customShopService ?? new ShopService(), [customShopService]);

  const [availableShops, setAvailableShops] = useState<Shop[]>(initialShops ?? []);
  const [activeShopId, setActiveShopIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadShops = useCallback(async () => {
    if (!isAuthenticated || !user) {
      setAvailableShops([]);
      setActiveShopIdState(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let shops = await shopService.fetchOwnerShops(user.id, session?.access_token);

      // If in dev/test environment and no remote shops returned, provide fallback demo shop scoped to user
      if (shops.length === 0) {
        shops = [{ ...DEFAULT_DEMO_SHOP, owner_id: user.id }];
      }

      setAvailableShops(shops);

      // Resolve active shop
      const savedShopId = shopService.getActiveShopId();
      const matched = shops.find(s => s.id === savedShopId);
      const chosenShopId = matched ? matched.id : (shops[0]?.id ?? null);

      if (chosenShopId) {
        setActiveShopIdState(chosenShopId);
        shopService.setActiveShopId(chosenShopId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load shops.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user, session?.access_token, shopService]);

  useEffect(() => {
    loadShops();
  }, [loadShops]);

  const setActiveShopId = useCallback(
    (shopId: string) => {
      const target = availableShops.find(s => s.id === shopId);
      if (!target && profile?.role !== 'admin') {
        throw new Error(`Cannot select unauthorized shop: ${shopId}`);
      }
      setActiveShopIdState(shopId);
      shopService.setActiveShopId(shopId);
    },
    [availableShops, profile?.role, shopService]
  );

  const isAuthorizedForShop = useCallback(
    (shopId: string): boolean => {
      if (profile?.role === 'admin') return true;
      return availableShops.some(s => s.id === shopId);
    },
    [availableShops, profile?.role]
  );

  const updateActiveShop = useCallback(
    async (updates: ShopUpdateInput): Promise<Shop> => {
      if (!user) {
        throw new Error('Cannot update shop: User is not authenticated.');
      }
      if (!activeShopId) {
        throw new Error('No active shop selected to update.');
      }

      // Snapshot previous state for rollback
      const previousShops = [...availableShops];

      try {
        const updated = await shopService.updateShop(
          activeShopId,
          updates,
          user.id,
          availableShops,
          session?.access_token,
          profile?.role === 'admin'
        );

        setAvailableShops(prev => prev.map(s => (s.id === updated.id ? updated : s)));
        return updated;
      } catch (err) {
        // Rollback state upon failure
        setAvailableShops(previousShops);
        throw err;
      }
    },
    [user, activeShopId, availableShops, shopService, session?.access_token, profile?.role]
  );

  const activeShop = useMemo(() => {
    return availableShops.find(s => s.id === activeShopId) ?? availableShops[0] ?? null;
  }, [availableShops, activeShopId]);

  const value = useMemo<ShopContextValue>(
    () => ({
      activeShop,
      availableShops,
      isLoading,
      error,
      setActiveShopId,
      refreshShops: loadShops,
      isAuthorizedForShop,
      updateActiveShop
    }),
    [
      activeShop,
      availableShops,
      isLoading,
      error,
      setActiveShopId,
      loadShops,
      isAuthorizedForShop,
      updateActiveShop
    ]
  );

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopContextValue {
  const context = useContext(ShopContext);
  if (!context) {
    throw new Error('useShop must be used within a <ShopProvider>.');
  }
  return context;
}
