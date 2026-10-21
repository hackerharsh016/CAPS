/**
 * Pricing & Shop Settings validation utilities for CAPS Owner Dashboard.
 * Aligned with database constraints in 20261019000001_create_users_and_shops.sql
 * and Master Plan §5.4.
 */

import type { PricingConfig, UrgentSurchargeConfig, PricingFormErrors, PaperPriceTable } from './types';

export const MAX_PAGE_PRICE_PAISE = 50000; // ₹500 max per page
export const MAX_BINDING_PRICE_PAISE = 50000; // ₹500 max per binding

function validatePaperTable(
  paper: PaperPriceTable,
  prefix: 'A4' | 'A3' | 'Legal',
  errors: PricingFormErrors
): void {
  const fields: Array<keyof PaperPriceTable> = [
    'bw_single_paise',
    'bw_double_paise',
    'color_single_paise',
    'color_double_paise'
  ];

  for (const field of fields) {
    const value = paper[field];
    const key = `${prefix}.${field.replace('_paise', '')}` as keyof PricingFormErrors;

    if (value === undefined || value === null || Number.isNaN(value)) {
      errors[key] = 'Price is required.';
    } else if (!Number.isInteger(value)) {
      errors[key] = 'Price must be in whole paise.';
    } else if (value < 0) {
      errors[key] = 'Price cannot be negative.';
    } else if (value > MAX_PAGE_PRICE_PAISE) {
      errors[key] = `Price cannot exceed ₹${MAX_PAGE_PRICE_PAISE / 100}.`;
    }
  }

  // Cross-field validation: double-sided price should be at least single-sided price
  if (paper.bw_double_paise < paper.bw_single_paise) {
    errors[`${prefix}.bw_double` as keyof PricingFormErrors] =
      'Double-sided price cannot be less than single-sided.';
  }
  if (paper.color_double_paise < paper.color_single_paise) {
    errors[`${prefix}.color_double` as keyof PricingFormErrors] =
      'Double-sided color price cannot be less than single-sided.';
  }
}

export function validatePricingConfig(config: PricingConfig): {
  isValid: boolean;
  errors: PricingFormErrors;
} {
  const errors: PricingFormErrors = {};

  if (!config) {
    return { isValid: false, errors: { general: 'Pricing configuration is required.' } };
  }

  // Validate paper tables
  if (config.A4) validatePaperTable(config.A4, 'A4', errors);
  else errors['A4.bw_single'] = 'A4 pricing is required.';

  if (config.A3) validatePaperTable(config.A3, 'A3', errors);
  else errors['A3.bw_single'] = 'A3 pricing is required.';

  if (config.Legal) validatePaperTable(config.Legal, 'Legal', errors);
  else errors['Legal.bw_single'] = 'Legal pricing is required.';

  // Validate binding prices
  if (config.binding_prices_paise) {
    const bindings = ['spiral', 'staple', 'lamination'] as const;
    for (const b of bindings) {
      const price = config.binding_prices_paise[b];
      const key = `binding.${b}` as keyof PricingFormErrors;
      if (price === undefined || price === null || Number.isNaN(price)) {
        errors[key] = 'Binding price is required.';
      } else if (!Number.isInteger(price)) {
        errors[key] = 'Binding price must be whole paise.';
      } else if (price < 0) {
        errors[key] = 'Binding price cannot be negative.';
      } else if (price > MAX_BINDING_PRICE_PAISE) {
        errors[key] = `Binding price cannot exceed ₹${MAX_BINDING_PRICE_PAISE / 100}.`;
      }
    }
  }

  // Validate GST percentage
  if (config.gst_percentage === undefined || Number.isNaN(config.gst_percentage)) {
    errors.gst_percentage = 'GST percentage is required.';
  } else if (config.gst_percentage < 0 || config.gst_percentage > 100) {
    errors.gst_percentage = 'GST must be between 0% and 100%.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

export function validateUrgentConfig(config: UrgentSurchargeConfig): {
  isValid: boolean;
  errors: PricingFormErrors;
} {
  const errors: PricingFormErrors = {};

  if (!config) {
    return { isValid: false, errors: { general: 'Urgent configuration is required.' } };
  }

  if (config.amount === undefined || Number.isNaN(config.amount)) {
    errors['urgent.amount'] = 'Urgent surcharge amount is required.';
  } else if (!Number.isInteger(config.amount)) {
    errors['urgent.amount'] = 'Amount must be a whole number.';
  } else if (config.amount < 0) {
    errors['urgent.amount'] = 'Amount cannot be negative.';
  } else if (config.type === 'percentage' && config.amount > 10000) {
    errors['urgent.amount'] = 'Percentage surcharge cannot exceed 100% (10000 bps).';
  }

  if (config.max_urgent_jobs_per_hour !== undefined) {
    if (config.max_urgent_jobs_per_hour < 1 || config.max_urgent_jobs_per_hour > 100) {
      errors['urgent.max_jobs'] = 'Max urgent jobs per hour must be between 1 and 100.';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

export function validateShopProfile(name: string, address: string): {
  isValid: boolean;
  errors: PricingFormErrors;
} {
  const errors: PricingFormErrors = {};

  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length < 2) {
    errors.shop_name = 'Shop name must be at least 2 characters.';
  } else if (trimmedName.length > 100) {
    errors.shop_name = 'Shop name cannot exceed 100 characters.';
  }

  const trimmedAddress = address.trim();
  if (!trimmedAddress || trimmedAddress.length < 5) {
    errors.shop_address = 'Address must be at least 5 characters.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}
