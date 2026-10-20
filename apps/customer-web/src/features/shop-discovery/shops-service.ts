/**
 * Shops Service for CAPS Customer Web.
 * Handles shop queries, capability filtering, search, distance calculation, and pagination.
 */

import type { Shop, ShopDiscoveryResponse, ShopFilterOptions } from './types';
import { MOCK_SHOPS } from './fixtures';
import { calculateHaversineDistance } from './geo-utils';

export class ShopsService {
  private shopsStore: Shop[];

  constructor(initialShops: Shop[] = MOCK_SHOPS) {
    this.shopsStore = [...initialShops];
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
    return this.shopsStore.find(s => s.id === shopId) ?? null;
  }
}

export const defaultShopsService = new ShopsService();
