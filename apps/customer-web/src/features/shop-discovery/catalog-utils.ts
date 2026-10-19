/**
 * Service Catalog utilities for CAPS Customer Web.
 * Maps shop capabilities and pricing into a structured, customer-facing service catalog.
 */

import type { Shop, ServiceCatalogItem, CatalogCategory } from './types';
import { formatPaiseToInr } from '../orders/orders-service';

/**
 * Builds a structured service catalog from a shop's capabilities and pricing configuration.
 */
export function getShopServiceCatalog(shop: Shop): ServiceCatalogItem[] {
  const items: ServiceCatalogItem[] = [
    {
      id: 'bw-standard',
      name: 'Black & White Printing (A4)',
      category: 'print',
      description: 'Standard laser printing on 75 GSM paper. Ideal for notes, assignments, and study material.',
      pricePaise: shop.pricing.bw_per_page_paise,
      priceFormatted: `${formatPaiseToInr(shop.pricing.bw_per_page_paise)} / page`,
      isAvailable: true
    },
    {
      id: 'color-standard',
      name: 'Color Printing (A4)',
      category: 'print',
      description: 'Full-color laser printing with vibrant output. Ideal for charts, graphs, and presentation decks.',
      pricePaise: shop.pricing.color_per_page_paise,
      priceFormatted: shop.capabilities.color
        ? `${formatPaiseToInr(shop.pricing.color_per_page_paise)} / page`
        : 'Not Offered',
      isAvailable: shop.capabilities.color,
      unavailabilityReason: shop.capabilities.color
        ? undefined
        : 'Color laser printing is not available at this shop location.'
    },
    {
      id: 'duplex-print',
      name: 'Duplex (Double-Sided) Printing',
      category: 'print',
      description: 'Automatic two-sided printing that cuts paper usage and volume in half.',
      pricePaise: shop.pricing.duplex_discount_paise ?? 0,
      priceFormatted: shop.capabilities.duplex
        ? shop.pricing.duplex_discount_paise
          ? `Saves ${formatPaiseToInr(shop.pricing.duplex_discount_paise)} / sheet`
          : 'Included'
        : 'Not Available',
      isAvailable: shop.capabilities.duplex,
      unavailabilityReason: shop.capabilities.duplex
        ? undefined
        : "Automatic duplex printing hardware is not installed on this shop's printers."
    },
    {
      id: 'a3-large-format',
      name: 'A3 Large Format Sheet',
      category: 'paper',
      description: 'Large sheet printing (297 x 420 mm) for engineering drawings, architectural blueprints, and posters.',
      pricePaise: shop.pricing.bw_per_page_paise * 2,
      priceFormatted: shop.capabilities.paper_sizes.includes('A3')
        ? `${formatPaiseToInr(shop.pricing.bw_per_page_paise * 2)} / page`
        : 'Not Supported',
      isAvailable: shop.capabilities.paper_sizes.includes('A3'),
      unavailabilityReason: shop.capabilities.paper_sizes.includes('A3')
        ? undefined
        : "A3 paper tray is not configured on this shop's active printers."
    },
    {
      id: 'spiral-binding',
      name: 'Spiral Document Binding',
      category: 'binding',
      description: 'Sturdy PVC coil spiral binding with heavy-gauge transparent front cover and opaque back sheet.',
      pricePaise: shop.pricing.spiral_binding_paise,
      priceFormatted: shop.capabilities.spiral_binding
        ? `${formatPaiseToInr(shop.pricing.spiral_binding_paise)} / doc`
        : 'Not Offered',
      isAvailable: shop.capabilities.spiral_binding,
      unavailabilityReason: shop.capabilities.spiral_binding
        ? undefined
        : 'Spiral binding machine is not available at this shop location.'
    },
    {
      id: 'urgent-priority',
      name: 'Urgent Priority Queue Jump',
      category: 'priority',
      description: 'Priority spooler dispatch that jumps ahead of flexible FIFO jobs for immediate printing.',
      pricePaise: shop.pricing.urgent_surcharge_paise,
      priceFormatted: shop.capabilities.urgent_queue
        ? `+${formatPaiseToInr(shop.pricing.urgent_surcharge_paise)} surcharge`
        : 'Disabled',
      isAvailable: shop.capabilities.urgent_queue,
      unavailabilityReason: shop.capabilities.urgent_queue
        ? undefined
        : 'Express priority queue is currently disabled by the shop owner.'
    }
  ];

  return items;
}

/**
 * Returns user-facing metadata and icon for catalog categories.
 */
export function getCategoryMetadata(category: CatalogCategory): { label: string; icon: string } {
  switch (category) {
    case 'print':
      return { label: 'Printing Options', icon: '🖨️' };
    case 'paper':
      return { label: 'Paper Sizes', icon: '📐' };
    case 'binding':
      return { label: 'Finishing & Binding', icon: '🌀' };
    case 'priority':
      return { label: 'Queue & Priority Tiers', icon: '⚡' };
  }
}
