import crypto from 'node:crypto';

export interface TokenVerificationResult {
  valid: boolean;
  storageKey?: string;
  expired?: boolean;
  error?: string;
}

export interface ObjectVerificationResult {
  valid: boolean;
  actualMimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  error?: string;
}

export interface SignedUrlResult {
  url: string;
  token: string;
  expires_at: string;
  uploadUrl?: string;
  downloadUrl?: string;
  expiresAt?: string;
  expires_in_seconds?: number;
}

export interface IStorageService {
  createUploadSignedUrl(
    storageKey: string,
    mimeTypeOrExpires?: string | number,
    expiresInSeconds?: number
  ): Promise<any>;

  createDownloadSignedUrl(storageKey: string, expiresInSeconds?: number): Promise<any>;

  verifyToken?(token: string, expectedType: 'upload' | 'download'): TokenVerificationResult;

  putObject(storageKey: string, data: Buffer, mimeType?: string): Promise<void>;

  getObject(
    storageKey: string
  ): Promise<{ data: Buffer; mimeType?: string; contentType?: string } | null>;

  deleteObject(storageKey: string): Promise<boolean>;

  verifyObject?(storageKey: string, expectedMimeType: string): Promise<ObjectVerificationResult>;

  clear(): void;
}

export function detectMimeTypeFromMagicBytes(buffer: Buffer): string | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(pngHeader)) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  return null;
}

export class MockStorageService implements IStorageService {
  private readonly store = new Map<
    string,
    { buffer: Buffer; mimeType: string; uploadedAt: string }
  >();
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor(
    secretKey = 'mock-storage-secret-key-caps-dev',
    baseUrl = '/api/v1/documents/storage'
  ) {
    this.secretKey = secretKey;
    this.baseUrl = baseUrl;
  }

  private signPayload(payload: { key: string; type: string; exp: number }): string {
    const jsonStr = JSON.stringify(payload);
    const b64 = Buffer.from(jsonStr).toString('base64url');
    const sig = crypto.createHmac('sha256', this.secretKey).update(b64).digest('base64url');
    return `${b64}.${sig}`;
  }

  verifyToken(token: string, expectedType: 'upload' | 'download'): TokenVerificationResult {
    try {
      const parts = token.split('.');
      if (parts.length !== 2) {
        return { valid: false, error: 'Malformed storage token format.' };
      }

      const [b64, signature] = parts;
      if (!b64 || !signature) {
        return { valid: false, error: 'Empty token components.' };
      }

      const expectedSig = crypto
        .createHmac('sha256', this.secretKey)
        .update(b64)
        .digest('base64url');
      if (signature !== expectedSig) {
        return { valid: false, error: 'Invalid storage token signature.' };
      }

      const decoded = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as {
        key: string;
        type: string;
        exp: number;
      };

      if (decoded.type !== expectedType) {
        return { valid: false, error: `Invalid token type. Expected "${expectedType}".` };
      }

      const now = Math.floor(Date.now() / 1000);
      if (now > decoded.exp) {
        return { valid: false, expired: true, error: 'Storage token has expired.' };
      }

      return { valid: true, storageKey: decoded.key, expired: false };
    } catch {
      return { valid: false, error: 'Failed to parse storage token.' };
    }
  }

  async createUploadSignedUrl(
    storageKey: string,
    mimeTypeOrExpires: string | number = 900,
    expiresInSeconds: number = 900
  ): Promise<any> {
    const duration = typeof mimeTypeOrExpires === 'number' ? mimeTypeOrExpires : expiresInSeconds;
    const exp = Math.floor(Date.now() / 1000) + duration;
    const expiresAt = new Date(exp * 1000).toISOString();
    const token = this.signPayload({ key: storageKey, type: 'upload', exp });
    const uploadUrl = `${this.baseUrl}/upload?token=${token}`;

    return {
      url: uploadUrl,
      uploadUrl,
      token,
      expires_at: expiresAt,
      expiresAt,
      expires_in_seconds: duration
    };
  }

  async createDownloadSignedUrl(storageKey: string, expiresInSeconds: number = 300): Promise<any> {
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const expiresAt = new Date(exp * 1000).toISOString();
    const token = this.signPayload({ key: storageKey, type: 'download', exp });
    const downloadUrl = `${this.baseUrl}/download?token=${token}`;

    return {
      url: downloadUrl,
      downloadUrl,
      token,
      expires_at: expiresAt,
      expiresAt,
      expires_in_seconds: expiresInSeconds
    };
  }

  async putObject(
    storageKey: string,
    data: Buffer,
    mimeType: string = 'application/octet-stream'
  ): Promise<void> {
    this.store.set(storageKey, {
      buffer: Buffer.from(data),
      mimeType,
      uploadedAt: new Date().toISOString()
    });
  }

  async getObject(
    storageKey: string
  ): Promise<{ data: Buffer; mimeType: string; contentType: string } | null> {
    const item = this.store.get(storageKey);
    if (!item) return null;
    return {
      data: item.buffer,
      mimeType: item.mimeType,
      contentType: item.mimeType
    };
  }

  async deleteObject(storageKey: string): Promise<boolean> {
    return this.store.delete(storageKey);
  }

  async verifyObject(
    storageKey: string,
    expectedMimeType: string
  ): Promise<ObjectVerificationResult> {
    const item = this.store.get(storageKey);
    if (!item) {
      return {
        valid: false,
        error: `Storage object "${storageKey}" not found in storage bucket.`
      };
    }

    const actualMime = detectMimeTypeFromMagicBytes(item.buffer);
    if (!actualMime) {
      return {
        valid: false,
        sizeBytes: item.buffer.length,
        error: 'Corrupt or unrecognized file format. Magic bytes verification failed.'
      };
    }

    if (actualMime !== expectedMimeType) {
      return {
        valid: false,
        actualMimeType: actualMime,
        sizeBytes: item.buffer.length,
        error: `MIME type mismatch. Declared "${expectedMimeType}" but file magic bytes indicate "${actualMime}".`
      };
    }

    const sha256 = crypto.createHash('sha256').update(item.buffer).digest('hex');

    return {
      valid: true,
      actualMimeType: actualMime,
      sizeBytes: item.buffer.length,
      sha256
    };
  }

  clear(): void {
    this.store.clear();
  }
}
