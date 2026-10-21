'use client';

/**
 * Urgent Tier Surcharge Configuration Form Component for CAPS Owner Dashboard.
 * Configures priority jump fees and hourly throttling to prevent queue starvation.
 */

import React from 'react';
import type { UrgentSurchargeConfig, PricingFormErrors } from '../types';
import { paiseToRupees, rupeesToPaise } from '../types';

export interface UrgentConfigFormProps {
  config: UrgentSurchargeConfig;
  errors: PricingFormErrors;
  onChange: (
    updates: Partial<{
      type: 'flat' | 'percentage';
      amount: number;
      max_urgent_jobs_per_hour: number;
    }>
  ) => void;
  disabled?: boolean | undefined;
}

export function UrgentConfigForm({
  config,
  errors,
  onChange,
  disabled = false
}: UrgentConfigFormProps) {
  const isFlat = config.type === 'flat';
  const amountErr = errors['urgent.amount'];
  const maxJobsErr = errors['urgent.max_jobs'];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <div className="flex items-center space-x-2">
          <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">
            Priority Queue
          </span>
          <h3 className="text-base font-bold text-slate-900">Urgent Tier Surcharge</h3>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Urgent orders pay a surcharge to jump ahead of flexible orders in the print queue.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Surcharge Type */}
        <div>
          <label htmlFor="surcharge-type" className="block text-xs font-bold text-slate-900">
            Surcharge Type
          </label>
          <p className="mt-0.5 text-[11px] text-slate-500">Flat fee or percentage of order total</p>
          <select
            id="surcharge-type"
            disabled={disabled}
            value={config.type}
            onChange={e =>
              onChange({
                type: e.target.value as 'flat' | 'percentage',
                amount: e.target.value === 'flat' ? 2000 : 2000 // default 20 INR or 20%
              })
            }
            className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="flat">Flat Fee (₹ per job)</option>
            <option value="percentage">Percentage (Basis points)</option>
          </select>
        </div>

        {/* Amount */}
        <div>
          <label htmlFor="surcharge-amount" className="block text-xs font-bold text-slate-900">
            {isFlat ? 'Flat Surcharge (₹)' : 'Percentage Surcharge (%)'}
          </label>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {isFlat ? 'Amount charged per urgent job' : 'e.g. 20% surcharge on document cost'}
          </p>
          <div className="mt-2 flex items-center space-x-2">
            {isFlat && <span className="text-xs font-semibold text-slate-500">₹</span>}
            <input
              id="surcharge-amount"
              type="number"
              step={isFlat ? '1' : '1'}
              min="0"
              disabled={disabled}
              value={isFlat ? paiseToRupees(config.amount) : config.amount / 100}
              onChange={e => {
                const val = Number(e.target.value);
                onChange({
                  amount: isFlat ? rupeesToPaise(val) : Math.round(val * 100)
                });
              }}
              aria-invalid={!!amountErr}
              aria-describedby={amountErr ? 'urgent-amount-err' : undefined}
              className={`w-full rounded-lg border px-3 py-1.5 text-xs font-medium ${
                amountErr
                  ? 'border-rose-400 bg-rose-50 text-rose-900 focus:border-rose-500'
                  : 'border-slate-300 bg-white text-slate-900 focus:border-emerald-500'
              }`}
            />
            {!isFlat && <span className="text-xs font-bold text-slate-600">%</span>}
          </div>
          {amountErr && (
            <p id="urgent-amount-err" role="alert" className="mt-1 text-[11px] text-rose-600">
              {amountErr}
            </p>
          )}
        </div>

        {/* Hourly Cap */}
        <div>
          <label htmlFor="max-urgent-jobs" className="block text-xs font-bold text-slate-900">
            Max Urgent Jobs / Hour
          </label>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Fairness safeguard: limits urgent influx
          </p>
          <input
            id="max-urgent-jobs"
            type="number"
            step="1"
            min="1"
            max="100"
            disabled={disabled}
            value={config.max_urgent_jobs_per_hour ?? 5}
            onChange={e => onChange({ max_urgent_jobs_per_hour: Number(e.target.value) })}
            aria-invalid={!!maxJobsErr}
            aria-describedby={maxJobsErr ? 'max-jobs-err' : undefined}
            className={`mt-2 block w-full rounded-lg border px-3 py-1.5 text-xs font-medium ${
              maxJobsErr
                ? 'border-rose-400 bg-rose-50 text-rose-900 focus:border-rose-500'
                : 'border-slate-300 bg-white text-slate-900 focus:border-emerald-500'
            }`}
          />
          {maxJobsErr && (
            <p id="max-jobs-err" role="alert" className="mt-1 text-[11px] text-rose-600">
              {maxJobsErr}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
