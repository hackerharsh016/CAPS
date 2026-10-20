/**
 * Profile service for updating customer details and loading statistics.
 */

import type { ProfileStats, ProfileUpdateInput } from './types';
import { validateName, validatePhone, normalizePhone } from '../auth/validation';
import type { CustomerOrder } from '../orders/types';
import { defaultOrdersService } from '../orders/orders-service';

export class ProfileService {
  /**
   * Validates profile update inputs and returns field errors or null.
   */
  public validateProfileInput(input: ProfileUpdateInput): {
    name?: string | undefined;
    phone?: string | undefined;
  } | null {
    const nameErr = validateName(input.name);
    const phoneErr = validatePhone(input.phone);

    if (nameErr || phoneErr) {
      const errors: { name?: string | undefined; phone?: string | undefined } = {};
      if (nameErr) errors.name = nameErr;
      if (phoneErr) errors.phone = phoneErr;
      return errors;
    }
    return null;
  }

  /**
   * Computes customer stats from order history.
   */
  public async getCustomerStats(customerId: string, createdAt: string): Promise<ProfileStats> {
    const ordersRes = await defaultOrdersService.getCustomerOrders({
      customerId,
      page: 1,
      limit: 100,
      filter: 'all'
    });

    const orders: CustomerOrder[] = ordersRes.orders;
    const completed = orders.filter(o => o.status === 'completed');
    const totalSpent = completed.reduce((sum, o) => sum + o.amount_paise, 0);

    return {
      totalOrders: orders.length,
      completedOrders: completed.length,
      totalSpentPaise: totalSpent,
      memberSince: new Date(createdAt || Date.now()).toLocaleDateString('en-IN', {
        month: 'short',
        year: 'numeric'
      })
    };
  }

  /**
   * Sanitizes and normalizes phone prior to persistence.
   */
  public normalizeInput(input: ProfileUpdateInput): ProfileUpdateInput {
    const res: ProfileUpdateInput = {
      name: input.name.trim(),
      phone: normalizePhone(input.phone)
    };
    if (input.preferredNotification !== undefined) {
      res.preferredNotification = input.preferredNotification;
    }
    return res;
  }
}

export const defaultProfileService = new ProfileService();
