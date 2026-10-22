/**
 * Live Queue Domain Types & PostgreSQL Canonical Status Alignment for CAPS Owner Dashboard (INT-D2-01).
 * Strictly mirrors the 7 canonical backend PostgreSQL states:
 * SUBMITTED, OWNER_CONFIRMED, QUEUED, PRINTING, COMPLETED, FAILED, CANCELLED.
 */

export const CANONICAL_JOB_STATUSES = [
  'SUBMITTED',
  'OWNER_CONFIRMED',
  'QUEUED',
  'PRINTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
] as const;

export type CanonicalJobStatus = (typeof CANONICAL_JOB_STATUSES)[number];

export enum BackendJobStatus {
  SUBMITTED = 'SUBMITTED',
  OWNER_CONFIRMED = 'OWNER_CONFIRMED',
  QUEUED = 'QUEUED',
  PRINTING = 'PRINTING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

export type JobStatus = CanonicalJobStatus;

export type PriorityTier = 'urgent' | 'flexible';

export interface PrintSettings {
  paper_size: 'A4' | 'A3' | 'Legal';
  color_mode: 'bw' | 'color';
  sides: 'single' | 'double';
  orientation: 'portrait' | 'landscape';
  copies: number;
  page_range: string;
  binding: 'none' | 'spiral' | 'staple' | 'lamination';
}

export interface QueueItem {
  id: string; // Job UUID primary key & queue token
  shop_id: string; // Shop UUID
  customer_id: string; // Customer UUID
  customer_name: string;
  customer_phone?: string | undefined;
  printer_id?: string | undefined;
  printer_name?: string | undefined;
  document_name?: string | undefined;
  document_storage_key: string;
  settings: PrintSettings;
  priority_tier: PriorityTier;
  price_total_paise: number;
  status: CanonicalJobStatus;
  queue_position: number;
  estimated_wait_minutes?: number | undefined;
  created_at: string;
  updated_at: string;
}

export type QueueFilter = CanonicalJobStatus | 'ALL';

export interface JobStatusConfig {
  status: CanonicalJobStatus;
  label: string;
  badgeClass: string;
  description: string;
  canApprove: boolean;
}

export const JOB_STATUS_CONFIG: Record<CanonicalJobStatus, JobStatusConfig> = {
  SUBMITTED: {
    status: 'SUBMITTED',
    label: 'Submitted',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
    description: 'Job submitted by customer, awaiting owner review and confirmation',
    canApprove: true
  },
  OWNER_CONFIRMED: {
    status: 'OWNER_CONFIRMED',
    label: 'Owner Confirmed',
    badgeClass: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    description: 'Confirmed by shop owner, ready for queue dispatch',
    canApprove: false
  },
  QUEUED: {
    status: 'QUEUED',
    label: 'Queued',
    badgeClass: 'bg-sky-100 text-sky-800 border-sky-200',
    description: 'Enqueued and waiting for desktop print agent to claim',
    canApprove: true
  },
  PRINTING: {
    status: 'PRINTING',
    label: 'Printing',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
    description: 'Claimed by desktop agent and actively printing',
    canApprove: false
  },
  COMPLETED: {
    status: 'COMPLETED',
    label: 'Completed',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    description: 'Print job completed successfully',
    canApprove: false
  },
  FAILED: {
    status: 'FAILED',
    label: 'Failed',
    badgeClass: 'bg-rose-100 text-rose-800 border-rose-200',
    description: 'Print job failed or printer encountered an error',
    canApprove: false
  },
  CANCELLED: {
    status: 'CANCELLED',
    label: 'Cancelled',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    description: 'Print job was cancelled',
    canApprove: false
  }
};

/**
 * Normalizes any incoming status string to the canonical uppercase backend enum.
 */
export function normalizeJobStatus(status: unknown): CanonicalJobStatus {
  if (typeof status !== 'string') return 'SUBMITTED';
  const trimmed = status.trim();
  const upper = trimmed.toUpperCase();

  if (CANONICAL_JOB_STATUSES.includes(upper as CanonicalJobStatus)) {
    return upper as CanonicalJobStatus;
  }

  // Handle lowercase / legacy states
  const lower = trimmed.toLowerCase();
  switch (lower) {
    case 'pending_payment':
    case 'submitted':
      return 'SUBMITTED';
    case 'approved':
    case 'owner_confirmed':
      return 'OWNER_CONFIRMED';
    case 'queued':
      return 'QUEUED';
    case 'claimed':
    case 'downloading':
    case 'printing':
      return 'PRINTING';
    case 'completed':
      return 'COMPLETED';
    case 'failed':
    case 'requires_review':
      return 'FAILED';
    case 'cancelled':
      return 'CANCELLED';
    default:
      return 'SUBMITTED';
  }
}
