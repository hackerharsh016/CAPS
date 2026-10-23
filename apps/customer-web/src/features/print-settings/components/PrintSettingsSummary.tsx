'use client';

/**
 * Print Settings Summary Component for CAPS Customer Web (P04-M04-F01).
 * Displays live computed pages and physical sheet count based on settings.
 */

import React from 'react';
import type { PrintSettings, PrintSettingsCalculation } from '../types';

export interface PrintSettingsSummaryProps {
  settings: PrintSettings;
  calculation?: PrintSettingsCalculation | undefined;
  isValid: boolean;
}

export function PrintSettingsSummary({
  settings,
  calculation,
  isValid
}: PrintSettingsSummaryProps) {
  const paperLabels: Record<string, string> = {
    A4: 'A4',
    A3: 'A3',
    Legal: 'Legal'
  };

  const colorLabels: Record<string, string> = {
    bw: 'B&W',
    color: 'Color'
  };

  const sideLabels: Record<string, string> = {
    single: '1-Sided (Simplex)',
    double: '2-Sided (Duplex)'
  };

  const bindingLabels: Record<string, string> = {
    none: 'None (Loose)',
    spiral: 'Spiral Binding',
    staple: 'Corner Staple',
    lamination: 'Lamination'
  };

  return (
    <div
      role="region"
      aria-label="Print job summary and sheet estimate"
      className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-4"
    >
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <h3 className="text-sm font-bold text-slate-800 flex items-center space-x-2">
          <span>📋</span>
          <span>Configuration Summary</span>
        </h3>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            isValid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
          }`}
        >
          {isValid ? 'Ready for Quote' : 'Incomplete'}
        </span>
      </div>

      {/* Grid of key settings */}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <dt className="text-slate-400 font-medium">Paper & Color</dt>
          <dd className="font-bold text-slate-800 mt-0.5">
            {paperLabels[settings.paper_size] || settings.paper_size} ·{' '}
            {colorLabels[settings.color_mode] || settings.color_mode}
          </dd>
        </div>

        <div>
          <dt className="text-slate-400 font-medium">Sides & Layout</dt>
          <dd className="font-bold text-slate-800 mt-0.5">
            {sideLabels[settings.sides] || settings.sides}
          </dd>
        </div>

        <div>
          <dt className="text-slate-400 font-medium">Copies</dt>
          <dd className="font-bold text-slate-800 mt-0.5">
            {settings.copies} {settings.copies === 1 ? 'copy' : 'copies'}
          </dd>
        </div>

        <div>
          <dt className="text-slate-400 font-medium">Finishing</dt>
          <dd className="font-bold text-slate-800 mt-0.5">
            {bindingLabels[settings.binding] || settings.binding}
          </dd>
        </div>
      </dl>

      {/* Sheet & Page Calculations */}
      {calculation && isValid && (
        <div className="rounded-xl bg-white border border-slate-200/80 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="space-y-0.5">
            <p className="text-xs text-slate-500">
              Selected Pages:{' '}
              <strong className="text-slate-800">{calculation.effectivePageCount}</strong>{' '}
              {calculation.effectivePageCount === 1 ? 'page' : 'pages'} per copy
            </p>
            <p className="text-[11px] text-slate-400">
              {settings.sides === 'double'
                ? `Duplex printing uses ${Math.ceil(calculation.effectivePageCount / 2)} sheet(s) per copy`
                : 'Simplex printing uses 1 sheet per page'}
            </p>
          </div>

          <div className="text-left sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">
              Estimated Paper
            </span>
            <span className="text-lg font-extrabold text-blue-600">
              {calculation.estimatedSheetCount}{' '}
              {calculation.estimatedSheetCount === 1 ? 'Sheet' : 'Sheets'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
