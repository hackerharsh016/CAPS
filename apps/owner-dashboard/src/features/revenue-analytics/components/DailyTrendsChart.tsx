'use client';

/**
 * Daily Trends Chart Component for CAPS Owner Reports (P05-M05-F01).
 * Renders daily trends of Paid Revenue vs Completed Revenue and order counts.
 */

import React from 'react';
import type { DailyTrendPoint } from '../types';
import { formatPaiseToINR } from '../analytics-utils';

interface DailyTrendsChartProps {
  trends: DailyTrendPoint[];
}

export function DailyTrendsChart({ trends }: DailyTrendsChartProps) {
  if (trends.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm text-slate-500">No activity recorded for this period.</p>
      </div>
    );
  }

  // Find max revenue for scaling bars
  const maxRevenue = Math.max(
    ...trends.map(t => Math.max(t.paidRevenuePaise, t.completedRevenuePaise)),
    1000 // minimum scale
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-slate-900">Revenue & Demand Velocity</h3>
          <p className="text-xs text-slate-500">
            Daily breakdown of collected payments vs physically fulfilled prints.
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center space-x-4 text-xs font-medium text-slate-600">
          <div className="flex items-center space-x-1.5">
            <span className="h-3 w-3 rounded-sm bg-emerald-500" aria-hidden="true" />
            <span>Fulfilled Revenue</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="h-3 w-3 rounded-sm bg-blue-500" aria-hidden="true" />
            <span>Paid Revenue</span>
          </div>
        </div>
      </div>

      {/* Chart Bars */}
      <div className="mt-8 space-y-4" role="region" aria-label="Daily revenue trend chart">
        {trends.map(point => {
          const completedPct = Math.min(
            100,
            Math.round((point.completedRevenuePaise / maxRevenue) * 100)
          );
          const paidPct = Math.min(100, Math.round((point.paidRevenuePaise / maxRevenue) * 100));

          return (
            <div key={point.date} className="group relative">
              <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                <span className="font-semibold text-slate-800">
                  {point.label} ({point.date})
                </span>
                <span className="font-mono text-slate-500">
                  {point.completedCount} fulfilled / {point.orderCount} orders
                </span>
              </div>

              {/* Stacked comparison bars */}
              <div className="space-y-1">
                {/* Completed Bar */}
                <div className="flex items-center gap-2">
                  <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300 group-hover:bg-emerald-600"
                      style={{ width: `${Math.max(completedPct, 2)}%` }}
                      title={`Fulfilled: ${formatPaiseToINR(point.completedRevenuePaise)}`}
                    />
                  </div>
                  <span className="w-24 text-right font-mono text-xs font-semibold text-emerald-700">
                    {formatPaiseToINR(point.completedRevenuePaise)}
                  </span>
                </div>

                {/* Paid Bar */}
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded bg-slate-100">
                    <div
                      className="h-full bg-blue-400 transition-all duration-300 group-hover:bg-blue-500"
                      style={{ width: `${Math.max(paidPct, 2)}%` }}
                      title={`Paid: ${formatPaiseToINR(point.paidRevenuePaise)}`}
                    />
                  </div>
                  <span className="w-24 text-right font-mono text-[11px] text-slate-500">
                    {formatPaiseToINR(point.paidRevenuePaise)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
