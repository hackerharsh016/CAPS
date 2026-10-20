'use client';

/**
 * usePushNotifications Hook for CAPS Customer Web.
 * Connects Web Push permissions, token state, in-app notification queue,
 * and network online/offline disconnect detection.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  PushPermissionStatus,
  InAppNotification,
  PushSubscriptionMetadata
} from './types';
import { defaultPushService } from './push-service';
import { useAuth } from '../auth/auth-context';

export function usePushNotifications() {
  const { session } = useAuth();
  const customerId = session?.user?.id || 'usr-current-session';

  const [permission, setPermission] = useState<PushPermissionStatus>('default');
  const [subscription, setSubscription] = useState<PushSubscriptionMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);

  // Sync online/offline state
  useEffect(() => {
    if (typeof window === 'undefined') return;

    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Sync initial permission and subscription status
  const refreshStatus = useCallback(() => {
    const currentPerm = defaultPushService.getPermissionStatus();
    setPermission(currentPerm);

    if (customerId) {
      const activeSub = defaultPushService.getActiveSubscription(customerId);
      setSubscription(activeSub);
    }

    setNotifications(defaultPushService.getInAppNotifications());
  }, [customerId]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const requestPermissionAndSubscribe = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await defaultPushService.subscribeToPush(customerId);
      setPermission(result.permission);

      if (result.success && result.subscription) {
        setSubscription(result.subscription);
        // Add sample welcome in-app notification
        defaultPushService.addInAppNotification({
          title: 'Push Notifications Enabled',
          body: 'You will now receive instant alerts when your print orders change status or are ready for pickup.',
          type: 'system'
        });
        setNotifications(defaultPushService.getInAppNotifications());
        return true;
      } else {
        setError(result.error || 'Failed to enable push notifications.');
        return false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Subscription error';
      setError(msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [customerId]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      await defaultPushService.unsubscribeFromPush(customerId);
      setSubscription(null);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to unsubscribe';
      setError(msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [customerId]);

  const markAsRead = useCallback((id: string) => {
    defaultPushService.markNotificationAsRead(id);
    setNotifications(defaultPushService.getInAppNotifications());
  }, []);

  const clearAll = useCallback(() => {
    defaultPushService.clearAllNotifications();
    setNotifications([]);
  }, []);

  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !n.read).length;
  }, [notifications]);

  return {
    permission,
    isSubscribed: !!subscription,
    subscription,
    isLoading,
    isOnline,
    error,
    notifications,
    unreadCount,
    requestPermissionAndSubscribe,
    unsubscribe,
    markAsRead,
    clearAll,
    refreshStatus
  };
}
