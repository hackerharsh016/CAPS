/**
 * Supabase Job Events Repository.
 * Production repository backed by Supabase PostgREST database operations for `public.job_events`.
 */

import type { IJobEventsRepository } from '../../modules/events/events.repository.js';
import type { JobEvent, CreateJobEventDto } from '../../modules/events/events.types.js';
import {
  type SupabaseClientLike,
  type SupabaseRepoOptions,
  createDefaultSupabaseClient
} from './supabase-shops.repository.js';

function mapDbRecordToEvent(row: any): JobEvent {
  return {
    id: row.id,
    job_id: row.job_id,
    attempt_id: row.attempt_id || undefined,
    actor_type: row.actor_type,
    actor_id: row.actor_id || undefined,
    from_status: row.from_status || undefined,
    to_status: row.to_status,
    event_name: row.event_name,
    metadata: row.metadata || {},
    created_at: row.created_at
  };
}

export class SupabaseJobEventsRepository implements IJobEventsRepository {
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

  async findById(id: number): Promise<JobEvent | null> {
    const { data, error } = await this.client
      .from('job_events')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;
    return mapDbRecordToEvent(data);
  }

  async findByJobId(jobId: string): Promise<JobEvent[]> {
    const { data, error } = await this.client
      .from('job_events')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true });

    if (error || !data) return [];
    return (data as any[]).map(mapDbRecordToEvent);
  }

  async create(dto: CreateJobEventDto): Promise<JobEvent> {
    const row: Record<string, unknown> = {
      job_id: dto.job_id,
      actor_type: dto.actor_type,
      to_status: dto.to_status,
      event_name: dto.event_name
    };

    if (dto.attempt_id) row['attempt_id'] = dto.attempt_id;
    if (dto.actor_id) row['actor_id'] = dto.actor_id;
    if (dto.from_status) row['from_status'] = dto.from_status;
    if (dto.metadata && Object.keys(dto.metadata).length > 0) row['metadata'] = dto.metadata;

    const { data, error } = await this.client
      .from('job_events')
      .insert(row)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create job event: ${error?.message || 'Unknown error'}`);
    }

    return mapDbRecordToEvent(data);
  }
}
