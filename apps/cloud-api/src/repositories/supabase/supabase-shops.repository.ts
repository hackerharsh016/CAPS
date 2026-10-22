/**
 * Supabase Shops Repository (INT-D3-03).
 * Production repository backed by Supabase PostgREST database operations for `shops` table.
 */

import crypto from 'node:crypto';
import type { IShopsRepository, ShopQueryFilter } from '../../modules/shops/shops.repository.js';
import type { Shop, CreateShopDto, UpdateShopDto } from '../../modules/shops/shops.types.js';

export interface SupabaseClientLike {
  from(table: string): any;
  rpc(functionName: string, params?: Record<string, unknown>): Promise<{ data: any; error: any }>;
}

export interface SupabaseRepoOptions {
  supabaseUrl?: string | undefined;
  supabaseKey?: string | undefined;
  client?: SupabaseClientLike | undefined;
  customFetch?: typeof fetch | undefined;
}

export class SupabaseShopsRepository implements IShopsRepository {
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

  async findById(id: string): Promise<Shop | null> {
    const { data, error } = await this.client.from('shops').select('*').eq('id', id).maybeSingle();

    if (error || !data) return null;
    return mapDbRecordToShop(data);
  }

  async findByOwnerId(ownerId: string): Promise<Shop[]> {
    const { data, error } = await this.client
      .from('shops')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false });

    if (error || !data) return [];
    return (data as any[]).map(mapDbRecordToShop);
  }

  async findAllOpen(): Promise<Shop[]> {
    const { data, error } = await this.client
      .from('shops')
      .select('*')
      .eq('status', 'open')
      .order('name', { ascending: true });

    if (error || !data) return [];
    return (data as any[]).map(mapDbRecordToShop);
  }

  async findAll(filter: ShopQueryFilter = {}): Promise<{ shops: Shop[]; total: number }> {
    let query = this.client.from('shops').select('*', { count: 'exact' });

    if (filter.status) {
      query = query.eq('status', filter.status);
    }

    if (filter.search && filter.search.trim().length > 0) {
      const q = filter.search.trim();
      query = query.or(`name.ilike.%${q}%,address.ilike.%${q}%`);
    }

    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 10;
    query = query.range(offset, offset + limit - 1).order('created_at', { ascending: false });

    const { data, count, error } = await query;
    if (error || !data) return { shops: [], total: 0 };

    return {
      shops: (data as any[]).map(mapDbRecordToShop),
      total: count ?? data.length
    };
  }

  async create(dto: CreateShopDto & { id?: string }): Promise<Shop> {
    const id = dto.id || crypto.randomUUID();
    const now = new Date().toISOString();

    const dbRecord = {
      id,
      owner_id: dto.owner_id,
      name: dto.name,
      address: dto.address,
      geo_lat: dto.geo_lat,
      geo_lng: dto.geo_lng,
      status: 'open',
      pricing_config: dto.pricing_config,
      urgent_surcharge_config: dto.urgent_surcharge_config,
      auto_print_enabled: dto.auto_print_enabled ?? false,
      ...(dto.allow_pay_at_counter !== undefined
        ? { allow_pay_at_counter: dto.allow_pay_at_counter }
        : {}),
      created_at: now,
      updated_at: now
    };

    const { data, error } = await this.client.from('shops').insert(dbRecord).select().single();

    if (error) {
      throw new Error(
        `Failed to insert shop in Supabase: ${error.message || JSON.stringify(error)}`
      );
    }

    return mapDbRecordToShop(data || dbRecord);
  }

  async update(id: string, dto: UpdateShopDto): Promise<Shop | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    };

    if (dto.name !== undefined) updates['name'] = dto.name;
    if (dto.address !== undefined) updates['address'] = dto.address;
    if (dto.geo_lat !== undefined) updates['geo_lat'] = dto.geo_lat;
    if (dto.geo_lng !== undefined) updates['geo_lng'] = dto.geo_lng;
    if (dto.status !== undefined) updates['status'] = dto.status;
    if (dto.pricing_config !== undefined) updates['pricing_config'] = dto.pricing_config;
    if (dto.urgent_surcharge_config !== undefined) {
      updates['urgent_surcharge_config'] = dto.urgent_surcharge_config;
    }
    if (dto.auto_print_enabled !== undefined)
      updates['auto_print_enabled'] = dto.auto_print_enabled;
    if (dto.allow_pay_at_counter !== undefined)
      updates['allow_pay_at_counter'] = dto.allow_pay_at_counter;

    const { data, error } = await this.client
      .from('shops')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to update shop in Supabase: ${error.message || JSON.stringify(error)}`
      );
    }

    return data ? mapDbRecordToShop(data) : null;
  }

  async delete(id: string): Promise<boolean> {
    const { error } = await this.client.from('shops').delete().eq('id', id);
    return !error;
  }
}

function mapDbRecordToShop(row: Record<string, any>): Shop {
  return {
    id: String(row['id']),
    owner_id: String(row['owner_id']),
    name: String(row['name']),
    address: String(row['address']),
    geo_lat: Number(row['geo_lat']),
    geo_lng: Number(row['geo_lng']),
    status: row['status'],
    pricing_config: row['pricing_config'],
    urgent_surcharge_config: row['urgent_surcharge_config'],
    auto_print_enabled: Boolean(row['auto_print_enabled']),
    allow_pay_at_counter:
      row['allow_pay_at_counter'] !== undefined ? Boolean(row['allow_pay_at_counter']) : true,
    created_at: String(row['created_at']),
    updated_at: String(row['updated_at'])
  };
}

export function createDefaultSupabaseClient(
  url: string,
  key: string,
  customFetch: typeof fetch = fetch
): SupabaseClientLike {
  const normalizedUrl = url.replace(/\/+$/, '');

  return {
    from(table: string) {
      return new RestQueryBuilder(`${normalizedUrl}/rest/v1/${table}`, key, customFetch);
    },
    async rpc(fn: string, params: Record<string, unknown> = {}) {
      const endpoint = `${normalizedUrl}/rest/v1/rpc/${fn}`;
      try {
        const res = await customFetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: key,
            Authorization: `Bearer ${key}`
          },
          body: JSON.stringify(params)
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          return { data: null, error: { message: errBody, status: res.status } };
        }
        const data = await res.json().catch(() => null);
        return { data, error: null };
      } catch (err: unknown) {
        return { data: null, error: err };
      }
    }
  };
}

class RestQueryBuilder {
  private filters: Array<{ field: string; op: string; val: string }> = [];
  private orderClauses: string[] = [];
  private limitCount?: number | undefined;
  private offsetCount?: number | undefined;
  private action: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: any = null;
  private isSingle = false;
  private isMaybeSingle = false;

  constructor(
    private readonly baseUrl: string,
    private readonly key: string,
    private readonly customFetch: typeof fetch
  ) {}

  select(_columns = '*', _options: { count?: string } = {}) {
    if (this.action !== 'insert' && this.action !== 'update' && this.action !== 'delete') {
      this.action = 'select';
    }
    return this;
  }

  insert(record: any) {
    this.action = 'insert';
    this.payload = record;
    return this;
  }

  update(record: any) {
    this.action = 'update';
    this.payload = record;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  eq(field: string, val: any) {
    this.filters.push({ field, op: 'eq', val: String(val) });
    return this;
  }

  or(expression: string) {
    this.filters.push({ field: 'or', op: '', val: `(${expression})` });
    return this;
  }

  order(field: string, options: { ascending?: boolean } = {}) {
    const dir = options.ascending === false ? 'desc' : 'asc';
    this.orderClauses.push(`${field}.${dir}`);
    return this;
  }

  range(from: number, to: number) {
    this.offsetCount = from;
    this.limitCount = to - from + 1;
    return this;
  }

  single() {
    this.isSingle = true;
    return this;
  }

  maybeSingle() {
    this.isMaybeSingle = true;
    return this;
  }

  then(onfulfilled: (value: any) => any, onrejected?: (reason: any) => any) {
    return this.execute().then(onfulfilled, onrejected);
  }

  catch(onrejected?: (reason: any) => any) {
    return this.execute().catch(onrejected);
  }

  finally(onfinally?: (() => void) | undefined | null) {
    return this.execute().finally(onfinally);
  }

  private async execute(): Promise<{ data: any; count?: number; error: any }> {
    const url = new URL(this.baseUrl);

    for (const f of this.filters) {
      if (f.field === 'or') {
        url.searchParams.append('or', f.val);
      } else {
        url.searchParams.append(f.field, `${f.op}.${f.val}`);
      }
    }

    if (this.orderClauses.length > 0) {
      url.searchParams.append('order', this.orderClauses.join(','));
    }
    if (this.limitCount !== undefined) {
      url.searchParams.append('limit', String(this.limitCount));
    }
    if (this.offsetCount !== undefined) {
      url.searchParams.append('offset', String(this.offsetCount));
    }

    const headers: Record<string, string> = {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      'Content-Type': 'application/json'
    };

    if (this.action === 'select' || this.action === 'insert' || this.action === 'update') {
      headers['Prefer'] = this.isSingle
        ? 'return=representation,count=exact,vnd.pgrst.object'
        : 'return=representation,count=exact';
    }

    let method = 'GET';
    let body: string | undefined;

    if (this.action === 'insert') {
      method = 'POST';
      body = JSON.stringify(this.payload);
    } else if (this.action === 'update') {
      method = 'PATCH';
      body = JSON.stringify(this.payload);
    } else if (this.action === 'delete') {
      method = 'DELETE';
    }

    try {
      const init: RequestInit = {
        method,
        headers
      };
      if (body) {
        init.body = body;
      }

      const res = await this.customFetch(url.toString(), init);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { data: null, error: { message: text, status: res.status } };
      }

      const json = await res.json().catch(() => null);
      if (this.isMaybeSingle && Array.isArray(json)) {
        return { data: json[0] ?? null, error: null };
      }
      return { data: json, count: Array.isArray(json) ? json.length : 1, error: null };
    } catch (err: unknown) {
      return { data: null, error: err };
    }
  }
}
