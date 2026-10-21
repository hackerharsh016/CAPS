/**
 * End-to-End Integration Fixtures for CAPS Owner→Cloud→Agent→Spooler Gate (P05-M05-F02).
 * Contract-first mocks and domain objects mirroring Supabase Migrations 001-011.
 */

export const SHOP_ALPHA_ID = '00000000-0000-0000-0000-000000000001';
export const SHOP_BETA_ID = '00000000-0000-0000-0000-000000000002'; // For cross-shop tenant rejection

export const CUSTOMER_USER_ID = '11111111-1111-1111-1111-111111111101';
export const OWNER_ALPHA_USER_ID = '22222222-2222-2222-2222-222222222201';
export const OWNER_BETA_USER_ID = '22222222-2222-2222-2222-222222222202'; // Attacker / foreign owner

export const AGENT_ALPHA_DEVICE_ID = '33333333-3333-3333-3333-333333333301';
export const AGENT_BETA_DEVICE_ID = '33333333-3333-3333-3333-333333333302'; // Paired to Shop Beta

export const PRINTER_CANON_BW_ID = '44444444-4444-4444-4444-444444444401';
export const PRINTER_HP_COLOR_ID = '44444444-4444-4444-4444-444444444402';

export interface E2EPrintJob {
  id: string;
  shop_id: string;
  customer_id: string;
  printer_id?: string | undefined;
  document_storage_key: string;
  document_name: string;
  settings: {
    paper_size: 'A4' | 'A3' | 'Legal';
    color_mode: 'bw' | 'color';
    sides: 'single' | 'double';
    orientation: 'portrait' | 'landscape';
    copies: number;
    page_range: string;
  };
  priority_tier: 'urgent' | 'flexible';
  price_total_paise: number;
  status:
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
  payment_status: 'initiated' | 'paid' | 'pay_at_counter_pending' | 'refunded' | 'failed';
  enqueued_at?: string | undefined;
  approved_at?: string | undefined;
  completed_at?: string | undefined;
  created_at: string;
  updated_at: string;
}

export function createE2EFixtures() {
  const now = new Date();

  const urgentPaidJob: E2EPrintJob = {
    id: 'e2e-job-001-urgent-paid',
    shop_id: SHOP_ALPHA_ID,
    customer_id: CUSTOMER_USER_ID,
    printer_id: PRINTER_CANON_BW_ID,
    document_storage_key: 'shops/0001/jobs/e2e-job-001/thesis.pdf',
    document_name: 'CS_Thesis_Final_Bound.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'double',
      orientation: 'portrait',
      copies: 1,
      page_range: '1-10'
    },
    priority_tier: 'urgent',
    price_total_paise: 3500, // ₹35.00
    status: 'queued',
    payment_status: 'paid',
    enqueued_at: new Date(now.getTime() - 1000 * 60 * 5).toISOString(),
    created_at: new Date(now.getTime() - 1000 * 60 * 6).toISOString(),
    updated_at: new Date(now.getTime() - 1000 * 60 * 5).toISOString()
  };

  const flexiblePayAtCounterJob: E2EPrintJob = {
    id: 'e2e-job-002-counter',
    shop_id: SHOP_ALPHA_ID,
    customer_id: CUSTOMER_USER_ID,
    printer_id: PRINTER_CANON_BW_ID,
    document_storage_key: 'shops/0001/jobs/e2e-job-002/slides.pdf',
    document_name: 'Seminar_Slides.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'single',
      orientation: 'portrait',
      copies: 2,
      page_range: '1-4'
    },
    priority_tier: 'flexible',
    price_total_paise: 1600, // ₹16.00
    status: 'queued',
    payment_status: 'pay_at_counter_pending',
    enqueued_at: new Date(now.getTime() - 1000 * 60 * 2).toISOString(),
    created_at: new Date(now.getTime() - 1000 * 60 * 3).toISOString(),
    updated_at: new Date(now.getTime() - 1000 * 60 * 2).toISOString()
  };

  const unpaidJob: E2EPrintJob = {
    id: 'e2e-job-003-unpaid',
    shop_id: SHOP_ALPHA_ID,
    customer_id: CUSTOMER_USER_ID,
    document_storage_key: 'shops/0001/jobs/e2e-job-003/unpaid.pdf',
    document_name: 'Draft_Document.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'single',
      orientation: 'portrait',
      copies: 1,
      page_range: '1-1'
    },
    priority_tier: 'flexible',
    price_total_paise: 200,
    status: 'pending_payment',
    payment_status: 'initiated',
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };

  const crossShopJob: E2EPrintJob = {
    id: 'e2e-job-099-cross-shop',
    shop_id: SHOP_BETA_ID,
    customer_id: CUSTOMER_USER_ID,
    printer_id: PRINTER_HP_COLOR_ID,
    document_storage_key: 'shops/0002/jobs/e2e-job-099/confidential.pdf',
    document_name: 'Beta_Shop_Confidential.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'color',
      sides: 'single',
      orientation: 'portrait',
      copies: 1,
      page_range: '1-3'
    },
    priority_tier: 'urgent',
    price_total_paise: 4500,
    status: 'queued',
    payment_status: 'paid',
    enqueued_at: now.toISOString(),
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };

  return {
    urgentPaidJob,
    flexiblePayAtCounterJob,
    unpaidJob,
    crossShopJob
  };
}
