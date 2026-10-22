'use client';

/**
 * Print Configuration Form Component for CAPS Customer Web (INT-D1-01).
 * Harmonizes customer print settings so that duplex ('simplex' | 'duplex_long' | 'duplex_short')
 * and legacy sides ('single' | 'double') map cleanly between frontend inputs,
 * backend OpenAPI contracts, and strict Zod validation schemas (@caps/validation).
 */

import React, { useState, useCallback, useId } from 'react';
import type {
  PaperSize,
  ColorMode,
  SideMode,
  DuplexMode,
  Orientation,
  BindingType,
  PrintSettings,
  HarmonizedPrintSettings
} from '@caps/types';
import { sidesToDuplex, duplexToSides, createHarmonizedPrintSettings } from '@caps/types';
import { QuoteService, PrintJobService } from '../../services/api/quote.service';

export interface PrintConfigurationFormProps {
  /** Initial configuration overrides */
  initialSettings?: Partial<PrintSettings> | undefined;
  /** Document page count for estimation */
  totalDocumentPages?: number | undefined;
  /** Active shop identifier */
  shopId?: string | undefined;
  /** Disable entire form during loading */
  disabled?: boolean | undefined;
  /** Submission in progress */
  isSubmitting?: boolean | undefined;
  /** Optional custom QuoteService instance */
  quoteService?: QuoteService | undefined;
  /** Optional custom PrintJobService instance */
  printJobService?: PrintJobService | undefined;
  /** Callback fired upon valid form submission */
  onSubmit?: ((settings: HarmonizedPrintSettings) => void | Promise<void>) | undefined;
  /** Callback fired on any setting adjustment */
  onChange?: ((settings: HarmonizedPrintSettings) => void) | undefined;
  /** Optional cancellation handler */
  onCancel?: (() => void) | undefined;
  /** CSS class names */
  className?: string | undefined;
}

export const PAPER_SIZE_OPTIONS: { id: PaperSize; label: string; dimensions: string }[] = [
  { id: 'A4', label: 'A4 Standard', dimensions: '210 × 297 mm' },
  { id: 'A3', label: 'A3 Poster', dimensions: '297 × 420 mm' },
  { id: 'Legal', label: 'Legal Document', dimensions: '216 × 356 mm' }
];

export const COLOR_MODE_OPTIONS: { id: ColorMode; label: string; description: string }[] = [
  { id: 'bw', label: 'Black & White', description: 'Standard monochrome print' },
  { id: 'color', label: 'Full Color', description: 'Vibrant CMYK reproduction' }
];

export const DUPLEX_OPTIONS: {
  id: DuplexMode;
  sideMode: SideMode;
  label: string;
  description: string;
}[] = [
  {
    id: 'simplex',
    sideMode: 'single',
    label: 'Single-Sided (Simplex)',
    description: 'Printed on one side of each sheet'
  },
  {
    id: 'duplex_long',
    sideMode: 'double',
    label: 'Double-Sided (Flip Long Edge)',
    description: 'Standard book/portrait binding orientation'
  },
  {
    id: 'duplex_short',
    sideMode: 'double',
    label: 'Double-Sided (Flip Short Edge)',
    description: 'Calendar/landscape flip orientation'
  }
];

export const ORIENTATION_OPTIONS: { id: Orientation; label: string }[] = [
  { id: 'portrait', label: 'Portrait' },
  { id: 'landscape', label: 'Landscape' }
];

export const BINDING_OPTIONS: { id: BindingType; label: string }[] = [
  { id: 'none', label: 'None (Loose sheets)' },
  { id: 'staple', label: 'Corner Staple' },
  { id: 'spiral', label: 'Spiral Binding' },
  { id: 'lamination', label: 'Thermal Lamination' }
];

export function PrintConfigurationForm({
  initialSettings,
  totalDocumentPages = 1,
  shopId,
  disabled = false,
  isSubmitting = false,
  quoteService,
  printJobService,
  onSubmit,
  onChange,
  onCancel,
  className = ''
}: PrintConfigurationFormProps) {
  const formId = useId();

  // Initialize state with bidirectional harmonization
  const [paperSize, setPaperSize] = useState<PaperSize>(initialSettings?.paper_size ?? 'A4');
  const [colorMode, setColorMode] = useState<ColorMode>(initialSettings?.color_mode ?? 'bw');

  // Duplex mode resolution: inspect duplex first, then sides fallback
  const initialDuplex: DuplexMode = initialSettings?.duplex
    ? sidesToDuplex(initialSettings.duplex)
    : initialSettings?.sides
      ? sidesToDuplex(initialSettings.sides)
      : 'simplex';
  const [duplex, setDuplex] = useState<DuplexMode>(initialDuplex);

  const [orientation, setOrientation] = useState<Orientation>(
    initialSettings?.orientation ?? 'portrait'
  );
  const [copies, setCopies] = useState<number>(initialSettings?.copies ?? 1);
  const [pageRange, setPageRange] = useState<string>(initialSettings?.page_range ?? 'all');
  const [binding, setBinding] = useState<BindingType>(initialSettings?.binding ?? 'none');

  const [error, setError] = useState<string | null>(null);

  // Build harmonized settings object
  const buildCurrentSettings = useCallback(
    (overrides?: Partial<PrintSettings>): HarmonizedPrintSettings => {
      const currentDuplex =
        overrides?.duplex ?? (overrides?.sides ? sidesToDuplex(overrides.sides) : duplex);
      const currentSides = duplexToSides(currentDuplex);

      return createHarmonizedPrintSettings({
        paper_size: overrides?.paper_size ?? paperSize,
        color_mode: overrides?.color_mode ?? colorMode,
        sides: currentSides,
        duplex: currentDuplex,
        orientation: overrides?.orientation ?? orientation,
        copies: overrides?.copies ?? copies,
        page_range: overrides?.page_range ?? pageRange,
        binding: overrides?.binding ?? binding
      });
    },
    [paperSize, colorMode, duplex, orientation, copies, pageRange, binding]
  );

  // Handle duplex change
  const handleDuplexChange = useCallback(
    (newDuplex: DuplexMode) => {
      setDuplex(newDuplex);
      const harmonized = buildCurrentSettings({ duplex: newDuplex });
      onChange?.(harmonized);
    },
    [buildCurrentSettings, onChange]
  );

  // Handle copies change
  const handleCopiesChange = useCallback(
    (newCopies: number) => {
      const clamped = Math.max(1, Math.min(100, Math.floor(newCopies) || 1));
      setCopies(clamped);
      const harmonized = buildCurrentSettings({ copies: clamped });
      onChange?.(harmonized);
    },
    [buildCurrentSettings, onChange]
  );

  // Handle form submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || isSubmitting) return;

    setError(null);
    const harmonized = buildCurrentSettings();

    try {
      // If QuoteService is supplied with shopId, calculate quote
      if (quoteService && shopId) {
        await quoteService.calculateQuote({
          shop_id: shopId,
          settings: harmonized,
          priority_tier: 'flexible',
          document_page_count: totalDocumentPages
        });
      }

      // If PrintJobService is supplied with shopId, create print job
      if (printJobService && shopId) {
        await printJobService.createPrintJob({
          shop_id: shopId,
          customer_id: 'current-customer',
          document_storage_key: 'documents/default.pdf',
          settings: harmonized,
          priority_tier: 'flexible'
        });
      }

      await onSubmit?.(harmonized);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit print configuration';
      setError(msg);
    }
  };

  return (
    <form
      id={`print-config-form-${formId}`}
      aria-label="Print Configuration Form"
      onSubmit={handleSubmit}
      className={`space-y-6 ${className}`}
      noValidate
    >
      {error && (
        <div role="alert" className="p-3 text-sm text-red-700 bg-red-100 rounded-lg">
          {error}
        </div>
      )}

      {/* Paper Size */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-slate-800">Paper Size</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PAPER_SIZE_OPTIONS.map(opt => (
            <label
              key={opt.id}
              className={`flex flex-col p-3 border rounded-lg cursor-pointer transition ${
                paperSize === opt.id
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="paper_size"
                value={opt.id}
                checked={paperSize === opt.id}
                disabled={disabled || isSubmitting}
                onChange={() => {
                  setPaperSize(opt.id);
                  onChange?.(buildCurrentSettings({ paper_size: opt.id }));
                }}
                className="sr-only"
                data-testid={`paper-size-${opt.id}`}
              />
              <span className="font-medium text-slate-900 text-sm">{opt.label}</span>
              <span className="text-xs text-slate-500">{opt.dimensions}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Color Mode */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-slate-800">Color Reproduction</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {COLOR_MODE_OPTIONS.map(opt => (
            <label
              key={opt.id}
              className={`flex flex-col p-3 border rounded-lg cursor-pointer transition ${
                colorMode === opt.id
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="color_mode"
                value={opt.id}
                checked={colorMode === opt.id}
                disabled={disabled || isSubmitting}
                onChange={() => {
                  setColorMode(opt.id);
                  onChange?.(buildCurrentSettings({ color_mode: opt.id }));
                }}
                className="sr-only"
                data-testid={`color-mode-${opt.id}`}
              />
              <span className="font-medium text-slate-900 text-sm">{opt.label}</span>
              <span className="text-xs text-slate-500">{opt.description}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Duplex / Sides Mode */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-slate-800">Print Sides (Duplex)</legend>
        <p className="text-xs text-slate-500">
          Choose single-sided or double-sided printing with canonical orientation flip.
        </p>
        <div className="grid grid-cols-1 gap-2.5">
          {DUPLEX_OPTIONS.map(opt => (
            <label
              key={opt.id}
              className={`flex items-start p-3 border rounded-lg cursor-pointer transition ${
                duplex === opt.id
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="duplex"
                value={opt.id}
                checked={duplex === opt.id}
                disabled={disabled || isSubmitting}
                onChange={() => handleDuplexChange(opt.id)}
                className="mt-0.5 text-blue-600 focus:ring-blue-500"
                data-testid={`duplex-${opt.id}`}
              />
              <div className="ml-3">
                <span className="block font-medium text-slate-900 text-sm">{opt.label}</span>
                <span className="block text-xs text-slate-500">{opt.description}</span>
              </div>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Orientation */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-slate-800">Orientation</legend>
        <div className="grid grid-cols-2 gap-3">
          {ORIENTATION_OPTIONS.map(opt => (
            <label
              key={opt.id}
              className={`flex items-center justify-center p-2.5 border rounded-lg cursor-pointer transition text-center ${
                orientation === opt.id
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="orientation"
                value={opt.id}
                checked={orientation === opt.id}
                disabled={disabled || isSubmitting}
                onChange={() => {
                  setOrientation(opt.id);
                  onChange?.(buildCurrentSettings({ orientation: opt.id }));
                }}
                className="sr-only"
                data-testid={`orientation-${opt.id}`}
              />
              <span className="font-medium text-slate-900 text-sm">{opt.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Copies & Page Range */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor={`copies-${formId}`}
            className="block text-sm font-semibold text-slate-800 mb-1"
          >
            Copies (1 - 100)
          </label>
          <input
            id={`copies-${formId}`}
            name="copies"
            type="number"
            min={1}
            max={100}
            value={copies}
            disabled={disabled || isSubmitting}
            onChange={e => handleCopiesChange(parseInt(e.target.value, 10))}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            data-testid="copies-input"
          />
        </div>

        <div>
          <label
            htmlFor={`page-range-${formId}`}
            className="block text-sm font-semibold text-slate-800 mb-1"
          >
            Page Range
          </label>
          <input
            id={`page-range-${formId}`}
            name="page_range"
            type="text"
            value={pageRange}
            disabled={disabled || isSubmitting}
            placeholder="e.g. all or 1-5, 8"
            onChange={e => {
              const val = e.target.value;
              setPageRange(val);
              onChange?.(buildCurrentSettings({ page_range: val }));
            }}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            data-testid="page-range-input"
          />
        </div>
      </div>

      {/* Binding / Finishing */}
      <div>
        <label
          htmlFor={`binding-${formId}`}
          className="block text-sm font-semibold text-slate-800 mb-1"
        >
          Finishing & Binding
        </label>
        <select
          id={`binding-${formId}`}
          name="binding"
          value={binding}
          disabled={disabled || isSubmitting}
          onChange={e => {
            const val = e.target.value as BindingType;
            setBinding(val);
            onChange?.(buildCurrentSettings({ binding: val }));
          }}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          data-testid="binding-select"
        >
          {BINDING_OPTIONS.map(opt => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-200">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled || isSubmitting}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            data-testid="cancel-button"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={disabled || isSubmitting}
          className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:ring-4 focus:ring-blue-200 disabled:opacity-50"
          data-testid="submit-button"
        >
          {isSubmitting ? 'Calculating Quote...' : 'Apply & Calculate Quote'}
        </button>
      </div>
    </form>
  );
}

export default PrintConfigurationForm;
