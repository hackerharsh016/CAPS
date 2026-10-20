'use client';

/**
 * Accessible Copies Input component for CAPS Print Settings (P04-M04-F01).
 * Enforces strict 1-100 copy limits with steppers and quick preset buttons.
 */

import React from 'react';
import { MIN_COPIES, MAX_COPIES } from '../validation';

export interface CopiesInputProps {
  value: number;
  onChange: (value: number) => void;
  error?: string | undefined;
  disabled?: boolean | undefined;
}

const PRESET_COPIES = [1, 2, 5, 10];

export function CopiesInput({ value, onChange, error, disabled = false }: CopiesInputProps) {
  const handleDecrement = () => {
    if (value > MIN_COPIES && !disabled) {
      onChange(value - 1);
    }
  };

  const handleIncrement = () => {
    if (value < MAX_COPIES && !disabled) {
      onChange(value + 1);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value.trim();
    if (rawVal === '') {
      onChange(0);
      return;
    }
    const parsed = parseInt(rawVal, 10);
    if (!isNaN(parsed)) {
      onChange(parsed);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor="print-copies-input" className="text-sm font-bold text-slate-800">
          Number of Copies <span className="text-red-500">*</span>
        </label>
        <span className="text-xs text-slate-400">
          Limit: {MIN_COPIES} to {MAX_COPIES}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Stepper Input */}
        <div className="flex items-center rounded-xl border border-slate-300 bg-white shadow-sm overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
          <button
            type="button"
            aria-label="Decrease copies by 1"
            disabled={disabled || value <= MIN_COPIES}
            onClick={handleDecrement}
            className="flex h-11 w-11 items-center justify-center bg-slate-50 text-lg font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            −
          </button>

          <input
            id="print-copies-input"
            type="number"
            role="spinbutton"
            aria-valuenow={value}
            aria-valuemin={MIN_COPIES}
            aria-valuemax={MAX_COPIES}
            aria-invalid={!!error}
            aria-describedby={error ? 'copies-input-error' : undefined}
            min={MIN_COPIES}
            max={MAX_COPIES}
            value={value === 0 ? '' : value}
            onChange={handleInputChange}
            disabled={disabled}
            className="h-11 w-16 text-center text-base font-bold text-slate-900 border-x border-slate-200 focus:outline-none [-moz-appearance:_textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none"
          />

          <button
            type="button"
            aria-label="Increase copies by 1"
            disabled={disabled || value >= MAX_COPIES}
            onClick={handleIncrement}
            className="flex h-11 w-11 items-center justify-center bg-slate-50 text-lg font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            +
          </button>
        </div>

        {/* Quick Presets */}
        <div className="flex items-center gap-1.5" role="group" aria-label="Quick copy presets">
          {PRESET_COPIES.map(preset => (
            <button
              key={preset}
              type="button"
              disabled={disabled}
              onClick={() => onChange(preset)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                value === preset
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {preset} {preset === 1 ? 'copy' : 'copies'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p id="copies-input-error" role="alert" className="text-xs text-red-600 font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
