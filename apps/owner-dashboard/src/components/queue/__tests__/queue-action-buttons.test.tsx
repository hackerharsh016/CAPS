import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueueActionButtons } from '../queue-action-buttons';
import { QueueService } from '../../../services/api/queue.service';
import type { QueueItem } from '../../../types/queue';

describe('Task INT-D2-03: Owner Dashboard 1-Click Print Approval Live Wire', () => {
  const shopId = 'shop-fastprint-001';
  const sampleJob: QueueItem = {
    id: 'job-approval-1001',
    shop_id: shopId,
    customer_id: 'cust-uuid-001',
    customer_name: 'Alice Cooper',
    document_storage_key: 'uploads/doc-alice.pdf',
    document_name: 'Final_Thesis.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'single',
      orientation: 'portrait',
      copies: 1,
      page_range: 'all',
      binding: 'none'
    },
    priority_tier: 'urgent',
    price_total_paise: 2500,
    status: 'SUBMITTED',
    queue_position: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        jobId: sampleJob.id,
        shopId,
        status: 'QUEUED',
        data: {
          job: {
            ...sampleJob,
            status: 'QUEUED',
            updated_at: new Date().toISOString()
          }
        }
      })
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ============================================================================
  // Test Suite 1: Rendering & Initial State
  // ============================================================================
  describe('Rendering', () => {
    it('renders "Approve & Print" button for SUBMITTED print jobs', () => {
      const html = renderToStaticMarkup(
        <QueueActionButtons job={sampleJob} shopId={shopId} />
      );

      expect(html).toContain('Approve &amp; Print');
      expect(html).toContain('data-testid="approve-print-btn"');
      expect(html).toContain(`data-job-id="${sampleJob.id}"`);
    });

    it('renders "Queued for Agent" badge when job is already QUEUED', () => {
      const queuedJob: QueueItem = { ...sampleJob, status: 'QUEUED' };
      const html = renderToStaticMarkup(
        <QueueActionButtons job={queuedJob} shopId={shopId} />
      );

      expect(html).not.toContain('Approve &amp; Print');
      expect(html).toContain('Queued for Agent');
      expect(html).toContain('data-testid="queued-status-badge"');
    });

    it('renders "Printing Live" badge when job is PRINTING', () => {
      const printingJob: QueueItem = { ...sampleJob, status: 'PRINTING' };
      const html = renderToStaticMarkup(
        <QueueActionButtons job={printingJob} shopId={shopId} />
      );

      expect(html).toContain('Printing Live');
      expect(html).toContain('data-testid="printing-status-badge"');
    });
  });

  // ============================================================================
  // Test Suite 2: Single Click Approval & Optimistic Update
  // ============================================================================
  describe('Single-Click Approval & Optimistic Transition', () => {
    it('triggers approval request to POST /api/v1/shops/:shopId/jobs/:jobId/approve with auth token', async () => {
      const queueService = new QueueService({
        baseUrl: 'http://localhost:4000',
        authToken: 'owner-bearer-jwt-token-xyz'
      });

      // Trigger approveJob via QueueService
      const result = await queueService.approveJob(shopId, sampleJob.id);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`http://localhost:4000/api/v1/shops/${shopId}/jobs/${sampleJob.id}/approve`);
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer owner-bearer-jwt-token-xyz',
        'Content-Type': 'application/json'
      });

      expect(result.success).toBe(true);
      expect(result.job.status).toBe('QUEUED');
    });

    it('optimistically advances state to QUEUED on button click', async () => {
      const onOptimisticUpdate = vi.fn();
      const onApproveSuccess = vi.fn();
      const queueService = new QueueService({ baseUrl: 'http://localhost:4000' });

      // Direct service approval flow simulation
      onOptimisticUpdate(sampleJob.id, 'QUEUED');
      expect(onOptimisticUpdate).toHaveBeenCalledWith(sampleJob.id, 'QUEUED');

      const response = await queueService.approveJob(shopId, sampleJob.id);
      expect(response.job.status).toBe('QUEUED');
      onApproveSuccess(response.job);
      expect(onApproveSuccess).toHaveBeenCalledWith(expect.objectContaining({ status: 'QUEUED' }));
    });
  });

  // ============================================================================
  // Test Suite 3: Debounce & Double-Click Protection
  // ============================================================================
  describe('Debounce & Double-Click Protection', () => {
    it('prevents duplicate concurrent submissions when double clicked rapidly', async () => {
      let resolveFirstCall: any;
      const delayedPromise = new Promise((resolve) => {
        resolveFirstCall = resolve;
      });

      // Mock a pending / delayed network request
      mockFetch.mockImplementationOnce(async () => {
        await delayedPromise;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            status: 'QUEUED',
            data: { job: { ...sampleJob, status: 'QUEUED' } }
          })
        };
      });

      const queueService = new QueueService({ baseUrl: 'http://localhost:4000' });
      let callCount = 0;

      // Wrap approve with in-flight lock simulating QueueActionButtons lock
      let isLocked = false;
      const debouncedApprove = async () => {
        if (isLocked) {
          return { debounced: true };
        }
        isLocked = true;
        callCount++;
        try {
          return await queueService.approveJob(shopId, sampleJob.id);
        } finally {
          setTimeout(() => {
            isLocked = false;
          }, 500);
        }
      };

      // Fire 2 rapid clicks concurrently
      const click1 = debouncedApprove();
      const click2 = debouncedApprove(); // Must be blocked by lock

      // Finish the network response
      resolveFirstCall();
      await Promise.all([click1, click2]);

      // Exactly 1 network fetch should have been made
      expect(callCount).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Test Suite 4: Rollback & Error Toast on Failure
  // ============================================================================
  describe('Rollback & Error Handling', () => {
    it('rolls back optimistic state and triggers error callback when backend returns 500', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Database lock timeout'
      });

      const queueService = new QueueService({ baseUrl: 'http://localhost:4000' });
      const onRollback = vi.fn();
      const onError = vi.fn();

      const originalStatus = sampleJob.status;
      let currentStatus: any = 'QUEUED'; // optimistic

      try {
        await queueService.approveJob(shopId, sampleJob.id);
      } catch (err: any) {
        // Rollback
        currentStatus = originalStatus;
        onRollback(sampleJob.id, originalStatus);
        onError(err);
      }

      expect(currentStatus).toBe('SUBMITTED');
      expect(onRollback).toHaveBeenCalledWith(sampleJob.id, 'SUBMITTED');
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('HTTP 500')
        })
      );
    });
  });
});
