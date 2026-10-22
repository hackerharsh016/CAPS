'use client';

/**
 * Razorpay Standard Checkout Modal Component for CAPS Customer Web (INT-D1-03).
 *
 * Implements:
 * - Dynamic script injection of `https://checkout.razorpay.com/v1/checkout.js`.
 * - Test mode indicator and transparent payment breakdown.
 * - Seamless launch of `window.Razorpay` with customized brand styling.
 * - Callbacks for payment completion (`razorpay_payment_id`, `razorpay_signature`),
 *   dismissal, and error recovery.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  PaymentOrderData,
  RazorpayPaymentSuccess
} from '../../services/api/checkout.service';
import { CheckoutService } from '../../services/api/checkout.service';

export interface CustomerDetails {
  name?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
}

export interface RazorpayModalProps {
  isOpen: boolean;
  order: PaymentOrderData | null;
  customerDetails?: CustomerDetails | undefined;
  checkoutService?: CheckoutService | undefined;
  onSuccess: (payment: RazorpayPaymentSuccess) => void;
  onDismiss?: () => void;
  onError?: (error: Error) => void;
  autoOpen?: boolean;
}

export function RazorpayModal({
  isOpen,
  order,
  customerDetails,
  checkoutService,
  onSuccess,
  onDismiss,
  onError,
  autoOpen = true
}: RazorpayModalProps) {
  const [service] = useState(() => checkoutService || new CheckoutService());
  const [isScriptLoading, setIsScriptLoading] = useState(false);
  const [isModalActive, setIsModalActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Preload Razorpay checkout script on mount
  useEffect(() => {
    service.loadRazorpayScript().catch((err) => {
      console.warn('Failed to pre-load Razorpay script:', err);
    });
  }, [service]);

  const handleLaunchPayment = useCallback(async () => {
    if (!order) return;

    setErrorMessage(null);
    setIsScriptLoading(true);
    setIsModalActive(true);

    try {
      const paymentResult = await service.launchRazorpayModal({
        order,
        customerDetails,
        onDismiss: () => {
          setIsModalActive(false);
          setIsScriptLoading(false);
          onDismiss?.();
        }
      });

      setIsModalActive(false);
      setIsScriptLoading(false);
      onSuccess(paymentResult);
    } catch (err: unknown) {
      setIsModalActive(false);
      setIsScriptLoading(false);
      const errorObj = err instanceof Error ? err : new Error('Payment processing failed.');
      if (errorObj.message.includes('PAYMENT_DISMISSED')) {
        // Handled via onDismiss callback
        return;
      }
      setErrorMessage(errorObj.message);
      onError?.(errorObj);
    }
  }, [order, customerDetails, service, onSuccess, onDismiss, onError]);

  // Auto-launch modal when order is ready and isOpen is true
  useEffect(() => {
    if (isOpen && order && autoOpen && !isModalActive && !errorMessage) {
      handleLaunchPayment();
    }
  }, [isOpen, order, autoOpen, handleLaunchPayment, isModalActive, errorMessage]);

  if (!isOpen || !order) {
    return null;
  }

  const amountRupees = (order.amount_paise / 100).toFixed(2);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-modal-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-100 transition-all transform scale-100 animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-5 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-2 bg-white/10 rounded-lg">
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </span>
              <h2 id="payment-modal-title" className="text-lg font-bold">
                Secure Checkout
              </h2>
            </div>
            <span
              data-testid="test-mode-badge"
              className="text-xs font-semibold uppercase tracking-wider bg-amber-400 text-slate-900 px-2 py-0.5 rounded-full"
            >
              Test Mode
            </span>
          </div>
          <p className="text-xs text-blue-100 mt-1">
            Complete payment for Print Job #{order.print_job_id.slice(0, 8)}
          </p>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5">
          {/* Amount Display */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase">Total Amount</p>
              <p className="text-2xl font-black text-slate-900">
                ₹{amountRupees}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Currency: {order.currency}</p>
              <p className="text-xs font-mono text-slate-500">
                Order: {order.order_id.slice(0, 14)}...
              </p>
            </div>
          </div>

          {/* Customer prefill summary */}
          {customerDetails && (customerDetails.email || customerDetails.phone) && (
            <div className="text-xs text-slate-600 bg-blue-50/60 p-3 rounded-lg border border-blue-100">
              <span className="font-semibold text-blue-900">Billing details: </span>
              {customerDetails.email && <span>{customerDetails.email} </span>}
              {customerDetails.phone && <span>({customerDetails.phone})</span>}
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div
              role="alert"
              className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2"
            >
              <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="font-semibold">Payment failed or cancelled</p>
                <p>{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Razorpay Launch Button / Loading Indicator */}
          <div className="space-y-3 pt-2">
            <button
              type="button"
              onClick={handleLaunchPayment}
              disabled={isScriptLoading || isModalActive}
              data-testid="pay-now-button"
              className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-blue-300 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              {isScriptLoading || isModalActive ? (
                <>
                  <svg
                    className="animate-spin h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span>Connecting to Razorpay...</span>
                </>
              ) : (
                <>
                  <span>Pay ₹{amountRupees} with Razorpay</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onDismiss}
              data-testid="cancel-checkout-button"
              className="w-full py-2.5 px-4 bg-transparent hover:bg-slate-100 text-slate-600 font-medium rounded-xl text-sm transition-colors text-center cursor-pointer"
            >
              Cancel and Return
            </button>
          </div>

          {/* Trust & Security Footer */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              256-bit SSL Secured
            </span>
            <span>&bull;</span>
            <span>PCI-DSS Compliant</span>
          </div>
        </div>
      </div>
    </div>
  );
}
