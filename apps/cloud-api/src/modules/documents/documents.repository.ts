import crypto from 'crypto';
import type { DocumentMetadata, DocumentStatus, DocumentDeletionLog } from './documents.types.js';

export interface ActiveJobLease {
  agent_id: string;
  document_id: string;
  storage_key: string;
  lease_expires_at: string;
}

export interface IDocumentsRepository {
  create(doc: {
    customer_id: string;
    file_name: string;
    mime_type: string;
    file_size_bytes: number;
    page_count?: number | undefined;
    storage_key: string;
    checksum_sha256?: string | undefined;
    status?: DocumentStatus | undefined;
    expires_at: string;
  }): Promise<DocumentMetadata>;

  findById(id: string): Promise<DocumentMetadata | null>;
  findByStorageKey(storageKey: string): Promise<DocumentMetadata | null>;
  update(id: string, partial: Partial<DocumentMetadata>): Promise<DocumentMetadata | null>;
  delete(id: string): Promise<boolean>;

  hasActiveLeaseForDocument(agentId: string, documentIdOrStorageKey: string): Promise<boolean>;
  addJobLease(agentId: string, documentId: string, storageKey: string, leaseExpiresAt: string): void;
  removeJobLease(agentId: string, documentId: string): void;
  recordDeletionLog(log: Omit<DocumentDeletionLog, 'id' | 'deleted_at'>): Promise<DocumentDeletionLog>;
  getDeletionLogs(jobId?: string): Promise<DocumentDeletionLog[]>;
}

export class MockDocumentsRepository implements IDocumentsRepository {
  private readonly documents = new Map<string, DocumentMetadata>();
  private readonly activeLeases: ActiveJobLease[] = [];
  private readonly deletionLogs: DocumentDeletionLog[] = [];

  async create(doc: {
    customer_id: string;
    file_name: string;
    mime_type: string;
    file_size_bytes: number;
    page_count?: number | undefined;
    storage_key: string;
    checksum_sha256?: string | undefined;
    status?: DocumentStatus | undefined;
    expires_at: string;
  }): Promise<DocumentMetadata> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const newDoc: DocumentMetadata = {
      id,
      customer_id: doc.customer_id,
      file_name: doc.file_name,
      mime_type: doc.mime_type,
      file_size_bytes: doc.file_size_bytes,
      ...(doc.page_count !== undefined ? { page_count: doc.page_count } : {}),
      storage_key: doc.storage_key,
      ...(doc.checksum_sha256 !== undefined ? { checksum_sha256: doc.checksum_sha256 } : {}),
      status: doc.status ?? 'upload_pending',
      created_at: now,
      expires_at: doc.expires_at
    };

    this.documents.set(id, newDoc);
    return { ...newDoc };
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

  async update(id: string, partial: Partial<DocumentMetadata>): Promise<DocumentMetadata | null> {
    const existing = this.documents.get(id);
    if (!existing) return null;

    const updated: DocumentMetadata = {
      ...existing,
      ...partial
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
