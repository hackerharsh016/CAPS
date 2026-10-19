'use client';

/**
 * Accessible Duplex (Sides) selection component for CAPS Print Settings (P04-M04-F01).
 * Supports Single-sided (simplex) and Double-sided (duplex) printing.
 */

import React from 'react';
import type { SideMode, SideModeOption } from '../types';

export interface DuplexSelectorProps {
  value: SideMode;
  onChange: (value: SideMode) => void;
  error?: string | undefined;
  disabled?: boolean | undefined;
}

const SIDE_MODE_OPTIONS: SideModeOption[] = [
  {
    id: 'single',
    label: 'Single-sided (Simplex)',
    description: 'Each page printed on a separate sheet of paper'
  },
  {
    id: 'double',
    label: 'Double-sided (Duplex)',
    description: 'Printed front & back, saves 50% paper and reduces bulk'
  }
];

export function DuplexSelector({
  value,
  onChange,
  error,
  disabled = false
}: DuplexSelectorProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-bold text-slate-800">
        Print Sides <span className="text-red-500">*</span>
      </legend>
      <p id="duplex-hint" className="text-xs text-slate-500">
        Choose whether to print on one side or both sides of each sheet.
      </p>

      <div
        role="radiogroup"
        aria-labelledby="duplex-hint"
        aria-invalid={!!error}
        aria-describedby={error ? 'duplex-error' : undefined}
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        {SIDE_MODE_OPTIONS.map((option) => {
          const isSelected = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => onChange(option.id)}
              className={`flex flex-col justify-between text-left p-3.5 rounded-xl border-2 transition-all ${
                isSelected
                  ? 'border-blue-600 bg-blue-50/50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="flex items-center justify-between w-full mb-1">
                <span className="font-bold text-sm text-slate-900">{option.label}</span>
                <span
                  className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    isSelected ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'
                  }`}
                  aria-hidden="true"
                >
                  {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
              </div>
              <p className="text-xs text-slate-500 line-clamp-2">{option.description}</p>
            </button>
          );
        })}
      </div>

      {error && (
        <p id="duplex-error" role="alert" className="text-xs text-red-600 font-medium">
          {error}
        </p>
      )}
    </fieldset>
  );
}
