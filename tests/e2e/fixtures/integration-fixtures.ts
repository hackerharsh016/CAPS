/**
 * End-to-End Integration Fixtures for CAPS Owner→Cloud→Agent→Spooler Gate &
 * Payment, Privacy and Crash-Recovery E2E Gate (P05-M05-F02 / P07-M03-F02).
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
export const PRINTER_UNREGISTERED_ID = '44444444-4444-4444-4444-444444444499';

export const RAZORPAY_WEBHOOK_SECRET = 'whsec_caps_test_secret_key_mock_001';
export const PILOT_PAIRING_CODE = 'PAIR-CP-789012';

export interface PrinterCapabilities {
  id: string;
  shop_id: string;
  name: string;
  is_online: boolean;
  supported_paper_sizes: ('A4' | 'A3' | 'Legal')[];
  supports_color: boolean;
  supports_duplex: boolean;
}

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
  attempt_count?: number | undefined;
}

export function createE2EFixtures() {
  const now = new Date();

  const printers: PrinterCapabilities[] = [
    {
      id: PRINTER_CANON_BW_ID,
      shop_id: SHOP_ALPHA_ID,
      name: 'Canon imageRUNNER 2525 (B&W)',
      is_online: true,
      supported_paper_sizes: ['A4', 'Legal'],
      supports_color: false,
      supports_duplex: true
    },
    {
      id: PRINTER_HP_COLOR_ID,
      shop_id: SHOP_ALPHA_ID,
      name: 'HP Color LaserJet Pro MFP M479',
      is_online: true,
      supported_paper_sizes: ['A4', 'A3'],
      supports_color: true,
      supports_duplex: true
    }
  ];

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
    updated_at: new Date(now.getTime() - 1000 * 60 * 5).toISOString(),
    attempt_count: 0
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
    updated_at: new Date(now.getTime() - 1000 * 60 * 2).toISOString(),
    attempt_count: 0
  };

  const unpaidJob: E2EPrintJob = {
    id: 'e2e-job-003-unpaid',
    shop_id: SHOP_ALPHA_ID,
    customer_id: CUSTOMER_USER_ID,
    printer_id: PRINTER_CANON_BW_ID,
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
    updated_at: now.toISOString(),
    attempt_count: 0
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
    updated_at: now.toISOString(),
    attempt_count: 0
  };

  // Additional fixtures for P07-M03-F02: Payment, Privacy & Crash Recovery
  const flexibleOldJob: E2EPrintJob = {
    id: 'e2e-job-101-flexible-old',
    shop_id: SHOP_ALPHA_ID,
    customer_id: CUSTOMER_USER_ID,
    printer_id: PRINTER_CANON_BW_ID,
    document_storage_key: 'shops/0001/jobs/e2e-job-101/article.pdf',
    document_name: 'Research_Article_Draft.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'double',
      orientation: 'portrait',
      copies: 1,
      page_range: '1-20'
    },
    priority_tier: 'flexible',
    price_total_paise: 3000,
    status: 'queued',
    payment_status: 'paid',
    enqueued_at: new Date(now.getTime() - 1000 * 60 * 15).toISOString(), // 15 mins ago
    created_at: new Date(now.getTime() - 1000 * 60 * 16).toISOString(),
    updated_at: new Date(now.getTime() - 1000 * 60 * 15).toISOString(),
    attempt_count: 0
  };

  const urgentNewJob: E2EPrintJob = {
    id: 'e2e-job-102-urgent-new',
    shop_id: SHOP_ALPHA_ID,
    customer_id: CUSTOMER_USER_ID,
    printer_id: PRINTER_CANON_BW_ID,
    document_storage_key: 'shops/0001/jobs/e2e-job-102/boarding_pass.pdf',
    document_name: 'Flight_Boarding_Pass.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'single',
      orientation: 'portrait',
      copies: 1,
      page_range: '1-1'
    },
    priority_tier: 'urgent',
    price_total_paise: 500, // Includes urgent surcharge
    status: 'pending_payment',
    payment_status: 'initiated',
    created_at: new Date(now.getTime() - 1000 * 60 * 1).toISOString(), // 1 min ago
    updated_at: new Date(now.getTime() - 1000 * 60 * 1).toISOString(),
    attempt_count: 0
  };

  const colorJobOnBwPrinter: E2EPrintJob = {
    id: 'e2e-job-103-capability-mismatch',
    shop_id: SHOP_ALPHA_ID,
    customer_id: CUSTOMER_USER_ID,
    printer_id: PRINTER_CANON_BW_ID, // Canon BW only!
    document_storage_key: 'shops/0001/jobs/e2e-job-103/poster.pdf',
    document_name: 'Color_Conference_Poster.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'color', // Demands color!
      sides: 'single',
      orientation: 'portrait',
      copies: 1,
      page_range: '1-1'
    },
    priority_tier: 'flexible',
    price_total_paise: 2500,
    status: 'queued',
    payment_status: 'paid',
    enqueued_at: now.toISOString(),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    attempt_count: 0
  };

  const missingPrinterJob: E2EPrintJob = {
    id: 'e2e-job-104-missing-printer',
    shop_id: SHOP_ALPHA_ID,
    customer_id: CUSTOMER_USER_ID,
    printer_id: PRINTER_UNREGISTERED_ID,
    document_storage_key: 'shops/0001/jobs/e2e-job-104/doc.pdf',
    document_name: 'Missing_Printer_Target.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'single',
      orientation: 'portrait',
      copies: 1,
      page_range: '1-1'
    },
    priority_tier: 'flexible',
    price_total_paise: 400,
    status: 'queued',
    payment_status: 'paid',
    enqueued_at: now.toISOString(),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    attempt_count: 0
  };

  const crashRecoveryJob: E2EPrintJob = {
    id: 'e2e-job-105-crash-recovery',
    shop_id: SHOP_ALPHA_ID,
    customer_id: CUSTOMER_USER_ID,
    printer_id: PRINTER_CANON_BW_ID,
    document_storage_key: 'shops/0001/jobs/e2e-job-105/legal_contract.pdf',
    document_name: 'Commercial_Lease_Contract.pdf',
    settings: {
      paper_size: 'Legal',
      color_mode: 'bw',
      sides: 'double',
      orientation: 'portrait',
      copies: 3,
      page_range: '1-12'
    },
    priority_tier: 'urgent',
    price_total_paise: 7200,
    status: 'queued',
    payment_status: 'paid',
    enqueued_at: new Date(now.getTime() - 1000 * 60 * 10).toISOString(),
    approved_at: new Date(now.getTime() - 1000 * 60 * 8).toISOString(),
    created_at: new Date(now.getTime() - 1000 * 60 * 11).toISOString(),
    updated_at: new Date(now.getTime() - 1000 * 60 * 8).toISOString(),
    attempt_count: 0
  };

  // Additional fixtures for P07-M04-F01: Single-Shop Supervised Pilot
  const consentedCustomerJob: E2EPrintJob = {
    id: 'pilot-job-201-consented',
    shop_id: SHOP_ALPHA_ID,
    customer_id: CUSTOMER_USER_ID,
    printer_id: PRINTER_CANON_BW_ID,
    document_storage_key: 'shops/0001/jobs/pilot-job-201/blueprint.pdf',
    document_name: 'Consented_Architectural_Plan.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'double',
      orientation: 'landscape',
      copies: 2,
      page_range: '1-6'
    },
    priority_tier: 'flexible',
    price_total_paise: 1800,
    status: 'pending_payment',
    payment_status: 'initiated',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    attempt_count: 0
  };

  const refundTargetJob: E2EPrintJob = {
    id: 'pilot-job-202-refund-target',
    shop_id: SHOP_ALPHA_ID,
    customer_id: CUSTOMER_USER_ID,
    printer_id: PRINTER_CANON_BW_ID,
    document_storage_key: 'shops/0001/jobs/pilot-job-202/handout.pdf',
    document_name: 'Workshop_Handout_Fault.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'single',
      orientation: 'portrait',
      copies: 5,
      page_range: '1-2'
    },
    priority_tier: 'flexible',
    price_total_paise: 1500,
    status: 'requires_review',
    payment_status: 'paid',
    enqueued_at: new Date(now.getTime() - 1000 * 60 * 20).toISOString(),
    created_at: new Date(now.getTime() - 1000 * 60 * 22).toISOString(),
    updated_at: new Date(now.getTime() - 1000 * 60 * 20).toISOString(),
    attempt_count: 1
  };

  const printerTestPageJob: E2EPrintJob = {
    id: 'pilot-job-203-diagnostic-test-page',
    shop_id: SHOP_ALPHA_ID,
    customer_id: OWNER_ALPHA_USER_ID, // Operator-originated
    printer_id: PRINTER_CANON_BW_ID,
    document_storage_key: 'system/diagnostics/test_page_calibration.pdf',
    document_name: 'CAPS_Printer_Diagnostic_Calibration.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'single',
      orientation: 'portrait',
      copies: 1,
      page_range: '1-1'
    },
    priority_tier: 'urgent',
    price_total_paise: 0, // Free diagnostic
    status: 'queued',
    payment_status: 'paid',
    enqueued_at: now.toISOString(),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    attempt_count: 0
  };

  return {
    printers,
    urgentPaidJob,
    flexiblePayAtCounterJob,
    unpaidJob,
    crossShopJob,
    flexibleOldJob,
    urgentNewJob,
    colorJobOnBwPrinter,
    missingPrinterJob,
    crashRecoveryJob,
    consentedCustomerJob,
    refundTargetJob,
    printerTestPageJob
  };
}
