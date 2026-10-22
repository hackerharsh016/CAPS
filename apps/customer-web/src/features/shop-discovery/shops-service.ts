/**
 * Shops Service for CAPS Customer Web.
 * Handles shop queries, capability filtering, search, distance calculation, and pagination.
 */

import type { Shop, ShopDiscoveryResponse, ShopFilterOptions } from './types';
import { MOCK_SHOPS } from './fixtures';
import { calculateHaversineDistance } from './geo-utils';

export function resolveEndpoint(path: string): string {
  const raw =
    (typeof process !== 'undefined' ? process.env['NEXT_PUBLIC_API_URL'] : '') ||
    'http://localhost:4000';
  const base = raw.replace(/\/+$/, '');
  const cleanPath = path.replace(/^\/+/, '');
  if (base.endsWith('/api/v1')) {
    const subPath = cleanPath.startsWith('api/v1/')
      ? cleanPath.replace(/^api\/v1\//, '')
      : cleanPath === 'api/v1'
      ? ''
      : cleanPath;
    return subPath ? `${base}/${subPath}` : base;
  }
  return `${base}/${cleanPath}`;
}

export function mapCloudShopToCustomerShop(raw: Record<string, any>): Shop {
  const pricing = raw['pricing_config'] || {};
  const a4 = pricing['A4'] || {
    bw_single_paise: 200,
    color_single_paise: 1000,
    bw_double_paise: 350
  };
  const binding = pricing['binding_prices_paise'] || { spiral: 3500 };
  const urgent = raw['urgent_surcharge_config'] || { amount: 2000 };

  return {
    id: raw['id'],
    name: raw['name'],
    address: raw['address'],
    landmark: raw['landmark'] || '',
    coordinates: {
      latitude: raw['geo_lat'] ?? 12.9716,
      longitude: raw['geo_lng'] ?? 77.5946
    },
    phone: raw['phone'] || '+91 98765 43210',
    is_open: raw['status'] === 'open' || raw['is_open'] === true,
    opening_time: raw['opening_time'] || '08:30',
    closing_time: raw['closing_time'] || '21:30',
    rating: raw['rating'] ?? 4.8,
    review_count: raw['review_count'] ?? 124,
    capabilities: {
      color: Boolean(a4['color_single_paise'] && a4['color_single_paise'] > 0),
      duplex: Boolean(a4['bw_double_paise'] && a4['bw_double_paise'] > 0),
      paper_sizes: [
        'A4',
        ...(pricing['A3'] ? (['A3'] as const) : []),
        ...(pricing['Legal'] ? (['Legal'] as const) : [])
      ],
      spiral_binding: Boolean(binding['spiral'] && binding['spiral'] > 0),
      urgent_queue: Boolean(urgent['amount'] && urgent['amount'] > 0)
    },
    pricing: {
      bw_per_page_paise: a4['bw_single_paise'] ?? 200,
      color_per_page_paise: a4['color_single_paise'] ?? 1000,
      duplex_discount_paise: 25,
      spiral_binding_paise: binding['spiral'] ?? 3500,
      urgent_surcharge_paise: urgent['amount'] ?? 2000
    },
    allow_pay_at_counter: raw['allow_pay_at_counter'] ?? true
  };
}

export class ShopsService {
  private shopsStore: Shop[];
  private isOfflineStore: boolean;

  constructor(initialShops?: Shop[], options?: { isOffline?: boolean }) {
    if (initialShops !== undefined) {
      this.shopsStore = [...initialShops];
      this.isOfflineStore = options?.isOffline ?? true;
    } else {
      this.shopsStore = [];
      this.isOfflineStore = options?.isOffline ?? false;
    }
  }

  public setShops(shops: Shop[]): void {
    this.shopsStore = [...shops];
    this.isOfflineStore = true;
  }

  /**
   * Retrieves shops matching the given search and capability filters.
   */
  public async getShops(options: ShopFilterOptions = {}): Promise<ShopDiscoveryResponse> {
    const {
      searchQuery,
      openOnly = false,
      supportsColor = false,
      supportsDuplex = false,
      supportsA3 = false,
      supportsSpiral = false,
      supportsUrgent = false,
      userCoordinates,
      sortBy = userCoordinates ? 'distance' : 'rating',
      page = 1,
      limit = 5
    } = options;

    if (!this.isOfflineStore) {
      try {
        const endpoint = resolveEndpoint('/api/v1/shops');
        const url = new URL(endpoint);
        if (searchQuery && searchQuery.trim()) {
          url.searchParams.set('search', searchQuery.trim());
        }
        if (openOnly) {
          url.searchParams.set('status', 'open');
        }
        url.searchParams.set('limit', '100');

        const res = await fetch(url.toString(), { method: 'GET' });
        if (res.ok) {
          const json = await res.json();
          const rawShops = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
          this.shopsStore = rawShops.map(mapCloudShopToCustomerShop);
        } else if (res.status === 404) {
          this.shopsStore = [];
        }
      } catch {
        // Offline / dev fallback: preserve existing store without injecting mock fixtures
      }
    }

    let filtered = this.shopsStore.map(shop => {
      let distance_meters: number | undefined;
      if (userCoordinates) {
        distance_meters = calculateHaversineDistance(userCoordinates, shop.coordinates);
      }
      return {
        ...shop,
        ...(distance_meters !== undefined ? { distance_meters } : {})
      };
    });

    // 1. Text Search query
    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(
        shop =>
          shop.name.toLowerCase().includes(q) ||
          shop.address.toLowerCase().includes(q) ||
          (shop.landmark && shop.landmark.toLowerCase().includes(q))
      );
    }

    // 2. Open Now filter
    if (openOnly) {
      filtered = filtered.filter(shop => shop.is_open);
    }

    // 3. Capability filters
    if (supportsColor) {
      filtered = filtered.filter(shop => shop.capabilities.color);
    }
    if (supportsDuplex) {
      filtered = filtered.filter(shop => shop.capabilities.duplex);
    }
    if (supportsA3) {
      filtered = filtered.filter(shop => shop.capabilities.paper_sizes.includes('A3'));
    }
    if (supportsSpiral) {
      filtered = filtered.filter(shop => shop.capabilities.spiral_binding);
    }
    if (supportsUrgent) {
      filtered = filtered.filter(shop => shop.capabilities.urgent_queue);
    }

    // 4. Sorting
    if (sortBy === 'distance') {
      filtered.sort((a, b) => (a.distance_meters ?? Infinity) - (b.distance_meters ?? Infinity));
    } else if (sortBy === 'rating') {
      filtered.sort((a, b) => b.rating - a.rating);
    } else if (sortBy === 'name') {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    }

    // 5. Pagination
    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (safePage - 1) * limit;
    const paginated = filtered.slice(startIndex, startIndex + limit);

    return {
      shops: paginated,
      page: safePage,
      limit,
      totalCount,
      totalPages,
      hasMore: safePage < totalPages
    };
  }

  /**
   * Retrieves single shop by ID.
   */
  public async getShopById(shopId: string): Promise<Shop | null> {
    if (!this.isOfflineStore) {
      try {
        const endpoint = resolveEndpoint(`/api/v1/shops/${shopId}`);
        const res = await fetch(endpoint, { method: 'GET' });
        if (res.ok) {
          const json = await res.json();
          const rawShop = json.data || json;
          if (rawShop && rawShop.id) {
            const mapped = mapCloudShopToCustomerShop(rawShop);
            const idx = this.shopsStore.findIndex(s => s.id === shopId);
            if (idx >= 0) {
              this.shopsStore[idx] = mapped;
            } else {
              this.shopsStore.push(mapped);
            }
            return mapped;
          }
        } else if (res.status === 404) {
          return null;
        }
      } catch {
        // Offline fallback: check cached / injected store
      }
    }

    return this.shopsStore.find(s => s.id === shopId) ?? null;
  }
}

const isTestEnv =
  typeof process !== 'undefined' &&
  (process.env['NODE_ENV'] === 'test' || Boolean(process.env['VITEST']));

export const defaultShopsService = new ShopsService(isTestEnv ? MOCK_SHOPS : undefined);
