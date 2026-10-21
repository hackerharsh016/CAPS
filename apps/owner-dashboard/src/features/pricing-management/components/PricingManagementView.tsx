'use client';

/**
 * Pricing & Shop Configuration Management View for CAPS Owner Dashboard.
 * Integrates per-page rates, binding, urgent priority fees, and shop operational toggles.
 */

import React from 'react';
import { useShop } from '../../shop-management/shop-context';
import { usePricingForm } from '../hooks/use-pricing-form';
import { PaperPricingTable } from './PaperPricingTable';
import { BindingPricingForm } from './BindingPricingForm';
import { UrgentConfigForm } from './UrgentConfigForm';
import { ShopSettingsForm } from './ShopSettingsForm';

export interface PricingManagementViewProps {
  showSettingsOnly?: boolean | undefined;
}

export function PricingManagementView({ showSettingsOnly = false }: PricingManagementViewProps) {
  const { activeShop, isLoading: isShopLoading, updateActiveShop } = useShop();

  const {
    formData,
    errors,
    isDirty,
    isSaving,
    saveSuccess,
    serverError,
    setPaperPrice,
    setBindingPrice,
    setGstPercentage,
    setUrgentConfig,
    setAutoPrint,
    setPayAtCounter,
    setShopStatus,
    setShopName,
    setShopAddress,
    resetForm,
    saveChanges
  } = usePricingForm(activeShop, updateActiveShop);

  if (isShopLoading || !formData) {
    return (
      <div
        className="flex min-h-[50vh] flex-col items-center justify-center space-y-4"
        role="status"
        aria-label="Loading pricing settings"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
        <p className="text-sm font-medium text-slate-600">Loading shop configuration...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {showSettingsOnly ? 'Shop Operations & Settings' : 'Service Catalog & Pricing'}
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Active Shop: <strong className="text-slate-800">{activeShop?.name}</strong> •{' '}
            {activeShop?.address}
          </p>
        </div>

        {/* Action Controls */}
        <div className="mt-4 sm:mt-0 flex items-center space-x-3">
          {isDirty && (
            <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
              Unsaved changes
            </span>
          )}
          <button
            type="button"
            disabled={!isDirty || isSaving}
            onClick={resetForm}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Discard
          </button>
          <button
            type="button"
            disabled={!isDirty || isSaving}
            onClick={() => saveChanges()}
            className="flex items-center space-x-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving && (
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}
            <span>{isSaving ? 'Saving...' : 'Save Configuration'}</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {saveSuccess && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-medium text-emerald-800 shadow-sm"
        >
          ✓ Configuration updated and synchronized successfully.
        </div>
      )}

      {serverError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800 shadow-sm flex items-center space-x-2"
        >
          <svg className="h-4 w-4 text-rose-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{serverError}</span>
        </div>
      )}

      {/* Forms Content */}
      <div className="space-y-8">
        {!showSettingsOnly && (
          <>
            <PaperPricingTable
              config={formData.pricing_config}
              errors={errors}
              onChange={setPaperPrice}
              disabled={isSaving}
            />

            <BindingPricingForm
              config={formData.pricing_config}
              errors={errors}
              onBindingChange={setBindingPrice}
              onGstChange={setGstPercentage}
              disabled={isSaving}
            />

            <UrgentConfigForm
              config={formData.urgent_surcharge_config}
              errors={errors}
              onChange={setUrgentConfig}
              disabled={isSaving}
            />
          </>
        )}

        <ShopSettingsForm
          name={formData.name}
          address={formData.address}
          status={formData.status}
          autoPrintEnabled={formData.auto_print_enabled}
          payAtCounterEnabled={formData.pay_at_counter_enabled}
          errors={errors}
          onNameChange={setShopName}
          onAddressChange={setShopAddress}
          onStatusChange={setShopStatus}
          onAutoPrintChange={setAutoPrint}
          onPayAtCounterChange={setPayAtCounter}
          disabled={isSaving}
        />
      </div>
    </div>
  );
}
