import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import {
  StorageService,
  StorageError,
  MAX_FILE_SIZE_BYTES,
  DEFAULT_DOWNLOAD_EXPIRY_SECONDS,
  DEFAULT_UPLOAD_EXPIRY_SECONDS
} from '../storage.service.js';
import { uploadsRoutes } from '../../routes/uploads.routes.js';
import { MockDocumentsRepository } from '../../modules/documents/documents.repository.js';
import { MockPrintJobsRepository } from '../../modules/print-jobs/print-jobs.repository.js';
import { MockJobAttemptsRepository } from '../../modules/agents/attempts.repository.js';

describe('StorageService (Task INT-D3-04)', () => {
  let mockBucket: any;
  let mockSupabaseClient: any;
  let storageService: StorageService;

  beforeEach(() => {
    mockBucket = {
      createSignedUploadUrl: vi.fn(async (path: string, _options?: { expiresIn?: number }) => {
        return {
          data: {
            signedUrl: `https://mock-supabase.local/storage/v1/object/upload/sign/customer-documents/${path}?token=upload-token-xyz`,
            token: 'upload-token-xyz',
            path
          },
          error: null
        };
      }),
      createSignedUrl: vi.fn(async (path: string, expiresIn: number) => {
        return {
          data: {
            signedUrl: `https://mock-supabase.local/storage/v1/object/customer-documents/${path}?token=download-token-abc&expires=${expiresIn}`
          },
          error: null
        };
      }),
      remove: vi.fn(async (paths: string[]) => {
        return { data: { success: true, count: paths.length }, error: null };
      })
    };

    mockSupabaseClient = {
      storage: {
        from: vi.fn((_bucket: string) => {
          return mockBucket;
        })
      }
    };

    storageService = new StorageService({
      supabaseClient: mockSupabaseClient,
      bucket: 'customer-documents'
    });
  });

  describe('Preflight Metadata Validation', () => {
    it('accepts valid PDF files within 50MB ceiling', () => {
      expect(() => {
        storageService.validateUploadMetadata('application/pdf', 1024 * 1024); // 1 MB
      }).not.toThrow();

      expect(() => {
        storageService.validateUploadMetadata('application/pdf', MAX_FILE_SIZE_BYTES); // Exactly 50 MB
      }).not.toThrow();
    });

    it('rejects non-PDF MIME types with UNSUPPORTED_MIME (400)', () => {
      expect(() => {
        storageService.validateUploadMetadata('image/png', 1024);
      }).toThrowError(StorageError);

      try {
        storageService.validateUploadMetadata('image/jpeg', 2048);
      } catch (err) {
        expect(err).toBeInstanceOf(StorageError);
        expect((err as StorageError).statusCode).toBe(400);
        expect((err as StorageError).code).toBe('UNSUPPORTED_MIME');
      }

      expect(() => {
        storageService.validateUploadMetadata(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          2048
        );
      }).toThrowError(/Unsupported MIME type/);
    });

    it('rejects files exceeding 50 MB with FILE_TOO_LARGE (400)', () => {
      const overLimit = MAX_FILE_SIZE_BYTES + 1; // 50MB + 1 byte
      try {
        storageService.validateUploadMetadata('application/pdf', overLimit);
        expect.fail('Should have thrown StorageError for oversized file');
      } catch (err) {
        expect(err).toBeInstanceOf(StorageError);
        expect((err as StorageError).statusCode).toBe(400);
        expect((err as StorageError).code).toBe('FILE_TOO_LARGE');
      }
    });

    it('rejects zero-byte and negative file sizes with INVALID_FILE_SIZE (400)', () => {
      expect(() => {
        storageService.validateUploadMetadata('application/pdf', 0);
      }).toThrowError(/greater than 0 bytes/);

      expect(() => {
        storageService.validateUploadMetadata('application/pdf', -100);
      }).toThrowError(/greater than 0 bytes/);
    });
  });

  describe('createPresignedUploadUrl', () => {
    it('generates customer-scoped presigned upload URL in customer-documents bucket', async () => {
      const result = await storageService.createPresignedUploadUrl({
        customerId: 'cust-1234',
        fileName: 'resume 2026.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 2048000
      });

      expect(mockSupabaseClient.storage.from).toHaveBeenCalledWith('customer-documents');
      expect(mockBucket.createSignedUploadUrl).toHaveBeenCalled();

      expect(result.storage_key).toMatch(/^uploads\/cust-1234\/[a-f0-9-]+-resume_2026\.pdf$/);
      expect(result.bucket).toBe('customer-documents');
      expect(result.upload_url).toContain('https://mock-supabase.local/storage');
      expect(result.expires_in_seconds).toBe(DEFAULT_UPLOAD_EXPIRY_SECONDS);
      expect(result.expires_at).toBeDefined();
    });

    it('respects custom expiration duration when requested', async () => {
      const result = await storageService.createPresignedUploadUrl({
        customerId: 'cust-1234',
        fileName: 'tax_return.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 500000,
        expiresInSeconds: 600
      });

      expect(result.expires_in_seconds).toBe(600);
    });
  });

  describe('createSignedDownloadUrl', () => {
    it('generates 5-minute (300s) signed download URL by default', async () => {
      const result = await storageService.createSignedDownloadUrl('uploads/cust-1234/test-doc.pdf');

      expect(mockSupabaseClient.storage.from).toHaveBeenCalledWith('customer-documents');
      expect(mockBucket.createSignedUrl).toHaveBeenCalledWith(
        'uploads/cust-1234/test-doc.pdf',
        DEFAULT_DOWNLOAD_EXPIRY_SECONDS
      );

      expect(result.download_url).toContain('https://mock-supabase.local/storage');
      expect(result.expires_in_seconds).toBe(300);
      expect(result.expires_at).toBeDefined();
    });

    it('throws StorageError (500) if Supabase returns an error', async () => {
      mockBucket.createSignedUrl.mockResolvedValueOnce({
        data: null,
        error: new Error('Bucket access denied')
      });

      await expect(
        storageService.createSignedDownloadUrl('uploads/cust-1234/test-doc.pdf')
      ).rejects.toThrowError(StorageError);
    });
  });

  describe('deleteObject', () => {
    it('removes file from customer-documents bucket', async () => {
      const success = await storageService.deleteObject('uploads/cust-1234/test-doc.pdf');
      expect(success).toBe(true);
      expect(mockBucket.remove).toHaveBeenCalledWith(['uploads/cust-1234/test-doc.pdf']);
    });
  });

  describe('Built-in REST Fallback Mode', () => {
    it('functions with customFetch when SDK client is omitted', async () => {
      const customFetch = vi.fn(async (input: string | URL | Request, _init?: any) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/upload/sign/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              url: '/storage/v1/object/upload/sign/customer-documents/uploads/test.pdf?token=rest-upload-token',
              token: 'rest-upload-token'
            })
          } as any;
        }
        if (url.includes('/sign/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              signedURL:
                '/storage/v1/object/customer-documents/uploads/test.pdf?token=rest-download-token'
            })
          } as any;
        }
        return { ok: false, status: 404, text: async () => 'Not Found' } as any;
      }) as unknown as typeof fetch;

      const restStorageService = new StorageService({
        supabaseUrl: 'https://test-project.supabase.co',
        supabaseKey: 'service-role-test-key-caps',
        customFetch
      });

      const uploadResult = await restStorageService.createSignedUploadUrl('uploads/test.pdf', 600);
      expect(uploadResult.uploadUrl).toContain(
        'https://test-project.supabase.co/storage/v1/object/upload/sign'
      );

      const downloadResult = await restStorageService.createSignedDownloadUrl(
        'uploads/test.pdf',
        300
      );
      expect(downloadResult.downloadUrl).toContain(
        'https://test-project.supabase.co/storage/v1/object/customer-documents'
      );
    });
  });
});

describe('Uploads & Document Download Routes (INT-D3-04)', () => {
  let app: FastifyInstance;
  let documentsRepo: MockDocumentsRepository;
  let jobsRepo: MockPrintJobsRepository;
  let attemptsRepo: MockJobAttemptsRepository;
  let storageService: StorageService;

  beforeEach(async () => {
    documentsRepo = new MockDocumentsRepository();
    jobsRepo = new MockPrintJobsRepository();
    attemptsRepo = new MockJobAttemptsRepository();

    const mockBucket = {
      createSignedUploadUrl: vi.fn(async (path: string) => ({
        data: {
          signedUrl: `https://storage.supabase.local/customer-documents/${path}?token=up-token`,
          token: 'up-token',
          path
        },
        error: null
      })),
      createSignedUrl: vi.fn(async (path: string, expiresIn: number) => ({
        data: {
          signedUrl: `https://storage.supabase.local/customer-documents/${path}?token=down-token&exp=${expiresIn}`
        },
        error: null
      })),
      remove: vi.fn(async () => ({ data: { success: true }, error: null }))
    };

    storageService = new StorageService({
      supabaseClient: { storage: { from: () => mockBucket } }
    });

    app = Fastify();

    // Setup authenticate decorator simulation matching cloud-api
    app.decorate('authenticate', async (request: any, reply: any) => {
      const authHeader = request.headers['authorization'];
      if (!authHeader) {
        return reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Missing Authorization header.' }
        });
      }

      const token = authHeader.replace(/^Bearer\s+/, '');

      // Agent token: caps_agent_sec_*
      if (token.startsWith('caps_agent_sec_')) {
        request.agent = {
          device_id: 'agent-device-001',
          shop_id: 'shop-001',
          role: 'PRINT_AGENT'
        };
        request.user = {
          id: 'agent-device-001',
          role: 'agent'
        };
        return;
      }

      // Customer / Owner tokens
      if (token === 'customer-token-rahul') {
        request.user = {
          id: 'cust-rahul-001',
          role: 'customer',
          email: 'rahul@caps.test'
        };
        return;
      }

      if (token === 'customer-token-priya') {
        request.user = {
          id: 'cust-priya-002',
          role: 'customer',
          email: 'priya@caps.test'
        };
        return;
      }

      if (token === 'owner-token-shop1') {
        request.user = {
          id: 'owner-001',
          role: 'shop_owner',
          email: 'owner@shop1.test'
        };
        return;
      }

      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Invalid authentication token.' }
      });
    });

    await app.register(uploadsRoutes, {
      storageService,
      documentsRepo,
      jobsRepo,
      attemptsRepo
    });

    await app.ready();
  });

  describe('POST /api/v1/uploads/presigned-url', () => {
    it('customer obtains valid presigned upload URL for PDF <= 50MB', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads/presigned-url',
        headers: {
          authorization: 'Bearer customer-token-rahul'
        },
        payload: {
          file_name: 'syllabus.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: 5242880, // 5 MB
          page_count: 12
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeDefined();
      expect(body.data.upload_url).toContain(
        'https://storage.supabase.local/customer-documents/uploads/cust-rahul-001'
      );
      expect(body.data.storage_key).toMatch(/^uploads\/cust-rahul-001\/[a-f0-9-]+-syllabus\.pdf$/);
      expect(body.data.bucket).toBe('customer-documents');
      expect(body.data.expires_in_seconds).toBe(900);
      expect(body.data.document_id).toBeDefined();

      // Verify document record was created in database
      const doc = await documentsRepo.findById(body.data.document_id);
      expect(doc).not.toBeNull();
      expect(doc?.customer_id).toBe('cust-rahul-001');
      expect(doc?.status).toBe('upload_pending');
      expect(doc?.page_count).toBe(12);
    });

    it('resolves alias route /uploads/presigned-url identically', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/uploads/presigned-url',
        headers: {
          authorization: 'Bearer customer-token-rahul'
        },
        payload: {
          fileName: 'notes.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 102400
        }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.upload_url).toBeDefined();
    });

    it('rejects non-PDF MIME type with 400 UNSUPPORTED_MIME', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads/presigned-url',
        headers: {
          authorization: 'Bearer customer-token-rahul'
        },
        payload: {
          file_name: 'photo.png',
          mime_type: 'image/png',
          file_size_bytes: 102400
        }
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe('UNSUPPORTED_MIME');
      expect(body.error.message).toContain('Only PDF documents');
    });

    it('rejects file larger than 50MB with 400 FILE_TOO_LARGE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads/presigned-url',
        headers: {
          authorization: 'Bearer customer-token-rahul'
        },
        payload: {
          file_name: 'giant.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: 52428801 // 50MB + 1 byte
        }
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('rejects missing required parameters with 400 INVALID_PAYLOAD', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads/presigned-url',
        headers: {
          authorization: 'Bearer customer-token-rahul'
        },
        payload: {
          file_name: 'test.pdf'
          // Missing mime_type and file_size_bytes
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_PAYLOAD');
    });

    it('rejects unauthenticated request without identity with 401 UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads/presigned-url',
        payload: {
          file_name: 'test.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: 1024
        }
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /api/v1/documents/:documentId/download-url', () => {
    let rahulDocId: string;

    beforeEach(async () => {
      const doc = await documentsRepo.create({
        customer_id: 'cust-rahul-001',
        file_name: 'final_thesis.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 1048576,
        storage_key: 'uploads/cust-rahul-001/doc-final_thesis.pdf',
        checksum_sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        status: 'ready'
      });
      rahulDocId = doc.id;
    });

    it('allows document owner (customer) to obtain 5-minute signed download URL', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${rahulDocId}/download-url`,
        headers: {
          authorization: 'Bearer customer-token-rahul'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.document_id).toBe(rahulDocId);
      expect(body.data.download_url).toContain(
        'https://storage.supabase.local/customer-documents/uploads/cust-rahul-001/doc-final_thesis.pdf'
      );
      expect(body.data.expires_in_seconds).toBe(300);
      expect(body.data.checksum_sha256).toBe(
        '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
      );
      expect(body.data.content_type).toBe('application/pdf');
    });

    it('allows authorized Print Agent holding an active lease to obtain download URL', async () => {
      // Add active lease for this agent device on Rahul's document
      documentsRepo.addJobLease(
        'agent-device-001',
        rahulDocId,
        'uploads/cust-rahul-001/doc-final_thesis.pdf',
        new Date(Date.now() + 120000).toISOString()
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${rahulDocId}/download-url`,
        headers: {
          authorization: 'Bearer caps_agent_sec_testtoken'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.download_url).toBeDefined();
      expect(body.data.expires_in_seconds).toBe(300);
    });

    it('forbids another customer from downloading Rahul doc with 403 FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${rahulDocId}/download-url`,
        headers: {
          authorization: 'Bearer customer-token-priya' // Different customer
        }
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('forbids an agent that does NOT have an active lease with 403 FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${rahulDocId}/download-url`,
        headers: {
          authorization: 'Bearer caps_agent_sec_testtoken' // Agent has NO lease on this doc
        }
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
      expect(res.json().error.message).toContain(
        'Forbidden: Agent does not possess an active claim lease'
      );
    });

    it('returns 404 NOT_FOUND for non-existent document ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/documents/00000000-0000-0000-0000-000000000000/download-url',
        headers: {
          authorization: 'Bearer customer-token-rahul'
        }
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });
  });
});
