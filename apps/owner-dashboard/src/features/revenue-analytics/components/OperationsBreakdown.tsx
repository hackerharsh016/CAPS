'use client';

/**
 * Operations Breakdown Component for CAPS Owner Reports (P05-M05-F01).
 * Displays Peak Demand hours, Priority Tier distribution, Color vs B&W volume,
 * and Payment Method breakdown.
 */

import React from 'react';
import type { OperationsSummary, PaymentBreakdown } from '../types';
import { formatPaiseToINR } from '../analytics-utils';

interface OperationsBreakdownProps {
  operations: OperationsSummary;
  payments: PaymentBreakdown;
}

export function OperationsBreakdown({ operations, payments }: OperationsBreakdownProps) {
  const { peakDemandHour, priorityBreakdown, colorBreakdown } = operations;
  const totalTierOrders = priorityBreakdown.urgent.count + priorityBreakdown.flexible.count;
  const urgentPct =
    totalTierOrders > 0 ? Math.round((priorityBreakdown.urgent.count / totalTierOrders) * 100) : 0;
  const flexiblePct = 100 - urgentPct;

  const totalColorOrders = colorBreakdown.bw + colorBreakdown.color;
  const bwPct = totalColorOrders > 0 ? Math.round((colorBreakdown.bw / totalColorOrders) * 100) : 0;
  const colorPct = 100 - bwPct;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* 1. Peak Demand & Operational Capacity */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h4 className="text-sm font-bold text-slate-900">Peak Demand Window</h4>
        <p className="mt-1 text-xs text-slate-500">
          Busiest operational rush hour detected during this period.
        </p>

        {peakDemandHour ? (
          <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xl font-extrabold text-amber-900">
                {peakDemandHour.label}
              </span>
              <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-bold text-amber-900">
                {peakDemandHour.orderCount} Orders
              </span>
            </div>
            <p className="mt-2 text-xs text-amber-800">
              Highest order influx concentration. Ensure sufficient paper trays are pre-loaded prior
              to this window.
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-slate-50 p-4 text-xs text-slate-500">
            No peak traffic detected for this timeframe.
          </div>
        )}

        {/* Priority Tiers */}
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
            <span>Priority Queue Tiers</span>
            <span>
              {urgentPct}% Urgent / {flexiblePct}% Flexible
            </span>
          </div>
          <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="bg-amber-500"
              style={{ width: `${urgentPct}%` }}
              title={`Urgent: ${priorityBreakdown.urgent.count} (${formatPaiseToINR(priorityBreakdown.urgent.revenuePaise)})`}
            />
            <div
              className="bg-blue-400"
              style={{ width: `${flexiblePct}%` }}
              title={`Flexible: ${priorityBreakdown.flexible.count} (${formatPaiseToINR(priorityBreakdown.flexible.revenuePaise)})`}
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-slate-500">
            <span className="text-amber-700 font-medium">
              Urgent: {formatPaiseToINR(priorityBreakdown.urgent.revenuePaise)}
            </span>
            <span className="text-blue-700 font-medium">
              Flexible: {formatPaiseToINR(priorityBreakdown.flexible.revenuePaise)}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Color vs Monochromatic Distribution */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h4 className="text-sm font-bold text-slate-900">Print Modality</h4>
        <p className="mt-1 text-xs text-slate-500">Ratio of Black & White vs Color documents.</p>

        <div className="mt-6 flex items-center justify-center gap-6">
          <div className="text-center">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 font-mono text-sm font-bold text-white shadow-inner">
              {bwPct}%
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-800">Black & White</p>
            <p className="text-[11px] text-slate-500">{colorBreakdown.bw} orders</p>
          </div>

          <div className="text-center">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-tr from-pink-500 to-indigo-500 font-mono text-sm font-bold text-white shadow-inner">
              {colorPct}%
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-800">Full Color</p>
            <p className="text-[11px] text-slate-500">{colorBreakdown.color} orders</p>
          </div>
        </div>

        <div className="mt-6 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <span className="font-semibold text-slate-800">Operational Note:</span> Double-sided
          duplex discounts and bulk color settings are automatically reconciled on driver profiles.
        </div>
      </div>

      {/* 3. Payment Methods Breakdown */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h4 className="text-sm font-bold text-slate-900">Payment Breakdown</h4>
        <p className="mt-1 text-xs text-slate-500">
          Collected revenue by customer payment channel.
        </p>

        <div className="mt-4 space-y-3">
          {(['upi', 'card', 'wallet', 'pay_at_counter'] as const).map(method => {
            const data = payments.byMethod[method];
            const labels: Record<string, string> = {
              upi: 'UPI (QR / App)',
              card: 'Credit / Debit Card',
              wallet: 'Digital Wallet',
              pay_at_counter: 'Pay at Counter'
            };

            return (
              <div
                key={method}
                className="flex items-center justify-between text-xs border-b border-slate-50 pb-2"
              >
                <div>
                  <span className="font-semibold text-slate-800">{labels[method]}</span>
                  <span className="ml-2 text-[11px] text-slate-400">({data.count} txns)</span>
                </div>
                <span className="font-mono font-medium text-slate-900">
                  {formatPaiseToINR(data.amountPaise)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
