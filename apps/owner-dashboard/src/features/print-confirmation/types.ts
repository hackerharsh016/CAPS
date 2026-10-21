/**
 * Print Confirmation types for CAPS Owner Dashboard.
 * Strict contract definitions for one-tap print confirmation, idempotency,
 * and queue order validation.
 */

export interface PrintConfirmationRequest {
  jobId: string;
  shopId: string;
  idempotencyKey: string;
  notes?: string | undefined;
}

export interface PrintConfirmationResponse {
  success: boolean;
  jobId: string;
  status: 'approved' | 'claimed' | 'completed';
  confirmedAt: string;
  idempotencyKey: string;
  message?: string | undefined;
}

export type PrintConfirmationErrorCode =
  | 'UNAUTHORIZED_CROSS_SHOP'
  | 'WRONG_QUEUE_ORDER'
  | 'INVALID_JOB_STATUS'
  | 'JOB_NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'IDEMPOTENCY_CONFLICT'
  | 'UNKNOWN_ERROR';

export interface PrintConfirmationErrorDetails {
  code: PrintConfirmationErrorCode;
  message: string;
  jobId?: string | undefined;
  expectedJobId?: string | undefined;
  currentQueuePosition?: number | undefined;
}

export interface IdempotencyRecord {
  idempotencyKey: string;
  jobId: string;
  timestamp: number;
  response: PrintConfirmationResponse;
}
