'use client';

/**
 * Customer Live Quote & Pricing Page (P04-M05-F01).
 * Displays real-time itemized price breakdown, GST, priority tier (Flexible vs Urgent),
 * queue wait time estimates, and quote expiration timer.
 */

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { defaultShopsService } from '../../../../features/shop-discovery/shops-service';
import type { Shop } from '../../../../features/shop-discovery/types';
import type { PrintSettings } from '../../../../features/print-settings/types';
import { DEFAULT_PRINT_SETTINGS } from '../../../../features/print-settings/validation';
import { LiveQuoteSummary } from '../../../../features/pricing/components/LiveQuoteSummary';
import type { QuoteResponse } from '../../../../features/pricing/types';

interface StoredSettingsData {
  docId: string;
  shopId?: string | null | undefined;
  settings: PrintSettings;
  configuredAt: string;
}

interface StoredDocumentData {
  id: string;
  name: string;
  pageCount: number;
}

function QuotePageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const docId = searchParams.get('docId');
  const shopId = searchParams.get('shopId');

  const [shop, setShop] = useState<Shop | null>(null);
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS);
  const [docData, setDocData] = useState<StoredDocumentData | null>(null);

  // 1. Load shop details
  useEffect(() => {
    if (shopId) {
      defaultShopsService.getShopById(shopId).then(found => {
        setShop(found);
      });
    }
  }, [shopId]);

  // 2. Load configured settings and document info from sessionStorage or fallbacks
  useEffect(() => {
    if (!docId) return;

    if (typeof window !== 'undefined') {
      try {
        const storedSettings = sessionStorage.getItem(`caps_print_settings_${docId}`);
        if (storedSettings) {
          const parsed: StoredSettingsData = JSON.parse(storedSettings);
          if (parsed.settings) {
            setSettings(parsed.settings);
          }
        }

        const storedDoc = sessionStorage.getItem(`caps_doc_${docId}`);
        if (storedDoc) {
          const parsedDoc: StoredDocumentData = JSON.parse(storedDoc);
          setDocData(parsedDoc);
          return;
        }
      } catch {
        // Fall through to defaults
      }
    }

    // Default mock document info if accessed directly
    setDocData({
      id: docId,
      name: `Document_${docId.slice(0, 8)}.pdf`,
      pageCount: 12
    });
  }, [docId]);

  const handleProceedToCheckout = (quote: QuoteResponse) => {
    if (!docId) return;

    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(
          `caps_active_quote_${docId}`,
          JSON.stringify({
            quote,
            savedAt: new Date().toISOString()
          })
        );
      } catch {
        // Ignore storage errors
      }
    }

    const nextUrl = `/print/checkout?docId=${encodeURIComponent(docId)}${shopId ? `&shopId=${encodeURIComponent(shopId)}` : ''}`;
    router.push(nextUrl);
  };

  const handleBackToSettings = () => {
    const prevUrl = `/print/settings?docId=${encodeURIComponent(docId || '')}${shopId ? `&shopId=${encodeURIComponent(shopId)}` : ''}`;
    router.push(prevUrl);
  };

  if (!docId) {
    return (
      <div className="mx-auto max-w-xl text-center py-16 space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-3xl">
          📄
        </div>
        <h1 className="text-xl font-bold text-slate-900">No Document Selected</h1>
        <p className="text-sm text-slate-600">
          Please upload and configure a document first to preview pricing.
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

  const effectiveShopId = shopId || shop?.id || 'shop-8888-campus-xerox';

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
          href={`/print/settings?docId=${encodeURIComponent(docId)}${shopId ? `&shopId=${encodeURIComponent(shopId)}` : ''}`}
          className="hover:text-blue-600 hover:underline"
        >
          Settings
        </a>
        <span className="mx-2 text-slate-400">/</span>
        <span className="font-semibold text-slate-800" aria-current="page">
          Quote & Pricing
        </span>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">
          Live Pricing & Quote Preview
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Review your itemized print quotation, estimated completion time, and queue priority.
        </p>
      </div>

      {/* Order Context Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center space-x-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-2xl text-blue-600">
            📑
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Document & Settings
            </p>
            <h2 className="text-sm font-bold text-slate-900 truncate max-w-xs sm:max-w-md">
              {docData?.name || 'Document'}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 mt-0.5">
              <span>{settings.paper_size}</span>
              <span>•</span>
              <span>{settings.color_mode === 'color' ? 'Color' : 'B&W'}</span>
              <span>•</span>
              <span>{settings.sides === 'double' ? 'Duplex' : 'Simplex'}</span>
              <span>•</span>
              <span>
                {settings.copies} {settings.copies === 1 ? 'copy' : 'copies'}
              </span>
              {shop && (
                <>
                  <span>•</span>
                  <span>
                    Shop: <strong>{shop.name}</strong>
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleBackToSettings}
          className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline shrink-0 text-left"
        >
          Edit Settings
        </button>
      </div>

      {/* Main Live Quote Engine */}
      <LiveQuoteSummary
        shopId={effectiveShopId}
        settings={settings}
        documentPageCount={docData?.pageCount || 1}
        shopName={shop?.name || 'Selected Xerox Shop'}
        onProceedToCheckout={handleProceedToCheckout}
        onBackToSettings={handleBackToSettings}
      />
    </div>
  );
}

export default function CustomerPrintQuotePage() {
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
      <QuotePageContent />
    </Suspense>
  );
}
