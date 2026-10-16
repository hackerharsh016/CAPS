import { z } from 'zod';
import { PrintSettingsSchema } from './settings.schema.js';

export const JobClaimRequestSchema = z
  .object({
    agent_device_id: z.string().uuid('Invalid agent_device_id UUID'),
    shop_id: z.string().uuid('Invalid shop_id UUID'),
    lease_duration_seconds: z.number().int().min(30).max(300).default(90)
  })
  .strict('Unrecognized properties are forbidden in JobClaimRequest');

export const JobClaimResponseSchema = z
  .object({
    job_id: z.string().uuid(),
    attempt_id: z.string().uuid(),
    lease_id: z.string().uuid(),
    download_url: z.string().url(),
    checksum_sha256: z.string().optional(),
    settings: PrintSettingsSchema,
    lease_expires_at: z.string().datetime()
  })
  .strict();

export const JobStatusUpdateRequestSchema = z
  .object({
    job_id: z.string().uuid('Invalid job_id UUID'),
    attempt_id: z.string().uuid('Invalid attempt_id UUID'),
    status: z.enum(['downloading', 'printing', 'completed', 'failed', 'requires_review']),
    spooler_job_id: z.number().int().positive().optional(),
    error_message: z.string().max(1000).optional()
  })
  .strict('Unrecognized properties are forbidden in JobStatusUpdateRequest');
