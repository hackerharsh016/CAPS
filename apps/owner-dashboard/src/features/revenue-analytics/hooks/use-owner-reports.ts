'use client';

/**
 * React hook for managing CAPS Owner Sales and Operations Reports (P05-M05-F01).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  ReportFilter,
  PeriodPreset,
  OwnerReportsData
} from '../types';
import { DEFAULT_SHOP_TIMEZONE } from '../analytics-utils';
import { OwnerAnalyticsService } from '../analytics-service';

export interface UseOwnerReportsOptions {
  shopId?: string | undefined;
  accessToken?: string | undefined;
  initialPeriod?: PeriodPreset | undefined;
  timezone?: string | undefined;
  service?: OwnerAnalyticsService | undefined;
}

export function useOwnerReports(options: UseOwnerReportsOptions = {}) {
  const {
    shopId,
    accessToken,
    initialPeriod = '7d',
    timezone = DEFAULT_SHOP_TIMEZONE,
    service: customService
  } = options;

  const [filter, setFilter] = useState<ReportFilter>({
    period: initialPeriod,
    timezone
  });

  const [reportsData, setReportsData] = useState<OwnerReportsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const service = useMemo(() => {
    return customService ?? new OwnerAnalyticsService();
  }, [customService]);

  const fetchReports = useCallback(async () => {
    if (!shopId) {
      setReportsData(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await service.fetchOwnerReports(shopId, filter, accessToken);
      setReportsData(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load owner sales and operations reports.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [shopId, filter, accessToken, service]);

  useEffect(() => {
    void fetchReports();
  }, [fetchReports]);

  const setPeriod = useCallback((period: PeriodPreset) => {
    setFilter(prev => ({
      ...prev,
      period,
      // Reset custom dates if switching away from custom
      customStartDate: period === 'custom' ? prev.customStartDate : undefined,
      customEndDate: period === 'custom' ? prev.customEndDate : undefined
    }));
  }, []);

  const setCustomDateRange = useCallback((startDate: string, endDate: string) => {
    setFilter(prev => ({
      ...prev,
      period: 'custom',
      customStartDate: startDate,
      customEndDate: endDate
    }));
  }, []);

  return {
    reportsData,
    isLoading,
    error,
    filter,
    setPeriod,
    setCustomDateRange,
    refresh: fetchReports
  };
}
