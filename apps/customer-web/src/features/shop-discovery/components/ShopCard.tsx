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
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
    >
      {/* Top Header: Name, Rating, Open Status */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <h3 id={`shop-title-${shop.id}`} className="text-lg font-bold text-slate-900">
              {shop.name}
            </h3>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
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
          className="inline-flex items-center text-xs font-semibold text-slate-600 hover:text-blue-600 hover:underline"
        >
          📍 Directions ↗
        </a>
      </div>

      {/* Address & Landmark */}
      <div className="mt-3 text-sm text-slate-600">
        <p>{shop.address}</p>
        {shop.landmark && (
          <p className="text-xs text-slate-500 mt-0.5">Landmark: {shop.landmark}</p>
        )}
      </div>

      {/* Capability Tags */}
      <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Available printer features">
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
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
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

        <a
          href={`/print/new?shopId=${shop.id}`}
          className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 transition-colors"
        >
          Configure & Print →
        </a>
      </div>
    </article>
  );
}
