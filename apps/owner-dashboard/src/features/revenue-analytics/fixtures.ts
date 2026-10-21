/**
 * Deterministic Mock Fixtures for CAPS Owner Reports (P05-M05-F01).
 * Generates realistic print job and payment records across daily, weekly, and monthly ranges.
 */

import type { PaidVsCompletedJobRecord } from './types';

export const DEMO_SHOP_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Creates dynamic job fixtures relative to a base reference timestamp.
 * This guarantees consistent test runs regardless of the execution date.
 */
export function generateMockJobRecords(
  shopId = DEMO_SHOP_ID,
  referenceDate = new Date('2026-10-21T12:00:00+05:30')
): PaidVsCompletedJobRecord[] {
  const refMs = referenceDate.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  return [
    // Today: Job 1 - Completed & Paid (Urgent, UPI)
    {
      jobId: '00000000-0000-0000-0000-000000002001',
      shopId,
      customerName: 'Rahul Sharma',
      documentName: 'Project_Final_Report.pdf',
      priorityTier: 'urgent',
      amountPaise: 7200, // ₹72.00
      paymentStatus: 'paid',
      paymentMethod: 'upi',
      jobStatus: 'completed',
      enqueuedAt: new Date(refMs - 2 * hour).toISOString(),
      completedAt: new Date(refMs - 2 * hour + 4 * minute).toISOString(),
      waitMinutes: 4.0,
      pages: 18,
      copies: 2,
      colorMode: 'bw',
      sides: 'double',
      createdAt: new Date(refMs - 2 * hour - 2 * minute).toISOString()
    },
    // Today: Job 2 - Completed & Paid (Flexible, Card)
    {
      jobId: '00000000-0000-0000-0000-000000002002',
      shopId,
      customerName: 'Priya Patel',
      documentName: 'Architectural_Floorplan.pdf',
      priorityTier: 'flexible',
      amountPaise: 15000, // ₹150.00
      paymentStatus: 'paid',
      paymentMethod: 'card',
      jobStatus: 'completed',
      enqueuedAt: new Date(refMs - 1 * hour).toISOString(),
      completedAt: new Date(refMs - 1 * hour + 8 * minute).toISOString(),
      waitMinutes: 8.0,
      pages: 5,
      copies: 1,
      colorMode: 'color',
      sides: 'single',
      createdAt: new Date(refMs - 1 * hour - 1 * minute).toISOString()
    },
    // Today: Job 3 - Paid but Queued (Printing pending, Wallet)
    {
      jobId: '00000000-0000-0000-0000-000000002003',
      shopId,
      customerName: 'Amit Verma',
      documentName: 'Seminar_Slides_Handout.pdf',
      priorityTier: 'flexible',
      amountPaise: 4500, // ₹45.00
      paymentStatus: 'paid',
      paymentMethod: 'wallet',
      jobStatus: 'queued',
      enqueuedAt: new Date(refMs - 15 * minute).toISOString(),
      completedAt: undefined,
      waitMinutes: undefined,
      pages: 12,
      copies: 1,
      colorMode: 'bw',
      sides: 'double',
      createdAt: new Date(refMs - 16 * minute).toISOString()
    },
    // Today: Job 4 - Pay at Counter (Pending payment & printing)
    {
      jobId: '00000000-0000-0000-0000-000000002004',
      shopId,
      customerName: 'Sneha Kulkarni',
      documentName: 'Govt_ID_Proof.pdf',
      priorityTier: 'urgent',
      amountPaise: 2000, // ₹20.00
      paymentStatus: 'pay_at_counter_pending',
      paymentMethod: 'pay_at_counter',
      jobStatus: 'queued',
      enqueuedAt: new Date(refMs - 5 * minute).toISOString(),
      completedAt: undefined,
      waitMinutes: undefined,
      pages: 2,
      copies: 2,
      colorMode: 'bw',
      sides: 'single',
      createdAt: new Date(refMs - 6 * minute).toISOString()
    },
    // Yesterday: Job 5 - Completed & Paid (UPI)
    {
      jobId: '00000000-0000-0000-0000-000000002005',
      shopId,
      customerName: 'Devendra Joshi',
      documentName: 'Thesis_Draft_v3.pdf',
      priorityTier: 'flexible',
      amountPaise: 24000, // ₹240.00
      paymentStatus: 'paid',
      paymentMethod: 'upi',
      jobStatus: 'completed',
      enqueuedAt: new Date(refMs - 1 * day - 4 * hour).toISOString(),
      completedAt: new Date(refMs - 1 * day - 4 * hour + 12 * minute).toISOString(),
      waitMinutes: 12.0,
      pages: 45,
      copies: 1,
      colorMode: 'bw',
      sides: 'double',
      createdAt: new Date(refMs - 1 * day - 4 * hour - 5 * minute).toISOString()
    },
    // Yesterday: Job 6 - Completed & Paid (Card)
    {
      jobId: '00000000-0000-0000-0000-000000002006',
      shopId,
      customerName: 'Ananya Roy',
      documentName: 'Resume_2026.pdf',
      priorityTier: 'flexible',
      amountPaise: 1800, // ₹18.00
      paymentStatus: 'paid',
      paymentMethod: 'card',
      jobStatus: 'completed',
      enqueuedAt: new Date(refMs - 1 * day - 2 * hour).toISOString(),
      completedAt: new Date(refMs - 1 * day - 2 * hour + 3 * minute).toISOString(),
      waitMinutes: 3.0,
      pages: 2,
      copies: 3,
      colorMode: 'bw',
      sides: 'single',
      createdAt: new Date(refMs - 1 * day - 2 * hour - 2 * minute).toISOString()
    },
    // 3 Days Ago: Job 7 - Completed & Paid (UPI, Color)
    {
      jobId: '00000000-0000-0000-0000-000000002007',
      shopId,
      customerName: 'Karan Mehta',
      documentName: 'Design_Portfolio.pdf',
      priorityTier: 'urgent',
      amountPaise: 32000, // ₹320.00
      paymentStatus: 'paid',
      paymentMethod: 'upi',
      jobStatus: 'completed',
      enqueuedAt: new Date(refMs - 3 * day - 3 * hour).toISOString(),
      completedAt: new Date(refMs - 3 * day - 3 * hour + 6 * minute).toISOString(),
      waitMinutes: 6.0,
      pages: 16,
      copies: 1,
      colorMode: 'color',
      sides: 'single',
      createdAt: new Date(refMs - 3 * day - 3 * hour - 1 * minute).toISOString()
    },
    // 5 Days Ago: Job 8 - Cancelled & Refunded
    {
      jobId: '00000000-0000-0000-0000-000000002008',
      shopId,
      customerName: 'Vikas Gupta',
      documentName: 'Accidental_Upload.pdf',
      priorityTier: 'flexible',
      amountPaise: 3500, // ₹35.00
      paymentStatus: 'refunded',
      paymentMethod: 'upi',
      jobStatus: 'cancelled',
      enqueuedAt: new Date(refMs - 5 * day).toISOString(),
      completedAt: undefined,
      waitMinutes: undefined,
      pages: 10,
      copies: 1,
      colorMode: 'bw',
      sides: 'single',
      createdAt: new Date(refMs - 5 * day).toISOString()
    },
    // 10 Days Ago: Job 9 - Completed & Paid
    {
      jobId: '00000000-0000-0000-0000-000000002009',
      shopId,
      customerName: 'Rohan Deshmukh',
      documentName: 'Notes_Module4.pdf',
      priorityTier: 'flexible',
      amountPaise: 6000, // ₹60.00
      paymentStatus: 'paid',
      paymentMethod: 'upi',
      jobStatus: 'completed',
      enqueuedAt: new Date(refMs - 10 * day).toISOString(),
      completedAt: new Date(refMs - 10 * day + 5 * minute).toISOString(),
      waitMinutes: 5.0,
      pages: 15,
      copies: 1,
      colorMode: 'bw',
      sides: 'double',
      createdAt: new Date(refMs - 10 * day).toISOString()
    }
  ];
}
