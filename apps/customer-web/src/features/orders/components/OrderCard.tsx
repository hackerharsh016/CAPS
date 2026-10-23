'use client';

/**
 * Accessible Order Card component for CAPS Customer Web.
 * Renders individual order metadata, configuration parameters, live status badges,
 * and privacy deletion guarantee notices.
 */

import React from 'react';
import type { CustomerOrder } from '../types';
import { formatPaiseToInr, getStatusBadgeProps } from '../orders-service';

export interface OrderCardProps {
  order: CustomerOrder;
}

export function OrderCard({ order }: OrderCardProps) {
  const statusBadge = getStatusBadgeProps(order.status);
  const formattedDate = new Date(order.created_at).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <article
      aria-labelledby={`order-title-${order.id}`}
      className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs transition-shadow hover:shadow-md"
    >
      {/* Top Header: Token, Shop, Status */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center space-x-2.5 sm:space-x-3 min-w-0">
          <span className="shrink-0 rounded-md bg-blue-50 px-2.5 py-1 font-mono text-xs sm:text-sm font-bold text-blue-700 border border-blue-200">
            {order.token_number}
          </span>
          <div className="min-w-0">
            <h3 id={`order-title-${order.id}`} className="text-sm sm:text-base font-semibold text-slate-900 truncate">
              {order.shop_name}
            </h3>
            <p className="text-[11px] sm:text-xs text-slate-500">{formattedDate}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          {order.priority_tier === 'urgent' && (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200">
              ⚡ Urgent Queue
            </span>
          )}
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadge.bgClass} ${statusBadge.textClass}`}
          >
            {statusBadge.label}
          </span>
        </div>
      </div>

      {/* Middle Body: Document and Print Configuration */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Document</p>
          <p
            className="mt-1 text-sm font-medium text-slate-900 truncate"
            title={order.document_name}
          >
            📄 {order.document_name}
          </p>
          <p className="text-xs text-slate-500">
            {(order.file_size_bytes / (1024 * 1024)).toFixed(2)} MB •{' '}
            {order.settings.pages_per_copy} pages/copy
          </p>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Configuration
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-slate-700">
            <span className="rounded bg-slate-100 px-2 py-0.5 font-medium">
              {order.settings.paper_size}
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 font-medium">
              {order.settings.color_mode === 'color' ? '🎨 Color' : '⚫ Black & White'}
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 font-medium">
              {order.settings.duplex ? 'Double Sided' : 'Single Sided'}
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 font-medium">
              {order.settings.copies} {order.settings.copies === 1 ? 'Copy' : 'Copies'} (
              {order.settings.total_pages} pages)
            </span>
            {order.settings.spiral_binding && (
              <span className="rounded bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700 border border-indigo-200">
                Spiral Bound
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Privacy Deletion Guarantee Notice */}
      {order.document_deleted && (
        <div
          role="note"
          aria-label="Privacy guarantee"
          className="mt-4 flex items-center space-x-2 rounded-lg bg-emerald-50/70 p-2.5 text-xs text-emerald-900 border border-emerald-200"
        >
          <span className="font-bold text-emerald-800">🔒 Privacy Protected:</span>
          <span>
            Uploaded document was automatically purged from cloud storage after printing per
            retention policy.
          </span>
        </div>
      )}

      {/* Bottom Footer: Price & Details Link */}
      <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-slate-100 pt-3">
        <div>
          <span className="text-xs text-slate-500">Total Paid: </span>
          <span className="text-base font-bold text-slate-900">
            {formatPaiseToInr(order.amount_paise)}
          </span>
          <span className="ml-2 text-xs text-emerald-600 font-medium capitalize">
            ({order.payment_status.replace('_', ' ')})
          </span>
        </div>

        <a
          href={`/jobs/${order.id}`}
          className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors w-full sm:w-auto text-center shadow-xs"
        >
          View Token & Tracking →
        </a>
      </div>
    </article>
  );
}
