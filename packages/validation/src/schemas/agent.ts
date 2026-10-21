import { z } from 'zod';
import { PrintSettingsSchema } from '../settings.schema.js';

export const JobClaimRequestSchema = z.object({
  contract_version: z.string().default('1.0.0'),
  agent_device_id: z.string().min(1, 'Invalid agent_device_id'),
  shop_id: z.string().uuid('Invalid shop_id UUID'),
  requested_printer_id: z.string().optional(),
  lease_duration_seconds: z.number().int().min(30).max(600).default(90),
  timestamp: z.string().optional()
});

export const JobClaimDetailSchema = z.object({
  job_id: z.string().uuid(),
  attempt_id: z.string().min(1),
  lease_token: z.string().min(16),
  lease_expires_at: z.string(),
  shop_id: z.string().uuid(),
  printer_id: z.string().min(1),
  download_url: z.string(),
  checksum_sha256: z.string().optional(),
  content_type: z.literal('application/pdf').optional(),
  file_size_bytes: z.number().int().min(1).optional(),
  settings: PrintSettingsSchema,
  created_at: z.string().optional()
});

export const JobClaimResponseSchema = z.object({
  contract_version: z.string().default('1.0.0'),
  claimed: z.boolean(),
  job: JobClaimDetailSchema.nullable()
});

export const JobStatusEnum = z.enum([
  'CLAIMED',
  'DOWNLOADING',
  'RENDERING',
  'PRINTING',
  'COMPLETED',
  'FAILED',
  'REQUIRES_REVIEW',
  'UNKNOWN_REQUIRES_REVIEW',
  'claimed',
  'downloading',
  'rendering',
  'printing',
  'completed',
  'failed',
  'requires_review'
]);

export const JobStatusUpdateRequestSchema = z.object({
  contract_version: z.string().default('1.0.0'),
  job_id: z.string().uuid('Invalid job_id UUID'),
  attempt_id: z.string().min(1, 'Invalid attempt_id'),
  lease_token: z.string().min(16, 'lease_token must be at least 16 characters').optional(),
  status: JobStatusEnum,
  spooler_job_id: z.number().int().positive().nullable().optional(),
  pages_printed: z.number().int().min(0).optional(),
  total_pages: z.number().int().min(1).optional(),
  error_code: z.string().nullable().optional(),
  error_message: z.string().max(1000).nullable().optional(),
  timestamp: z.string().optional()
});

export const PairAgentDeviceSchema = z
  .object({
    pairing_code: z.string().min(1, 'pairing_code is required'),
    device_fingerprint: z.string().min(1).optional(),
    fingerprint: z.string().min(1).optional(),
    device_name: z.string().min(1).optional(),
    hostname: z.string().min(1).optional(),
    os_version: z.string().min(1).optional(),
    agent_version: z.string().min(1).optional()
  })
  .refine(
    val => {
      const hasFingerprintAndName = Boolean(val.device_fingerprint && val.device_name);
      const hasHostname = Boolean(val.hostname);
      return hasFingerprintAndName || hasHostname;
    },
    {
      message:
        'Must provide either (device_fingerprint, device_name) or (hostname, os_version, fingerprint)'
    }
  )
  .transform(val => ({
    pairing_code: val.pairing_code,
    device_fingerprint: (val.device_fingerprint || val.fingerprint || val.hostname)!,
    device_name: val.device_name || val.hostname || 'Windows Print Agent',
    agent_version: val.agent_version || val.os_version || '0.1.0',
    hostname: val.hostname,
    os_version: val.os_version,
    fingerprint: val.fingerprint || val.device_fingerprint
  }));
