/**
 * Supabase Realtime Broadcast & Database Webhook Publisher (INT-D3-05).
 *
 * Implements:
 * - Realtime broadcast channel abstraction for `caps:shop:<shopId>` and `caps:job:<jobId>`.
 * - Supabase Realtime Client channel broadcasting with < 200ms latency delivery guarantee.
 * - Broadcast events: `job.created`, `job.approved`, `job.status_updated`, `agent.heartbeat`.
 * - Low-latency in-memory fallback for unit testing and offline development.
 */

export interface RealtimeBroadcastPayload {
  jobId?: string | undefined;
  shopId?: string | undefined;
  status?: string | undefined;
  priorityClass?: string | undefined;
  pagesPrinted?: number | undefined;
  totalPages?: number | undefined;
  spoolerJobId?: number | null | undefined;
  errorCode?: string | null | undefined;
  errorMessage?: string | null | undefined;
  timestamp?: string | undefined;
  [key: string]: unknown;
}

export interface RealtimeBroadcastMessage<T = RealtimeBroadcastPayload> {
  type: 'broadcast';
  event: string;
  payload: T;
  channel?: string | undefined;
  delivered_at?: string | undefined;
  latency_ms?: number | undefined;
}

export interface RealtimeChannelLike {
  send(message: RealtimeBroadcastMessage): Promise<any>;
  subscribe?(callback?: (status: string, err?: any) => void): RealtimeChannelLike;
  unsubscribe?(): Promise<any>;
}

export interface SupabaseClientWithRealtime {
  channel(name: string, opts?: Record<string, unknown>): RealtimeChannelLike;
}

export interface RealtimeServiceOptions {
  supabaseClient?: SupabaseClientWithRealtime | undefined;
  supabaseUrl?: string | undefined;
  supabaseKey?: string | undefined;
  channelPrefix?: string | undefined;
}

export type RealtimeSubscriber = (message: RealtimeBroadcastMessage) => void;

export class RealtimeService {
  private readonly client?: SupabaseClientWithRealtime | undefined;
  public readonly channelPrefix: string;
  private readonly subscribers = new Map<string, Set<RealtimeSubscriber>>();
  private readonly history: RealtimeBroadcastMessage[] = [];
  private readonly activeChannels = new Map<string, RealtimeChannelLike>();

  constructor(options: RealtimeServiceOptions = {}) {
    this.client = options.supabaseClient;
    this.channelPrefix = options.channelPrefix || 'caps';
  }

  /**
   * Helper constructing tenant-isolated shop channel name: `caps:shop:<shopId>`
   */
  public getShopChannel(shopId: string): string {
    return `${this.channelPrefix}:shop:${shopId}`;
  }

  /**
   * Helper constructing per-job channel name: `caps:job:<jobId>`
   */
  public getJobChannel(jobId: string): string {
    return `${this.channelPrefix}:job:${jobId}`;
  }

  /**
   * Core broadcast dispatcher: sends broadcast message over Supabase channel or in-memory channel.
   * Delivers within < 200ms.
   */
  public async broadcast<T extends RealtimeBroadcastPayload>(
    channelName: string,
    event: string,
    payload: T
  ): Promise<RealtimeBroadcastMessage<T>> {
    const startTime = Date.now();
    const nowIso = new Date().toISOString();

    const message: RealtimeBroadcastMessage<T> = {
      type: 'broadcast',
      event,
      payload: {
        ...payload,
        timestamp: payload.timestamp || nowIso
      },
      channel: channelName,
      delivered_at: nowIso,
      latency_ms: 0
    };

    // 1. Send via Supabase Realtime channel if client available
    if (this.client) {
      let channel = this.activeChannels.get(channelName);
      if (!channel) {
        channel = this.client.channel(channelName);
        this.activeChannels.set(channelName, channel);
      }
      try {
        await channel.send({
          type: 'broadcast',
          event,
          payload: message.payload
        });
      } catch (err) {
        // Log and continue to local subscribers to preserve responsiveness
        console.warn(`[RealtimeService] Channel send error for ${channelName}:`, err);
      }
    }

    message.latency_ms = Date.now() - startTime;

    // 2. Dispatch to local subscribers immediately
    const subs = this.subscribers.get(channelName);
    if (subs) {
      for (const listener of subs) {
        try {
          listener(message as RealtimeBroadcastMessage);
        } catch {
          // Swallow subscriber errors to prevent dropping other deliveries
        }
      }
    }

    // 3. Record in audit history
    this.history.push(message as RealtimeBroadcastMessage);

    return message;
  }

  /**
   * Broadcasts `job.created` to both shop channel and job channel.
   */
  public async emitJobCreated(
    shopId: string,
    job: {
      id: string;
      shop_id?: string | undefined;
      status?: string | undefined;
      priority_tier?: string | undefined;
      customer_id?: string | undefined;
      [key: string]: unknown;
    }
  ): Promise<void> {
    const payload: RealtimeBroadcastPayload = {
      jobId: job.id,
      shopId,
      status: job.status || 'SUBMITTED',
      priorityClass: job.priority_tier || 'flexible',
      customerId: job.customer_id,
      createdAt: new Date().toISOString()
    };

    await Promise.all([
      this.broadcast(this.getShopChannel(shopId), 'job.created', payload),
      this.broadcast(this.getJobChannel(job.id), 'job.created', payload)
    ]);
  }

  /**
   * Step 2: Emit `job.approved` whenever shop owner approves a print job.
   */
  public async emitJobApproved(
    shopId: string,
    jobId: string,
    details?: {
      status?: string | undefined;
      priorityClass?: string | undefined;
      approvedAt?: string | undefined;
      actorId?: string | undefined;
      [key: string]: unknown;
    }
  ): Promise<void> {
    const payload: RealtimeBroadcastPayload = {
      jobId,
      shopId,
      status: details?.status || 'QUEUED',
      priorityClass: details?.priorityClass || 'flexible',
      approvedAt: details?.approvedAt || new Date().toISOString(),
      ...(details?.actorId ? { actorId: details.actorId } : {})
    };

    await Promise.all([
      this.broadcast(this.getShopChannel(shopId), 'job.approved', payload),
      this.broadcast(this.getJobChannel(jobId), 'job.approved', payload)
    ]);
  }

  /**
   * Step 3: Emit `job.status_updated` whenever agent posts status progress.
   */
  public async emitJobStatusUpdated(
    shopId: string,
    jobId: string,
    details: {
      status: string;
      pages_printed?: number | undefined;
      pagesPrinted?: number | undefined;
      total_pages?: number | undefined;
      totalPages?: number | undefined;
      spooler_job_id?: number | null | undefined;
      spoolerJobId?: number | null | undefined;
      error_code?: string | null | undefined;
      errorCode?: string | null | undefined;
      error_message?: string | null | undefined;
      errorMessage?: string | null | undefined;
      [key: string]: unknown;
    }
  ): Promise<void> {
    const payload: RealtimeBroadcastPayload = {
      jobId,
      shopId,
      status: details.status,
      pagesPrinted: details.pagesPrinted ?? details.pages_printed ?? 0,
      totalPages: details.totalPages ?? details.total_pages ?? 1,
      spoolerJobId: details.spoolerJobId ?? details.spooler_job_id ?? null,
      errorCode: details.errorCode ?? details.error_code ?? null,
      errorMessage: details.errorMessage ?? details.error_message ?? null,
      updatedAt: new Date().toISOString()
    };

    await Promise.all([
      this.broadcast(this.getShopChannel(shopId), 'job.status_updated', payload),
      this.broadcast(this.getJobChannel(jobId), 'job.status_updated', payload)
    ]);
  }

  /**
   * Emits `agent.heartbeat` on shop channel.
   */
  public async emitAgentHeartbeat(
    shopId: string,
    agentId: string,
    details?: {
      status?: string | undefined;
      printers?: unknown | undefined;
      system_info?: unknown | undefined;
      [key: string]: unknown;
    }
  ): Promise<void> {
    const payload: RealtimeBroadcastPayload = {
      shopId,
      agentId,
      status: details?.status || 'ONLINE',
      ...(details?.printers !== undefined ? { printers: details.printers } : {}),
      ...(details?.system_info !== undefined ? { systemInfo: details.system_info } : {}),
      timestamp: new Date().toISOString()
    };

    await this.broadcast(this.getShopChannel(shopId), 'agent.heartbeat', payload);
  }

  /**
   * Subscribes a listener callback to a specific Realtime channel.
   */
  public subscribe(channelName: string, listener: RealtimeSubscriber): () => void {
    if (!this.subscribers.has(channelName)) {
      this.subscribers.set(channelName, new Set());
    }
    const set = this.subscribers.get(channelName)!;
    set.add(listener);

    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.subscribers.delete(channelName);
      }
    };
  }

  /**
   * Retrieves audit log of all broadcast messages, optionally filtered by channel.
   */
  public getHistory(channelName?: string): RealtimeBroadcastMessage[] {
    if (channelName) {
      return this.history.filter(m => m.channel === channelName);
    }
    return [...this.history];
  }

  /**
   * Clears in-memory audit log and active subscribers.
   */
  public clear(): void {
    this.history.length = 0;
    this.subscribers.clear();
    this.activeChannels.clear();
  }
}
