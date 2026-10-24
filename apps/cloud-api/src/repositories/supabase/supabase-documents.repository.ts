/**
 * Supabase Documents Repository.
 * Production repository backed by Supabase PostgREST database operations for `public.documents`.
 */

import crypto from 'node:crypto';
import type {
  IDocumentsRepository,
  CreateDocumentRecordDto
} from '../../modules/documents/documents.repository.js';
import type {
  DocumentMetadata,
  DocumentDeletionLog
} from '../../modules/documents/documents.types.js';
import {
  type SupabaseClientLike,
  type SupabaseRepoOptions,
  createDefaultSupabaseClient
} from './supabase-shops.repository.js';

function mapDbRecordToDocument(rawRow: any): DocumentMetadata {
  const row = Array.isArray(rawRow) ? rawRow[0] : rawRow;
  return {
    id: row.id,
    customer_id: row.customer_id,
    file_name: row.file_name,
    mime_type: row.mime_type,
    file_size_bytes: row.file_size_bytes,
    storage_key: row.storage_key,
    converted_storage_key: row.converted_storage_key || undefined,
    status: row.status,
    page_count: row.page_count ?? undefined,
    checksum_sha256: row.checksum_sha256 || undefined,
    converted_checksum_sha256: row.converted_checksum_sha256 || undefined,
    conversion_metadata: row.conversion_metadata || undefined,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at || undefined,
    purged_at: row.purged_at || undefined
  };
}

export class SupabaseDocumentsRepository implements IDocumentsRepository {
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

  async create(dto: CreateDocumentRecordDto): Promise<DocumentMetadata> {
    const row: Record<string, unknown> = {
      customer_id: dto.customer_id,
      file_name: dto.file_name,
      mime_type: dto.mime_type,
      file_size_bytes: dto.file_size_bytes,
      storage_key: dto.storage_key,
      status: dto.status || 'upload_pending'
    };

    if (dto.page_count !== undefined) row['page_count'] = dto.page_count;
    if (dto.checksum_sha256) row['checksum_sha256'] = dto.checksum_sha256;
    if (dto.expires_at) row['expires_at'] = dto.expires_at;

    const { data, error } = await this.client
      .from('documents')
      .insert(row)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create document record: ${error?.message || 'Unknown error'}`);
    }

    return mapDbRecordToDocument(data);
  }

  async findById(id: string): Promise<DocumentMetadata | null> {
    const { data, error } = await this.client
      .from('documents')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;
    return mapDbRecordToDocument(data);
  }

  async findByStorageKey(storageKey: string): Promise<DocumentMetadata | null> {
    const { data, error } = await this.client
      .from('documents')
      .select('*')
      .eq('storage_key', storageKey)
      .maybeSingle();

    if (error || !data) return null;
    return mapDbRecordToDocument(data);
  }

  async findByCustomerId(customerId: string): Promise<DocumentMetadata[]> {
    const { data, error } = await this.client
      .from('documents')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (error || !data) return [];
    return (data as any[]).map(mapDbRecordToDocument);
  }

  async findExpiredForPurge(now?: Date, limit?: number): Promise<DocumentMetadata[]> {
    const cutoff = (now || new Date()).toISOString();
    let query = this.client
      .from('documents')
      .select('*')
      .lt('expires_at', cutoff)
      .neq('status', 'purged')
      .order('expires_at', { ascending: true });

    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;
    if (error || !data) return [];
    return (data as any[]).map(mapDbRecordToDocument);
  }

  async purge(id: string): Promise<DocumentMetadata | null> {
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from('documents')
      .update({ status: 'purged', purged_at: now, updated_at: now })
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) return null;
    return mapDbRecordToDocument(data);
  }

  async update(id: string, partial: Partial<DocumentMetadata>): Promise<DocumentMetadata | null> {
    const updateData: Record<string, unknown> = { ...partial, updated_at: new Date().toISOString() };
    // Remove fields that shouldn't be directly updated
    delete updateData['id'];
    delete updateData['created_at'];

    const { data, error } = await this.client
      .from('documents')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) return null;
    return mapDbRecordToDocument(data);
  }

  async delete(id: string): Promise<boolean> {
    const { error } = await this.client
      .from('documents')
      .delete()
      .eq('id', id);

    return !error;
  }

  async recordDeletionLog(
    log: Omit<DocumentDeletionLog, 'id' | 'deleted_at'>
  ): Promise<DocumentDeletionLog> {
    const row = {
      ...log,
      deleted_at: new Date().toISOString()
    };

    const { data, error } = await this.client
      .from('document_deletion_logs')
      .insert(row)
      .select('*')
      .single();

    if (error || !data) {
      // Fallback: return an in-memory record if table doesn't exist
      return {
        id: crypto.randomUUID(),
        ...row
      } as DocumentDeletionLog;
    }

    return data as DocumentDeletionLog;
  }

  async getDeletionLogs(jobId?: string): Promise<DocumentDeletionLog[]> {
    let query = this.client
      .from('document_deletion_logs')
      .select('*')
      .order('deleted_at', { ascending: false });

    if (jobId) {
      query = query.eq('job_id', jobId);
    }

    const { data, error } = await query;
    if (error || !data) return [];
    return data as DocumentDeletionLog[];
  }

  clear(): void {
    // No-op for Supabase repository
  }
}
