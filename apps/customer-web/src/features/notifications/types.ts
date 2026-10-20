/**
 * Notifications and Push Permission domain types for CAPS Customer Web.
 * Conforms to CAPS SRS Section 4.5 & Master Implementation Plan Phase 6.
 */

export type PushPermissionStatus =
  | 'default' // Not yet requested, promptable
  | 'granted' // Allowed by customer
  | 'denied' // Blocked by customer or browser policy
  | 'unsupported'; // Browser does not support PushManager/Notification API

export interface PushSubscriptionMetadata {
  endpoint: string;
  p256dh: string;
  auth: string;
  registeredAt: string;
  expiresAt?: string | undefined;
}

export type NotificationType =
  | 'order_confirmed'
  | 'agent_printing'
  | 'order_ready_for_pickup'
  | 'print_failed'
  | 'system';

export interface InAppNotification {
  id: string;
  title: string;
  body: string;
  type: NotificationType;
  read: boolean;
  timestamp: string;
  orderId?: string | undefined;
  tokenNumber?: string | undefined;
}

export interface NotificationPreferences {
  pushEnabled: boolean;
  orderUpdates: boolean;
  pickupAlerts: boolean;
  soundEnabled: boolean;
}

export interface PushRegistrationResult {
  success: boolean;
  permission: PushPermissionStatus;
  subscription?: PushSubscriptionMetadata | undefined;
  error?: string | undefined;
}
