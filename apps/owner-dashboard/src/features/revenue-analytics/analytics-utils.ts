/**
 * Analytics Utility Functions for CAPS Owner Reports (P05-M05-F01).
 *
 * Implements:
 * - Integer paise arithmetic (no floating point penny rounding drift)
 * - INR currency formatting
 * - Timezone-aware date calculations (defaulting to Asia/Kolkata)
 * - Wait time computations (average, median)
 * - Peak demand hour identification
 * - Daily trends aggregation
 */

import type {
  ReportFilter,
  PaidVsCompletedJobRecord,
  RevenueSummary,
  OperationsSummary,
  PaymentBreakdown,
  DailyTrendPoint,
  PeakDemandSummary,
  OwnerReportsData,
  PaymentMethodType
} from './types';

export const DEFAULT_SHOP_TIMEZONE = 'Asia/Kolkata';

/**
 * Formats integer paise into Indian Rupee display format.
 * e.g., 7200 paise -> "₹72.00"
 */
export function formatPaiseToINR(paise: number): string {
  const safePaise = Math.round(paise) || 0;
  const isNegative = safePaise < 0;
  const absPaise = Math.abs(safePaise);
  const rupees = Math.floor(absPaise / 100);
  const remainderPaise = absPaise % 100;
  const formattedPaise = remainderPaise.toString().padStart(2, '0');

  // Format integer rupees with Indian number grouping (1,00,000)
  const rupeesStr = rupees.toLocaleString('en-IN');
  return `${isNegative ? '-' : ''}₹${rupeesStr}.${formattedPaise}`;
}

/**
 * Formats wait time in minutes into a human-readable duration.
 * e.g., 4.5 minutes -> "4m 30s", 12 -> "12m"
 */
export function formatWaitMinutes(minutes: number): string {
  if (minutes <= 0 || isNaN(minutes)) {
    return '0m';
  }
  const wholeMinutes = Math.floor(minutes);
  const seconds = Math.round((minutes - wholeMinutes) * 60);
  if (seconds === 0) {
    return `${wholeMinutes}m`;
  }
  if (wholeMinutes === 0) {
    return `${seconds}s`;
  }
  return `${wholeMinutes}m ${seconds}s`;
}

/**
 * Returns the calendar date string (YYYY-MM-DD) for a date in a given timezone.
 */
export function getShopTimezoneDateString(date: Date | string | number, timezone = DEFAULT_SHOP_TIMEZONE): string {
  const d = typeof date === 'object' ? date : new Date(date);
  if (isNaN(d.getTime())) {
    return '1970-01-01';
  }

  // Format in ISO-like YYYY-MM-DD using Intl.DateTimeFormat in specified timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(d);
}

/**
 * Returns the hour of day (0-23) for a date in the given timezone.
 */
export function getHourInShopTimezone(date: Date | string | number, timezone = DEFAULT_SHOP_TIMEZONE): number {
  const d = typeof date === 'object' ? date : new Date(date);
  if (isNaN(d.getTime())) {
    return 0;
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false
  });
  const hourStr = formatter.format(d);
  const parsed = parseInt(hourStr, 10);
  return isNaN(parsed) ? 0 : parsed % 24;
}

/**
 * Formats an hour index into a 12-hour clock label (e.g. 11 -> "11:00 AM", 15 -> "3:00 PM").
 */
export function formatHourLabel(hour: number): string {
  const h = hour % 24;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}:00 ${ampm}`;
}

/**
 * Computes exact start and end UTC timestamps for a report filter relative to reference date.
 */
export function computeFilterDateRange(filter: ReportFilter, referenceDate = new Date()): { start: Date; end: Date } {
  const tz = filter.timezone || DEFAULT_SHOP_TIMEZONE;

  if (filter.period === 'custom' && filter.customStartDate && filter.customEndDate) {
    const start = new Date(filter.customStartDate);
    const end = new Date(filter.customEndDate);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      // Ensure end includes full day if only date is passed
      if (filter.customEndDate.length === 10) {
        end.setHours(23, 59, 59, 999);
      }
      return { start, end };
    }
  }

  // Calculate day boundaries in the shop's timezone
  const todayStr = getShopTimezoneDateString(referenceDate, tz);
  const [yearStr, monthStr, dayStr] = todayStr.split('-');
  const currentYear = parseInt(yearStr ?? '2026', 10);
  const currentMonth = parseInt(monthStr ?? '10', 10) - 1; // 0-indexed
  const currentDay = parseInt(dayStr ?? '1', 10);

  if (filter.period === 'today') {
    // 00:00:00 to 23:59:59 of current day in shop tz
    // Create UTC baseline approximations then offset
    const start = new Date(Date.UTC(currentYear, currentMonth, currentDay, 0, 0, 0, 0));
    // Compensate for IST (+05:30)
    const tzOffsetMinutes = tz === 'Asia/Kolkata' ? 330 : 0;
    const startUtc = new Date(start.getTime() - tzOffsetMinutes * 60 * 1000);
    const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000 - 1);
    return { start: startUtc, end: endUtc };
  }

  if (filter.period === '7d') {
    const end = new Date(referenceDate);
    const start = new Date(referenceDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  if (filter.period === '30d') {
    const end = new Date(referenceDate);
    const start = new Date(referenceDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  if (filter.period === 'this_month') {
    const start = new Date(currentYear, currentMonth, 1, 0, 0, 0, 0);
    const end = new Date(referenceDate);
    return { start, end };
  }

  // Default fallback 7d
  const end = new Date(referenceDate);
  const start = new Date(referenceDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Pure aggregation function calculating complete sales & operations reports from raw job records.
 */
export function aggregateReportsData(
  shopId: string,
  records: PaidVsCompletedJobRecord[],
  filter: ReportFilter,
  dateRange: { start: Date; end: Date }
): OwnerReportsData {
  const tz = filter.timezone || DEFAULT_SHOP_TIMEZONE;

  // Filter strictly by shop_id (Tenant Isolation Invariant)
  const shopRecords = records.filter(job => job.shopId === shopId);

  // Filter within date range
  const startTime = dateRange.start.getTime();
  const endTime = dateRange.end.getTime();

  const inRangeRecords = shopRecords.filter(job => {
    const jobTime = new Date(job.createdAt).getTime();
    return jobTime >= startTime && jobTime <= endTime;
  });

  // 1. Revenue & Order Counts
  let completedRevenuePaise = 0;
  let paidRevenuePaise = 0;
  let pendingRevenuePaise = 0;
  let refundedPaise = 0;
  let completedOrdersCount = 0;
  let paidOrdersCount = 0;
  let pendingOrdersCount = 0;
  let cancelledOrFailedCount = 0;

  // Payment methods tracker
  const methodMap: Record<PaymentMethodType, { count: number; amountPaise: number }> = {
    upi: { count: 0, amountPaise: 0 },
    card: { count: 0, amountPaise: 0 },
    wallet: { count: 0, amountPaise: 0 },
    pay_at_counter: { count: 0, amountPaise: 0 }
  };

  // Operations trackers
  const waitMinutesList: number[] = [];
  const hourlyCountMap = new Array<number>(24).fill(0);
  const hourlyRevenueMap = new Array<number>(24).fill(0);
  let urgentCount = 0;
  let urgentRevenuePaise = 0;
  let flexibleCount = 0;
  let flexibleRevenuePaise = 0;
  let bwCount = 0;
  let colorCount = 0;
  let totalPrintedSheets = 0;

  // Daily Trend aggregation map: dateString -> { paid, completed, totalOrders, completedCount }
  const dailyMap = new Map<string, {
    date: string;
    label: string;
    paidRevenuePaise: number;
    completedRevenuePaise: number;
    orderCount: number;
    completedCount: number;
  }>();

  for (const job of inRangeRecords) {
    const isPaid = job.paymentStatus === 'paid';
    const isCompleted = job.jobStatus === 'completed';
    const isFailedOrCancelled = job.jobStatus === 'failed' || job.jobStatus === 'cancelled';
    const isPending = !isCompleted && !isFailedOrCancelled;

    // Revenue aggregations in strict integer paise
    if (isPaid) {
      paidRevenuePaise += job.amountPaise;
      paidOrdersCount += 1;

      // Track payment methods
      const method = job.paymentMethod || 'upi';
      if (methodMap[method]) {
        methodMap[method].count += 1;
        methodMap[method].amountPaise += job.amountPaise;
      }
    }

    if (job.paymentStatus === 'refunded') {
      refundedPaise += job.amountPaise;
    }

    if (isCompleted) {
      completedRevenuePaise += job.amountPaise;
      completedOrdersCount += 1;

      // Operations: wait time
      if (typeof job.waitMinutes === 'number' && job.waitMinutes >= 0) {
        waitMinutesList.push(job.waitMinutes);
      } else if (job.enqueuedAt && job.completedAt) {
        const enqueueMs = new Date(job.enqueuedAt).getTime();
        const completeMs = new Date(job.completedAt).getTime();
        const diffMinutes = Math.max(0, (completeMs - enqueueMs) / (1000 * 60));
        waitMinutesList.push(diffMinutes);
      }

      // Sheets calculation
      const sheetsPerCopy = job.sides === 'double' ? Math.ceil(job.pages / 2) : job.pages;
      totalPrintedSheets += sheetsPerCopy * (job.copies || 1);
    }

    if (isPending && isPaid) {
      pendingRevenuePaise += job.amountPaise;
      pendingOrdersCount += 1;
    } else if (isPending) {
      pendingOrdersCount += 1;
    }

    if (isFailedOrCancelled) {
      cancelledOrFailedCount += 1;
    }

    // Priority breakdown
    if (job.priorityTier === 'urgent') {
      urgentCount += 1;
      urgentRevenuePaise += job.amountPaise;
    } else {
      flexibleCount += 1;
      flexibleRevenuePaise += job.amountPaise;
    }

    // Color breakdown
    if (job.colorMode === 'color') {
      colorCount += 1;
    } else {
      bwCount += 1;
    }

    // Hourly distribution
    const hour = getHourInShopTimezone(job.createdAt, tz);
    hourlyCountMap[hour] = (hourlyCountMap[hour] ?? 0) + 1;
    hourlyRevenueMap[hour] = (hourlyRevenueMap[hour] ?? 0) + job.amountPaise;

    // Daily trends aggregation
    const dateKey = getShopTimezoneDateString(job.createdAt, tz);
    let dayPoint = dailyMap.get(dateKey);
    if (!dayPoint) {
      // Build date label (e.g. "Oct 21")
      const d = new Date(job.createdAt);
      const label = d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
      dayPoint = {
        date: dateKey,
        label,
        paidRevenuePaise: 0,
        completedRevenuePaise: 0,
        orderCount: 0,
        completedCount: 0
      };
      dailyMap.set(dateKey, dayPoint);
    }
    dayPoint.orderCount += 1;
    if (isPaid) {
      dayPoint.paidRevenuePaise += job.amountPaise;
    }
    if (isCompleted) {
      dayPoint.completedRevenuePaise += job.amountPaise;
      dayPoint.completedCount += 1;
    }
  }

  // 2. Average Order Value
  const averageOrderValuePaise = paidOrdersCount > 0
    ? Math.round(paidRevenuePaise / paidOrdersCount)
    : 0;

  // 3. Wait Times (Average & Median)
  let averageWaitMinutes = 0;
  let medianWaitMinutes = 0;
  if (waitMinutesList.length > 0) {
    const totalWait = waitMinutesList.reduce((sum, val) => sum + val, 0);
    averageWaitMinutes = Math.round((totalWait / waitMinutesList.length) * 10) / 10;

    waitMinutesList.sort((a, b) => a - b);
    const mid = Math.floor(waitMinutesList.length / 2);
    const midVal = waitMinutesList[mid];
    const prevVal = waitMinutesList[mid - 1];
    medianWaitMinutes = waitMinutesList.length % 2 !== 0
      ? (midVal !== undefined ? Math.round(midVal * 10) / 10 : 0)
      : (midVal !== undefined && prevVal !== undefined ? Math.round(((prevVal + midVal) / 2) * 10) / 10 : 0);
  }

  // 4. Peak Demand Hour
  let peakHour: PeakDemandSummary | null = null;
  let maxHourlyCount = 0;
  for (let h = 0; h < 24; h++) {
    const count = hourlyCountMap[h] ?? 0;
    if (count > maxHourlyCount) {
      maxHourlyCount = count;
      peakHour = {
        hour: h,
        label: formatHourLabel(h),
        orderCount: count
      };
    }
  }

  // Hourly distribution array
  const hourlyDistribution = hourlyCountMap.map((count, hour) => ({
    hour,
    label: formatHourLabel(hour),
    orderCount: count,
    revenuePaise: hourlyRevenueMap[hour] ?? 0
  }));

  // Sort daily trends chronologically
  const dailyTrends: DailyTrendPoint[] = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  const revenue: RevenueSummary = {
    completedRevenuePaise,
    paidRevenuePaise,
    pendingRevenuePaise,
    refundedPaise,
    completedOrdersCount,
    paidOrdersCount,
    pendingOrdersCount,
    cancelledOrFailedCount,
    averageOrderValuePaise
  };

  const operations: OperationsSummary = {
    averageWaitMinutes,
    medianWaitMinutes,
    peakDemandHour: peakHour,
    hourlyDistribution,
    priorityBreakdown: {
      urgent: { count: urgentCount, revenuePaise: urgentRevenuePaise },
      flexible: { count: flexibleCount, revenuePaise: flexibleRevenuePaise }
    },
    colorBreakdown: {
      bw: bwCount,
      color: colorCount
    },
    totalPrintedSheets
  };

  const payments: PaymentBreakdown = {
    byMethod: methodMap
  };

  return {
    shopId,
    timezone: tz,
    filter,
    dateRange: {
      start: dateRange.start.toISOString(),
      end: dateRange.end.toISOString()
    },
    revenue,
    operations,
    payments,
    dailyTrends,
    jobs: inRangeRecords
  };
}
