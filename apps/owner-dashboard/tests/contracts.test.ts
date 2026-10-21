import { describe, it, expect } from 'vitest';
import type { UserProfile as AppProfile, UserRole as AppRole } from '../src/features/auth/types';
import type { Shop as AppShop } from '../src/features/shop-management/types';
import type {
  PrintJob as AppPrintJob,
  JobStatus as AppJobStatus,
  PriorityTier as AppPriorityTier
} from '../src/features/live-queue/types';
import type {
  Shop as SharedShop,
  UserProfile as SharedProfile,
  UserRole as SharedRole,
  PrintJob as SharedPrintJob,
  JobStatus as SharedJobStatus,
  PriorityTier as SharedPriorityTier
} from '../../../packages/types/src/index';

describe('Frozen Domain Contracts Alignment', () => {
  it('verifies UserRole alignment with shared packages/types', () => {
    const appRoleOwner: AppRole = 'shop_owner';
    const sharedRoleOwner: SharedRole = appRoleOwner;
    expect(sharedRoleOwner).toBe('shop_owner');

    const appRoleAdmin: AppRole = 'admin';
    const sharedRoleAdmin: SharedRole = appRoleAdmin;
    expect(sharedRoleAdmin).toBe('admin');

    const appRoleCustomer: AppRole = 'customer';
    const sharedRoleCustomer: SharedRole = appRoleCustomer;
    expect(sharedRoleCustomer).toBe('customer');
  });

  it('verifies UserProfile contract conformance', () => {
    const profile: AppProfile = {
      id: '00000000-0000-0000-0000-000000000001',
      role: 'shop_owner',
      name: 'Owner Name',
      phone: '+919876543210',
      email: 'owner@example.com',
      created_at: new Date().toISOString()
    };

    const sharedProfile: SharedProfile = {
      id: profile.id,
      role: profile.role,
      name: profile.name,
      phone: profile.phone,
      created_at: profile.created_at
    };
    if (profile.email) {
      sharedProfile.email = profile.email;
    }

    expect(sharedProfile.role).toBe('shop_owner');
    expect(sharedProfile.name).toBe('Owner Name');
    expect(sharedProfile.email).toBe('owner@example.com');
  });

  it('verifies Shop schema contract conformance', () => {
    const shop: AppShop = {
      id: '00000000-0000-0000-0000-000000000001',
      owner_id: '00000000-0000-0000-0000-000000000002',
      name: 'Campus Xerox',
      address: '12 University Road',
      geo_lat: 28.7,
      geo_lng: 77.1,
      status: 'open',
      pricing_config: {
        A4: {
          bw_single_paise: 200,
          bw_double_paise: 300,
          color_single_paise: 1000,
          color_double_paise: 1800
        },
        A3: {
          bw_single_paise: 400,
          bw_double_paise: 600,
          color_single_paise: 2000,
          color_double_paise: 3600
        },
        Legal: {
          bw_single_paise: 250,
          bw_double_paise: 350,
          color_single_paise: 1200,
          color_double_paise: 2000
        },
        binding_prices_paise: {
          none: 0,
          spiral: 4000,
          staple: 500,
          lamination: 2000
        },
        gst_percentage: 18
      },
      urgent_surcharge_config: {
        type: 'flat',
        amount: 2000,
        max_urgent_jobs_per_hour: 5
      },
      auto_print_enabled: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const sharedShop: SharedShop = {
      id: shop.id,
      owner_id: shop.owner_id,
      name: shop.name,
      address: shop.address,
      geo_lat: shop.geo_lat,
      geo_lng: shop.geo_lng,
      status: shop.status,
      pricing_config: shop.pricing_config,
      urgent_surcharge_config: {
        type: shop.urgent_surcharge_config.type,
        amount: shop.urgent_surcharge_config.amount,
        max_urgent_jobs_per_hour: shop.urgent_surcharge_config.max_urgent_jobs_per_hour ?? 5
      },
      auto_print_enabled: shop.auto_print_enabled,
      created_at: shop.created_at,
      updated_at: shop.updated_at
    };

    expect(sharedShop.id).toBe(shop.id);
    expect(sharedShop.pricing_config.A4.bw_single_paise).toBe(200);
    expect(sharedShop.urgent_surcharge_config.amount).toBe(2000);
  });

  it('verifies PrintJob, JobStatus, and PriorityTier contract conformance', () => {
    const urgentTier: AppPriorityTier = 'urgent';
    const sharedTier: SharedPriorityTier = urgentTier;
    expect(sharedTier).toBe('urgent');

    const statusPrinting: AppJobStatus = 'printing';
    const sharedStatus: SharedJobStatus = statusPrinting;
    expect(sharedStatus).toBe('printing');

    const job: AppPrintJob = {
      id: '00000000-0000-0000-0000-000000001049',
      shop_id: '00000000-0000-0000-0000-000000000001',
      customer_id: 'cust-uuid-1',
      document_storage_key: 'shops/0001/doc.pdf',
      settings: {
        paper_size: 'A4',
        color_mode: 'bw',
        sides: 'double',
        orientation: 'portrait',
        copies: 2,
        page_range: '1-18',
        binding: 'spiral'
      },
      priority_tier: 'urgent',
      price_total_paise: 7200,
      price_breakdown: {
        base_pages_paise: 5400,
        color_surcharge_paise: 0,
        duplex_discount_paise: 1200,
        binding_fee_paise: 4000,
        urgent_surcharge_paise: 2000,
        subtotal_paise: 6200,
        gst_paise: 1000,
        total_paise: 7200
      },
      status: 'printing',
      queue_position: 0,
      enqueued_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const sharedJob: SharedPrintJob = {
      id: job.id,
      shop_id: job.shop_id,
      customer_id: job.customer_id,
      document_storage_key: job.document_storage_key,
      settings: job.settings,
      priority_tier: job.priority_tier,
      price_total_paise: job.price_total_paise,
      price_breakdown: job.price_breakdown,
      status: job.status,
      queue_position: job.queue_position ?? 0,
      enqueued_at: job.enqueued_at ?? new Date().toISOString(),
      document_expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: job.created_at,
      updated_at: job.updated_at
    };

    expect(sharedJob.id).toBe(job.id);
    expect(sharedJob.status).toBe('printing');
    expect(sharedJob.priority_tier).toBe('urgent');
  });
});
