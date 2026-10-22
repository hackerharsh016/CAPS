import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { SupabasePrintJobsRepository } from '../supabase/supabase-print-jobs.repository.js';
import { SupabaseShopsRepository } from '../supabase/supabase-shops.repository.js';
import { SupabaseAgentsRepository } from '../supabase/supabase-agents.repository.js';
import { SupabasePricingRepository } from '../supabase/supabase-pricing.repository.js';
import { buildApp } from '../../app.js';

describe('Supabase Database Repositories & Transactional RPC Wiring (INT-D3-03)', () => {
  let mockTables: Record<string, any[]>;
  let mockRpcHandlers: Record<string, (params: any) => Promise<{ data: any; error: any }>>;
  let mockSupabaseClient: any;

  beforeEach(() => {
    mockTables = {
      print_jobs: [],
      shops: [],
      agent_devices: [],
      job_attempts: [],
      job_events: [],
      audit_logs: [],
      quotes: []
    };

    mockRpcHandlers = {
      claim_next_approved_job: async (params: any) => {
        const jobs = mockTables['print_jobs'] || [];
        const eligibleJob = jobs.find(
          j => j.shop_id === params.p_shop_id && (j.status === 'approved' || j.status === 'queued')
        );

        if (!eligibleJob) {
          return { data: null, error: null };
        }

        eligibleJob.status = 'claimed';
        eligibleJob.claimed_at = new Date().toISOString();
        eligibleJob.claimed_by_agent_id = params.p_agent_device_id;

        const attemptId = crypto.randomUUID();
        const leaseToken = crypto.randomUUID();

        const attempt = {
          id: attemptId,
          job_id: eligibleJob.id,
          agent_device_id: params.p_agent_device_id,
          lease_token: leaseToken,
          lease_expires_at: new Date(
            Date.now() + (params.p_lease_duration_seconds || 120) * 1000
          ).toISOString(),
          status: 'claimed'
        };
        const attempts = mockTables['job_attempts'] || [];
        attempts.push(attempt);

        return {
          data: {
            job_id: eligibleJob.id,
            attempt_id: attemptId,
            lease_token: leaseToken,
            lease_expires_at: attempt.lease_expires_at,
            status: 'CLAIMED',
            settings: eligibleJob.settings,
            document_url: 'https://storage.caps.local/documents/test.pdf',
            is_idempotent_replay: false
          },
          error: null
        };
      },
      record_payment_event_idempotent: async (params: any) => {
        return {
          data: {
            payment_id: params.p_payment_id,
            status: 'recorded',
            is_idempotent_replay: false
          },
          error: null
        };
      }
    };

    mockSupabaseClient = {
      from: (table: string) => {
        const rows = mockTables[table] || [];
        const filters: Array<{ field: string; val: any }> = [];
        let pendingUpdates: any = null;
        let isDelete = false;
        let isSingle = false;
        let isMaybeSingle = false;

        const builder: any = {
          select: (_cols?: string, _opts?: any) => builder,
          insert: (data: any) => {
            const arr = Array.isArray(data) ? data : [data];
            rows.push(...arr);
            return builder;
          },
          update: (updates: any) => {
            pendingUpdates = updates;
            return builder;
          },
          delete: () => {
            isDelete = true;
            return builder;
          },
          eq: (field: string, val: any) => {
            filters.push({ field, val });
            return builder;
          },
          or: () => builder,
          order: () => builder,
          range: () => builder,
          single: () => {
            isSingle = true;
            return builder;
          },
          maybeSingle: () => {
            isMaybeSingle = true;
            return builder;
          },
          then: (onfulfilled: any) => {
            let matched = [...rows];
            for (const f of filters) {
              matched = matched.filter(r => r[f.field] === f.val);
            }

            if (pendingUpdates) {
              for (const row of matched) {
                Object.assign(row, pendingUpdates);
              }
            }

            if (isDelete) {
              mockTables[table] = rows.filter(r => !matched.includes(r));
            }

            let resultData: any = matched;
            if (isSingle || isMaybeSingle) {
              resultData = matched[0] || null;
            }

            return Promise.resolve(
              onfulfilled({ data: resultData, count: matched.length, error: null })
            );
          }
        };
        return builder;
      },
      rpc: async (fn: string, params: any) => {
        const handler = mockRpcHandlers[fn];
        if (!handler) {
          return { data: null, error: { message: `RPC ${fn} not found` } };
        }
        return handler(params);
      }
    };
  });

  describe('SupabasePrintJobsRepository', () => {
    it('creates print job record in print_jobs table', async () => {
      const repo = new SupabasePrintJobsRepository({ client: mockSupabaseClient });

      const newJob = await repo.create({
        shop_id: 'shop-001',
        customer_id: 'cust-001',
        document_storage_key: 'uploads/file1.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw', sides: 'single', copies: 2 },
        priority_tier: 'urgent',
        price_total_paise: 5000
      });

      expect(newJob.id).toBeDefined();
      expect(newJob.shop_id).toBe('shop-001');
      expect(newJob.customer_id).toBe('cust-001');
      expect(newJob.priority_tier).toBe('urgent');
      expect(newJob.status).toBe('pending_payment');
      expect(mockTables['print_jobs']).toHaveLength(1);
    });

    it('finds job by ID with customer and document details', async () => {
      const repo = new SupabasePrintJobsRepository({ client: mockSupabaseClient });

      const created = await repo.create({
        shop_id: 'shop-001',
        customer_id: 'cust-001',
        document_storage_key: 'uploads/file1.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw' },
        price_total_paise: 1500
      });

      const found = await repo.findById(created.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.shop_id).toBe('shop-001');

      const nonExistent = await repo.findById('non-existent-uuid');
      expect(nonExistent).toBeNull();
    });

    it('claims next approved job atomically updating state to CLAIMED via RPC', async () => {
      const repo = new SupabasePrintJobsRepository({ client: mockSupabaseClient });

      const job = await repo.create({
        shop_id: 'shop-001',
        customer_id: 'cust-001',
        document_storage_key: 'uploads/doc.pdf',
        status: 'approved',
        settings: { paper_size: 'A4' }
      });

      // Claim job via RPC
      const claim = await repo.claimNextJob({
        shopId: 'shop-001',
        agentDeviceId: 'agent-dev-999',
        leaseDurationSeconds: 120
      });

      expect(claim).not.toBeNull();
      expect(claim?.job_id).toBe(job.id);
      expect(claim?.status).toBe('CLAIMED');
      expect(claim?.lease_token).toBeDefined();
      expect(claim?.attempt_id).toBeDefined();

      // Verify table was atomically updated
      const jobs = mockTables['print_jobs'] || [];
      const updatedInDb = jobs.find(j => j.id === job.id);
      expect(updatedInDb.status).toBe('claimed');
      expect(updatedInDb.claimed_by_agent_id).toBe('agent-dev-999');
    });

    it('updates status and verifies lease token, recording audit log', async () => {
      const repo = new SupabasePrintJobsRepository({ client: mockSupabaseClient });

      const job = await repo.create({
        shop_id: 'shop-001',
        customer_id: 'cust-001',
        document_storage_key: 'uploads/doc.pdf',
        status: 'approved'
      });

      const claim = await repo.claimNextJob({
        shopId: 'shop-001',
        agentDeviceId: 'agent-dev-999'
      });

      // Reject update with invalid lease token
      await expect(
        repo.updateStatus({
          jobId: job.id,
          status: 'printing',
          leaseToken: 'invalid-token'
        })
      ).rejects.toThrow(/Invalid lease token/);

      // Successfully update with valid lease token
      const updated = await repo.updateStatus({
        jobId: job.id,
        status: 'printing',
        leaseToken: claim!.lease_token,
        actorId: 'agent-dev-999',
        actorType: 'agent',
        reason: 'Printing started'
      });

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe('printing');

      // Verify audit event was logged
      const events = mockTables['job_events'] || [];
      expect(events.length).toBeGreaterThan(0);
      const event = events[0];
      expect(event.job_id).toBe(job.id);
      expect(event.to_status).toBe('printing');
    });

    it('returns queued jobs ordered with urgent tier before flexible tier', async () => {
      const repo = new SupabasePrintJobsRepository({ client: mockSupabaseClient });

      // Create flexible job enqueued earlier
      await repo.create({
        id: 'job-flex',
        shop_id: 'shop-001',
        customer_id: 'cust-1',
        document_storage_key: 'uploads/f.pdf',
        priority_tier: 'flexible',
        status: 'queued',
        enqueued_at: new Date(Date.now() - 5000).toISOString()
      });

      // Create urgent job enqueued later
      await repo.create({
        id: 'job-urg',
        shop_id: 'shop-001',
        customer_id: 'cust-2',
        document_storage_key: 'uploads/u.pdf',
        priority_tier: 'urgent',
        status: 'queued',
        enqueued_at: new Date().toISOString()
      });

      const queue = await repo.findQueueByShop('shop-001');
      expect(queue).toHaveLength(2);
      expect(queue[0]!.id).toBe('job-urg');
      expect(queue[0]!.queue_position).toBe(1);
      expect(queue[1]!.id).toBe('job-flex');
      expect(queue[1]!.queue_position).toBe(2);
    });
  });

  describe('SupabaseShopsRepository, SupabaseAgentsRepository, SupabasePricingRepository', () => {
    it('creates and finds shops in SupabaseShopsRepository', async () => {
      const repo = new SupabaseShopsRepository({ client: mockSupabaseClient });

      const shop = await repo.create({
        owner_id: 'owner-1',
        name: 'Campus Print Hub',
        address: '123 College Ave',
        geo_lat: 18.5204,
        geo_lng: 73.8567,
        pricing_config: {} as any,
        urgent_surcharge_config: {} as any
      });

      expect(shop.id).toBeDefined();
      expect(shop.name).toBe('Campus Print Hub');

      const found = await repo.findById(shop.id);
      expect(found?.name).toBe('Campus Print Hub');
    });

    it('registers and finds devices by token hash in SupabaseAgentsRepository', async () => {
      const repo = new SupabaseAgentsRepository({ client: mockSupabaseClient });

      const device = await repo.registerDevice({
        shop_id: 'shop-001',
        device_fingerprint: 'fp-12345',
        device_name: 'Counter EPSON L3150',
        auth_token_hash: 'hash-abc-123',
        paired_by: 'owner-1'
      });

      expect(device.id).toBeDefined();
      expect(device.device_name).toBe('Counter EPSON L3150');

      const byHash = await repo.findDeviceByTokenHash('hash-abc-123');
      expect(byHash?.id).toBe(device.id);

      const revoked = await repo.revokeDevice(device.id, 'Decommissioned');
      expect(revoked?.is_revoked).toBe(true);
    });

    it('records idempotent payment transactions in SupabasePricingRepository', async () => {
      const repo = new SupabasePricingRepository({ client: mockSupabaseClient });

      const result = await repo.recordPaymentEventIdempotent({
        payment_id: 'pay-001',
        job_id: 'job-001',
        amount_paise: 2500,
        payment_method: 'upi',
        status: 'success',
        idempotency_key: 'idem-key-123'
      });

      expect(result.success).toBe(true);
    });
  });

  describe('app.ts Supabase Wiring', () => {
    it('instantiates Mock repositories when Supabase is not configured (unit test runner mode)', () => {
      const app = buildApp({
        env: {
          NODE_ENV: 'test',
          HOST: '0.0.0.0',
          PORT: 4000,
          CORS_ORIGINS: ['http://localhost:3000'],
          SUPABASE_JWT_SECRET: 'test-secret-at-least-32-characters-long',
          RATE_LIMIT_MAX: 100,
          RATE_LIMIT_WINDOW_MS: 60000,
          LOG_LEVEL: 'silent'
        } as any
      });

      expect(app).toBeDefined();
    });

    it('instantiates Supabase repositories when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are configured', () => {
      const app = buildApp({
        env: {
          NODE_ENV: 'production',
          HOST: '0.0.0.0',
          PORT: 4000,
          CORS_ORIGINS: ['http://localhost:3000'],
          SUPABASE_URL: 'http://localhost:54321',
          SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-test-at-least-10-chars',
          SUPABASE_JWT_SECRET: 'test-secret-at-least-32-characters-long',
          RATE_LIMIT_MAX: 100,
          RATE_LIMIT_WINDOW_MS: 60000,
          LOG_LEVEL: 'silent'
        } as any
      });

      expect(app).toBeDefined();
    });
  });
});
