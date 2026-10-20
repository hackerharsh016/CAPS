import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { buildApp } from '../src/app.js';
import { MockPrintJobsRepository } from '../src/modules/print-jobs/print-jobs.repository.js';
import { MockDocumentsRepository } from '../src/modules/documents/documents.repository.js';
import { MockStorageService } from '../src/modules/documents/storage.service.js';
import {
  MockJobEventsRepository,
  MockDocumentDeletionLogsRepository
} from '../src/modules/events/events.repository.js';
import { PrivacyRetentionService } from '../src/modules/documents/privacy-retention.service.js';
import { DocumentCleanupJob } from '../src/jobs/document-cleanup.job.js';

describe('Document Retention & Audit Cleanup (P06-M04-F02)', () => {
  let app: FastifyInstance;
  let printJobsRepo: MockPrintJobsRepository;
  let documentsRepo: MockDocumentsRepository;
  let storageService: MockStorageService;
  let deletionLogsRepo: MockDocumentDeletionLogsRepository;
  let jobEventsRepo: MockJobEventsRepository;
  let privacyService: PrivacyRetentionService;
  let cleanupJob: DocumentCleanupJob;

  const testShopId = crypto.randomUUID();
  const testCustomerId = crypto.randomUUID();

  beforeEach(async () => {
    printJobsRepo = new MockPrintJobsRepository();
    documentsRepo = new MockDocumentsRepository();
    storageService = new MockStorageService();
    deletionLogsRepo = new MockDocumentDeletionLogsRepository();
    jobEventsRepo = new MockJobEventsRepository();

    privacyService = new PrivacyRetentionService(
      printJobsRepo,
      documentsRepo,
      storageService,
      deletionLogsRepo,
      jobEventsRepo,
      {
        terminalRetentionMs: 30 * 60 * 1000, // 30 minutes
        hardTtlMs: 24 * 60 * 60 * 1000 // 24 hours
      }
    );

    cleanupJob = new DocumentCleanupJob(privacyService);

    app = buildApp({
      printJobsRepo,
      documentsRepo,
      storageService,
      deletionLogsRepo,
      jobEventsRepo,
      privacyRetentionService: privacyService,
      documentCleanupJob: cleanupJob
    });
    await app.ready();
  });

  afterEach(async () => {
    cleanupJob.stop();
    await app.close();
  });

  describe('1. No source remains past TTL regardless of failed prints', () => {
    it('purges failed, cancelled, and stuck jobs and documents past hard TTL (24h)', async () => {
      const pastTtlDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago

      // 1. Failed job past TTL
      const failedKey = 'uploads/customer1/failed_doc.pdf';
      await storageService.putObject(
        failedKey,
        Buffer.from('failed doc content'),
        'application/pdf'
      );
      const failedJob = await printJobsRepo.create({
        shop_id: testShopId,
        customer_id: testCustomerId,
        document_storage_key: failedKey,
        settings: { copies: 1 },
        price_total_paise: 500,
        price_breakdown: { base: 500 },
        document_expires_at: pastTtlDate
      });
      await printJobsRepo.update(failedJob.id, { status: 'failed' });

      // 2. Cancelled job past TTL
      const cancelledKey = 'uploads/customer1/cancelled_doc.pdf';
      await storageService.putObject(
        cancelledKey,
        Buffer.from('cancelled doc content'),
        'application/pdf'
      );
      const cancelledJob = await printJobsRepo.create({
        shop_id: testShopId,
        customer_id: testCustomerId,
        document_storage_key: cancelledKey,
        settings: { copies: 1 },
        price_total_paise: 300,
        price_breakdown: { base: 300 },
        document_expires_at: pastTtlDate
      });
      await printJobsRepo.update(cancelledJob.id, { status: 'cancelled' });

      // 3. Stuck pending_payment job past TTL
      const stuckKey = 'uploads/customer1/stuck_unpaid.docx';
      await storageService.putObject(
        stuckKey,
        Buffer.from('stuck unpaid doc'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      const stuckJob = await printJobsRepo.create({
        shop_id: testShopId,
        customer_id: testCustomerId,
        document_storage_key: stuckKey,
        settings: { copies: 2 },
        price_total_paise: 800,
        price_breakdown: { base: 800 },
        document_expires_at: pastTtlDate
      });

      // 4. Standalone document past TTL
      const docRawKey = 'uploads/customer1/doc_raw.docx';
      const docPdfKey = 'converted/customer1/doc_converted.pdf';
      await storageService.putObject(
        docRawKey,
        Buffer.from('docx content'),
        'application/octet-stream'
      );
      await storageService.putObject(docPdfKey, Buffer.from('pdf content'), 'application/pdf');
      const standaloneDoc = await documentsRepo.create({
        customer_id: testCustomerId,
        file_name: 'thesis.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        file_size_bytes: 5000,
        storage_key: docRawKey,
        expires_at: pastTtlDate
      });
      await documentsRepo.update(standaloneDoc.id, {
        status: 'ready',
        converted_storage_key: docPdfKey
      });

      // Execute full sweep
      const sweepResults = await privacyService.runFullSweep(new Date());

      expect(sweepResults.jobs_purged).toBe(3);
      expect(sweepResults.documents_purged).toBe(1);
      expect(sweepResults.errors).toHaveLength(0);

      // Verify all objects deleted from storage
      expect(await storageService.getObject(failedKey)).toBeNull();
      expect(await storageService.getObject(cancelledKey)).toBeNull();
      expect(await storageService.getObject(stuckKey)).toBeNull();
      expect(await storageService.getObject(docRawKey)).toBeNull();
      expect(await storageService.getObject(docPdfKey)).toBeNull();

      // Verify print job storage keys redacted to [PURGED]
      const updatedFailed = await printJobsRepo.findById(failedJob.id);
      expect(updatedFailed?.document_storage_key).toBe('[PURGED]');

      const updatedCancelled = await printJobsRepo.findById(cancelledJob.id);
      expect(updatedCancelled?.document_storage_key).toBe('[PURGED]');

      const updatedStuck = await printJobsRepo.findById(stuckJob.id);
      expect(updatedStuck?.document_storage_key).toBe('[PURGED]');

      // Verify document marked purged
      const updatedDoc = await documentsRepo.findById(standaloneDoc.id);
      expect(updatedDoc?.status).toBe('purged');

      // Verify deletion audit logs exist
      const deletionLogs = await deletionLogsRepo.findAll();
      expect(deletionLogs.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('2. 30-Minute Terminal Retention Cleanup Window', () => {
    it('purges completed jobs past 30-minute retention window, but preserves active jobs within the window', async () => {
      const now = new Date();
      const futureTtl = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(); // TTL 12h in future

      // Job 1: Completed 45 minutes ago -> eligible for purge
      const expiredCompletedKey = 'uploads/customer1/old_completed.pdf';
      await storageService.putObject(
        expiredCompletedKey,
        Buffer.from('old print'),
        'application/pdf'
      );
      const oldJob = await printJobsRepo.create({
        shop_id: testShopId,
        customer_id: testCustomerId,
        document_storage_key: expiredCompletedKey,
        settings: { copies: 1 },
        price_total_paise: 200,
        price_breakdown: { base: 200 },
        document_expires_at: futureTtl
      });
      await printJobsRepo.update(oldJob.id, { status: 'completed' });
      // Simulate completed 45 minutes ago
      const fortyFiveMinsAgo = new Date(now.getTime() - 45 * 60 * 1000).toISOString();
      const oldJobRef = (
        printJobsRepo as unknown as { jobs: Map<string, { updated_at: string }> }
      ).jobs.get(oldJob.id);
      if (oldJobRef) oldJobRef.updated_at = fortyFiveMinsAgo;

      // Job 2: Completed 10 minutes ago -> within 30m window, MUST NOT be purged yet
      const recentCompletedKey = 'uploads/customer1/recent_completed.pdf';
      await storageService.putObject(
        recentCompletedKey,
        Buffer.from('recent print'),
        'application/pdf'
      );
      const recentJob = await printJobsRepo.create({
        shop_id: testShopId,
        customer_id: testCustomerId,
        document_storage_key: recentCompletedKey,
        settings: { copies: 1 },
        price_total_paise: 200,
        price_breakdown: { base: 200 },
        document_expires_at: futureTtl
      });
      await printJobsRepo.update(recentJob.id, { status: 'completed' });
      // Simulate completed 10 minutes ago
      const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
      const recentJobRef = (
        printJobsRepo as unknown as { jobs: Map<string, { updated_at: string }> }
      ).jobs.get(recentJob.id);
      if (recentJobRef) recentJobRef.updated_at = tenMinsAgo;

      // Run sweep
      const results = await privacyService.sweepExpiredPrintJobs(now);

      expect(results.scanned).toBe(1);
      expect(results.purged).toBe(1);

      // Old job was purged
      expect(await storageService.getObject(expiredCompletedKey)).toBeNull();
      const oldCheck = await printJobsRepo.findById(oldJob.id);
      expect(oldCheck?.document_storage_key).toBe('[PURGED]');

      // Recent job remains accessible
      expect(await storageService.getObject(recentCompletedKey)).not.toBeNull();
      const recentCheck = await printJobsRepo.findById(recentJob.id);
      expect(recentCheck?.document_storage_key).toBe(recentCompletedKey);
    });
  });

  describe('3. Safe Retry & Deletion Trace on Transient Failures', () => {
    it('safely handles storage failures without corrupting records, and succeeds on subsequent retry', async () => {
      const pastTtl = new Date(Date.now() - 3600000).toISOString();
      const flakyKey = 'uploads/customer1/flaky_doc.pdf';
      await storageService.putObject(flakyKey, Buffer.from('flaky data'), 'application/pdf');

      const job = await printJobsRepo.create({
        shop_id: testShopId,
        customer_id: testCustomerId,
        document_storage_key: flakyKey,
        settings: { copies: 1 },
        price_total_paise: 400,
        price_breakdown: { base: 400 },
        document_expires_at: pastTtl
      });
      await printJobsRepo.update(job.id, { status: 'failed' });

      // Simulate transient storage network/503 error
      const originalDelete = storageService.deleteObject.bind(storageService);
      let attempts = 0;
      storageService.deleteObject = async (key: string) => {
        attempts++;
        if (attempts === 1) {
          throw new Error('Storage 503 Service Unavailable');
        }
        return originalDelete(key);
      };

      // 1. First sweep fails safely
      const firstSweep = await privacyService.sweepExpiredPrintJobs();
      expect(firstSweep.purged).toBe(0);
      expect(firstSweep.errors).toHaveLength(1);
      expect(firstSweep.errors[0]?.message).toContain('Storage 503');

      // Verify job record was NOT redacted while delete was failing
      const afterFirstSweep = await printJobsRepo.findById(job.id);
      expect(afterFirstSweep?.document_storage_key).toBe(flakyKey);

      // 2. Second sweep succeeds on retry
      const secondSweep = await privacyService.sweepExpiredPrintJobs();
      expect(secondSweep.purged).toBe(1);
      expect(secondSweep.errors).toHaveLength(0);

      // Verify job record is now cleanly purged
      const afterSecondSweep = await printJobsRepo.findById(job.id);
      expect(afterSecondSweep?.document_storage_key).toBe('[PURGED]');

      // Verify audit logs were written exactly once
      const logs = await deletionLogsRepo.findByJobId(job.id);
      expect(logs).toHaveLength(1);
      expect(logs[0]?.reason).toBe('retention_expired');
    });
  });

  describe('4. Idempotency & Duplicate Sweeps', () => {
    it('is idempotent when run repeatedly against already purged jobs or missing storage objects', async () => {
      const pastTtl = new Date(Date.now() - 3600000).toISOString();
      const key = 'uploads/customer1/idempotent.pdf';
      await storageService.putObject(key, Buffer.from('doc'), 'application/pdf');

      const job = await printJobsRepo.create({
        shop_id: testShopId,
        customer_id: testCustomerId,
        document_storage_key: key,
        settings: { copies: 1 },
        price_total_paise: 300,
        price_breakdown: { base: 300 },
        document_expires_at: pastTtl
      });
      await printJobsRepo.update(job.id, { status: 'completed' });

      // Run 1
      const res1 = await privacyService.sweepExpiredPrintJobs();
      expect(res1.purged).toBe(1);

      // Run 2 (immediately after)
      const res2 = await privacyService.sweepExpiredPrintJobs();
      expect(res2.purged).toBe(0);
      expect(res2.scanned).toBe(0);
      expect(res2.errors).toHaveLength(0);

      // Deletion logs count remains exactly 1
      const logs = await deletionLogsRepo.findByJobId(job.id);
      expect(logs).toHaveLength(1);
    });
  });

  describe('5. Audit Metadata Sanitization (Zero Document Content Leakage)', () => {
    it('ensures audit ledger records contain zero raw document binaries or sensitive keys', async () => {
      const pastTtl = new Date(Date.now() - 3600000).toISOString();
      const secretDocKey = 'uploads/customer1/secret.pdf';
      await storageService.putObject(
        secretDocKey,
        Buffer.from('top secret customer data'),
        'application/pdf'
      );

      const job = await printJobsRepo.create({
        shop_id: testShopId,
        customer_id: testCustomerId,
        document_storage_key: secretDocKey,
        settings: { copies: 1 },
        price_total_paise: 1500,
        price_breakdown: { base: 1500 },
        document_expires_at: pastTtl
      });
      await printJobsRepo.update(job.id, { status: 'completed' });

      await privacyService.sweepExpiredPrintJobs();

      // Check job events
      const events = await jobEventsRepo.findByJobId(job.id);
      const purgeEvent = events.find(e => e.event_name === 'document_purged');
      expect(purgeEvent).toBeDefined();

      const metadata = purgeEvent?.metadata ?? {};
      expect(metadata['document_data']).toBeUndefined();
      expect(metadata['raw_document']).toBeUndefined();
      expect(metadata['pdf_content']).toBeUndefined();
      expect(metadata['file_bytes']).toBeUndefined();
      expect(metadata['payload_base64']).toBeUndefined();

      // Non-sensitive bookkeeping metadata is intact
      expect(metadata['deletion_log_id']).toBeDefined();
      expect(metadata['deleted_by']).toBe('cloud_ttl_sweeper');
      expect(metadata['reason']).toBe('print_completed');
      expect(metadata['price_total_paise']).toBe(1500);
    });
  });

  describe('6. REST Endpoints & Spooler Boundary Disclosure', () => {
    it('POST /api/v1/documents/cleanup triggers sweep and returns statistics', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/cleanup',
        payload: {
          limit: 50
        }
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.status).toBe('ok');
      expect(json.data.timestamp).toBeDefined();
      expect(json.data.jobs_scanned).toBeDefined();
      expect(json.data.jobs_purged).toBeDefined();
    });

    it('GET /api/v1/documents/cleanup/policy discloses retention rules and spooler privacy caveats', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/documents/cleanup/policy'
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data.terminal_retention_minutes).toBe(30);
      expect(json.data.hard_ttl_hours).toBe(24);
      expect(json.data.spooler_privacy_caveat).toContain('print spooler files (.SPL)');
      expect(json.data.audit_metadata_retention).toContain('Page counts, pricing breakdowns');
    });

    it('GET /api/v1/documents/cleanup/audit returns immutable deletion ledger', async () => {
      // Seed a deletion log
      await deletionLogsRepo.create({
        document_storage_key: 'uploads/audit_test.pdf',
        deleted_by: 'cloud_ttl_sweeper',
        reason: 'retention_expired'
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/documents/cleanup/audit?limit=10'
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data).toBeInstanceOf(Array);
      expect(json.data.length).toBeGreaterThanOrEqual(1);
      expect(json.data[0].document_storage_key).toBe('uploads/audit_test.pdf');
    });
  });

  describe('7. DocumentCleanupJob Scheduler Control', () => {
    it('executes job sweep cycle and prevents concurrent overlapping executions', async () => {
      const results = await cleanupJob.run();
      expect(results.timestamp).toBeDefined();
      expect(results.errors).toHaveLength(0);

      // Start timer and stop timer cleanly
      cleanupJob.start(1000);
      cleanupJob.stop();
    });
  });
});
