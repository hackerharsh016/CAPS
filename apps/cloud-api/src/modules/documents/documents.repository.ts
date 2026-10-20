/**
 * Documents Repository Interface & In-Memory Mock Implementation for CAPS.
 */

import crypto from 'node:crypto';
import type { DocumentMetadata, DocumentStatus, AllowedDocumentMime } from './documents.types.js';

export interface CreateDocumentRecordDto {
  customer_id: string;
  file_name: string;
  mime_type: AllowedDocumentMime | string;
  file_size_bytes: number;
  storage_key: string;
  status?: DocumentStatus | undefined;
  expires_at?: string | undefined;
}

export interface IDocumentsRepository {
  create(dto: CreateDocumentRecordDto): Promise<DocumentMetadata>;
  findById(id: string): Promise<DocumentMetadata | null>;
  findByCustomerId(customerId: string): Promise<DocumentMetadata[]>;
  findExpiredForPurge?(now?: Date, limit?: number): Promise<DocumentMetadata[]>;
  purge?(id: string): Promise<DocumentMetadata | null>;
  update(id: string, partial: Partial<DocumentMetadata>): Promise<DocumentMetadata | null>;
  delete(id: string): Promise<boolean>;
  clear(): void;
}

export class MockDocumentsRepository implements IDocumentsRepository {
  private readonly documents = new Map<string, DocumentMetadata>();

  async create(dto: CreateDocumentRecordDto): Promise<DocumentMetadata> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const expiresAt = dto.expires_at ?? new Date(Date.now() + 86400000).toISOString(); // 24h

    const record: DocumentMetadata = {
      id,
      customer_id: dto.customer_id,
      file_name: dto.file_name,
      mime_type: dto.mime_type,
      file_size_bytes: dto.file_size_bytes,
      storage_key: dto.storage_key,
      status: dto.status ?? 'upload_pending',
      expires_at: expiresAt,
      created_at: now,
      updated_at: now
    };

    this.documents.set(id, record);
    return { ...record };
  }

  async findById(id: string): Promise<DocumentMetadata | null> {
    const doc = this.documents.get(id);
    return doc ? { ...doc } : null;
  }

  async findByCustomerId(customerId: string): Promise<DocumentMetadata[]> {
    return Array.from(this.documents.values())
      .filter(d => d.customer_id === customerId)
      .map(d => ({ ...d }));
  }

  async findExpiredForPurge(
    now: Date = new Date(),
    limit: number = 100
  ): Promise<DocumentMetadata[]> {
    const currentTime = now.getTime();
    return Array.from(this.documents.values())
      .filter(d => d.status !== 'purged' && new Date(d.expires_at).getTime() <= currentTime)
      .sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())
      .slice(0, limit)
      .map(d => ({ ...d }));
  }

  async purge(id: string): Promise<DocumentMetadata | null> {
    return this.update(id, { status: 'purged' });
  }

  async update(id: string, partial: Partial<DocumentMetadata>): Promise<DocumentMetadata | null> {
    const existing = this.documents.get(id);
    if (!existing) return null;

    const updated: DocumentMetadata = {
      ...existing,
      ...partial,
      updated_at: new Date().toISOString()
    };

    this.documents.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<boolean> {
    return this.documents.delete(id);
  }

  clear(): void {
    this.documents.clear();
  }
}
