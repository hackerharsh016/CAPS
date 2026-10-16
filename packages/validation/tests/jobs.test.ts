import { describe, it, expect } from 'vitest';
import { CreatePrintJobSchema, PriorityTierSchema, JobStatusSchema } from '../src/jobs.schema.js';

describe('Job Schemas Validation', () => {
  const validCreatePayload = {
    shop_id: '123e4567-e89b-12d3-a456-426614174000',
    customer_id: '223e4567-e89b-12d3-a456-426614174001',
    document_storage_key: 'uploads/2026/10/invoice_1092.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'single',
      orientation: 'portrait',
      copies: 1,
      page_range: 'all',
      binding: 'none'
    },
    priority_tier: 'flexible'
  };

  it('accepts valid CreatePrintJob payload', () => {
    const res = CreatePrintJobSchema.safeParse(validCreatePayload);
    expect(res.success).toBe(true);
  });

  it('accepts Urgent priority tier', () => {
    const res = CreatePrintJobSchema.safeParse({
      ...validCreatePayload,
      priority_tier: 'urgent'
    });
    expect(res.success).toBe(true);
  });

  it('rejects invalid priority tier', () => {
    const res = PriorityTierSchema.safeParse('instant');
    expect(res.success).toBe(false);
  });

  it('rejects invalid non-UUID identifiers', () => {
    const res = CreatePrintJobSchema.safeParse({
      ...validCreatePayload,
      shop_id: 'not-a-uuid'
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.errors[0]?.message).toMatch(/Invalid shop_id UUID/);
    }
  });

  it('rejects unknown properties in CreatePrintJob', () => {
    const res = CreatePrintJobSchema.safeParse({
      ...validCreatePayload,
      rogue_field: 'should-fail'
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.errors[0]?.message).toMatch(/Unrecognized properties are forbidden/);
    }
  });

  it('validates all lifecycle JobStatus values', () => {
    const statuses = [
      'pending_payment',
      'queued',
      'approved',
      'claimed',
      'downloading',
      'printing',
      'completed',
      'failed',
      'cancelled',
      'requires_review'
    ];

    for (const status of statuses) {
      expect(JobStatusSchema.safeParse(status).success).toBe(true);
    }

    expect(JobStatusSchema.safeParse('unknown_status').success).toBe(false);
  });
});
