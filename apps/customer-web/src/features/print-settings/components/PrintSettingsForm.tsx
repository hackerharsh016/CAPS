'use client';

/**
 * Composite Capability-Aware Print Settings Form for CAPS Customer Web (P04-M04-F01 / P04-M04-F02).
 * Ties together paper size, color, duplex, orientation, copies, page range,
 * finishing services, and discovered printer capability constraints into a fully accessible form.
 */

import React, { useMemo } from 'react';
import type { PrintSettings, PrintSettingsCalculation, PaperSize, ColorMode, SideMode } from '../types';
import type { ShopPrinterCapabilities } from '../capabilities-types';
import { usePrintSettings } from '../use-print-settings';
import { PaperSizeSelector } from './PaperSizeSelector';
import { ColorModeSelector } from './ColorModeSelector';
import { DuplexSelector } from './DuplexSelector';
import { OrientationSelector } from './OrientationSelector';
import { CopiesInput } from './CopiesInput';
import { PageRangeInput } from './PageRangeInput';
import { BindingSelector } from './BindingSelector';
import { PrintSettingsSummary } from './PrintSettingsSummary';
import { CapabilityWarningBanner } from './CapabilityWarningBanner';

export interface PrintSettingsFormProps {
  initialSettings?: Partial<PrintSettings> | undefined;
  totalDocumentPages?: number | undefined;
  capabilities?: ShopPrinterCapabilities | undefined;
  shopName?: string | undefined;
  onChangeShopUrl?: string | undefined;
  storageKey?: string | undefined;
  isSubmitting?: boolean | undefined;
  disabled?: boolean | undefined;
  onSubmit: (settings: PrintSettings, calculation?: PrintSettingsCalculation | undefined) => void;
  onCancel?: (() => void) | undefined;
}

export function PrintSettingsForm({
  initialSettings,
  totalDocumentPages,
  capabilities,
  shopName,
  onChangeShopUrl = '/shops',
  storageKey,
  isSubmitting = false,
  disabled = false,
  onSubmit,
  onCancel
}: PrintSettingsFormProps) {
  const {
    settings,
    errors,
    isValid,
    calculation,
    capabilityCheck,
    isDirty,
    updatePaperSize,
    updateColorMode,
    updateSides,
    updateOrientation,
    updateCopies,
    updatePageRange,
    updateBinding,
    applyCompatibleSettings,
    resetSettings,
    validateNow
  } = usePrintSettings({
    initialSettings,
    totalDocumentPages,
    capabilities,
    storageKey
  });

  // Calculate disabled options based on shop capabilities
  const { disabledPapers, disabledColors, disabledSides, paperReasons } = useMemo(() => {
    const disabledPapers: PaperSize[] = [];
    const paperReasons: Partial<Record<PaperSize, string>> = {};
    const disabledColors: ColorMode[] = [];
    const disabledSides: SideMode[] = [];

    if (capabilities && capabilities.online_printers_count > 0) {
      // Paper size restrictions
      for (const p of ['A4', 'A3', 'Legal'] as const) {
        if (!capabilities.supported_paper_sizes.includes(p)) {
          disabledPapers.push(p);
          paperReasons[p] = `${p} is unsupported by ${shopName || 'this shop'}'s printers`;
        }
      }

      // Color mode restrictions
      if (!capabilities.supported_color_modes.includes('color')) {
        disabledColors.push('color');
      }

      // Duplex restrictions
      if (!capabilities.duplex_supported) {
        disabledSides.push('double');
      }
    }

    return { disabledPapers, disabledColors, disabledSides, paperReasons };
  }, [capabilities, shopName]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (disabled || isSubmitting) return;

    const valid = validateNow();
    if (valid) {
      onSubmit(settings, calculation);
    }
  };

  const hasErrors = Object.keys(errors).length > 0;
  const isOffline = capabilities && capabilities.online_printers_count === 0;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label="Print configuration settings form"
      className="space-y-8"
    >
      {/* Capability Warning & Incompatibility Banner */}
      <CapabilityWarningBanner
        checkResult={capabilityCheck}
        capabilities={capabilities}
        shopName={shopName}
        onApplySupportedSettings={applyCompatibleSettings}
        onChangeShopUrl={onChangeShopUrl}
      />

      {/* General validation error summary if form invalid on submit */}
      {hasErrors && !capabilityCheck?.incompatibilities.length && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 space-y-1"
        >
          <div className="flex items-center space-x-2 font-bold">
            <span>⚠️</span>
            <span>Please resolve the following configuration errors:</span>
          </div>
          <ul className="list-disc list-inside pl-4 space-y-0.5">
            {Object.entries(errors).map(([field, msg]) => (
              <li key={field}>{msg}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Section 1: Paper & Layout */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
        <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
          1. Paper & Layout Configuration
        </h2>

        <PaperSizeSelector
          value={settings.paper_size}
          onChange={updatePaperSize}
          error={errors.paper_size}
          disabled={disabled || isSubmitting || isOffline}
          disabledOptions={disabledPapers}
          unsupportedReasons={paperReasons}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          <DuplexSelector
            value={settings.sides}
            onChange={updateSides}
            error={errors.sides}
            disabled={disabled || isSubmitting || isOffline}
            disabledOptions={disabledSides}
            unsupportedReasons={{
              double: `Double-sided printing is unsupported by ${shopName || 'this shop'}`
            }}
          />

          <OrientationSelector
            value={settings.orientation}
            onChange={updateOrientation}
            error={errors.orientation}
            disabled={disabled || isSubmitting || isOffline}
          />
        </div>
      </div>

      {/* Section 2: Color & Copies */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
        <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
          2. Color & Print Volume
        </h2>

        <ColorModeSelector
          value={settings.color_mode}
          onChange={updateColorMode}
          error={errors.color_mode}
          disabled={disabled || isSubmitting || isOffline}
          disabledOptions={disabledColors}
          unsupportedReasons={{
            color: `Color printing is unsupported by ${shopName || 'this shop'} (B&W only)`
          }}
        />

        <div className="pt-2">
          <CopiesInput
            value={settings.copies}
            onChange={updateCopies}
            error={errors.copies}
            disabled={disabled || isSubmitting || isOffline}
          />
        </div>
      </div>

      {/* Section 3: Pages & Finishing */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
        <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
          3. Pages & Finishing Options
        </h2>

        <PageRangeInput
          value={settings.page_range}
          onChange={updatePageRange}
          totalDocumentPages={totalDocumentPages}
          error={errors.page_range}
          disabled={disabled || isSubmitting || isOffline}
        />

        <div className="pt-2">
          <BindingSelector
            value={settings.binding}
            onChange={updateBinding}
            error={errors.binding}
            disabled={disabled || isSubmitting || isOffline}
          />
        </div>
      </div>

      {/* Section 4: Live Summary & Calculation */}
      <PrintSettingsSummary
        settings={settings}
        calculation={calculation}
        isValid={isValid}
      />

      {/* Form Action Buttons */}
      <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-4 pt-2">
        <div className="flex items-center space-x-3 w-full sm:w-auto">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={disabled || isSubmitting}
              className="w-full sm:w-auto rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          )}

          {isDirty && (
            <button
              type="button"
              onClick={resetSettings}
              disabled={disabled || isSubmitting}
              className="text-xs text-slate-500 hover:text-slate-800 underline transition-colors"
            >
              Reset to Defaults
            </button>
          )}
        </div>

        <button
          type="submit"
          disabled={!isValid || disabled || isSubmitting || isOffline}
          className="w-full sm:w-auto flex items-center justify-center space-x-2 rounded-xl bg-blue-600 px-8 py-3 text-sm font-bold text-white shadow-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isSubmitting ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>Validating...</span>
            </>
          ) : (
            <span>Proceed to Quote & Price Preview →</span>
          )}
        </button>
      </div>
    </form>
  );
}
