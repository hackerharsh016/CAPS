import { describe, it, expect } from 'vitest';
import { ProfileService, defaultProfileService } from '../../src/features/profile/profile-service';
import type { ProfileUpdateInput } from '../../src/features/profile/types';

describe('Customer Profile Service', () => {
  it('validates correct profile inputs', () => {
    const input: ProfileUpdateInput = {
      name: 'Priya Sharma',
      phone: '9876543210',
      preferredNotification: 'whatsapp'
    };
    const errors = defaultProfileService.validateProfileInput(input);
    expect(errors).toBeNull();
  });

  it('rejects short or empty names', () => {
    const input: ProfileUpdateInput = {
      name: 'A',
      phone: '9876543210'
    };
    const errors = defaultProfileService.validateProfileInput(input);
    expect(errors?.name).toBe('Name must be at least 2 characters.');
  });

  it('rejects invalid mobile numbers', () => {
    const input: ProfileUpdateInput = {
      name: 'Priya Sharma',
      phone: '12345'
    };
    const errors = defaultProfileService.validateProfileInput(input);
    expect(errors?.phone).toContain('valid 10-digit mobile number');
  });

  it('normalizes mobile numbers with +91 country code', () => {
    const input: ProfileUpdateInput = {
      name: 'Priya Sharma',
      phone: '9876543210',
      preferredNotification: 'sms'
    };
    const normalized = defaultProfileService.normalizeInput(input);
    expect(normalized.phone).toBe('+919876543210');
  });

  it('calculates customer activity stats from order history', async () => {
    const service = new ProfileService();
    // Test with sample customer ID
    const stats = await service.getCustomerStats('usr-customer-alpha', '2026-01-15T00:00:00Z');

    expect(stats.totalOrders).toBeGreaterThan(0);
    expect(stats.completedOrders).toBeGreaterThanOrEqual(0);
    expect(stats.totalSpentPaise).toBeGreaterThanOrEqual(0);
    expect(stats.memberSince).toBeDefined();
  });
});
