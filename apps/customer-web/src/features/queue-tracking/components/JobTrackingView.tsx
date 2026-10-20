'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { JobTrackingInfo } from '../types';
import { TokenCard } from './TokenCard';
import { QueueProgressTracker } from './QueueProgressTracker';
import { QueueMetricsCard } from './QueueMetricsCard';
import { StatusExplanationBanner } from './StatusExplanationBanner';
import { DocumentPrivacyNotice } from './DocumentPrivacyNotice';
import { JobDetailsCard } from './JobDetailsCard';

interface JobTrackingViewProps {
  initialTracking: JobTrackingInfo;
  onRefresh?: (() => Promise<void>) | undefined;
}

export const JobTrackingView: React.FC<JobTrackingViewProps> = ({
  initialTracking,
  onRefresh
}) => {
  const [tracking, setTracking] = useState<JobTrackingInfo>(initialTracking);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  React.useEffect(() => {
    setTracking(initialTracking);
  }, [initialTracking]);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      if (onRefresh) {
        await onRefresh();
      }
      setLastRefreshedAt(new Date());
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/orders"
              className="text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors inline-flex items-center gap-1"
            >
              ← Back to My Orders
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Live Queue & Job Status</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Realtime printer status and counter pickup token
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Agent Heartbeat Status Pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white border border-slate-200 shadow-sm">
            <span
              className={`w-2 h-2 rounded-full ${
                tracking.is_agent_offline
                  ? 'bg-amber-500 animate-pulse'
                  : 'bg-emerald-500 animate-pulse'
              }`}
            />
            <span className="text-slate-600">
              {tracking.is_agent_offline ? 'Station Offline' : 'Station Connected'}
            </span>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm"
            aria-label="Refresh job status"
          >
            <svg
              className={`w-3.5 h-3.5 text-slate-500 ${isRefreshing ? 'animate-spin' : ''}`}
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
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* 1. Prominent Customer Token Card */}
      <TokenCard tracking={tracking} />

      {/* 2. Visual Queue & Job Progress Steps */}
      <QueueProgressTracker status={tracking.status} isAgentOffline={tracking.is_agent_offline} />

      {/* 3. Status Explanation & Next-Step Guidance Banner */}
      <StatusExplanationBanner tracking={tracking} />

      {/* 4. Queue Metrics (Tier, Position, ETA) */}
      <QueueMetricsCard tracking={tracking} />

      {/* 5. 24h Document Privacy & Auto-Delete Banner */}
      <DocumentPrivacyNotice tracking={tracking} />

      {/* 6. Order Specifications & Details */}
      <JobDetailsCard tracking={tracking} />

      {/* Footer Navigation Actions */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-200">
        <span className="text-[11px] text-slate-400">
          Last updated: {lastRefreshedAt.toLocaleTimeString()}
        </span>

        <div className="flex items-center gap-3">
          <Link
            href="/orders"
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
          >
            View All Orders
          </Link>

          <Link
            href="/print/new"
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors shadow-sm"
          >
            Print Another Document
          </Link>
        </div>
      </div>
    </div>
  );
};
