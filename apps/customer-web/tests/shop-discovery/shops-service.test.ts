import { describe, it, expect, beforeEach } from 'vitest';
import { ShopsService } from '../../src/features/shop-discovery/shops-service';
import { MOCK_SHOPS } from '../../src/features/shop-discovery/fixtures';
import type { Coordinates } from '../../src/features/shop-discovery/types';

describe('ShopsService', () => {
  let service: ShopsService;

  beforeEach(() => {
    service = new ShopsService(MOCK_SHOPS);
  });

  describe('Search Query Filtering', () => {
    it('filters shops by name case-insensitively', async () => {
      const res = await service.getShops({ searchQuery: 'campus' });
      expect(res.shops.length).toBe(1);
      expect(res.shops[0]?.name).toBe('Campus Central Xerox & Stationery');
    });

    it('filters shops by address substring', async () => {
      const res = await service.getShops({ searchQuery: 'Link Road' });
      expect(res.shops.length).toBe(1);
      expect(res.shops[0]?.id).toBe('shop-9999-metro-prints');
    });

    it('filters shops by landmark substring', async () => {
      const res = await service.getShops({ searchQuery: 'Tea Stall' });
      expect(res.shops.length).toBe(1);
      expect(res.shops[0]?.id).toBe('shop-5555-economy-copy');
    });

    it('returns empty array when search query matches nothing', async () => {
      const res = await service.getShops({ searchQuery: 'NonExistentPlaceXYZ' });
      expect(res.shops.length).toBe(0);
      expect(res.totalCount).toBe(0);
      expect(res.totalPages).toBe(1);
    });
  });

  describe('Open Status Filtering', () => {
    it('returns only open shops when openOnly is true', async () => {
      const res = await service.getShops({ openOnly: true });
      expect(res.shops.every((s) => s.is_open)).toBe(true);
      // 'shop-7777-tech-xerox' is closed
      const closedShop = res.shops.find((s) => s.id === 'shop-7777-tech-xerox');
      expect(closedShop).toBeUndefined();
    });

    it('includes closed shops when openOnly is false', async () => {
      const res = await service.getShops({ openOnly: false, limit: 10 });
      const closedShop = res.shops.find((s) => s.id === 'shop-7777-tech-xerox');
      expect(closedShop).toBeDefined();
    });
  });

  describe('Capability Filtering', () => {
    it('filters shops by color printing capability', async () => {
      const res = await service.getShops({ supportsColor: true, limit: 10 });
      expect(res.shops.length).toBeGreaterThan(0);
      expect(res.shops.every((s) => s.capabilities.color)).toBe(true);
    });

    it('filters shops by duplex printing capability', async () => {
      const res = await service.getShops({ supportsDuplex: true, limit: 10 });
      expect(res.shops.length).toBeGreaterThan(0);
      expect(res.shops.every((s) => s.capabilities.duplex)).toBe(true);
    });

    it('filters shops by A3 paper capability', async () => {
      const res = await service.getShops({ supportsA3: true, limit: 10 });
      expect(res.shops.length).toBeGreaterThan(0);
      expect(res.shops.every((s) => s.capabilities.paper_sizes.includes('A3'))).toBe(true);
    });

    it('filters shops by spiral binding capability', async () => {
      const res = await service.getShops({ supportsSpiral: true, limit: 10 });
      expect(res.shops.length).toBeGreaterThan(0);
      expect(res.shops.every((s) => s.capabilities.spiral_binding)).toBe(true);
    });

    it('filters shops by urgent queue capability', async () => {
      const res = await service.getShops({ supportsUrgent: true, limit: 10 });
      expect(res.shops.length).toBeGreaterThan(0);
      expect(res.shops.every((s) => s.capabilities.urgent_queue)).toBe(true);
    });

    it('filters shops with multiple simultaneous capability constraints', async () => {
      const res = await service.getShops({
        supportsColor: true,
        supportsSpiral: true,
        supportsA3: true,
        limit: 10
      });
      expect(res.shops.every((s) =>
        s.capabilities.color &&
        s.capabilities.spiral_binding &&
        s.capabilities.paper_sizes.includes('A3')
      )).toBe(true);
    });
  });

  describe('Sorting and Geolocation Distance', () => {
    const userLocation: Coordinates = { latitude: 19.076, longitude: 72.8777 }; // Near shop-8888-campus-xerox

    it('calculates distance_meters when user coordinates are provided', async () => {
      const res = await service.getShops({ userCoordinates: userLocation });
      expect(res.shops.length).toBeGreaterThan(0);
      for (const shop of res.shops) {
        expect(typeof shop.distance_meters).toBe('number');
      }
      // Nearest shop to userLocation should be shop-8888-campus-xerox (0 meters)
      expect(res.shops[0]?.id).toBe('shop-8888-campus-xerox');
      expect(res.shops[0]?.distance_meters).toBe(0);
    });

    it('sorts shops by distance ascending by default when userCoordinates are present', async () => {
      const res = await service.getShops({ userCoordinates: userLocation, limit: 10 });
      for (let i = 0; i < res.shops.length - 1; i++) {
        const cur = res.shops[i]?.distance_meters ?? Infinity;
        const nxt = res.shops[i + 1]?.distance_meters ?? Infinity;
        expect(cur).toBeLessThanOrEqual(nxt);
      }
    });

    it('sorts shops by rating descending', async () => {
      const res = await service.getShops({ sortBy: 'rating', limit: 10 });
      for (let i = 0; i < res.shops.length - 1; i++) {
        const cur = res.shops[i]?.rating ?? 0;
        const nxt = res.shops[i + 1]?.rating ?? 0;
        expect(cur).toBeGreaterThanOrEqual(nxt);
      }
    });

    it('sorts shops by name alphabetically', async () => {
      const res = await service.getShops({ sortBy: 'name', limit: 10 });
      for (let i = 0; i < res.shops.length - 1; i++) {
        const cur = res.shops[i]?.name ?? '';
        const nxt = res.shops[i + 1]?.name ?? '';
        expect(cur.localeCompare(nxt)).toBeLessThanOrEqual(0);
      }
    });
  });

  describe('Pagination', () => {
    it('paginates results according to page and limit', async () => {
      const page1 = await service.getShops({ page: 1, limit: 2 });
      expect(page1.shops.length).toBe(2);
      expect(page1.page).toBe(1);
      expect(page1.hasMore).toBe(true);

      const page2 = await service.getShops({ page: 2, limit: 2 });
      expect(page2.shops.length).toBe(2);
      expect(page2.page).toBe(2);
      expect(page2.shops[0]?.id).not.toBe(page1.shops[0]?.id);

      const page3 = await service.getShops({ page: 3, limit: 2 });
      expect(page3.shops.length).toBe(1);
      expect(page3.page).toBe(3);
      expect(page3.hasMore).toBe(false);
    });
  });

  describe('getShopById', () => {
    it('retrieves an existing shop by ID', async () => {
      const shop = await service.getShopById('shop-8888-campus-xerox');
      expect(shop).not.toBeNull();
      expect(shop?.name).toBe('Campus Central Xerox & Stationery');
    });

    it('returns null for a non-existent shop ID', async () => {
      const shop = await service.getShopById('shop-non-existent-999');
      expect(shop).toBeNull();
    });
  });
});
