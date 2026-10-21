'use client';

/**
 * Queue Metrics & KPI Summary Cards for CAPS Owner Dashboard.
 */

import React from 'react';
import type { QueueSummaryMetrics } from '../types';

export interface QueueMetricsHeaderProps {
  metrics: QueueSummaryMetrics;
}

export function QueueMetricsHeader({ metrics }: QueueMetricsHeaderProps) {
  const formattedRevenue = (metrics.todayRevenuePaise / 100).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  });

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {/* Pending Queue */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Pending Queue
        </p>
        <div className="mt-2 flex items-baseline space-x-2">
          <p className="text-2xl font-bold text-slate-900">{metrics.pendingCount} Jobs</p>
          {metrics.urgentCount > 0 && (
            <span className="rounded bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-600">
              {metrics.urgentCount} Urgent
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {metrics.executingCount > 0
            ? `${metrics.executingCount} job currently printing`
            : 'All printers ready'}
        </p>
      </div>

      {/* Today's Completed */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Today's Completed
        </p>
        <p className="mt-2 text-2xl font-bold text-slate-900">
          {metrics.todayCompletedCount} Jobs
        </p>
        <span className="text-xs font-medium text-emerald-600">1,240 total pages dispatched</span>
      </div>

      {/* Today's Revenue */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Today's Revenue
        </p>
        <p className="mt-2 text-2xl font-bold text-slate-900">{formattedRevenue}</p>
        <span className="text-xs text-slate-500">UPI & Cash settled</span>
      </div>

      {/* Estimated Wait */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Max Queue Wait (ETA)
        </p>
        <p className="mt-2 text-2xl font-bold text-slate-900">
          ~{metrics.totalEstimatedWaitMinutes} mins
        </p>
        <span className="text-xs text-slate-500 font-mono">Agent v0.1.0 • Win11 Online</span>
      </div>
    </div>
  );
}
