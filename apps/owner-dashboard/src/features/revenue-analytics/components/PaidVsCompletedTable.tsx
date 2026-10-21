'use client';

/**
 * Paid vs Completed Records Table Component for CAPS Owner Reports (P05-M05-F01).
 * Specifically separates Paid revenue records from Physically Completed print records.
 */

import React, { useState, useMemo } from 'react';
import type { PaidVsCompletedJobRecord } from '../types';
import { formatPaiseToINR, formatWaitMinutes } from '../analytics-utils';

interface PaidVsCompletedTableProps {
  jobs: PaidVsCompletedJobRecord[];
}

type TabFilter = 'all' | 'completed' | 'paid_pending' | 'refunded';

export function PaidVsCompletedTable({ jobs }: PaidVsCompletedTableProps) {
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredJobs = useMemo(() => {
    return jobs.filter(job => {
      // Tab filter
      if (activeTab === 'completed' && job.jobStatus !== 'completed') return false;
      if (activeTab === 'paid_pending' && (job.paymentStatus !== 'paid' || job.jobStatus === 'completed')) return false;
      if (activeTab === 'refunded' && job.paymentStatus !== 'refunded') return false;

      // Search filter
      if (searchTerm.trim() !== '') {
        const query = searchTerm.toLowerCase();
        const matchesName = job.customerName.toLowerCase().includes(query);
        const matchesDoc = job.documentName.toLowerCase().includes(query);
        const matchesId = job.jobId.toLowerCase().includes(query);
        return matchesName || matchesDoc || matchesId;
      }
      return true;
    });
  }, [jobs, activeTab, searchTerm]);

  const counts = useMemo(() => {
    return {
      all: jobs.length,
      completed: jobs.filter(j => j.jobStatus === 'completed').length,
      paid_pending: jobs.filter(j => j.paymentStatus === 'paid' && j.jobStatus !== 'completed').length,
      refunded: jobs.filter(j => j.paymentStatus === 'refunded').length
    };
  }, [jobs]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Table Header and Segmented Tabs */}
      <div className="border-b border-slate-200 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Job Records: Paid vs Completed</h3>
            <p className="text-xs text-slate-500">
              Auditable log distinguishing payment authorization status from physical hardware completion.
            </p>
          </div>

          <div className="w-full sm:w-64">
            <input
              type="text"
              placeholder="Search document, customer, ID..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Orders ({counts.all})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('completed')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'completed'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            Fulfilled Completed ({counts.completed})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('paid_pending')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'paid_pending'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            Paid Awaiting Print ({counts.paid_pending})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('refunded')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'refunded'
                ? 'bg-rose-600 text-white'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
            }`}
          >
            Refunded ({counts.refunded})
          </button>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-600">
          <thead className="border-b border-slate-100 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
            <tr>
              <th scope="col" className="px-5 py-3">Job ID & Customer</th>
              <th scope="col" className="px-5 py-3">Document & Settings</th>
              <th scope="col" className="px-5 py-3">Priority Tier</th>
              <th scope="col" className="px-5 py-3">Payment Record</th>
              <th scope="col" className="px-5 py-3">Physical Print Status</th>
              <th scope="col" className="px-5 py-3">Wait Duration</th>
              <th scope="col" className="px-5 py-3 text-right">Amount (INR)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredJobs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                  No matching jobs found for this view.
                </td>
              </tr>
            ) : (
              filteredJobs.map(job => {
                const isCompleted = job.jobStatus === 'completed';
                const isPaid = job.paymentStatus === 'paid';

                return (
                  <tr key={job.jobId} className="hover:bg-slate-50/60 transition-colors">
                    {/* Job ID & Customer */}
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-slate-900">{job.customerName}</div>
                      <div className="font-mono text-[11px] text-slate-400">{job.jobId.slice(0, 8)}...</div>
                    </td>

                    {/* Document & Settings */}
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-slate-800 truncate max-w-[180px]">{job.documentName}</div>
                      <div className="text-[11px] text-slate-500">
                        {job.pages}p • {job.copies}x • {job.colorMode === 'color' ? 'Color' : 'B&W'} • {job.sides}
                      </div>
                    </td>

                    {/* Priority Tier */}
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                          job.priorityTier === 'urgent'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {job.priorityTier.toUpperCase()}
                      </span>
                    </td>

                    {/* Payment Record */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            isPaid
                              ? 'bg-emerald-50 text-emerald-700'
                              : job.paymentStatus === 'refunded'
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {job.paymentStatus === 'paid' ? 'Paid' : job.paymentStatus === 'refunded' ? 'Refunded' : 'Counter Pending'}
                        </span>
                        {job.paymentMethod && (
                          <span className="font-mono text-[11px] text-slate-400">
                            ({job.paymentMethod.toUpperCase()})
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Physical Print Status */}
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          isCompleted
                            ? 'bg-emerald-100 text-emerald-800'
                            : job.jobStatus === 'cancelled' || job.jobStatus === 'failed'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {isCompleted ? '✓ Completed' : job.jobStatus}
                      </span>
                    </td>

                    {/* Wait Duration */}
                    <td className="px-5 py-3.5 font-mono text-slate-600">
                      {typeof job.waitMinutes === 'number' ? formatWaitMinutes(job.waitMinutes) : '—'}
                    </td>

                    {/* Amount */}
                    <td className="px-5 py-3.5 text-right font-mono font-bold text-slate-900">
                      {formatPaiseToINR(job.amountPaise)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
