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
      const shops = await shopService.fetchOwnerShops(user.id, session?.access_token);
      setAvailableShops(shops);

      if (shops.length === 0) {
        setActiveShopIdState(null);
        shopService.clearActiveShopId();
        return;
      }

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
      if (!target && profile?.role !== 'admin' && profile?.role !== 'shop_owner') {
        throw new Error(`Cannot select unauthorized shop: ${shopId}`);
      }
      setActiveShopIdState(shopId);
      shopService.setActiveShopId(shopId);
    },
    [availableShops, profile?.role, shopService]
  );

  const isAuthorizedForShop = useCallback(
    (shopId: string): boolean => {
      if (profile?.role === 'admin' || profile?.role === 'shop_owner') return true;
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

  const createShop = useCallback(
    async (input: Parameters<ShopService['createShop']>[0]) => {
      if (!user) {
        throw new Error('Authentication required to register shop.');
      }
      const newShop = await shopService.createShop(input, user.id, session?.access_token);
      setAvailableShops(prev => [newShop, ...prev]);
      setActiveShopIdState(newShop.id);
      return newShop;
    },
    [user, shopService, session?.access_token]
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
      updateActiveShop,
      createShop
    }),
    [
      activeShop,
      availableShops,
      isLoading,
      error,
      setActiveShopId,
      loadShops,
      isAuthorizedForShop,
      updateActiveShop,
      createShop
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
