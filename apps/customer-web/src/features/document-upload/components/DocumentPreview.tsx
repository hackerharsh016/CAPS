'use client';

/**
 * Accessible Document Preview and Conversion State component for CAPS Customer Web.
 * Conforms to CAPS SRS Section 4.2 & Master Plan Phase 4.
 * Displays page count, interactive page carousel, asynchronous conversion badges,
 * and security alerts for encrypted/corrupted files.
 */

import React, { useState } from 'react';
import type { DocumentPreviewData } from '../types';

export interface DocumentPreviewProps {
  preview: DocumentPreviewData;
  isLoading?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  onChangeFile?: (() => void) | undefined;
}

export function DocumentPreview({
  preview,
  isLoading,
  onRetry,
  onChangeFile
}: DocumentPreviewProps) {
  const [currentPage, setCurrentPage] = useState(1);

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full rounded-2xl border border-slate-200 bg-white p-6 space-y-4 animate-pulse"
      >
        <div className="flex items-center justify-between">
          <div className="h-6 w-48 rounded bg-slate-200" />
          <div className="h-6 w-24 rounded bg-slate-200" />
        </div>
        <div className="mx-auto h-64 max-w-sm rounded-xl bg-slate-100" />
        <span className="sr-only">Analyzing document pages and conversion state...</span>
      </div>
    );
  }

  // Error States: Password-protected, Corrupted, or Conversion Failed
  if (preview.conversionStatus === 'failed' || preview.isPasswordProtected || preview.isCorrupted) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="w-full rounded-2xl border border-red-200 bg-red-50 p-6 space-y-4 text-red-950"
      >
        <div className="flex items-start space-x-3">
          <span className="text-2xl">{preview.isPasswordProtected ? '🔐' : '⚠️'}</span>
          <div className="space-y-1">
            <h3 className="text-base font-bold">
              {preview.isPasswordProtected
                ? 'Password-Protected Document'
                : preview.isCorrupted
                  ? 'Corrupted Document File'
                  : 'Document Conversion Failed'}
            </h3>
            <p className="text-xs sm:text-sm text-red-800 leading-relaxed">
              {preview.conversionError ||
                (preview.isPasswordProtected
                  ? 'This document is encrypted with a password. CAPS automated printers cannot bypass file passwords. Please remove the password and re-upload.'
                  : 'The file could not be parsed or converted into a printable PDF.')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-red-200/60">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-red-700 transition-colors"
            >
              Retry Inspection
            </button>
          )}
          {onChangeFile && (
            <button
              type="button"
              onClick={onChangeFile}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-semibold text-red-800 shadow-sm hover:bg-red-50 transition-colors"
            >
              Upload Different Document (PDF Recommended)
            </button>
          )}
        </div>
      </div>
    );
  }

  // Asynchronous Conversion In-Progress State
  if (preview.conversionStatus === 'pending' || preview.conversionStatus === 'processing') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full rounded-2xl border border-amber-200 bg-amber-50/70 p-6 space-y-4 text-center"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 animate-spin">
          ⏳
        </div>
        <div>
          <h3 className="text-base font-bold text-amber-950">
            Converting Document to Print-Ready PDF
          </h3>
          <p className="mt-1 text-xs text-amber-800 max-w-md mx-auto">
            Your Office document ({preview.fileName}) is being converted securely by the cloud
            conversion worker. Page count and preview will appear momentarily.
          </p>
        </div>
      </div>
    );
  }

  // Active Document Preview: Success State
  const activePageObj = preview.pages.find(p => p.pageNumber === currentPage) || preview.pages[0];

  return (
    <div
      role="region"
      aria-label="Document page preview and inspection"
      className="w-full rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-5"
    >
      {/* Top Header: File info, page count pill, conversion badge */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <h3 className="text-base font-bold text-slate-900 truncate max-w-sm">
              {preview.fileName}
            </h3>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                preview.conversionStatus === 'completed'
                  ? 'bg-purple-50 text-purple-700 border border-purple-200'
                  : 'bg-blue-50 text-blue-700 border border-blue-200'
              }`}
            >
              {preview.conversionStatus === 'completed' ? 'Converted to PDF' : 'Native PDF'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Verified print-ready document structure • TLS Encrypted
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <span className="inline-flex items-center rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 border border-emerald-200">
            📄 {preview.pageCount} {preview.pageCount === 1 ? 'Page' : 'Pages'} Detected
          </span>
          {onChangeFile && (
            <button
              type="button"
              onClick={onChangeFile}
              className="text-xs font-semibold text-slate-600 hover:text-blue-600 hover:underline"
            >
              Change
            </button>
          )}
        </div>
      </div>

      {/* Main Page Viewer */}
      <div className="flex flex-col items-center justify-center rounded-xl bg-slate-50 p-4 border border-slate-100">
        {activePageObj?.thumbnailUrl && (
          <div className="relative max-h-[380px] w-full max-w-[270px] shadow-md rounded-lg overflow-hidden border border-slate-200 bg-white transition-all">
            <img
              src={activePageObj.thumbnailUrl}
              alt={`Preview of page ${currentPage} of ${preview.pageCount}`}
              className="w-full h-auto object-contain"
            />
          </div>
        )}

        {/* Carousel / Navigation Controls */}
        <div className="mt-4 flex items-center justify-center space-x-4">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            aria-label="View previous document page"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white"
          >
            ← Prev
          </button>

          <span className="text-xs font-bold text-slate-700" aria-live="polite">
            Page {currentPage} of {preview.pageCount}
          </span>

          <button
            type="button"
            disabled={currentPage >= preview.pageCount}
            onClick={() => setCurrentPage(p => Math.min(preview.pageCount, p + 1))}
            aria-label="View next document page"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white"
          >
            Next →
          </button>
        </div>
      </div>

      {/* Page Thumbnail Selector Strip */}
      {preview.pageCount > 1 && (
        <div
          role="tablist"
          aria-label="Document pages"
          className="flex items-center space-x-2 overflow-x-auto pb-2 pt-1 scrollbar-thin"
        >
          {preview.pages.map(p => (
            <button
              key={p.pageNumber}
              type="button"
              role="tab"
              aria-selected={currentPage === p.pageNumber}
              onClick={() => setCurrentPage(p.pageNumber)}
              className={`flex-shrink-0 flex flex-col items-center justify-center w-12 h-16 rounded-md border text-xs font-semibold transition-all ${
                currentPage === p.pageNumber
                  ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm scale-105'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              <span>p.{p.pageNumber}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
