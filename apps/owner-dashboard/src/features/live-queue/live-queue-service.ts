/**
 * Authoritative Shop Queue Service for CAPS Owner Dashboard.
 * Interacts with backend RPC get_shop_queue and provides contract-first fixtures.
 */

import type { QueueItem } from './types';
import { calculateQueuePositions, computeQueueETAs } from './queue-sort';
import { getSupabaseEnv } from '../../lib/supabase';

export interface LiveQueueServiceConfig {
  customFetch?: typeof fetch | undefined;
  supabaseUrl?: string | undefined;
  supabaseAnonKey?: string | undefined;
}

export class LiveQueueService {
  private readonly supabaseUrl: string;
  private readonly supabaseAnonKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(config?: LiveQueueServiceConfig) {
    const env = getSupabaseEnv();
    this.supabaseUrl = (config?.supabaseUrl ?? env.supabaseUrl).replace(/\/$/, '');
    this.supabaseAnonKey = config?.supabaseAnonKey ?? env.supabaseAnonKey;
    this.fetchFn =
      config?.customFetch ??
      (typeof fetch !== 'undefined'
        ? fetch.bind(globalThis)
        : (undefined as unknown as typeof fetch));
  }

  /**
   * Authoritative query to fetch prioritized queue items for a shop.
   */
  async fetchShopQueue(shopId: string, accessToken?: string): Promise<QueueItem[]> {
    if (!shopId) {
      return [];
    }

    const apiUrl =
      typeof process !== 'undefined'
        ? process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000'
        : 'http://localhost:4000';

    // 1. Try live Cloud API priority queue endpoint
    try {
      const apiHeaders: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (accessToken) {
        apiHeaders['Authorization'] = `Bearer ${accessToken}`;
      }
      const apiRes = await this.fetchFn(`${apiUrl}/api/v1/shops/${shopId}/queue`, {
        method: 'GET',
        headers: apiHeaders
      });
      if (apiRes.ok) {
        const json = await apiRes.json();
        const queueList = Array.isArray(json.data?.queue)
          ? json.data.queue
          : Array.isArray(json.queue)
            ? json.queue
            : Array.isArray(json.data)
              ? json.data
              : Array.isArray(json)
                ? json
                : [];
        const currentlyPrinting = json.data?.currently_printing || json.currently_printing;
        const rawItems = [
          ...(currentlyPrinting ? [currentlyPrinting] : []),
          ...queueList
        ];

        if (Array.isArray(rawItems) && rawItems.length > 0) {
          const mappedItems: QueueItem[] = rawItems
            .filter(item => (item.shop_id || shopId) === shopId)
            .map(item => {
            const rawSides = item.settings?.sides || (item.duplex ? 'double' : 'single');
            const docName =
              item.document_name ||
              (item.document_storage_key ? item.document_storage_key.split('/').pop() : 'document.pdf');
            const custName = item.customer?.name || item.customer_name || 'Customer';
            const custPhone = item.customer?.phone || item.customer_phone || '';

            return {
              id: item.id,
              shop_id: item.shop_id || shopId,
              customer_id: item.customer_id || 'customer-anonymous',
              customer_name: custName,
              customer_phone: custPhone,
              printer_id: item.printer_id,
              printer_name: item.printer_name,
              document_name: docName,
              document_storage_key: item.document_storage_key || '',
              settings: {
                paper_size: item.settings?.paper_size || 'A4',
                color_mode: item.settings?.color_mode || (item.color_mode === 'color' ? 'color' : 'bw'),
                sides: rawSides === 'double' ? 'double' : 'single',
                orientation: item.settings?.orientation || 'portrait',
                copies: Number(item.settings?.copies || item.copies) || 1,
                page_range: item.settings?.page_range || 'all',
                binding: item.settings?.binding || item.binding || 'none'
              },
              priority_tier: item.priority_tier || 'flexible',
              price_total_paise: item.price_total_paise || 0,
              price_breakdown: item.price_breakdown || {
                base_pages_paise: item.price_total_paise || 0,
                color_surcharge_paise: 0,
                duplex_discount_paise: 0,
                binding_fee_paise: 0,
                urgent_surcharge_paise: 0,
                subtotal_paise: item.price_total_paise || 0,
                gst_paise: 0,
                total_paise: item.price_total_paise || 0
              },
              status: item.status || 'queued',
              payment_status: item.payment_status || 'paid',
              queue_position: item.queue_position ?? 0,
              is_currently_executing:
                item.is_currently_executing ||
                item.status === 'printing' ||
                item.status === 'downloading' ||
                item.status === 'claimed',
              estimated_wait_minutes:
                typeof item.estimated_wait_minutes === 'number'
                  ? item.estimated_wait_minutes
                  : Math.round((item.estimated_wait_seconds || 0) / 60),
              enqueued_at: item.enqueued_at || item.created_at || new Date().toISOString(),
              created_at: item.created_at || new Date().toISOString(),
              updated_at: item.updated_at || new Date().toISOString()
            };
          });
          return computeQueueETAs(calculateQueuePositions(mappedItems));
        } else if (Array.isArray(rawItems) && rawItems.length === 0) {
          return [];
        }
      }
    } catch {
      // Continue to Supabase RPC / table query
    }

    // 2. Fallback to direct Supabase print_jobs table query
    try {
      const tableHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        apikey: this.supabaseAnonKey
      };
      if (accessToken) {
        tableHeaders['Authorization'] = `Bearer ${accessToken}`;
      }
      const tableUrl = `${this.supabaseUrl}/rest/v1/print_jobs?shop_id=eq.${shopId}&status=in.(queued,approved,claimed,downloading,printing)&select=*,customer:profiles(id,name,phone)&order=created_at.asc`;
      const tableRes = await this.fetchFn(tableUrl, {
        method: 'GET',
        headers: tableHeaders
      });

      if (tableRes.ok) {
        const rows = (await tableRes.json()) as any[];
        if (Array.isArray(rows)) {
          if (rows.length === 0) {
            return [];
          }
          const mappedItems: QueueItem[] = rows
            .filter(item => (item.shop_id || shopId) === shopId)
            .map(item => {
            const rawSides = item.settings?.sides || 'single';
            const docName =
              item.document_name ||
              (item.document_storage_key ? item.document_storage_key.split('/').pop() : 'document.pdf');
            const custName = item.customer?.name || item.customer_name || 'Customer';
            const custPhone = item.customer?.phone || item.customer_phone || '';

            return {
              id: item.id,
              shop_id: item.shop_id || shopId,
              customer_id: item.customer_id || 'customer-anonymous',
              customer_name: custName,
              customer_phone: custPhone,
              printer_id: item.printer_id,
              printer_name: item.printer_name,
              document_name: docName,
              document_storage_key: item.document_storage_key || '',
              settings: {
                paper_size: item.settings?.paper_size || 'A4',
                color_mode: item.settings?.color_mode || 'bw',
                sides: rawSides === 'double' ? 'double' : 'single',
                orientation: item.settings?.orientation || 'portrait',
                copies: Number(item.settings?.copies) || 1,
                page_range: item.settings?.page_range || 'all',
                binding: item.settings?.binding || 'none'
              },
              priority_tier: item.priority_tier || 'flexible',
              price_total_paise: item.price_total_paise || 0,
              price_breakdown: item.price_breakdown || {
                base_pages_paise: item.price_total_paise || 0,
                color_surcharge_paise: 0,
                duplex_discount_paise: 0,
                binding_fee_paise: 0,
                urgent_surcharge_paise: 0,
                subtotal_paise: item.price_total_paise || 0,
                gst_paise: 0,
                total_paise: item.price_total_paise || 0
              },
              status: item.status || 'queued',
              payment_status: item.payment_status || 'paid',
              queue_position: item.queue_position ?? 0,
              is_currently_executing:
                item.status === 'printing' || item.status === 'downloading' || item.status === 'claimed',
              estimated_wait_minutes: item.estimated_wait_minutes ?? 0,
              enqueued_at: item.enqueued_at || item.created_at || new Date().toISOString(),
              created_at: item.created_at || new Date().toISOString(),
              updated_at: item.updated_at || new Date().toISOString()
            };
          });
          return computeQueueETAs(calculateQueuePositions(mappedItems));
        }
      }
    } catch {
      // Continue to Supabase RPC
    }

    const endpoint = `${this.supabaseUrl}/rest/v1/rpc/get_shop_queue`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.supabaseAnonKey
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    try {
      const response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ p_shop_id: shopId })
      });

      if (!response.ok) {
        return [];
      }

      const rawItems = (await response.json()) as QueueItem[];
      if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return [];
      }
      return computeQueueETAs(calculateQueuePositions(rawItems));
    } catch {
      return [];
    }
  }

  /**
   * Fetches authoritative today metrics (completed jobs count, settled revenue, pages dispatched).
   */
  async fetchTodayMetrics(
    shopId: string,
    accessToken?: string
  ): Promise<{ todayCompletedCount: number; todayRevenuePaise: number; todayPagesDispatched: number }> {
    if (!shopId) {
      return { todayCompletedCount: 0, todayRevenuePaise: 0, todayPagesDispatched: 0 };
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayIso = startOfDay.toISOString();

    const params = new URLSearchParams({
      shop_id: `eq.${shopId}`,
      status: 'eq.completed',
      updated_at: `gte.${startOfDayIso}`,
      select: 'id,price_total_paise,settings'
    });

    const endpoint = `${this.supabaseUrl}/rest/v1/print_jobs?${params.toString()}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.supabaseAnonKey
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    try {
      const response = await this.fetchFn(endpoint, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        return { todayCompletedCount: 0, todayRevenuePaise: 0, todayPagesDispatched: 0 };
      }

      const rows = (await response.json()) as Array<{
        id: string;
        price_total_paise?: number;
        settings?: { copies?: number; page_range?: string };
      }>;

      if (!Array.isArray(rows) || rows.length === 0) {
        return { todayCompletedCount: 0, todayRevenuePaise: 0, todayPagesDispatched: 0 };
      }

      let todayRevenuePaise = 0;
      let todayPagesDispatched = 0;

      for (const row of rows) {
        todayRevenuePaise += Number(row.price_total_paise) || 0;
        const copies = Number(row.settings?.copies) || 1;
        const pageRange = row.settings?.page_range || 'all';
        let pageCount = 1;
        if (pageRange !== 'all') {
          const match = pageRange.match(/^(\d+)-(\d+)$/);
          if (match && match[1] && match[2]) {
            const start = parseInt(match[1], 10);
            const end = parseInt(match[2], 10);
            if (!isNaN(start) && !isNaN(end) && end >= start) {
              pageCount = end - start + 1;
            }
          } else if (pageRange.includes(',')) {
            pageCount = pageRange.split(',').filter(p => p.trim()).length || 1;
          }
        }
        todayPagesDispatched += pageCount * copies;
      }

      return {
        todayCompletedCount: rows.length,
        todayRevenuePaise,
        todayPagesDispatched
      };
    } catch {
      return { todayCompletedCount: 0, todayRevenuePaise: 0, todayPagesDispatched: 0 };
    }
  }
}
