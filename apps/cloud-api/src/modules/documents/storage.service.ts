/**
 * Storage Service & Signed URL Management for CAPS Private Document Store.
 * Conforms to Master Plan §5.5, ADR 0007, and privacy lifecycle invariants.
 */

import crypto from 'node:crypto';

export interface SignedUrlResult {
  url: string;
  token: string;
  expires_at: string;
}

export interface IStorageService {
  putObject(storageKey: string, data: Buffer, contentType?: string): Promise<void>;
  getObject(storageKey: string): Promise<{ data: Buffer; contentType: string } | null>;
  deleteObject(storageKey: string): Promise<boolean>;
  createUploadSignedUrl(storageKey: string, expiresInSeconds?: number): Promise<SignedUrlResult>;
  createDownloadSignedUrl(storageKey: string, expiresInSeconds?: number): Promise<SignedUrlResult>;
  clear(): void;
}

export class MockStorageService implements IStorageService {
  private readonly store = new Map<string, { data: Buffer; contentType: string; createdAt: string }>();

  async putObject(storageKey: string, data: Buffer, contentType: string = 'application/octet-stream'): Promise<void> {
    this.store.set(storageKey, {
      data: Buffer.from(data),
      contentType,
      createdAt: new Date().toISOString()
    });
  }

  async getObject(storageKey: string): Promise<{ data: Buffer; contentType: string } | null> {
    const item = this.store.get(storageKey);
    if (!item) return null;
    return {
      data: Buffer.from(item.data),
      contentType: item.contentType
    };
  }

  async deleteObject(storageKey: string): Promise<boolean> {
    return this.store.delete(storageKey);
  }

  async createUploadSignedUrl(storageKey: string, expiresInSeconds: number = 900): Promise<SignedUrlResult> {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    return {
      url: `/api/v1/storage/upload?key=${encodeURIComponent(storageKey)}&token=${token}`,
      token,
      expires_at: expiresAt
    };
  }

  async createDownloadSignedUrl(storageKey: string, expiresInSeconds: number = 300): Promise<SignedUrlResult> {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    return {
      url: `/api/v1/storage/download?key=${encodeURIComponent(storageKey)}&token=${token}`,
      token,
      expires_at: expiresAt
    };
  }

  clear(): void {
    this.store.clear();
  }
}
