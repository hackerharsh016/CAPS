'use client';

/**
 * Accessible Paper Size selection component for CAPS Print Settings (P04-M04-F01 / P04-M04-F02).
 * Supports A4, A3, and Legal formats with dimensions and printer capability awareness.
 */

import React from 'react';
import type { PaperSize, PaperSizeOption } from '../types';

export interface PaperSizeSelectorProps {
  value: PaperSize;
  onChange: (value: PaperSize) => void;
  error?: string | undefined;
  disabled?: boolean | undefined;
  disabledOptions?: PaperSize[] | undefined;
  unsupportedReasons?: Partial<Record<PaperSize, string>> | undefined;
}

const PAPER_SIZE_OPTIONS: PaperSizeOption[] = [
  {
    id: 'A4',
    label: 'A4 Standard',
    description: 'General printing, documents, resumes & assignments',
    dimensions: '210 × 297 mm'
  },
  {
    id: 'A3',
    label: 'A3 Large',
    description: 'Posters, blueprints, spreadsheets & diagrams',
    dimensions: '297 × 420 mm'
  },
  {
    id: 'Legal',
    label: 'Legal Format',
    description: 'Contracts, court documents & legal agreements',
    dimensions: '216 × 356 mm'
  }
];

export function PaperSizeSelector({
  value,
  onChange,
  error,
  disabled = false,
  disabledOptions = [],
  unsupportedReasons
}: PaperSizeSelectorProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-bold text-slate-800">
        Paper Size <span className="text-red-500">*</span>
      </legend>
      <p id="paper-size-hint" className="text-xs text-slate-500">
        Select the paper dimension for your physical printout.
      </p>

      <div
        role="radiogroup"
        aria-labelledby="paper-size-hint"
        aria-invalid={!!error}
        aria-describedby={error ? 'paper-size-error' : undefined}
        className="grid grid-cols-1 sm:grid-cols-3 gap-3"
      >
        {PAPER_SIZE_OPTIONS.map((option) => {
          const isSelected = value === option.id;
          const isUnsupported = disabledOptions.includes(option.id);
          const isOptionDisabled = disabled || isUnsupported;
          const reason = unsupportedReasons?.[option.id];

          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-disabled={isOptionDisabled}
              disabled={isOptionDisabled}
              onClick={() => {
                if (!isOptionDisabled) onChange(option.id);
              }}
              title={isUnsupported ? reason || `${option.label} is unsupported by the shop's printers` : undefined}
              className={`flex flex-col justify-between text-left p-3.5 rounded-xl border-2 transition-all relative ${
                isUnsupported
                  ? 'border-slate-200 bg-slate-50/80 opacity-60 cursor-not-allowed'
                  : isSelected
                    ? 'border-blue-600 bg-blue-50/50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300 cursor-pointer'
              } ${disabled && !isUnsupported ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center justify-between w-full mb-1">
                <div className="flex items-center space-x-1.5 flex-wrap">
                  <span className="font-bold text-sm text-slate-900">{option.label}</span>
                  {isUnsupported && (
                    <span className="text-[10px] font-bold text-slate-500 bg-slate-200/80 px-1.5 py-0.5 rounded">
                      Unsupported
                    </span>
                  )}
                </div>
                <span
                  className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    isSelected ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'
                  }`}
                  aria-hidden="true"
                >
                  {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
              </div>

              <p className="text-xs text-slate-500 line-clamp-2 mb-2">
                {isUnsupported && reason ? reason : option.description}
              </p>

              <span className="text-[11px] font-mono font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded w-fit">
                {option.dimensions}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p id="paper-size-error" role="alert" className="text-xs text-red-600 font-medium">
          {error}
        </p>
      )}
    </fieldset>
  );
}
