/**
 * Supabase Pricing & Quotes Repository (INT-D3-03).
 * Production repository backed by Supabase for quote snapshots and atomic payment events.
 */

import crypto from 'node:crypto';
import type { IQuotesRepository } from '../../modules/pricing/quotes.repository.js';
import type { QuoteRecord, QuoteStatus } from '../../modules/pricing/pricing.types.js';
import {
  type SupabaseClientLike,
  type SupabaseRepoOptions,
  createDefaultSupabaseClient
} from './supabase-shops.repository.js';

export class SupabasePricingRepository implements IQuotesRepository {
  private readonly client: SupabaseClientLike;

  constructor(options: SupabaseRepoOptions = {}) {
    if (options.client) {
      this.client = options.client;
    } else {
      const env = typeof process !== 'undefined' ? process.env : {};
      const url = options.supabaseUrl || env['SUPABASE_URL'] || 'http://localhost:54321';
      const key =
        options.supabaseKey || env['SUPABASE_SERVICE_ROLE_KEY'] || env['SUPABASE_ANON_KEY'] || '';
      const customFetch = options.customFetch || fetch;

      this.client = createDefaultSupabaseClient(url, key, customFetch);
    }
  }

  async create(data: {
    customer_id?: string | undefined;
    shop_id: string;
    document_id?: string | undefined;
    settings: QuoteRecord['settings'];
    priority_tier: QuoteRecord['priority_tier'];
    page_count: number;
    pricing_snapshot: QuoteRecord['pricing_snapshot'];
    price_breakdown: QuoteRecord['price_breakdown'];
    estimated_wait_minutes: number;
    expires_at: string;
    status?: QuoteStatus | undefined;
  }): Promise<QuoteRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const record: QuoteRecord = {
      id,
      ...(data.customer_id !== undefined ? { customer_id: data.customer_id } : {}),
      shop_id: data.shop_id,
      ...(data.document_id !== undefined ? { document_id: data.document_id } : {}),
      settings: { ...data.settings },
      priority_tier: data.priority_tier,
      page_count: data.page_count,
      pricing_snapshot: {
        pricing_config: { ...data.pricing_snapshot.pricing_config },
        urgent_surcharge_config: { ...data.pricing_snapshot.urgent_surcharge_config }
      },
      price_breakdown: { ...data.price_breakdown },
      estimated_wait_minutes: data.estimated_wait_minutes,
      status: data.status ?? 'active',
      created_at: now,
      expires_at: data.expires_at
    };

    const { data: inserted, error } = await this.client
      .from('quotes')
      .insert(record)
      .select()
      .single();

    if (error) {
      return record;
    }
    return inserted || record;
  }

  async findById(id: string): Promise<QuoteRecord | null> {
    const { data, error } = await this.client.from('quotes').select('*').eq('id', id).maybeSingle();

    if (error || !data) return null;
    return data as QuoteRecord;
  }

  async findByCustomerId(customerId: string): Promise<QuoteRecord[]> {
    const { data, error } = await this.client
      .from('quotes')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (error || !data) return [];
    return data as QuoteRecord[];
  }

  async update(id: string, partial: Partial<QuoteRecord>): Promise<QuoteRecord | null> {
    const { data, error } = await this.client
      .from('quotes')
      .update(partial)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error || !data) return null;
    return data as QuoteRecord;
  }

  async delete(id: string): Promise<boolean> {
    const { error } = await this.client.from('quotes').delete().eq('id', id);
    return !error;
  }

  /**
   * Transactional stored procedure call for idempotent payment processing.
   */
  async recordPaymentEventIdempotent(params: {
    payment_id: string;
    job_id: string;
    amount_paise: number;
    payment_method: string;
    status: string;
    idempotency_key?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<{ success: boolean; is_idempotent_replay: boolean; data?: any }> {
    const { data, error } = await this.client.rpc('record_payment_event_idempotent', {
      p_payment_id: params.payment_id,
      p_job_id: params.job_id,
      p_amount_paise: params.amount_paise,
      p_payment_method: params.payment_method,
      p_status: params.status,
      p_idempotency_key: params.idempotency_key ?? null,
      p_metadata: params.metadata ?? {}
    });

    if (error) {
      return { success: false, is_idempotent_replay: false };
    }

    return {
      success: true,
      is_idempotent_replay: Boolean(data?.is_idempotent_replay),
      data
    };
  }

  clear(): void {
    // No-op for persistent db repository
  }
}
