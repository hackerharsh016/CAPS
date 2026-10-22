'use client';

/**
 * Customer Web Checkout & Order Review Screen (INT-D1-03).
 *
 * Implements:
 * - Order summary and price breakdown review.
 * - Customer prefill inputs (Name, Email, Mobile).
 * - Standard Razorpay modal integration in test/live mode.
 * - On successful payment callback: forwards customer to live order tracking:
 *   `/orders/:orderId/track`
 */

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { RazorpayModal } from '../../../components/checkout/razorpay-modal';
import type {
  PaymentOrderData,
  RazorpayPaymentSuccess
} from '../../../services/api/checkout.service';
import { CheckoutService } from '../../../services/api/checkout.service';

export default function CheckoutPage() {
  const params = useParams<{ quoteId: string }>();
  const router = useRouter();
  const quoteOrJobId = params?.quoteId || '';

  const [checkoutService] = useState(() => new CheckoutService());
  const [customerDetails, setCustomerDetails] = useState({
    name: 'Customer Demo',
    email: 'customer@caps.local',
    phone: '9876543210'
  });

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [paymentOrder, setPaymentOrder] = useState<PaymentOrderData | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Default sample pricing for order review (Paise)
  const [orderSummary] = useState({
    documentName: 'Document_Print_Package.pdf',
    pages: 12,
    copies: 1,
    colorMode: 'Black & White',
    paperSize: 'A4',
    duplex: 'Double-sided (Duplex Long Edge)',
    subtotalPaise: 2160,
    bindingPaise: 500,
    gstPaise: 290,
    totalPaise: 2950
  });

  const handleStartPayment = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const order = await checkoutService.createPaymentOrder({
        print_job_id: quoteOrJobId,
        amount_paise: orderSummary.totalPaise,
        notes: {
          customer_email: customerDetails.email,
          customer_phone: customerDetails.phone
        }
      });

      setPaymentOrder(order);
      setIsModalOpen(true);
      setIsLoading(false);
    } catch (err: unknown) {
      setIsLoading(false);
      const message = err instanceof Error ? err.message : 'Unable to initiate payment order.';
      setErrorMessage(message);
    }
  };

  const handlePaymentSuccess = (_payment: RazorpayPaymentSuccess) => {
    setIsModalOpen(false);
    setIsRedirecting(true);

    const targetOrderId = paymentOrder?.print_job_id || quoteOrJobId;
    const trackingUrl = `/orders/${encodeURIComponent(targetOrderId)}/track`;

    // Forward to live order tracking page
    router.push(trackingUrl);
  };

  const handleModalDismiss = () => {
    setIsModalOpen(false);
  };

  const totalRupees = (orderSummary.totalPaise / 100).toFixed(2);
  const subtotalRupees = (orderSummary.subtotalPaise / 100).toFixed(2);
  const bindingRupees = (orderSummary.bindingPaise / 100).toFixed(2);
  const gstRupees = (orderSummary.gstPaise / 100).toFixed(2);

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <div>
            <Link
              href="/orders"
              className="text-sm font-medium text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 mb-1"
            >
              &larr; Back to Order Selection
            </Link>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              Order Review & Payment
            </h1>
            <p className="text-sm text-slate-500">
              Review print job details and proceed to secure Razorpay checkout
            </p>
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider bg-amber-400 text-slate-900 px-2.5 py-1 rounded-full shadow-sm">
            Sandbox Test Mode
          </span>
        </div>

        {/* Redirecting Banner */}
        {isRedirecting && (
          <div
            role="status"
            className="p-5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-4 text-emerald-800 animate-pulse"
          >
            <svg
              className="w-6 h-6 text-emerald-600 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <p className="font-bold">Payment Verified!</p>
              <p className="text-sm text-emerald-700">
                Forwarding you to live print progress tracking...
              </p>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div
            role="alert"
            className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-start gap-3"
          >
            <svg
              className="w-5 h-5 text-red-500 mt-0.5 shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="font-bold">Payment Initialization Error</p>
              <p>{errorMessage}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Order Details & Print Settings (2 cols) */}
          <div className="md:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
              <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-3 flex items-center justify-between">
                <span>Print Configuration</span>
                <span className="text-xs font-mono text-slate-400">
                  ID: #{quoteOrJobId.slice(0, 8)}
                </span>
              </h2>

              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-slate-500">Document</dt>
                  <dd className="font-semibold text-slate-800 truncate">
                    {orderSummary.documentName}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Total Pages</dt>
                  <dd className="font-semibold text-slate-800">
                    {orderSummary.pages} pages ({orderSummary.copies} copy)
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Color Mode</dt>
                  <dd className="font-semibold text-slate-800">{orderSummary.colorMode}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Paper & Sides</dt>
                  <dd className="font-semibold text-slate-800">
                    {orderSummary.paperSize} &bull; {orderSummary.duplex}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Customer Prefill Form */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
              <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-3">
                Customer Information
              </h2>
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="customer-name"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    Full Name
                  </label>
                  <input
                    id="customer-name"
                    type="text"
                    value={customerDetails.name}
                    onChange={e => setCustomerDetails({ ...customerDetails, name: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter your name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="customer-email"
                      className="block text-xs font-medium text-slate-600 mb-1"
                    >
                      Email Address
                    </label>
                    <input
                      id="customer-email"
                      type="email"
                      value={customerDetails.email}
                      onChange={e =>
                        setCustomerDetails({ ...customerDetails, email: e.target.value })
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="name@domain.com"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="customer-phone"
                      className="block text-xs font-medium text-slate-600 mb-1"
                    >
                      Mobile Number
                    </label>
                    <input
                      id="customer-phone"
                      type="tel"
                      value={customerDetails.phone}
                      onChange={e =>
                        setCustomerDetails({ ...customerDetails, phone: e.target.value })
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="9876543210"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Pricing & Checkout Summary (1 col) */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
              <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-3">
                Price Breakdown
              </h2>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>Printing ({orderSummary.pages} pages)</span>
                  <span>₹{subtotalRupees}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Staple Binding</span>
                  <span>₹{bindingRupees}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Estimated Taxes (GST)</span>
                  <span>₹{gstRupees}</span>
                </div>
                <div className="border-t border-slate-200 pt-3 flex justify-between font-bold text-slate-900 text-lg">
                  <span>Total Payable</span>
                  <span className="text-blue-600">₹{totalRupees}</span>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleStartPayment}
                  disabled={isLoading || isRedirecting}
                  data-testid="proceed-payment-button"
                  className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-blue-300 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 cursor-pointer transition-all disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <span>Preparing Razorpay...</span>
                  ) : (
                    <>
                      <span>Pay ₹{totalRupees}</span>
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M13 7l5 5m0 0l-5 5m5-5H6"
                        />
                      </svg>
                    </>
                  )}
                </button>
              </div>

              <p className="text-center text-xs text-slate-400">
                Supports UPI, Cards, NetBanking via Razorpay Standard Checkout
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Razorpay Checkout Modal */}
      <RazorpayModal
        isOpen={isModalOpen}
        order={paymentOrder}
        customerDetails={customerDetails}
        checkoutService={checkoutService}
        onSuccess={handlePaymentSuccess}
        onDismiss={handleModalDismiss}
        onError={err => setErrorMessage(err.message)}
      />
    </div>
  );
}
