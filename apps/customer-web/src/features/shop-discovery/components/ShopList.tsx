'use client';

/**
 * Accessible Shop Discovery List container for CAPS Customer Web.
 * Connects geolocation, live search, capability filtering, map-free listings,
 * and pagination.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Shop, ShopFilterOptions } from '../types';
import { defaultShopsService } from '../shops-service';
import { useGeolocation } from '../geo-utils';
import { ShopCard } from './ShopCard';
import { ShopFilters } from './ShopFilters';

export function ShopList() {
  const geo = useGeolocation();

  const [filters, setFilters] = useState<ShopFilterOptions>({
    searchQuery: '',
    openOnly: false,
    supportsColor: false,
    supportsDuplex: false,
    supportsA3: false,
    supportsSpiral: false,
    supportsUrgent: false,
    page: 1,
    limit: 6
  });

  const [shops, setShops] = useState<Shop[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hasActiveFilters = useMemo(() => {
    return !!(
      filters.searchQuery ||
      filters.openOnly ||
      filters.supportsColor ||
      filters.supportsDuplex ||
      filters.supportsA3 ||
      filters.supportsSpiral ||
      filters.supportsUrgent
    );
  }, [filters]);

  const loadShops = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const mergedOptions: ShopFilterOptions = {
        ...filters,
        userCoordinates: geo.coordinates ?? undefined,
        sortBy: filters.sortBy || (geo.coordinates ? 'distance' : 'rating')
      };

      const response = await defaultShopsService.getShops(mergedOptions);
      setShops(response.shops);
      setTotalPages(response.totalPages);
      setTotalCount(response.totalCount);
    } catch (err) {
      console.error('Failed to load shops:', err);
      setError('Unable to load nearby photocopy shops. Please check your connection.');
    } finally {
      setIsLoading(false);
    }
  }, [filters, geo.coordinates]);

  useEffect(() => {
    loadShops();
  }, [loadShops]);

  const handleResetFilters = () => {
    setFilters({
      searchQuery: '',
      openOnly: false,
      supportsColor: false,
      supportsDuplex: false,
      supportsA3: false,
      supportsSpiral: false,
      supportsUrgent: false,
      page: 1,
      limit: 6
    });
  };

  return (
    <div className="w-full space-y-6">
      {/* Header Banner */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Photocopy & Xerox Shops Near You
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Discover verified xerox shops, compare live prices, check color and duplex availability,
          and skip the line by ordering online.
        </p>
      </div>

      {/* Geolocation Permission Fallback Notice */}
      {geo.status === 'denied' && (
        <div
          role="note"
          aria-label="Location notice"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 p-4 text-xs text-amber-800 border border-amber-200"
        >
          <div className="flex items-center space-x-2">
            <span>📍</span>
            <span>
              <strong>Location access was denied:</strong> Showing shops sorted by popularity and rating.
              Enable location permissions in your browser to see exact walking distances.
            </span>
          </div>
          <button
            type="button"
            onClick={geo.requestLocation}
            className="font-semibold text-amber-900 underline hover:no-underline"
          >
            Retry Location
          </button>
        </div>
      )}

      {/* Geolocation Enabled Notice */}
      {geo.status === 'granted' && (
        <div
          role="status"
          className="flex items-center space-x-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800 border border-emerald-200"
        >
          <span>🎯</span>
          <span>
            Using your precise device location. Shops are automatically sorted by walking distance.
          </span>
        </div>
      )}

      {/* Search and Capabilities Filter Bar */}
      <ShopFilters
        filters={{
          ...filters,
          userCoordinates: geo.coordinates ?? undefined
        }}
        onChange={setFilters}
        onReset={handleResetFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Error Banner */}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-xl bg-red-50 p-4 text-sm text-red-700 border border-red-200"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={loadShops}
            className="font-semibold text-red-800 underline hover:no-underline ml-4"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading ? (
        <div role="status" aria-live="polite" className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-64 w-full animate-pulse rounded-2xl border border-slate-200 bg-slate-50 p-6"
            />
          ))}
          <span className="sr-only">Finding photocopy shops near you...</span>
        </div>
      ) : shops.length === 0 ? (
        /* Empty State */
        <div
          role="region"
          aria-label="No shops found"
          className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-2xl text-slate-500">
            🔍
          </div>
          <h3 className="mt-4 text-lg font-semibold text-slate-900">No photocopy shops match your filters</h3>
          <p className="mt-2 text-sm text-slate-600 max-w-md mx-auto">
            Try adjusting your search query, turning off capability filters, or removing the &quot;Open Now&quot; restriction.
          </p>
          <div className="mt-6">
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              Reset All Filters
            </button>
          </div>
        </div>
      ) : (
        /* Shops Grid */
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2" role="feed" aria-label="Available photocopy shops">
          {shops.map((shop) => (
            <ShopCard key={shop.id} shop={shop} />
          ))}
        </div>
      )}

      {/* Pagination Controls */}
      {!isLoading && totalPages > 1 && (
        <nav
          aria-label="Shop discovery pagination"
          className="flex items-center justify-between border-t border-slate-200 pt-5"
        >
          <button
            type="button"
            disabled={(filters.page || 1) <= 1}
            onClick={() =>
              setFilters((prev) => ({ ...prev, page: Math.max(1, (prev.page || 1) - 1) }))
            }
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            ← Previous
          </button>

          <p className="text-xs text-slate-600 font-medium">
            Page <span className="font-bold text-slate-900">{filters.page || 1}</span> of{' '}
            <span className="font-bold text-slate-900">{totalPages}</span> ({totalCount} verified shops)
          </p>

          <button
            type="button"
            disabled={(filters.page || 1) >= totalPages}
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                page: Math.min(totalPages, (prev.page || 1) + 1)
              }))
            }
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Next →
          </button>
        </nav>
      )}
    </div>
  );
}
