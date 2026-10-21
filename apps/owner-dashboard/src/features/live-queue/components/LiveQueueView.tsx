'use client';

/**
 * Live Queue View Component for CAPS Owner Dashboard.
 * Master live queue container with two-tier prioritization, metrics,
 * realtime connection indicators, and accessible controls.
 */

import React from 'react';
import { useLiveQueue } from '../hooks/use-live-queue';
import { QueueMetricsHeader } from './QueueMetricsHeader';
import { QueueFilterTabs } from './QueueFilterTabs';
import { QueueItemCard } from './QueueItemCard';
import { ConnectionStateBadge } from './ConnectionStateBadge';

export interface LiveQueueViewProps {
  onConfirmPrint?: (jobId: string) => void;
}

export function LiveQueueView({ onConfirmPrint }: LiveQueueViewProps) {
  const {
    queue,
    metrics,
    filter,
    setFilter,
    connectionState,
    isLoading,
    error,
    refreshQueue
  } = useLiveQueue();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      {/* Top Metrics Cards */}
      <QueueMetricsHeader metrics={metrics} />

      {/* Main Queue Container */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Queue Header with Title & Realtime Badge */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 px-6 py-4 gap-3 bg-white">
          <div>
            <div className="flex items-center space-x-3">
              <h2 className="text-lg font-bold text-slate-900">Live FIFO Print Queue</h2>
              <ConnectionStateBadge state={connectionState} />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Orders ordered by Urgent priority first, then submission timestamp. Single-click
              confirms execution.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => refreshQueue()}
              disabled={isLoading}
              className="inline-flex items-center space-x-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              <svg
                className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="px-6 bg-slate-50/50">
          <QueueFilterTabs
            currentFilter={filter}
            onFilterChange={setFilter}
            metrics={metrics}
          />
        </div>

        {/* Queue List Content */}
        <div className="p-6">
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800"
            >
              {error}
            </div>
          )}

          {isLoading ? (
            <div
              className="space-y-4 py-8"
              role="status"
              aria-label="Loading print queue"
            >
              {[1, 2, 3].map(i => (
                <div
                  key={i}
                  className="h-28 animate-pulse rounded-xl border border-slate-200 bg-slate-50"
                />
              ))}
            </div>
          ) : queue.length === 0 ? (
            <div className="py-12 text-center" role="status">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                📄
              </div>
              <h3 className="mt-3 text-sm font-bold text-slate-900">
                No jobs currently waiting in queue
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {filter === 'all'
                  ? 'Incoming paid and pay-at-counter orders will appear here automatically in real time.'
                  : `No jobs matching filter "${filter}". Try selecting "All Jobs".`}
              </p>
            </div>
          ) : (
            <div className="space-y-4" role="list" aria-label="Print queue jobs list">
              {queue.map(item => (
                <div key={item.id} role="listitem">
                  <QueueItemCard item={item} onConfirmPrint={onConfirmPrint} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
