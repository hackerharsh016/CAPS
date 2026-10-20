'use client';

import { RouteGuard } from '../features/auth/RouteGuard';

export default function OwnerDashboardPage() {
  return (
    <RouteGuard>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Top Stat Summary */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Pending Queue
            </p>
            <p className="mt-2 text-2xl font-bold text-slate-900">4 Jobs</p>
            <span className="text-xs text-amber-600 font-medium">1 Urgent in head</span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Today's Completed
            </p>
            <p className="mt-2 text-2xl font-bold text-slate-900">38 Jobs</p>
            <span className="text-xs text-emerald-600 font-medium">1,240 total pages</span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Today's Revenue
            </p>
            <p className="mt-2 text-2xl font-bold text-slate-900">₹2,840</p>
            <span className="text-xs text-slate-500">UPI & Cash settled</span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Print Agent Status
            </p>
            <p className="mt-2 text-xl font-bold text-emerald-600">Connected</p>
            <span className="text-xs text-slate-500 font-mono">Agent v0.1.0 • Win11</span>
          </div>
        </div>

        {/* Live Queue Container */}
        <div className="mt-8 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Live FIFO Print Queue</h2>
              <p className="text-xs text-slate-500">
                Orders ordered by Urgent priority first, then submission timestamp. Single-click
                confirms execution.
              </p>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
              Auto-refresh Active
            </span>
          </div>

          <div className="p-6">
            <div className="rounded-lg border-2 border-emerald-500 bg-emerald-50/40 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="rounded bg-rose-600 px-2 py-0.5 text-xs font-bold uppercase text-white">
                      Urgent Tier
                    </span>
                    <span className="font-mono text-sm font-bold text-slate-900">#JOB-1049</span>
                    <span className="text-sm text-slate-600">• Rahul S.</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    Settings: <strong>A4</strong> • <strong>B/W</strong> • <strong>Duplex</strong> •{' '}
                    <strong>2 Copies</strong> (Pages: 1–18) • Spiral Binding
                  </p>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="font-mono text-sm font-semibold text-slate-900">₹72.00 Paid</span>
                  <button className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700">
                    Confirm & Print
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </RouteGuard>
  );
}
