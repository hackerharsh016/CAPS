import { ApiError } from '../../plugins/error-handler.js';
import type { JobStatus } from './print-jobs.types.js';

export class IllegalStateTransitionError extends ApiError {
  constructor(fromStatus: JobStatus, toStatus: JobStatus, message?: string) {
    super(
      400,
      'INVALID_STATE_TRANSITION',
      message || `Illegal print job state transition from "${fromStatus}" to "${toStatus}".`,
      { from: fromStatus, to: toStatus }
    );
    this.name = 'IllegalStateTransitionError';
  }
}

/**
 * Authoritative CAPS Print Job State Machine Transition Graph.
 * Conforms to Master Plan §5.2, §5.5, ADR 0004, and packages/types.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  pending_payment: ['queued', 'cancelled', 'failed'],
  queued: ['approved', 'cancelled', 'requires_review'],
  approved: ['claimed', 'cancelled', 'requires_review'],
  claimed: ['downloading', 'printing', 'approved', 'queued', 'failed'],
  downloading: ['printing', 'approved', 'failed'],
  printing: ['completed', 'failed', 'requires_review'],
  requires_review: ['approved', 'queued', 'cancelled'],
  completed: [], // Terminal
  failed: ['queued'], // Allow re-enqueue on manual owner retry
  cancelled: [] // Terminal
} as const;

export function isValidTransition(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return true; // Idempotent no-op transition
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function assertValidTransition(from: JobStatus, to: JobStatus): void {
  if (!isValidTransition(from, to)) {
    throw new IllegalStateTransitionError(from, to);
  }
}
