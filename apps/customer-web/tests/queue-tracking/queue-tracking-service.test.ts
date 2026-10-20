import { describe, it, expect, beforeEach } from 'vitest';
import {
  QueueTrackingService,
  QueueTrackingCustomError
} from '../../src/features/queue-tracking/queue-tracking-service';
import { OrdersService } from '../../src/features/orders/orders-service';
import { ShopsService } from '../../src/features/shop-discovery/shops-service';
import { MOCK_ORDERS } from '../../src/features/orders/fixtures';
import { MOCK_SHOPS } from '../../src/features/shop-discovery/fixtures';

describe('Queue Tracking & Customer Job Status Service (P04-M06-F01)', () => {
  let ordersService: OrdersService;
  let shopsService: ShopsService;
  let queueTrackingService: QueueTrackingService;

  const customerAlpha = 'usr-customer-alpha';
  const customerBeta = 'usr-customer-BETA-ANOTHER-TENANT';

  // Sample jobs from MOCK_ORDERS
  const urgentPrintingJobId = 'job-101e4567-e89b-12d3-a456-426614174001'; // urgent, printing, alpha
  const flexibleQueuedJobId = 'job-101e4567-e89b-12d3-a456-426614174002'; // flexible, queued, alpha
  const completedJobId = 'job-101e4567-e89b-12d3-a456-426614174003'; // completed -> ready, alpha
  const betaTenantJobId = 'job-999e4567-e89b-12d3-a456-426614174999'; // belongs strictly to customerBeta

  beforeEach(() => {
    ordersService = new OrdersService(MOCK_ORDERS);
    shopsService = new ShopsService(MOCK_SHOPS);
    queueTrackingService = new QueueTrackingService(ordersService, shopsService);
  });

  describe('Happy Path: Tracking Retrieval & Status Mapping', () => {
    it('retrieves tracking information for an active printing job with token and specs', async () => {
      const tracking = await queueTrackingService.getJobTracking(urgentPrintingJobId, customerAlpha);

      expect(tracking.job_id).toBe(urgentPrintingJobId);
      expect(tracking.token_number).toBe('T-001');
      expect(tracking.customer_id).toBe(customerAlpha);
      expect(tracking.priority_tier).toBe('urgent');
      expect(tracking.status).toBe('printing');
      expect(tracking.status_label).toBe('Printing in Progress');
      expect(tracking.status_explanation).toContain('actively printing');
      expect(tracking.queue_position).toBe(0); // On printer
      expect(tracking.estimated_minutes_remaining).toBeGreaterThan(0);
      expect(tracking.shop_name).toBe('Campus Xerox & Stationary');
      expect(tracking.document_name).toBe('Semester_Project_Report_v2.pdf');
    });

    it('retrieves tracking for a queued job with priority position and calculated ETA', async () => {
      const tracking = await queueTrackingService.getJobTracking(flexibleQueuedJobId, customerAlpha);

      expect(tracking.job_id).toBe(flexibleQueuedJobId);
      expect(tracking.token_number).toBe('T-004');
      expect(tracking.status).toBe('queued');
      expect(tracking.status_label).toBe('In Print Queue');
      expect(tracking.queue_position).toBeGreaterThanOrEqual(1);
      expect(tracking.estimated_minutes_remaining).toBeGreaterThan(0);
      expect(tracking.estimated_pickup_at).not.toBeNull();
    });

    it('maps completed job to ready status with counter pickup instructions', async () => {
      const tracking = await queueTrackingService.getJobTracking(completedJobId, customerAlpha);

      expect(tracking.status).toBe('ready');
      expect(tracking.status_label).toBe('Ready for Pickup');
      expect(tracking.status_explanation).toContain('ready for pickup at the collection counter');
      expect(tracking.next_step_instruction).toContain('Present Token T-098');
      expect(tracking.queue_position).toBeNull();
      expect(tracking.estimated_minutes_remaining).toBe(0);
    });
  });

  describe('Security & Multi-Tenant Isolation', () => {
    it('strictly forbids Customer A from inspecting Customer B job (403 Unauthorized)', async () => {
      // Customer Alpha attempts to inspect Customer Beta's job
      await expect(
        queueTrackingService.getJobTracking(betaTenantJobId, customerAlpha)
      ).rejects.toThrow(QueueTrackingCustomError);

      try {
        await queueTrackingService.getJobTracking(betaTenantJobId, customerAlpha);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(QueueTrackingCustomError);
        const qError = err as QueueTrackingCustomError;
        expect(qError.code).toBe('UNAUTHORIZED');
        expect(qError.message).toContain('Forbidden');
      }
    });

    it('permits authorized owner to inspect their own job', async () => {
      const tracking = await queueTrackingService.getJobTracking(betaTenantJobId, customerBeta);
      expect(tracking.customer_id).toBe(customerBeta);
      expect(tracking.token_number).toBe('T-888');
    });

    it('rejects unauthenticated requests without customerId', async () => {
      await expect(
        queueTrackingService.getJobTracking(urgentPrintingJobId, '')
      ).rejects.toThrow(QueueTrackingCustomError);
    });

    it('returns NOT_FOUND for completely nonexistent job IDs', async () => {
      await expect(
        queueTrackingService.getJobTracking('nonexistent-uuid-999', customerAlpha)
      ).rejects.toThrow(QueueTrackingCustomError);

      try {
        await queueTrackingService.getJobTracking('nonexistent-uuid-999', customerAlpha);
      } catch (err: unknown) {
        const qError = err as QueueTrackingCustomError;
        expect(qError.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('Explicit Unknown & Offline States', () => {
    it('handles explicit unknown state with non-reprint warning', async () => {
      queueTrackingService.setJobStatusOverride(flexibleQueuedJobId, 'unknown');

      const tracking = await queueTrackingService.getJobTracking(flexibleQueuedJobId, customerAlpha);

      expect(tracking.status).toBe('unknown');
      expect(tracking.status_label).toBe('Status Unknown');
      expect(tracking.status_explanation).toContain('automatic reprinting is suspended');
      expect(tracking.next_step_instruction).toContain('inspect Token T-004 on their dashboard');
      expect(tracking.estimated_minutes_remaining).toBeNull();
      expect(tracking.estimated_pickup_at).toBeNull();
    });

    it('handles explicit agent offline state with prominent warning and paused queue', async () => {
      // Simulate shop agent disconnected
      queueTrackingService.setShopAgentStatus('shop-8888-campus-xerox', 'offline');

      const tracking = await queueTrackingService.getJobTracking(flexibleQueuedJobId, customerAlpha);

      expect(tracking.agent_status).toBe('offline');
      expect(tracking.is_agent_offline).toBe(true);
      expect(tracking.status_label).toBe('Workstation Offline');
      expect(tracking.status_explanation).toContain('print workstation is currently offline');
      expect(tracking.estimated_minutes_remaining).toBeNull();
      expect(tracking.estimated_pickup_at).toBeNull();
    });
  });

  describe('Document Privacy 24-Hour Expiration Deadline', () => {
    it('enforces 24-hour auto-delete deadline calculation', async () => {
      const tracking = await queueTrackingService.getJobTracking(urgentPrintingJobId, customerAlpha);

      expect(tracking.document_expires_at).toBeDefined();
      const createdAtMs = new Date(tracking.created_at).getTime();
      const expiresAtMs = new Date(tracking.document_expires_at).getTime();

      // Expect exactly 24 hours difference (86,400,000 ms)
      expect(expiresAtMs - createdAtMs).toBe(24 * 60 * 60 * 1000);
    });

    it('reflects permanently purged document flag when document_deleted is true', async () => {
      const tracking = await queueTrackingService.getJobTracking(completedJobId, customerAlpha);

      expect(tracking.document_deleted).toBe(true);
    });
  });
});
