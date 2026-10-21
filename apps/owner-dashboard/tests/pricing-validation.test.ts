import { describe, it, expect } from 'vitest';
import {
  validatePricingConfig,
  validateUrgentConfig,
  validateShopProfile,
  MAX_PAGE_PRICE_PAISE,
  MAX_BINDING_PRICE_PAISE
} from '../src/features/pricing-management/validation';
import type { PricingConfig, UrgentSurchargeConfig } from '../src/features/pricing-management/types';

describe('Pricing & Shop Settings Validation', () => {
  const validPricingConfig: PricingConfig = {
    A4: {
      bw_single_paise: 200,
      bw_double_paise: 300,
      color_single_paise: 1000,
      color_double_paise: 1800
    },
    A3: {
      bw_single_paise: 400,
      bw_double_paise: 600,
      color_single_paise: 2000,
      color_double_paise: 3600
    },
    Legal: {
      bw_single_paise: 250,
      bw_double_paise: 350,
      color_single_paise: 1200,
      color_double_paise: 2000
    },
    binding_prices_paise: {
      none: 0,
      spiral: 4000,
      staple: 500,
      lamination: 2000
    },
    gst_percentage: 18
  };

  const validUrgentConfig: UrgentSurchargeConfig = {
    type: 'flat',
    amount: 2000,
    max_urgent_jobs_per_hour: 5
  };

  describe('validatePricingConfig', () => {
    it('accepts valid standard pricing configuration', () => {
      const result = validatePricingConfig(validPricingConfig);
      expect(result.isValid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });

    it('rejects negative per-page prices', () => {
      const invalid = JSON.parse(JSON.stringify(validPricingConfig)) as PricingConfig;
      invalid.A4.bw_single_paise = -50;

      const result = validatePricingConfig(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors['A4.bw_single']).toBe('Price cannot be negative.');
    });

    it('rejects non-integer paise values', () => {
      const invalid = JSON.parse(JSON.stringify(validPricingConfig)) as PricingConfig;
      invalid.A4.bw_single_paise = 200.75;

      const result = validatePricingConfig(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors['A4.bw_single']).toBe('Price must be in whole paise.');
    });

    it('rejects prices exceeding max allowable threshold', () => {
      const invalid = JSON.parse(JSON.stringify(validPricingConfig)) as PricingConfig;
      invalid.A4.color_single_paise = MAX_PAGE_PRICE_PAISE + 100;

      const result = validatePricingConfig(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors['A4.color_single']).toContain('Price cannot exceed');
    });

    it('rejects double-sided price cheaper than single-sided', () => {
      const invalid = JSON.parse(JSON.stringify(validPricingConfig)) as PricingConfig;
      invalid.A4.bw_single_paise = 400;
      invalid.A4.bw_double_paise = 200; // invalid

      const result = validatePricingConfig(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors['A4.bw_double']).toBe(
        'Double-sided price cannot be less than single-sided.'
      );
    });

    it('rejects negative or excessive binding prices', () => {
      const invalid = JSON.parse(JSON.stringify(validPricingConfig)) as PricingConfig;
      invalid.binding_prices_paise.spiral = -100;

      const result = validatePricingConfig(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors['binding.spiral']).toBe('Binding price cannot be negative.');

      invalid.binding_prices_paise.spiral = MAX_BINDING_PRICE_PAISE + 1000;
      const result2 = validatePricingConfig(invalid);
      expect(result2.isValid).toBe(false);
      expect(result2.errors['binding.spiral']).toContain('Binding price cannot exceed');
    });

    it('rejects GST outside [0, 100]', () => {
      const invalid = JSON.parse(JSON.stringify(validPricingConfig)) as PricingConfig;
      invalid.gst_percentage = -5;
      expect(validatePricingConfig(invalid).isValid).toBe(false);

      invalid.gst_percentage = 105;
      expect(validatePricingConfig(invalid).isValid).toBe(false);
    });
  });

  describe('validateUrgentConfig', () => {
    it('accepts valid urgent flat surcharge', () => {
      const result = validateUrgentConfig(validUrgentConfig);
      expect(result.isValid).toBe(true);
    });

    it('accepts valid urgent percentage surcharge', () => {
      const result = validateUrgentConfig({
        type: 'percentage',
        amount: 2500, // 25%
        max_urgent_jobs_per_hour: 10
      });
      expect(result.isValid).toBe(true);
    });

    it('rejects negative amount or percentage exceeding 100%', () => {
      expect(
        validateUrgentConfig({
          type: 'flat',
          amount: -500
        }).isValid
      ).toBe(false);

      expect(
        validateUrgentConfig({
          type: 'percentage',
          amount: 15000 // 150%
        }).isValid
      ).toBe(false);
    });

    it('rejects invalid hourly caps', () => {
      expect(
        validateUrgentConfig({
          type: 'flat',
          amount: 2000,
          max_urgent_jobs_per_hour: 0
        }).isValid
      ).toBe(false);

      expect(
        validateUrgentConfig({
          type: 'flat',
          amount: 2000,
          max_urgent_jobs_per_hour: 105
        }).isValid
      ).toBe(false);
    });
  });

  describe('validateShopProfile', () => {
    it('accepts valid shop name and address', () => {
      const result = validateShopProfile(
        'Campus Xerox Corner',
        '12 North Campus Road, Metro Gate 2'
      );
      expect(result.isValid).toBe(true);
    });

    it('rejects shop name too short or empty', () => {
      expect(validateShopProfile('', '12 North Campus Road').isValid).toBe(false);
      expect(validateShopProfile('A', '12 North Campus Road').isValid).toBe(false);
    });

    it('rejects address too short', () => {
      expect(validateShopProfile('Campus Xerox', 'Shop').isValid).toBe(false);
    });
  });
});
