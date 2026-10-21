/**
 * Operator Recovery Service for CAPS Shop Owner Dashboard.
 * Handles:
 * 1. Safe operator resolution for ambiguous/unresolved print outcomes (requires_review)
 * 2. Mandatory physical inspection confirmation to block automatic uncontrolled re-prints
 * 3. Escalation controls: retry (approved for agent re-claim), cancel (with refund trigger), mark_completed
 * 4. Hardware incident detection & telemetry polling for jam/offline/out-of-paper conditions
 */

import { getSupabaseEnv, getSupabaseBrowserClient } from '../../lib/supabase';
import type {
  ResolveUnresolvedJobRequest,
  ResolveUnresolvedJobResponse,
  HardwareIncident,
  AgentDeviceStatus
} from './types';

export class OperatorRecoveryError extends Error {
  readonly code:
    | 'EVIDENCE_REQUIRED'
    | 'UNAUTHORIZED_CROSS_SHOP'
    | 'INVALID_RESOLUTION'
    | 'JOB_NOT_FOUND'
    | 'INVALID_STATUS'
    | 'NETWORK_ERROR';

  constructor(
    code:
      | 'EVIDENCE_REQUIRED'
      | 'UNAUTHORIZED_CROSS_SHOP'
      | 'INVALID_RESOLUTION'
      | 'JOB_NOT_FOUND'
      | 'INVALID_STATUS'
      | 'NETWORK_ERROR',
    message: string
  ) {
    super(message);
    this.name = 'OperatorRecoveryError';
    this.code = code;
  }
}

export interface OperatorRecoveryServiceConfig {
  customFetch?: typeof fetch | undefined;
  supabaseUrl?: string | undefined;
  supabaseAnonKey?: string | undefined;
}

export class OperatorRecoveryService {
  private readonly supabaseUrl: string;
  private readonly supabaseAnonKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(config?: OperatorRecoveryServiceConfig) {
    const env = getSupabaseEnv();
    this.supabaseUrl = (config?.supabaseUrl ?? env.supabaseUrl).replace(/\/$/, '');
    this.supabaseAnonKey = config?.supabaseAnonKey ?? env.supabaseAnonKey;
    this.fetchFn =
      config?.customFetch ??
      (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (undefined as unknown as typeof fetch));
  }

  /**
   * Resolves an ambiguous or stalled print job requiring operator intervention.
   * Invariant: Safe retry requires explicit human confirmation that physical paper was checked.
   * Unknown/ambiguous print spooler states MUST NOT auto-reprint.
   */
  async resolveUnresolvedJob(
    request: ResolveUnresolvedJobRequest,
    accessToken?: string
  ): Promise<ResolveUnresolvedJobResponse> {
    const { jobId, shopId, resolution, physicalEvidenceConfirmed, notes } = request;

    // 1. Enforce physical evidence inspection rule for retry or completion
    if ((resolution === 'retry' || resolution === 'mark_completed') && !physicalEvidenceConfirmed) {
      throw new OperatorRecoveryError(
        'EVIDENCE_REQUIRED',
        'Physical paper tray and output check is mandatory before confirming job retry or completion. Never auto-reprint without inspection.'
      );
    }

    if (!['retry', 'cancel', 'mark_completed'].includes(resolution)) {
      throw new OperatorRecoveryError(
        'INVALID_RESOLUTION',
        `Invalid resolution: ${resolution}. Must be retry, cancel, or mark_completed.`
      );
    }

    // 2. Authentication and shop ownership verification
    const client = getSupabaseBrowserClient();
    const session = await client.getSession();
    const effectiveToken = accessToken || session?.access_token;
    const effectiveUserId = session?.user?.id;

    if (!effectiveToken || !effectiveUserId) {
      throw new OperatorRecoveryError(
        'UNAUTHORIZED_CROSS_SHOP',
        'User session is invalid or unauthenticated.'
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.supabaseAnonKey,
      Authorization: `Bearer ${effectiveToken}`
    };

    // Verify shop ownership
    const shopUrl = `${this.supabaseUrl}/rest/v1/shops?id=eq.${shopId}&select=id,owner_id`;
    try {
      const shopRes = await this.fetchFn(shopUrl, { method: 'GET', headers });
      if (!shopRes.ok) {
        throw new OperatorRecoveryError(
          'UNAUTHORIZED_CROSS_SHOP',
          'Failed to verify shop ownership.'
        );
      }
      const shops = (await shopRes.json()) as Array<{ id: string; owner_id: string }>;
      const shop = shops[0];
      if (!shop || shop.owner_id !== effectiveUserId) {
        throw new OperatorRecoveryError(
          'UNAUTHORIZED_CROSS_SHOP',
          'Unauthorized: Current user does not own this shop.'
        );
      }
    } catch (err) {
      if (err instanceof OperatorRecoveryError) throw err;
      throw new OperatorRecoveryError(
        'UNAUTHORIZED_CROSS_SHOP',
        'Unauthorized: Current user does not own this shop.'
      );
    }

    // Verify job belongs to shop and is in requires_review or failed status
    const jobUrl = `${this.supabaseUrl}/rest/v1/print_jobs?id=eq.${jobId}&select=id,shop_id,status`;
    let job: { id: string; shop_id: string; status: string } | null = null;
    try {
      const jobRes = await this.fetchFn(jobUrl, { method: 'GET', headers });
      if (!jobRes.ok) {
        throw new OperatorRecoveryError('JOB_NOT_FOUND', `Print job ${jobId} not found.`);
      }
      const jobs = (await jobRes.json()) as Array<{ id: string; shop_id: string; status: string }>;
      job = jobs[0] || null;
      if (!job) {
        throw new OperatorRecoveryError('JOB_NOT_FOUND', `Print job ${jobId} not found.`);
      }
    } catch (err) {
      if (err instanceof OperatorRecoveryError) throw err;
      throw new OperatorRecoveryError('JOB_NOT_FOUND', `Print job ${jobId} not found.`);
    }

    if (job.shop_id !== shopId) {
      throw new OperatorRecoveryError(
        'UNAUTHORIZED_CROSS_SHOP',
        `Print job ${jobId} belongs to another shop.`
      );
    }

    if (job.status !== 'requires_review' && job.status !== 'failed') {
      throw new OperatorRecoveryError(
        'INVALID_STATUS',
        `Job ${jobId} is in status '${job.status}'. Only requires_review or failed jobs can be resolved by operator.`
      );
    }

    // 3. Dispatch atomic resolution RPC (resolve_unresolved_job) or fallback PATCH
    const now = new Date().toISOString();
    let targetStatus = 'approved';
    if (resolution === 'cancel') targetStatus = 'cancelled';
    if (resolution === 'mark_completed') targetStatus = 'completed';

    let rpcDone = false;
    try {
      const rpcUrl = `${this.supabaseUrl}/rest/v1/rpc/resolve_unresolved_job`;
      const rpcRes = await this.fetchFn(rpcUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_job_id: jobId,
          p_resolution: resolution,
          p_actor_id: effectiveUserId,
          p_notes: notes || `Resolved via Operator Recovery UI (${resolution})`
        })
      });

      if (rpcRes.ok) {
        rpcDone = true;
      }
    } catch {
      rpcDone = false;
    }

    if (!rpcDone) {
      const updateUrl = `${this.supabaseUrl}/rest/v1/print_jobs?id=eq.${jobId}&shop_id=eq.${shopId}`;
      const updateRes = await this.fetchFn(updateUrl, {
        method: 'PATCH',
        headers: {
          ...headers,
          Prefer: 'return=representation'
        },
        body: JSON.stringify({
          status: targetStatus,
          updated_at: now
        })
      });

      if (!updateRes.ok) {
        throw new OperatorRecoveryError(
          'NETWORK_ERROR',
          `Failed to update job status: HTTP ${updateRes.status}`
        );
      }
    }

    return {
      jobId,
      previousStatus: job.status,
      newStatus: targetStatus,
      resolvedAt: now,
      message: `Job ${jobId} successfully updated to '${targetStatus}'.`
    };
  }

  /**
   * Fetches active hardware incidents (offline printers, paper jams, out-of-paper)
   * detected from connected agents and physical printers.
   */
  async fetchActiveIncidents(
    shopId: string,
    accessToken?: string
  ): Promise<HardwareIncident[]> {
    if (!shopId) return [];

    const client = getSupabaseBrowserClient();
    const session = await client.getSession();
    const effectiveToken = accessToken || session?.access_token;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.supabaseAnonKey
    };
    if (effectiveToken) {
      headers['Authorization'] = `Bearer ${effectiveToken}`;
    }

    try {
      // Query printers in non-online state or error state
      const url = `${this.supabaseUrl}/rest/v1/printers?shop_id=eq.${shopId}&status=neq.online&select=id,name,status,capabilities`;
      const res = await this.fetchFn(url, { method: 'GET', headers });
      if (!res.ok) {
        return [];
      }

      interface RemotePrinter {
        id: string;
        name: string;
        status: string;
        capabilities?: { error_code?: string; error_message?: string } | undefined;
      }

      const printers = (await res.json()) as RemotePrinter[];
      return printers.map(p => {
        let incidentType: HardwareIncident['incidentType'] = 'offline';
        let severity: HardwareIncident['severity'] = 'warning';
        let message = `Printer ${p.name} is currently offline.`;

        const errorCode = p.capabilities?.error_code?.toLowerCase() || '';
        if (errorCode.includes('jam')) {
          incidentType = 'jam';
          severity = 'critical';
          message = `Paper jam detected in ${p.name}. Clear paper path and press Continue.`;
        } else if (errorCode.includes('paper')) {
          incidentType = 'out_of_paper';
          severity = 'warning';
          message = `Tray 1 is out of paper on ${p.name}. Load A4 stock to resume printing.`;
        } else if (p.status === 'error') {
          incidentType = 'jam';
          severity = 'critical';
          message = `Hardware fault detected in ${p.name}. Inspect printer mechanism.`;
        }

        return {
          id: `inc-${p.id}`,
          shopId,
          printerId: p.id,
          printerName: p.name,
          incidentType,
          severity,
          message,
          affectedJobsCount: 1,
          detectedAt: new Date().toISOString()
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Checks agent connectivity and telemetry heartbeats.
   */
  async fetchAgentDeviceStatus(
    shopId: string,
    accessToken?: string
  ): Promise<AgentDeviceStatus | null> {
    if (!shopId) return null;

    const client = getSupabaseBrowserClient();
    const session = await client.getSession();
    const effectiveToken = accessToken || session?.access_token;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.supabaseAnonKey
    };
    if (effectiveToken) {
      headers['Authorization'] = `Bearer ${effectiveToken}`;
    }

    try {
      const url = `${this.supabaseUrl}/rest/v1/agent_devices?shop_id=eq.${shopId}&select=id,device_name,agent_version,is_revoked,last_heartbeat_at&limit=1`;
      const res = await this.fetchFn(url, { method: 'GET', headers });
      if (!res.ok) return null;

      interface RemoteAgent {
        id: string;
        device_name: string;
        agent_version: string;
        is_revoked: boolean;
        last_heartbeat_at: string;
      }

      const agents = (await res.json()) as RemoteAgent[];
      const agent = agents[0];
      if (!agent) return null;

      const lastHeartbeat = new Date(agent.last_heartbeat_at).getTime();
      const isOnline = Date.now() - lastHeartbeat < 1000 * 90; // Heartbeat within last 90 seconds

      return {
        id: agent.id,
        shopId,
        deviceName: agent.device_name,
        agentVersion: agent.agent_version,
        isOnline,
        lastHeartbeatAt: agent.last_heartbeat_at,
        isRevoked: agent.is_revoked
      };
    } catch {
      return null;
    }
  }
}

export const defaultRecoveryService = new OperatorRecoveryService();
