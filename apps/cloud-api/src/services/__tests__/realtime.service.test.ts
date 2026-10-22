import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import {
  RealtimeService,
  RealtimeBroadcastMessage,
  SupabaseClientWithRealtime
} from '../realtime.service.js';
import { jobsRoutes } from '../../routes/jobs.routes.js';
import { MockPrintJobsRepository } from '../../modules/print-jobs/print-jobs.repository.js';
import { MockShopsRepository } from '../../modules/shops/shops.repository.js';

describe('RealtimeService (Task INT-D3-05)', () => {
  let mockChannels: Map<string, any>;
  let mockSupabaseClient: SupabaseClientWithRealtime;
  let realtimeService: RealtimeService;

  beforeEach(() => {
    mockChannels = new Map();

    mockSupabaseClient = {
      channel: vi.fn((name: string) => {
        if (!mockChannels.has(name)) {
          mockChannels.set(name, {
            name,
            send: vi.fn(async (msg: any) => ({ status: 'ok', msg })),
            subscribe: vi.fn(),
            unsubscribe: vi.fn()
          });
        }
        return mockChannels.get(name);
      })
    };

    realtimeService = new RealtimeService({
      supabaseClient: mockSupabaseClient,
      channelPrefix: 'caps'
    });
  });

  describe('Channel Naming & Addressing', () => {
    it('constructs tenant-isolated shop channel caps:shop:<shopId>', () => {
      const shopId = '00000000-0000-0000-0000-000000000001';
      expect(realtimeService.getShopChannel(shopId)).toBe(`caps:shop:${shopId}`);
    });

    it('constructs per-job channel caps:job:<jobId>', () => {
      const jobId = '11111111-1111-1111-1111-111111111111';
      expect(realtimeService.getJobChannel(jobId)).toBe(`caps:job:${jobId}`);
    });
  });

  describe('Supabase Client Channel Broadcast API Wiring (Step 1)', () => {
    it('wires supabase.channel("caps:shop:<shopId>").send for job.approved broadcast', async () => {
      const shopId = 'shop-alpha-123';
      const jobId = 'job-xyz-456';

      await realtimeService.emitJobApproved(shopId, jobId, {
        status: 'QUEUED',
        priorityClass: 'urgent'
      });

      // Verify channel was obtained via supabase.channel(`caps:shop:${shopId}`)
      expect(mockSupabaseClient.channel).toHaveBeenCalledWith(`caps:shop:${shopId}`);
      expect(mockSupabaseClient.channel).toHaveBeenCalledWith(`caps:job:${jobId}`);

      const shopChannel = mockChannels.get(`caps:shop:${shopId}`);
      expect(shopChannel).toBeDefined();
      expect(shopChannel.send).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'job.approved',
        payload: expect.objectContaining({
          jobId,
          shopId,
          status: 'QUEUED',
          priorityClass: 'urgent'
        })
      });
    });

    it('delivers messages to channel subscribers in < 200 ms (Acceptance Criteria)', async () => {
      const shopId = 'shop-latency-test';
      const channel = realtimeService.getShopChannel(shopId);

      let receivedMessage: RealtimeBroadcastMessage | null = null;
      let deliveryDurationMs = 0;

      const unsubscribe = realtimeService.subscribe(channel, msg => {
        receivedMessage = msg;
      });

      const start = performance.now();
      await realtimeService.emitJobApproved(shopId, 'job-latency-1', {
        status: 'QUEUED',
        priorityClass: 'flexible'
      });
      deliveryDurationMs = performance.now() - start;

      unsubscribe();

      expect(receivedMessage).not.toBeNull();
      expect((receivedMessage as any).event).toBe('job.approved');
      expect((receivedMessage as any).payload.jobId).toBe('job-latency-1');

      // Acceptance Criteria: Delivered within < 200 ms
      expect(deliveryDurationMs).toBeLessThan(200);
    });
  });

  describe('Broadcast Events', () => {
    it('emits job.created on shop and job channels when a job is created', async () => {
      const shopId = 'shop-create-test';
      const job = {
        id: 'job-new-1',
        shop_id: shopId,
        status: 'SUBMITTED',
        priority_tier: 'urgent',
        customer_id: 'cust-101'
      };

      await realtimeService.emitJobCreated(shopId, job);

      const shopChannel = mockChannels.get(`caps:shop:${shopId}`);
      expect(shopChannel.send).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'job.created',
        payload: expect.objectContaining({
          jobId: 'job-new-1',
          shopId,
          status: 'SUBMITTED',
          priorityClass: 'urgent'
        })
      });

      const jobChannel = mockChannels.get('caps:job:job-new-1');
      expect(jobChannel.send).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'job.created',
        payload: expect.objectContaining({
          jobId: 'job-new-1',
          shopId
        })
      });
    });

    it('emits job.status_updated on progress updates', async () => {
      const shopId = 'shop-status-test';
      const jobId = 'job-progress-1';

      await realtimeService.emitJobStatusUpdated(shopId, jobId, {
        status: 'PRINTING',
        pages_printed: 3,
        total_pages: 10,
        spooler_job_id: 1042
      });

      const shopChannel = mockChannels.get(`caps:shop:${shopId}`);
      expect(shopChannel.send).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'job.status_updated',
        payload: expect.objectContaining({
          jobId,
          shopId,
          status: 'PRINTING',
          pagesPrinted: 3,
          totalPages: 10,
          spoolerJobId: 1042
        })
      });
    });

    it('emits agent.heartbeat on shop channel', async () => {
      const shopId = 'shop-heartbeat-test';
      const agentId = 'agent-dev-001';

      await realtimeService.emitAgentHeartbeat(shopId, agentId, {
        status: 'ONLINE',
        printers: [{ id: 'p1', name: 'HP LaserJet', status: 'IDLE' }]
      });

      const shopChannel = mockChannels.get(`caps:shop:${shopId}`);
      expect(shopChannel.send).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'agent.heartbeat',
        payload: expect.objectContaining({
          shopId,
          agentId,
          status: 'ONLINE'
        })
      });
    });
  });

  describe('In-Memory Fallback & History Tracking', () => {
    it('operates fully in-memory with subscriber delivery when Supabase client is omitted', async () => {
      const inMemoryService = new RealtimeService();
      const shopId = 'shop-in-mem';
      const channel = inMemoryService.getShopChannel(shopId);

      const received: RealtimeBroadcastMessage[] = [];
      const unsub = inMemoryService.subscribe(channel, msg => {
        received.push(msg);
      });

      await inMemoryService.emitJobApproved(shopId, 'job-mem-1', {
        status: 'QUEUED',
        priorityClass: 'flexible'
      });

      expect(received.length).toBe(1);
      expect(received[0]?.event).toBe('job.approved');
      expect(inMemoryService.getHistory(channel).length).toBe(1);

      unsub();
      await inMemoryService.emitJobApproved(shopId, 'job-mem-2');
      // No more deliveries to unsubscribed listener
      expect(received.length).toBe(1);
      expect(inMemoryService.getHistory(channel).length).toBe(2);
    });
  });
});

describe('Jobs & Realtime Routes Integration (INT-D3-05)', () => {
  let app: FastifyInstance;
  let realtimeService: RealtimeService;
  let jobsRepo: MockPrintJobsRepository;
  let shopsRepo: MockShopsRepository;

  const SHOP_ID = '00000000-0000-0000-0000-000000000001';
  const OWNER_ID = 'owner-suresh-001';
  let existingJobId: string;

  beforeEach(async () => {
    realtimeService = new RealtimeService({ channelPrefix: 'caps' });
    jobsRepo = new MockPrintJobsRepository();
    shopsRepo = new MockShopsRepository();

    // Seed shop
    await shopsRepo.create({
      id: SHOP_ID,
      name: 'QuickPrint Alpha',
      owner_id: OWNER_ID,
      status: 'open',
      pricing_config: { base_fee_paise: 0, per_page_bw_paise: 200, per_page_color_paise: 500 }
    } as any);

    // Seed initial job in pending_payment / queued
    const job = await jobsRepo.create({
      shop_id: SHOP_ID,
      customer_id: 'cust-rahul-001',
      document_storage_key: 'uploads/cust-rahul-001/doc.pdf',
      settings: { copies: 2, color_mode: 'bw' },
      priority_tier: 'flexible',
      price_total_paise: 1600,
      price_breakdown: {},
      status: 'queued'
    });
    existingJobId = job.id;

    app = Fastify();

    // Authenticate mock matching cloud-api
    app.decorate('authenticate', async (request: any) => {
      const auth = request.headers['authorization'];
      if (!auth) return;

      const token = auth.replace(/^Bearer\s+/, '');
      if (token === 'owner-token') {
        request.user = { id: OWNER_ID, role: 'shop_owner', email: 'suresh@shop.test' };
      } else if (token.startsWith('caps_agent_sec_')) {
        request.agent = { device_id: 'agent-dev-1', shop_id: SHOP_ID, role: 'PRINT_AGENT' };
        request.user = { id: 'agent-dev-1', role: 'agent' };
      } else {
        request.user = { id: 'user-001', role: 'customer' };
      }
    });

    await app.register(jobsRoutes, {
      realtimeService,
      jobsRepo,
      shopsRepo
    });

    await app.ready();
  });

  describe('Step 2: POST /api/v1/shops/:shopId/jobs/:jobId/approve emits job.approved', () => {
    it('transitions job to QUEUED and immediately broadcasts job.approved on caps:shop:<shopId>', async () => {
      const broadcastReceived = new Promise<RealtimeBroadcastMessage>(resolve => {
        realtimeService.subscribe(`caps:shop:${SHOP_ID}`, msg => {
          if (msg.event === 'job.approved') {
            resolve(msg);
          }
        });
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${SHOP_ID}/jobs/${existingJobId}/approve`,
        headers: {
          authorization: 'Bearer owner-token'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.status).toBe('QUEUED');

      // Wait for broadcast delivery
      const msg = await broadcastReceived;
      expect(msg.type).toBe('broadcast');
      expect(msg.event).toBe('job.approved');
      expect(msg.payload.jobId).toBe(existingJobId);
      expect(msg.payload.shopId).toBe(SHOP_ID);
      expect(msg.payload.status).toBe('QUEUED');
      expect(msg.payload.priorityClass).toBe('flexible');
    });

    it('resolves alias route /jobs/:id/approve identically', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/jobs/${existingJobId}/approve`,
        headers: {
          authorization: 'Bearer owner-token'
        }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('QUEUED');
    });
  });

  describe('Step 3: POST /api/v1/agent/jobs/status emits job.status_updated', () => {
    it('agent posts PRINTING progress and emits job.status_updated to caps:job:<jobId> and caps:shop:<shopId>', async () => {
      const shopBroadcast = new Promise<RealtimeBroadcastMessage>(resolve => {
        realtimeService.subscribe(`caps:shop:${SHOP_ID}`, msg => {
          if (msg.event === 'job.status_updated') resolve(msg);
        });
      });

      const jobBroadcast = new Promise<RealtimeBroadcastMessage>(resolve => {
        realtimeService.subscribe(`caps:job:${existingJobId}`, msg => {
          if (msg.event === 'job.status_updated') resolve(msg);
        });
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/jobs/status',
        headers: {
          authorization: 'Bearer caps_agent_sec_testtoken'
        },
        payload: {
          job_id: existingJobId,
          status: 'PRINTING',
          pages_printed: 2,
          total_pages: 4,
          spooler_job_id: 1042
        }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('PRINTING');

      const [shopMsg, jobMsg] = await Promise.all([shopBroadcast, jobBroadcast]);

      expect(shopMsg.payload.status).toBe('PRINTING');
      expect(shopMsg.payload.pagesPrinted).toBe(2);
      expect(shopMsg.payload.totalPages).toBe(4);
      expect(shopMsg.payload.spoolerJobId).toBe(1042);

      expect(jobMsg.payload.jobId).toBe(existingJobId);
      expect(jobMsg.payload.status).toBe('PRINTING');
    });
  });

  describe('Database Webhooks: POST /api/v1/jobs/webhook', () => {
    it('broadcasts job.created on database INSERT mutation webhook', async () => {
      const received = new Promise<RealtimeBroadcastMessage>(resolve => {
        realtimeService.subscribe(`caps:shop:${SHOP_ID}`, msg => {
          if (msg.event === 'job.created') resolve(msg);
        });
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/jobs/webhook',
        payload: {
          type: 'INSERT',
          table: 'print_jobs',
          record: {
            id: 'webhook-job-1',
            shop_id: SHOP_ID,
            status: 'submitted',
            priority_tier: 'urgent'
          }
        }
      });

      expect(res.statusCode).toBe(200);
      const msg = await received;
      expect(msg.event).toBe('job.created');
      expect(msg.payload.jobId).toBe('webhook-job-1');
      expect(msg.payload.priorityClass).toBe('urgent');
    });

    it('broadcasts job.approved on database UPDATE mutation to QUEUED', async () => {
      const received = new Promise<RealtimeBroadcastMessage>(resolve => {
        realtimeService.subscribe(`caps:shop:${SHOP_ID}`, msg => {
          if (msg.event === 'job.approved') resolve(msg);
        });
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/jobs/webhook',
        payload: {
          type: 'UPDATE',
          table: 'print_jobs',
          record: {
            id: 'webhook-job-2',
            shop_id: SHOP_ID,
            status: 'QUEUED',
            priority_tier: 'flexible'
          },
          old_record: {
            id: 'webhook-job-2',
            status: 'SUBMITTED'
          }
        }
      });

      expect(res.statusCode).toBe(200);
      const msg = await received;
      expect(msg.event).toBe('job.approved');
      expect(msg.payload.jobId).toBe('webhook-job-2');
      expect(msg.payload.status).toBe('QUEUED');
    });
  });
});
