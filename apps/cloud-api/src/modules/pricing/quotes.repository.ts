import crypto from 'node:crypto';
import type { QuoteRecord, QuoteStatus } from './pricing.types.js';

export interface IQuotesRepository {
  create(quote: {
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
  }): Promise<QuoteRecord>;

  findById(id: string): Promise<QuoteRecord | null>;
  findByCustomerId(customerId: string): Promise<QuoteRecord[]>;
  update(id: string, partial: Partial<QuoteRecord>): Promise<QuoteRecord | null>;
  delete(id: string): Promise<boolean>;
  clear(): void;
}

export class MockQuotesRepository implements IQuotesRepository {
  private readonly quotes = new Map<string, QuoteRecord>();

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

    this.quotes.set(id, record);
    return { ...record };
  }

  async findById(id: string): Promise<QuoteRecord | null> {
    const record = this.quotes.get(id);
    return record ? { ...record } : null;
  }

  async findByCustomerId(customerId: string): Promise<QuoteRecord[]> {
    return Array.from(this.quotes.values())
      .filter(q => q.customer_id === customerId)
      .map(q => ({ ...q }));
  }

  async update(id: string, partial: Partial<QuoteRecord>): Promise<QuoteRecord | null> {
    const existing = this.quotes.get(id);
    if (!existing) return null;

    const updated: QuoteRecord = {
      ...existing,
      ...partial
    };

    this.quotes.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<boolean> {
    return this.quotes.delete(id);
  }

  clear(): void {
    this.quotes.clear();
  }
}
