export type AttemptStatus =
  | 'leased'
  | 'downloading'
  | 'rendering'
  | 'submitted'
  | 'printing'
  | 'completed'
  | 'failed'
  | 'requires_review';

export interface JobAttempt {
  id: string; // UUID primary key
  job_id: string; // UUID references PrintJob
  printer_id?: string | undefined; // UUID references Printer
  agent_device_id?: string | undefined; // UUID references AgentDevice
  lease_token: string; // UUID lease identifier
  lease_expires_at: string; // ISO timestamp
  spooler_job_id?: number | undefined; // Windows Spooler Job ID
  idempotency_key: string; // Unique per job attempt
  status: AttemptStatus;
  error_code?: string | undefined;
  error_message?: string | undefined;
  created_at: string;
  updated_at?: string | undefined;
}

export interface CreateJobAttemptDto {
  job_id: string;
  printer_id?: string | undefined;
  agent_device_id?: string | undefined;
  lease_token?: string | undefined;
  lease_expires_at: string;
  spooler_job_id?: number | undefined;
  idempotency_key: string;
  status?: AttemptStatus | undefined;
  error_code?: string | undefined;
  error_message?: string | undefined;
}

export interface UpdateJobAttemptDto {
  status?: AttemptStatus | undefined;
  spooler_job_id?: number | undefined;
  error_code?: string | undefined;
  error_message?: string | undefined;
  lease_expires_at?: string | undefined;
}
