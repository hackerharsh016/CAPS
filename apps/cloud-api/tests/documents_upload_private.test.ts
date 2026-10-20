import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import { buildApp } from '../src/app.js';
import { validateEnv } from '../src/config/env.js';
import { createTestJwt, SupabaseJwtVerifier } from '../src/plugins/auth.js';
import { MockDocumentsRepository } from '../src/modules/documents/documents.repository.js';
import { MockStorageService } from '../src/modules/documents/storage.service.js';
import type { FastifyInstance } from 'fastify';

describe('Cloud API — Private Document Upload and Metadata (P03-M02-F03)', () => {
  const jwtSecret = 'test-jwt-secret-for-documents-private-storage-32-chars';
  const env = validateEnv({
    NODE_ENV: 'test',
    PORT: '4000',
    HOST: '127.0.0.1',
    SUPABASE_JWT_SECRET: jwtSecret
  });

  let app: FastifyInstance;
  let documentsRepo: MockDocumentsRepository;
  let storageService: MockStorageService;

  // Identity tokens
  const customer1Id = '11111111-1111-1111-1111-111111111111';
  const customer1Token = createTestJwt(
    { sub: customer1Id, role: 'customer', app_metadata: { role: 'customer' } },
    jwtSecret
  );

  const customer2Id = '22222222-2222-2222-2222-222222222222';
  const customer2Token = createTestJwt(
    { sub: customer2Id, role: 'customer', app_metadata: { role: 'customer' } },
    jwtSecret
  );

  const agentId = '33333333-3333-3333-3333-333333333333';
  const agentToken = createTestJwt(
    { sub: agentId, role: 'agent', app_metadata: { role: 'agent' } },
    jwtSecret
  );

  const adminId = '44444444-4444-4444-4444-444444444444';
  const adminToken = createTestJwt(
    { sub: adminId, role: 'admin', app_metadata: { role: 'admin' } },
    jwtSecret
  );

  // Sample file buffers
  const validPdfBuffer = Buffer.from('%PDF-1.4\n%CAPS Test Document Content\n%%EOF');
  const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const validJpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const corruptFileBuffer = Buffer.from('NOT A VALID DOCUMENT CONTENT - CORRUPT BYTES');

  beforeAll(async () => {
    documentsRepo = new MockDocumentsRepository();
    storageService = new MockStorageService();

    app = buildApp({
      env,
      tokenVerifier: new SupabaseJwtVerifier(jwtSecret),
      documentsRepo,
      storageService
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    documentsRepo.clear();
    storageService.clear();
  });

  describe('1. Upload Intent Initialization (POST /api/v1/documents/uploads)', () => {
    it('successfully initiates PDF upload intent with signed upload URL and 15-minute expiry', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/uploads',
        headers: {
          authorization: `Bearer ${customer1Token}`
        },
        payload: {
          file_name: 'resume.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: validPdfBuffer.length,
          page_count: 2
        }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data).toBeDefined();
      expect(body.data.document_id).toBeDefined();
      expect(body.data.storage_key).toContain(`documents/${customer1Id}/`);
      expect(body.data.upload_url).toContain('/api/v1/documents/storage/upload?token=');
      expect(body.data.upload_token).toBeDefined();
      expect(body.data.expires_in_seconds).toBe(900); // 15 minutes
      expect(new Date(body.data.expires_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('successfully initiates PNG and JPEG upload intent', async () => {
      const pngRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/uploads',
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          fileName: 'id_card.png',
          mimeType: 'image/png',
          fileSizeBytes: validPngBuffer.length
        }
      });
      expect(pngRes.statusCode).toBe(201);

      const jpgRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/uploads',
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          fileName: 'photo.jpeg',
          mimeType: 'image/jpeg',
          fileSizeBytes: validJpgBuffer.length
        }
      });
      expect(jpgRes.statusCode).toBe(201);
    });

    it('rejects unauthenticated upload requests with 401 UNAUTHORIZED', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/uploads',
        payload: {
          file_name: 'test.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: 1024
        }
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects oversized files exceeding 50 MB with 400 INVALID_PAYLOAD', async () => {
      const oversizedBytes = 50 * 1024 * 1024 + 1; // 50MB + 1 byte
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/uploads',
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          file_name: 'large_archive.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: oversizedBytes
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
      expect(body.error.message).toContain('exceeds maximum permitted limit of 50 MB');
    });

    it('rejects zero or negative file sizes with 400 INVALID_PAYLOAD', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/uploads',
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          file_name: 'empty.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: 0
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
    });

    it('rejects unsupported MIME types with 400 INVALID_PAYLOAD', async () => {
      const unsupportedTypes = ['application/zip', 'text/html', 'application/x-msdownload', 'application/json'];

      for (const mime of unsupportedTypes) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/documents/uploads',
          headers: { authorization: `Bearer ${customer1Token}` },
          payload: {
            file_name: 'test.zip',
            mime_type: mime,
            file_size_bytes: 1024
          }
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error.code).toBe('INVALID_PAYLOAD');
        expect(body.error.message).toContain('Unsupported MIME type');
      }
    });

    it('rejects missing required fields with 400 INVALID_PAYLOAD', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/uploads',
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          file_name: 'test.pdf'
          // missing mime_type and file_size_bytes
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
    });
  });

  describe('2. Direct Storage Upload & Token Validation', () => {
    it('accepts valid binary upload via signed upload token', async () => {
      // 1. Get upload intent
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/uploads',
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          file_name: 'document.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: validPdfBuffer.length
        }
      });
      const { upload_url } = intentRes.json().data;

      // 2. Perform direct storage PUT upload
      const uploadRes = await app.inject({
        method: 'PUT',
        url: upload_url,
        headers: {
          'content-type': 'application/pdf'
        },
        payload: validPdfBuffer
      });

      expect(uploadRes.statusCode).toBe(200);
      expect(uploadRes.json().success).toBe(true);
    });

    it('rejects direct storage upload when token is missing', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/documents/storage/upload',
        headers: { 'content-type': 'application/pdf' },
        payload: validPdfBuffer
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_PAYLOAD');
    });

    it('rejects direct storage upload when token signature is tampered', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/documents/storage/upload?token=tampered.token.value',
        headers: { 'content-type': 'application/pdf' },
        payload: validPdfBuffer
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('rejects direct storage upload when upload token has expired', async () => {
      // Create an already-expired token directly via storage service
      const expiredStorage = new MockStorageService();
      const { token } = await expiredStorage.createUploadSignedUrl('documents/customer/doc', 'application/pdf', -10);

      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/documents/storage/upload?token=${token}`,
        headers: { 'content-type': 'application/pdf' },
        payload: validPdfBuffer
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('TOKEN_EXPIRED');
    });
  });

  describe('3. Upload Finalization & Magic Byte Verification (POST /api/v1/documents/:id/finalize)', () => {
    it('successfully finalizes upload when magic bytes and SHA-256 checksum match', async () => {
      // 1. Intent
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/uploads',
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          file_name: 'verified.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: validPdfBuffer.length
        }
      });
      const { document_id, upload_url } = intentRes.json().data;

      // 2. Direct upload to storage
      await app.inject({
        method: 'PUT',
        url: upload_url,
        headers: { 'content-type': 'application/pdf' },
        payload: validPdfBuffer
      });

      // 3. Compute actual SHA-256
      const checksum = crypto.createHash('sha256').update(validPdfBuffer).digest('hex');

      // 4. Finalize
      const finalizeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${document_id}/finalize`,
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          checksum_sha256: checksum,
          page_count: 3
        }
      });

      expect(finalizeRes.statusCode).toBe(200);
      const finalized = finalizeRes.json().data;
      expect(finalized.status).toBe('ready');
      expect(finalized.checksum_sha256).toBe(checksum);
      expect(finalized.page_count).toBe(3);
    });

    it('rejects finalization when file magic bytes are corrupt/invalid (e.g. text bytes disguised as PDF)', async () => {
      // 1. Intent for PDF
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/uploads',
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          file_name: 'fake.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: corruptFileBuffer.length
        }
      });
      const { document_id, upload_url } = intentRes.json().data;

      // 2. Upload corrupt bytes
      await app.inject({
        method: 'PUT',
        url: upload_url,
        headers: { 'content-type': 'application/pdf' },
        payload: corruptFileBuffer
      });

      // 3. Finalize attempt
      const finalizeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${document_id}/finalize`,
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {}
      });

      expect(finalizeRes.statusCode).toBe(400);
      const body = finalizeRes.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
      expect(body.error.message).toContain('Magic bytes verification failed');

      // Verify document status in repo transitioned to 'failed'
      const checkDoc = await documentsRepo.findById(document_id);
      expect(checkDoc?.status).toBe('failed');
    });

    it('rejects finalization when declared checksum does not match computed checksum', async () => {
      // 1. Intent & Upload valid PDF
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/uploads',
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          file_name: 'doc.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: validPdfBuffer.length
        }
      });
      const { document_id, upload_url } = intentRes.json().data;

      await app.inject({
        method: 'PUT',
        url: upload_url,
        headers: { 'content-type': 'application/pdf' },
        payload: validPdfBuffer
      });

      // 2. Finalize with false checksum
      const badChecksum = '0000000000000000000000000000000000000000000000000000000000000000';
      const finalizeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${document_id}/finalize`,
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          checksum_sha256: badChecksum
        }
      });

      expect(finalizeRes.statusCode).toBe(400);
      const body = finalizeRes.json();
      expect(body.error.code).toBe('CHECKSUM_MISMATCH');
    });

    it('enforces tenant isolation: foreign customer cannot finalize another user document', async () => {
      // Customer 1 creates upload intent
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/uploads',
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          file_name: 'c1_doc.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: validPdfBuffer.length
        }
      });
      const { document_id, upload_url } = intentRes.json().data;

      await app.inject({
        method: 'PUT',
        url: upload_url,
        headers: { 'content-type': 'application/pdf' },
        payload: validPdfBuffer
      });

      // Customer 2 attempts to finalize Customer 1's document
      const finalizeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${document_id}/finalize`,
        headers: { authorization: `Bearer ${customer2Token}` },
        payload: {}
      });

      expect(finalizeRes.statusCode).toBe(403);
      expect(finalizeRes.json().error.code).toBe('FORBIDDEN');
    });

    it('rejects finalization of non-existent document with 404 NOT_FOUND', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${fakeId}/finalize`,
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {}
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });
  });

  describe('4. Short-Lived Signed Download URL & Access Control (GET /api/v1/documents/:id/download)', () => {
    let readyDocId: string;

    beforeEach(async () => {
      // Set up a ready document for Customer 1
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/uploads',
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          file_name: 'contract.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: validPdfBuffer.length
        }
      });
      const { document_id, upload_url } = intentRes.json().data;

      await app.inject({
        method: 'PUT',
        url: upload_url,
        headers: { 'content-type': 'application/pdf' },
        payload: validPdfBuffer
      });

      await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${document_id}/finalize`,
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {}
      });

      readyDocId = document_id;
    });

    it('document owner successfully retrieves signed download URL with 300s expiry', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${readyDocId}/download`,
        headers: { authorization: `Bearer ${customer1Token}` }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.document_id).toBe(readyDocId);
      expect(body.data.download_url).toContain('/api/v1/documents/storage/download?token=');
      expect(body.data.expires_in_seconds).toBe(300); // Strict 5-minute expiry per ADR 0007
      expect(new Date(body.data.expires_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('paired print agent holding active job lease successfully retrieves download URL', async () => {
      // Register active job lease for agent on readyDocId (valid for next 10 minutes)
      const leaseExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const doc = await documentsRepo.findById(readyDocId);
      documentsRepo.addJobLease(agentId, readyDocId, doc!.storage_key, leaseExpiresAt);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${readyDocId}/download`,
        headers: { authorization: `Bearer ${agentToken}` }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.download_url).toBeDefined();
      expect(body.data.expires_in_seconds).toBe(300);
    });

    it('admin successfully retrieves download URL with 300s expiry', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${readyDocId}/download`,
        headers: { authorization: `Bearer ${adminToken}` }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.download_url).toBeDefined();
      expect(body.data.expires_in_seconds).toBe(300);
    });

    it('unauthorized customer is denied download URL with 403 FORBIDDEN', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${readyDocId}/download`,
        headers: { authorization: `Bearer ${customer2Token}` }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN');
    });

    it('unpaired print agent without active lease is denied download URL with 403 FORBIDDEN', async () => {
      // Agent does NOT have lease on readyDocId
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${readyDocId}/download`,
        headers: { authorization: `Bearer ${agentToken}` }
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toContain('active claim lease');
    });

    it('unauthenticated download request is rejected with 401 UNAUTHORIZED', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${readyDocId}/download`
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHORIZED');
    });

    it('rejects download if document has not yet been finalized (upload_pending)', async () => {
      // Create pending intent but do not finalize
      const pendingRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/uploads',
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          file_name: 'pending.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: 1024
        }
      });
      const pendingId = pendingRes.json().data.document_id;

      const downloadRes = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${pendingId}/download`,
        headers: { authorization: `Bearer ${customer1Token}` }
      });

      expect(downloadRes.statusCode).toBe(400);
      expect(downloadRes.json().error.code).toBe('DOCUMENT_NOT_READY');
    });
  });

  describe('5. Storage Download Verification & Token Expiry', () => {
    it('downloads binary object with correct headers using valid signed download URL', async () => {
      // 1. Prepare ready doc
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/uploads',
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          file_name: 'fetch.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: validPdfBuffer.length
        }
      });
      const { document_id, upload_url } = intentRes.json().data;

      await app.inject({
        method: 'PUT',
        url: upload_url,
        headers: { 'content-type': 'application/pdf' },
        payload: validPdfBuffer
      });

      await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${document_id}/finalize`,
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {}
      });

      // 2. Get download URL
      const dlUrlRes = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${document_id}/download`,
        headers: { authorization: `Bearer ${customer1Token}` }
      });
      const { download_url } = dlUrlRes.json().data;

      // 3. Fetch from storage endpoint
      const fetchRes = await app.inject({
        method: 'GET',
        url: download_url
      });

      expect(fetchRes.statusCode).toBe(200);
      expect(fetchRes.headers['content-type']).toBe('application/pdf');
      expect(fetchRes.rawPayload).toEqual(validPdfBuffer);
    });

    it('rejects direct download with expired token (403 TOKEN_EXPIRED)', async () => {
      // Storage service creates expired download token
      const expiredStorage = new MockStorageService();
      const { token } = await expiredStorage.createDownloadSignedUrl('documents/customer/doc', -10);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/storage/download?token=${token}`
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('TOKEN_EXPIRED');
    });
  });

  describe('6. Document Metadata & Purge Lifecycle (GET & DELETE /api/v1/documents/:id)', () => {
    let testDocId: string;

    beforeEach(async () => {
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/uploads',
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          file_name: 'confidential.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: validPdfBuffer.length,
          page_count: 5
        }
      });
      const { document_id, upload_url } = intentRes.json().data;

      await app.inject({
        method: 'PUT',
        url: upload_url,
        headers: { 'content-type': 'application/pdf' },
        payload: validPdfBuffer
      });

      await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${document_id}/finalize`,
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {}
      });

      testDocId = document_id;
    });

    it('customer owner retrieves document metadata', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${testDocId}`,
        headers: { authorization: `Bearer ${customer1Token}` }
      });

      expect(res.statusCode).toBe(200);
      const doc = res.json().data;
      expect(doc.id).toBe(testDocId);
      expect(doc.file_name).toBe('confidential.pdf');
      expect(doc.mime_type).toBe('application/pdf');
      expect(doc.page_count).toBe(5);
      expect(doc.status).toBe('ready');
    });

    it('foreign customer is denied document metadata with 403 FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${testDocId}`,
        headers: { authorization: `Bearer ${customer2Token}` }
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('customer owner purges document permanently (DELETE /api/v1/documents/:id)', async () => {
      // 1. Delete document
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/documents/${testDocId}`,
        headers: { authorization: `Bearer ${customer1Token}` }
      });

      expect(delRes.statusCode).toBe(200);
      expect(delRes.json().success).toBe(true);

      // 2. Storage object is deleted
      const doc = await documentsRepo.findById(testDocId);
      expect(doc?.status).toBe('purged');
      const storageObj = await storageService.getObject(doc!.storage_key);
      expect(storageObj).toBeNull();

      // 3. Attempting to get download URL for purged document returns 410 DOCUMENT_PURGED
      const dlRes = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${testDocId}/download`,
        headers: { authorization: `Bearer ${customer1Token}` }
      });
      expect(dlRes.statusCode).toBe(410);
      expect(dlRes.json().error.code).toBe('DOCUMENT_PURGED');
    });

    it('foreign customer cannot purge someone else document', async () => {
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/documents/${testDocId}`,
        headers: { authorization: `Bearer ${customer2Token}` }
      });

      expect(delRes.statusCode).toBe(403);
      expect(delRes.json().error.code).toBe('FORBIDDEN');
    });
  });

  describe('7. Readiness Checks', () => {
    it('readiness endpoint confirms storage and database readiness', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ready'
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ready');
      expect(body.checks.database).toBe('ok');
      expect(body.checks.storage).toBe('ok');
    });
  });
});
