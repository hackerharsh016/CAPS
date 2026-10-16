/**
 * Desktop Print Agent communication and lease contract types for CAPS.
 */

import { PrintSettings } from './settings.js';

export interface AgentSession {
  id: string; // UUID
  shop_id: string; // UUID references Shop
  agent_version: string;
  last_seen_at: string;
  session_status: 'online' | 'offline';
}

export interface JobClaimRequest {
  agent_device_id: string;
  shop_id: string;
  lease_duration_seconds?: number;
}

export interface JobClaimResponse {
  job_id: string;
  attempt_id: string;
  lease_id: string;
  download_url: string; // Short-lived signed S3 download URL
  checksum_sha256?: string;
  settings: PrintSettings;
  lease_expires_at: string;
}

export interface JobStatusUpdateRequest {
  job_id: string;
  attempt_id: string;
  status: 'downloading' | 'printing' | 'completed' | 'failed' | 'requires_review';
  spooler_job_id?: number;
  error_message?: string;
}
