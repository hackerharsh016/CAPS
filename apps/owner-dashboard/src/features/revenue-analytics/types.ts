/**
 * Types and Data Contracts for CAPS Owner Sales and Operations Reports (P05-M05-F01).
 *
 * Invariants:
 * - All monetary values are strictly represented in integer paise (1 INR = 100 paise)
 *   to avoid IEEE-754 floating-point inaccuracies.
 * - Timezone defaults to shop standard ('Asia/Kolkata' / IST).
 * - Distinguishes between Paid records (revenue collected) and Completed records (print physically fulfilled).
 */

export type PeriodPreset = 'today' | '7d' | '30d' | 'this_month' | 'custom';

export type PaymentMethodType = 'upi' | 'card' | 'wallet' | 'pay_at_counter';
export type PaymentStatusType = 'paid' | 'pay_at_counter_pending' | 'refunded' | 'failed';
export type JobStatusType = 'completed' | 'queued' | 'printing' | 'cancelled' | 'failed' | 'downloading' | 'claimed';

export interface ReportFilter {
  period: PeriodPreset;
  customStartDate?: string | undefined; // YYYY-MM-DD or ISO
  customEndDate?: string | undefined;   // YYYY-MM-DD or ISO
  timezone: string;                     // e.g. 'Asia/Kolkata'
}

export interface PaidVsCompletedJobRecord {
  jobId: string;
  shopId: string;
  customerName: string;
  documentName: string;
  priorityTier: 'urgent' | 'flexible';
  amountPaise: number;
  paymentStatus: PaymentStatusType;
  paymentMethod?: PaymentMethodType | undefined;
  jobStatus: JobStatusType;
  enqueuedAt?: string | undefined;
  completedAt?: string | undefined;
  waitMinutes?: number | undefined;
  pages: number;
  copies: number;
  colorMode: 'bw' | 'color';
  sides: 'single' | 'double';
  createdAt: string;
}

export interface RevenueSummary {
  completedRevenuePaise: number;  // Fulfilled printing revenue
  paidRevenuePaise: number;       // All verified collected payments
  pendingRevenuePaise: number;    // Paid but not yet completed (in queue/printing)
  refundedPaise: number;
  completedOrdersCount: number;
  paidOrdersCount: number;
  pendingOrdersCount: number;     // Active unfinished orders
  cancelledOrFailedCount: number;
  averageOrderValuePaise: number; // Based on paid orders
}

export interface HourlyDistributionPoint {
  hour: number;        // 0 - 23
  label: string;       // e.g. "11:00 AM"
  orderCount: number;
  revenuePaise: number;
}

export interface PeakDemandSummary {
  hour: number;
  label: string;
  orderCount: number;
}

export interface OperationsSummary {
  averageWaitMinutes: number;
  medianWaitMinutes: number;
  peakDemandHour: PeakDemandSummary | null;
  hourlyDistribution: HourlyDistributionPoint[];
  priorityBreakdown: {
    urgent: { count: number; revenuePaise: number };
    flexible: { count: number; revenuePaise: number };
  };
  colorBreakdown: {
    bw: number;
    color: number;
  };
  totalPrintedSheets: number;
}

export interface PaymentMethodSummary {
  count: number;
  amountPaise: number;
}

export interface PaymentBreakdown {
  byMethod: Record<PaymentMethodType, PaymentMethodSummary>;
}

export interface DailyTrendPoint {
  date: string;                   // YYYY-MM-DD in shop timezone
  label: string;                  // e.g. "Oct 21"
  paidRevenuePaise: number;
  completedRevenuePaise: number;
  orderCount: number;
  completedCount: number;
}

export interface OwnerReportsData {
  shopId: string;
  timezone: string;
  filter: ReportFilter;
  dateRange: {
    start: string; // ISO
    end: string;   // ISO
  };
  revenue: RevenueSummary;
  operations: OperationsSummary;
  payments: PaymentBreakdown;
  dailyTrends: DailyTrendPoint[];
  jobs: PaidVsCompletedJobRecord[];
}
