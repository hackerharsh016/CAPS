import { describe, it, expect, beforeEach } from 'vitest';
import { PushService } from '../../src/features/notifications/push-service';
import type { PushSubscriptionMetadata } from '../../src/features/notifications/types';

describe('Push Notifications & Status Service (P06-M03-F02-CUSTOMER)', () => {
  let service: PushService;
  const customerId = 'usr-customer-alpha';

  beforeEach(() => {
    service = new PushService();
    service.setSupportedForTesting(true);
    service.setPermissionForTesting('default');
  });

  describe('Permission Status and Querying', () => {
    it('detects when Web Push is supported in the browser', () => {
      expect(service.isPushSupported()).toBe(true);
      expect(service.getPermissionStatus()).toBe('default');
    });

    it('returns unsupported when push is not supported in client environment', () => {
      service.setSupportedForTesting(false);
      expect(service.isPushSupported()).toBe(false);
      expect(service.getPermissionStatus()).toBe('unsupported');
    });
  });

  describe('Happy Path: Subscription & Unsubscription Lifecycle', () => {
    it('requests permission and registers push subscription token when granted', async () => {
      service.setPermissionForTesting('granted');

      const res = await service.subscribeToPush(customerId);

      expect(res.success).toBe(true);
      expect(res.permission).toBe('granted');
      expect(res.subscription).toBeDefined();
      expect(res.subscription?.endpoint).toContain(customerId);
      expect(res.subscription?.p256dh).toBeDefined();
      expect(res.subscription?.auth).toBeDefined();

      // Check active subscription retrieval
      const active = service.getActiveSubscription(customerId);
      expect(active).not.toBeNull();
      expect(active?.endpoint).toBe(res.subscription?.endpoint);
    });

    it('successfully tears down push subscription upon unsubscribe', async () => {
      service.setPermissionForTesting('granted');
      await service.subscribeToPush(customerId);
      expect(service.getActiveSubscription(customerId)).not.toBeNull();

      const unsubResult = await service.unsubscribeFromPush(customerId);
      expect(unsubResult).toBe(true);
      expect(service.getActiveSubscription(customerId)).toBeNull();
    });
  });

  describe('Permission Denied Handling', () => {
    it('handles permission denial gracefully without creating orphan subscriptions', async () => {
      service.setPermissionForTesting('denied');

      const res = await service.subscribeToPush(customerId);

      expect(res.success).toBe(false);
      expect(res.permission).toBe('denied');
      expect(res.error).toContain('denied by the user');
      expect(service.getActiveSubscription(customerId)).toBeNull();
    });

    it('rejects subscription when customerId is missing', async () => {
      const res = await service.subscribeToPush('');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Customer ID is required');
    });
  });

  describe('Stale Token Detection and Recovery', () => {
    it('detects expired tokens and automatically cleans them up', async () => {
      service.setPermissionForTesting('granted');
      await service.subscribeToPush(customerId);

      // Force expire subscription
      service.forceExpireSubscription(customerId);

      // Active subscription fetch should detect expiration and tear down
      const active = service.getActiveSubscription(customerId);
      expect(active).toBeNull();
    });

    it('detects corrupted or missing token keys as stale', () => {
      const corrupted: PushSubscriptionMetadata = {
        endpoint: '',
        p256dh: '',
        auth: '',
        registeredAt: new Date().toISOString()
      };

      expect(service.isSubscriptionStale(corrupted)).toBe(true);
    });
  });

  describe('In-App Notification Queue (Fallback for Denied / Disabled Push)', () => {
    it('queues, reads, and clears in-app notifications', () => {
      expect(service.getInAppNotifications().length).toBe(0);

      const item1 = service.addInAppNotification({
        title: 'Order Queued',
        body: 'Your token T-042 is queued at Campus Xerox.',
        type: 'order_confirmed'
      });

      const item2 = service.addInAppNotification({
        title: 'Ready for Pickup',
        body: 'Your order is printed and ready at the counter.',
        type: 'order_ready_for_pickup'
      });

      let list = service.getInAppNotifications();
      expect(list.length).toBe(2);
      expect(item1.id).toBeDefined();
      expect(list[0]?.id).toBe(item2.id); // Latest first
      expect(list[0]?.read).toBe(false);

      // Mark as read
      service.markNotificationAsRead(item2.id);
      list = service.getInAppNotifications();
      expect(list[0]?.read).toBe(true);
      expect(list[1]?.read).toBe(false);

      // Clear all
      service.clearAllNotifications();
      expect(service.getInAppNotifications().length).toBe(0);
    });
  });
});
