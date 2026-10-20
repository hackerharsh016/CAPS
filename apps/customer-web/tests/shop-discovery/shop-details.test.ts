import { describe, it, expect } from 'vitest';
import {
  getShopServiceCatalog,
  getCategoryMetadata
} from '../../src/features/shop-discovery/catalog-utils';
import { ShopsService } from '../../src/features/shop-discovery/shops-service';
import { MOCK_SHOPS } from '../../src/features/shop-discovery/fixtures';
import type { Shop } from '../../src/features/shop-discovery/types';

describe('Shop Details & Service Catalog (P04-M02-F02)', () => {
  const fullFeaturedShop: Shop = {
    id: 'shop-full-featured',
    name: 'Omni Print & Plotting Supercenter',
    address: 'Building 1, Campus Plaza',
    coordinates: { latitude: 19.076, longitude: 72.8777 },
    phone: '+919876543210',
    is_open: true,
    opening_time: '08:00',
    closing_time: '22:00',
    rating: 4.9,
    review_count: 500,
    capabilities: {
      color: true,
      duplex: true,
      paper_sizes: ['A4', 'A3', 'Legal', 'Letter'],
      spiral_binding: true,
      urgent_queue: true
    },
    pricing: {
      bw_per_page_paise: 150,
      color_per_page_paise: 800,
      duplex_discount_paise: 25,
      spiral_binding_paise: 3000,
      urgent_surcharge_paise: 2000
    }
  };

  const restrictedClosedShop: Shop = {
    id: 'shop-restricted-closed',
    name: 'Basic Budget B&W Corner',
    address: 'Hostel Block C Basement',
    coordinates: { latitude: 19.071, longitude: 72.871 },
    phone: '+919876543211',
    is_open: false, // Closed
    opening_time: '09:00',
    closing_time: '17:00',
    rating: 4.1,
    review_count: 45,
    capabilities: {
      color: false, // Unsupported
      duplex: false, // Unsupported
      paper_sizes: ['A4'], // No A3
      spiral_binding: false, // Unsupported
      urgent_queue: false // Unsupported
    },
    pricing: {
      bw_per_page_paise: 100,
      color_per_page_paise: 0,
      spiral_binding_paise: 0,
      urgent_surcharge_paise: 0
    }
  };

  describe('Service Catalog Generation', () => {
    it('generates all standard catalog services for a full-featured shop', () => {
      const catalog = getShopServiceCatalog(fullFeaturedShop);
      expect(catalog.length).toBe(6);

      const bw = catalog.find((i) => i.id === 'bw-standard');
      expect(bw?.isAvailable).toBe(true);
      expect(bw?.priceFormatted).toContain('₹1.50');

      const color = catalog.find((i) => i.id === 'color-standard');
      expect(color?.isAvailable).toBe(true);
      expect(color?.priceFormatted).toContain('₹8.00');

      const duplex = catalog.find((i) => i.id === 'duplex-print');
      expect(duplex?.isAvailable).toBe(true);
      expect(duplex?.priceFormatted).toContain('Saves ₹0.25');

      const a3 = catalog.find((i) => i.id === 'a3-large-format');
      expect(a3?.isAvailable).toBe(true);
      expect(a3?.priceFormatted).toContain('₹3.00');

      const spiral = catalog.find((i) => i.id === 'spiral-binding');
      expect(spiral?.isAvailable).toBe(true);
      expect(spiral?.priceFormatted).toContain('₹30.00');

      const urgent = catalog.find((i) => i.id === 'urgent-priority');
      expect(urgent?.isAvailable).toBe(true);
      expect(urgent?.priceFormatted).toContain('₹20.00');
    });

    it('clearly marks unsupported capabilities with explicit unavailability reasons', () => {
      const catalog = getShopServiceCatalog(restrictedClosedShop);

      // Color unsupported
      const color = catalog.find((i) => i.id === 'color-standard');
      expect(color?.isAvailable).toBe(false);
      expect(color?.priceFormatted).toBe('Not Offered');
      expect(color?.unavailabilityReason).toBe(
        'Color laser printing is not available at this shop location.'
      );

      // Duplex unsupported
      const duplex = catalog.find((i) => i.id === 'duplex-print');
      expect(duplex?.isAvailable).toBe(false);
      expect(duplex?.priceFormatted).toBe('Not Available');
      expect(duplex?.unavailabilityReason).toBe(
        "Automatic duplex printing hardware is not installed on this shop's printers."
      );

      // A3 unsupported
      const a3 = catalog.find((i) => i.id === 'a3-large-format');
      expect(a3?.isAvailable).toBe(false);
      expect(a3?.priceFormatted).toBe('Not Supported');
      expect(a3?.unavailabilityReason).toBe(
        "A3 paper tray is not configured on this shop's active printers."
      );

      // Spiral binding unsupported
      const spiral = catalog.find((i) => i.id === 'spiral-binding');
      expect(spiral?.isAvailable).toBe(false);
      expect(spiral?.priceFormatted).toBe('Not Offered');
      expect(spiral?.unavailabilityReason).toBe(
        'Spiral binding machine is not available at this shop location.'
      );

      // Urgent queue disabled
      const urgent = catalog.find((i) => i.id === 'urgent-priority');
      expect(urgent?.isAvailable).toBe(false);
      expect(urgent?.priceFormatted).toBe('Disabled');
      expect(urgent?.unavailabilityReason).toBe(
        'Express priority queue is currently disabled by the shop owner.'
      );
    });
  });

  describe('Category Metadata & Organization', () => {
    it('returns valid titles and icons across all catalog categories', () => {
      expect(getCategoryMetadata('print')).toEqual({ label: 'Printing Options', icon: '🖨️' });
      expect(getCategoryMetadata('paper')).toEqual({ label: 'Paper Sizes', icon: '📐' });
      expect(getCategoryMetadata('binding')).toEqual({ label: 'Finishing & Binding', icon: '🌀' });
      expect(getCategoryMetadata('priority')).toEqual({ label: 'Queue & Priority Tiers', icon: '⚡' });
    });
  });

  describe('Closed Shop & Stale Detection', () => {
    it('accurately identifies closed shops and preserves operating hours', () => {
      expect(restrictedClosedShop.is_open).toBe(false);
      expect(restrictedClosedShop.opening_time).toBe('09:00');
      expect(restrictedClosedShop.closing_time).toBe('17:00');
    });

    it('identifies closed shops within the standard mock fixture store', async () => {
      const service = new ShopsService(MOCK_SHOPS);
      const techShop = await service.getShopById('shop-7777-tech-xerox');
      expect(techShop).not.toBeNull();
      expect(techShop?.is_open).toBe(false);
      expect(techShop?.opening_time).toBe('08:30');
      expect(techShop?.closing_time).toBe('18:00');
    });
  });

  describe('Shop Details Querying & Error Recovery', () => {
    const service = new ShopsService(MOCK_SHOPS);

    it('retrieves detailed shop profile by ID', async () => {
      const shop = await service.getShopById('shop-8888-campus-xerox');
      expect(shop).not.toBeNull();
      expect(shop?.name).toBe('Campus Central Xerox & Stationery');
      expect(shop?.capabilities.color).toBe(true);
      expect(shop?.capabilities.spiral_binding).toBe(true);
      expect(shop?.pricing.bw_per_page_paise).toBe(150);
    });

    it('returns null when querying an unknown or non-existent shop ID', async () => {
      const missing = await service.getShopById('unknown-shop-id-999');
      expect(missing).toBeNull();
    });

    it('handles service errors without unhandled exceptions', async () => {
      const emptyService = new ShopsService([]);
      const result = await emptyService.getShopById('any-id');
      expect(result).toBeNull();
    });
  });
});
