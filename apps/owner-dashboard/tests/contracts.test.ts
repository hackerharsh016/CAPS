import { describe, it, expect } from 'vitest';
import type { UserProfile as AppProfile, UserRole as AppRole } from '../src/features/auth/types';
import type { Shop as AppShop } from '../src/features/shop-management/types';
import type {
  Shop as SharedShop,
  UserProfile as SharedProfile,
  UserRole as SharedRole
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
});
