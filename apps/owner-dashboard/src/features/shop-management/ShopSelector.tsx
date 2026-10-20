'use client';

/**
 * Accessible Shop Selector Component for CAPS Owner Dashboard.
 * Allows multi-shop owners to switch context and displays active shop status.
 */

import React from 'react';
import { useShop } from './shop-context';

export function ShopSelector() {
  const { activeShop, availableShops, setActiveShopId, isLoading } = useShop();

  if (isLoading) {
    return (
      <div className="flex items-center space-x-2 text-xs text-slate-400">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-slate-300"></span>
        <span>Loading shop...</span>
      </div>
    );
  }

  if (!activeShop || availableShops.length === 0) {
    return (
      <div className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded">
        No shop registered
      </div>
    );
  }

  // Single shop: render static pill badge
  if (availableShops.length === 1) {
    return (
      <div className="flex items-center space-x-2 rounded-lg bg-slate-100 px-3 py-1.5 border border-slate-200">
        <span
          className={`h-2 w-2 rounded-full ${
            activeShop.status === 'open' ? 'bg-emerald-500' : 'bg-rose-500'
          }`}
          aria-hidden="true"
        />
        <span className="text-xs font-semibold text-slate-800 truncate max-w-[180px]">
          {activeShop.name}
        </span>
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600">
          {activeShop.status}
        </span>
      </div>
    );
  }

  // Multiple shops: render accessible dropdown selector
  return (
    <div className="flex items-center space-x-2">
      <label htmlFor="shop-select" className="sr-only">
        Active Shop
      </label>
      <div className="relative">
        <select
          id="shop-select"
          value={activeShop.id}
          onChange={e => setActiveShopId(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          aria-label="Select active printing shop"
        >
          {availableShops.map(shop => (
            <option key={shop.id} value={shop.id}>
              {shop.name} ({shop.status})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
