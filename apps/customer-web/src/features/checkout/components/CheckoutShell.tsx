'use client';

/**
 * Composite Order Review & Checkout Shell Component for CAPS Customer Web (P04-M05-F02).
 * Integrates order specification review, payment selection, idempotency double-click defense,
 * closed shop checks, and order confirmation.
 */

import React, { useMemo } from 'react';
import type { Shop } from '../../shop-discovery/types';
import type { PrintSettings } from '../../print-settings/types';
import type { QuoteResponse } from '../../pricing/types';
import type { CheckoutResult } from '../types';
import { formatPaiseToRupees } from '../../pricing/types';
import { defaultCheckoutService } from '../checkout-service';
import { useCheckout } from '../use-checkout';
import { OrderSummaryReview } from './OrderSummaryReview';
import { PaymentMethodSelector } from './PaymentMethodSelector';

export interface CheckoutShellProps {
  shop: Shop;
  documentName: string;
  documentStorageKey: string;
  fileSizeBytes: number;
  customerId: string;
  settings: PrintSettings;
  quote: QuoteResponse;
  onOrderConfirmed: (result: CheckoutResult) => void;
  onBackToQuote?: (() => void) | undefined;
}

export function CheckoutShell({
  shop,
  documentName,
  documentStorageKey,
  fileSizeBytes,
  customerId,
  settings,
  quote,
  onOrderConfirmed,
  onBackToQuote
}: CheckoutShellProps) {
  const { paymentMethod, isSubmitting, error, setPaymentMethod, submitOrder, clearError } =
    useCheckout({
      shopId: shop.id,
      customerId,
      documentStorageKey,
      documentName,
      fileSizeBytes,
      settings,
      priorityTier: quote.priority_tier,
      quote
    });

  // Check if shop permits pay at counter
  const counterEligibility = useMemo(() => {
    return defaultCheckoutService.canPayAtCounter(shop);
  }, [shop]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting || !shop.is_open) return;

    const result = await submitOrder();
    if (result) {
      onOrderConfirmed(result);
    }
  };

  const isClosed = !shop.is_open;
  const isExpired = quote.expires_at ? Date.now() >= new Date(quote.expires_at).getTime() : false;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label="Order review and checkout form"
      className="space-y-8"
    >
      {/* Closed Shop Blocker Alert */}
      {isClosed && (
        <div
          role="alert"
          className="rounded-2xl border-2 border-red-300 bg-red-50 p-5 text-xs text-red-900 shadow-sm flex items-start space-x-3"
        >
          <span className="text-2xl shrink-0" aria-hidden="true">
            🛑
          </span>
          <div>
            <h4 className="font-extrabold text-sm text-red-950">Shop is Currently Closed</h4>
            <p className="mt-0.5 text-red-800">
              {shop.name} is closed right now (Opening hours: {shop.opening_time} –{' '}
              {shop.closing_time}). New print jobs cannot be submitted while the shop is closed.
            </p>
          </div>
        </div>
      )}

      {/* Submission Error Alert */}
      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 flex items-center justify-between"
        >
          <div className="flex items-center space-x-2">
            <span>⚠️</span>
            <span>{error.message}</span>
          </div>
          <button
            type="button"
            onClick={clearError}
            className="text-xs font-bold text-red-700 underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 1. Order Summary & Print Review */}
      <OrderSummaryReview
        shop={shop}
        documentName={documentName}
        fileSizeBytes={fileSizeBytes}
        settings={settings}
        quote={quote}
      />

      {/* 2. Payment Method Selector */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <PaymentMethodSelector
          value={paymentMethod}
          onChange={setPaymentMethod}
          isPayAtCounterAllowed={counterEligibility.allowed}
          payAtCounterDisabledReason={counterEligibility.reason}
          disabled={isSubmitting || isClosed}
        />
      </div>

      {/* 3. Action Buttons & Double-Click Guard */}
      <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-4 pt-2">
        {onBackToQuote && (
          <button
            type="button"
            onClick={onBackToQuote}
            disabled={isSubmitting}
            className="w-full sm:w-auto rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            ← Back to Quote
          </button>
        )}

        <button
          type="submit"
          disabled={isSubmitting || isClosed || isExpired}
          className="w-full sm:w-auto flex items-center justify-center space-x-2 rounded-xl bg-blue-600 px-8 py-3.5 text-sm font-bold text-white shadow-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all ml-auto"
        >
          {isSubmitting ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>Placing Order & Enqueueing...</span>
            </>
          ) : paymentMethod === 'pay_at_counter' ? (
            <span>Confirm Order (Pay at Counter) →</span>
          ) : (
            <span>
              Pay {formatPaiseToRupees(quote.price_breakdown.total_paise)} & Place Order →
            </span>
          )}
        </button>
      </div>
    </form>
  );
}
