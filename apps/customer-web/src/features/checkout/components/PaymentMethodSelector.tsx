'use client';

/**
 * Accessible Payment Method Selector Component for CAPS Customer Web (P04-M05-F02).
 * Supports Online payments (UPI, Card, Wallet) and conditional Pay-at-Counter.
 * Accurately surfaces shop-specific counter payment policies.
 */

import React from 'react';
import type { PaymentMethod, PaymentMethodOption } from '../types';

export interface PaymentMethodSelectorProps {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
  isPayAtCounterAllowed?: boolean | undefined;
  payAtCounterDisabledReason?: string | undefined;
  disabled?: boolean | undefined;
}

export function PaymentMethodSelector({
  value,
  onChange,
  isPayAtCounterAllowed = true,
  payAtCounterDisabledReason,
  disabled = false
}: PaymentMethodSelectorProps) {
  const options: PaymentMethodOption[] = [
    {
      id: 'upi',
      label: 'UPI (Instant)',
      description: 'Google Pay, PhonePe, Paytm, BHIM & QR code',
      icon: '⚡',
      badge: 'Fastest',
      isOnline: true
    },
    {
      id: 'card',
      label: 'Credit / Debit Card',
      description: 'Visa, MasterCard, RuPay & Corporate cards',
      icon: '💳',
      isOnline: true
    },
    {
      id: 'wallet',
      label: 'Netbanking / Wallets',
      description: 'Netbanking across all major Indian banks',
      icon: '🏦',
      isOnline: true
    },
    {
      id: 'pay_at_counter',
      label: 'Pay at Counter',
      description: isPayAtCounterAllowed
        ? 'Pay cash or UPI directly at the shop counter upon collection'
        : payAtCounterDisabledReason || 'Not supported by this shop',
      icon: '🏪',
      badge: isPayAtCounterAllowed ? 'In-Store' : 'Unavailable',
      isOnline: false,
      disabled: !isPayAtCounterAllowed,
      disabledReason: payAtCounterDisabledReason
    }
  ];

  return (
    <fieldset className="space-y-3">
      <div className="flex items-center justify-between">
        <legend className="text-sm font-bold text-slate-800">
          Payment Method <span className="text-red-500">*</span>
        </legend>
        <span className="text-xs text-slate-400">Secure & Encrypted</span>
      </div>

      <div
        role="radiogroup"
        aria-label="Payment method selection"
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        {options.map((opt) => {
          const isSelected = value === opt.id;
          const isOptDisabled = disabled || !!opt.disabled;

          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-disabled={isOptDisabled}
              disabled={isOptDisabled}
              onClick={() => {
                if (!isOptDisabled) onChange(opt.id);
              }}
              title={opt.disabledReason}
              className={`flex flex-col justify-between text-left p-4 rounded-2xl border-2 transition-all relative ${
                opt.disabled
                  ? 'border-slate-200 bg-slate-50/80 opacity-60 cursor-not-allowed'
                  : isSelected
                    ? 'border-blue-600 bg-blue-50/50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300 cursor-pointer'
              } ${disabled && !opt.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center space-x-2.5">
                    <span className="text-lg" aria-hidden="true">
                      {opt.icon}
                    </span>
                    <span className="font-bold text-sm text-slate-900">{opt.label}</span>
                    {opt.badge && (
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          opt.disabled
                            ? 'bg-slate-200 text-slate-600'
                            : opt.badge === 'Fastest'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {opt.badge}
                      </span>
                    )}
                  </div>

                  <span
                    className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      isSelected
                        ? 'border-blue-600 bg-blue-600'
                        : 'border-slate-300 bg-white'
                    }`}
                    aria-hidden="true"
                  >
                    {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </span>
                </div>

                <p className="text-xs text-slate-500 line-clamp-2">{opt.description}</p>
              </div>

              {opt.id === 'pay_at_counter' && isPayAtCounterAllowed && (
                <div className="mt-3 pt-2 border-t border-slate-100 text-[11px] text-amber-800 font-medium flex items-center space-x-1">
                  <span>ℹ️</span>
                  <span>Requires shop owner confirmation before queueing</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
