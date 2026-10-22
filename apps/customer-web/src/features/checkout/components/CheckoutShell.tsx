'use client';

/**
 * Composite Order Review & Checkout Shell Component for CAPS Customer Web (P04-M05-F02).
 * Integrates order specification review, payment selection, idempotency double-click defense,
 * closed shop checks, and order confirmation.
 */

import React, { useMemo, useState } from 'react';
import type { Shop } from '../../shop-discovery/types';
import type { PrintSettings } from '../../print-settings/types';
import type { QuoteResponse } from '../../pricing/types';
import type { CheckoutResult } from '../types';
import { formatPaiseToRupees } from '../../pricing/types';
import { defaultCheckoutService } from '../checkout-service';
import { useCheckout } from '../use-checkout';
import { OrderSummaryReview } from './OrderSummaryReview';
import { PaymentMethodSelector } from './PaymentMethodSelector';
import { RazorpayModal, type CustomerDetails } from '../../../components/checkout/razorpay-modal';
import {
  CheckoutService as ApiCheckoutService,
  type PaymentOrderData,
  type RazorpayPaymentSuccess
} from '../../../services/api/checkout.service';

export interface CheckoutShellProps {
  shop: Shop;
  documentName: string;
  documentStorageKey: string;
  fileSizeBytes: number;
  customerId: string;
  customerDetails?: CustomerDetails | undefined;
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
  customerDetails,
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

  const [apiCheckoutService] = useState(() => new ApiCheckoutService());
  const [paymentOrder, setPaymentOrder] = useState<PaymentOrderData | null>(null);
  const [isRazorpayModalOpen, setIsRazorpayModalOpen] = useState(false);
  const [pendingCheckoutResult, setPendingCheckoutResult] = useState<CheckoutResult | null>(null);
  const [isInitiatingPayment, setIsInitiatingPayment] = useState(false);
  const [paymentErrorMsg, setPaymentErrorMsg] = useState<string | null>(null);

  // Check if shop permits pay at counter
  const counterEligibility = useMemo(() => {
    return defaultCheckoutService.canPayAtCounter(shop);
  }, [shop]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting || isInitiatingPayment || !shop.is_open) return;
    setPaymentErrorMsg(null);

    const result = await submitOrder();
    if (!result) return;

    // Counter checkout completes immediately without gateway modal
    if (paymentMethod === 'pay_at_counter') {
      onOrderConfirmed(result);
      return;
    }

    // Real Online Payment flow (UPI, Card, Wallet):
    // 1. Initiate Razorpay order on Cloud API
    setIsInitiatingPayment(true);
    try {
      const order = await apiCheckoutService.createPaymentOrder({
        print_job_id: result.order_id,
        requested_amount_paise: quote.price_breakdown.total_paise,
        amount_paise: quote.price_breakdown.total_paise,
        notes: {
          customer_name: customerDetails?.name || 'Customer',
          customer_email: customerDetails?.email || '',
          customer_phone: customerDetails?.phone || '',
          payment_method: paymentMethod
        }
      });

      setPendingCheckoutResult(result);
      setPaymentOrder(order);
      setIsRazorpayModalOpen(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to initialize payment.';
      setPaymentErrorMsg(msg);
    } finally {
      setIsInitiatingPayment(false);
    }
  };

  const handlePaymentSuccess = async (paymentSuccess: RazorpayPaymentSuccess) => {
    setIsRazorpayModalOpen(false);

    if (!pendingCheckoutResult) return;

    // Reconcile payment with Cloud API
    try {
      const apiUrl = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000';
      await fetch(`${apiUrl}/api/v1/payments/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          print_job_id: pendingCheckoutResult.order_id,
          order_id: paymentSuccess.razorpay_order_id
        })
      });
    } catch (err) {
      console.warn('Payment reconciliation warning:', err);
    }

    const confirmed: CheckoutResult = {
      ...pendingCheckoutResult,
      status: 'queued',
      payment_status: 'paid'
    };

    onOrderConfirmed(confirmed);
  };

  const handlePaymentDismiss = () => {
    setIsRazorpayModalOpen(false);
    setPaymentErrorMsg('Payment was cancelled or dismissed. You can retry when ready.');
  };

  const handlePaymentError = (err: Error) => {
    setIsRazorpayModalOpen(false);
    setPaymentErrorMsg(err.message || 'Payment transaction failed. Please retry.');
  };

  const isClosed = !shop.is_open;
  const isExpired = quote.expires_at ? Date.now() >= new Date(quote.expires_at).getTime() : false;
  const isBusy = isSubmitting || isInitiatingPayment;

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
      {(error || paymentErrorMsg) && (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 flex items-center justify-between"
        >
          <div className="flex items-center space-x-2">
            <span>⚠️</span>
            <span>{paymentErrorMsg || error?.message}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              clearError();
              setPaymentErrorMsg(null);
            }}
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
          disabled={isBusy || isClosed}
        />
      </div>

      {/* 3. Action Buttons & Double-Click Guard */}
      <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-4 pt-2">
        {onBackToQuote && (
          <button
            type="button"
            onClick={onBackToQuote}
            disabled={isBusy}
            className="w-full sm:w-auto rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            ← Back to Quote
          </button>
        )}

        <button
          type="submit"
          disabled={isBusy || isClosed || isExpired}
          className="w-full sm:w-auto flex items-center justify-center space-x-2 rounded-xl bg-blue-600 px-8 py-3.5 text-sm font-bold text-white shadow-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all ml-auto"
        >
          {isBusy ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>
                {isInitiatingPayment ? 'Opening Razorpay...' : 'Placing Order & Enqueueing...'}
              </span>
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

      {/* Razorpay Standard Checkout Modal */}
      <RazorpayModal
        isOpen={isRazorpayModalOpen}
        order={paymentOrder}
        customerDetails={customerDetails}
        checkoutService={apiCheckoutService}
        onSuccess={handlePaymentSuccess}
        onDismiss={handlePaymentDismiss}
        onError={handlePaymentError}
        autoOpen={true}
      />
    </form>
  );
}
