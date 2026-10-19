'use client';

/**
 * Accessible Color Mode selection component for CAPS Print Settings (P04-M04-F01).
 * Supports Black & White (Monochrome) and Full Color reproduction.
 */

import React from 'react';
import type { ColorMode, ColorModeOption } from '../types';

export interface ColorModeSelectorProps {
  value: ColorMode;
  onChange: (value: ColorMode) => void;
  error?: string | undefined;
  disabled?: boolean | undefined;
}

const COLOR_MODE_OPTIONS: ColorModeOption[] = [
  {
    id: 'bw',
    label: 'Black & White',
    description: 'Crisp monochrome output, fastest and most economical',
    badge: 'Standard'
  },
  {
    id: 'color',
    label: 'Full Color',
    description: 'Vibrant CMYK reproduction for graphics, photos & presentations',
    badge: 'Premium'
  }
];

export function ColorModeSelector({
  value,
  onChange,
  error,
  disabled = false
}: ColorModeSelectorProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-bold text-slate-800">
        Color Mode <span className="text-red-500">*</span>
      </legend>
      <p id="color-mode-hint" className="text-xs text-slate-500">
        Select monochrome or full-color printing.
      </p>

      <div
        role="radiogroup"
        aria-labelledby="color-mode-hint"
        aria-invalid={!!error}
        aria-describedby={error ? 'color-mode-error' : undefined}
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        {COLOR_MODE_OPTIONS.map((option) => {
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
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-sm text-slate-900">{option.label}</span>
                  {option.badge && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        option.id === 'color'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {option.badge}
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
              <p className="text-xs text-slate-500 line-clamp-2">{option.description}</p>
            </button>
          );
        })}
      </div>

      {error && (
        <p id="color-mode-error" role="alert" className="text-xs text-red-600 font-medium">
          {error}
        </p>
      )}
    </fieldset>
  );
}
