'use client';

/**
 * Owner Dashboard Queue Table Component (INT-D2-01).
 * Displays print jobs with PostgreSQL canonical status badges and filter tabs
 * supporting all 7 states: SUBMITTED, OWNER_CONFIRMED, QUEUED, PRINTING, COMPLETED, FAILED, CANCELLED.
 */

import React, { useState, useMemo, useCallback } from 'react';
import type { QueueItem, QueueFilter } from '../../types/queue';
import { CANONICAL_JOB_STATUSES, JOB_STATUS_CONFIG } from '../../types/queue';
import type { QueueService } from '../../services/api/queue.service';

export interface QueueTableProps {
  shopId?: string | undefined;
  initialItems?: QueueItem[] | undefined;
  queueService?: QueueService | undefined;
  onApprove?: ((jobId: string) => Promise<void> | void) | undefined;
  onRefresh?: (() => Promise<void> | void) | undefined;
  filter?: QueueFilter | undefined;
  onFilterChange?: ((filter: QueueFilter) => void) | undefined;
  isLoading?: boolean | undefined;
  className?: string | undefined;
}

export function QueueTable({
  shopId,
  initialItems = [],
  queueService,
  onApprove,
  onRefresh,
  filter: controlledFilter,
  onFilterChange,
  isLoading = false,
  className = ''
}: QueueTableProps) {
  const [internalFilter, setInternalFilter] = useState<QueueFilter>('ALL');
  const activeFilter = controlledFilter ?? internalFilter;

  const [items, setItems] = useState<QueueItem[]>(initialItems);
  const [approvingJobId, setApprovingJobId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Sync state if initialItems changes
  React.useEffect(() => {
    if (initialItems) {
      setItems(initialItems);
    }
  }, [initialItems]);

  // Compute status counts for all 7 canonical states plus ALL
  const counts = useMemo(() => {
    const map: Record<QueueFilter, number> = {
      ALL: items.length,
      SUBMITTED: 0,
      OWNER_CONFIRMED: 0,
      QUEUED: 0,
      PRINTING: 0,
      COMPLETED: 0,
      FAILED: 0,
      CANCELLED: 0
    };

    for (const item of items) {
      if (item.status in map) {
        map[item.status]++;
      }
    }

    return map;
  }, [items]);

  // Filter items according to activeFilter
  const filteredItems = useMemo(() => {
    if (activeFilter === 'ALL') {
      return items;
    }
    return items.filter(item => item.status === activeFilter);
  }, [items, activeFilter]);

  // Handle filter change
  const handleFilterClick = useCallback(
    (newFilter: QueueFilter) => {
      if (onFilterChange) {
        onFilterChange(newFilter);
      } else {
        setInternalFilter(newFilter);
      }
    },
    [onFilterChange]
  );

  // Handle job approval
  const handleApprove = useCallback(
    async (jobId: string) => {
      setApprovingJobId(jobId);
      setActionError(null);

      try {
        if (onApprove) {
          await onApprove(jobId);
        } else if (queueService && shopId) {
          const res = await queueService.approveJob(shopId, jobId);
          if (res.success) {
            setItems(prev => prev.map(item => (item.id === jobId ? res.job : item)));
          }
        } else {
          // Optimistic local update to OWNER_CONFIRMED
          setItems(prev =>
            prev.map(item => (item.id === jobId ? { ...item, status: 'OWNER_CONFIRMED' } : item))
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to approve job';
        setActionError(msg);
      } finally {
        setApprovingJobId(null);
      }
    },
    [onApprove, queueService, shopId]
  );

  const filterTabs: { id: QueueFilter; label: string }[] = useMemo(
    () => [
      { id: 'ALL', label: 'All Jobs' },
      ...CANONICAL_JOB_STATUSES.map(status => ({
        id: status as QueueFilter,
        label: JOB_STATUS_CONFIG[status].label
      }))
    ],
    []
  );

  return (
    <div
      className={`space-y-4 bg-white rounded-xl shadow-sm border border-slate-200 p-6 ${className}`}
    >
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Print Queue Management</h2>
          <p className="text-sm text-slate-500">
            Realtime shop order queue with canonical PostgreSQL lifecycle synchronization.
          </p>
        </div>

        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="self-start sm:self-auto px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-50"
            data-testid="refresh-queue-btn"
          >
            {isLoading ? 'Refreshing...' : '🔄 Refresh Queue'}
          </button>
        )}
      </div>

      {actionError && (
        <div
          role="alert"
          className="p-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg"
        >
          {actionError}
        </div>
      )}

      {/* Filter Tabs across all 7 canonical states + ALL */}
      <div
        role="tablist"
        aria-label="Queue status filters"
        className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-3"
      >
        {filterTabs.map(tab => {
          const isActive = activeFilter === tab.id;
          const count = counts[tab.id] ?? 0;

          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => handleFilterClick(tab.id)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                isActive
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
              }`}
              data-testid={`filter-tab-${tab.id.toLowerCase()}`}
            >
              <span>{tab.label}</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  isActive ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Queue Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-600" data-testid="queue-table">
          <thead className="text-xs uppercase bg-slate-50 text-slate-700 border-b border-slate-200">
            <tr>
              <th scope="col" className="px-4 py-3">
                Queue # / Token
              </th>
              <th scope="col" className="px-4 py-3">
                Customer
              </th>
              <th scope="col" className="px-4 py-3">
                Document & Settings
              </th>
              <th scope="col" className="px-4 py-3">
                Priority
              </th>
              <th scope="col" className="px-4 py-3">
                Status
              </th>
              <th scope="col" className="px-4 py-3">
                Price
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Loading queue data...
                </td>
              </tr>
            ) : filteredItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  No jobs found matching the &quot;{activeFilter}&quot; status filter.
                </td>
              </tr>
            ) : (
              filteredItems.map(item => {
                const config = JOB_STATUS_CONFIG[item.status] || {
                  status: item.status,
                  label: item.status,
                  badgeClass: 'bg-slate-100 text-slate-800 border-slate-200',
                  description: item.status,
                  canApprove: false
                };
                const isApproving = approvingJobId === item.id;
                const shortToken =
                  item.id.length > 8 ? `#${item.id.slice(-6).toUpperCase()}` : `#${item.id}`;

                return (
                  <tr
                    key={item.id}
                    className="hover:bg-slate-50/80 transition"
                    data-testid={`queue-row-${item.id}`}
                  >
                    {/* Token */}
                    <td className="px-4 py-3.5 font-mono text-xs font-bold text-slate-900">
                      <div>{shortToken}</div>
                      <div className="text-[10px] text-slate-400 font-normal">
                        Pos #{item.queue_position}
                      </div>
                    </td>

                    {/* Customer */}
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-slate-900 text-xs">{item.customer_name}</div>
                      {item.customer_phone && (
                        <div className="text-[11px] text-slate-400 font-mono">
                          {item.customer_phone}
                        </div>
                      )}
                    </td>

                    {/* Document & Settings */}
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-slate-800 text-xs truncate max-w-xs">
                        📄 {item.document_name || 'Document.pdf'}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {item.settings.paper_size} • {item.settings.color_mode.toUpperCase()} •{' '}
                        {item.settings.sides === 'double' ? 'Duplex' : 'Simplex'} •{' '}
                        {item.settings.copies} {item.settings.copies === 1 ? 'copy' : 'copies'}
                      </div>
                    </td>

                    {/* Priority */}
                    <td className="px-4 py-3.5">
                      {item.priority_tier === 'urgent' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                          ⚡ Urgent
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                          Flexible
                        </span>
                      )}
                    </td>

                    {/* Status Badge */}
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${config.badgeClass}`}
                        data-testid="status-badge"
                        data-status={item.status}
                        title={config.description}
                      >
                        {config.label}
                      </span>
                    </td>

                    {/* Price */}
                    <td className="px-4 py-3.5 font-mono text-xs font-semibold text-slate-900">
                      ₹{(item.price_total_paise / 100).toFixed(2)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5 text-right">
                      {config.canApprove ? (
                        <button
                          type="button"
                          onClick={() => handleApprove(item.id)}
                          disabled={isApproving}
                          className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-300 disabled:opacity-50"
                          data-testid={`approve-btn-${item.id}`}
                        >
                          {isApproving ? 'Approving...' : 'Confirm & Print'}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400 italic">No action</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default QueueTable;
