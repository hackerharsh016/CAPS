'use client';

import React from 'react';
import type { JobTrackingInfo } from '../types';

interface DocumentPrivacyNoticeProps {
  tracking: JobTrackingInfo;
}

export const DocumentPrivacyNotice: React.FC<DocumentPrivacyNoticeProps> = ({ tracking }) => {
  const getRemainingHours = (expiresAt: string) => {
    try {
      const diffMs = new Date(expiresAt).getTime() - Date.now();
      if (diffMs <= 0) return 'Expired';
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      return `${hours}h ${mins}m`;
    } catch {
      return '24h';
    }
  };

  const remaining = getRemainingHours(tracking.document_expires_at);

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <svg
          className="w-4 h-4 text-slate-500 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          />
        </svg>
        <div>
          <span className="font-semibold text-slate-800">
            CAPS Zero-Knowledge Privacy Guarantee:
          </span>{' '}
          {tracking.document_deleted ? (
            <span>Document file has been permanently deleted from storage.</span>
          ) : (
            <span>
              Uploaded document file will be automatically purged 24 hours after submission.
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-1.5 font-medium text-slate-700 bg-white border border-slate-200 rounded px-2.5 py-1">
        <span className="text-[11px] text-slate-400 uppercase">Retention:</span>
        <span className={tracking.document_deleted ? 'text-slate-500' : 'text-blue-600'}>
          {tracking.document_deleted ? 'Purged' : `${remaining} left`}
        </span>
      </div>
    </div>
  );
};
