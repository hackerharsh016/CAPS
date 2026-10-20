'use client';

/**
 * Order Summary and Configuration Review Card for CAPS Customer Web (P04-M05-F02).
 * Shows complete order details, target shop context, privacy guarantees, and receipt breakdown.
 */

import React from 'react';
import type { Shop } from '../../shop-discovery/types';
import type { PrintSettings } from '../../print-settings/types';
import type { QuoteResponse } from '../../pricing/types';
import { formatPaiseToRupees } from '../../pricing/types';

export interface OrderSummaryReviewProps {
  shop: Shop;
  documentName: string;
  fileSizeBytes?: number | undefined;
  settings: PrintSettings;
  quote: QuoteResponse;
}

export function OrderSummaryReview({
  shop,
  documentName,
  settings,
  quote
}: OrderSummaryReviewProps) {
  const { price_breakdown } = quote;

  return (
    <div className="space-y-6" role="region" aria-label="Order summary review">
      {/* 1. Target Shop Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-2xl text-blue-600">
            🏪
          </span>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-bold text-sm text-slate-900">{shop.name}</h3>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  shop.is_open ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                }`}
              >
                {shop.is_open ? 'Open Now' : 'Closed'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{shop.address}</p>
            <p className="text-[11px] text-slate-400">
              Hours: {shop.opening_time} – {shop.closing_time} · Phone: {shop.phone}
            </p>
          </div>
        </div>

        <a
          href="/shops"
          className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline shrink-0"
        >
          Change Shop
        </a>
      </div>

      {/* 2. Document & Print Configuration Grid */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
            <span>📑</span>
            <span>Print Specifications</span>
          </h3>
          <span className="text-xs font-bold bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full">
            {quote.priority_tier === 'urgent' ? '⚡ Urgent Queue' : 'Standard FIFO'}
          </span>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <dt className="text-slate-400 font-medium">Document</dt>
            <dd className="font-bold text-slate-800 mt-0.5 truncate" title={documentName}>
              {documentName}
            </dd>
          </div>

          <div>
            <dt className="text-slate-400 font-medium">Paper & Color</dt>
            <dd className="font-bold text-slate-800 mt-0.5">
              {settings.paper_size} · {settings.color_mode === 'color' ? 'Full Color' : 'B&W'}
            </dd>
          </div>

          <div>
            <dt className="text-slate-400 font-medium">Sides & Layout</dt>
            <dd className="font-bold text-slate-800 mt-0.5">
              {settings.sides === 'double' ? 'Double-sided' : 'Single-sided'} (
              {settings.orientation})
            </dd>
          </div>

          <div>
            <dt className="text-slate-400 font-medium">Finishing Service</dt>
            <dd className="font-bold text-slate-800 mt-0.5 capitalize">
              {settings.binding === 'none' ? 'Loose Sheets' : `${settings.binding} Binding`}
            </dd>
          </div>
        </dl>

        <div className="rounded-xl bg-slate-50 p-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <div>
            Pages: <strong>{quote.page_count}</strong> {quote.page_count === 1 ? 'page' : 'pages'} ×{' '}
            <strong>{settings.copies}</strong> {settings.copies === 1 ? 'copy' : 'copies'} (Range:{' '}
            <code className="bg-white px-1 py-0.5 rounded text-slate-800 font-mono">
              {settings.page_range}
            </code>
            )
          </div>
          <div>
            Queue ETA:{' '}
            <strong className="text-slate-900">~{quote.estimated_wait_minutes} min</strong>
          </div>
        </div>
      </div>

      {/* 3. Itemized Receipt */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
        <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
          Billing Summary
        </h3>

        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-600">Base Document Printout</span>
            <span className="font-semibold text-slate-800">
              {formatPaiseToRupees(price_breakdown.base_pages_paise)}
            </span>
          </div>

          {price_breakdown.color_surcharge_paise > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-600">Full Color Printing Surcharge</span>
              <span className="font-semibold text-slate-800">
                +{formatPaiseToRupees(price_breakdown.color_surcharge_paise)}
              </span>
            </div>
          )}

          {price_breakdown.duplex_discount_paise > 0 && (
            <div className="flex justify-between text-emerald-700">
              <span>Duplex Paper Discount</span>
              <span className="font-semibold">
                −{formatPaiseToRupees(price_breakdown.duplex_discount_paise)}
              </span>
            </div>
          )}

          {price_breakdown.binding_fee_paise > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-600">Finishing / Binding Fee</span>
              <span className="font-semibold text-slate-800">
                +{formatPaiseToRupees(price_breakdown.binding_fee_paise)}
              </span>
            </div>
          )}

          {price_breakdown.urgent_surcharge_paise > 0 && (
            <div className="flex justify-between text-amber-800 font-medium">
              <span>⚡ Urgent Priority Surcharge</span>
              <span className="font-bold">
                +{formatPaiseToRupees(price_breakdown.urgent_surcharge_paise)}
              </span>
            </div>
          )}

          <div className="flex justify-between pt-2 border-t border-slate-100 text-slate-500">
            <span>Subtotal</span>
            <span>{formatPaiseToRupees(price_breakdown.subtotal_paise)}</span>
          </div>

          <div className="flex justify-between text-slate-500">
            <span>GST (18%)</span>
            <span>{formatPaiseToRupees(price_breakdown.gst_paise)}</span>
          </div>

          <div className="flex justify-between text-base font-extrabold text-slate-900 pt-2 border-t-2 border-slate-200">
            <span>Amount Payable</span>
            <span className="text-xl text-blue-600">
              {formatPaiseToRupees(price_breakdown.total_paise)}
            </span>
          </div>
        </div>
      </div>

      {/* 4. Privacy Guarantee Callout */}
      <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 flex items-start space-x-2.5 text-xs text-slate-600">
        <span className="text-base" aria-hidden="true">
          🔒
        </span>
        <div>
          <strong className="text-slate-800 font-semibold">Strict Privacy Assurance:</strong> Your
          uploaded files are encrypted in transit and at rest. Documents are permanently purged
          within 24 hours of printing.
        </div>
      </div>
    </div>
  );
}
