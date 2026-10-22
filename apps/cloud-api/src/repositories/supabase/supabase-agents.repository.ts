/**
 * Supabase Agents Repository (INT-D3-03).
 * Production repository backed by Supabase for agent devices, pairing codes, and sessions.
 */

import crypto from 'node:crypto';
import type { IAgentsRepository } from '../../modules/agents/agents.repository.js';
import type {
  AgentDevice,
  AgentSession,
  AgentPairingCode,
  RegisterAgentDeviceDto,
  HeartbeatDto
} from '../../modules/agents/agents.types.js';
import {
  type SupabaseClientLike,
  type SupabaseRepoOptions,
  createDefaultSupabaseClient
} from './supabase-shops.repository.js';

export class SupabaseAgentsRepository implements IAgentsRepository {
  private readonly client: SupabaseClientLike;

  constructor(options: SupabaseRepoOptions = {}) {
    if (options.client) {
      this.client = options.client;
    } else {
      const env = typeof process !== 'undefined' ? process.env : {};
      const url = options.supabaseUrl || env['SUPABASE_URL'] || 'http://localhost:54321';
      const key =
        options.supabaseKey ||
        env['SUPABASE_SERVICE_ROLE_KEY'] ||
        env['SUPABASE_ANON_KEY'] ||
        '';
      const customFetch = options.customFetch || fetch;

      this.client = createDefaultSupabaseClient(url, key, customFetch);
    }
  }

  async findDeviceById(id: string): Promise<AgentDevice | null> {
    const { data, error } = await this.client
      .from('agent_devices')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;
    return mapDbRecordToDevice(data);
  }

  async findDeviceByTokenHash(tokenHash: string): Promise<AgentDevice | null> {
    const { data, error } = await this.client
      .from('agent_devices')
      .select('*')
      .eq('auth_token_hash', tokenHash)
      .eq('is_revoked', false)
      .maybeSingle();

    if (error || !data) return null;
    return mapDbRecordToDevice(data);
  }

  async findDeviceByFingerprint(shopId: string, fingerprint: string): Promise<AgentDevice | null> {
    const { data, error } = await this.client
      .from('agent_devices')
      .select('*')
      .eq('shop_id', shopId)
      .eq('device_fingerprint', fingerprint)
      .maybeSingle();

    if (error || !data) return null;
    return mapDbRecordToDevice(data);
  }

  async listDevicesByShop(shopId: string): Promise<AgentDevice[]> {
    const { data, error } = await this.client
      .from('agent_devices')
      .select('*')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false });

    if (error || !data) return [];
    return (data as any[]).map(mapDbRecordToDevice);
  }

  async registerDevice(dto: RegisterAgentDeviceDto): Promise<AgentDevice> {
    const existing = await this.findDeviceByFingerprint(dto.shop_id, dto.device_fingerprint);

    if (existing) {
      const now = new Date().toISOString();
      const updates = {
        device_name: dto.device_name,
        agent_version: dto.agent_version ?? existing.agent_version,
        auth_token_hash: dto.auth_token_hash,
        is_revoked: false,
        revoked_at: null,
        revoked_reason: null,
        last_heartbeat_at: now,
        updated_at: now
      };

      const { data, error } = await this.client
        .from('agent_devices')
        .update(updates)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update agent device: ${error.message || JSON.stringify(error)}`);
      }
      return mapDbRecordToDevice(data);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const newRecord = {
      id,
      shop_id: dto.shop_id,
      device_fingerprint: dto.device_fingerprint,
      device_name: dto.device_name,
      agent_version: dto.agent_version ?? '0.1.0',
      auth_token_hash: dto.auth_token_hash,
      is_revoked: false,
      paired_by: dto.paired_by,
      last_heartbeat_at: now,
      created_at: now,
      updated_at: now
    };

    const { data, error } = await this.client
      .from('agent_devices')
      .insert(newRecord)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to insert agent device: ${error.message || JSON.stringify(error)}`);
    }

    return mapDbRecordToDevice(data || newRecord);
  }

  async revokeDevice(deviceId: string, reason: string): Promise<AgentDevice | null> {
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from('agent_devices')
      .update({
        is_revoked: true,
        revoked_at: now,
        revoked_reason: reason,
        updated_at: now
      })
      .eq('id', deviceId)
      .select()
      .maybeSingle();

    if (error || !data) return null;
    return mapDbRecordToDevice(data);
  }

  async recordHeartbeat(dto: HeartbeatDto): Promise<boolean> {
    const now = new Date().toISOString();
    const { error } = await this.client
      .from('agent_devices')
      .update({
        last_heartbeat_at: now,
        ...(dto.agent_version ? { agent_version: dto.agent_version } : {})
      })
      .eq('id', dto.device_id);

    return !error;
  }

  async createSession(deviceId: string, shopId: string, version: string): Promise<AgentSession> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const session: AgentSession = {
      id,
      device_id: deviceId,
      shop_id: shopId,
      agent_version: version,
      session_status: 'online',
      started_at: now,
      last_seen_at: now
    };

    const { data, error } = await this.client
      .from('agent_sessions')
      .insert(session)
      .select()
      .single();

    if (error) {
      return session;
    }
    return data || session;
  }

  async createPairingCode(
    shopId: string,
    createdBy: string,
    ttlSeconds = 900
  ): Promise<AgentPairingCode> {
    const id = crypto.randomUUID();
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

    const record: AgentPairingCode = {
      id,
      code,
      shop_id: shopId,
      created_by: createdBy,
      expires_at: expiresAt,
      is_used: false,
      created_at: now.toISOString()
    };

    const { data, error } = await this.client
      .from('agent_pairing_codes')
      .insert(record)
      .select()
      .single();

    if (error) {
      return record;
    }
    return data || record;
  }

  async findPairingCode(code: string): Promise<AgentPairingCode | null> {
    const { data, error } = await this.client
      .from('agent_pairing_codes')
      .select('*')
      .eq('code', code)
      .maybeSingle();

    if (error || !data) return null;
    return data as AgentPairingCode;
  }

  async consumePairingCode(code: string, deviceId: string): Promise<AgentPairingCode | null> {
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from('agent_pairing_codes')
      .update({
        is_used: true,
        used_at: now,
        used_by_device_id: deviceId
      })
      .eq('code', code)
      .select()
      .maybeSingle();

    if (error || !data) return null;
    return data as AgentPairingCode;
  }

  clear(): void {
    // No-op for persistent db repository
  }
}

function mapDbRecordToDevice(row: any): AgentDevice {
  return {
    id: row.id,
    shop_id: row.shop_id,
    device_fingerprint: row.device_fingerprint,
    device_name: row.device_name,
    agent_version: row.agent_version || '0.1.0',
    auth_token_hash: row.auth_token_hash || row.device_token_hash || '',
    is_revoked: Boolean(row.is_revoked),
    revoked_at: row.revoked_at,
    revoked_reason: row.revoked_reason,
    paired_by: row.paired_by,
    last_heartbeat_at: row.last_heartbeat_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
