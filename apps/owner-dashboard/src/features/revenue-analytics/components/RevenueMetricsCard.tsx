'use client';

/**
 * Revenue & Sales Metrics Card Component for CAPS Owner Reports (P05-M05-F01).
 * Displays high-level revenue figures: completed revenue, paid revenue, total orders,
 * average order value, and average wait time.
 */

import React from 'react';
import type { RevenueSummary, OperationsSummary } from '../types';
import { formatPaiseToINR, formatWaitMinutes } from '../analytics-utils';

interface RevenueMetricsCardProps {
  revenue: RevenueSummary;
  operations: OperationsSummary;
  timezone: string;
}

export function RevenueMetricsCard({ revenue, operations, timezone }: RevenueMetricsCardProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* 1. Completed vs Paid Revenue */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Fulfilled Revenue
          </span>
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            Completed Prints
          </span>
        </div>
        <p className="mt-2 font-mono text-2xl font-bold text-slate-900">
          {formatPaiseToINR(revenue.completedRevenuePaise)}
        </p>
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
          <span>Collected Payments:</span>
          <span className="font-semibold text-slate-700">
            {formatPaiseToINR(revenue.paidRevenuePaise)}
          </span>
        </div>
        {revenue.pendingRevenuePaise > 0 && (
          <div className="mt-1 flex items-center justify-between text-xs text-amber-600">
            <span>In-Queue / Pending Print:</span>
            <span className="font-medium">{formatPaiseToINR(revenue.pendingRevenuePaise)}</span>
          </div>
        )}
      </div>

      {/* 2. Order Volume */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Total Orders
          </span>
          <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
            {revenue.completedOrdersCount} Fulfilled
          </span>
        </div>
        <p className="mt-2 font-mono text-2xl font-bold text-slate-900">
          {revenue.paidOrdersCount}
        </p>
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
          <span>Active Pending:</span>
          <span className="font-semibold text-slate-700">{revenue.pendingOrdersCount} orders</span>
        </div>
        {revenue.cancelledOrFailedCount > 0 && (
          <div className="mt-1 flex items-center justify-between text-xs text-rose-500">
            <span>Cancelled / Failed:</span>
            <span className="font-medium">{revenue.cancelledOrFailedCount} orders</span>
          </div>
        )}
      </div>

      {/* 3. Average Order Value */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Avg Order Value
          </span>
          <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
            AOV
          </span>
        </div>
        <p className="mt-2 font-mono text-2xl font-bold text-slate-900">
          {formatPaiseToINR(revenue.averageOrderValuePaise)}
        </p>
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
          <span>Total Sheets Printed:</span>
          <span className="font-semibold text-slate-700">
            {operations.totalPrintedSheets.toLocaleString('en-IN')} pages
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
          <span>Refunds Total:</span>
          <span className="font-medium text-slate-700">
            {formatPaiseToINR(revenue.refundedPaise)}
          </span>
        </div>
      </div>

      {/* 4. Operations Wait Time */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Avg Queue Wait
          </span>
          <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
            Turnaround
          </span>
        </div>
        <p className="mt-2 font-mono text-2xl font-bold text-slate-900">
          {formatWaitMinutes(operations.averageWaitMinutes)}
        </p>
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
          <span>Median Wait Time:</span>
          <span className="font-semibold text-slate-700">
            {formatWaitMinutes(operations.medianWaitMinutes)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
          <span>Shop Timezone:</span>
          <span className="font-mono text-[11px] text-slate-600">{timezone}</span>
        </div>
      </div>
    </div>
  );
}
