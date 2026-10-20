/**
 * Shop Discovery domain types for CAPS Customer Web.
 * Conforms to CAPS SRS Section 4.1 & 7.2 and Master Implementation Plan Section 3 & 5.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface ShopCapabilities {
  color: boolean;
  duplex: boolean;
  paper_sizes: ('A4' | 'A3' | 'Legal' | 'Letter')[];
  spiral_binding: boolean;
  urgent_queue: boolean;
}

export interface ShopPricingSummary {
  bw_per_page_paise: number; // e.g. 150 = ₹1.50
  color_per_page_paise: number; // e.g. 1000 = ₹10.00
  duplex_discount_paise?: number | undefined;
  spiral_binding_paise: number; // e.g. 3500 = ₹35.00
  urgent_surcharge_paise: number; // e.g. 2000 = ₹20.00
}

export interface Shop {
  id: string; // UUID
  name: string;
  address: string;
  landmark?: string | undefined;
  coordinates: Coordinates;
  phone: string;
  is_open: boolean;
  opening_time: string; // "HH:MM" e.g. "08:30"
  closing_time: string; // "HH:MM" e.g. "21:30"
  rating: number; // e.g. 4.8
  review_count: number;
  capabilities: ShopCapabilities;
  pricing: ShopPricingSummary;
  distance_meters?: number | undefined; // Computed relative to customer location
}

export interface ShopFilterOptions {
  searchQuery?: string | undefined;
  openOnly?: boolean | undefined;
  supportsColor?: boolean | undefined;
  supportsDuplex?: boolean | undefined;
  supportsA3?: boolean | undefined;
  supportsSpiral?: boolean | undefined;
  supportsUrgent?: boolean | undefined;
  userCoordinates?: Coordinates | undefined;
  sortBy?: 'distance' | 'rating' | 'name' | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

export interface ShopDiscoveryResponse {
  shops: Shop[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
}

export type GeolocationStatus =
  'idle' | 'prompt' | 'loading' | 'granted' | 'denied' | 'unavailable';

export interface GeolocationState {
  status: GeolocationStatus;
  coordinates: Coordinates | null;
  errorMessage: string | null;
}

export type CatalogCategory = 'print' | 'paper' | 'binding' | 'priority';

export interface ServiceCatalogItem {
  id: string;
  name: string;
  category: CatalogCategory;
  description: string;
  pricePaise: number;
  priceFormatted: string;
  isAvailable: boolean;
  unavailabilityReason?: string | undefined;
}
