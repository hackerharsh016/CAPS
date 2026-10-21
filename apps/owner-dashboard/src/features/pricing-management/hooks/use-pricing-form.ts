'use client';

/**
 * Custom Hook for Pricing & Shop Settings Form state management.
 * Provides dirty checking, real-time validation, saving, and rollback.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Shop } from '../../shop-management/types';
import type { PricingFormData, PricingFormErrors, PaperSize, BindingType } from '../types';
import { validatePricingConfig, validateUrgentConfig, validateShopProfile } from '../validation';

export function usePricingForm(
  activeShop: Shop | null,
  onSave?: (updates: Partial<Shop>) => Promise<Shop>
) {
  const initialFormData = useMemo<PricingFormData | null>(() => {
    if (!activeShop) return null;
    return {
      pricing_config: JSON.parse(JSON.stringify(activeShop.pricing_config)),
      urgent_surcharge_config: JSON.parse(JSON.stringify(activeShop.urgent_surcharge_config)),
      auto_print_enabled: activeShop.auto_print_enabled,
      pay_at_counter_enabled: activeShop.pay_at_counter_enabled ?? false,
      status: activeShop.status,
      name: activeShop.name,
      address: activeShop.address
    };
  }, [activeShop]);

  const [formData, setFormData] = useState<PricingFormData | null>(initialFormData);
  const [errors, setErrors] = useState<PricingFormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Sync form data if active shop changes and not dirty
  useEffect(() => {
    setFormData(initialFormData);
    setErrors({});
    setSaveSuccess(false);
    setServerError(null);
  }, [initialFormData]);

  const isDirty = useMemo(() => {
    if (!formData || !initialFormData) return false;
    return JSON.stringify(formData) !== JSON.stringify(initialFormData);
  }, [formData, initialFormData]);

  // Setters for paper price table
  const setPaperPrice = useCallback(
    (
      size: PaperSize,
      field: 'bw_single_paise' | 'bw_double_paise' | 'color_single_paise' | 'color_double_paise',
      value: number
    ) => {
      setFormData(prev => {
        if (!prev) return prev;
        const currentPaper = prev.pricing_config[size];
        return {
          ...prev,
          pricing_config: {
            ...prev.pricing_config,
            [size]: {
              ...currentPaper,
              [field]: value
            }
          }
        };
      });
      setSaveSuccess(false);
    },
    []
  );

  // Setters for binding prices
  const setBindingPrice = useCallback((binding: BindingType, value: number) => {
    setFormData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        pricing_config: {
          ...prev.pricing_config,
          binding_prices_paise: {
            ...prev.pricing_config.binding_prices_paise,
            [binding]: value
          }
        }
      };
    });
    setSaveSuccess(false);
  }, []);

  // Setter for GST percentage
  const setGstPercentage = useCallback((percentage: number) => {
    setFormData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        pricing_config: {
          ...prev.pricing_config,
          gst_percentage: percentage
        }
      };
    });
    setSaveSuccess(false);
  }, []);

  // Setter for Urgent Surcharge
  const setUrgentConfig = useCallback(
    (
      updates: Partial<{
        type: 'flat' | 'percentage';
        amount: number;
        max_urgent_jobs_per_hour: number;
      }>
    ) => {
      setFormData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          urgent_surcharge_config: {
            ...prev.urgent_surcharge_config,
            ...updates
          }
        };
      });
      setSaveSuccess(false);
    },
    []
  );

  // Setter for operational toggles
  const setAutoPrint = useCallback((enabled: boolean) => {
    setFormData(prev => (prev ? { ...prev, auto_print_enabled: enabled } : prev));
    setSaveSuccess(false);
  }, []);

  const setPayAtCounter = useCallback((enabled: boolean) => {
    setFormData(prev => (prev ? { ...prev, pay_at_counter_enabled: enabled } : prev));
    setSaveSuccess(false);
  }, []);

  const setShopStatus = useCallback((status: 'open' | 'closed') => {
    setFormData(prev => (prev ? { ...prev, status } : prev));
    setSaveSuccess(false);
  }, []);

  const setShopName = useCallback((name: string) => {
    setFormData(prev => (prev ? { ...prev, name } : prev));
    setSaveSuccess(false);
  }, []);

  const setShopAddress = useCallback((address: string) => {
    setFormData(prev => (prev ? { ...prev, address } : prev));
    setSaveSuccess(false);
  }, []);

  // Reset / Rollback
  const resetForm = useCallback(() => {
    setFormData(initialFormData);
    setErrors({});
    setServerError(null);
    setSaveSuccess(false);
  }, [initialFormData]);

  // Submit / Save
  const saveChanges = useCallback(async (): Promise<boolean> => {
    if (!formData || !onSave) return false;

    setServerError(null);
    setSaveSuccess(false);

    // Validate
    const pricingRes = validatePricingConfig(formData.pricing_config);
    const urgentRes = validateUrgentConfig(formData.urgent_surcharge_config);
    const profileRes = validateShopProfile(formData.name, formData.address);

    const mergedErrors: PricingFormErrors = {
      ...pricingRes.errors,
      ...urgentRes.errors,
      ...profileRes.errors
    };

    if (Object.keys(mergedErrors).length > 0) {
      setErrors(mergedErrors);
      return false;
    }

    setErrors({});
    setIsSaving(true);

    try {
      await onSave({
        pricing_config: formData.pricing_config,
        urgent_surcharge_config: formData.urgent_surcharge_config,
        auto_print_enabled: formData.auto_print_enabled,
        pay_at_counter_enabled: formData.pay_at_counter_enabled,
        status: formData.status,
        name: formData.name,
        address: formData.address
      });

      setIsSaving(false);
      setSaveSuccess(true);
      return true;
    } catch (err) {
      setIsSaving(false);
      const msg = err instanceof Error ? err.message : 'Failed to save configuration.';
      setServerError(msg);
      return false;
    }
  }, [formData, onSave]);

  return {
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
  };
}
