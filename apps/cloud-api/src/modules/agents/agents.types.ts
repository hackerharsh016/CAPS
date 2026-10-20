/**
 * Domain types and DTOs for CAPS Agent Management & Claim Protocols.
 * Strictly conforms to frozen packages/print-contracts/schema/job-claim-request.schema.json
 * and packages/print-contracts/schema/job-claim-response.schema.json.
 */

import type { PrintSettings } from '../pricing/pricing.types.js';

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
  paired_by: string; // UUID referencing Profile/Owner
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

/**
 * Strict frozen JSON Schema DTO: job-claim-request.schema.json
 */
export interface JobClaimRequestDto {
  contract_version: string; // e.g. "1.0.0"
  agent_device_id: string; // UUID of registered AgentDevice
  shop_id: string; // UUID
  requested_printer_id?: string | undefined;
  lease_duration_seconds?: number | undefined; // 30 - 600, default 120
  timestamp: string; // ISO8601
  idempotency_key?: string | undefined;
}

/**
 * Claimed job details within job-claim-response.schema.json
 */
export interface ClaimedJobDetails {
  job_id: string; // UUID
  attempt_id: string; // UUID
  lease_token: string; // UUID / min 16 chars
  lease_expires_at: string; // ISO8601
  shop_id: string; // UUID
  printer_id: string;
  download_url: string; // URI
  checksum_sha256: string; // 64 hex characters
  content_type: 'application/pdf';
  file_size_bytes: number;
  settings: PrintSettings;
  created_at: string; // ISO8601
}

/**
 * Strict frozen JSON Schema DTO: job-claim-response.schema.json
 */
export interface JobClaimResponseDto {
  contract_version: string; // e.g. "1.0.0"
  claimed: boolean;
  job: ClaimedJobDetails | null;
}

export interface LeaseRenewalRequestDto {
  job_id: string;
  attempt_id: string;
  lease_token: string;
  extend_seconds?: number | undefined;
}

export interface LeaseRenewalResponseDto {
  job_id: string;
  attempt_id: string;
  lease_token: string;
  lease_expires_at: string;
  status: string;
}

export interface ReconcileLeasesResult {
  shop_id?: string | undefined;
  reconciled_count: number;
  recovered_job_ids: string[];
  requires_review_job_ids: string[];
}
