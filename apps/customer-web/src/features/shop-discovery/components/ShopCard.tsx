'use client';

/**
 * Accessible Shop Card component for CAPS Customer Web.
 * Displays shop metadata, operating hours, ratings, distance, capabilities,
 * pricing preview, and map-free directions link.
 */

import React from 'react';
import type { Shop } from '../types';
import { formatDistance, getDirectionsUrl } from '../geo-utils';
import { formatPaiseToInr } from '../../orders/orders-service';

export interface ShopCardProps {
  shop: Shop;
}

export function ShopCard({ shop }: ShopCardProps) {
  const distanceLabel = formatDistance(shop.distance_meters);
  const directionsUrl = getDirectionsUrl(shop.name, shop.coordinates);

  return (
    <article
      aria-labelledby={`shop-title-${shop.id}`}
      className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xs transition-shadow hover:shadow-md"
    >
      {/* Top Header: Name, Rating, Open Status */}
      <div className="flex flex-wrap items-start justify-between gap-2 sm:gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`shop-title-${shop.id}`} className="text-base sm:text-lg font-bold text-slate-900 truncate">
              <a href={`/shops/${shop.id}`} className="hover:text-blue-600 hover:underline">
                {shop.name}
              </a>
            </h3>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0 ${
                shop.is_open
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {shop.is_open ? '● Open Now' : 'Closed'}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center text-amber-600 font-semibold">
              ★ {shop.rating.toFixed(1)}{' '}
              <span className="ml-1 text-slate-400 font-normal">({shop.review_count} reviews)</span>
            </span>
            <span>•</span>
            <span>
              Hours: {shop.opening_time} – {shop.closing_time}
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

        {/* Action Link: Map-free directions fallback */}
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open directions to ${shop.name} in Google Maps (opens in new tab)`}
          className="inline-flex items-center text-xs font-semibold text-slate-600 hover:text-blue-600 hover:underline shrink-0"
        >
          📍 Directions ↗
        </a>
      </div>

      {/* Address & Landmark */}
      <div className="mt-3 text-sm text-slate-600">
        <p className="leading-snug">{shop.address}</p>
        {shop.landmark && (
          <p className="text-xs text-slate-500 mt-0.5">Landmark: {shop.landmark}</p>
        )}
      </div>

      {/* Capability Tags */}
      <div className="mt-3.5 flex flex-wrap gap-1.5" aria-label="Available printer features">
        <span
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${
            shop.capabilities.color
              ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
              : 'bg-slate-100 text-slate-400 line-through'
          }`}
        >
          {shop.capabilities.color ? '🎨 Color Print' : 'Color N/A'}
        </span>
        <span
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${
            shop.capabilities.duplex
              ? 'bg-blue-50 text-blue-700 border border-blue-200'
              : 'bg-slate-100 text-slate-400 line-through'
          }`}
        >
          {shop.capabilities.duplex ? '📄 2-Sided (Duplex)' : 'Duplex N/A'}
        </span>
        {shop.capabilities.paper_sizes.includes('A3') && (
          <span className="rounded-md bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 border border-purple-200">
            📐 A3 Supported
          </span>
        )}
        {shop.capabilities.spiral_binding && (
          <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
            🌀 Spiral Binding
          </span>
        )}
        {shop.capabilities.urgent_queue && (
          <span className="rounded-md bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 border border-amber-200">
            ⚡ Urgent Queue
          </span>
        )}
      </div>

      {/* Pricing Preview and Order CTA */}
      <div className="mt-4 sm:mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-slate-100 pt-4">
        <div className="text-xs text-slate-600">
          <span className="font-medium text-slate-900">B&W: </span>
          <span className="font-bold text-slate-900">
            {formatPaiseToInr(shop.pricing.bw_per_page_paise)}
          </span>
          /pg
          {shop.capabilities.color && (
            <>
              <span className="mx-2">•</span>
              <span className="font-medium text-slate-900">Color: </span>
              <span className="font-bold text-slate-900">
                {formatPaiseToInr(shop.pricing.color_per_page_paise)}
              </span>
              /pg
            </>
          )}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <a
            href={`/shops/${shop.id}`}
            className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors"
          >
            View Services
          </a>
          {shop.is_open ? (
            <a
              href={`/print/new?shopId=${shop.id}`}
              className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-blue-700 transition-colors"
            >
              Configure & Print →
            </a>
          ) : (
            <span
              aria-disabled="true"
              className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-400 cursor-not-allowed"
            >
              Shop Closed
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
