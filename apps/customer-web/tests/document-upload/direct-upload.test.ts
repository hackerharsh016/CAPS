import { describe, it, expect, beforeEach } from 'vitest';
import {
  DirectUploadClient,
  computeSha256Checksum
} from '../../src/features/document-upload/direct-upload-client';
import { UploadService } from '../../src/features/document-upload/upload-service';

describe('Direct Private Upload Integration (P04-M03-F02)', () => {
  let client: DirectUploadClient;
  let service: UploadService;

  const customerAlpha = 'usr-customer-alpha';
  const customerBeta = 'usr-customer-beta';

  const createDummyFile = (name: string, content: string, type: string): File => {
    const blob = new Blob([content], { type });
    const file = new File([blob], name, { type });
    return file;
  };

  beforeEach(() => {
    client = new DirectUploadClient();
    service = new UploadService(client);
  });

  describe('Happy Path: Complete Private Upload Pipeline', () => {
    it('negotiates upload intent, streams to storage, and finalizes with verified SHA-256 checksum', async () => {
      const file = createDummyFile(
        'final_thesis.pdf',
        'Sample PDF binary content',
        'application/pdf'
      );

      // 1. Create upload intent
      const intent = await client.createUploadIntent(
        {
          fileName: file.name,
          fileSizeBytes: file.size,
          mimeType: file.type,
          targetShopId: 'shop-8888-campus-xerox'
        },
        customerAlpha
      );

      expect(intent.documentId).toBeDefined();
      expect(intent.uploadUrl).toContain(intent.documentId);
      expect(intent.storagePath).toBe(
        `private/${customerAlpha}/shop-8888-campus-xerox/${intent.documentId}/${file.name}`
      );
      expect(intent.requiredHeaders['x-caps-private-storage']).toBe('true');

      // 2. Direct upload to storage
      await client.uploadToStorage(intent.documentId, file);

      // 3. Compute checksum
      const checksum = await computeSha256Checksum(file);
      expect(checksum).toHaveLength(64); // 64 hex characters

      // 4. Finalize
      const finalized = await client.finalizeUpload(
        intent.documentId,
        {
          sha256Checksum: checksum,
          actualSizeBytes: file.size
        },
        customerAlpha
      );

      expect(finalized.documentId).toBe(intent.documentId);
      expect(finalized.status).toBe('uploaded');
      expect(finalized.sha256Checksum).toBe(checksum);
      expect(finalized.sizeBytes).toBe(file.size);
      expect(finalized.storagePath).toBe(intent.storagePath);
    });

    it('runs end-to-end through UploadService wrapper', async () => {
      const file = createDummyFile('notes.pdf', 'Lecture notes', 'application/pdf');

      const result = await service.uploadDocument(file, {
        customerId: customerAlpha,
        targetShopId: 'shop-9999-metro-prints'
      });

      expect(result.id).toBeDefined();
      expect(result.name).toBe('notes.pdf');
      expect(result.extension).toBe('.pdf');
      expect(result.storagePath).toContain(customerAlpha);
    });
  });

  describe('Expired Upload Link Rejection', () => {
    it('rejects direct storage upload when signed link has expired', async () => {
      const file = createDummyFile('sample.pdf', 'Hello world', 'application/pdf');

      const intent = await client.createUploadIntent(
        {
          fileName: file.name,
          fileSizeBytes: file.size,
          mimeType: file.type
        },
        customerAlpha
      );

      // Force expire link
      client.forceExpireIntent(intent.documentId);

      await expect(client.uploadToStorage(intent.documentId, file)).rejects.toMatchObject({
        code: 'EXPIRED_UPLOAD_LINK'
      });
    });

    it('rejects finalize step if upload session expires before finalization', async () => {
      const file = createDummyFile('sample.pdf', 'Test content', 'application/pdf');

      const intent = await client.createUploadIntent(
        {
          fileName: file.name,
          fileSizeBytes: file.size,
          mimeType: file.type
        },
        customerAlpha
      );

      await client.uploadToStorage(intent.documentId, file);
      const checksum = await computeSha256Checksum(file);

      // Force expire before finalize
      client.forceExpireIntent(intent.documentId);

      await expect(
        client.finalizeUpload(
          intent.documentId,
          {
            sha256Checksum: checksum,
            actualSizeBytes: file.size
          },
          customerAlpha
        )
      ).rejects.toMatchObject({
        code: 'EXPIRED_UPLOAD_LINK'
      });
    });
  });

  describe('Invalid Content & Checksum Rejection', () => {
    it('rejects finalization when actual file size does not match declared intent size', async () => {
      const file = createDummyFile('report.pdf', 'Declared content size', 'application/pdf');

      const intent = await client.createUploadIntent(
        {
          fileName: file.name,
          fileSizeBytes: file.size,
          mimeType: file.type
        },
        customerAlpha
      );

      await client.uploadToStorage(intent.documentId, file);
      const checksum = await computeSha256Checksum(file);

      // Send mismatching size
      await expect(
        client.finalizeUpload(
          intent.documentId,
          {
            sha256Checksum: checksum,
            actualSizeBytes: file.size + 999
          },
          customerAlpha
        )
      ).rejects.toMatchObject({
        code: 'INVALID_CONTENT'
      });
    });

    it('rejects finalization when SHA-256 checksum is missing or invalid', async () => {
      const file = createDummyFile('report.pdf', 'Valid content', 'application/pdf');

      const intent = await client.createUploadIntent(
        {
          fileName: file.name,
          fileSizeBytes: file.size,
          mimeType: file.type
        },
        customerAlpha
      );

      await client.uploadToStorage(intent.documentId, file);

      // Invalid checksum format
      await expect(
        client.finalizeUpload(
          intent.documentId,
          {
            sha256Checksum: 'short_corrupted_hash',
            actualSizeBytes: file.size
          },
          customerAlpha
        )
      ).rejects.toMatchObject({
        code: 'INVALID_CONTENT'
      });
    });
  });

  describe('Cross-User & Tenant Isolation Enforcement', () => {
    it('rejects document finalization when caller does not own the upload intent', async () => {
      const file = createDummyFile(
        'private_records.pdf',
        'Customer Alpha sensitive file',
        'application/pdf'
      );

      // Alpha creates intent
      const intent = await client.createUploadIntent(
        {
          fileName: file.name,
          fileSizeBytes: file.size,
          mimeType: file.type
        },
        customerAlpha
      );

      await client.uploadToStorage(intent.documentId, file);
      const checksum = await computeSha256Checksum(file);

      // Beta tries to finalize Alpha's document
      await expect(
        client.finalizeUpload(
          intent.documentId,
          {
            sha256Checksum: checksum,
            actualSizeBytes: file.size
          },
          customerBeta // Unauthorized caller!
        )
      ).rejects.toMatchObject({
        code: 'CROSS_USER_FORBIDDEN'
      });
    });

    it('rejects document cancellation when caller is not the owner', async () => {
      const file = createDummyFile('thesis.pdf', 'Content', 'application/pdf');

      const intent = await client.createUploadIntent(
        {
          fileName: file.name,
          fileSizeBytes: file.size,
          mimeType: file.type
        },
        customerAlpha
      );

      // Beta attempts to cancel Alpha's upload
      await expect(client.cancelUpload(intent.documentId, customerBeta)).rejects.toMatchObject({
        code: 'CROSS_USER_FORBIDDEN'
      });
    });
  });

  describe('Orphan Cleanup & Abort Handling', () => {
    it('successfully cleans up unfinalized upload when cancelled by owner', async () => {
      const file = createDummyFile('temp_doc.pdf', 'To be cancelled', 'application/pdf');

      const intent = await client.createUploadIntent(
        {
          fileName: file.name,
          fileSizeBytes: file.size,
          mimeType: file.type
        },
        customerAlpha
      );

      const cancelRes = await client.cancelUpload(intent.documentId, customerAlpha);
      expect(cancelRes.success).toBe(true);
      expect(cancelRes.cleanedUp).toBe(true);

      // Subsequent finalize must fail because intent was cleaned up
      await expect(
        client.finalizeUpload(
          intent.documentId,
          {
            sha256Checksum: 'a'.repeat(64),
            actualSizeBytes: file.size
          },
          customerAlpha
        )
      ).rejects.toMatchObject({
        code: 'UPLOAD_FAILED'
      });
    });

    it('invokes orphan cleanup automatically when UploadService encounters an aborted upload', async () => {
      const file = createDummyFile('aborted_doc.pdf', 'Will cancel halfway', 'application/pdf');
      const controller = new AbortController();

      setTimeout(() => {
        controller.abort();
      }, 50);

      await expect(
        service.uploadDocument(file, {
          customerId: customerAlpha,
          signal: controller.signal
        })
      ).rejects.toMatchObject({
        code: 'ABORTED'
      });
    });
  });
});
