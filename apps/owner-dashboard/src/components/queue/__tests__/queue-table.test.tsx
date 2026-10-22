import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueueTable } from '../queue-table';
import {
  CANONICAL_JOB_STATUSES,
  JOB_STATUS_CONFIG,
  normalizeJobStatus
} from '../../../types/queue';
import type { QueueItem } from '../../../types/queue';
import { QueueService } from '../../../services/api/queue.service';

const SAMPLE_QUEUE_ITEMS: QueueItem[] = [
  {
    id: 'job-001',
    shop_id: 'shop-alpha',
    customer_id: 'cust-1',
    customer_name: 'Alice Johnson',
    document_storage_key: 'uploads/alice.pdf',
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
    created_at: '2026-10-21T10:00:00Z',
    updated_at: '2026-10-21T10:00:00Z'
  },
  {
    id: 'job-002',
    shop_id: 'shop-alpha',
    customer_id: 'cust-2',
    customer_name: 'Bob Smith',
    document_storage_key: 'uploads/bob.pdf',
    settings: {
      paper_size: 'A3',
      color_mode: 'color',
      sides: 'double',
      orientation: 'landscape',
      copies: 2,
      page_range: '1-5',
      binding: 'spiral'
    },
    priority_tier: 'flexible',
    price_total_paise: 8000,
    status: 'OWNER_CONFIRMED',
    queue_position: 2,
    created_at: '2026-10-21T10:05:00Z',
    updated_at: '2026-10-21T10:05:00Z'
  },
  {
    id: 'job-003',
    shop_id: 'shop-alpha',
    customer_id: 'cust-3',
    customer_name: 'Charlie Brown',
    document_storage_key: 'uploads/charlie.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'single',
      orientation: 'portrait',
      copies: 5,
      page_range: 'all',
      binding: 'staple'
    },
    priority_tier: 'flexible',
    price_total_paise: 3500,
    status: 'QUEUED',
    queue_position: 3,
    created_at: '2026-10-21T10:10:00Z',
    updated_at: '2026-10-21T10:10:00Z'
  },
  {
    id: 'job-004',
    shop_id: 'shop-alpha',
    customer_id: 'cust-4',
    customer_name: 'Diana Prince',
    document_storage_key: 'uploads/diana.pdf',
    settings: {
      paper_size: 'Legal',
      color_mode: 'color',
      sides: 'double',
      orientation: 'portrait',
      copies: 1,
      page_range: 'all',
      binding: 'none'
    },
    priority_tier: 'urgent',
    price_total_paise: 4200,
    status: 'PRINTING',
    queue_position: 4,
    created_at: '2026-10-21T10:15:00Z',
    updated_at: '2026-10-21T10:15:00Z'
  },
  {
    id: 'job-005',
    shop_id: 'shop-alpha',
    customer_id: 'cust-5',
    customer_name: 'Edward Norton',
    document_storage_key: 'uploads/edward.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'single',
      orientation: 'portrait',
      copies: 2,
      page_range: 'all',
      binding: 'none'
    },
    priority_tier: 'flexible',
    price_total_paise: 2000,
    status: 'COMPLETED',
    queue_position: 5,
    created_at: '2026-10-21T09:30:00Z',
    updated_at: '2026-10-21T10:00:00Z'
  },
  {
    id: 'job-006',
    shop_id: 'shop-alpha',
    customer_id: 'cust-6',
    customer_name: 'Fiona Gallagher',
    document_storage_key: 'uploads/fiona.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'double',
      orientation: 'portrait',
      copies: 3,
      page_range: 'all',
      binding: 'none'
    },
    priority_tier: 'flexible',
    price_total_paise: 3000,
    status: 'FAILED',
    queue_position: 6,
    created_at: '2026-10-21T09:40:00Z',
    updated_at: '2026-10-21T09:45:00Z'
  },
  {
    id: 'job-007',
    shop_id: 'shop-alpha',
    customer_id: 'cust-7',
    customer_name: 'George Clark',
    document_storage_key: 'uploads/george.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'color',
      sides: 'single',
      orientation: 'landscape',
      copies: 1,
      page_range: 'all',
      binding: 'none'
    },
    priority_tier: 'flexible',
    price_total_paise: 1500,
    status: 'CANCELLED',
    queue_position: 7,
    created_at: '2026-10-21T09:50:00Z',
    updated_at: '2026-10-21T09:52:00Z'
  }
];

describe('Owner Dashboard Queue Table & Status Alignment (INT-D2-01)', () => {
  describe('Canonical PostgreSQL Enum Types Conformance', () => {
    it('defines exactly 7 canonical backend statuses', () => {
      expect(CANONICAL_JOB_STATUSES).toEqual([
        'SUBMITTED',
        'OWNER_CONFIRMED',
        'QUEUED',
        'PRINTING',
        'COMPLETED',
        'FAILED',
        'CANCELLED'
      ]);
    });

    it('has complete UI badge configurations for all 7 canonical states', () => {
      for (const status of CANONICAL_JOB_STATUSES) {
        const config = JOB_STATUS_CONFIG[status];
        expect(config).toBeDefined();
        expect(config.status).toBe(status);
        expect(config.label).toBeTruthy();
        expect(config.badgeClass).toBeTruthy();
        expect(config.description).toBeTruthy();
      }
    });

    it('normalizes drifted lowercase and legacy states to canonical uppercase enums', () => {
      expect(normalizeJobStatus('submitted')).toBe('SUBMITTED');
      expect(normalizeJobStatus('pending_payment')).toBe('SUBMITTED');
      expect(normalizeJobStatus('owner_confirmed')).toBe('OWNER_CONFIRMED');
      expect(normalizeJobStatus('approved')).toBe('OWNER_CONFIRMED');
      expect(normalizeJobStatus('queued')).toBe('QUEUED');
      expect(normalizeJobStatus('printing')).toBe('PRINTING');
      expect(normalizeJobStatus('claimed')).toBe('PRINTING');
      expect(normalizeJobStatus('downloading')).toBe('PRINTING');
      expect(normalizeJobStatus('completed')).toBe('COMPLETED');
      expect(normalizeJobStatus('failed')).toBe('FAILED');
      expect(normalizeJobStatus('requires_review')).toBe('FAILED');
      expect(normalizeJobStatus('cancelled')).toBe('CANCELLED');
    });

    it('preserves uppercase canonical statuses in normalizeJobStatus', () => {
      for (const status of CANONICAL_JOB_STATUSES) {
        expect(normalizeJobStatus(status)).toBe(status);
      }
    });
  });

  describe('QueueTable Rendering of Canonical Status Badges', () => {
    it('renders accurate status badges for all 7 backend states', () => {
      const markup = renderToStaticMarkup(
        React.createElement(QueueTable, {
          initialItems: SAMPLE_QUEUE_ITEMS
        })
      );

      // Verify each of the 7 status labels is rendered
      expect(markup).toContain('Submitted');
      expect(markup).toContain('Owner Confirmed');
      expect(markup).toContain('Queued');
      expect(markup).toContain('Printing');
      expect(markup).toContain('Completed');
      expect(markup).toContain('Failed');
      expect(markup).toContain('Cancelled');

      // Verify data-status attributes for all 7 states
      for (const status of CANONICAL_JOB_STATUSES) {
        expect(markup).toContain(`data-status="${status}"`);
      }
    });

    it('renders filter tabs for all 7 canonical states plus All Jobs', () => {
      const markup = renderToStaticMarkup(
        React.createElement(QueueTable, {
          initialItems: SAMPLE_QUEUE_ITEMS
        })
      );

      expect(markup).toContain('data-testid="filter-tab-all"');
      for (const status of CANONICAL_JOB_STATUSES) {
        expect(markup).toContain(`data-testid="filter-tab-${status.toLowerCase()}"`);
      }
    });

    it('renders Approve button for SUBMITTED and QUEUED states but not COMPLETED/CANCELLED', () => {
      const markup = renderToStaticMarkup(
        React.createElement(QueueTable, {
          initialItems: SAMPLE_QUEUE_ITEMS
        })
      );

      // job-001 (SUBMITTED) and job-003 (QUEUED) can be approved
      expect(markup).toContain('data-testid="approve-btn-job-001"');
      expect(markup).toContain('data-testid="approve-btn-job-003"');

      // job-005 (COMPLETED) and job-007 (CANCELLED) cannot be approved
      expect(markup).not.toContain('data-testid="approve-btn-job-005"');
      expect(markup).not.toContain('data-testid="approve-btn-job-007"');
    });

    it('filters rows correctly when a specific filter is set', () => {
      const markupPrintingOnly = renderToStaticMarkup(
        React.createElement(QueueTable, {
          initialItems: SAMPLE_QUEUE_ITEMS,
          filter: 'PRINTING'
        })
      );

      expect(markupPrintingOnly).toContain('data-testid="queue-row-job-004"');
      expect(markupPrintingOnly).not.toContain('data-testid="queue-row-job-001"');
      expect(markupPrintingOnly).not.toContain('data-testid="queue-row-job-005"');
    });
  });

  describe('QueueService API Integration', () => {
    it('queries GET /api/v1/shops/:shopId/queue and normalizes all job statuses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'job-101',
              status: 'pending_payment',
              settings: { paper_size: 'A4', color_mode: 'bw', sides: 'single' }
            },
            {
              id: 'job-102',
              status: 'approved',
              settings: { paper_size: 'A4', color_mode: 'bw', sides: 'single' }
            },
            {
              id: 'job-103',
              status: 'PRINTING',
              settings: { paper_size: 'A4', color_mode: 'bw', sides: 'single' }
            }
          ]
        })
      });

      vi.stubGlobal('fetch', mockFetch);

      const service = new QueueService({ baseUrl: 'http://localhost:4000', authToken: 'test-jwt' });
      const items = await service.getQueue('shop-123');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:4000/api/v1/shops/shop-123/queue');
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer test-jwt'
      });

      expect(items).toHaveLength(3);
      expect(items[0]?.status).toBe('SUBMITTED');
      expect(items[1]?.status).toBe('OWNER_CONFIRMED');
      expect(items[2]?.status).toBe('PRINTING');

      vi.unstubAllGlobals();
    });

    it('appends status query parameter when filtered', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] })
      });

      vi.stubGlobal('fetch', mockFetch);

      const service = new QueueService({ baseUrl: 'http://localhost:4000' });
      await service.getQueue('shop-123', { status: 'PRINTING' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:4000/api/v1/shops/shop-123/queue?status=PRINTING');

      vi.unstubAllGlobals();
    });

    it('queries POST /api/v1/shops/:shopId/jobs/:jobId/approve and transitions job', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          job: {
            id: 'job-555',
            shop_id: 'shop-123',
            status: 'OWNER_CONFIRMED',
            customer_name: 'John Doe',
            settings: { paper_size: 'A4', color_mode: 'bw', sides: 'single' }
          }
        })
      });

      vi.stubGlobal('fetch', mockFetch);

      const service = new QueueService({ baseUrl: 'http://localhost:4000', authToken: 'owner-token' });
      const result = await service.approveJob('shop-123', 'job-555');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:4000/api/v1/shops/shop-123/jobs/job-555/approve');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer owner-token'
      });

      expect(result.success).toBe(true);
      expect(result.job.status).toBe('OWNER_CONFIRMED');

      vi.unstubAllGlobals();
    });
  });
});
