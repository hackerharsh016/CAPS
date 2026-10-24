/**
 * Realtime Queue Subscription Client for CAPS Owner Dashboard (P05-M02-F01).
 *
 * Implements:
 * - Realtime wake-up triggers with strict query reconciliation.
 * - Event deduplication window & out-of-order protection.
 * - Automatic fetch-on-reconnect to resynchronize after network gaps.
 * - Fallback interval polling when websocket is unavailable.
 * - Resource cleanup on unmount/unsubscribe.
 */

import type {
  RealtimeConnectionState,
  RealtimeQueueEvent,
  QueueEventListener,
  ConnectionStateListener
} from './types';
import { getSupabaseEnv } from '../../lib/supabase';

export interface RealtimeQueueClientOptions {
  shopId: string;
  enableFallbackPolling?: boolean | undefined;
  pollingIntervalMs?: number | undefined;
  reconnectDelayMs?: number | undefined;
  dedupWindowSize?: number | undefined;
}

export class RealtimeQueueClient {
  private readonly shopId: string;
  private readonly enableFallbackPolling: boolean;
  private readonly pollingIntervalMs: number;
  private readonly reconnectDelayMs: number;
  private readonly dedupWindowSize: number;

  private state: RealtimeConnectionState = 'disconnected';
  private isSubscribed = false;
  private lastEventTimestamp = 0;
  private lastSequenceNumber = 0;
  private processedEventIds = new Set<string>();

  private eventListeners = new Set<QueueEventListener>();
  private stateListeners = new Set<ConnectionStateListener>();
  private reconnectListeners = new Set<() => void>();

  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: RealtimeQueueClientOptions) {
    if (!options.shopId) {
      throw new Error('Tenant security invariant: shopId is required for Queue subscription.');
    }

    this.shopId = options.shopId;
    this.enableFallbackPolling = options.enableFallbackPolling ?? true;
    this.pollingIntervalMs = options.pollingIntervalMs ?? 3000;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2000;
    this.dedupWindowSize = options.dedupWindowSize ?? 100;
  }

  /**
   * Initializes the subscription.
   */
  public subscribe(): void {
    if (this.isSubscribed) return;

    this.isSubscribed = true;
    this.updateState('connecting');

    // Start polling so queue updates consistently
    this.startPolling();

    // Establish WebSocket connection in browser if available
    if (typeof window !== 'undefined' && typeof WebSocket !== 'undefined') {
      try {
        const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();
        const wsProtocol = supabaseUrl.startsWith('https') ? 'wss' : 'ws';
        const host = supabaseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const wsUrl = `${wsProtocol}://${host}/realtime/v1/websocket?apikey=${supabaseAnonKey}&vsn=1.0.0`;

        const ws = new WebSocket(wsUrl);
        this.ws = ws;

        ws.onopen = () => {
          if (!this.isSubscribed) {
            ws.close();
            return;
          }
          this.updateState('connected');

          // Subscribe to postgres_changes on print_jobs
          const joinMsg = {
            topic: `realtime:public:print_jobs:shop_id=eq.${this.shopId}`,
            event: 'phx_join',
            payload: {
              config: {
                postgres_changes: [
                  { event: '*', schema: 'public', table: 'print_jobs', filter: `shop_id=eq.${this.shopId}` }
                ]
              }
            },
            ref: '1',
            join_ref: '1'
          };
          ws.send(JSON.stringify(joinMsg));

          // Also subscribe to broadcast channel
          const broadcastMsg = {
            topic: `caps:shop:${this.shopId}`,
            event: 'phx_join',
            payload: {},
            ref: '2',
            join_ref: '2'
          };
          ws.send(JSON.stringify(broadcastMsg));

          this.heartbeatTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  topic: 'phoenix',
                  event: 'heartbeat',
                  payload: {},
                  ref: Date.now().toString()
                })
              );
            }
          }, 25000);
        };

        ws.onmessage = event => {
          try {
            const data = JSON.parse(event.data);
            const evtName = data.event;
            if (
              evtName === 'postgres_changes' ||
              evtName === 'INSERT' ||
              evtName === 'UPDATE' ||
              evtName === 'broadcast'
            ) {
              for (const listener of this.reconnectListeners) {
                try {
                  listener();
                } catch {
                  // ignore
                }
              }
              for (const listener of this.eventListeners) {
                try {
                  listener({
                    event_id: data.payload?.data?.id || `evt-${Date.now()}`,
                    event_type: 'JOB_UPDATED',
                    job_id: data.payload?.data?.id || 'job-changed',
                    shop_id: this.shopId,
                    sequence: Date.now(),
                    timestamp: new Date().toISOString()
                  });
                } catch {
                  // ignore
                }
              }
            }
          } catch {
            // ignore
          }
        };

        ws.onerror = () => {
          this.startPolling();
        };

        ws.onclose = () => {
          if (this.isSubscribed) {
            this.startPolling();
          }
        };
      } catch {
        this.startPolling();
      }
    } else {
      this.updateState('connected');
    }
  }

  /**
   * Complete subscription teardown.
   */
  public unsubscribe(): void {
    this.isSubscribed = false;
    this.stopPolling();
    this.clearReconnectTimer();

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }

    this.eventListeners.clear();
    this.stateListeners.clear();
    this.reconnectListeners.clear();

    this.updateState('disconnected');
  }

  /**
   * Register listener for realtime wake-up events.
   */
  public onWakeup(listener: QueueEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /**
   * Register listener for connection state changes.
   */
  public onStateChange(listener: ConnectionStateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  /**
   * Register listener for reconnect resync events.
   */
  public onReconnect(listener: () => void): () => void {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  /**
   * Dispatches a received event into the client.
   * Handles deduplication and out-of-order rejection.
   * Returns true if event was processed, false if dropped.
   */
  public processIncomingEvent(event: RealtimeQueueEvent): boolean {
    if (!this.isSubscribed) return false;

    // Tenant check: drop events belonging to other shops
    if (event.shop_id !== this.shopId) {
      return false;
    }

    // Deduplication check: drop duplicate event IDs
    if (this.processedEventIds.has(event.event_id)) {
      return false;
    }

    // Sequence / Timestamp ordering check
    const eventTime = new Date(event.timestamp).getTime();
    if (eventTime < this.lastEventTimestamp && event.sequence <= this.lastSequenceNumber) {
      // Out-of-order / replay detected: drop
      return false;
    }

    // Record in sliding deduplication window
    this.processedEventIds.add(event.event_id);
    if (this.processedEventIds.size > this.dedupWindowSize) {
      const oldestKey = this.processedEventIds.values().next().value;
      if (oldestKey) {
        this.processedEventIds.delete(oldestKey);
      }
    }

    this.lastEventTimestamp = Math.max(this.lastEventTimestamp, eventTime);
    this.lastSequenceNumber = Math.max(this.lastSequenceNumber, event.sequence);

    // Notify listeners
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in QueueEventListener:', err);
      }
    }

    return true;
  }

  /**
   * Simulates a network disconnect / reconnect sequence (for testing and resilience).
   */
  public triggerReconnect(): void {
    if (!this.isSubscribed) return;

    this.updateState('reconnecting');

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      if (!this.isSubscribed) return;

      this.updateState('connected');
      this.stopPolling();

      // Trigger re-synchronization callback for query reconciliation
      for (const listener of this.reconnectListeners) {
        try {
          listener();
        } catch (err) {
          console.error('Error in reconnect listener:', err);
        }
      }
    }, this.reconnectDelayMs);
  }

  public getState(): RealtimeConnectionState {
    return this.state;
  }

  private updateState(newState: RealtimeConnectionState): void {
    if (this.state === newState) return;
    this.state = newState;

    for (const listener of this.stateListeners) {
      try {
        listener(newState);
      } catch (err) {
        console.error('Error in ConnectionStateListener:', err);
      }
    }
  }

  /**
   * Starts fallback polling when WebSocket is disconnected or in recovery.
   */
  public startPolling(): void {
    if (!this.enableFallbackPolling || this.pollingTimer) return;
    this.updateState('fallback_polling');

    this.pollingTimer = setInterval(() => {
      // Fire reconnect listeners on polling tick to trigger query resync
      for (const listener of this.reconnectListeners) {
        try {
          listener();
        } catch {
          // ignore
        }
      }
    }, this.pollingIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
