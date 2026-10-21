'use client';

/**
 * useOwnerNotifications Hook for CAPS Owner Dashboard.
 * Encapsulates:
 * - Current push permission status detection
 * - Opt-in request handling and Web Push subscription
 * - Opt-out teardown
 * - Stale token detection & cleanup
 * - In-app notification queue, unread counters, and mark-as-read actions
 * - Owner notification preferences
 */

import { useState, useCallback, useEffect } from 'react';
import { defaultOwnerPushService } from '../owner-push-service';
import type {
  PushPermissionStatus,
  PushSubscriptionMetadata,
  InAppNotification,
  OwnerNotificationPreferences
} from '../types';

export interface UseOwnerNotificationsOptions {
  ownerUserId?: string | undefined;
}

export interface UseOwnerNotificationsReturn {
  permission: PushPermissionStatus;
  isSupported: boolean;
  subscription: PushSubscriptionMetadata | null;
  isLoading: boolean;
  error: string | null;
  notifications: InAppNotification[];
  unreadCount: number;
  preferences: OwnerNotificationPreferences;
  requestPushPermission: () => Promise<boolean>;
  enablePush: () => Promise<boolean>;
  disablePush: () => Promise<boolean>;
  updatePreferences: (prefs: Partial<OwnerNotificationPreferences>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearNotifications: () => void;
  addNotification: (notif: Omit<InAppNotification, 'id' | 'timestamp' | 'read'>) => InAppNotification;
}

export function useOwnerNotifications({
  ownerUserId
}: UseOwnerNotificationsOptions = {}): UseOwnerNotificationsReturn {
  const [permission, setPermission] = useState<PushPermissionStatus>('default');
  const [isSupported, setIsSupported] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscriptionMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [preferences, setPreferences] = useState<OwnerNotificationPreferences>(
    defaultOwnerPushService.getPreferences()
  );

  const refreshState = useCallback(() => {
    const supported = defaultOwnerPushService.isPushSupported();
    setIsSupported(supported);
    const perm = defaultOwnerPushService.getPermissionStatus();
    setPermission(perm);

    if (ownerUserId) {
      const sub = defaultOwnerPushService.getActiveSubscription(ownerUserId);
      setSubscription(sub);
    } else {
      setSubscription(null);
    }

    setNotifications(defaultOwnerPushService.getInAppNotifications());
    setPreferences(defaultOwnerPushService.getPreferences());
  }, [ownerUserId]);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  const requestPushPermission = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await defaultOwnerPushService.requestPermission();
      setPermission(res);
      return res === 'granted';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to request notification permission.';
      setError(msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const enablePush = useCallback(async (): Promise<boolean> => {
    if (!ownerUserId) {
      setError('Owner must be authenticated to enable push notifications.');
      return false;
    }

    setIsLoading(true);
    setError(null);
    try {
      const result = await defaultOwnerPushService.subscribeToPush(ownerUserId);
      setPermission(result.permission);

      if (result.success && result.subscription) {
        setSubscription(result.subscription);
        const updated = defaultOwnerPushService.savePreferences({ pushEnabled: true });
        setPreferences(updated);
        return true;
      } else {
        setError(result.error || 'Failed to enable push notifications.');
        return false;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error enabling push notifications.';
      setError(msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [ownerUserId]);

  const disablePush = useCallback(async (): Promise<boolean> => {
    if (!ownerUserId) return true;

    setIsLoading(true);
    setError(null);
    try {
      await defaultOwnerPushService.unsubscribeFromPush(ownerUserId);
      setSubscription(null);
      const updated = defaultOwnerPushService.savePreferences({ pushEnabled: false });
      setPreferences(updated);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error disabling push notifications.';
      setError(msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [ownerUserId]);

  const updatePreferences = useCallback(
    (prefs: Partial<OwnerNotificationPreferences>) => {
      const updated = defaultOwnerPushService.savePreferences(prefs);
      setPreferences(updated);
    },
    []
  );

  const markAsRead = useCallback((id: string) => {
    defaultOwnerPushService.markNotificationAsRead(id);
    setNotifications(defaultOwnerPushService.getInAppNotifications());
  }, []);

  const markAllAsRead = useCallback(() => {
    defaultOwnerPushService.markAllAsRead();
    setNotifications(defaultOwnerPushService.getInAppNotifications());
  }, []);

  const clearNotifications = useCallback(() => {
    defaultOwnerPushService.clearAllNotifications();
    setNotifications([]);
  }, []);

  const addNotification = useCallback(
    (notif: Omit<InAppNotification, 'id' | 'timestamp' | 'read'>) => {
      const item = defaultOwnerPushService.addInAppNotification(notif);
      setNotifications(defaultOwnerPushService.getInAppNotifications());
      return item;
    },
    []
  );

  const unreadCount = notifications.filter(n => !n.read).length;

  return {
    permission,
    isSupported,
    subscription,
    isLoading,
    error,
    notifications,
    unreadCount,
    preferences,
    requestPushPermission,
    enablePush,
    disablePush,
    updatePreferences,
    markAsRead,
    markAllAsRead,
    clearNotifications,
    addNotification
  };
}
