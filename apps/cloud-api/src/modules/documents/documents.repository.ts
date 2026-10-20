import crypto from 'node:crypto';
import type { DocumentMetadata, DocumentStatus, AllowedDocumentMime, DocumentDeletionLog } from './documents.types.js';

export interface ActiveJobLease {
  agent_id: string;
  document_id: string;
  storage_key: string;
  lease_expires_at: string;
}

export interface CreateDocumentRecordDto {
  customer_id: string;
  file_name: string;
  mime_type: AllowedDocumentMime | string;
  file_size_bytes: number;
  storage_key: string;
  page_count?: number | undefined;
  status?: DocumentStatus | undefined;
  checksum_sha256?: string | undefined;
  expires_at?: string | undefined;
}

export interface IDocumentsRepository {
  create(dto: CreateDocumentRecordDto): Promise<DocumentMetadata>;
  findById(id: string): Promise<DocumentMetadata | null>;
  findByStorageKey?(storageKey: string): Promise<DocumentMetadata | null>;
  findByCustomerId(customerId: string): Promise<DocumentMetadata[]>;
  findExpiredForPurge?(now?: Date, limit?: number): Promise<DocumentMetadata[]>;
  purge?(id: string): Promise<DocumentMetadata | null>;
  update(id: string, partial: Partial<DocumentMetadata>): Promise<DocumentMetadata | null>;
  delete(id: string): Promise<boolean>;

  hasActiveLeaseForDocument?(agentId: string, documentIdOrStorageKey: string): Promise<boolean>;
  addJobLease?(agentId: string, documentId: string, storageKey: string, leaseExpiresAt: string): void;
  removeJobLease?(agentId: string, documentId: string): void;
  recordDeletionLog(log: Omit<DocumentDeletionLog, 'id' | 'deleted_at'>): Promise<DocumentDeletionLog>;
  getDeletionLogs(jobId?: string): Promise<DocumentDeletionLog[]>;
  clear(): void;
}

export class MockDocumentsRepository implements IDocumentsRepository {
  private readonly documents = new Map<string, DocumentMetadata>();
  private readonly activeLeases: ActiveJobLease[] = [];
  private readonly deletionLogs: DocumentDeletionLog[] = [];

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
      ...(dto.page_count !== undefined ? { page_count: dto.page_count } : {}),
      ...(dto.checksum_sha256 !== undefined ? { checksum_sha256: dto.checksum_sha256 } : {}),
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

  async findByStorageKey(storageKey: string): Promise<DocumentMetadata | null> {
    for (const doc of this.documents.values()) {
      if (doc.storage_key === storageKey) {
        return { ...doc };
      }
    }
    return null;
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

  async hasActiveLeaseForDocument(agentId: string, documentIdOrStorageKey: string): Promise<boolean> {
    const now = new Date().toISOString();
    return this.activeLeases.some(
      lease =>
        lease.agent_id === agentId &&
        (lease.document_id === documentIdOrStorageKey || lease.storage_key === documentIdOrStorageKey) &&
        lease.lease_expires_at > now
    );
  }

  addJobLease(agentId: string, documentId: string, storageKey: string, leaseExpiresAt: string): void {
    this.activeLeases.push({
      agent_id: agentId,
      document_id: documentId,
      storage_key: storageKey,
      lease_expires_at: leaseExpiresAt
    });
  }

  removeJobLease(agentId: string, documentId: string): void {
    const index = this.activeLeases.findIndex(
      l => l.agent_id === agentId && l.document_id === documentId
    );
    if (index !== -1) {
      this.activeLeases.splice(index, 1);
    }
  }

  async recordDeletionLog(log: Omit<DocumentDeletionLog, 'id' | 'deleted_at'>): Promise<DocumentDeletionLog> {
    const entry: DocumentDeletionLog = {
      id: crypto.randomUUID(),
      job_id: log.job_id,
      document_storage_key: log.document_storage_key,
      deleted_by: log.deleted_by,
      reason: log.reason,
      deleted_at: new Date().toISOString()
    };
    this.deletionLogs.push(entry);
    return { ...entry };
  }

  async getDeletionLogs(jobId?: string): Promise<DocumentDeletionLog[]> {
    if (!jobId) {
      return [...this.deletionLogs];
    }
    return this.deletionLogs.filter(l => l.job_id === jobId).map(l => ({ ...l }));
  }

  clear(): void {
    this.documents.clear();
    this.activeLeases.length = 0;
    this.deletionLogs.length = 0;
  }
}
