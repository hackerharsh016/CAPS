/**
 * Contract-compliant mock orders for independent customer-web development and tests.
 * Follows CAPS OpenAPI and database schemas with multiple tenant/customer IDs.
 */

import type { CustomerOrder } from './types';

export const MOCK_ORDERS: CustomerOrder[] = [
  {
    id: 'job-101e4567-e89b-12d3-a456-426614174001',
    token_number: 'T-001',
    customer_id: 'usr-customer-alpha',
    shop_id: 'shop-8888-campus-xerox',
    shop_name: 'Campus Xerox & Stationary',
    document_name: 'Semester_Project_Report_v2.pdf',
    file_size_bytes: 2450000,
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      duplex: true,
      copies: 2,
      orientation: 'portrait',
      pages_per_copy: 24,
      total_pages: 48,
      spiral_binding: true
    },
    priority_tier: 'urgent',
    amount_paise: 18500, // ₹185.00
    status: 'printing',
    payment_status: 'paid',
    document_deleted: false,
    created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString()
  },
  {
    id: 'job-101e4567-e89b-12d3-a456-426614174002',
    token_number: 'T-004',
    customer_id: 'usr-customer-alpha',
    shop_id: 'shop-8888-campus-xerox',
    shop_name: 'Campus Xerox & Stationary',
    document_name: 'Lab_Manual_Week_4.pdf',
    file_size_bytes: 840000,
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      duplex: false,
      copies: 1,
      orientation: 'portrait',
      pages_per_copy: 8,
      total_pages: 8,
      spiral_binding: false
    },
    priority_tier: 'flexible',
    amount_paise: 1600, // ₹16.00
    status: 'queued',
    payment_status: 'paid',
    document_deleted: false,
    created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString()
  },
  {
    id: 'job-101e4567-e89b-12d3-a456-426614174003',
    token_number: 'T-098',
    customer_id: 'usr-customer-alpha',
    shop_id: 'shop-9999-metro-prints',
    shop_name: 'Metro Quick Print',
    document_name: 'Resume_Engineering_Final.pdf',
    file_size_bytes: 350000,
    settings: {
      paper_size: 'A4',
      color_mode: 'color',
      duplex: false,
      copies: 5,
      orientation: 'portrait',
      pages_per_copy: 2,
      total_pages: 10,
      spiral_binding: false
    },
    priority_tier: 'flexible',
    amount_paise: 10000, // ₹100.00
    status: 'completed',
    payment_status: 'paid',
    document_deleted: true, // File destroyed post print
    created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 23 * 3600 * 1000).toISOString()
  },
  {
    id: 'job-101e4567-e89b-12d3-a456-426614174004',
    token_number: 'T-055',
    customer_id: 'usr-customer-alpha',
    shop_id: 'shop-8888-campus-xerox',
    shop_name: 'Campus Xerox & Stationary',
    document_name: 'Lecture_Notes_Unit_1_to_3.pdf',
    file_size_bytes: 4200000,
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      duplex: true,
      copies: 1,
      orientation: 'portrait',
      pages_per_copy: 60,
      total_pages: 60,
      spiral_binding: true
    },
    priority_tier: 'flexible',
    amount_paise: 11000, // ₹110.00
    status: 'completed',
    payment_status: 'paid',
    document_deleted: true,
    created_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 3 * 24 * 3600 * 1000 + 1800000).toISOString()
  },
  {
    id: 'job-101e4567-e89b-12d3-a456-426614174005',
    token_number: 'T-012',
    customer_id: 'usr-customer-alpha',
    shop_id: 'shop-8888-campus-xerox',
    shop_name: 'Campus Xerox & Stationary',
    document_name: 'Corrupted_Scan.pdf',
    file_size_bytes: 150000,
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      duplex: false,
      copies: 1,
      orientation: 'portrait',
      pages_per_copy: 1,
      total_pages: 1,
      spiral_binding: false
    },
    priority_tier: 'flexible',
    amount_paise: 200,
    status: 'failed',
    payment_status: 'refunded',
    document_deleted: true,
    created_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString()
  },
  // Multi-tenant isolation test fixture: Belongs to ANOTHER customer!
  {
    id: 'job-999e4567-e89b-12d3-a456-426614174999',
    token_number: 'T-888',
    customer_id: 'usr-customer-BETA-ANOTHER-TENANT',
    shop_id: 'shop-8888-campus-xerox',
    shop_name: 'Campus Xerox & Stationary',
    document_name: 'Confidential_Financials_Customer_Beta.pdf',
    file_size_bytes: 5000000,
    settings: {
      paper_size: 'A4',
      color_mode: 'color',
      duplex: true,
      copies: 10,
      orientation: 'portrait',
      pages_per_copy: 10,
      total_pages: 100,
      spiral_binding: false
    },
    priority_tier: 'urgent',
    amount_paise: 95000,
    status: 'completed',
    payment_status: 'paid',
    document_deleted: true,
    created_at: new Date(Date.now() - 3600 * 1000).toISOString()
  }
];
