/**
 * Agent Monitoring & Operator Recovery Domain Types.
 * Aligned with CAPS SRS UC-3, Section 4.2 & Master Plan §5.4, Migration 002, 009, 012.
 */

export type HardwareIncidentType = 'jam' | 'offline' | 'out_of_paper' | 'door_open' | 'agent_disconnected';

export type IncidentSeverity = 'critical' | 'warning' | 'info';

export interface HardwareIncident {
  id: string;
  shopId: string;
  printerId: string;
  printerName: string;
  incidentType: HardwareIncidentType;
  severity: IncidentSeverity;
  message: string;
  affectedJobsCount: number;
  detectedAt: string;
  resolvedAt?: string | undefined;
}

export interface AgentDeviceStatus {
  id: string;
  shopId: string;
  deviceName: string;
  agentVersion: string;
  isOnline: boolean;
  lastHeartbeatAt: string;
  isRevoked: boolean;
}

export type AmbiguousOutcomeResolution = 'retry' | 'cancel' | 'mark_completed';

export interface ResolveUnresolvedJobRequest {
  jobId: string;
  shopId: string;
  resolution: AmbiguousOutcomeResolution;
  physicalEvidenceConfirmed: boolean;
  notes?: string | undefined;
}

export interface ResolveUnresolvedJobResponse {
  jobId: string;
  previousStatus: string;
  newStatus: string;
  resolvedAt: string;
  message: string;
}

export interface AmbiguousJobDetails {
  id: string;
  shopId: string;
  customerName: string;
  documentName?: string | undefined;
  printerName?: string | undefined;
  status: 'requires_review' | 'failed';
  attemptsCount: number;
  lastAttemptError?: string | undefined;
  lastAttemptAt?: string | undefined;
  pageCount?: number | undefined;
  priceTotalPaise: number;
}
