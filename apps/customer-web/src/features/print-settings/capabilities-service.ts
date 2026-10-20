/**
 * Printer Capabilities Discovery & Compatibility Verification Service (P04-M04-F02).
 * Inspects connected printers for a shop, aggregates supported formats (paper, color, duplex),
 * validates print settings against real hardware constraints, and detects stale or offline states.
 */

import type {
  DiscoveredPrinter,
  ShopPrinterCapabilities,
  CapabilityCheckResult,
  IncompatibilityItem
} from './capabilities-types';
import type { PrintSettings, PaperSize, ColorMode } from './types';

export const CAPABILITY_STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 Minutes

// Default fallback capabilities if shop has no printers registered yet
export const DEFAULT_UNIVERSAL_CAPABILITIES: ShopPrinterCapabilities = {
  shop_id: 'default',
  supported_paper_sizes: ['A4'],
  supported_color_modes: ['bw'],
  duplex_supported: false,
  max_copies: 100,
  online_printers_count: 1,
  total_printers_count: 1,
  printers: [],
  last_synced_at: new Date().toISOString(),
  is_stale: false
};

// Realistic mock printer hardware fleet indexed by shopId
export const MOCK_PRINTER_FLEET: Record<string, DiscoveredPrinter[]> = {
  // 1. Campus Central: Multi-printer setup (Dedicated B&W + High-end Color, all formats)
  'shop-8888-campus-xerox': [
    {
      id: 'prn-01-xerox-workcentre',
      shop_id: 'shop-8888-campus-xerox',
      name: 'Xerox WorkCentre 5855 Pro',
      role: 'bw',
      is_default: true,
      status: 'online',
      capabilities: {
        paper_sizes: ['A4', 'A3', 'Legal'],
        color_modes: ['bw'],
        duplex_supported: true,
        max_copies: 100
      },
      created_at: '2026-01-10T08:00:00Z',
      updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString()
    },
    {
      id: 'prn-02-canon-imagepress',
      shop_id: 'shop-8888-campus-xerox',
      name: 'Canon imagePRESS C165 Color',
      role: 'color',
      is_default: false,
      status: 'online',
      capabilities: {
        paper_sizes: ['A4', 'A3', 'Legal'],
        color_modes: ['color', 'bw'],
        duplex_supported: true,
        max_copies: 100
      },
      created_at: '2026-01-15T09:00:00Z',
      updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString()
    }
  ],

  // 2. TechPark Xerox: B&W Only, A4 Only, Duplex Supported
  'shop-7777-tech-xerox': [
    {
      id: 'prn-03-brother-duplex',
      shop_id: 'shop-7777-tech-xerox',
      name: 'Brother HL-L6400DW Heavy Duty',
      role: 'bw',
      is_default: true,
      status: 'online',
      capabilities: {
        paper_sizes: ['A4'],
        color_modes: ['bw'],
        duplex_supported: true,
        max_copies: 100
      },
      created_at: '2026-02-01T10:00:00Z',
      updated_at: new Date(Date.now() - 8 * 60 * 1000).toISOString()
    }
  ],

  // 3. Economy Xerox: B&W Only, A4 Only, NO Duplex (Simplex only), Max 50 copies
  'shop-5555-economy-copy': [
    {
      id: 'prn-04-canon-lbp',
      shop_id: 'shop-5555-economy-copy',
      name: 'Canon LBP2900B Personal Laser',
      role: 'bw',
      is_default: true,
      status: 'online',
      capabilities: {
        paper_sizes: ['A4'],
        color_modes: ['bw'],
        duplex_supported: false,
        max_copies: 50
      },
      created_at: '2026-02-10T12:00:00Z',
      updated_at: new Date(Date.now() - 12 * 60 * 1000).toISOString()
    }
  ],

  // 4. Metro Quick Print: Color + Large Format (A3/A4), NO Duplex
  'shop-9999-metro-prints': [
    {
      id: 'prn-05-hp-plotter',
      shop_id: 'shop-9999-metro-prints',
      name: 'HP DesignJet Studio Plotter',
      role: 'large_format',
      is_default: true,
      status: 'online',
      capabilities: {
        paper_sizes: ['A4', 'A3'],
        color_modes: ['bw', 'color'],
        duplex_supported: false,
        max_copies: 50
      },
      created_at: '2026-02-12T14:00:00Z',
      updated_at: new Date(Date.now() - 15 * 60 * 1000).toISOString()
    }
  ],

  // 5. Stale capabilities test shop (Last synced 90 minutes ago)
  'shop-stale-capabilities': [
    {
      id: 'prn-06-epson-ecotank',
      shop_id: 'shop-stale-capabilities',
      name: 'Epson EcoTank L3250',
      role: 'color',
      is_default: true,
      status: 'online',
      capabilities: {
        paper_sizes: ['A4'],
        color_modes: ['bw', 'color'],
        duplex_supported: false,
        max_copies: 100
      },
      created_at: '2026-01-01T00:00:00Z',
      updated_at: new Date(Date.now() - 90 * 60 * 1000).toISOString() // 90 min ago
    }
  ],

  // 6. Shop with all printers offline / error
  'shop-offline-fleet': [
    {
      id: 'prn-07-offline-laser',
      shop_id: 'shop-offline-fleet',
      name: 'Ricoh Aficio MP 2000',
      role: 'bw',
      is_default: true,
      status: 'offline',
      capabilities: {
        paper_sizes: ['A4'],
        color_modes: ['bw'],
        duplex_supported: true,
        max_copies: 100
      },
      created_at: '2026-01-01T00:00:00Z',
      updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString()
    }
  ]
};

/**
 * Determines whether capability telemetry from the print agent is stale.
 */
export function isCapabilityStale(
  lastSyncedIso: string,
  thresholdMs: number = CAPABILITY_STALE_THRESHOLD_MS
): boolean {
  if (!lastSyncedIso) return true;
  const syncTime = new Date(lastSyncedIso).getTime();
  if (isNaN(syncTime)) return true;
  return Date.now() - syncTime > thresholdMs;
}

/**
 * Aggregates hardware capabilities across all online printers in a shop.
 * Unsupported features are only offered if at least one active, online printer supports them.
 */
export function aggregateShopCapabilities(
  shopId: string,
  printers: DiscoveredPrinter[],
  explicitSyncTime?: string
): ShopPrinterCapabilities {
  const onlinePrinters = printers.filter((p) => p.status === 'online');

  // Find most recent updated_at timestamp among all printers
  let latestUpdate = explicitSyncTime || new Date(0).toISOString();
  if (!explicitSyncTime && printers.length > 0) {
    let maxTime = 0;
    for (const p of printers) {
      const t = p.updated_at ? new Date(p.updated_at).getTime() : new Date(p.created_at).getTime();
      if (!isNaN(t) && t > maxTime) {
        maxTime = t;
        latestUpdate = p.updated_at || p.created_at;
      }
    }
  }

  const isStale = isCapabilityStale(latestUpdate);

  // If no online printers exist
  if (onlinePrinters.length === 0) {
    return {
      shop_id: shopId,
      supported_paper_sizes: [],
      supported_color_modes: [],
      duplex_supported: false,
      max_copies: 0,
      online_printers_count: 0,
      total_printers_count: printers.length,
      printers,
      last_synced_at: latestUpdate,
      is_stale: isStale,
      status_notice:
        printers.length === 0
          ? 'No printers registered for this shop.'
          : 'All printers in this shop are currently offline or reporting an error.'
    };
  }

  // Aggregate paper sizes from online printers
  const paperSet = new Set<PaperSize>();
  const colorSet = new Set<ColorMode>();
  let duplex = false;
  let maxCopies = 0;

  for (const prn of onlinePrinters) {
    for (const size of prn.capabilities.paper_sizes) {
      paperSet.add(size);
    }
    for (const mode of prn.capabilities.color_modes) {
      colorSet.add(mode);
    }
    if (prn.capabilities.duplex_supported) {
      duplex = true;
    }
    if (prn.capabilities.max_copies > maxCopies) {
      maxCopies = prn.capabilities.max_copies;
    }
  }

  return {
    shop_id: shopId,
    supported_paper_sizes: Array.from(paperSet),
    supported_color_modes: Array.from(colorSet),
    duplex_supported: duplex,
    max_copies: maxCopies || 100,
    online_printers_count: onlinePrinters.length,
    total_printers_count: printers.length,
    printers,
    last_synced_at: latestUpdate,
    is_stale: isStale
  };
}

/**
 * Checks a customer's PrintSettings against discovered shop capabilities.
 * NEVER silently downgrades settings; instead surfaces explicit incompatibilities
 * and clear reasons.
 */
export function checkSettingsCompatibility(
  settings: PrintSettings,
  capabilities: ShopPrinterCapabilities
): CapabilityCheckResult {
  const incompatibilities: IncompatibilityItem[] = [];
  const warnings: string[] = [];

  // Check 1: Offline status warning
  if (capabilities.online_printers_count === 0) {
    warnings.push(
      capabilities.status_notice ||
        'All printers in this shop are currently offline. Orders cannot be queued until a printer reconnects.'
    );
  }

  // Check 2: Stale telemetry warning
  if (capabilities.is_stale) {
    const syncDate = new Date(capabilities.last_synced_at);
    const minutesAgo = Math.max(1, Math.round((Date.now() - syncDate.getTime()) / 60000));
    warnings.push(
      `Printer capabilities were last verified ${minutesAgo} minutes ago. Real-time hardware status may have changed.`
    );
  }

  // Check 3: Paper Size
  if (
    capabilities.supported_paper_sizes.length > 0 &&
    !capabilities.supported_paper_sizes.includes(settings.paper_size)
  ) {
    incompatibilities.push({
      field: 'paper_size',
      settingValue: settings.paper_size,
      reason: `This shop's printers do not support ${settings.paper_size} paper. Supported sizes: ${capabilities.supported_paper_sizes.join(', ')}.`,
      suggestedValue: capabilities.supported_paper_sizes[0] || 'A4'
    });
  }

  // Check 4: Color Mode
  if (
    capabilities.supported_color_modes.length > 0 &&
    !capabilities.supported_color_modes.includes(settings.color_mode)
  ) {
    incompatibilities.push({
      field: 'color_mode',
      settingValue: settings.color_mode,
      reason: `Color printing is not available at this shop (Monochrome B&W only).`,
      suggestedValue: 'bw'
    });
  }

  // Check 5: Duplex (Sides)
  if (settings.sides === 'double' && !capabilities.duplex_supported) {
    incompatibilities.push({
      field: 'sides',
      settingValue: 'double',
      reason: `Double-sided (duplex) printing is not supported by any online printer at this shop.`,
      suggestedValue: 'single'
    });
  }

  // Check 6: Copy Count limit
  if (capabilities.max_copies > 0 && settings.copies > capabilities.max_copies) {
    incompatibilities.push({
      field: 'copies',
      settingValue: String(settings.copies),
      reason: `This shop limits single orders to a maximum of ${capabilities.max_copies} copies.`,
      suggestedValue: String(capabilities.max_copies)
    });
  }

  return {
    isCompatible: incompatibilities.length === 0 && capabilities.online_printers_count > 0,
    incompatibilities,
    warnings,
    isStale: capabilities.is_stale
  };
}

export class CapabilitiesService {
  private customFleet: Record<string, DiscoveredPrinter[]> = { ...MOCK_PRINTER_FLEET };

  /**
   * Override printer fleet for unit and contract testing.
   */
  public setShopPrintersForTesting(shopId: string, printers: DiscoveredPrinter[]) {
    this.customFleet[shopId] = printers;
  }

  /**
   * Reset printer fleet back to default mocks.
   */
  public resetTestingFleet() {
    this.customFleet = { ...MOCK_PRINTER_FLEET };
  }

  /**
   * Discovers and retrieves printer capabilities for a target shop.
   */
  public async getShopPrinterCapabilities(shopId: string): Promise<ShopPrinterCapabilities> {
    const printers = this.customFleet[shopId];

    if (!printers) {
      // Return default universal capabilities if shop not specifically mocked
      return {
        ...DEFAULT_UNIVERSAL_CAPABILITIES,
        shop_id: shopId,
        supported_paper_sizes: ['A4', 'Legal'],
        supported_color_modes: ['bw', 'color'],
        duplex_supported: true
      };
    }

    return aggregateShopCapabilities(shopId, printers);
  }
}

export const defaultCapabilitiesService = new CapabilitiesService();
