/**
 * Realtime Signals and Missed-Event Reconciliation Service for CAPS.
 *
 * Implements:
 * 1. Tenant-isolated queue signals and agent wake broadcasts.
 * 2. Strict architectural safeguard: Realtime messages are wake-up signals only,
 *    NEVER ownership claims. Claiming requires authenticated atomic lease acquisition.
 * 3. Missed-event reconciliation & agent resync after network disconnect / restart.
 * 4. Active in-flight lease state recovery to prevent duplicate attempts or dropped jobs.
 * 5. Refreshed dynamic queue positions and ETA broadcasts for owner & customer channels.
 */

import { ApiError, AuthError, NotFoundError, ValidationError } from '../../plugins/error-handler.js';
import type { IPrintJobsRepository } from '../print-jobs/print-jobs.repository.js';
import type { IShopsRepository } from '../shops/shops.repository.js';
import type { IAgentsRepository } from '../agents/agents.repository.js';
import type { IJobAttemptsRepository } from '../agents/attempts.repository.js';
import type { IPrintersRepository } from '../printers/printers.repository.js';
import type { PrintJobRecord, JobStatus } from '../print-jobs/print-jobs.types.js';
import type {
  QueueSignal,
  CreateQueueSignalInput,
  MissedEventReconcileRequest,
  MissedEventReconcileResponse,
  ActiveLeaseSummary
} from './realtime-signals.types.js';

export class RealtimeSignalError extends ApiError {
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(statusCode, code, message, details);
    this.name = 'RealtimeSignalError';
  }
}

export interface IRealtimeBroadcaster {
  publish(signal: CreateQueueSignalInput): Promise<QueueSignal>;
  getMissedEvents(shopId: string, afterId?: number, limit?: number): Promise<QueueSignal[]>;
  getLatestEventId(shopId: string): number;
  subscribe(channel: string, callback: (signal: QueueSignal) => void): () => void;
  clear(): void;
}

/**
 * In-memory high-throughput broadcaster and append-only event stream
 * with tenant filtering and cursor pagination for local execution and testing.
 */
export class InMemoryRealtimeBroadcaster implements IRealtimeBroadcaster {
  private currentId = 0;
  private readonly events: QueueSignal[] = [];
  private readonly subscribers = new Map<string, Set<(signal: QueueSignal) => void>>();

  async publish(input: CreateQueueSignalInput): Promise<QueueSignal> {
    this.currentId += 1;
    const signal: QueueSignal = {
      id: this.currentId,
      shop_id: input.shop_id,
      channel: input.channel,
      event_type: input.event_type,
      job_id: input.job_id,
      customer_id: input.customer_id,
      payload: input.payload,
      created_at: new Date().toISOString()
    };

    this.events.push(signal);

    // Notify channel subscribers
    const channelSubs = this.subscribers.get(input.channel);
    if (channelSubs) {
      for (const cb of channelSubs) {
        try {
          cb(signal);
        } catch {
          // Ignore subscriber errors to prevent event dropping
        }
      }
    }

    return signal;
  }

  async getMissedEvents(shopId: string, afterId: number = 0, limit: number = 100): Promise<QueueSignal[]> {
    return this.events
      .filter(e => e.shop_id === shopId && e.id > afterId)
      .slice(0, Math.min(limit, 500));
  }

  getLatestEventId(shopId: string): number {
    const shopEvents = this.events.filter(e => e.shop_id === shopId);
    if (shopEvents.length === 0) return 0;
    const last = shopEvents[shopEvents.length - 1];
    return last ? last.id : 0;
  }

  subscribe(channel: string, callback: (signal: QueueSignal) => void): () => void {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
    const set = this.subscribers.get(channel)!;
    set.add(callback);

    return () => {
      set.delete(callback);
      if (set.size === 0) {
        this.subscribers.delete(channel);
      }
    };
  }

  clear(): void {
    this.events.length = 0;
    this.subscribers.clear();
    this.currentId = 0;
  }
}

export class RealtimeSignalsService {
  constructor(
    private readonly broadcaster: IRealtimeBroadcaster,
    private readonly printJobsRepo: IPrintJobsRepository,
    private readonly shopsRepo: IShopsRepository,
    private readonly agentsRepo: IAgentsRepository,
    private readonly attemptsRepo: IJobAttemptsRepository,
    _printersRepo?: IPrintersRepository
  ) {}

  /**
   * Emits an AGENT_WAKE signal to notify agent devices enrolled in shop that work is eligible.
   * Explicitly sets requires_claim: true to enforce that realtime signals are NOT claims.
   */
  async emitAgentWake(shopId: string, job: PrintJobRecord): Promise<QueueSignal> {
    const channel = `shop:${shopId}:agent`;
    const now = new Date().toISOString();

    return this.broadcaster.publish({
      shop_id: shopId,
      channel,
      event_type: 'AGENT_WAKE',
      job_id: job.id,
      customer_id: job.customer_id,
      payload: {
        signal: 'AGENT_WAKE',
        shop_id: shopId,
        job_id: job.id,
        printer_id: job.printer_id,
        priority_tier: job.priority_tier,
        requires_claim: true,
        queued_at: job.enqueued_at ?? job.created_at,
        wake_timestamp: now
      }
    });
  }

  /**
   * Emits a tenant-filtered JOB_STATUS_CHANGED signal on shop and customer channels.
   */
  async emitJobStatusChanged(
    shopId: string,
    job: PrintJobRecord,
    fromStatus?: JobStatus
  ): Promise<QueueSignal> {
    const now = new Date().toISOString();

    // 1. Publish to shop-wide queue channel (for owner dashboard telemetry)
    const ownerSignal = await this.broadcaster.publish({
      shop_id: shopId,
      channel: `shop:${shopId}:queue`,
      event_type: 'JOB_STATUS_CHANGED',
      job_id: job.id,
      customer_id: job.customer_id,
      payload: {
        signal: 'JOB_STATUS_CHANGED',
        shop_id: shopId,
        job_id: job.id,
        customer_id: job.customer_id,
        from_status: fromStatus,
        to_status: job.status,
        queue_position: job.queue_position,
        updated_at: now
      }
    });

    // 2. Publish to customer-specific channel with customer-redacted view
    if (job.customer_id) {
      await this.broadcaster.publish({
        shop_id: shopId,
        channel: `customer:${job.customer_id}`,
        event_type: 'JOB_STATUS_CHANGED',
        job_id: job.id,
        customer_id: job.customer_id,
        payload: {
          signal: 'JOB_STATUS_CHANGED',
          shop_id: shopId,
          job_id: job.id,
          to_status: job.status,
          queue_position: job.queue_position,
          updated_at: now
        }
      });
    }

    return ownerSignal;
  }

  /**
   * Emits a QUEUE_REORDERED signal indicating positions and projected wait times have refreshed.
   */
  async emitQueueReordered(
    shopId: string,
    summary: {
      total_queued: number;
      urgent_count: number;
      flexible_count: number;
      total_estimated_wait_seconds: number;
      active_printers_count: number;
    }
  ): Promise<QueueSignal> {
    return this.broadcaster.publish({
      shop_id: shopId,
      channel: `shop:${shopId}:queue`,
      event_type: 'QUEUE_REORDERED',
      payload: {
        signal: 'QUEUE_REORDERED',
        shop_id: shopId,
        total_queued: summary.total_queued,
        urgent_count: summary.urgent_count,
        flexible_count: summary.flexible_count,
        total_estimated_wait_seconds: summary.total_estimated_wait_seconds,
        active_printers_count: summary.active_printers_count,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Reconciles missed events and in-flight lease state when an agent reconnects.
   * Guarantees:
   * 1. No lost job despite dropped connection or missed wake events.
   * 2. In-flight active leases are recovered without creating duplicate attempts.
   * 3. Revoked devices are denied immediately (403 REVOKED_DEVICE).
   * 4. Delta event stream returned since last_event_id.
   */
  async reconcileAgent(
    shopId: string,
    request: MissedEventReconcileRequest,
    nowMs: number = Date.now()
  ): Promise<MissedEventReconcileResponse> {
    if (!request.device_id) {
      throw new ValidationError('Missing required parameter "device_id" in reconciliation request.');
    }

    // 1. Verify shop exists
    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new NotFoundError(`Shop '${shopId}' not found.`);
    }

    // 2. Verify agent device exists and belongs to shop
    const device = await this.agentsRepo.findDeviceById(request.device_id);
    if (!device) {
      throw new NotFoundError(`Agent device '${request.device_id}' not found.`);
    }

    if (device.shop_id !== shopId) {
      throw new AuthError(
        403,
        'FORBIDDEN',
        `Agent device '${request.device_id}' does not belong to shop '${shopId}'.`
      );
    }

    // 3. Strict security check: Revoked devices must be rejected
    if (device.is_revoked) {
      throw new RealtimeSignalError(
        403,
        'REVOKED_DEVICE',
        `Agent device '${request.device_id}' has been revoked by the shop owner.`
      );
    }

    // 4. Update device last_seen timestamp via heartbeat record
    await this.agentsRepo.recordHeartbeat({
      device_id: device.id,
      agent_version: device.agent_version ?? '0.1.0',
      metrics: { reconnect: true }
    });

    // 5. Fetch missed events since last_event_id
    const missedEvents = await this.broadcaster.getMissedEvents(
      shopId,
      request.last_event_id ?? 0,
      100
    );
    const latestEventId = this.broadcaster.getLatestEventId(shopId);

    // 6. Check for active in-flight lease held by this device
    let activeLease: ActiveLeaseSummary | null = null;

    if (request.in_flight_attempt_id) {
      const attempt = await this.attemptsRepo.findById(request.in_flight_attempt_id);
      if (attempt && attempt.agent_device_id === device.id) {
        const isExpired = new Date(attempt.lease_expires_at).getTime() < nowMs;
        const isActiveStatus = ['leased', 'downloading', 'rendering', 'printing'].includes(
          attempt.status
        );

        if (isActiveStatus && !isExpired) {
          activeLease = {
            job_id: attempt.job_id,
            attempt_id: attempt.id,
            lease_token: attempt.lease_token,
            lease_expires_at: attempt.lease_expires_at,
            status: attempt.status,
            printer_id: attempt.printer_id,
            is_expired: false
          };
        }
      }
    } else {
      // Find any active unexpired lease for this device
      const candidateAttempts = await this.attemptsRepo.findActiveByDeviceId(device.id);
      const deviceActive = candidateAttempts.find(
        a => new Date(a.lease_expires_at).getTime() > nowMs
      );

      if (deviceActive) {
        activeLease = {
          job_id: deviceActive.job_id,
          attempt_id: deviceActive.id,
          lease_token: deviceActive.lease_token,
          lease_expires_at: deviceActive.lease_expires_at,
          status: deviceActive.status,
          printer_id: deviceActive.printer_id,
          is_expired: false
        };
      }
    }

    // 7. Check if there are claimable approved jobs in the queue
    const allJobs = await this.printJobsRepo.findAll({ shop_id: shopId, limit: 500 });
    const claimableJobs = allJobs.jobs.filter(j => j.status === 'approved');

    return {
      shop_id: shopId,
      device_id: device.id,
      latest_event_id: latestEventId,
      missed_events: missedEvents,
      active_lease: activeLease,
      has_claimable_jobs: claimableJobs.length > 0,
      claimable_jobs_count: claimableJobs.length,
      server_time: new Date(nowMs).toISOString()
    };
  }

  /**
   * Retrieves missed events for polling / auditing.
   */
  async getMissedEvents(
    shopId: string,
    afterId: number = 0,
    limit: number = 100
  ): Promise<{ events: QueueSignal[]; latest_event_id: number }> {
    const events = await this.broadcaster.getMissedEvents(shopId, afterId, limit);
    const latest_event_id = this.broadcaster.getLatestEventId(shopId);
    return { events, latest_event_id };
  }
}
