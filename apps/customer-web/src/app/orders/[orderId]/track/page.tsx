'use client';

/**
 * Customer Web Order Tracking Screen (INT-D1-02).
 *
 * Provides real-time order tracking over Supabase Realtime channel `caps:job:<jobId>`:
 * - Dynamic 4-step progress stepper advancing live as print agent reports status.
 * - Real-time estimated completion time calculation.
 * - Live connection health badge (pulsing green dot for WSS, amber for 10s fallback polling).
 */

import React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  useJobTracking,
  TrackingConnectionBadge
} from '../../../../hooks/use-job-tracking';

export default function OrderTrackingPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params?.orderId || '';

  const {
    status,
    currentStep,
    steps,
    estimatedMinutesRemaining,
    estimatedPickupAt,
    pagesPrinted,
    totalPages,
    connectionState,
    refresh
  } = useJobTracking({
    jobId: orderId,
    initialStatus: 'SUBMITTED'
  });

  const isCompleted = status === 'COMPLETED';
  const isPrinting = status === 'PRINTING';
  const isFailed = status === 'FAILED' || status === 'CANCELLED';

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Link
              href="/orders"
              className="text-sm font-medium text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 mb-2"
            >
              &larr; Back to Orders
            </Link>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Order Tracking #{orderId.slice(0, 8)}
            </h1>
            <p className="text-sm text-slate-500">
              Live automated status updates from the print station
            </p>
          </div>

          <div className="flex items-center gap-3">
            <TrackingConnectionBadge status={connectionState} />
            <button
              onClick={() => refresh()}
              className="text-xs bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg font-medium transition shadow-sm"
              title="Refresh tracking status"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Progress Stepper Card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm">
          <div className="flex items-center justify-between pb-6 border-b border-slate-100">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Current Status
              </span>
              <div className="flex items-center gap-3 mt-1">
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${
                    isCompleted
                      ? 'bg-emerald-100 text-emerald-800'
                      : isFailed
                        ? 'bg-red-100 text-red-800'
                        : isPrinting
                          ? 'bg-indigo-100 text-indigo-800'
                          : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  {status}
                </span>

                {isCompleted && (
                  <span className="text-sm font-medium text-emerald-600">
                    Your prints are ready at the counter!
                  </span>
                )}
                {isPrinting && (
                  <span className="text-sm font-medium text-indigo-600">
                    Printing page {pagesPrinted} of {totalPages}...
                  </span>
                )}
              </div>
            </div>

            {/* Estimated Completion Countdown */}
            {!isCompleted && !isFailed && (
              <div className="text-right">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Est. Completion
                </span>
                <p className="text-lg font-bold text-slate-900">
                  {estimatedMinutesRemaining > 0 ? `~${estimatedMinutesRemaining} mins` : 'Any moment'}
                </p>
                {estimatedPickupAt && (
                  <p className="text-xs text-slate-500">
                    By {new Date(estimatedPickupAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Stepper Progress Bar */}
          <div className="mt-8 relative">
            <div className="hidden sm:block absolute top-4 left-6 right-6 h-1 bg-slate-100 -z-0">
              <div
                className="h-full bg-blue-600 transition-all duration-500"
                style={{ width: `${(currentStep / 3) * 100}%` }}
              />
            </div>

            <ol className="grid grid-cols-1 sm:grid-cols-4 gap-4 sm:gap-0 relative z-10">
              {steps.map(step => {
                const isStepComplete = currentStep > step.stepIndex;
                const isStepActive = currentStep === step.stepIndex;

                return (
                  <li
                    key={step.id}
                    className="flex sm:flex-col items-center sm:items-center text-left sm:text-center gap-3 sm:gap-2"
                  >
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs transition-colors ${
                        isStepComplete
                          ? 'bg-blue-600 text-white'
                          : isStepActive
                            ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                            : 'bg-slate-100 text-slate-400 border border-slate-200'
                      }`}
                    >
                      {isStepComplete ? '✓' : step.stepIndex + 1}
                    </div>
                    <div>
                      <h4
                        className={`text-xs font-bold ${
                          isStepActive || isStepComplete ? 'text-slate-900' : 'text-slate-400'
                        }`}
                      >
                        {step.name}
                      </h4>
                      <p className="text-[11px] text-slate-500 hidden sm:block">
                        {step.description}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {/* Live Details Summary Card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-4">
            Print Order Details
          </h3>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div className="p-3 bg-slate-50 rounded-xl">
              <dt className="text-xs text-slate-500 font-medium">Job Reference ID</dt>
              <dd className="font-mono text-xs font-semibold text-slate-800 mt-1 truncate">
                {orderId}
              </dd>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl">
              <dt className="text-xs text-slate-500 font-medium">Progress Stage</dt>
              <dd className="font-semibold text-slate-800 mt-1">
                Step {currentStep + 1} of 4: {steps[currentStep]?.name || status}
              </dd>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl">
              <dt className="text-xs text-slate-500 font-medium">Realtime Channel</dt>
              <dd className="font-mono text-xs font-semibold text-slate-800 mt-1">
                caps:job:{orderId.slice(0, 8)}...
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
