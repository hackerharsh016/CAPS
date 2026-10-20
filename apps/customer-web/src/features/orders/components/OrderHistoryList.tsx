'use client';

/**
 * Accessible Order History List component for CAPS Customer Web.
 * Provides customer-scoped order querying, status filtering, pagination, and empty states.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../auth/auth-context';
import type { CustomerOrder, OrderFilterStatus } from '../types';
import { defaultOrdersService } from '../orders-service';
import { OrderCard } from './OrderCard';

export function OrderHistoryList() {
  const { user } = useAuth();

  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [filter, setFilter] = useState<OrderFilterStatus>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    if (!user?.id) return;
    setIsLoading(true);
    setError(null);

    try {
      const response = await defaultOrdersService.getCustomerOrders({
        customerId: user.id,
        page,
        limit: 5,
        filter
      });

      setOrders(response.orders);
      setTotalPages(response.totalPages);
      setTotalCount(response.totalCount);
    } catch (err) {
      console.error('Failed to load order history:', err);
      setError('Unable to load your orders. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, page, filter]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handleFilterChange = (newFilter: OrderFilterStatus) => {
    setFilter(newFilter);
    setPage(1); // Reset to page 1 on filter change
  };

  return (
    <div className="w-full space-y-6">
      {/* Page Title & Subtitle */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            My Print Orders
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Track active print jobs, view completion receipts, and monitor document privacy.
          </p>
        </div>
        <a
          href="/shops"
          className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
        >
          + New Print Order
        </a>
      </div>

      {/* Filter Tabs */}
      <div
        role="tablist"
        aria-label="Filter orders by status"
        className="flex flex-wrap gap-2 border-b border-slate-200 pb-3"
      >
        {(
          [
            { id: 'all', label: 'All Orders' },
            { id: 'active', label: 'In Progress / Queue' },
            { id: 'completed', label: 'Completed' },
            { id: 'cancelled', label: 'Cancelled / Failed' }
          ] as const
        ).map(tab => (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={filter === tab.id}
            onClick={() => handleFilterChange(tab.id)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
              filter === tab.id
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error Banner */}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-200"
        >
          <span>{error}</span>
          <button
            onClick={loadOrders}
            className="rounded font-semibold text-red-800 underline hover:no-underline ml-4"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading ? (
        <div role="status" aria-live="polite" className="space-y-4">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="h-44 w-full animate-pulse rounded-xl border border-slate-200 bg-slate-50 p-5"
            />
          ))}
          <span className="sr-only">Loading your order history...</span>
        </div>
      ) : orders.length === 0 ? (
        /* Empty State */
        <div
          role="region"
          aria-label="No orders found"
          className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-2xl text-blue-600">
            🖨️
          </div>
          <h3 className="mt-4 text-lg font-semibold text-slate-900">No print orders found</h3>
          <p className="mt-2 text-sm text-slate-600 max-w-md mx-auto">
            {filter === 'all'
              ? "You haven't placed any print orders yet. Browse nearby xerox shops and place your first print order online."
              : `No orders match the selected "${filter}" status filter.`}
          </p>
          <div className="mt-6">
            <a
              href="/shops"
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              Discover Photocopy Shops
            </a>
          </div>
        </div>
      ) : (
        /* Orders List */
        <div className="space-y-4" role="feed" aria-label="Order list">
          {orders.map(order => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}

      {/* Pagination Controls */}
      {!isLoading && totalPages > 1 && (
        <nav
          aria-label="Order history pagination"
          className="flex items-center justify-between border-t border-slate-200 pt-4"
        >
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            ← Previous
          </button>

          <p className="text-xs text-slate-600 font-medium">
            Page <span className="font-bold text-slate-900">{page}</span> of{' '}
            <span className="font-bold text-slate-900">{totalPages}</span> ({totalCount} total
            orders)
          </p>

          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Next →
          </button>
        </nav>
      )}
    </div>
  );
}
