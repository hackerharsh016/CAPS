import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { buildApp } from '../src/app.js';
import { MockDocumentsRepository } from '../src/modules/documents/documents.repository.js';
import { MockStorageService } from '../src/modules/documents/storage.service.js';
import {
  TrustedDocumentConverter,
  type IDocumentConverter
} from '../src/modules/documents/document-converter.js';
import { DocumentsService } from '../src/modules/documents/documents.service.js';

describe('Trusted Office & Image Document Conversion to PDF (P06-M04-F01)', () => {
  let app: FastifyInstance;
  let documentsRepo: MockDocumentsRepository;
  let storageService: MockStorageService;
  let converter: TrustedDocumentConverter;
  let documentsService: DocumentsService;

  const testCustomerId = crypto.randomUUID();
  const anotherCustomerId = crypto.randomUUID();

  // Helper to construct mock zip buffers for DOCX/PPTX
  function createMockZip(
    entries: Array<{
      name: string;
      compressedSize?: number;
      uncompressedSize?: number;
      content?: string;
    }>
  ): Buffer {
    const chunks: Buffer[] = [];
    for (const entry of entries) {
      const nameBuf = Buffer.from(entry.name, 'utf8');
      const contentBuf = entry.content ? Buffer.from(entry.content, 'utf8') : Buffer.alloc(0);
      const compSize = entry.compressedSize ?? contentBuf.length;
      const uncompSize = entry.uncompressedSize ?? contentBuf.length;

      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0, 6);
      header.writeUInt16LE(0, 8);
      header.writeUInt16LE(0, 10);
      header.writeUInt16LE(0, 12);
      header.writeUInt32LE(0, 14);
      header.writeUInt32LE(compSize, 18);
      header.writeUInt32LE(uncompSize, 22);
      header.writeUInt16LE(nameBuf.length, 26);
      header.writeUInt16LE(0, 28);

      chunks.push(header);
      chunks.push(nameBuf);
      chunks.push(contentBuf.subarray(0, compSize));
    }
    return Buffer.concat(chunks);
  }

  function createMockPng(isColor: boolean = true): Buffer {
    const buf = Buffer.alloc(33);
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // PNG signature
    buf.writeUInt32BE(13, 8); // chunk len
    buf.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
    buf.writeUInt32BE(200, 16); // width
    buf.writeUInt32BE(300, 20); // height
    buf.writeUInt8(8, 24); // bit depth
    buf.writeUInt8(isColor ? 2 : 0, 25); // color type (2=RGB, 0=Grayscale)
    return buf;
  }

  function createMockJpeg(): Buffer {
    return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  }

  function createMockPdf(): Buffer {
    return Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \n0000000115 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n180\n%%EOF'
    );
  }

  beforeEach(async () => {
    documentsRepo = new MockDocumentsRepository();
    storageService = new MockStorageService();
    converter = new TrustedDocumentConverter();
    documentsService = new DocumentsService(documentsRepo, storageService, converter);

    app = buildApp({
      documentsRepo,
      storageService,
      documentConverter: converter,
      documentsService
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('1. Upload Intent Reservation (POST /api/v1/documents/upload-intent)', () => {
    it('creates upload intent for supported DOCX document', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'quarterly_report.docx',
          mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          file_size_bytes: 204800
        }
      });

      expect(res.statusCode).toBe(201);
      const json = JSON.parse(res.payload);
      expect(json.data.document_id).toBeDefined();
      expect(json.data.upload_url).toContain('/api/v1/storage/upload');
      expect(json.data.storage_key).toContain(testCustomerId);
      expect(json.data.max_size_bytes).toBe(52428800);
      expect(json.data.allowed_mimes).toContain('application/pdf');
    });

    it('rejects unsupported MIME types (e.g. executable .exe or video .mp4)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'malicious.exe',
          mime_type: 'application/x-msdownload',
          file_size_bytes: 1024
        }
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error.code).toBe('UNSUPPORTED_MIME');
    });

    it('rejects file size exceeding maximum limit of 50 MB', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'huge_presentation.pptx',
          mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          file_size_bytes: 55 * 1024 * 1024 // 55 MB
        }
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error.code).toBe('FILE_TOO_LARGE');
    });

    it('rejects invalid or missing customer ID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        payload: {
          file_name: 'test.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: 1024
        }
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error.code).toBe('MISSING_CUSTOMER_ID');
    });
  });

  describe('2. Trusted Office & Image Sandboxed Conversion', () => {
    it('successfully converts valid DOCX file to normalized PDF and extracts page metrics', async () => {
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'thesis_chapter1.docx',
          mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          file_size_bytes: 4096
        }
      });
      const docId = JSON.parse(intentRes.payload).data.document_id;

      // Mock DOCX file buffer
      const docxBuffer = createMockZip([
        {
          name: 'word/document.xml',
          content:
            '<w:document><w:body><w:p><w:r><w:t>CAPS Document Body</w:t></w:r></w:p></w:body></w:document>'
        }
      ]);

      const convertRes = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/convert`,
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_base64: docxBuffer.toString('base64')
        }
      });

      expect(convertRes.statusCode).toBe(200);
      const convertJson = JSON.parse(convertRes.payload);
      expect(convertJson.data.document_id).toBe(docId);
      expect(convertJson.data.status).toBe('ready');
      expect(convertJson.data.page_count).toBeGreaterThanOrEqual(1);
      expect(convertJson.data.dimensions.format).toBe('A4');
      expect(convertJson.data.checksum_sha256).toBeDefined();

      // Check stored PDF
      const metaRes = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${docId}`,
        headers: { 'x-customer-id': testCustomerId }
      });
      expect(metaRes.statusCode).toBe(200);
      const meta = JSON.parse(metaRes.payload).data;
      expect(meta.status).toBe('ready');
      expect(meta.converted_storage_key).toContain(`converted/${docId}.pdf`);
      expect(meta.conversion_metadata.target_format).toBe('pdf');
    });

    it('successfully converts valid PPTX presentation to normalized landscape PDF', async () => {
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'deck.pptx',
          mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          file_size_bytes: 20000
        }
      });
      const docId = JSON.parse(intentRes.payload).data.document_id;

      const pptxBuffer = createMockZip([
        {
          name: 'ppt/slides/slide1.xml',
          content:
            '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Pitch Deck</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
        }
      ]);

      const convertRes = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/convert`,
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_base64: pptxBuffer.toString('base64')
        }
      });

      expect(convertRes.statusCode).toBe(200);
      const json = JSON.parse(convertRes.payload);
      expect(json.data.has_color).toBe(true);
      expect(json.data.dimensions.width_pt).toBeGreaterThan(json.data.dimensions.height_pt); // Landscape
    });

    it('successfully converts PNG image to normalized PDF and detects color mode', async () => {
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'diagram_color.png',
          mime_type: 'image/png',
          file_size_bytes: 33
        }
      });
      const docId = JSON.parse(intentRes.payload).data.document_id;
      const pngBuffer = createMockPng(true); // RGB color

      const convertRes = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/convert`,
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_base64: pngBuffer.toString('base64')
        }
      });

      expect(convertRes.statusCode).toBe(200);
      const json = JSON.parse(convertRes.payload);
      expect(json.data.has_color).toBe(true);
      expect(json.data.page_count).toBe(1);
    });

    it('successfully converts JPEG image to normalized PDF', async () => {
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'photo.jpg',
          mime_type: 'image/jpeg',
          file_size_bytes: 12
        }
      });
      const docId = JSON.parse(intentRes.payload).data.document_id;
      const jpegBuffer = createMockJpeg();

      const convertRes = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/convert`,
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_base64: jpegBuffer.toString('base64')
        }
      });

      expect(convertRes.statusCode).toBe(200);
      const json = JSON.parse(convertRes.payload);
      expect(json.data.page_count).toBe(1);
      expect(json.data.status).toBe('ready');
    });

    it('passes through and validates standard PDF files', async () => {
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'document.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: 250
        }
      });
      const docId = JSON.parse(intentRes.payload).data.document_id;
      const pdfBuffer = createMockPdf();

      const convertRes = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/convert`,
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_base64: pdfBuffer.toString('base64')
        }
      });

      expect(convertRes.statusCode).toBe(200);
      const json = JSON.parse(convertRes.payload);
      expect(json.data.page_count).toBe(1);
    });
  });

  describe('3. Security Sandbox Threat Mitigations & Corrupted File Rejection', () => {
    it('detects and rejects MIME type spoofing via magic bytes verification', async () => {
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'fake_image.png',
          mime_type: 'image/png',
          file_size_bytes: 100
        }
      });
      const docId = JSON.parse(intentRes.payload).data.document_id;

      // Send plain text instead of PNG binary signature
      const fakeBuffer = Buffer.from('This is a plain text file pretending to be PNG.');

      const convertRes = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/convert`,
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_base64: fakeBuffer.toString('base64')
        }
      });

      expect(convertRes.statusCode).toBe(400);
      const json = JSON.parse(convertRes.payload);
      expect(json.error.code).toBe('MAGIC_BYTE_MISMATCH');

      // Verify document status marked failed
      const meta = await documentsRepo.findById(docId);
      expect(meta?.status).toBe('failed');
    });

    it('rejects zip bombs with dangerous compression ratios (> 100:1)', async () => {
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'zipbomb.docx',
          mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          file_size_bytes: 200
        }
      });
      const docId = JSON.parse(intentRes.payload).data.document_id;

      // Zip entry with 500:1 compression ratio
      const zipBombBuffer = createMockZip([
        {
          name: 'word/document.xml',
          compressedSize: 100,
          uncompressedSize: 50000 // 500:1 ratio
        }
      ]);

      const convertRes = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/convert`,
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_base64: zipBombBuffer.toString('base64')
        }
      });

      expect(convertRes.statusCode).toBe(422);
      const json = JSON.parse(convertRes.payload);
      expect(json.error.code).toBe('DECOMPRESSION_BOMB_DETECTED');
    });

    it('rejects uncompressed size exceeding maximum allowed memory limit of 100 MB', async () => {
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'giant.docx',
          mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          file_size_bytes: 5000000
        }
      });
      const docId = JSON.parse(intentRes.payload).data.document_id;

      const giantBuffer = createMockZip([
        {
          name: 'word/document.xml',
          compressedSize: 5000000,
          uncompressedSize: 110 * 1024 * 1024 // 110 MB
        }
      ]);

      const convertRes = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/convert`,
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_base64: giantBuffer.toString('base64')
        }
      });

      expect(convertRes.statusCode).toBe(422);
      const json = JSON.parse(convertRes.payload);
      expect(json.error.code).toBe('DECOMPRESSION_SIZE_EXCEEDED');
    });

    it('detects and rejects documents containing dangerous VBA macros or script objects', async () => {
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'macro_enabled.docx',
          mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          file_size_bytes: 5000
        }
      });
      const docId = JSON.parse(intentRes.payload).data.document_id;

      const macroBuffer = createMockZip([
        {
          name: 'word/vbaProject.bin',
          content: 'binary macro payload'
        }
      ]);

      const convertRes = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/convert`,
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_base64: macroBuffer.toString('base64')
        }
      });

      expect(convertRes.statusCode).toBe(422);
      const json = JSON.parse(convertRes.payload);
      expect(json.error.code).toBe('DANGEROUS_CONTENT');
    });

    it('detects and rejects documents with nested archive bombs', async () => {
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'nested.docx',
          mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          file_size_bytes: 2000
        }
      });
      const docId = JSON.parse(intentRes.payload).data.document_id;

      const nestedBuffer = createMockZip([
        {
          name: 'payload.zip',
          content: 'inner zip'
        }
      ]);

      const convertRes = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/convert`,
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_base64: nestedBuffer.toString('base64')
        }
      });

      expect(convertRes.statusCode).toBe(422);
      const json = JSON.parse(convertRes.payload);
      expect(json.error.code).toBe('NESTED_ARCHIVE_DETECTED');
    });

    it('detects and rejects XML External Entity (XXE) injection attacks', async () => {
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'xxe_attack.docx',
          mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          file_size_bytes: 3000
        }
      });
      const docId = JSON.parse(intentRes.payload).data.document_id;

      const xxeBuffer = createMockZip([
        {
          name: 'word/document.xml',
          content: '<!DOCTYPE test [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]><root>&xxe;</root>'
        }
      ]);

      const convertRes = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/convert`,
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_base64: xxeBuffer.toString('base64')
        }
      });

      expect(convertRes.statusCode).toBe(422);
      const json = JSON.parse(convertRes.payload);
      expect(json.error.code).toBe('XXE_ATTACK_DETECTED');
    });

    it('enforces CPU / execution timeout boundary (408 CONVERSION_TIMEOUT)', async () => {
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'slow_document.docx',
          mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          file_size_bytes: 4000
        }
      });
      const docId = JSON.parse(intentRes.payload).data.document_id;

      // Mock a converter that exceeds the timeout
      const slowConverter: IDocumentConverter = {
        async convert() {
          await new Promise(resolve => setTimeout(resolve, 50));
          throw new Error('Should have timed out');
        }
      };

      const customService = new DocumentsService(documentsRepo, storageService, slowConverter);
      const customApp = buildApp({
        documentsRepo,
        storageService,
        documentConverter: slowConverter,
        documentsService: customService
      });
      await customApp.ready();

      const docxBuffer = createMockZip([
        {
          name: 'word/document.xml',
          content:
            '<w:document><w:body><w:p><w:r><w:t>Slow body</w:t></w:r></w:p></w:body></w:document>'
        }
      ]);

      const convertRes = await customApp.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/convert`,
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_base64: docxBuffer.toString('base64'),
          timeout_ms: 10 // 10ms timeout
        }
      });

      expect(convertRes.statusCode).toBe(408);
      const json = JSON.parse(convertRes.payload);
      expect(json.error.code).toBe('CONVERSION_TIMEOUT');
      await customApp.close();
    });
  });

  describe('4. Document Metadata & Download Signed URL', () => {
    it('returns signed download URL for ready converted document', async () => {
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'ready_doc.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: 250
        }
      });
      const docId = JSON.parse(intentRes.payload).data.document_id;

      await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/convert`,
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_base64: createMockPdf().toString('base64')
        }
      });

      const downloadRes = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${docId}/download`,
        headers: { 'x-customer-id': testCustomerId }
      });

      expect(downloadRes.statusCode).toBe(200);
      const json = JSON.parse(downloadRes.payload);
      expect(json.data.document_id).toBe(docId);
      expect(json.data.download_url).toContain('/api/v1/storage/download');
      expect(json.data.content_type).toBe('application/pdf');
    });

    it('rejects download request when document is not ready', async () => {
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'unconverted.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: 250
        }
      });
      const docId = JSON.parse(intentRes.payload).data.document_id;

      const downloadRes = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${docId}/download`,
        headers: { 'x-customer-id': testCustomerId }
      });

      expect(downloadRes.statusCode).toBe(400);
      const json = JSON.parse(downloadRes.payload);
      expect(json.error.code).toBe('DOCUMENT_NOT_READY');
    });

    it('rejects access from unauthorized customer (isolation barrier)', async () => {
      const intentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/upload-intent',
        headers: { 'x-customer-id': testCustomerId },
        payload: {
          file_name: 'private.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: 250
        }
      });
      const docId = JSON.parse(intentRes.payload).data.document_id;

      const accessRes = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${docId}`,
        headers: { 'x-customer-id': anotherCustomerId }
      });

      expect(accessRes.statusCode).toBe(403);
      const json = JSON.parse(accessRes.payload);
      expect(json.error.code).toBe('FORBIDDEN');
    });

    it('returns 404 for non-existent document ID', async () => {
      const fakeId = crypto.randomUUID();
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${fakeId}`,
        headers: { 'x-customer-id': testCustomerId }
      });

      expect(res.statusCode).toBe(404);
      const json = JSON.parse(res.payload);
      expect(json.error.code).toBe('DOCUMENT_NOT_FOUND');
    });
  });
});
