'use client';

/**
 * Composite Live Quote Summary Component for CAPS Customer Web (P04-M05-F01).
 * Integrates queue priority selection, real-time debounced server quote,
 * tax breakdown, ETA estimate, and checkout progression.
 */

import React from 'react';
import type { PrintSettings } from '../../print-settings/types';
import type { QuoteResponse } from '../types';
import { useLiveQuote } from '../use-live-quote';
import { PriorityTierSelector } from './PriorityTierSelector';
import { PriceBreakdownCard } from './PriceBreakdownCard';

export interface LiveQuoteSummaryProps {
  shopId: string;
  settings: PrintSettings;
  documentPageCount: number;
  shopName?: string | undefined;
  onProceedToCheckout: (quote: QuoteResponse) => void;
  onBackToSettings?: (() => void) | undefined;
}

export function LiveQuoteSummary({
  shopId,
  settings,
  documentPageCount,
  shopName = 'Selected Shop',
  onProceedToCheckout,
  onBackToSettings
}: LiveQuoteSummaryProps) {
  const {
    quote,
    priorityTier,
    isLoading,
    isStale,
    isExpired,
    timeRemainingSeconds,
    error,
    setPriorityTier,
    refreshQuote
  } = useLiveQuote({
    shopId,
    settings,
    documentPageCount,
    debounceMs: 250
  });

  const handleCheckoutClick = () => {
    if (quote && !isExpired && !isLoading) {
      onProceedToCheckout(quote);
    }
  };

  return (
    <div className="space-y-6" role="region" aria-label="Print Quote & Pricing">
      {/* Network or Calculation Error Banner */}
      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 flex items-center justify-between"
        >
          <div className="flex items-center space-x-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={refreshQuote}
            className="rounded-lg bg-red-600 px-3 py-1 font-bold text-white hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Priority Tier Selector */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <PriorityTierSelector
          value={priorityTier}
          onChange={setPriorityTier}
          urgentSurchargePaise={quote?.price_breakdown.urgent_surcharge_paise || 2000}
          estimatedWaitMinutesFlexible={
            priorityTier === 'flexible' ? quote?.estimated_wait_minutes : 15
          }
          estimatedWaitMinutesUrgent={priorityTier === 'urgent' ? quote?.estimated_wait_minutes : 4}
          disabled={isLoading}
        />
      </div>

      {/* Live Itemized Breakdown Card */}
      <PriceBreakdownCard
        breakdown={quote?.price_breakdown || null}
        pageCount={quote?.page_count || documentPageCount}
        copies={settings.copies}
        isLoading={isLoading}
        isStale={isStale}
        isExpired={isExpired}
        timeRemainingSeconds={timeRemainingSeconds}
        onRefreshQuote={refreshQuote}
      />

      {/* Estimated Completion & Queue Placement Notice */}
      {quote && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-xs text-blue-900 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <span className="text-xl">⏱️</span>
            <div>
              <p className="font-bold">
                Estimated Queue Wait: ~{quote.estimated_wait_minutes} minutes
              </p>
              <p className="text-blue-700 mt-0.5">
                Target shop: <strong>{shopName}</strong> · Standard queue admission upon payment
                confirmation
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Action Navigation Bar */}
      <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-4 pt-2">
        {onBackToSettings && (
          <button
            type="button"
            onClick={onBackToSettings}
            className="w-full sm:w-auto rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            ← Modify Settings
          </button>
        )}

        <button
          type="button"
          disabled={!quote || isExpired || isLoading}
          onClick={handleCheckoutClick}
          className="w-full sm:w-auto flex items-center justify-center space-x-2 rounded-xl bg-blue-600 px-8 py-3 text-sm font-bold text-white shadow-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all ml-auto"
        >
          <span>Confirm & Proceed to Checkout →</span>
        </button>
      </div>
    </div>
  );
}
