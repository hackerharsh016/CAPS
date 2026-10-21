'use client';

/**
 * Queue Filter Tabs Component for CAPS Owner Dashboard.
 * Accessible tablist for filtering jobs by priority tier, execution state, or issues/requires_review.
 */

import React from 'react';
import type { QueueFilter, QueueSummaryMetrics } from '../types';

export interface QueueFilterTabsProps {
  currentFilter: QueueFilter;
  onFilterChange: (filter: QueueFilter) => void;
  metrics: QueueSummaryMetrics;
}

export function QueueFilterTabs({ currentFilter, onFilterChange, metrics }: QueueFilterTabsProps) {
  const tabs: Array<{ id: QueueFilter; label: string; count: number; alert?: boolean }> = [
    { id: 'all', label: 'All Jobs', count: metrics.pendingCount + metrics.executingCount },
    { id: 'urgent', label: 'Urgent Priority', count: metrics.urgentCount },
    { id: 'flexible', label: 'Flexible FIFO', count: metrics.flexibleCount },
    { id: 'executing', label: 'Currently Printing', count: metrics.executingCount },
    {
      id: 'requires_review',
      label: 'Needs Review / Issues',
      count: metrics.requiresReviewCount ?? 0,
      alert: (metrics.requiresReviewCount ?? 0) > 0
    }
  ];

  return (
    <div
      className="flex border-b border-slate-200"
      role="tablist"
      aria-label="Queue priority filters"
    >
      {tabs.map(tab => {
        const isActive = currentFilter === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onFilterChange(tab.id)}
            className={`flex items-center space-x-2 border-b-2 px-4 py-3 text-xs font-semibold transition-colors ${
              isActive
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                tab.alert
                  ? 'bg-rose-100 text-rose-800 animate-pulse'
                  : isActive
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-100 text-slate-600'
              }`}
            >
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
