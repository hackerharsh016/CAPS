import crypto from 'node:crypto';
import type {
  AgentDevice,
  AgentSession,
  AgentPairingCode,
  RegisterAgentDeviceDto,
  HeartbeatDto
} from './agents.types.js';

export interface IAgentsRepository {
  findDeviceById(id: string): Promise<AgentDevice | null>;
  findDeviceByFingerprint(shopId: string, fingerprint: string): Promise<AgentDevice | null>;
  listDevicesByShop(shopId: string): Promise<AgentDevice[]>;
  registerDevice(dto: RegisterAgentDeviceDto): Promise<AgentDevice>;
  revokeDevice(deviceId: string, reason: string): Promise<AgentDevice | null>;
  recordHeartbeat(dto: HeartbeatDto): Promise<boolean>;
  createSession(deviceId: string, shopId: string, version: string): Promise<AgentSession>;
  createPairingCode(
    shopId: string,
    createdBy: string,
    ttlSeconds?: number
  ): Promise<AgentPairingCode>;
  findPairingCode(code: string): Promise<AgentPairingCode | null>;
  consumePairingCode(code: string, deviceId: string): Promise<AgentPairingCode | null>;
  clear(): void;
}

export class MockAgentsRepository implements IAgentsRepository {
  private readonly devices = new Map<string, AgentDevice>();
  private readonly sessions = new Map<string, AgentSession>();
  private readonly pairingCodes = new Map<string, AgentPairingCode>();

  async findDeviceById(id: string): Promise<AgentDevice | null> {
    const device = this.devices.get(id);
    return device ? { ...device } : null;
  }

  async findDeviceByFingerprint(shopId: string, fingerprint: string): Promise<AgentDevice | null> {
    for (const device of this.devices.values()) {
      if (device.shop_id === shopId && device.device_fingerprint === fingerprint) {
        return { ...device };
      }
    }
    return null;
  }

  async listDevicesByShop(shopId: string): Promise<AgentDevice[]> {
    return Array.from(this.devices.values())
      .filter(d => d.shop_id === shopId)
      .map(d => ({ ...d }));
  }

  async registerDevice(dto: RegisterAgentDeviceDto): Promise<AgentDevice> {
    const existing = await this.findDeviceByFingerprint(dto.shop_id, dto.device_fingerprint);
    if (existing) {
      // Re-enroll device with updated credentials
      const updated: AgentDevice = {
        ...existing,
        device_name: dto.device_name,
        agent_version: dto.agent_version ?? existing.agent_version,
        auth_token_hash: dto.auth_token_hash,
        is_revoked: false,
        revoked_at: undefined,
        revoked_reason: undefined,
        last_heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      this.devices.set(existing.id, updated);
      return { ...updated };
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const device: AgentDevice = {
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

    this.devices.set(id, device);
    return { ...device };
  }

  async revokeDevice(deviceId: string, reason: string): Promise<AgentDevice | null> {
    const existing = this.devices.get(deviceId);
    if (!existing) return null;

    const now = new Date().toISOString();
    const revoked: AgentDevice = {
      ...existing,
      is_revoked: true,
      revoked_at: now,
      revoked_reason: reason,
      updated_at: now
    };

    this.devices.set(deviceId, revoked);
    return { ...revoked };
  }

  async recordHeartbeat(dto: HeartbeatDto): Promise<boolean> {
    const device = this.devices.get(dto.device_id);
    if (!device) return false;

    if (device.is_revoked) {
      return false;
    }

    const now = new Date().toISOString();
    this.devices.set(dto.device_id, {
      ...device,
      agent_version: dto.agent_version ?? device.agent_version,
      last_heartbeat_at: now,
      updated_at: now
    });

    return true;
  }

  async createSession(deviceId: string, shopId: string, version: string): Promise<AgentSession> {
    const device = this.devices.get(deviceId);
    if (!device || device.is_revoked) {
      throw new Error('Cannot create session for missing or revoked agent device.');
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const session: AgentSession = {
      id,
      device_id: deviceId,
      shop_id: shopId,
      agent_version: version,
      session_status: 'online',
      last_seen_at: now,
      started_at: now
    };

    this.sessions.set(id, session);
    return { ...session };
  }

  async createPairingCode(
    shopId: string,
    createdBy: string,
    ttlSeconds: number = 600
  ): Promise<AgentPairingCode> {
    const id = crypto.randomUUID();
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = 'CP-';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

    const pairingCode: AgentPairingCode = {
      id,
      shop_id: shopId,
      code,
      created_by: createdBy,
      expires_at: expiresAt,
      is_used: false,
      created_at: now.toISOString()
    };

    this.pairingCodes.set(code, pairingCode);
    return { ...pairingCode };
  }

  async findPairingCode(code: string): Promise<AgentPairingCode | null> {
    const cleanCode = code.trim().toUpperCase();
    const record = this.pairingCodes.get(cleanCode);
    return record ? { ...record } : null;
  }

  async consumePairingCode(code: string, deviceId: string): Promise<AgentPairingCode | null> {
    const cleanCode = code.trim().toUpperCase();
    const record = this.pairingCodes.get(cleanCode);
    if (!record) return null;

    const updated: AgentPairingCode = {
      ...record,
      is_used: true,
      used_at: new Date().toISOString(),
      used_by_device_id: deviceId
    };

    this.pairingCodes.set(cleanCode, updated);
    return { ...updated };
  }

  clear(): void {
    this.devices.clear();
    this.sessions.clear();
    this.pairingCodes.clear();
  }
}
