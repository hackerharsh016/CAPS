import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PurgeWorker, createPurgeWorker, DEFAULT_RETENTION_HOURS, DEFAULT_PURGE_INTERVAL_MS } from '../purge.worker.js';
import { StorageService, StorageError } from '../../services/storage.service.js';
import { MockPrintJobsRepository } from '../../modules/print-jobs/print-jobs.repository.js';

describe('Cloud Storage Document Hard Purge Worker (Task INT-D3-07)', () => {
  let mockBucket: any;
  let mockSupabaseClient: any;
  let storageService: StorageService;
  let jobsRepo: MockPrintJobsRepository;

  beforeEach(() => {
    mockBucket = {
      remove: vi.fn(async (paths: string[]) => {
        return { data: { success: true, paths }, error: null };
      }),
      createSignedUploadUrl: vi.fn(),
      createSignedUrl: vi.fn()
    };

    mockSupabaseClient = {
      storage: {
        from: vi.fn((bucket: string) => mockBucket)
      }
    };

    storageService = new StorageService({
      supabaseClient: mockSupabaseClient,
      bucket: 'customer-documents'
    });

    jobsRepo = new MockPrintJobsRepository();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('StorageService.purgeDocument', () => {
    it('immediately calls supabase.storage.from("customer-documents").remove([path])', async () => {
      const res = await storageService.purgeDocument('uploads/cust-1/doc-123.pdf');
      expect(res).toBe(true);
      expect(mockSupabaseClient.storage.from).toHaveBeenCalledWith('customer-documents');
      expect(mockBucket.remove).toHaveBeenCalledWith(['uploads/cust-1/doc-123.pdf']);
    });

    it('handles leading slashes in storage path', async () => {
      const res = await storageService.purgeDocument('/uploads/cust-2/doc-456.pdf');
      expect(res).toBe(true);
      expect(mockBucket.remove).toHaveBeenCalledWith(['uploads/cust-2/doc-456.pdf']);
    });

    it('gracefully handles empty paths or [PURGED] tokens without calling storage remove', async () => {
      await storageService.purgeDocument('');
      await storageService.purgeDocument('[PURGED]');
      expect(mockBucket.remove).not.toHaveBeenCalled();
    });

    it('throws StorageError with code STORAGE_PURGE_FAILED if storage deletion fails', async () => {
      mockBucket.remove.mockResolvedValueOnce({
        data: null,
        error: new Error('Permission denied on bucket')
      });

      await expect(storageService.purgeDocument('uploads/forbidden.pdf')).rejects.toThrowError(
        StorageError
      );
    });
  });

  describe('Immediate Post-Completion & Cancellation Purge', () => {
    it('purges storage file and sets purged_at timestamp when job completes', async () => {
      const job = await jobsRepo.create({
        id: 'job-completed-001',
        shop_id: 'shop-01',
        customer_id: 'cust-01',
        document_storage_key: 'uploads/cust-01/receipt.pdf',
        status: 'completed',
        settings: { copies: 1 }
      });

      const worker = new PurgeWorker({
        storageService,
        printJobsRepository: jobsRepo
      });

      const result = await worker.triggerImmediatePurge(job.id);
      expect(result.success).toBe(true);
      expect(result.jobId).toBe(job.id);
      expect(result.purgedAt).toBeDefined();

      // Verified: Storage remove was called with document key
      expect(mockBucket.remove).toHaveBeenCalledWith(['uploads/cust-01/receipt.pdf']);

      // Verified: Job metadata persists in database with purged_at timestamp
      const updatedJob = await jobsRepo.findById(job.id);
      expect(updatedJob).not.toBeNull();
      expect(updatedJob?.id).toBe('job-completed-001');
      expect(updatedJob?.status).toBe('completed');
      expect(updatedJob?.customer_id).toBe('cust-01');
      expect((updatedJob as any).purged_at).toBe(result.purgedAt);
    });

    it('purges storage file and sets purged_at timestamp when customer cancels job', async () => {
      const job = await jobsRepo.create({
        id: 'job-cancelled-002',
        shop_id: 'shop-01',
        customer_id: 'cust-02',
        document_storage_key: 'uploads/cust-02/draft.pdf',
        status: 'cancelled',
        settings: { copies: 2 }
      });

      const worker = createPurgeWorker({
        storageService,
        printJobsRepository: jobsRepo
      });

      const result = await worker.triggerImmediatePurge(job.id, 'uploads/cust-02/draft.pdf');
      expect(result.success).toBe(true);
      expect(mockBucket.remove).toHaveBeenCalledWith(['uploads/cust-02/draft.pdf']);

      const updatedJob = await jobsRepo.findById(job.id);
      expect(updatedJob?.status).toBe('cancelled');
      expect((updatedJob as any).purged_at).toBeDefined();
    });

    it('works directly with Supabase Client queries and updates', async () => {
      const mockDbFrom = vi.fn((table: string) => {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: {
                  id: 'job-db-003',
                  document_storage_key: 'uploads/cust-03/db-doc.pdf',
                  purged_at: null
                },
                error: null
              }))
            }))
          })),
          update: vi.fn((updateData: any) => ({
            eq: vi.fn(async () => ({ error: null }))
          }))
        };
      });

      const customSupabase = {
        from: mockDbFrom
      };

      const worker = new PurgeWorker({
        storageService,
        supabaseClient: customSupabase
      });

      const result = await worker.purgeJobDocument('job-db-003');
      expect(result.success).toBe(true);
      expect(mockBucket.remove).toHaveBeenCalledWith(['uploads/cust-03/db-doc.pdf']);
      expect(mockDbFrom).toHaveBeenCalledWith('print_jobs');
    });
  });

  describe('Scheduled Retention Purge Sweep (every 10 minutes / 24 hours)', () => {
    it('sweeps jobs older than 24 hours and purges unpurged documents', async () => {
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago

      // Job 1: 25h old, pending_payment, unpurged -> should be purged
      const oldJob = await jobsRepo.create({
        id: 'job-old-25h',
        shop_id: 'shop-01',
        customer_id: 'cust-10',
        document_storage_key: 'uploads/cust-10/stale.pdf',
        status: 'pending_payment'
      });
      // Backdate created_at
      await jobsRepo.update(oldJob.id, { created_at: oldDate });

      // Job 2: 1h old, pending_payment -> active, should NOT be purged
      const recentJob = await jobsRepo.create({
        id: 'job-recent-1h',
        shop_id: 'shop-01',
        customer_id: 'cust-11',
        document_storage_key: 'uploads/cust-11/active.pdf',
        status: 'pending_payment'
      });

      // Job 3: Terminal completed job (1h old) -> should be purged
      const completedJob = await jobsRepo.create({
        id: 'job-completed-recent',
        shop_id: 'shop-01',
        customer_id: 'cust-12',
        document_storage_key: 'uploads/cust-12/done.pdf',
        status: 'completed'
      });

      // Job 4: Already purged job -> should NOT be re-purged
      const alreadyPurgedJob = await jobsRepo.create({
        id: 'job-already-purged',
        shop_id: 'shop-01',
        customer_id: 'cust-13',
        document_storage_key: 'uploads/cust-13/purged.pdf',
        status: 'completed'
      });
      await jobsRepo.update(alreadyPurgedJob.id, { purged_at: new Date().toISOString() });

      const worker = new PurgeWorker({
        storageService,
        printJobsRepository: jobsRepo,
        retentionHours: DEFAULT_RETENTION_HOURS
      });

      const sweepResult = await worker.runPurgeSweep();
      expect(sweepResult.swept).toBe(2); // oldJob and completedJob
      expect(sweepResult.purged).toBe(2);
      expect(sweepResult.failed).toBe(0);

      // Verify files removed
      expect(mockBucket.remove).toHaveBeenCalledWith(['uploads/cust-10/stale.pdf']);
      expect(mockBucket.remove).toHaveBeenCalledWith(['uploads/cust-12/done.pdf']);
      expect(mockBucket.remove).not.toHaveBeenCalledWith(['uploads/cust-11/active.pdf']);

      // Verify DB timestamps
      const checkedOld = await jobsRepo.findById(oldJob.id);
      expect((checkedOld as any).purged_at).toBeDefined();

      const checkedRecent = await jobsRepo.findById(recentJob.id);
      expect((checkedRecent as any).purged_at).toBeUndefined();
    });

    it('supports scheduler lifecycle (start, stop, isRunning) with default 10-minute interval', () => {
      const worker = new PurgeWorker({
        storageService,
        printJobsRepository: jobsRepo
      });

      expect(worker.pollIntervalMs).toBe(DEFAULT_PURGE_INTERVAL_MS);
      expect(worker.isRunning()).toBe(false);

      const timer = worker.start(600000);
      expect(worker.isRunning()).toBe(true);
      expect(timer).toBeDefined();

      worker.stop();
      expect(worker.isRunning()).toBe(false);
    });
  });
});
