'use client';

/**
 * Itemized Live Price Breakdown Card for CAPS Customer Web (P04-M05-F01).
 * Displays server-authoritative itemized costs:
 * - Base pages cost
 * - Color surcharge
 * - Duplex discount
 * - Binding fee
 * - Urgent surcharge
 * - GST (18%)
 * - Authoritative total in INR / paise
 * - Live expiration countdown timer (15 mins) & stale loading badges
 */

import React from 'react';
import type { PriceBreakdown } from '../types';
import { formatPaiseToRupees } from '../types';

export interface PriceBreakdownCardProps {
  breakdown: PriceBreakdown | null;
  pageCount?: number | undefined;
  copies?: number | undefined;
  isLoading?: boolean | undefined;
  isStale?: boolean | undefined;
  isExpired?: boolean | undefined;
  timeRemainingSeconds?: number | undefined;
  onRefreshQuote?: (() => void) | undefined;
}

export function PriceBreakdownCard({
  breakdown,
  pageCount = 1,
  copies = 1,
  isLoading = false,
  isStale = false,
  isExpired = false,
  timeRemainingSeconds = 0,
  onRefreshQuote
}: PriceBreakdownCardProps) {
  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      role="region"
      aria-label="Authoritative Price Breakdown"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5 relative"
    >
      {/* Header & Status Indicator */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center space-x-2">
          <h2 className="text-base font-bold text-slate-900">Price Breakdown</h2>
          <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
            Authoritative Server Quote
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {isLoading && (
            <div className="flex items-center space-x-1.5 text-xs text-blue-600">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              <span>Calculating...</span>
            </div>
          )}
          {!isLoading && isStale && (
            <span className="text-xs text-amber-600 font-medium">Updating...</span>
          )}
        </div>
      </div>

      {/* Quote Expiration Banner */}
      {isExpired ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 flex items-center justify-between"
        >
          <div className="flex items-center space-x-2">
            <span>⏱️</span>
            <span>This quote has expired. Please refresh for current shop pricing.</span>
          </div>
          {onRefreshQuote && (
            <button
              type="button"
              onClick={onRefreshQuote}
              className="rounded-lg bg-red-600 px-3 py-1 font-bold text-white hover:bg-red-700 transition-colors"
            >
              Refresh Quote
            </button>
          )}
        </div>
      ) : timeRemainingSeconds > 0 ? (
        <div className="flex items-center justify-between text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-2">
          <span>Quote price guaranteed for:</span>
          <span className="font-mono font-bold text-slate-800">
            {formatTimer(timeRemainingSeconds)}
          </span>
        </div>
      ) : null}

      {/* Line Items */}
      {breakdown ? (
        <div className={`space-y-3 transition-opacity ${isStale ? 'opacity-60' : 'opacity-100'}`}>
          {/* Base Pages Cost */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">
              Document Printing ({pageCount} {pageCount === 1 ? 'page' : 'pages'} × {copies}{' '}
              {copies === 1 ? 'copy' : 'copies'})
            </span>
            <span className="font-semibold text-slate-900">
              {formatPaiseToRupees(breakdown.base_pages_paise)}
            </span>
          </div>

          {/* Color Surcharge (if applied) */}
          {breakdown.color_surcharge_paise > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Full Color Printing Surcharge</span>
              <span className="font-semibold text-slate-900">
                +{formatPaiseToRupees(breakdown.color_surcharge_paise)}
              </span>
            </div>
          )}

          {/* Duplex Discount (if applied) */}
          {breakdown.duplex_discount_paise > 0 && (
            <div className="flex items-center justify-between text-sm text-emerald-700">
              <span>Double-sided (Duplex) Paper Discount</span>
              <span className="font-semibold">
                −{formatPaiseToRupees(breakdown.duplex_discount_paise)}
              </span>
            </div>
          )}

          {/* Finishing / Binding Fee (if applied) */}
          {breakdown.binding_fee_paise > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Finishing / Binding Service</span>
              <span className="font-semibold text-slate-900">
                +{formatPaiseToRupees(breakdown.binding_fee_paise)}
              </span>
            </div>
          )}

          {/* Urgent Surcharge (if applied) */}
          {breakdown.urgent_surcharge_paise > 0 && (
            <div className="flex items-center justify-between text-sm text-amber-800">
              <span className="font-medium flex items-center space-x-1">
                <span>⚡</span>
                <span>Urgent Priority Queue Jump</span>
              </span>
              <span className="font-bold">
                +{formatPaiseToRupees(breakdown.urgent_surcharge_paise)}
              </span>
            </div>
          )}

          {/* Pre-tax Subtotal */}
          <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
            <span>Subtotal (before tax)</span>
            <span>{formatPaiseToRupees(breakdown.subtotal_paise)}</span>
          </div>

          {/* Goods & Services Tax (GST 18%) */}
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Goods & Services Tax (GST 18%)</span>
            <span>{formatPaiseToRupees(breakdown.gst_paise)}</span>
          </div>

          {/* Final Total Amount Payable */}
          <div className="flex items-center justify-between text-base font-extrabold text-slate-900 pt-3 border-t-2 border-slate-200">
            <div>
              <span className="block">Total Payable</span>
              <span className="block text-[11px] font-normal text-slate-400">
                Includes all taxes & finishing charges
              </span>
            </div>
            <span className="text-2xl font-black text-blue-600">
              {formatPaiseToRupees(breakdown.total_paise)}
            </span>
          </div>
        </div>
      ) : (
        <div className="py-8 text-center text-xs text-slate-400 animate-pulse">
          Calculating live itemized quote...
        </div>
      )}
    </div>
  );
}
