'use client';

/**
 * Accessible Page Range selection component for CAPS Print Settings (P04-M04-F01).
 * Supports "All Pages" and custom range syntax (e.g. "1-5, 8, 11-14")
 * with real-time feedback and bounds checking against total document pages.
 */

import React, { useState, useEffect } from 'react';
import { isValidPageRange, parsePageRange } from '../validation';

export interface PageRangeInputProps {
  value: string;
  onChange: (value: string) => void;
  totalDocumentPages?: number | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
}

export function PageRangeInput({
  value,
  onChange,
  totalDocumentPages,
  error,
  disabled = false
}: PageRangeInputProps) {
  const isAll = value.trim().toLowerCase() === 'all';
  const [mode, setMode] = useState<'all' | 'custom'>(isAll ? 'all' : 'custom');
  const [customValue, setCustomValue] = useState<string>(isAll ? '' : value);

  useEffect(() => {
    const isValAll = value.trim().toLowerCase() === 'all';
    if (isValAll) {
      setMode('all');
    } else {
      setMode('custom');
      setCustomValue(value);
    }
  }, [value]);

  const handleModeChange = (newMode: 'all' | 'custom') => {
    setMode(newMode);
    if (newMode === 'all') {
      onChange('all');
    } else {
      const fallback = customValue.trim() ? customValue : '1';
      onChange(fallback);
      setCustomValue(fallback);
    }
  };

  const handleCustomTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setCustomValue(newVal);
    onChange(newVal);
  };

  // Calculate preview of selected pages if valid
  let pagesPreviewText: string | null = null;
  if (mode === 'all') {
    pagesPreviewText = totalDocumentPages
      ? `All ${totalDocumentPages} pages will be printed (1 to ${totalDocumentPages})`
      : 'All pages in document will be printed';
  } else if (isValidPageRange(customValue)) {
    try {
      const parsed = parsePageRange(customValue, totalDocumentPages);
      pagesPreviewText = `${parsed.length} page${parsed.length === 1 ? '' : 's'} selected: [${parsed.join(', ')}]`;
    } catch {
      pagesPreviewText = null;
    }
  }

  return (
    <fieldset className="space-y-3">
      <div className="flex items-center justify-between">
        <legend className="text-sm font-bold text-slate-800">
          Page Range <span className="text-red-500">*</span>
        </legend>
        {totalDocumentPages !== undefined && totalDocumentPages > 0 && (
          <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
            Document: {totalDocumentPages} {totalDocumentPages === 1 ? 'Page' : 'Pages'}
          </span>
        )}
      </div>

      <div
        role="radiogroup"
        aria-label="Page range selection mode"
        className="grid grid-cols-1 sm:grid-cols-2 gap-2"
      >
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'all'}
          disabled={disabled}
          onClick={() => handleModeChange('all')}
          className={`flex items-center justify-between p-3 rounded-xl border-2 text-left transition-all ${
            mode === 'all'
              ? 'border-blue-600 bg-blue-50/50 shadow-sm'
              : 'border-slate-200 bg-white hover:border-slate-300'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <div>
            <span className="block font-bold text-sm text-slate-900">All Pages</span>
            <span className="block text-xs text-slate-500">
              {totalDocumentPages ? `Pages 1 through ${totalDocumentPages}` : 'Entire document'}
            </span>
          </div>
          <span
            className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
              mode === 'all' ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'
            }`}
            aria-hidden="true"
          >
            {mode === 'all' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
          </span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={mode === 'custom'}
          disabled={disabled}
          onClick={() => handleModeChange('custom')}
          className={`flex items-center justify-between p-3 rounded-xl border-2 text-left transition-all ${
            mode === 'custom'
              ? 'border-blue-600 bg-blue-50/50 shadow-sm'
              : 'border-slate-200 bg-white hover:border-slate-300'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <div>
            <span className="block font-bold text-sm text-slate-900">Custom Range</span>
            <span className="block text-xs text-slate-500">Select specific page numbers</span>
          </div>
          <span
            className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
              mode === 'custom' ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'
            }`}
            aria-hidden="true"
          >
            {mode === 'custom' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
          </span>
        </button>
      </div>

      {mode === 'custom' && (
        <div className="space-y-1.5 pt-1">
          <label htmlFor="custom-page-range-input" className="text-xs font-semibold text-slate-700">
            Specify pages or ranges (comma-separated):
          </label>
          <input
            id="custom-page-range-input"
            type="text"
            placeholder="e.g. 1-3, 5, 8-10"
            value={customValue}
            onChange={handleCustomTextChange}
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={error ? 'page-range-error' : 'page-range-hint'}
            className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <p id="page-range-hint" className="text-[11px] text-slate-500">
            Examples: <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">1-5</code> for pages 1 through 5, or{' '}
            <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">1, 3, 7-9</code> for mixed selection.
          </p>
        </div>
      )}

      {pagesPreviewText && !error && (
        <div className="flex items-center space-x-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200/60 rounded-lg px-3 py-2">
          <span>✓</span>
          <span>{pagesPreviewText}</span>
        </div>
      )}

      {error && (
        <p id="page-range-error" role="alert" className="text-xs text-red-600 font-medium">
          {error}
        </p>
      )}
    </fieldset>
  );
}
