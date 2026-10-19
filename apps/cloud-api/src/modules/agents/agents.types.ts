export interface AgentDevice {
  id: string; // UUID
  shop_id: string; // UUID referencing Shop
  device_fingerprint: string;
  device_name: string;
  agent_version: string;
  auth_token_hash: string;
  is_revoked: boolean;
  revoked_at?: string | undefined;
  revoked_reason?: string | undefined;
  paired_by: string; // UUID referencing Profile
  last_heartbeat_at: string;
  created_at: string;
  updated_at?: string | undefined;
}

export interface AgentSession {
  id: string; // UUID
  device_id: string;
  shop_id: string;
  agent_version: string;
  session_status: 'online' | 'offline';
  ip_address?: string | undefined;
  last_seen_at: string;
  started_at: string;
  ended_at?: string | undefined;
}

export interface RegisterAgentDeviceDto {
  shop_id: string;
  device_fingerprint: string;
  device_name: string;
  agent_version?: string | undefined;
  auth_token_hash: string;
  paired_by: string;
}

export interface HeartbeatDto {
  device_id: string;
  agent_version?: string | undefined;
}
