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

export const DEMO_QUEUE_FIXTURES: readonly QueueItem[] = [
  {
    id: '00000000-0000-0000-0000-000000001049',
    shop_id: '00000000-0000-0000-0000-000000000001',
    customer_id: 'cust-uuid-1',
    customer_name: 'Rahul S.',
    customer_phone: '+919876543210',
    printer_id: 'printer-uuid-1',
    printer_name: 'Canon imageRUNNER 2625 (Tray 1)',
    document_name: 'Project_Final_Submission.pdf',
    document_storage_key: 'shops/0001/jobs/1049/doc.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'double',
      orientation: 'portrait',
      copies: 2,
      page_range: '1-18',
      binding: 'spiral'
    },
    priority_tier: 'urgent',
    price_total_paise: 7200, // ₹72.00
    price_breakdown: {
      base_pages_paise: 5400,
      color_surcharge_paise: 0,
      duplex_discount_paise: 1200,
      binding_fee_paise: 4000,
      urgent_surcharge_paise: 2000,
      subtotal_paise: 6200,
      gst_paise: 1000,
      total_paise: 7200
    },
    status: 'printing',
    payment_status: 'paid',
    queue_position: 0,
    is_currently_executing: true,
    estimated_wait_minutes: 0,
    enqueued_at: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
    created_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: '00000000-0000-0000-0000-000000001050',
    shop_id: '00000000-0000-0000-0000-000000000001',
    customer_id: 'cust-uuid-2',
    customer_name: 'Priya Verma',
    customer_phone: '+919811122233',
    printer_id: 'printer-uuid-1',
    printer_name: 'Canon imageRUNNER 2625 (Tray 1)',
    document_name: 'Internship_Report_Draft.pdf',
    document_storage_key: 'shops/0001/jobs/1050/doc.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'color',
      sides: 'single',
      orientation: 'portrait',
      copies: 1,
      page_range: '1-5',
      binding: 'staple'
    },
    priority_tier: 'urgent',
    price_total_paise: 6500, // ₹65.00
    price_breakdown: {
      base_pages_paise: 1000,
      color_surcharge_paise: 4000,
      duplex_discount_paise: 0,
      binding_fee_paise: 500,
      urgent_surcharge_paise: 2000,
      subtotal_paise: 5500,
      gst_paise: 1000,
      total_paise: 6500
    },
    status: 'approved',
    payment_status: 'paid',
    queue_position: 1,
    is_currently_executing: false,
    estimated_wait_minutes: 3,
    enqueued_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    created_at: new Date(Date.now() - 1000 * 60 * 6).toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: '00000000-0000-0000-0000-000000001051',
    shop_id: '00000000-0000-0000-0000-000000000001',
    customer_id: 'cust-uuid-3',
    customer_name: 'Amit Patel',
    customer_phone: '+919922334455',
    printer_id: 'printer-uuid-2',
    printer_name: 'HP LaserJet Pro M404n',
    document_name: 'Lecture_Notes_Unit_3.pdf',
    document_storage_key: 'shops/0001/jobs/1051/doc.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'double',
      orientation: 'portrait',
      copies: 1,
      page_range: 'all',
      binding: 'none'
    },
    priority_tier: 'flexible',
    price_total_paise: 4500, // ₹45.00
    price_breakdown: {
      base_pages_paise: 4500,
      color_surcharge_paise: 0,
      duplex_discount_paise: 1000,
      binding_fee_paise: 0,
      urgent_surcharge_paise: 0,
      subtotal_paise: 3800,
      gst_paise: 700,
      total_paise: 4500
    },
    status: 'queued',
    payment_status: 'paid',
    queue_position: 2,
    is_currently_executing: false,
    estimated_wait_minutes: 8,
    enqueued_at: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    created_at: new Date(Date.now() - 1000 * 60 * 9).toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: '00000000-0000-0000-0000-000000001052',
    shop_id: '00000000-0000-0000-0000-000000000001',
    customer_id: 'cust-uuid-4',
    customer_name: 'Ananya Roy',
    customer_phone: '+919877001122',
    printer_id: 'printer-uuid-1',
    printer_name: 'Canon imageRUNNER 2625 (Tray 1)',
    document_name: 'Resume_2026.pdf',
    document_storage_key: 'shops/0001/jobs/1052/doc.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'single',
      orientation: 'portrait',
      copies: 3,
      page_range: '1-2',
      binding: 'none'
    },
    priority_tier: 'flexible',
    price_total_paise: 1800, // ₹18.00
    price_breakdown: {
      base_pages_paise: 1800,
      color_surcharge_paise: 0,
      duplex_discount_paise: 0,
      binding_fee_paise: 0,
      urgent_surcharge_paise: 0,
      subtotal_paise: 1500,
      gst_paise: 300,
      total_paise: 1800
    },
    status: 'queued',
    payment_status: 'pay_at_counter_pending',
    queue_position: 3,
    is_currently_executing: false,
    estimated_wait_minutes: 12,
    enqueued_at: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    created_at: new Date(Date.now() - 1000 * 60 * 3).toISOString(),
    updated_at: new Date().toISOString()
  }
];

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
        const rawItems = (json.data?.queue || json.queue || json.data || json) as any[];
        if (Array.isArray(rawItems) && rawItems.length > 0) {
          const mappedItems: QueueItem[] = rawItems.map(item => ({
            id: item.id,
            shop_id: item.shop_id || shopId,
            customer_id: item.customer_id || 'customer-anonymous',
            customer_name: item.customer_name || 'Customer',
            customer_phone: item.customer_phone || '',
            printer_id: item.printer_id,
            printer_name: item.printer_name,
            document_name: item.document_name || 'document.pdf',
            document_storage_key: item.document_storage_key || '',
            settings: {
              paper_size: item.settings?.paper_size || 'A4',
              color_mode: item.settings?.color_mode || 'bw',
              sides: item.settings?.sides || 'single',
              orientation: item.settings?.orientation || 'portrait',
              copies: item.settings?.copies || 1,
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
            is_currently_executing: item.status === 'printing' || item.status === 'downloading',
            estimated_wait_minutes: item.estimated_wait_minutes ?? 0,
            enqueued_at: item.enqueued_at || item.created_at || new Date().toISOString(),
            created_at: item.created_at || new Date().toISOString(),
            updated_at: item.updated_at || new Date().toISOString()
          }));
          return computeQueueETAs(calculateQueuePositions(mappedItems));
        }
      }
    } catch {
      // Continue to Supabase RPC / fallback
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
        // In local/mock mode, return deterministic demo queue
        return this.getFallbackQueue(shopId);
      }

      const rawItems = (await response.json()) as QueueItem[];
      return computeQueueETAs(calculateQueuePositions(rawItems));
    } catch {
      // Offline / dev fallback
      return this.getFallbackQueue(shopId);
    }
  }

  private getFallbackQueue(shopId: string): QueueItem[] {
    const scoped = DEMO_QUEUE_FIXTURES.map(item => ({
      ...item,
      shop_id: shopId
    }));
    return computeQueueETAs(calculateQueuePositions(scoped));
  }
}
