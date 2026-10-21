'use client';

/**
 * Composite Reports View Component for CAPS Owner Reports (P05-M05-F01).
 * Ties together PeriodSelector, RevenueMetricsCard, DailyTrendsChart,
 * OperationsBreakdown, and PaidVsCompletedTable.
 */

import React from 'react';
import { useOwnerReports } from '../hooks/use-owner-reports';
import { PeriodSelector } from './PeriodSelector';
import { RevenueMetricsCard } from './RevenueMetricsCard';
import { DailyTrendsChart } from './DailyTrendsChart';
import { OperationsBreakdown } from './OperationsBreakdown';
import { PaidVsCompletedTable } from './PaidVsCompletedTable';
import { useShop } from '../../shop-management/shop-context';

export function ReportsView() {
  const { activeShop } = useShop();
  const shopId = activeShop?.id ?? '00000000-0000-0000-0000-000000000001';

  const { reportsData, isLoading, error, filter, setPeriod, setCustomDateRange, refresh } =
    useOwnerReports({ shopId });

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
        <h3 className="font-bold">Error loading reports</h3>
        <p className="mt-1 text-sm">{error}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-4 rounded-md bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-rose-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Sales & Operations Reports
          </h1>
          <p className="text-sm text-slate-500">
            Authoritative revenue analytics, physical fulfillment velocity, and customer demand
            metrics.
          </p>
        </div>

        {/* Timeframe Controls */}
        <div className="flex items-center gap-3">
          <PeriodSelector
            currentPeriod={filter.period}
            onPeriodChange={setPeriod}
            onCustomRangeSubmit={setCustomDateRange}
            isLoading={isLoading}
          />

          <button
            type="button"
            onClick={() => void refresh()}
            disabled={isLoading}
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
            title="Refresh analytics data"
          >
            {isLoading ? 'Refreshing...' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {isLoading && !reportsData ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-pulse">
          {[1, 2, 3, 4].map(idx => (
            <div key={idx} className="h-32 rounded-xl bg-slate-100 border border-slate-200" />
          ))}
        </div>
      ) : reportsData ? (
        <>
          {/* Top High-level Metric Cards */}
          <RevenueMetricsCard
            revenue={reportsData.revenue}
            operations={reportsData.operations}
            timezone={reportsData.timezone}
          />

          {/* Daily Trends Velocity Bar Chart */}
          <DailyTrendsChart trends={reportsData.dailyTrends} />

          {/* Operations, Peak Window, and Payment Breakdowns */}
          <OperationsBreakdown
            operations={reportsData.operations}
            payments={reportsData.payments}
          />

          {/* Detailed Auditable Paid vs Completed Records */}
          <PaidVsCompletedTable jobs={reportsData.jobs} />
        </>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-500">
          No shop selected or reports unavailable.
        </div>
      )}
    </div>
  );
}
