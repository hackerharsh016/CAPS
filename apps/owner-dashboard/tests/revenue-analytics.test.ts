/**
 * Unit and Contract Tests for CAPS Owner Sales & Operations Reports (P05-M05-F01).
 *
 * Verifies:
 * - Integer paise amount precision & currency formatting
 * - Timezone handling & day boundaries in Asia/Kolkata
 * - Tenant isolation across distinct shop IDs
 * - Distinct separation of Paid vs Physically Completed print records
 * - Operational metrics: average/median wait times and peak demand hour
 * - Filter period ranges & offline fallback resilience
 */

import { describe, it, expect, vi } from 'vitest';
import {
  formatPaiseToINR,
  formatWaitMinutes,
  getShopTimezoneDateString,
  getHourInShopTimezone,
  computeFilterDateRange,
  aggregateReportsData
} from '../src/features/revenue-analytics/analytics-utils';
import { OwnerAnalyticsService } from '../src/features/revenue-analytics/analytics-service';
import { generateMockJobRecords, DEMO_SHOP_ID } from '../src/features/revenue-analytics/fixtures';
import type { PaidVsCompletedJobRecord, ReportFilter } from '../src/features/revenue-analytics/types';

describe('P05-M05-F01: Owner Sales and Operations Reports', () => {
  const OTHER_SHOP_ID = '00000000-0000-0000-0000-000000000099';
  const FIXED_REF_DATE = new Date('2026-10-21T14:30:00+05:30'); // 2:30 PM IST

  describe('1. Amount Precision & Currency Formatting', () => {
    it('formats exact integer paise into INR without floating point drift', () => {
      expect(formatPaiseToINR(0)).toBe('₹0.00');
      expect(formatPaiseToINR(100)).toBe('₹1.00');
      expect(formatPaiseToINR(7250)).toBe('₹72.50');
      expect(formatPaiseToINR(150000)).toBe('₹1,500.00');
      expect(formatPaiseToINR(123456789)).toBe('₹12,34,567.89');
    });

    it('handles negative or rounding edge cases cleanly', () => {
      expect(formatPaiseToINR(-250)).toBe('-₹2.50');
      expect(formatPaiseToINR(49.8)).toBe('₹0.50');
      expect(formatPaiseToINR(NaN)).toBe('₹0.00');
    });

    it('formats wait times into human-readable minutes and seconds', () => {
      expect(formatWaitMinutes(0)).toBe('0m');
      expect(formatWaitMinutes(4.5)).toBe('4m 30s');
      expect(formatWaitMinutes(12)).toBe('12m');
      expect(formatWaitMinutes(0.5)).toBe('30s');
    });
  });

  describe('2. Timezone Correctness (Asia/Kolkata)', () => {
    it('accurately resolves shop calendar date in Asia/Kolkata (+05:30)', () => {
      // 2026-10-21 19:00:00 UTC is 2026-10-22 00:30:00 IST
      const dateUtc = new Date('2026-10-21T19:00:00Z');
      const dateStr = getShopTimezoneDateString(dateUtc, 'Asia/Kolkata');
      expect(dateStr).toBe('2026-10-22');
    });

    it('does not bleed across day boundaries when order created late evening IST', () => {
      // 11:45 PM IST on Oct 21 -> 18:15 UTC Oct 21
      const lateEveningDate = new Date('2026-10-21T23:45:00+05:30');
      const dateStr = getShopTimezoneDateString(lateEveningDate, 'Asia/Kolkata');
      expect(dateStr).toBe('2026-10-21');
    });

    it('computes hour of day in shop timezone correctly', () => {
      // 14:30 IST is hour 14 (2:00 PM)
      const date = new Date('2026-10-21T14:30:00+05:30');
      expect(getHourInShopTimezone(date, 'Asia/Kolkata')).toBe(14);
    });

    it('computes filter date range for "today" bounded to current day in IST', () => {
      const filter: ReportFilter = {
        period: 'today',
        timezone: 'Asia/Kolkata'
      };
      const range = computeFilterDateRange(filter, FIXED_REF_DATE);
      expect(range.start.getTime()).toBeLessThan(range.end.getTime());
      // Duration should be 24 hours minus 1 ms
      const durationMs = range.end.getTime() - range.start.getTime();
      expect(durationMs).toBe(24 * 60 * 60 * 1000 - 1);
    });
  });

  describe('3. Tenant Isolation', () => {
    it('strictly isolates and excludes records from foreign shop IDs', () => {
      const records: PaidVsCompletedJobRecord[] = [
        {
          jobId: 'job-1',
          shopId: DEMO_SHOP_ID,
          customerName: 'Authorized Customer',
          documentName: 'Doc1.pdf',
          priorityTier: 'flexible',
          amountPaise: 5000,
          paymentStatus: 'paid',
          paymentMethod: 'upi',
          jobStatus: 'completed',
          createdAt: FIXED_REF_DATE.toISOString(),
          pages: 1,
          copies: 1,
          colorMode: 'bw',
          sides: 'single'
        },
        {
          jobId: 'job-cross-shop',
          shopId: OTHER_SHOP_ID,
          customerName: 'Foreign Customer',
          documentName: 'Secret_Doc.pdf',
          priorityTier: 'urgent',
          amountPaise: 999999, // Should NOT contaminate demo shop revenue!
          paymentStatus: 'paid',
          paymentMethod: 'card',
          jobStatus: 'completed',
          createdAt: FIXED_REF_DATE.toISOString(),
          pages: 10,
          copies: 1,
          colorMode: 'color',
          sides: 'single'
        }
      ];

      const filter: ReportFilter = { period: '7d', timezone: 'Asia/Kolkata' };
      const dateRange = computeFilterDateRange(filter, FIXED_REF_DATE);

      const result = aggregateReportsData(DEMO_SHOP_ID, records, filter, dateRange);

      expect(result.revenue.completedRevenuePaise).toBe(5000);
      expect(result.revenue.completedOrdersCount).toBe(1);
      expect(result.jobs.length).toBe(1);
      expect(result.jobs[0]?.shopId).toBe(DEMO_SHOP_ID);
      expect(result.jobs.some(j => j.shopId === OTHER_SHOP_ID)).toBe(false);
    });

    it('throws TENANT_ISOLATION_ERROR if shopId is empty or undefined in service', async () => {
      const service = new OwnerAnalyticsService();
      const filter: ReportFilter = { period: 'today', timezone: 'Asia/Kolkata' };

      await expect(service.fetchOwnerReports('', filter)).rejects.toThrow(
        /TENANT_ISOLATION_ERROR/
      );
    });
  });

  describe('4. Separate Paid vs Completed Records', () => {
    it('distinguishes paid revenue from completed print revenue', () => {
      const records: PaidVsCompletedJobRecord[] = [
        // 1: Completed and Paid
        {
          jobId: 'job-1',
          shopId: DEMO_SHOP_ID,
          customerName: 'Alice',
          documentName: 'DocA.pdf',
          priorityTier: 'urgent',
          amountPaise: 7000,
          paymentStatus: 'paid',
          paymentMethod: 'upi',
          jobStatus: 'completed',
          createdAt: FIXED_REF_DATE.toISOString(),
          waitMinutes: 5,
          pages: 10,
          copies: 1,
          colorMode: 'bw',
          sides: 'single'
        },
        // 2: Paid but still in queue (Printing pending)
        {
          jobId: 'job-2',
          shopId: DEMO_SHOP_ID,
          customerName: 'Bob',
          documentName: 'DocB.pdf',
          priorityTier: 'flexible',
          amountPaise: 3000,
          paymentStatus: 'paid',
          paymentMethod: 'card',
          jobStatus: 'queued',
          createdAt: FIXED_REF_DATE.toISOString(),
          pages: 5,
          copies: 1,
          colorMode: 'color',
          sides: 'double'
        },
        // 3: Pay at counter pending (Neither paid nor completed)
        {
          jobId: 'job-3',
          shopId: DEMO_SHOP_ID,
          customerName: 'Charlie',
          documentName: 'DocC.pdf',
          priorityTier: 'flexible',
          amountPaise: 2000,
          paymentStatus: 'pay_at_counter_pending',
          paymentMethod: 'pay_at_counter',
          jobStatus: 'queued',
          createdAt: FIXED_REF_DATE.toISOString(),
          pages: 2,
          copies: 1,
          colorMode: 'bw',
          sides: 'single'
        },
        // 4: Cancelled & Refunded
        {
          jobId: 'job-4',
          shopId: DEMO_SHOP_ID,
          customerName: 'Diana',
          documentName: 'DocD.pdf',
          priorityTier: 'flexible',
          amountPaise: 1500,
          paymentStatus: 'refunded',
          paymentMethod: 'upi',
          jobStatus: 'cancelled',
          createdAt: FIXED_REF_DATE.toISOString(),
          pages: 1,
          copies: 1,
          colorMode: 'bw',
          sides: 'single'
        }
      ];

      const filter: ReportFilter = { period: '7d', timezone: 'Asia/Kolkata' };
      const dateRange = computeFilterDateRange(filter, FIXED_REF_DATE);
      const result = aggregateReportsData(DEMO_SHOP_ID, records, filter, dateRange);

      // Fulfilled Completed: only job 1 -> ₹70.00
      expect(result.revenue.completedRevenuePaise).toBe(7000);
      expect(result.revenue.completedOrdersCount).toBe(1);

      // Collected Payments: jobs 1 and 2 -> 7000 + 3000 = ₹100.00
      expect(result.revenue.paidRevenuePaise).toBe(10000);
      expect(result.revenue.paidOrdersCount).toBe(2);

      // Pending (Paid but awaiting print completion): job 2 -> ₹30.00
      expect(result.revenue.pendingRevenuePaise).toBe(3000);
      expect(result.revenue.pendingOrdersCount).toBe(2); // job 2 + job 3

      // Refunded: job 4 -> ₹15.00
      expect(result.revenue.refundedPaise).toBe(1500);

      // Average Order Value = 10000 / 2 = 5000 (₹50.00)
      expect(result.revenue.averageOrderValuePaise).toBe(5000);

      // Sheets printed: job 1 (10 single pages * 1 copy = 10 sheets)
      expect(result.operations.totalPrintedSheets).toBe(10);
    });
  });

  describe('5. Operational Metrics: Wait Time and Peak Demand', () => {
    it('computes average and median wait times for completed prints', () => {
      const records: PaidVsCompletedJobRecord[] = [
        {
          jobId: 'j1',
          shopId: DEMO_SHOP_ID,
          customerName: 'Cust 1',
          documentName: 'd1.pdf',
          priorityTier: 'flexible',
          amountPaise: 1000,
          paymentStatus: 'paid',
          jobStatus: 'completed',
          waitMinutes: 2,
          createdAt: FIXED_REF_DATE.toISOString(),
          pages: 1,
          copies: 1,
          colorMode: 'bw',
          sides: 'single'
        },
        {
          jobId: 'j2',
          shopId: DEMO_SHOP_ID,
          customerName: 'Cust 2',
          documentName: 'd2.pdf',
          priorityTier: 'flexible',
          amountPaise: 1000,
          paymentStatus: 'paid',
          jobStatus: 'completed',
          waitMinutes: 4,
          createdAt: FIXED_REF_DATE.toISOString(),
          pages: 1,
          copies: 1,
          colorMode: 'bw',
          sides: 'single'
        },
        {
          jobId: 'j3',
          shopId: DEMO_SHOP_ID,
          customerName: 'Cust 3',
          documentName: 'd3.pdf',
          priorityTier: 'urgent',
          amountPaise: 1000,
          paymentStatus: 'paid',
          jobStatus: 'completed',
          waitMinutes: 9,
          createdAt: FIXED_REF_DATE.toISOString(),
          pages: 1,
          copies: 1,
          colorMode: 'bw',
          sides: 'single'
        }
      ];

      const filter: ReportFilter = { period: '7d', timezone: 'Asia/Kolkata' };
      const dateRange = computeFilterDateRange(filter, FIXED_REF_DATE);
      const result = aggregateReportsData(DEMO_SHOP_ID, records, filter, dateRange);

      // (2 + 4 + 9) / 3 = 15 / 3 = 5
      expect(result.operations.averageWaitMinutes).toBe(5);
      // Median of [2, 4, 9] = 4
      expect(result.operations.medianWaitMinutes).toBe(4);
    });

    it('identifies the peak demand hour correctly', () => {
      // 3 jobs at 11:xx AM, 1 job at 14:xx PM
      const h11 = new Date('2026-10-21T11:15:00+05:30');
      const h14 = new Date('2026-10-21T14:20:00+05:30');

      const records: PaidVsCompletedJobRecord[] = [
        {
          jobId: 'p1',
          shopId: DEMO_SHOP_ID,
          customerName: 'Cust 1',
          documentName: 'doc1.pdf',
          priorityTier: 'flexible',
          amountPaise: 2000,
          paymentStatus: 'paid',
          jobStatus: 'completed',
          createdAt: h11.toISOString(),
          pages: 1,
          copies: 1,
          colorMode: 'bw',
          sides: 'single'
        },
        {
          jobId: 'p2',
          shopId: DEMO_SHOP_ID,
          customerName: 'Cust 2',
          documentName: 'doc2.pdf',
          priorityTier: 'urgent',
          amountPaise: 2000,
          paymentStatus: 'paid',
          jobStatus: 'completed',
          createdAt: h11.toISOString(),
          pages: 1,
          copies: 1,
          colorMode: 'bw',
          sides: 'single'
        },
        {
          jobId: 'p3',
          shopId: DEMO_SHOP_ID,
          customerName: 'Cust 3',
          documentName: 'doc3.pdf',
          priorityTier: 'flexible',
          amountPaise: 2000,
          paymentStatus: 'paid',
          jobStatus: 'completed',
          createdAt: h11.toISOString(),
          pages: 1,
          copies: 1,
          colorMode: 'bw',
          sides: 'single'
        },
        {
          jobId: 'p4',
          shopId: DEMO_SHOP_ID,
          customerName: 'Cust 4',
          documentName: 'doc4.pdf',
          priorityTier: 'flexible',
          amountPaise: 2000,
          paymentStatus: 'paid',
          jobStatus: 'completed',
          createdAt: h14.toISOString(),
          pages: 1,
          copies: 1,
          colorMode: 'bw',
          sides: 'single'
        }
      ];

      const filter: ReportFilter = { period: 'today', timezone: 'Asia/Kolkata' };
      const dateRange = computeFilterDateRange(filter, FIXED_REF_DATE);
      const result = aggregateReportsData(DEMO_SHOP_ID, records, filter, dateRange);

      expect(result.operations.peakDemandHour).not.toBeNull();
      expect(result.operations.peakDemandHour?.hour).toBe(11);
      expect(result.operations.peakDemandHour?.label).toBe('11:00 AM');
      expect(result.operations.peakDemandHour?.orderCount).toBe(3);
    });
  });

  describe('6. Offline Fallback & Mock Fixtures', () => {
    it('generates consistent mock job fixtures across date ranges', () => {
      const fixtures = generateMockJobRecords(DEMO_SHOP_ID, FIXED_REF_DATE);
      expect(fixtures.length).toBeGreaterThanOrEqual(9);
      expect(fixtures.every(f => f.shopId === DEMO_SHOP_ID)).toBe(true);
      expect(fixtures.some(f => f.jobStatus === 'completed')).toBe(true);
      expect(fixtures.some(f => f.paymentStatus === 'paid' && f.jobStatus !== 'completed')).toBe(true);
    });

    it('returns contract-compliant report data using fallback fixtures when fetch fails', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network connection failed'));
      const service = new OwnerAnalyticsService({
        customFetch: mockFetch as unknown as typeof fetch
      });

      const filter: ReportFilter = { period: '7d', timezone: 'Asia/Kolkata' };
      const data = await service.fetchOwnerReports(DEMO_SHOP_ID, filter, undefined, FIXED_REF_DATE);

      expect(data).toBeDefined();
      expect(data.shopId).toBe(DEMO_SHOP_ID);
      expect(data.revenue.paidRevenuePaise).toBeGreaterThan(0);
      expect(data.revenue.completedRevenuePaise).toBeGreaterThan(0);
      expect(data.dailyTrends.length).toBeGreaterThan(0);
      expect(data.jobs.length).toBeGreaterThan(0);
    });

    it('handles empty job set gracefully with zero counts and null peak demand', () => {
      const filter: ReportFilter = { period: 'today', timezone: 'Asia/Kolkata' };
      const dateRange = computeFilterDateRange(filter, FIXED_REF_DATE);
      const result = aggregateReportsData(DEMO_SHOP_ID, [], filter, dateRange);

      expect(result.revenue.completedRevenuePaise).toBe(0);
      expect(result.revenue.paidRevenuePaise).toBe(0);
      expect(result.revenue.paidOrdersCount).toBe(0);
      expect(result.revenue.completedOrdersCount).toBe(0);
      expect(result.operations.averageWaitMinutes).toBe(0);
      expect(result.operations.peakDemandHour).toBeNull();
      expect(result.dailyTrends).toEqual([]);
      expect(result.jobs).toEqual([]);
    });
  });
});
