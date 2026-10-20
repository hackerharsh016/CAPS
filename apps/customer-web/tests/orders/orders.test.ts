import { describe, it, expect } from 'vitest';
import {
  OrdersService,
  formatPaiseToInr,
  getStatusBadgeProps
} from '../../src/features/orders/orders-service';
import type { CustomerOrder } from '../../src/features/orders/types';

describe('Customer Orders Service & Tenant Isolation', () => {
  const customerAlpha = 'usr-customer-alpha';
  const customerBeta = 'usr-customer-beta';

  const testOrders: CustomerOrder[] = [
    {
      id: 'job-1',
      token_number: 'T-001',
      customer_id: customerAlpha,
      shop_id: 'shop-1',
      shop_name: 'Alpha Xerox',
      document_name: 'doc1.pdf',
      file_size_bytes: 1000,
      settings: {
        paper_size: 'A4',
        color_mode: 'bw',
        duplex: true,
        copies: 1,
        orientation: 'portrait',
        pages_per_copy: 10,
        total_pages: 10,
        spiral_binding: false
      },
      priority_tier: 'urgent',
      amount_paise: 2000,
      status: 'queued',
      payment_status: 'paid',
      document_deleted: false,
      created_at: new Date('2026-10-18T10:00:00Z').toISOString()
    },
    {
      id: 'job-2',
      token_number: 'T-002',
      customer_id: customerAlpha,
      shop_id: 'shop-1',
      shop_name: 'Alpha Xerox',
      document_name: 'doc2.pdf',
      file_size_bytes: 2000,
      settings: {
        paper_size: 'A4',
        color_mode: 'bw',
        duplex: false,
        copies: 2,
        orientation: 'portrait',
        pages_per_copy: 5,
        total_pages: 10,
        spiral_binding: false
      },
      priority_tier: 'flexible',
      amount_paise: 1500,
      status: 'completed',
      payment_status: 'paid',
      document_deleted: true, // Auto-deleted after completion
      created_at: new Date('2026-10-17T10:00:00Z').toISOString()
    },
    {
      id: 'job-3',
      token_number: 'T-003',
      customer_id: customerAlpha,
      shop_id: 'shop-1',
      shop_name: 'Alpha Xerox',
      document_name: 'doc3.pdf',
      file_size_bytes: 3000,
      settings: {
        paper_size: 'A4',
        color_mode: 'color',
        duplex: false,
        copies: 1,
        orientation: 'portrait',
        pages_per_copy: 2,
        total_pages: 2,
        spiral_binding: false
      },
      priority_tier: 'flexible',
      amount_paise: 2000,
      status: 'failed',
      payment_status: 'refunded',
      document_deleted: true,
      created_at: new Date('2026-10-16T10:00:00Z').toISOString()
    },
    // Another customer's order (Tenant isolation test)
    {
      id: 'job-beta-99',
      token_number: 'T-999',
      customer_id: customerBeta,
      shop_id: 'shop-1',
      shop_name: 'Alpha Xerox',
      document_name: 'secret_beta.pdf',
      file_size_bytes: 5000,
      settings: {
        paper_size: 'A4',
        color_mode: 'bw',
        duplex: false,
        copies: 1,
        orientation: 'portrait',
        pages_per_copy: 1,
        total_pages: 1,
        spiral_binding: false
      },
      priority_tier: 'urgent',
      amount_paise: 5000,
      status: 'completed',
      payment_status: 'paid',
      document_deleted: true,
      created_at: new Date('2026-10-18T12:00:00Z').toISOString()
    }
  ];

  it('enforces customer isolation: customerAlpha cannot see customerBeta orders', async () => {
    const service = new OrdersService(testOrders);
    const alphaResponse = await service.getCustomerOrders({
      customerId: customerAlpha,
      page: 1,
      limit: 10
    });

    expect(alphaResponse.totalCount).toBe(3);
    const hasBetaOrders = alphaResponse.orders.some(o => o.customer_id === customerBeta);
    expect(hasBetaOrders).toBe(false);
  });

  it('rejects order retrieval without valid customerId', async () => {
    const service = new OrdersService(testOrders);
    await expect(
      service.getCustomerOrders({
        customerId: '',
        page: 1
      })
    ).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('filters orders by status correctly', async () => {
    const service = new OrdersService(testOrders);

    // Active filter (queued, approved, claimed, printing)
    const active = await service.getCustomerOrders({
      customerId: customerAlpha,
      filter: 'active'
    });
    expect(active.totalCount).toBe(1);
    expect(active.orders[0]?.id).toBe('job-1');

    // Completed filter
    const completed = await service.getCustomerOrders({
      customerId: customerAlpha,
      filter: 'completed'
    });
    expect(completed.totalCount).toBe(1);
    expect(completed.orders[0]?.id).toBe('job-2');

    // Cancelled / Failed filter
    const cancelled = await service.getCustomerOrders({
      customerId: customerAlpha,
      filter: 'cancelled'
    });
    expect(cancelled.totalCount).toBe(1);
    expect(cancelled.orders[0]?.id).toBe('job-3');
  });

  it('handles pagination accurately', async () => {
    const service = new OrdersService(testOrders);

    // Page 1 with limit 2
    const page1 = await service.getCustomerOrders({
      customerId: customerAlpha,
      page: 1,
      limit: 2
    });
    expect(page1.page).toBe(1);
    expect(page1.limit).toBe(2);
    expect(page1.totalPages).toBe(2);
    expect(page1.totalCount).toBe(3);
    expect(page1.orders.length).toBe(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.orders[0]?.id).toBe('job-1'); // Most recent first

    // Page 2 with limit 2
    const page2 = await service.getCustomerOrders({
      customerId: customerAlpha,
      page: 2,
      limit: 2
    });
    expect(page2.page).toBe(2);
    expect(page2.orders.length).toBe(1);
    expect(page2.hasMore).toBe(false);
    expect(page2.orders[0]?.id).toBe('job-3');
  });

  it('returns null when fetching single order belonging to another customer', async () => {
    const service = new OrdersService(testOrders);

    // Alpha requesting Beta's order
    const result = await service.getOrderById('job-beta-99', customerAlpha);
    expect(result).toBeNull();

    // Alpha requesting own order
    const ownResult = await service.getOrderById('job-1', customerAlpha);
    expect(ownResult).not.toBeNull();
    expect(ownResult?.id).toBe('job-1');
  });

  describe('Currency and Badge Formatting', () => {
    it('formats paise into INR currency representation', () => {
      expect(formatPaiseToInr(2000)).toMatch(/₹\s*20\.00/);
      expect(formatPaiseToInr(18550)).toMatch(/₹\s*185\.50/);
      expect(formatPaiseToInr(0)).toMatch(/₹\s*0\.00/);
    });

    it('returns appropriate badge properties for job statuses', () => {
      expect(getStatusBadgeProps('queued').label).toBe('In Queue');
      expect(getStatusBadgeProps('printing').label).toBe('Printing Now');
      expect(getStatusBadgeProps('completed').label).toBe('Completed');
      expect(getStatusBadgeProps('failed').label).toBe('Print Failed');
    });
  });
});
