'use client';

/**
 * Accessible Shop Details & Service Catalog View for CAPS Customer Web.
 * Conforms to CAPS SRS Section 4.1 & 7.2.
 * Displays shop metadata, full categorized service catalog, live pricing,
 * operating status, dynamic queue ETA disclaimer, and order entry CTA.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Shop } from '../types';
import { defaultShopsService } from '../shops-service';
import { formatDistance, getDirectionsUrl, useGeolocation } from '../geo-utils';
import { getShopServiceCatalog, getCategoryMetadata } from '../catalog-utils';

export interface ShopDetailsViewProps {
  shopId: string;
}

export function ShopDetailsView({ shopId }: ShopDetailsViewProps) {
  const geo = useGeolocation();

  const [shop, setShop] = useState<Shop | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchShop = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const found = await defaultShopsService.getShopById(shopId);
      setShop(found);
    } catch (err) {
      console.error('Failed to load shop details:', err);
      setError('Unable to fetch shop details. Please verify your connection.');
    } finally {
      setIsLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    fetchShop();
  }, [fetchShop]);

  const distanceLabel = useMemo(() => {
    if (!shop || !geo.coordinates) return null;
    return formatDistance(shop.distance_meters);
  }, [shop, geo.coordinates]);

  const catalog = useMemo(() => {
    if (!shop) return [];
    return getShopServiceCatalog(shop);
  }, [shop]);

  // Group catalog by category
  const categories = useMemo(() => {
    const map = new Map<string, typeof catalog>();
    for (const item of catalog) {
      const list = map.get(item.category) || [];
      list.push(item);
      map.set(item.category, list);
    }
    return Array.from(map.entries());
  }, [catalog]);

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="mx-auto max-w-4xl space-y-6 animate-pulse">
        <div className="h-6 w-32 rounded bg-slate-200" />
        <div className="h-44 w-full rounded-2xl bg-slate-200" />
        <div className="h-64 w-full rounded-2xl bg-slate-200" />
        <span className="sr-only">Loading shop details and catalog...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-2xl rounded-2xl border border-red-200 bg-red-50 p-8 text-center"
      >
        <h2 className="text-lg font-bold text-red-900">Failed to Load Shop</h2>
        <p className="mt-2 text-sm text-red-700">{error}</p>
        <div className="mt-6 flex justify-center gap-4">
          <button
            type="button"
            onClick={fetchShop}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700"
          >
            Retry
          </button>
          <a
            href="/shops"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to Shops
          </a>
        </div>
      </div>
    );
  }

  if (!shop) {
    return (
      <div
        role="region"
        aria-label="Shop not found"
        className="mx-auto max-w-2xl rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-2xl">
          🏪
        </div>
        <h2 className="mt-4 text-xl font-bold text-slate-900">Shop Not Found</h2>
        <p className="mt-2 text-sm text-slate-600">
          The requested photocopy shop does not exist or has been deactivated.
        </p>
        <div className="mt-6">
          <a
            href="/shops"
            className="inline-flex items-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            ← Return to Shops Directory
          </a>
        </div>
      </div>
    );
  }

  const directionsUrl = getDirectionsUrl(shop.name, shop.coordinates);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Breadcrumb Navigation */}
      <nav aria-label="Breadcrumb" className="flex items-center text-xs text-slate-500">
        <a href="/shops" className="hover:text-blue-600 hover:underline">
          Shops Directory
        </a>
        <span className="mx-2 text-slate-400">/</span>
        <span className="font-semibold text-slate-800 truncate" aria-current="page">
          {shop.name}
        </span>
      </nav>

      {/* Hero Header Card */}
      <section
        aria-labelledby="shop-header-title"
        className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1
                id="shop-header-title"
                className="text-2xl sm:text-3xl font-extrabold text-slate-900"
              >
                {shop.name}
              </h1>
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                  shop.is_open
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {shop.is_open ? '● Open Now' : 'Closed'}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
              <span className="flex items-center text-amber-600 font-bold">
                ★ {shop.rating.toFixed(1)}{' '}
                <span className="ml-1 text-slate-400 font-normal">
                  ({shop.review_count} verified reviews)
                </span>
              </span>
              <span>•</span>
              <span>
                Operating Hours:{' '}
                <strong className="text-slate-800">
                  {shop.opening_time} – {shop.closing_time}
                </strong>
              </span>
              {distanceLabel && (
                <>
                  <span>•</span>
                  <span className="font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                    {distanceLabel}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* External Map Directions */}
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Get directions to ${shop.name} on Google Maps (opens in new tab)`}
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
          >
            📍 Directions in Maps ↗
          </a>
        </div>

        {/* Address and Contact info */}
        <div className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-600 space-y-1">
          <p>
            <span className="font-medium text-slate-800">Address: </span>
            {shop.address}
          </p>
          {shop.landmark && (
            <p>
              <span className="font-medium text-slate-800">Landmark: </span>
              {shop.landmark}
            </p>
          )}
          <p>
            <span className="font-medium text-slate-800">Phone: </span>
            <a href={`tel:${shop.phone}`} className="text-blue-600 hover:underline">
              {shop.phone}
            </a>
          </p>
        </div>
      </section>

      {/* Closed Alert Banner */}
      {!shop.is_open && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-2xl border border-red-300 bg-red-50 p-5 text-red-900"
        >
          <div className="flex items-start space-x-3">
            <span className="text-xl">⚠️</span>
            <div>
              <h2 className="text-base font-bold">This Shop is Currently Closed</h2>
              <p className="mt-1 text-sm text-red-800">
                Operating hours are{' '}
                <strong>
                  {shop.opening_time} to {shop.closing_time}
                </strong>
                . New order configuration and file submissions are disabled until the shop reopens.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Service Catalog Section */}
      <section aria-labelledby="catalog-heading" className="space-y-6">
        <div>
          <h2 id="catalog-heading" className="text-xl font-bold text-slate-900 sm:text-2xl">
            Service Catalog & Transparent Rates
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Current configured printing, paper, binding, and queue capabilities at this shop
            location.
          </p>
        </div>

        <div className="space-y-6">
          {categories.map(([category, items]) => {
            const meta = getCategoryMetadata(category as Parameters<typeof getCategoryMetadata>[0]);
            return (
              <div
                key={category}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="flex items-center space-x-2 border-b border-slate-100 pb-3">
                  <span className="text-xl">{meta.icon}</span>
                  <h3 className="text-base font-bold text-slate-900">{meta.label}</h3>
                </div>

                <div className="mt-4 divide-y divide-slate-100">
                  {items.map(item => (
                    <div
                      key={item.id}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between py-4 first:pt-0 last:pb-0 gap-3 ${
                        !item.isAvailable ? 'opacity-70 bg-slate-50/50 -mx-6 px-6 rounded-lg' : ''
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <h4
                            className={`text-sm font-semibold ${
                              item.isAvailable ? 'text-slate-900' : 'text-slate-500 line-through'
                            }`}
                          >
                            {item.name}
                          </h4>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              item.isAvailable
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {item.isAvailable ? 'Available' : 'Unsupported'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 max-w-xl">{item.description}</p>
                        {item.unavailabilityReason && (
                          <p className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded inline-block mt-1">
                            ℹ️ {item.unavailabilityReason}
                          </p>
                        )}
                      </div>

                      <div className="text-right sm:min-w-36">
                        <span
                          className={`text-sm font-bold ${
                            item.isAvailable ? 'text-slate-900' : 'text-slate-400'
                          }`}
                        >
                          {item.priceFormatted}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Dynamic Queue ETA & Turnaround Policy Disclaimer */}
      <section
        aria-labelledby="eta-disclaimer-heading"
        className="rounded-2xl border border-blue-200 bg-blue-50/60 p-6 text-slate-800"
      >
        <div className="flex items-start space-x-3">
          <span className="text-2xl">⏱️</span>
          <div className="space-y-2">
            <h3 id="eta-disclaimer-heading" className="text-base font-bold text-blue-950">
              Estimated Completion Time & Dynamic Queue Disclaimer
            </h3>
            <p className="text-xs sm:text-sm text-blue-900 leading-relaxed">
              <strong>Dynamic Turnaround:</strong> Order completion ETAs are estimated dynamically
              based on current shop queue backlog, document page counts, and live physical printer
              spooler throughput.
            </p>
            <p className="text-xs sm:text-sm text-blue-900 leading-relaxed">
              <strong>Priority Tiers:</strong> Orders submitted with <em>Urgent Queue</em> jump
              ahead of Flexible FIFO jobs in the automated agent queue.
            </p>
            <p className="text-xs text-blue-800/90 leading-relaxed border-t border-blue-200/60 pt-2">
              🔒 <strong>Privacy Guarantee:</strong> All document files are transmitted over TLS,
              encrypted at rest, and purged immediately after print verification.
            </p>
          </div>
        </div>
      </section>

      {/* Action / Order Selection Footer */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="w-full sm:w-auto text-center sm:text-left">
          <a
            href="/shops"
            className="inline-flex items-center text-sm font-semibold text-slate-600 hover:text-blue-600 transition-colors"
          >
            ← Back to All Shops
          </a>
        </div>

        <div className="w-full sm:w-auto">
          {shop.is_open ? (
            <a
              href={`/print/new?shopId=${shop.id}`}
              className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-md hover:bg-blue-700 transition-colors"
            >
              Select Shop & Configure Order →
            </a>
          ) : (
            <div className="text-center sm:text-right">
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl bg-slate-200 px-6 py-3 text-sm font-bold text-slate-400 cursor-not-allowed shadow-none"
              >
                Shop Closed — Orders Disabled
              </button>
              <p className="mt-1 text-xs text-red-600 font-medium">
                Orders cannot be placed while the shop is closed.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
