'use client';

/**
 * Accessible Shop Filters and Search component for CAPS Customer Web.
 * Enables live capability filtering, text search, sorting, and filter resets.
 */

import React from 'react';
import type { ShopFilterOptions } from '../types';

export interface ShopFiltersProps {
  filters: ShopFilterOptions;
  onChange: (updated: ShopFilterOptions) => void;
  onReset: () => void;
  hasActiveFilters: boolean;
}

export function ShopFilters({
  filters,
  onChange,
  onReset,
  hasActiveFilters
}: ShopFiltersProps) {
  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...filters, searchQuery: e.target.value, page: 1 });
  };

  const handleToggle = (key: keyof ShopFilterOptions) => {
    onChange({ ...filters, [key]: !filters[key], page: 1 });
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({
      ...filters,
      sortBy: e.target.value as ShopFilterOptions['sortBy'],
      page: 1
    });
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      {/* Search Input Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <label htmlFor="shop-search" className="sr-only">
            Search shops by name, campus, or location
          </label>
          <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
            🔍
          </span>
          <input
            id="shop-search"
            name="search"
            type="search"
            value={filters.searchQuery || ''}
            onChange={handleTextChange}
            placeholder="Search by shop name, campus block, or area..."
            className="block w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-4 text-sm shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>

        {/* Sort Selector */}
        <div className="sm:w-48">
          <label htmlFor="shop-sort" className="sr-only">
            Sort shops by
          </label>
          <select
            id="shop-sort"
            value={filters.sortBy || (filters.userCoordinates ? 'distance' : 'rating')}
            onChange={handleSortChange}
            className="block w-full rounded-xl border border-slate-300 py-2.5 px-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
          >
            {filters.userCoordinates && <option value="distance">Nearest Distance</option>}
            <option value="rating">Highest Rated</option>
            <option value="name">Shop Name (A-Z)</option>
          </select>
        </div>
      </div>

      {/* Filter Chips Bar */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
        <span className="text-xs font-semibold text-slate-500 mr-1">Filter by:</span>

        {/* Open Now Chip */}
        <button
          type="button"
          role="checkbox"
          aria-checked={!!filters.openOnly}
          onClick={() => handleToggle('openOnly')}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            filters.openOnly
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          ● Open Now
        </button>

        {/* Color Print Chip */}
        <button
          type="button"
          role="checkbox"
          aria-checked={!!filters.supportsColor}
          onClick={() => handleToggle('supportsColor')}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            filters.supportsColor
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          🎨 Color Print
        </button>

        {/* Duplex Chip */}
        <button
          type="button"
          role="checkbox"
          aria-checked={!!filters.supportsDuplex}
          onClick={() => handleToggle('supportsDuplex')}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            filters.supportsDuplex
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          📄 2-Sided (Duplex)
        </button>

        {/* A3 Paper Chip */}
        <button
          type="button"
          role="checkbox"
          aria-checked={!!filters.supportsA3}
          onClick={() => handleToggle('supportsA3')}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            filters.supportsA3
              ? 'bg-purple-600 text-white shadow-sm'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          📐 A3 Paper
        </button>

        {/* Spiral Binding Chip */}
        <button
          type="button"
          role="checkbox"
          aria-checked={!!filters.supportsSpiral}
          onClick={() => handleToggle('supportsSpiral')}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            filters.supportsSpiral
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          🌀 Spiral Binding
        </button>

        {/* Urgent Queue Chip */}
        <button
          type="button"
          role="checkbox"
          aria-checked={!!filters.supportsUrgent}
          onClick={() => handleToggle('supportsUrgent')}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            filters.supportsUrgent
              ? 'bg-amber-600 text-white shadow-sm'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          ⚡ Urgent Priority
        </button>

        {/* Reset Filters */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs font-semibold text-red-600 hover:text-red-700 underline ml-auto"
          >
            Clear all filters
          </button>
        )}
      </div>
    </div>
  );
}
