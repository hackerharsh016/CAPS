'use client';

import React from 'react';
import type { JobTrackingInfo } from '../types';
import { formatPaiseToInr } from '../../orders/orders-service';

interface JobDetailsCardProps {
  tracking: JobTrackingInfo;
}

export const JobDetailsCard: React.FC<JobDetailsCardProps> = ({ tracking }) => {
  const { settings } = tracking;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-6">
      <h4 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">
        Print Job Details
      </h4>

      {/* Document info */}
      <div className="flex items-start justify-between border-b border-slate-100 pb-4">
        <div>
          <span className="text-xs text-slate-500">Document Name</span>
          <p className="text-sm font-semibold text-slate-900 mt-0.5">{tracking.document_name}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {(tracking.file_size_bytes / (1024 * 1024)).toFixed(2)} MB • {settings.total_pages}{' '}
            total pages
          </p>
        </div>

        <div className="text-right">
          <span className="text-xs text-slate-500">Total Billed</span>
          <p className="text-sm font-bold text-slate-900 mt-0.5">
            {formatPaiseToInr(tracking.amount_paise)}
          </p>
          <span
            className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded capitalize ${
              tracking.payment_status === 'paid'
                ? 'bg-emerald-100 text-emerald-800'
                : tracking.payment_status === 'pay_at_counter'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-100 text-slate-700'
            }`}
          >
            {tracking.payment_status === 'pay_at_counter'
              ? 'Pay at Counter'
              : tracking.payment_status}
          </span>
        </div>
      </div>

      {/* Specifications Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
        <div>
          <span className="text-slate-500">Paper & Color</span>
          <p className="font-semibold text-slate-800 mt-0.5">
            {settings.paper_size} • {settings.color_mode === 'bw' ? 'B&W' : 'Color'}
          </p>
        </div>

        <div>
          <span className="text-slate-500">Sides & Orientation</span>
          <p className="font-semibold text-slate-800 mt-0.5">
            {settings.duplex ? 'Double-sided' : 'Single-sided'} • {settings.orientation}
          </p>
        </div>

        <div>
          <span className="text-slate-500">Copies & Range</span>
          <p className="font-semibold text-slate-800 mt-0.5">
            {settings.copies} {settings.copies === 1 ? 'copy' : 'copies'}
            {settings.page_range ? ` (Pages ${settings.page_range})` : ' (All pages)'}
          </p>
        </div>

        <div>
          <span className="text-slate-500">Finishing</span>
          <p className="font-semibold text-slate-800 mt-0.5">
            {settings.spiral_binding ? 'Spiral Binding Included' : 'No Binding (Loose)'}
          </p>
        </div>
      </div>

      {/* Shop Info Footer */}
      {(tracking.shop_address || tracking.shop_phone) && (
        <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border border-slate-200">
          <div>
            <span className="font-semibold text-slate-700">{tracking.shop_name}: </span>
            <span>{tracking.shop_address || 'Address provided on order'}</span>
          </div>
          {tracking.shop_phone && (
            <div className="text-slate-500">
              📞{' '}
              <a href={`tel:${tracking.shop_phone}`} className="hover:underline text-blue-600">
                {tracking.shop_phone}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
