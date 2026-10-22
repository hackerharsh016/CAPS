/**
 * Supabase Payments Repository.
 * Production repository backed by Supabase PostgREST database operations for `public.payments`.
 */

import crypto from 'node:crypto';
import type { IPaymentsRepository } from '../../modules/payments/payments.repository.js';
import type {
  PaymentRecord,
  CreatePaymentDto,
  UpdatePaymentDto
} from '../../modules/payments/payments.types.js';
import {
  type SupabaseClientLike,
  type SupabaseRepoOptions,
  createDefaultSupabaseClient
} from './supabase-shops.repository.js';

function mapDbRecordToPayment(row: any): PaymentRecord {
  return {
    id: row.id,
    print_job_id: row.print_job_id,
    amount_paise: row.amount_paise,
    currency: row.currency || 'INR',
    method: row.method,
    gateway_ref: row.gateway_ref || undefined,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at || undefined
  };
}

export class SupabasePaymentsRepository implements IPaymentsRepository {
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

  async findById(id: string): Promise<PaymentRecord | null> {
    const { data, error } = await this.client
      .from('payments')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;
    return mapDbRecordToPayment(data);
  }

  async findByJobId(jobId: string): Promise<PaymentRecord[]> {
    const { data, error } = await this.client
      .from('payments')
      .select('*')
      .eq('print_job_id', jobId)
      .order('created_at', { ascending: false });

    if (error || !data) return [];
    return (data as any[]).map(mapDbRecordToPayment);
  }

  async findByGatewayRef(gatewayRef: string): Promise<PaymentRecord | null> {
    const { data, error } = await this.client
      .from('payments')
      .select('*')
      .eq('gateway_ref', gatewayRef)
      .maybeSingle();

    if (error || !data) return null;
    return mapDbRecordToPayment(data);
  }

  async findAll(): Promise<PaymentRecord[]> {
    const { data, error } = await this.client
      .from('payments')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !data) return [];
    return (data as any[]).map(mapDbRecordToPayment);
  }

  async create(dto: CreatePaymentDto): Promise<PaymentRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const record = {
      id,
      print_job_id: dto.print_job_id,
      amount_paise: dto.amount_paise,
      currency: dto.currency || 'INR',
      method: dto.method,
      gateway_ref: dto.gateway_ref || null,
      status: dto.status || 'initiated',
      created_at: now,
      updated_at: now
    };

    const { data: inserted, error } = await this.client
      .from('payments')
      .insert(record)
      .select()
      .single();

    if (error) {
      // If table insert fails (e.g. mock DB in tests without payments table), fallback gracefully
      throw new Error(
        `Failed to create payment in Supabase: ${error.message || JSON.stringify(error)}`
      );
    }

    return mapDbRecordToPayment(inserted || record);
  }

  async update(id: string, dto: UpdatePaymentDto): Promise<PaymentRecord | null> {
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    };

    if (dto.status !== undefined) updatePayload['status'] = dto.status;
    if (dto.method !== undefined) updatePayload['method'] = dto.method;
    if (dto.amount_paise !== undefined) updatePayload['amount_paise'] = dto.amount_paise;
    if (dto.gateway_ref !== undefined) updatePayload['gateway_ref'] = dto.gateway_ref;

    const { data, error } = await this.client
      .from('payments')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error || !data) return null;
    return mapDbRecordToPayment(data);
  }

  async delete(id: string): Promise<boolean> {
    const { error } = await this.client.from('payments').delete().eq('id', id);
    return !error;
  }
}
