'use client';

/**
 * Customer Print Settings Configuration Page (P04-M04-F01).
 * Allows customers to configure paper size, color mode, sides, orientation,
 * copies, page ranges, and finishing services for an uploaded document.
 */

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { defaultShopsService } from '../../../../features/shop-discovery/shops-service';
import type { Shop } from '../../../../features/shop-discovery/types';
import { PrintSettingsForm } from '../../../../features/print-settings/components/PrintSettingsForm';
import type { PrintSettings, PrintSettingsCalculation } from '../../../../features/print-settings/types';

interface DocumentInfo {
  id: string;
  name: string;
  pageCount: number;
  mimeType?: string;
  sizeBytes?: number;
}

function PrintSettingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const docId = searchParams.get('docId');
  const shopId = searchParams.get('shopId');

  const [shop, setShop] = useState<Shop | null>(null);
  const [docInfo, setDocInfo] = useState<DocumentInfo | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState<boolean>(false);

  // 1. Fetch Shop details if shopId provided
  useEffect(() => {
    if (shopId) {
      defaultShopsService.getShopById(shopId).then((found) => {
        setShop(found);
      });
    }
  }, [shopId]);

  // 2. Resolve document info from sessionStorage or default mock
  useEffect(() => {
    if (!docId) return;

    if (typeof window !== 'undefined') {
      try {
        const stored = sessionStorage.getItem(`caps_doc_${docId}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          setDocInfo(parsed);
          return;
        }
      } catch {
        // Fall through to default
      }
    }

    // Default mock document info when navigating directly or during testing
    setDocInfo({
      id: docId,
      name: `Document_${docId.slice(0, 8)}.pdf`,
      pageCount: 12,
      mimeType: 'application/pdf',
      sizeBytes: 1024 * 1024 * 2.4
    });
  }, [docId]);

  const handleSubmitSettings = (
    settings: PrintSettings,
    calculation?: PrintSettingsCalculation
  ) => {
    if (!docId) return;

    setIsSubmitting(true);

    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(
          `caps_print_settings_${docId}`,
          JSON.stringify({
            docId,
            shopId: shopId || null,
            settings,
            calculation,
            configuredAt: new Date().toISOString()
          })
        );
      }

      setSubmissionSuccess(true);

      // In production / subsequent tasks, route to capability check / price quote preview (P04-M04-F02 / P04-M05-F01)
      setTimeout(() => {
        const nextUrl = `/print/quote?docId=${encodeURIComponent(docId)}${shopId ? `&shopId=${encodeURIComponent(shopId)}` : ''}`;
        router.push(nextUrl);
      }, 600);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (docId) {
      router.push(`/print/new${shopId ? `?shopId=${encodeURIComponent(shopId)}` : ''}`);
    } else {
      router.push('/shops');
    }
  };

  // If no document selected, guide user to upload screen
  if (!docId) {
    return (
      <div className="mx-auto max-w-xl text-center py-16 space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-3xl">
          📄
        </div>
        <h1 className="text-xl font-bold text-slate-900">No Document Selected</h1>
        <p className="text-sm text-slate-600">
          Please upload a document first before configuring print options.
        </p>
        <div className="pt-2">
          <a
            href={shopId ? `/print/new?shopId=${encodeURIComponent(shopId)}` : '/print/new'}
            className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 transition-colors"
          >
            Upload Document →
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
          href={shopId ? `/print/new?shopId=${encodeURIComponent(shopId)}` : '/print/new'}
          className="hover:text-blue-600 hover:underline"
        >
          Upload
        </a>
        <span className="mx-2 text-slate-400">/</span>
        <span className="font-semibold text-slate-800" aria-current="page">
          Print Settings
        </span>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">
          Configure Print Settings
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Choose paper dimensions, black & white or color mode, duplex sides, and finishing options.
        </p>
      </div>

      {/* Target Document & Shop Info Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center space-x-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-2xl text-blue-600">
            📑
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Document Selected
            </p>
            <h2 className="text-sm font-bold text-slate-900 truncate max-w-xs sm:max-w-md">
              {docInfo?.name || 'Document'}
            </h2>
            <div className="flex items-center space-x-2 text-xs text-slate-500 mt-0.5">
              <span>{docInfo?.pageCount} total pages</span>
              {shop && (
                <>
                  <span>•</span>
                  <span>Target: <strong>{shop.name}</strong></span>
                </>
              )}
            </div>
          </div>
        </div>

        <a
          href={shopId ? `/print/new?shopId=${encodeURIComponent(shopId)}` : '/print/new'}
          className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline shrink-0"
        >
          Change File
        </a>
      </div>

      {/* Success Notification Banner */}
      {submissionSuccess && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 flex items-center space-x-2"
        >
          <span>✓</span>
          <span className="font-semibold">
            Print settings validated successfully! Proceeding to pricing quote...
          </span>
        </div>
      )}

      {/* Main Settings Form */}
      <PrintSettingsForm
        totalDocumentPages={docInfo?.pageCount}
        storageKey={`caps_draft_settings_${docId}`}
        isSubmitting={isSubmitting}
        onSubmit={handleSubmitSettings}
        onCancel={handleCancel}
      />
    </div>
  );
}

export default function CustomerPrintSettingsPage() {
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
      <PrintSettingsContent />
    </Suspense>
  );
}
