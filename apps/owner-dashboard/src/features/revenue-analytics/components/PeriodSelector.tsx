'use client';

/**
 * Period Selector Component for CAPS Owner Reports (P05-M05-F01).
 * Supports presets (Today, 7D, 30D, This Month) and custom date ranges.
 */

import React, { useState } from 'react';
import type { PeriodPreset } from '../types';

interface PeriodSelectorProps {
  currentPeriod: PeriodPreset;
  onPeriodChange: (period: PeriodPreset) => void;
  onCustomRangeSubmit: (startDate: string, endDate: string) => void;
  isLoading?: boolean;
}

export function PeriodSelector({
  currentPeriod,
  onPeriodChange,
  onCustomRangeSubmit,
  isLoading = false
}: PeriodSelectorProps) {
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const presets: Array<{ id: PeriodPreset; label: string }> = [
    { id: 'today', label: 'Today (Daily)' },
    { id: '7d', label: 'Last 7 Days (Weekly)' },
    { id: '30d', label: 'Last 30 Days (Monthly)' },
    { id: 'this_month', label: 'This Calendar Month' },
    { id: 'custom', label: 'Custom Range...' }
  ];

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) {
      setValidationError('Please select both a start date and an end date.');
      return;
    }
    if (new Date(startDate) > new Date(endDate)) {
      setValidationError('Start date cannot be after end date.');
      return;
    }
    setValidationError(null);
    onCustomRangeSubmit(startDate, endDate);
    setShowCustomModal(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 shadow-sm" role="group" aria-label="Report timeframe">
        {presets.map(preset => {
          const isActive = currentPeriod === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              disabled={isLoading}
              onClick={() => {
                if (preset.id === 'custom') {
                  setShowCustomModal(true);
                } else {
                  onPeriodChange(preset.id);
                }
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                isActive
                  ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Custom Date Range Modal Dialog */}
      {showCustomModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="custom-range-title">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 id="custom-range-title" className="text-base font-bold text-slate-900">Select Custom Date Range</h3>
            <p className="mt-1 text-xs text-slate-500">Pick start and end dates in shop timezone.</p>

            <form onSubmit={handleCustomSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="custom-start-date" className="block text-xs font-medium text-slate-700">Start Date</label>
                <input
                  id="custom-start-date"
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  required
                />
              </div>

              <div>
                <label htmlFor="custom-end-date" className="block text-xs font-medium text-slate-700">End Date</label>
                <input
                  id="custom-end-date"
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  required
                />
              </div>

              {validationError && (
                <div className="rounded-md bg-rose-50 p-2 text-xs font-medium text-rose-700">
                  {validationError}
                </div>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
                >
                  Apply Filter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
