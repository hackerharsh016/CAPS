'use client';

/**
 * Binding and Tax Configuration Component for CAPS Owner Dashboard.
 */

import React from 'react';
import type { PricingConfig, PricingFormErrors, BindingType } from '../types';
import { paiseToRupees, rupeesToPaise } from '../types';

export interface BindingPricingFormProps {
  config: PricingConfig;
  errors: PricingFormErrors;
  onBindingChange: (binding: BindingType, valuePaise: number) => void;
  onGstChange: (percentage: number) => void;
  disabled?: boolean | undefined;
}

export function BindingPricingForm({
  config,
  errors,
  onBindingChange,
  onGstChange,
  disabled = false
}: BindingPricingFormProps) {
  const bindings: Array<{ type: BindingType; label: string; desc: string }> = [
    { type: 'spiral', label: 'Spiral Binding', desc: 'Standard plastic coil spiral binding' },
    { type: 'staple', label: 'Corner / Edge Staple', desc: 'Single or multi-point staple' },
    { type: 'lamination', label: 'Lamination', desc: 'Hot pouch lamination per page/sheet' }
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h3 className="text-base font-bold text-slate-900">Finishing & Tax Rates</h3>
        <p className="text-xs text-slate-500">
          Configure optional binding fees and your registered GST rate.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {bindings.map(b => {
          const pricePaise = config.binding_prices_paise[b.type];
          const err = errors[`binding.${b.type}` as keyof PricingFormErrors];

          return (
            <div key={b.type} className="rounded-lg border border-slate-100 bg-slate-50/50 p-4">
              <label
                htmlFor={`binding-${b.type}`}
                className="block text-xs font-bold text-slate-900"
              >
                {b.label}
              </label>
              <p className="mt-0.5 text-[11px] text-slate-500">{b.desc}</p>

              <div className="mt-3 flex items-center space-x-2">
                <span className="text-xs font-semibold text-slate-500">₹</span>
                <input
                  id={`binding-${b.type}`}
                  type="number"
                  step="1"
                  min="0"
                  disabled={disabled}
                  value={paiseToRupees(pricePaise)}
                  onChange={e => onBindingChange(b.type, rupeesToPaise(Number(e.target.value)))}
                  aria-invalid={!!err}
                  aria-describedby={err ? `binding-${b.type}-err` : undefined}
                  className={`w-full rounded-lg border px-3 py-1.5 text-xs font-medium ${
                    err
                      ? 'border-rose-400 bg-rose-50 text-rose-900 focus:border-rose-500'
                      : 'border-slate-300 bg-white text-slate-900 focus:border-emerald-500'
                  }`}
                />
              </div>
              {err && (
                <p
                  id={`binding-${b.type}-err`}
                  role="alert"
                  className="mt-1 text-[11px] text-rose-600"
                >
                  {err}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* GST Field */}
      <div className="mt-6 border-t border-slate-100 pt-5 flex items-center justify-between">
        <div>
          <label htmlFor="gst-input" className="block text-xs font-bold text-slate-900">
            Goods & Services Tax (GST)
          </label>
          <p className="text-xs text-slate-500">
            Applicable percentage added on checkout invoices (typically 18%).
          </p>
        </div>
        <div className="w-32">
          <div className="flex items-center space-x-2">
            <input
              id="gst-input"
              type="number"
              step="1"
              min="0"
              max="100"
              disabled={disabled}
              value={config.gst_percentage}
              onChange={e => onGstChange(Number(e.target.value))}
              aria-invalid={!!errors.gst_percentage}
              aria-describedby={errors.gst_percentage ? 'gst-err' : undefined}
              className={`w-full rounded-lg border px-3 py-1.5 text-xs font-medium text-right ${
                errors.gst_percentage
                  ? 'border-rose-400 bg-rose-50 text-rose-900 focus:border-rose-500'
                  : 'border-slate-300 bg-white text-slate-900 focus:border-emerald-500'
              }`}
            />
            <span className="text-xs font-bold text-slate-600">%</span>
          </div>
          {errors.gst_percentage && (
            <p id="gst-err" role="alert" className="mt-1 text-[11px] text-rose-600">
              {errors.gst_percentage}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
