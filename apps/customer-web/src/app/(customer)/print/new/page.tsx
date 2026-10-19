'use client';

/**
 * Customer New Print Order Page (P04-M03-F01).
 * Allows customers to upload documents, review target shop selection,
 * and proceed to print configuration.
 */

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { defaultShopsService } from '../../../../features/shop-discovery/shops-service';
import type { Shop } from '../../../../features/shop-discovery/types';
import { UploadDropzone } from '../../../../features/document-upload/components/UploadDropzone';
import { DocumentPreview } from '../../../../features/document-upload/components/DocumentPreview';
import { defaultConversionService } from '../../../../features/document-upload/conversion-service';
import type {
  UploadedDocumentMetadata,
  DocumentPreviewData
} from '../../../../features/document-upload/types';

function PrintOrderContent() {
  const searchParams = useSearchParams();
  const shopId = searchParams.get('shopId');

  const [shop, setShop] = useState<Shop | null>(null);
  const [uploadedDoc, setUploadedDoc] = useState<UploadedDocumentMetadata | null>(null);
  const [preview, setPreview] = useState<DocumentPreviewData | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  useEffect(() => {
    if (shopId) {
      defaultShopsService.getShopById(shopId).then((found) => {
        setShop(found);
      });
    }
  }, [shopId]);

  const handleUploadSuccess = async (doc: UploadedDocumentMetadata) => {
    setUploadedDoc(doc);
    setIsLoadingPreview(true);
    try {
      const previewData = await defaultConversionService.getOrStartDocumentPreview(doc);
      setPreview(previewData);
    } catch (err) {
      console.error('Failed to generate preview:', err);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleUploadReset = () => {
    setUploadedDoc(null);
    setPreview(null);
  };


  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Page Title & Breadcrumb */}
      <div>
        <nav aria-label="Breadcrumb" className="flex items-center text-xs text-slate-500 mb-2">
          <a href="/shops" className="hover:text-blue-600 hover:underline">
            Shops
          </a>
          <span className="mx-2 text-slate-400">/</span>
          <span className="font-semibold text-slate-800" aria-current="page">
            Upload Document
          </span>
        </nav>
        <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">
          Upload Document for Printing
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Upload your PDF, DOCX, presentation, or image file. You can configure page ranges, color,
          and binding in the next step.
        </p>
      </div>

      {/* Target Shop Context Card */}
      {shop ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center space-x-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-xl text-blue-600">
              🏪
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Target Xerox Shop
              </p>
              <h2 className="text-base font-bold text-slate-900">{shop.name}</h2>
              <p className="text-xs text-slate-500">{shop.address}</p>
            </div>
          </div>

          <a
            href="/shops"
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
          >
            Change Shop
          </a>
        </div>
      ) : (
        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-xs text-blue-800 flex items-center justify-between">
          <span>
            💡 <strong>Tip:</strong> You haven&apos;t selected a specific shop yet. You can upload now and pick a shop during checkout.
          </span>
          <a
            href="/shops"
            className="font-bold underline hover:no-underline ml-4 shrink-0"
          >
            Browse Shops
          </a>
        </div>
      )}

      {/* Upload Dropzone Section */}
      <section aria-labelledby="upload-section-heading" className="space-y-4">
        <h2 id="upload-section-heading" className="sr-only">
          Document File Upload
        </h2>
        <UploadDropzone
          targetShopId={shop?.id}
          onUploadSuccess={handleUploadSuccess}
          onUploadReset={handleUploadReset}
        />
      </section>

      {/* Document Page Preview & Conversion State */}
      {preview && (
        <section aria-labelledby="preview-section-heading">
          <h2 id="preview-section-heading" className="sr-only">
            Document Inspection and Page Preview
          </h2>
          <DocumentPreview
            preview={preview}
            isLoading={isLoadingPreview}
            onChangeFile={handleUploadReset}
          />
        </section>
      )}

      {/* Proceed Action Bar (Only active when document is validated and has pages) */}
      {uploadedDoc && preview && preview.pageCount > 0 && preview.conversionStatus !== 'failed' && (
        <div
          role="region"
          aria-label="Print order next steps"
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4"
        >
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Ready to Print ({preview.pageCount} {preview.pageCount === 1 ? 'Page' : 'Pages'})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Proceed to select paper size, color options, duplex mode, and binding.
            </p>
          </div>

          <a
            href={`/print/settings?docId=${uploadedDoc.id}${shop ? `&shopId=${shop.id}` : ''}`}
            className="w-full sm:w-auto text-center rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-md hover:bg-blue-700 transition-colors"
          >
            Configure Print Settings →
          </a>
        </div>
      )}
    </div>
  );
}

export default function NewPrintOrderPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl space-y-6 animate-pulse p-6">
          <div className="h-8 w-48 rounded bg-slate-200" />
          <div className="h-20 w-full rounded-2xl bg-slate-200" />
          <div className="h-64 w-full rounded-2xl bg-slate-200" />
        </div>
      }
    >
      <PrintOrderContent />
    </Suspense>
  );
}
