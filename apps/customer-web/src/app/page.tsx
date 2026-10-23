import React from 'react';
import Link from 'next/link';

export default function CustomerHomePage() {
  return (
    <div className="mx-auto max-w-7xl px-3.5 py-6 sm:px-6 sm:py-10 lg:px-8 space-y-8 sm:space-y-12">
      {/* Hero Section */}
      <div className="rounded-2xl sm:rounded-3xl bg-gradient-to-br from-blue-700 via-blue-800 to-indigo-900 p-6 sm:p-10 text-white shadow-xl">
        <div className="inline-flex items-center space-x-2 rounded-full bg-blue-500/30 px-3 py-1 text-xs font-semibold text-blue-100 backdrop-blur-xs mb-4">
          <span>⚡ Instant Print Ahead</span>
          <span>•</span>
          <span>Zero Waiting</span>
        </div>

        <h1 className="text-2xl xs:text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-tight">
          Zero-Queue Printing with CAPS
        </h1>
        <p className="mt-3 max-w-2xl text-sm sm:text-base lg:text-lg text-blue-100/90 leading-relaxed">
          Upload documents securely, configure paper & color options, pay online via UPI,
          and collect finished prints directly from the counter.
        </p>

        <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row gap-3 sm:gap-4">
          <Link
            href="/shops"
            className="flex items-center justify-center rounded-xl bg-white px-6 py-3.5 text-sm font-bold text-blue-700 shadow-md hover:bg-blue-50 active:scale-[0.99] transition-all"
          >
            Find Shops & Start Order →
          </Link>
          <Link
            href="/orders"
            className="flex items-center justify-center rounded-xl border border-white/30 bg-white/10 px-6 py-3.5 text-sm font-semibold text-white hover:bg-white/20 active:scale-[0.99] backdrop-blur-xs transition-all"
          >
            Track Existing Orders
          </Link>
        </div>
      </div>

      {/* Feature Pillars */}
      <div>
        <div className="text-center sm:text-left mb-6">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">
            How CAPS Simplifies Campus & Office Printing
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Three simple steps from file upload to physical printout.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs hover:shadow-md transition-shadow">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 font-black text-lg">
              1
            </div>
            <h3 className="mt-4 text-base font-bold text-slate-900">Configure Exactly</h3>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
              Select A4/A3, Color or B/W, Duplex, Custom Page Ranges, and Spiral Binding upfront with
              live instant pricing.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs hover:shadow-md transition-shadow">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 font-black text-lg">
              2
            </div>
            <h3 className="mt-4 text-base font-bold text-slate-900">Two-Tier Queue</h3>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
              Choose Flexible FIFO or Urgent priority jump. Follow live token position and completion
              ETAs in real time.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs hover:shadow-md transition-shadow sm:col-span-2 lg:col-span-1">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 font-black text-lg">
              3
            </div>
            <h3 className="mt-4 text-base font-bold text-slate-900">Privacy Guaranteed</h3>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
              Encrypted storage and automatic document destruction immediately after physical print
              completion.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
