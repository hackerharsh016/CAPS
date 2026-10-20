/**
 * Customer Profile types for CAPS Customer Web.
 */

export interface ProfileUpdateInput {
  name: string;
  phone: string;
  preferredNotification?: 'sms' | 'whatsapp' | 'email' | undefined;
}

export interface ProfileStats {
  totalOrders: number;
  completedOrders: number;
  totalSpentPaise: number;
  memberSince: string;
}
