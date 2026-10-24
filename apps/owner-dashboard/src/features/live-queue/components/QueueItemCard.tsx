'use client';

/**
 * Queue Item Card Component for CAPS Owner Dashboard.
 * Displays validated print specifications, dynamic priority position,
 * payment verification, ETA, 1-click confirmation trigger, and operator recovery actions.
 */

import React from 'react';
import type { QueueItem } from '../types';
import { ConfirmPrintButton } from '../../print-confirmation/components/ConfirmPrintButton';

export interface QueueItemCardProps {
  item: QueueItem;
  onConfirmPrint?: ((jobId: string) => Promise<void> | void) | undefined;
  onReviewJob?: ((item: QueueItem) => void) | undefined;
  disabled?: boolean | undefined;
  isConfirming?: boolean | undefined;
  isNextInQueue?: boolean | undefined;
}

export function QueueItemCard({
  item,
  onConfirmPrint,
  onReviewJob,
  disabled = false,
  isConfirming = false,
  isNextInQueue: isNextInQueueProp
}: QueueItemCardProps) {
  const isUrgent = item.priority_tier === 'urgent';
  const isExecuting = item.is_currently_executing;
  const isRequiresReview = item.status === 'requires_review' || item.status === 'failed';
  const isApproved = item.status === 'approved';
  const isNextInQueue =
    isNextInQueueProp !== undefined
      ? isNextInQueueProp
      : item.queue_position === 1 && !isExecuting && item.status === 'queued';

  const formattedPrice = (item.price_total_paise / 100).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR'
  });

  const shortJobToken = item.id.length > 8 ? `#JOB-${item.id.slice(-4).toUpperCase()}` : item.id;

  return (
    <div
      className={`rounded-xl border transition-all ${
        isRequiresReview
          ? 'border-2 border-amber-400 bg-amber-50/40 shadow-sm'
          : isExecuting
            ? 'border-2 border-emerald-500 bg-emerald-50/30 shadow-md'
            : isUrgent
              ? 'border-rose-200 bg-white hover:border-rose-300 shadow-sm'
              : 'border-slate-200 bg-white hover:border-slate-300 shadow-sm'
      } p-5`}
    >
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        {/* Left Section: Badges, Token, and Customer Details */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Priority Tier Badge */}
            {isUrgent ? (
              <span className="rounded bg-rose-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
                Urgent Tier
              </span>
            ) : (
              <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                Flexible FIFO
              </span>
            )}

            {/* Queue / Execution / Review Status */}
            {isRequiresReview ? (
              <span className="flex items-center space-x-1 rounded bg-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-900 animate-pulse">
                <span>⚠️ Ambiguous Outcome</span>
              </span>
            ) : isExecuting ? (
              <span className="flex items-center space-x-1 rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-emerald-600" />
                <span>Printing Now</span>
              </span>
            ) : isApproved ? (
              <span className="flex items-center space-x-1 rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-800">
                <span>✓ Approved (Ready)</span>
              </span>
            ) : (
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 font-mono">
                #{item.queue_position} in queue
              </span>
            )}

            {/* Token & Customer */}
            <span className="font-mono text-xs font-bold text-slate-900">{shortJobToken}</span>
            <span className="text-xs text-slate-600">• {item.customer_name}</span>
            {item.customer_phone && (
              <span className="text-xs text-slate-400">({item.customer_phone})</span>
            )}
          </div>

          {/* Document & Settings Specifications */}
          <div className="text-xs text-slate-600">
            {item.document_name && (
              <p className="font-medium text-slate-800 truncate max-w-md">
                📄 {item.document_name}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
                {item.settings.paper_size}
              </span>
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
                {item.settings.color_mode === 'color' ? 'Color' : 'B/W'}
              </span>
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
                {item.settings.sides === 'double' ? 'Duplex' : 'Single Sided'}
              </span>
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
                {item.settings.copies} {item.settings.copies === 1 ? 'Copy' : 'Copies'}
              </span>
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
                Pages: {item.settings.page_range || 'All'}
              </span>
              {item.settings.binding !== 'none' && (
                <span className="rounded border border-purple-200 bg-purple-50 px-2 py-0.5 font-medium text-purple-700 capitalize">
                  {item.settings.binding} Binding
                </span>
              )}
            </div>
          </div>

          {/* Printer Assignment and ETA */}
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 pt-1">
            <span>
              🖨️ {item.printer_name ? item.printer_name : 'Auto-routed to default printer'}
            </span>
            <span>•</span>
            <span>
              ⏱️{' '}
              {isExecuting
                ? 'Estimated completion: ~1 min'
                : `Estimated wait: ~${item.estimated_wait_minutes} mins`}
            </span>
          </div>
        </div>

        {/* Right Section: Price Badge and Action Button */}
        <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center gap-3 border-t md:border-t-0 pt-3 md:pt-0 border-slate-100">
          <div className="text-right">
            <span
              className={`inline-block rounded-md px-2 py-1 text-xs font-bold ${
                item.payment_status === 'paid'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}
            >
              {formattedPrice} {item.payment_status === 'paid' ? 'Paid' : 'Pay at Counter'}
            </span>
          </div>

          {/* Action button */}
          {isRequiresReview ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onReviewJob?.(item)}
              className="inline-flex items-center space-x-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <span>⚠️ Review & Recover</span>
            </button>
          ) : isApproved ? (
            <div
              aria-label="Job is approved and waiting for printer agent"
              className="inline-flex items-center space-x-1.5 rounded-lg bg-indigo-50 border border-indigo-200 px-3.5 py-2 text-xs font-semibold text-indigo-700"
            >
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
              <span>Approved (Waiting for Agent)</span>
            </div>
          ) : onConfirmPrint ? (
            <ConfirmPrintButton
              jobId={item.id}
              isNextInQueue={isNextInQueue}
              isExecuting={isExecuting}
              isConfirming={isConfirming}
              disabled={disabled}
              onConfirm={onConfirmPrint}
            />
          ) : (
            <button
              type="button"
              disabled
              className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-400 cursor-not-allowed"
            >
              Confirm & Print
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
