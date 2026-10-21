import { z } from 'zod';

export const claimRequestSchema = z.object({
  contract_version: z.string().default('1.0.0'),
  agent_device_id: z.string().min(1, 'agent_device_id is required'),
  shop_id: z.string().uuid('shop_id must be a valid UUID'),
  requested_printer_id: z.string().optional(),
  lease_duration_seconds: z.number().int().min(30).max(600).optional(),
  timestamp: z.string().default(() => new Date().toISOString()),
  idempotency_key: z.string().optional()
});

export const renewLeaseSchema = z.object({
  job_id: z.string().min(1, 'job_id is required'),
  attempt_id: z.string().min(1, 'attempt_id is required'),
  lease_token: z.string().min(1, 'lease_token is required'),
  extend_seconds: z.number().int().min(30).max(300).optional()
});

export const generatePairingCodeSchema = z.object({
  ttl_seconds: z.number().int().min(60).max(1800).optional()
});

export const pairAgentDeviceSchema = z
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
  .transform(val => {
    const fingerprint = val.device_fingerprint || val.fingerprint || val.hostname!;
    const name = val.device_name || val.hostname || 'Windows Print Agent';
    const version = val.agent_version || val.os_version || '0.1.0';

    return {
      pairing_code: val.pairing_code,
      device_fingerprint: fingerprint,
      device_name: name,
      agent_version: version,
      hostname: val.hostname,
      os_version: val.os_version,
      fingerprint: val.fingerprint || val.device_fingerprint
    };
  });

export const agentPairingHeartbeatSchema = z.object({
  device_id: z.string().min(1, 'device_id is required'),
  agent_version: z.string().optional(),
  metrics: z.record(z.unknown()).optional()
});

export const agentTelemetryHeartbeatSchema = z
  .object({
    agent_id: z.string().min(1, 'agent_id is required').optional(),
    agentId: z.string().optional(),
    shop_id: z.string().min(1, 'shop_id is required').optional(),
    shopId: z.string().optional(),
    version: z.string().default('1.0.0'),
    status: z.enum(['online', 'printing', 'idle', 'offline', 'error']).default('online'),
    printers: z
      .array(
        z.object({
          printer_id: z.string(),
          name: z.string(),
          status: z.enum(['online', 'offline', 'paper_jam', 'out_of_paper', 'error'])
        })
      )
      .optional(),
    system_info: z
      .object({
        hostname: z.string().optional(),
        os: z.string().optional(),
        cpu_percent: z.number().optional(),
        memory_mb: z.number().optional()
      })
      .optional(),
    timestamp: z.string().optional()
  })
  .refine(val => Boolean(val.agent_id || val.agentId) && Boolean(val.shop_id || val.shopId), {
    message: 'agent_id and shop_id are required'
  });

export const revokeDeviceSchema = z.object({
  reason: z.string().optional()
});

export const downloadGrantSchema = z.object({
  job_id: z.string().uuid('job_id must be a valid UUID'),
  attempt_id: z.string().min(1, 'attempt_id is required'),
  lease_token: z.string().min(16, 'lease_token must be at least 16 characters')
});

export const jobStatusUpdateSchema = z
  .object({
    contract_version: z.string().default('1.0.0'),
    job_id: z.string().uuid('job_id must be a valid UUID').optional(),
    attempt_id: z.string().min(1, 'attempt_id is required'),
    lease_token: z
      .string()
      .min(16, 'lease_token must be at least 16 characters')
      .optional()
      .default('dummy-lease-token-16-chars'),
    status: z.string().transform(s => s.toUpperCase()),
    spooler_job_id: z.number().int().min(1).nullable().optional(),
    pages_printed: z.number().int().min(0).optional().default(0),
    total_pages: z.number().int().min(1).optional().default(1),
    error_code: z.string().nullable().optional(),
    error_message: z.string().max(1000).nullable().optional(),
    timestamp: z.string().default(() => new Date().toISOString())
  })
  .refine(
    val =>
      [
        'CLAIMED',
        'DOWNLOADING',
        'RENDERING',
        'PRINTING',
        'COMPLETED',
        'FAILED',
        'REQUIRES_REVIEW',
        'UNKNOWN_REQUIRES_REVIEW'
      ].includes(val.status),
    { message: 'Invalid status value' }
  );

export const reconcileRequestSchema = z.object({
  device_id: z.string().min(1, 'device_id is required'),
  last_event_id: z.number().int().nonnegative().optional(),
  since_timestamp: z.string().optional(),
  in_flight_attempt_id: z.string().optional(),
  in_flight_lease_token: z.string().optional()
});

export const resolveUnresolvedSchema = z.object({
  resolution: z.enum(['retry', 'cancel', 'mark_completed']),
  notes: z.string().max(1000).optional()
});
