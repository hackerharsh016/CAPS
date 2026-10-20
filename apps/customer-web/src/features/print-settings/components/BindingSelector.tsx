'use client';

/**
 * Accessible Binding & Finishing selection component for CAPS Print Settings (P04-M04-F01).
 * Supports None, Spiral Binding, Corner Stapling, and Thermal Lamination.
 * Accurately labels manual fulfillment finishing services per architectural guidelines.
 */

import React from 'react';
import type { BindingType, BindingOption } from '../types';

export interface BindingSelectorProps {
  value: BindingType;
  onChange: (value: BindingType) => void;
  error?: string | undefined;
  disabled?: boolean | undefined;
}

const BINDING_OPTIONS: BindingOption[] = [
  {
    id: 'none',
    label: 'None (Loose Sheets)',
    description: 'Standard unbound printed pages ready for collection',
    isFinishingService: false
  },
  {
    id: 'staple',
    label: 'Corner Staple',
    description: 'Neatly stapled at top-left corner (best for assignments & notes)',
    isFinishingService: true
  },
  {
    id: 'spiral',
    label: 'Spiral Binding',
    description: 'Comb/coil binding with transparent plastic protective covers',
    isFinishingService: true
  },
  {
    id: 'lamination',
    label: 'Thermal Lamination',
    description: 'Durable clear plastic heat-sealed lamination (certificates, ID cards)',
    isFinishingService: true
  }
];

export function BindingSelector({
  value,
  onChange,
  error,
  disabled = false
}: BindingSelectorProps) {
  return (
    <fieldset className="space-y-2">
      <div className="flex items-center justify-between">
        <legend className="text-sm font-bold text-slate-800">Binding & Finishing Service</legend>
        <span className="text-xs text-slate-400">Optional</span>
      </div>
      <p id="binding-hint" className="text-xs text-slate-500">
        Choose optional manual finishing services provided by the shop technician.
      </p>

      <div
        role="radiogroup"
        aria-labelledby="binding-hint"
        aria-invalid={!!error}
        aria-describedby={error ? 'binding-error' : undefined}
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        {BINDING_OPTIONS.map(option => {
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
                  {option.isFinishingService && (
                    <span className="text-[10px] font-semibold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                      Shop Service
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
        <p id="binding-error" role="alert" className="text-xs text-red-600 font-medium">
          {error}
        </p>
      )}
    </fieldset>
  );
}
