/**
 * Mock Shop fixtures for CAPS Customer Web Shop Discovery.
 * Provides realistic campus and local commercial Xerox shops for testing and offline iteration.
 */

import type { Shop } from './types';

export const MOCK_SHOPS: Shop[] = [
  {
    id: 'shop-8888-campus-xerox',
    name: 'Campus Central Xerox & Stationery',
    address: 'Near Library Block, North Campus, University Road',
    landmark: 'Opposite Student Activity Center',
    coordinates: {
      latitude: 19.076,
      longitude: 72.8777
    },
    phone: '+919876500001',
    is_open: true,
    opening_time: '08:00',
    closing_time: '21:30',
    rating: 4.8,
    review_count: 320,
    capabilities: {
      color: true,
      duplex: true,
      paper_sizes: ['A4', 'A3', 'Legal'],
      spiral_binding: true,
      urgent_queue: true
    },
    pricing: {
      bw_per_page_paise: 150, // ₹1.50
      color_per_page_paise: 1000, // ₹10.00
      duplex_discount_paise: 25, // ₹0.25 off on duplex
      spiral_binding_paise: 3500, // ₹35.00
      urgent_surcharge_paise: 2000 // ₹20.00
    }
  },
  {
    id: 'shop-9999-metro-prints',
    name: 'Metro Quick Print & Plotting',
    address: 'Shop 4, Metro Station Gate 2, Link Road',
    landmark: 'Next to Café Coffee Day',
    coordinates: {
      latitude: 19.082,
      longitude: 72.882
    },
    phone: '+919876500002',
    is_open: true,
    opening_time: '09:00',
    closing_time: '22:00',
    rating: 4.6,
    review_count: 185,
    capabilities: {
      color: true,
      duplex: true,
      paper_sizes: ['A4', 'A3', 'Letter'],
      spiral_binding: false,
      urgent_queue: true
    },
    pricing: {
      bw_per_page_paise: 200, // ₹2.00
      color_per_page_paise: 800, // ₹8.00
      spiral_binding_paise: 4000,
      urgent_surcharge_paise: 2500
    }
  },
  {
    id: 'shop-7777-tech-xerox',
    name: 'TechPark Documentation Hub',
    address: 'Sector 5, Behind Engineering Building',
    landmark: 'Near Canteen Gate',
    coordinates: {
      latitude: 19.071,
      longitude: 72.871
    },
    phone: '+919876500003',
    is_open: false, // Closed currently for filter testing
    opening_time: '08:30',
    closing_time: '18:00',
    rating: 4.4,
    review_count: 94,
    capabilities: {
      color: false, // B&W only
      duplex: true,
      paper_sizes: ['A4'],
      spiral_binding: true,
      urgent_queue: false
    },
    pricing: {
      bw_per_page_paise: 120, // ₹1.20
      color_per_page_paise: 0,
      spiral_binding_paise: 3000,
      urgent_surcharge_paise: 0
    }
  },
  {
    id: 'shop-6666-elite-binders',
    name: 'Elite Book Binding & Thesis Prints',
    address: 'Commercial Complex, 1st Floor, University Circle',
    landmark: 'Above Indian Bank',
    coordinates: {
      latitude: 19.09,
      longitude: 72.895
    },
    phone: '+919876500004',
    is_open: true,
    opening_time: '10:00',
    closing_time: '20:00',
    rating: 4.9,
    review_count: 410,
    capabilities: {
      color: true,
      duplex: true,
      paper_sizes: ['A4', 'A3', 'Legal'],
      spiral_binding: true,
      urgent_queue: true
    },
    pricing: {
      bw_per_page_paise: 175,
      color_per_page_paise: 1200,
      spiral_binding_paise: 4500,
      urgent_surcharge_paise: 3000
    }
  },
  {
    id: 'shop-5555-economy-copy',
    name: 'Economy Xerox Corner',
    address: 'Lane 3, Hostel Gate 4, Outer Ring Road',
    landmark: 'Near Tea Stall',
    coordinates: {
      latitude: 19.065,
      longitude: 72.865
    },
    phone: '+919876500005',
    is_open: true,
    opening_time: '07:30',
    closing_time: '23:00',
    rating: 4.2,
    review_count: 76,
    capabilities: {
      color: false,
      duplex: false,
      paper_sizes: ['A4'],
      spiral_binding: false,
      urgent_queue: false
    },
    pricing: {
      bw_per_page_paise: 100, // ₹1.00 budget
      color_per_page_paise: 0,
      spiral_binding_paise: 0,
      urgent_surcharge_paise: 0
    }
  }
];
