export type PriorityTier = 'urgent' | 'flexible';

export type JobStatus =
  | 'pending_payment'
  | 'queued'
  | 'approved'
  | 'claimed'
  | 'downloading'
  | 'printing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'requires_review';

export interface PrintJob {
  id: string; // UUID primary key & queue token
  shop_id: string; // UUID references Shop
  customer_id: string; // UUID references UserProfile
  printer_id?: string | undefined; // UUID references Printer
  document_storage_key: string;
  settings: Record<string, unknown>;
  priority_tier: PriorityTier;
  price_total_paise: number;
  price_breakdown: Record<string, unknown>;
  status: JobStatus;
  queue_position?: number | undefined;
  enqueued_at?: string | undefined;
  document_expires_at: string;
  created_at: string;
  updated_at?: string | undefined;
}

export interface CreatePrintJobDto {
  shop_id: string;
  customer_id: string;
  printer_id?: string | undefined;
  document_storage_key: string;
  settings: Record<string, unknown>;
  priority_tier?: PriorityTier | undefined;
  price_total_paise: number;
  price_breakdown: Record<string, unknown>;
  document_expires_at?: string | undefined;
}

export interface UpdatePrintJobDto {
  status?: JobStatus | undefined;
  printer_id?: string | undefined;
  enqueued_at?: string | undefined;
  queue_position?: number | undefined;
}
