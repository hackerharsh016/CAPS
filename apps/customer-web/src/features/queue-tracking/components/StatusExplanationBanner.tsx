'use client';

import React from 'react';
import type { JobTrackingInfo } from '../types';

interface StatusExplanationBannerProps {
  tracking: JobTrackingInfo;
}

export const StatusExplanationBanner: React.FC<StatusExplanationBannerProps> = ({ tracking }) => {
  const { status, is_agent_offline, status_label, status_explanation, next_step_instruction } =
    tracking;

  if (is_agent_offline) {
    return (
      <div
        className="bg-amber-50 border-l-4 border-amber-500 p-5 rounded-r-xl shadow-sm"
        role="alert"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <svg
            className="w-6 h-6 text-amber-600 shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div>
            <h5 className="text-sm font-bold text-amber-900">Station Communication Offline</h5>
            <p className="text-sm text-amber-800 mt-1">{status_explanation}</p>
            <div className="mt-3 bg-amber-100/70 border border-amber-200 rounded-md p-2.5 text-xs text-amber-900 font-medium">
              👉 <span className="font-semibold">Next Step:</span> {next_step_instruction}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'unknown') {
    return (
      <div
        className="bg-slate-50 border-l-4 border-slate-500 p-5 rounded-r-xl shadow-sm"
        role="alert"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <svg
            className="w-6 h-6 text-slate-600 shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <h5 className="text-sm font-bold text-slate-900">{status_label}</h5>
            <p className="text-sm text-slate-700 mt-1">{status_explanation}</p>
            <div className="mt-3 bg-slate-200/70 border border-slate-300 rounded-md p-2.5 text-xs text-slate-800 font-medium">
              👉 <span className="font-semibold">Next Step:</span> {next_step_instruction}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'ready') {
    return (
      <div
        className="bg-emerald-50 border-l-4 border-emerald-500 p-5 rounded-r-xl shadow-sm"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <svg
            className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <div>
            <h5 className="text-sm font-bold text-emerald-900">{status_label}</h5>
            <p className="text-sm text-emerald-800 mt-1">{status_explanation}</p>
            <div className="mt-3 bg-emerald-100/70 border border-emerald-200 rounded-md p-2.5 text-xs text-emerald-900 font-medium">
              👉 <span className="font-semibold">Pickup Instruction:</span> {next_step_instruction}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'printing') {
    return (
      <div
        className="bg-purple-50 border-l-4 border-purple-500 p-5 rounded-r-xl shadow-sm"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <svg
            className="w-6 h-6 text-purple-600 shrink-0 mt-0.5 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <div>
            <h5 className="text-sm font-bold text-purple-900">{status_label}</h5>
            <p className="text-sm text-purple-800 mt-1">{status_explanation}</p>
            <div className="mt-3 bg-purple-100/70 border border-purple-200 rounded-md p-2.5 text-xs text-purple-900 font-medium">
              👉 <span className="font-semibold">Next Step:</span> {next_step_instruction}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'failed' || status === 'cancelled') {
    return (
      <div
        className="bg-red-50 border-l-4 border-red-500 p-5 rounded-r-xl shadow-sm"
        role="alert"
        aria-live="assertive"
      >
        <div className="flex items-start gap-3">
          <svg
            className="w-6 h-6 text-red-600 shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
          <div>
            <h5 className="text-sm font-bold text-red-900">{status_label}</h5>
            <p className="text-sm text-red-800 mt-1">{status_explanation}</p>
            <div className="mt-3 bg-red-100/70 border border-red-200 rounded-md p-2.5 text-xs text-red-900 font-medium">
              👉 <span className="font-semibold">Next Step:</span> {next_step_instruction}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default submitted / queued / approved
  return (
    <div
      className="bg-blue-50 border-l-4 border-blue-500 p-5 rounded-r-xl shadow-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <svg
          className="w-6 h-6 text-blue-600 shrink-0 mt-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <div>
          <h5 className="text-sm font-bold text-blue-900">{status_label}</h5>
          <p className="text-sm text-blue-800 mt-1">{status_explanation}</p>
          <div className="mt-3 bg-blue-100/70 border border-blue-200 rounded-md p-2.5 text-xs text-blue-900 font-medium">
            👉 <span className="font-semibold">Next Step:</span> {next_step_instruction}
          </div>
        </div>
      </div>
    </div>
  );
};
