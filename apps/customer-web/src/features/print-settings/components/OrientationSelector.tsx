'use client';

/**
 * Accessible Orientation selection component for CAPS Print Settings (P04-M04-F01).
 * Supports Portrait and Landscape layout options.
 */

import React from 'react';
import type { Orientation, OrientationOption } from '../types';

export interface OrientationSelectorProps {
  value: Orientation;
  onChange: (value: Orientation) => void;
  error?: string | undefined;
  disabled?: boolean | undefined;
}

const ORIENTATION_OPTIONS: OrientationOption[] = [
  {
    id: 'portrait',
    label: 'Portrait (Vertical)',
    icon: '📄'
  },
  {
    id: 'landscape',
    label: 'Landscape (Horizontal)',
    icon: '📑'
  }
];

export function OrientationSelector({
  value,
  onChange,
  error,
  disabled = false
}: OrientationSelectorProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-bold text-slate-800">
        Orientation <span className="text-red-500">*</span>
      </legend>
      <p id="orientation-hint" className="text-xs text-slate-500">
        Choose page layout direction.
      </p>

      <div
        role="radiogroup"
        aria-labelledby="orientation-hint"
        aria-invalid={!!error}
        aria-describedby={error ? 'orientation-error' : undefined}
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        {ORIENTATION_OPTIONS.map(option => {
          const isSelected = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => onChange(option.id)}
              className={`flex items-center justify-between text-left p-3.5 rounded-xl border-2 transition-all ${
                isSelected
                  ? 'border-blue-600 bg-blue-50/50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="flex items-center space-x-2.5">
                <span className="text-xl" aria-hidden="true">
                  {option.icon}
                </span>
                <span className="font-bold text-sm text-slate-900">{option.label}</span>
              </div>
              <span
                className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  isSelected ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'
                }`}
                aria-hidden="true"
              >
                {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p id="orientation-error" role="alert" className="text-xs text-red-600 font-medium">
          {error}
        </p>
      )}
    </fieldset>
  );
}
