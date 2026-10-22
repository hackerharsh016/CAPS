/**
 * Owner Dashboard Printer API & Telemetry Service (INT-D2-04).
 * Coordinates with backend endpoints:
 * - GET /api/v1/shops/:shopId/printers
 * - POST /api/v1/shops/:shopId/jobs/:jobId/retry
 * - Realtime broadcast event: `agent.status` on channel `caps:shop:<shopId>`
 */

import { getSupabaseBrowserClient } from '../../lib/supabase';

export type HardwareErrorState =
  'NONE' | 'OFFLINE' | 'PAPER_OUT' | 'JAMMED' | 'DOOR_OPEN' | 'LOW_TONER' | 'ERROR';

export interface PrinterTelemetry {
  id: string;
  shop_id: string;
  name: string;
  status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'ERROR';
  is_online: boolean;
  toner_level?: number | undefined; // 0 - 100 percentage
  error_state?: HardwareErrorState | undefined;
  error_message?: string | undefined;
  capabilities?:
    | {
        color_modes?: string[] | undefined;
        paper_sizes?: string[] | undefined;
        duplex_supported?: boolean | undefined;
      }
    | undefined;
  last_heartbeat_at?: string | undefined;
}

export interface RetryJobResponse {
  success: boolean;
  jobId: string;
  status: 'QUEUED';
  message?: string | undefined;
}

export interface PrinterServiceOptions {
  baseUrl?: string | undefined;
  authToken?: string | undefined;
  supabaseClient?: any | undefined;
}

export class PrinterApiService {
  private readonly baseUrl: string;
  private readonly authToken?: string | undefined;
  private readonly supabaseClient?: any | undefined;

  constructor(options: PrinterServiceOptions = {}) {
    this.baseUrl =
      options.baseUrl ||
      (typeof process !== 'undefined'
        ? process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000'
        : 'http://localhost:4000');
    this.authToken = options.authToken;
    this.supabaseClient = options.supabaseClient;
  }

  /**
   * Fetches the live printer list and telemetry for a given shop.
   * GET /api/v1/shops/:shopId/printers
   */
  public async getPrinters(
    shopId: string,
    options?: { signal?: AbortSignal | undefined }
  ): Promise<PrinterTelemetry[]> {
    if (!shopId) return [];

    const apiUrl = this.baseUrl.replace(/\/+$/, '');
    const endpoint = `${apiUrl}/api/v1/shops/${shopId}/printers`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const init: RequestInit = {
      method: 'GET',
      headers
    };
    if (options?.signal) {
      init.signal = options.signal;
    }

    const response = await fetch(endpoint, init);
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Failed to fetch shop printers (HTTP ${response.status}): ${errText}`);
    }

    const json = await response.json();
    const rawItems: any[] = Array.isArray(json)
      ? json
      : json.data || json.printers || json.items || [];

    return rawItems.map((item: any, index: number): PrinterTelemetry => {
      const rawStatus = (item.status || (item.is_online ? 'ONLINE' : 'OFFLINE')).toUpperCase();
      let normalizedStatus: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'ERROR' = 'ONLINE';
      if (rawStatus === 'OFFLINE') normalizedStatus = 'OFFLINE';
      else if (rawStatus === 'BUSY' || rawStatus === 'PRINTING') normalizedStatus = 'BUSY';
      else if (rawStatus === 'ERROR' || rawStatus === 'FAULT') normalizedStatus = 'ERROR';

      const isOnline = Boolean(
        item.is_online !== undefined
          ? item.is_online
          : normalizedStatus !== 'OFFLINE' && normalizedStatus !== 'ERROR'
      );

      let errorState: HardwareErrorState = 'NONE';
      const rawErrorState = (item.error_state || item.telemetry?.error_state || '').toUpperCase();
      if (rawErrorState.includes('PAPER_OUT') || rawErrorState.includes('PAPEROUT')) {
        errorState = 'PAPER_OUT';
      } else if (rawErrorState.includes('JAM')) {
        errorState = 'JAMMED';
      } else if (rawErrorState.includes('DOOR')) {
        errorState = 'DOOR_OPEN';
      } else if (rawErrorState.includes('TONER')) {
        errorState = 'LOW_TONER';
      } else if (rawErrorState === 'OFFLINE' || !isOnline) {
        errorState = 'OFFLINE';
      } else if (rawErrorState && rawErrorState !== 'NONE') {
        errorState = 'ERROR';
      }

      let tonerLevel: number | undefined = undefined;
      const rawToner = item.toner_level ?? item.telemetry?.toner_level;
      if (rawToner !== undefined && rawToner !== null) {
        tonerLevel = Math.max(0, Math.min(100, Number(rawToner)));
      }

      return {
        id: item.id || item.printer_id || `printer-${index}`,
        shop_id: item.shop_id || shopId,
        name: item.name || item.printer_name || `Printer ${index + 1}`,
        status: normalizedStatus,
        is_online: isOnline,
        toner_level: tonerLevel,
        error_state: errorState,
        error_message: item.error_message || item.telemetry?.error_message || undefined,
        capabilities: item.capabilities,
        last_heartbeat_at: item.last_heartbeat_at || item.updated_at
      };
    });
  }

  /**
   * Re-submits a failed print job back to QUEUED status.
   * POST /api/v1/shops/:shopId/jobs/:jobId/retry
   */
  public async retryJob(shopId: string, jobId: string): Promise<RetryJobResponse> {
    if (!shopId || !jobId) {
      throw new Error('shopId and jobId are required to retry a print job');
    }

    const apiUrl = this.baseUrl.replace(/\/+$/, '');
    const endpoint = `${apiUrl}/api/v1/shops/${shopId}/jobs/${jobId}/retry`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: 'manual_operator_retry' })
    });

    if (!response.ok) {
      // Fallback: PUT status = QUEUED if retry endpoint is not dedicated
      const fallbackEndpoint = `${apiUrl}/api/v1/shops/${shopId}/jobs/${jobId}/status`;
      const fallbackResp = await fetch(fallbackEndpoint, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ status: 'QUEUED', reason: 'manual_operator_retry' })
      });

      if (!fallbackResp.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Failed to retry print job ${jobId} (HTTP ${response.status}): ${errText}`);
      }
    }

    return {
      success: true,
      jobId,
      status: 'QUEUED',
      message: 'Job re-queued successfully'
    };
  }

  /**
   * Subscribes to live agent status telemetry broadcast events: `agent.status` on channel `caps:shop:<shopId>`.
   */
  public subscribeToAgentStatus(
    shopId: string,
    callback: (telemetry: Partial<PrinterTelemetry>) => void
  ): () => void {
    if (!shopId) return () => {};

    try {
      const client = this.supabaseClient || getSupabaseBrowserClient();
      if (!client || !client.channel) {
        return () => {};
      }

      const channelName = `caps:shop:${shopId}`;
      const channel = client.channel(channelName);

      channel.on(
        'broadcast',
        { event: 'agent.status' },
        (payload: { payload?: Record<string, any>; [key: string]: any }) => {
          const data = payload?.payload || payload;
          if (data) {
            const update: Partial<PrinterTelemetry> = {};
            const id = data['printer_id'] || data['id'];
            if (id) update.id = String(id);
            const name = data['printer_name'] || data['name'];
            if (name) update.name = String(name);
            if (data['status']) {
              update.status = String(data['status']).toUpperCase() as PrinterTelemetry['status'];
            }
            if (data['is_online'] !== undefined) {
              update.is_online = Boolean(data['is_online']);
            }
            if (data['toner_level'] !== undefined) {
              update.toner_level = Number(data['toner_level']);
            }
            if (data['error_state']) {
              update.error_state = String(data['error_state']).toUpperCase() as HardwareErrorState;
            }
            if (data['error_message'] !== undefined) {
              update.error_message = String(data['error_message']);
            }
            update.last_heartbeat_at = String(data['timestamp'] || new Date().toISOString());

            callback(update);
          }
        }
      );

      channel.subscribe();

      return () => {
        try {
          if (client.removeChannel) {
            client.removeChannel(channel);
          } else if (channel.unsubscribe) {
            channel.unsubscribe();
          }
        } catch {
          // Silent cleanup
        }
      };
    } catch {
      return () => {};
    }
  }
}
