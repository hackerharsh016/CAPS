'use client';

/**
 * Customer Order Review and Checkout Page (P04-M05-F02).
 * Verifies final order specifications, quote validity, payment method,
 * and double-click idempotency defense before placing order.
 */

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { defaultShopsService } from '../../../../features/shop-discovery/shops-service';
import type { Shop } from '../../../../features/shop-discovery/types';
import type { PrintSettings } from '../../../../features/print-settings/types';
import { DEFAULT_PRINT_SETTINGS } from '../../../../features/print-settings/validation';
import type { QuoteResponse } from '../../../../features/pricing/types';
import {
  generateAuthoritativeQuote,
  type ShopPricingRates
} from '../../../../features/pricing/pricing-calculator';
import { CheckoutShell } from '../../../../features/checkout/components/CheckoutShell';
import type { CheckoutResult } from '../../../../features/checkout/types';
import { useAuth } from '../../../../features/auth/auth-context';
import type { CustomerDetails } from '../../../../components/checkout/razorpay-modal';

interface StoredQuoteData {
  quote: QuoteResponse;
  savedAt: string;
}

interface StoredSettingsData {
  docId: string;
  settings: PrintSettings;
}

interface StoredDocumentData {
  id: string;
  name: string;
  pageCount: number;
  sizeBytes?: number | undefined;
}

function CheckoutPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const docId = searchParams.get('docId');
  const shopId = searchParams.get('shopId');

  const [shop, setShop] = useState<Shop | null>(null);
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS);
  const [docData, setDocData] = useState<StoredDocumentData | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [confirmedResult, setConfirmedResult] = useState<CheckoutResult | null>(null);

  // Authenticated customer context with fallback
  const { user, profile } = useAuth();
  const customerId = user?.id || '088c87a0-42e3-4f84-b4cf-ccf1e2732c6f';
  const customerDetails: CustomerDetails = {
    name: profile?.name || (user?.user_metadata?.name as string) || 'Customer Demo',
    email: user?.email || 'customer@caps.local',
    phone: profile?.phone || (user?.user_metadata?.phone as string) || '9876543210'
  };

  const targetShopId = shopId || shop?.id || '';

  // 1. Load shop details
  useEffect(() => {
    if (!shopId) return;
    defaultShopsService.getShopById(shopId).then(found => {
      setShop(found);
    });
  }, [shopId]);

  // 2. Load stored session state
  useEffect(() => {
    if (!docId) return;

    let loadedDoc: StoredDocumentData | null = null;
    let loadedSettings: PrintSettings = DEFAULT_PRINT_SETTINGS;

    if (typeof window !== 'undefined') {
      try {
        const storedDoc = sessionStorage.getItem(`caps_doc_${docId}`);
        if (storedDoc) {
          loadedDoc = JSON.parse(storedDoc);
          setDocData(loadedDoc);
        }

        const storedSettings = sessionStorage.getItem(`caps_print_settings_${docId}`);
        if (storedSettings) {
          const parsed: StoredSettingsData = JSON.parse(storedSettings);
          if (parsed.settings) {
            loadedSettings = parsed.settings;
            setSettings(loadedSettings);
          }
        }

        const storedQuote = sessionStorage.getItem(`caps_active_quote_${docId}`);
        if (storedQuote) {
          const parsedQuote: StoredQuoteData = JSON.parse(storedQuote);
          if (parsedQuote.quote) {
            setQuote(parsedQuote.quote);
            return;
          }
        }
      } catch {
        // Fall through
      }
    }

    if (!loadedDoc) {
      loadedDoc = {
        id: docId,
        name: `Document_${docId.slice(0, 8)}.pdf`,
        pageCount: 1,
        sizeBytes: 1024 * 1024
      };
      setDocData(loadedDoc);
    }

    if (targetShopId) {
      const customRates: Partial<ShopPricingRates> | undefined = shop?.pricing
        ? {
            bw_per_page_paise: shop.pricing.bw_per_page_paise,
            color_per_page_paise: shop.pricing.color_per_page_paise,
            duplex_discount_paise: shop.pricing.duplex_discount_paise ?? 25,
            spiral_binding_paise: shop.pricing.spiral_binding_paise,
            urgent_surcharge_paise: shop.pricing.urgent_surcharge_paise
          }
        : undefined;

      const generated = generateAuthoritativeQuote(
        {
          shop_id: targetShopId,
          settings: loadedSettings,
          priority_tier: 'flexible',
          document_page_count: loadedDoc.pageCount || 1
        },
        customRates
      );
      setQuote(generated);
    }
  }, [docId, targetShopId, shop?.pricing]);

  const handleOrderConfirmed = (result: CheckoutResult) => {
    setConfirmedResult(result);

    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('caps_latest_order', JSON.stringify(result));
      } catch {
        // Ignore
      }
    }

    // Proceed to live token & job queue tracking screen
    setTimeout(() => {
      router.push(`/jobs/${encodeURIComponent(result.order_id)}`);
    }, 1200);
  };

  const handleBackToQuote = () => {
    router.push(
      `/print/quote?docId=${encodeURIComponent(docId || '')}${shopId ? `&shopId=${encodeURIComponent(shopId)}` : ''}`
    );
  };

  if (!docId) {
    return (
      <div className="mx-auto max-w-xl text-center py-16 space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-3xl">
          📑
        </div>
        <h1 className="text-xl font-bold text-slate-900">No Document Specified</h1>
        <p className="text-sm text-slate-600">
          Please select and upload a document to proceed with print checkout.
        </p>
        <div className="pt-2">
          <a
            href="/shops"
            className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 transition-colors"
          >
            Browse Shops →
          </a>
        </div>
      </div>
    );
  }

  if (!targetShopId) {
    return (
      <div className="mx-auto max-w-xl text-center py-16 space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-3xl">
          🏪
        </div>
        <h1 className="text-xl font-bold text-slate-900">No Shop Selected</h1>
        <p className="text-sm text-slate-600">
          Please select a photocopy shop before completing your print order checkout.
        </p>
        <div className="pt-2">
          <a
            href="/shops"
            className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 transition-colors"
          >
            Browse Shops →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Breadcrumb Navigation */}
      <nav aria-label="Breadcrumb" className="flex items-center text-xs text-slate-500">
        <a href="/shops" className="hover:text-blue-600 hover:underline">
          Shops
        </a>
        <span className="mx-2 text-slate-400">/</span>
        <a
          href={`/print/new${shopId ? `?shopId=${encodeURIComponent(shopId)}` : ''}`}
          className="hover:text-blue-600 hover:underline"
        >
          Upload
        </a>
        <span className="mx-2 text-slate-400">/</span>
        <a
          href={`/print/quote?docId=${encodeURIComponent(docId)}${shopId ? `&shopId=${encodeURIComponent(shopId)}` : ''}`}
          className="hover:text-blue-600 hover:underline"
        >
          Quote
        </a>
        <span className="mx-2 text-slate-400">/</span>
        <span className="font-semibold text-slate-800" aria-current="page">
          Review & Checkout
        </span>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">
          Order Review & Payment
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Review your final print order specifications and select your preferred payment method.
        </p>
      </div>

      {/* Order Confirmed Banner */}
      {confirmedResult && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-5 text-emerald-950 shadow-sm space-y-2"
        >
          <div className="flex items-center space-x-2 font-extrabold text-base">
            <span>🎉</span>
            <span>Order Placed Successfully! (Token: {confirmedResult.token_number})</span>
          </div>
          <p className="text-xs text-emerald-800">
            {confirmedResult.payment_method === 'pay_at_counter'
              ? 'Your job has been submitted to the shop for counter payment confirmation.'
              : 'Your payment was successfully verified and your order is in the print queue.'}{' '}
            Redirecting to order tracking...
          </p>
        </div>
      )}

      {/* Checkout Shell */}
      {shop && quote && (
        <CheckoutShell
          shop={shop}
          documentName={docData?.name || 'Document.pdf'}
          documentStorageKey={`docs/${customerId}/${docId}.pdf`}
          fileSizeBytes={docData?.sizeBytes || 1024 * 1024}
          customerId={customerId}
          customerDetails={customerDetails}
          settings={settings}
          quote={quote}
          onOrderConfirmed={handleOrderConfirmed}
          onBackToQuote={handleBackToQuote}
        />
      )}
    </div>
  );
}

export default function CustomerCheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl space-y-6 animate-pulse p-6">
          <div className="h-8 w-48 rounded bg-slate-200" />
          <div className="h-20 w-full rounded-2xl bg-slate-200" />
          <div className="h-96 w-full rounded-2xl bg-slate-200" />
        </div>
      }
    >
      <CheckoutPageContent />
    </Suspense>
  );
}
