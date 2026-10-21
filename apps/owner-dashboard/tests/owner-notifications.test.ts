import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  OwnerPushService
} from '../src/features/notifications/owner-push-service';

const mockGetSession = vi.fn();

vi.mock('../src/lib/supabase', () => ({
  getSupabaseEnv: () => ({
    supabaseUrl: 'https://mock.supabase.co',
    supabaseAnonKey: 'mock-anon-key'
  }),
  getSupabaseBrowserClient: () => ({
    getSession: () => mockGetSession()
  })
}));

describe('Owner Push Notifications & Permission Lifecycle (P06-M03-F02-OWNER)', () => {
  const ownerId = '00000000-0000-0000-0000-000000000001';
  let service: OwnerPushService;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetSession.mockResolvedValue({
      access_token: 'mock-owner-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: {
        id: ownerId,
        email: 'owner@campusprint.in',
        created_at: new Date().toISOString()
      }
    });

    mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({})
    } as Response));

    service = new OwnerPushService({
      customFetch: mockFetch as unknown as typeof fetch
    });
  });

  describe('Permission Lifecycle & Status Detection', () => {
    it('returns unsupported status when browser lacks Web Push capabilities', () => {
      service.setSupportedForTesting(false);
      expect(service.isPushSupported()).toBe(false);
      expect(service.getPermissionStatus()).toBe('unsupported');
    });

    it('returns default status when permission has not yet been requested', () => {
      service.setSupportedForTesting(true);
      service.setPermissionForTesting('default');
      expect(service.isPushSupported()).toBe(true);
      expect(service.getPermissionStatus()).toBe('default');
    });

    it('returns granted when owner accepts browser prompt', async () => {
      service.setSupportedForTesting(true);
      service.setPermissionForTesting('granted');
      const perm = await service.requestPermission();
      expect(perm).toBe('granted');
      expect(service.getPermissionStatus()).toBe('granted');
    });

    it('handles permission denied gracefully and returns denied status', async () => {
      service.setSupportedForTesting(true);
      service.setPermissionForTesting('denied');
      const perm = await service.requestPermission();
      expect(perm).toBe('denied');
      expect(service.getPermissionStatus()).toBe('denied');
    });
  });

  describe('Device Token Registration & Database Sync', () => {
    it('subscribes owner device and synchronizes token to user_fcm_tokens table', async () => {
      service.setSupportedForTesting(true);
      service.setPermissionForTesting('granted');

      const result = await service.subscribeToPush(ownerId);
      expect(result.success).toBe(true);
      expect(result.permission).toBe('granted');
      expect(result.subscription).toBeDefined();
      expect(result.subscription?.endpoint).toContain(`caps-owner-${ownerId}`);
      expect(result.subscription?.p256dh).toBeDefined();
      expect(result.subscription?.auth).toBeDefined();

      // Verified database sync POST call to /rest/v1/user_fcm_tokens
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/rest/v1/user_fcm_tokens'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining(ownerId)
        })
      );
    });

    it('fails subscription if owner user ID is missing', async () => {
      service.setSupportedForTesting(true);
      service.setPermissionForTesting('granted');

      const result = await service.subscribeToPush('');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Owner user ID is required');
    });

    it('fails subscription if browser permission was denied', async () => {
      service.setSupportedForTesting(true);
      service.setPermissionForTesting('denied');

      const result = await service.subscribeToPush(ownerId);
      expect(result.success).toBe(false);
      expect(result.permission).toBe('denied');
      expect(result.error).toContain('denied');
    });
  });

  describe('Token Teardown & Deactivation', () => {
    it('unsubscribes owner device, removes local cache, and deactivates token in database', async () => {
      service.setSupportedForTesting(true);
      service.setPermissionForTesting('granted');

      // First subscribe
      const reg = await service.subscribeToPush(ownerId);
      expect(reg.success).toBe(true);
      expect(service.getActiveSubscription(ownerId)).not.toBeNull();

      // Unsubscribe
      const unsub = await service.unsubscribeFromPush(ownerId);
      expect(unsub).toBe(true);
      expect(service.getActiveSubscription(ownerId)).toBeNull();

      // Verified PATCH call deactivating the token in user_fcm_tokens
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/rest/v1/user_fcm_tokens'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ is_active: false })
        })
      );
    });
  });

  describe('Stale Token Detection & Auto-Cleanup', () => {
    it('detects expired subscription tokens and automatically tears them down', async () => {
      service.setSupportedForTesting(true);
      service.setPermissionForTesting('granted');

      await service.subscribeToPush(ownerId);
      expect(service.getActiveSubscription(ownerId)).not.toBeNull();

      // Force token expiration
      service.forceExpireSubscription(ownerId);

      // Retrieval of stale subscription cleans it up and returns null
      const sub = service.getActiveSubscription(ownerId);
      expect(sub).toBeNull();
    });

    it('identifies corrupted subscription missing keys as stale', () => {
      const corrupted = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test',
        p256dh: '',
        auth: '',
        registeredAt: new Date().toISOString()
      };

      expect(service.isSubscriptionStale(corrupted)).toBe(true);
    });
  });

  describe('In-App Fallback Notifications Queue', () => {
    it('adds and retrieves in-app notifications for queue and hardware events', () => {
      service.clearAllNotifications();

      const notif1 = service.addInAppNotification({
        title: '⚡ Urgent Job Arrived',
        body: 'Job #JOB-1055 enqueued with Urgent priority tier (+₹50).',
        type: 'urgent_job_arrived',
        jobId: 'job-1055'
      });

      const notif2 = service.addInAppNotification({
        title: '⚠️ Paper Jam Detected',
        body: 'Printer Canon IR2625 reported jam in Tray 1.',
        type: 'printer_jam_detected',
        printerId: 'printer-1'
      });

      const list = service.getInAppNotifications();
      expect(list).toHaveLength(2);
      expect(list[0]?.id).toBe(notif2.id); // Most recent first
      expect(list[1]?.id).toBe(notif1.id);
      expect(list[0]?.read).toBe(false);
    });

    it('marks individual notifications as read', () => {
      service.clearAllNotifications();
      const notif = service.addInAppNotification({
        title: 'Alert',
        body: 'Test alert',
        type: 'system'
      });

      service.markNotificationAsRead(notif.id);
      const list = service.getInAppNotifications();
      expect(list[0]?.read).toBe(true);
    });

    it('marks all notifications as read and clears queue', () => {
      service.clearAllNotifications();
      service.addInAppNotification({ title: '1', body: '1', type: 'system' });
      service.addInAppNotification({ title: '2', body: '2', type: 'system' });

      service.markAllAsRead();
      const list = service.getInAppNotifications();
      expect(list.every(n => n.read)).toBe(true);

      service.clearAllNotifications();
      expect(service.getInAppNotifications()).toHaveLength(0);
    });
  });

  describe('Owner Notification Preferences', () => {
    it('saves and updates notification toggle preferences', () => {
      const initial = service.getPreferences();
      expect(initial.urgentQueueAlerts).toBe(true);

      const updated = service.savePreferences({
        urgentQueueAlerts: false,
        soundAlerts: true
      });

      expect(updated.urgentQueueAlerts).toBe(false);
      expect(updated.soundAlerts).toBe(true);
      expect(service.getPreferences().soundAlerts).toBe(true);
    });
  });
});
