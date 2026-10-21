'use client';

/**
 * Shop Operational Settings Form Component for CAPS Owner Dashboard.
 * Includes Pay-at-counter authorization toggle, Auto-print toggle,
 * shop opening status, and location details.
 */

import React from 'react';
import type { ShopStatus, PricingFormErrors } from '../types';

export interface ShopSettingsFormProps {
  name: string;
  address: string;
  status: ShopStatus;
  autoPrintEnabled: boolean;
  payAtCounterEnabled: boolean;
  errors: PricingFormErrors;
  onNameChange: (name: string) => void;
  onAddressChange: (address: string) => void;
  onStatusChange: (status: ShopStatus) => void;
  onAutoPrintChange: (enabled: boolean) => void;
  onPayAtCounterChange: (enabled: boolean) => void;
  disabled?: boolean | undefined;
}

export function ShopSettingsForm({
  name,
  address,
  status,
  autoPrintEnabled,
  payAtCounterEnabled,
  errors,
  onNameChange,
  onAddressChange,
  onStatusChange,
  onAutoPrintChange,
  onPayAtCounterChange,
  disabled = false
}: ShopSettingsFormProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h3 className="text-base font-bold text-slate-900">Operational & Payment Settings</h3>
        <p className="text-xs text-slate-500">
          Control shop availability, pay-at-counter authorizations, and print automation.
        </p>
      </div>

      <div className="space-y-6">
        {/* Shop Name & Address */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="shop-name-input" className="block text-xs font-bold text-slate-900">
              Shop Name
            </label>
            <input
              id="shop-name-input"
              type="text"
              disabled={disabled}
              value={name}
              onChange={e => onNameChange(e.target.value)}
              aria-invalid={!!errors.shop_name}
              aria-describedby={errors.shop_name ? 'shop-name-err' : undefined}
              className={`mt-1 block w-full rounded-lg border px-3 py-1.5 text-xs font-medium ${
                errors.shop_name
                  ? 'border-rose-400 bg-rose-50 text-rose-900'
                  : 'border-slate-300 text-slate-900'
              }`}
            />
            {errors.shop_name && (
              <p id="shop-name-err" role="alert" className="mt-1 text-[11px] text-rose-600">
                {errors.shop_name}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="shop-address-input" className="block text-xs font-bold text-slate-900">
              Physical Address
            </label>
            <input
              id="shop-address-input"
              type="text"
              disabled={disabled}
              value={address}
              onChange={e => onAddressChange(e.target.value)}
              aria-invalid={!!errors.shop_address}
              aria-describedby={errors.shop_address ? 'shop-address-err' : undefined}
              className={`mt-1 block w-full rounded-lg border px-3 py-1.5 text-xs font-medium ${
                errors.shop_address
                  ? 'border-rose-400 bg-rose-50 text-rose-900'
                  : 'border-slate-300 text-slate-900'
              }`}
            />
            {errors.shop_address && (
              <p id="shop-address-err" role="alert" className="mt-1 text-[11px] text-rose-600">
                {errors.shop_address}
              </p>
            )}
          </div>
        </div>

        {/* Toggles */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-slate-100 pt-5">
          {/* Shop Status */}
          <div className="flex items-start justify-between rounded-lg border border-slate-100 bg-slate-50 p-4">
            <div>
              <span className="block text-xs font-bold text-slate-900">Storefront Status</span>
              <span className="block text-[11px] text-slate-500">
                {status === 'open' ? 'Accepting incoming customer jobs' : 'Temporarily paused'}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={status === 'open'}
              disabled={disabled}
              onClick={() => onStatusChange(status === 'open' ? 'closed' : 'open')}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                status === 'open' ? 'bg-emerald-600' : 'bg-slate-300'
              }`}
            >
              <span className="sr-only">Toggle shop status</span>
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  status === 'open' ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Pay-At-Counter Toggle */}
          <div className="flex items-start justify-between rounded-lg border border-slate-100 bg-slate-50 p-4">
            <div>
              <span className="block text-xs font-bold text-slate-900">Pay-at-Counter</span>
              <span className="block text-[11px] text-slate-500">
                Allow customers to authorize cash settlement at physical counter
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={payAtCounterEnabled}
              disabled={disabled}
              onClick={() => onPayAtCounterChange(!payAtCounterEnabled)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                payAtCounterEnabled ? 'bg-emerald-600' : 'bg-slate-300'
              }`}
            >
              <span className="sr-only">Toggle Pay at counter authorization</span>
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  payAtCounterEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Auto Print Toggle */}
          <div className="flex items-start justify-between rounded-lg border border-slate-100 bg-slate-50 p-4">
            <div>
              <span className="block text-xs font-bold text-slate-900">Auto-Print</span>
              <span className="block text-[11px] text-slate-500">
                Automatically send paid flexible jobs to spooler without manual 1-click
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoPrintEnabled}
              disabled={disabled}
              onClick={() => onAutoPrintChange(!autoPrintEnabled)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                autoPrintEnabled ? 'bg-emerald-600' : 'bg-slate-300'
              }`}
            >
              <span className="sr-only">Toggle Auto Print execution</span>
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  autoPrintEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
