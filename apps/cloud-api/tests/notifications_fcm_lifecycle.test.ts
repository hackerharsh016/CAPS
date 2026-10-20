import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { buildApp } from '../src/app.js';
import { MockShopsRepository } from '../src/modules/shops/shops.repository.js';
import { MockPrintJobsRepository } from '../src/modules/print-jobs/print-jobs.repository.js';
import { MockPrintersRepository } from '../src/modules/printers/printers.repository.js';
import { MockFirebaseClient } from '../src/integrations/firebase/firebase.client.js';
import {
  MockUserFcmTokensRepository,
  MockNotificationOutboxRepository
} from '../src/modules/notifications/notifications.repository.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import {
  renderLifecycleNotification,
  validateNoDocumentContent
} from '../src/modules/notifications/notifications.templates.js';
import type { Shop } from '../src/modules/shops/shops.types.js';
import type { PrintJob } from '../src/modules/print-jobs/print-jobs.types.js';
import type { JobEvent } from '../src/modules/events/events.types.js';

describe('FCM Lifecycle Notification Pipeline (P06-M03-F01)', () => {
  let firebaseClient: MockFirebaseClient;
  let tokensRepo: MockUserFcmTokensRepository;
  let outboxRepo: MockNotificationOutboxRepository;
  let printJobsRepo: MockPrintJobsRepository;
  let shopsRepo: MockShopsRepository;
  let printersRepo: MockPrintersRepository;
  let notificationsService: NotificationsService;
  let shop: Shop;
  let customerId: string;
  let job: PrintJob;

  beforeEach(async () => {
    firebaseClient = new MockFirebaseClient();
    tokensRepo = new MockUserFcmTokensRepository();
    outboxRepo = new MockNotificationOutboxRepository();
    printJobsRepo = new MockPrintJobsRepository();
    shopsRepo = new MockShopsRepository();
    printersRepo = new MockPrintersRepository();

    notificationsService = new NotificationsService(
      firebaseClient,
      tokensRepo,
      outboxRepo,
      printJobsRepo,
      shopsRepo
    );

    customerId = crypto.randomUUID();

    shop = await shopsRepo.create({
      owner_id: crypto.randomUUID(),
      name: 'Delhi University Print Station',
      address: 'Arts Faculty Gate',
      geo_lat: 28.69,
      geo_lng: 77.21,
      pricing_config: {
        A4: {
          bw_single_paise: 200,
          bw_double_paise: 300,
          color_single_paise: 1000,
          color_double_paise: 1500
        },
        A3: {
          bw_single_paise: 500,
          bw_double_paise: 800,
          color_single_paise: 2000,
          color_double_paise: 3000
        },
        Legal: {
          bw_single_paise: 300,
          bw_double_paise: 450,
          color_single_paise: 1200,
          color_double_paise: 1800
        },
        binding_prices_paise: { none: 0, spiral: 3000, staple: 500, lamination: 2000 },
        gst_percentage: 18
      },
      urgent_surcharge_config: {
        type: 'flat',
        amount: 1500
      }
    });

    job = await printJobsRepo.create({
      shop_id: shop.id,
      customer_id: customerId,
      document_storage_key: 'customers/c1/confidential_assignment.pdf',
      settings: { pages: 12, copies: 1, color_mode: 'bw', duplex: true },
      priority_tier: 'urgent',
      price_total_paise: 4500,
      price_breakdown: {}
    });
  });

  describe('1. Zero-Leak Document Privacy Invariant', () => {
    it('verifies notification templates never leak document content, file bytes, or storage keys', () => {
      const rendered = renderLifecycleNotification('job_queued', {
        job_id: job.id,
        shop_name: shop.name,
        queue_position: 1,
        estimated_wait_seconds: 120
      });

      expect(rendered.title).toBe('Order Confirmed & Queued');
      expect(rendered.body).toContain(shop.name);
      expect(rendered.body).toContain('Position: #1');

      // Zero-leak validation
      expect(rendered.body).not.toContain('confidential_assignment.pdf');
      expect(rendered.body).not.toContain('customers/c1');
      expect(rendered.data['job_id']).toBe(job.id);
      expect(rendered.data['document_storage_key']).toBeUndefined();
      expect(rendered.data['raw_document']).toBeUndefined();

      // Explicit pattern validator should pass cleanly
      expect(() => validateNoDocumentContent(rendered)).not.toThrow();
    });

    it('throws privacy violation error if document content or sensitive storage pattern is injected', () => {
      const poisoned = {
        title: 'Your print job',
        body: 'Here is your file content: %PDF-1.7 ...',
        data: { job_id: job.id }
      };

      expect(() => validateNoDocumentContent(poisoned)).toThrow(
        /Privacy policy violation: Notification payload matches sensitive pattern/
      );
    });
  });

  describe('2. Lifecycle Event Dispatch & Push Formatting', () => {
    it('successfully renders and dispatches queued, printing, ready, and failed lifecycle events', async () => {
      // Register device push token for customer
      await notificationsService.registerToken(customerId, 'fcm-device-token-12345', 'web');

      // 1. job_queued
      const resQueued = await notificationsService.dispatchJobLifecycleNotification(
        job.id,
        'job_queued',
        { queue_position: 2, estimated_wait_seconds: 180 }
      );
      expect(resQueued.status).toBe('delivered');
      expect(resQueued.dispatched_tokens_count).toBe(1);

      const msg1 = firebaseClient.dispatchedMessages[0];
      expect(msg1?.token).toBe('fcm-device-token-12345');
      expect(msg1?.notification.title).toBe('Order Confirmed & Queued');
      expect(msg1?.notification.body).toContain('Position: #2');

      // 2. job_printing
      const resPrinting = await notificationsService.dispatchJobLifecycleNotification(
        job.id,
        'job_printing'
      );
      expect(resPrinting.status).toBe('delivered');
      const msg2 = firebaseClient.dispatchedMessages[1];
      expect(msg2?.notification.title).toBe('Printing in Progress');

      // 3. job_ready
      const resReady = await notificationsService.dispatchJobLifecycleNotification(
        job.id,
        'job_ready',
        { pickup_code: '9876' }
      );
      expect(resReady.status).toBe('delivered');
      const msg3 = firebaseClient.dispatchedMessages[2];
      expect(msg3?.notification.title).toBe('Prints Ready for Pickup!');
      expect(msg3?.notification.body).toContain('Pickup code: 9876');
      expect(msg3?.data?.['pickup_code']).toBe('9876');

      // 4. job_failed
      const resFailed = await notificationsService.dispatchJobLifecycleNotification(
        job.id,
        'job_failed',
        { failure_reason: 'Paper jam on primary tray' }
      );
      expect(resFailed.status).toBe('delivered');
      const msg4 = firebaseClient.dispatchedMessages[3];
      expect(msg4?.notification.title).toBe('Print Job Attention Required');
      expect(msg4?.notification.body).toContain('Paper jam on primary tray');
    });

    it('gracefully handles customers with zero registered FCM device tokens', async () => {
      // Customer has no registered tokens
      const result = await notificationsService.dispatchJobLifecycleNotification(
        job.id,
        'job_printing'
      );

      expect(result.status).toBe('delivered');
      expect(result.dispatched_tokens_count).toBe(0);
      expect(firebaseClient.dispatchedMessages).toHaveLength(0);
    });
  });

  describe('3. Deduplication & Replay Protection', () => {
    it('suppresses duplicate push dispatches for identical job lifecycle events', async () => {
      await notificationsService.registerToken(customerId, 'device-token-abc', 'android');

      // Initial dispatch
      const first = await notificationsService.dispatchJobLifecycleNotification(
        job.id,
        'job_printing'
      );
      expect(first.status).toBe('delivered');
      expect(first.dispatched_tokens_count).toBe(1);
      expect(firebaseClient.dispatchedMessages).toHaveLength(1);

      // Replayed dispatch with same dedupe_key (job.id:job_printing)
      const second = await notificationsService.dispatchJobLifecycleNotification(
        job.id,
        'job_printing'
      );
      expect(second.status).toBe('duplicate_skipped');
      expect(second.skipped_as_duplicate).toBe(true);
      expect(second.dispatched_tokens_count).toBe(0);

      // No new message dispatched to FCM
      expect(firebaseClient.dispatchedMessages).toHaveLength(1);
    });
  });

  describe('4. Revoked & Stale FCM Token Handling', () => {
    it('automatically deactivates tokens reporting registration-token-not-registered', async () => {
      const revokedToken = 'stale-unregistered-token-999';
      await notificationsService.registerToken(customerId, revokedToken, 'web');

      // Simulate Firebase returning registration-token-not-registered for this token
      firebaseClient.setTokenError(revokedToken, 'registration-token-not-registered');

      const result = await notificationsService.dispatchJobLifecycleNotification(
        job.id,
        'job_ready'
      );

      expect(result.revoked_tokens_count).toBe(1);

      // Token repository must have deactivated the revoked token
      const activeTokens = await tokensRepo.findActiveByUserId(customerId);
      expect(activeTokens).toHaveLength(0);

      // Subsequent dispatch for another job shouldn't attempt to send to the deactivated token
      const secondJob = await printJobsRepo.create({
        shop_id: shop.id,
        customer_id: customerId,
        document_storage_key: 'doc2',
        settings: {},
        priority_tier: 'flexible',
        price_total_paise: 500,
        price_breakdown: {}
      });

      const secondResult = await notificationsService.dispatchJobLifecycleNotification(
        secondJob.id,
        'job_ready'
      );
      expect(secondResult.dispatched_tokens_count).toBe(0);
      expect(secondResult.revoked_tokens_count).toBe(0);
    });
  });

  describe('5. Transient FCM Failure & Retry Policy', () => {
    it('retries transient server-unavailable errors with exponential backoff and succeeds', async () => {
      const validToken = 'good-device-token';
      await notificationsService.registerToken(customerId, validToken, 'ios');

      // Simulate 2 transient server failures before succeeding on 3rd attempt
      firebaseClient.setTransientFailures(2);

      const result = await notificationsService.dispatchJobLifecycleNotification(
        job.id,
        'job_printing',
        { maxRetries: 3 }
      );

      expect(result.status).toBe('delivered');
      expect(result.dispatched_tokens_count).toBe(1);
      // Attempt 1: fail, Attempt 2: fail, Attempt 3: success -> total 3 attempts
      expect(firebaseClient.totalSendAttempts).toBe(3);
      expect(firebaseClient.dispatchedMessages).toHaveLength(1);
    });

    it('marks outbox entry as failed when retries are completely exhausted', async () => {
      const token = 'persistent-fail-token';
      await notificationsService.registerToken(customerId, token, 'web');

      // Simulate 5 failures while maxRetries is 3
      firebaseClient.setTransientFailures(5);

      const result = await notificationsService.dispatchJobLifecycleNotification(
        job.id,
        'job_failed',
        { maxRetries: 3 }
      );

      expect(result.status).toBe('failed');
      expect(result.dispatched_tokens_count).toBe(0);
      expect(firebaseClient.totalSendAttempts).toBe(3);

      const outbox = await outboxRepo.findByDedupeKey(`${job.id}:job_failed`);
      expect(outbox?.status).toBe('failed');
      expect(outbox?.last_error).toContain('temporarily unavailable');
    });
  });

  describe('6. Automated JobEvent Hook Integration', () => {
    it('automatically dispatches notification when consuming verified JobEvent', async () => {
      await notificationsService.registerToken(customerId, 'hook-token-123', 'web');

      const event: JobEvent = {
        id: 101,
        job_id: job.id,
        actor_type: 'agent',
        to_status: 'printing',
        event_name: 'agent_printing_started',
        metadata: {},
        created_at: new Date().toISOString()
      };

      const result = await notificationsService.handleJobEvent(event);
      expect(result).not.toBeNull();
      expect(result?.status).toBe('delivered');
      expect(firebaseClient.dispatchedMessages).toHaveLength(1);
      expect(firebaseClient.dispatchedMessages[0]?.notification.title).toBe('Printing in Progress');
    });
  });

  describe('7. HTTP Endpoints for Notification Tokens and History', () => {
    let app: ReturnType<typeof buildApp>;

    beforeEach(() => {
      app = buildApp({
        shopsRepo,
        printJobsRepo,
        printersRepo,
        firebaseClient,
        userFcmTokensRepo: tokensRepo,
        notificationOutboxRepo: outboxRepo,
        notificationsService
      });
    });

    it('POST /api/v1/notifications/tokens registers a device push token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/notifications/tokens',
        payload: {
          user_id: customerId,
          device_token: 'web-fcm-token-555',
          device_type: 'web'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.device_token).toBe('web-fcm-token-555');
      expect(body.data.is_active).toBe(true);

      const active = await tokensRepo.findActiveByUserId(customerId);
      expect(active).toHaveLength(1);
    });

    it('DELETE /api/v1/notifications/tokens removes a device push token', async () => {
      await notificationsService.registerToken(customerId, 'remove-me-token', 'android');

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/notifications/tokens',
        payload: {
          user_id: customerId,
          device_token: 'remove-me-token'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.removed).toBe(true);

      const active = await tokensRepo.findActiveByUserId(customerId);
      expect(active).toHaveLength(0);
    });

    it('GET /api/v1/notifications/history returns outbox audit log for user', async () => {
      await notificationsService.registerToken(customerId, 'test-token', 'web');
      await notificationsService.dispatchJobLifecycleNotification(job.id, 'job_queued');

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notifications/history?user_id=${customerId}`
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].event_type).toBe('job_queued');
      expect(body.data[0].status).toBe('delivered');
    });

    it('POST /api/v1/notifications/dispatch triggers lifecycle notification via API', async () => {
      await notificationsService.registerToken(customerId, 'api-token', 'web');

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/notifications/dispatch',
        payload: {
          job_id: job.id,
          event_type: 'job_ready',
          pickup_code: '4321'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.status).toBe('delivered');
      expect(body.data.dispatched_tokens_count).toBe(1);
    });
  });
});
