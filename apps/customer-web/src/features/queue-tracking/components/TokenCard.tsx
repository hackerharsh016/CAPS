'use client';

import React, { useState } from 'react';
import type { JobTrackingInfo } from '../types';

interface TokenCardProps {
  tracking: JobTrackingInfo;
}

export const TokenCard: React.FC<TokenCardProps> = ({ tracking }) => {
  const [copied, setCopied] = useState(false);

  const handleCopyToken = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(tracking.token_number);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isUrgent = tracking.priority_tier === 'urgent';

  return (
    <div className="bg-white border-2 border-slate-200 rounded-2xl p-4 sm:p-6 shadow-xs relative overflow-hidden">
      {/* Priority Ribbon */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3 mb-4">
        <div>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Pickup Counter Token
          </span>
          <h3 className="text-sm font-medium text-slate-700">{tracking.shop_name}</h3>
        </div>

        <span
          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold shrink-0 ${
            isUrgent
              ? 'bg-amber-100 text-amber-800 border border-amber-200'
              : 'bg-blue-50 text-blue-700 border border-blue-200'
          }`}
        >
          {isUrgent ? '⚡ Express Priority' : 'Standard Economy'}
        </span>
      </div>

      {/* Prominent Token Display */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5">
        <div>
          <span className="text-xs font-medium text-slate-500">Your Token Number</span>
          <div className="text-3xl xs:text-4xl sm:text-5xl font-black font-mono tracking-tight text-slate-900 mt-1">
            {tracking.token_number}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Show this number at the counter to collect your prints.
          </p>
        </div>

        <div className="flex sm:flex-col items-stretch sm:items-end justify-between gap-2">
          <button
            type="button"
            onClick={handleCopyToken}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs"
            aria-label="Copy token number"
          >
            {copied ? (
              <>
                <svg
                  className="w-4 h-4 text-emerald-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span className="text-emerald-700 font-medium">Copied!</span>
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4 text-slate-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                <span>Copy Token</span>
              </>
            )}
          </button>

          <span className="text-[11px] text-slate-400 font-mono">
            Job #{tracking.job_id.slice(-8)}
          </span>
        </div>
      </div>
    </div>
  );
};
