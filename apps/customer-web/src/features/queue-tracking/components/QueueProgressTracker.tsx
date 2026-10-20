'use client';

import React from 'react';
import type { DisplayJobStatus } from '../types';

interface QueueProgressTrackerProps {
  status: DisplayJobStatus;
  isAgentOffline?: boolean | undefined;
}

interface Step {
  id: string;
  name: string;
  description: string;
}

const STEPS: Step[] = [
  { id: 'submitted', name: 'Submitted', description: 'Order received' },
  { id: 'queued', name: 'In Queue', description: 'Queued at shop' },
  { id: 'printing', name: 'Printing', description: 'On printer hardware' },
  { id: 'ready', name: 'Ready', description: 'Ready for pickup' }
];

export const QueueProgressTracker: React.FC<QueueProgressTrackerProps> = ({
  status,
  isAgentOffline = false
}) => {
  const getStepIndex = (st: DisplayJobStatus): number => {
    switch (st) {
      case 'submitted':
      case 'pending_payment':
        return 0;
      case 'queued':
      case 'approved':
        return 1;
      case 'claimed':
      case 'printing':
        return 2;
      case 'ready':
        return 3;
      default:
        return 1;
    }
  };

  const isTerminalFailure = status === 'failed' || status === 'cancelled';
  const isUnknownOrOffline = status === 'unknown' || isAgentOffline;
  const currentStepIndex = getStepIndex(status);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h4 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">
          Order Progress
        </h4>

        {isTerminalFailure ? (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
            {status === 'failed' ? 'Failed' : 'Cancelled'}
          </span>
        ) : isUnknownOrOffline ? (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
            {isAgentOffline ? 'Station Offline' : 'Status Ambiguous'}
          </span>
        ) : status === 'ready' ? (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
            Ready for Pickup
          </span>
        ) : (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
            In Progress
          </span>
        )}
      </div>

      {/* Responsive Step Progress Tracker */}
      <div className="relative">
        {/* Connecting Progress Bar */}
        <div className="hidden sm:block absolute top-5 left-6 right-6 h-1 bg-slate-200 -z-0">
          <div
            className={`h-full transition-all duration-500 ${
              isTerminalFailure
                ? 'bg-red-500'
                : isUnknownOrOffline
                ? 'bg-amber-400'
                : 'bg-blue-600'
            }`}
            style={{
              width: isTerminalFailure
                ? '50%'
                : `${(Math.min(currentStepIndex, 3) / 3) * 100}%`
            }}
          />
        </div>

        <ol className="grid grid-cols-1 sm:grid-cols-4 gap-4 sm:gap-2 relative z-10">
          {STEPS.map((step, idx) => {
            const isCompleted = !isTerminalFailure && currentStepIndex > idx;
            const isCurrent = !isTerminalFailure && currentStepIndex === idx;

            return (
              <li key={step.id} className="flex sm:flex-col items-center sm:items-center gap-3 sm:gap-2 text-left sm:text-center">
                {/* Step Circle */}
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 border-2 transition-colors ${
                    isCompleted
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : isCurrent
                      ? isUnknownOrOffline
                        ? 'bg-amber-500 border-amber-600 text-white ring-4 ring-amber-100'
                        : 'bg-white border-blue-600 text-blue-600 ring-4 ring-blue-100 animate-pulse'
                      : isTerminalFailure && currentStepIndex === idx
                      ? 'bg-red-600 border-red-600 text-white'
                      : 'bg-white border-slate-300 text-slate-400'
                  }`}
                >
                  {isCompleted ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </div>

                {/* Step Text */}
                <div>
                  <p
                    className={`text-sm font-semibold ${
                      isCurrent
                        ? isUnknownOrOffline
                          ? 'text-amber-800'
                          : 'text-blue-700'
                        : isCompleted
                        ? 'text-slate-900'
                        : 'text-slate-500'
                    }`}
                  >
                    {step.name}
                  </p>
                  <p className="text-xs text-slate-500">{step.description}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
};
