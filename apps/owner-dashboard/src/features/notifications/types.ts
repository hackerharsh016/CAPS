/**
 * Owner Notification and Push Permission Domain Types for CAPS Owner Dashboard.
 * Aligned with CAPS SRS UC-3, Section 4.5 & Master Implementation Plan Phase 6 (P06-M03-F02).
 */

export type PushPermissionStatus =
  | 'default' // Not yet requested, promptable
  | 'granted' // Allowed by shop owner
  | 'denied' // Blocked by shop owner or browser policy
  | 'unsupported'; // Browser does not support Notification/PushManager API

export interface PushSubscriptionMetadata {
  endpoint: string;
  p256dh: string;
  auth: string;
  registeredAt: string;
  expiresAt?: string | undefined;
}

export type OwnerNotificationType =
  | 'urgent_job_arrived'
  | 'printer_jam_detected'
  | 'printer_offline'
  | 'paper_out'
  | 'daily_summary'
  | 'system';

export interface InAppNotification {
  id: string;
  title: string;
  body: string;
  type: OwnerNotificationType;
  read: boolean;
  timestamp: string;
  jobId?: string | undefined;
  printerId?: string | undefined;
}

export interface OwnerNotificationPreferences {
  pushEnabled: boolean;
  urgentQueueAlerts: boolean;
  hardwareJamAlerts: boolean;
  dailySummaryReports: boolean;
  soundAlerts: boolean;
}

export interface PushRegistrationResult {
  success: boolean;
  permission: PushPermissionStatus;
  subscription?: PushSubscriptionMetadata | undefined;
  error?: string | undefined;
}
