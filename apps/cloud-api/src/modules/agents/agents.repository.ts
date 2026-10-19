import type {
  AgentDevice,
  AgentSession,
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
}

export class MockAgentsRepository implements IAgentsRepository {
  private devices: Map<string, AgentDevice> = new Map();
  private sessions: Map<string, AgentSession> = new Map();

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
      throw new Error(`Device fingerprint '${dto.device_fingerprint}' is already registered for this shop.`);
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

    // Strict security invariant: Revoked devices are denied heartbeats
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
}
