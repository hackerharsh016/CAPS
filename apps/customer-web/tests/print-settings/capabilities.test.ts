import { describe, it, expect } from 'vitest';
import {
  aggregateShopCapabilities,
  checkSettingsCompatibility,
  isCapabilityStale,
  defaultCapabilitiesService
} from '../../src/features/print-settings/capabilities-service';
import type {
  DiscoveredPrinter,
  ShopPrinterCapabilities
} from '../../src/features/print-settings/capabilities-types';
import type { PrintSettings } from '../../src/features/print-settings/types';
import { DEFAULT_PRINT_SETTINGS } from '../../src/features/print-settings/validation';

describe('Capability-Aware Print Settings (P04-M04-F02)', () => {
  const baseSettings: PrintSettings = {
    ...DEFAULT_PRINT_SETTINGS,
    copies: 2,
    page_range: '1-5'
  };

  describe('1. Mock BW-Only Printer Profile (No Color)', () => {
    const bwPrinter: DiscoveredPrinter = {
      id: 'prn-bw-only',
      shop_id: 'shop-bw',
      name: 'HP LaserJet Enterprise (B&W Only)',
      role: 'bw',
      is_default: true,
      status: 'online',
      capabilities: {
        paper_sizes: ['A4', 'Legal'],
        color_modes: ['bw'],
        duplex_supported: true,
        max_copies: 100
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const bwShopCapabilities = aggregateShopCapabilities('shop-bw', [bwPrinter]);

    it('rejects Color print settings and supplies explicit reason without silent downgrade', () => {
      const colorSettings: PrintSettings = {
        ...baseSettings,
        color_mode: 'color'
      };

      const result = checkSettingsCompatibility(colorSettings, bwShopCapabilities);
      expect(result.isCompatible).toBe(false);
      expect(result.incompatibilities).toHaveLength(1);

      const colorInc = result.incompatibilities[0]!;
      expect(colorInc.field).toBe('color_mode');
      expect(colorInc.settingValue).toBe('color');
      expect(colorInc.suggestedValue).toBe('bw');
      expect(colorInc.reason).toContain(
        'Color printing is not available at this shop (Monochrome B&W only)'
      );
    });

    it('accepts B&W print settings on BW-only printer', () => {
      const result = checkSettingsCompatibility(baseSettings, bwShopCapabilities);
      expect(result.isCompatible).toBe(true);
      expect(result.incompatibilities).toHaveLength(0);
    });
  });

  describe('2. Mock No-Duplex Printer Profile (Simplex Only)', () => {
    const simplexPrinter: DiscoveredPrinter = {
      id: 'prn-simplex-only',
      shop_id: 'shop-simplex',
      name: 'Canon LBP2900B (Simplex Laser)',
      role: 'bw',
      is_default: true,
      status: 'online',
      capabilities: {
        paper_sizes: ['A4'],
        color_modes: ['bw'],
        duplex_supported: false,
        max_copies: 50
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const simplexShopCaps = aggregateShopCapabilities('shop-simplex', [simplexPrinter]);

    it('rejects Double-sided (duplex) settings and supplies explicit reason', () => {
      const duplexSettings: PrintSettings = {
        ...baseSettings,
        sides: 'double'
      };

      const result = checkSettingsCompatibility(duplexSettings, simplexShopCaps);
      expect(result.isCompatible).toBe(false);

      const duplexInc = result.incompatibilities.find(i => i.field === 'sides');
      expect(duplexInc).toBeDefined();
      expect(duplexInc?.settingValue).toBe('double');
      expect(duplexInc?.suggestedValue).toBe('single');
      expect(duplexInc?.reason).toContain('Double-sided (duplex) printing is not supported');
    });

    it('accepts Single-sided (simplex) settings', () => {
      const singleSettings: PrintSettings = {
        ...baseSettings,
        sides: 'single'
      };

      const result = checkSettingsCompatibility(singleSettings, simplexShopCaps);
      expect(result.isCompatible).toBe(true);
    });
  });

  describe('3. Mock Paper Size Restrictions (A4-Only Profile)', () => {
    const a4OnlyPrinter: DiscoveredPrinter = {
      id: 'prn-a4-only',
      shop_id: 'shop-a4',
      name: 'Brother Personal MFC',
      role: 'bw',
      is_default: true,
      status: 'online',
      capabilities: {
        paper_sizes: ['A4'],
        color_modes: ['bw'],
        duplex_supported: true,
        max_copies: 100
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const a4ShopCaps = aggregateShopCapabilities('shop-a4', [a4OnlyPrinter]);

    it('rejects A3 and Legal paper on A4-only hardware', () => {
      const a3Settings: PrintSettings = { ...baseSettings, paper_size: 'A3' };
      const legalSettings: PrintSettings = { ...baseSettings, paper_size: 'Legal' };

      const a3Result = checkSettingsCompatibility(a3Settings, a4ShopCaps);
      expect(a3Result.isCompatible).toBe(false);
      expect(a3Result.incompatibilities[0]!.field).toBe('paper_size');
      expect(a3Result.incompatibilities[0]!.reason).toContain('do not support A3 paper');

      const legalResult = checkSettingsCompatibility(legalSettings, a4ShopCaps);
      expect(legalResult.isCompatible).toBe(false);
      expect(legalResult.incompatibilities[0]!.field).toBe('paper_size');
      expect(legalResult.incompatibilities[0]!.reason).toContain('do not support Legal paper');
    });
  });

  describe('4. Stale Capabilities and User Warning', () => {
    it('detects telemetry older than 30 minutes as stale', () => {
      const now = Date.now();
      const freshTimestamp = new Date(now - 10 * 60 * 1000).toISOString(); // 10 min ago
      const staleTimestamp = new Date(now - 45 * 60 * 1000).toISOString(); // 45 min ago

      expect(isCapabilityStale(freshTimestamp)).toBe(false);
      expect(isCapabilityStale(staleTimestamp)).toBe(true);
      expect(isCapabilityStale('')).toBe(true);
    });

    it('generates a user warning banner message when capabilities are stale', () => {
      const staleIso = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 60 min ago
      const staleCapabilities: ShopPrinterCapabilities = {
        shop_id: 'shop-stale',
        supported_paper_sizes: ['A4'],
        supported_color_modes: ['bw'],
        duplex_supported: true,
        max_copies: 100,
        online_printers_count: 1,
        total_printers_count: 1,
        printers: [],
        last_synced_at: staleIso,
        is_stale: true
      };

      const result = checkSettingsCompatibility(baseSettings, staleCapabilities);
      expect(result.isStale).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('last verified');
      expect(result.warnings[0]).toContain('Real-time hardware status may have changed');
    });
  });

  describe('5. Multi-Printer Fleet Aggregation', () => {
    const multiPrinters: DiscoveredPrinter[] = [
      {
        id: 'prn-mono-speed',
        shop_id: 'shop-multi',
        name: 'HP LaserJet 4000',
        role: 'bw',
        is_default: true,
        status: 'online',
        capabilities: {
          paper_sizes: ['A4', 'Legal'],
          color_modes: ['bw'],
          duplex_supported: true,
          max_copies: 100
        },
        created_at: new Date().toISOString()
      },
      {
        id: 'prn-color-plotter',
        shop_id: 'shop-multi',
        name: 'Epson SureColor A3',
        role: 'large_format',
        is_default: false,
        status: 'online',
        capabilities: {
          paper_sizes: ['A4', 'A3'],
          color_modes: ['bw', 'color'],
          duplex_supported: false,
          max_copies: 50
        },
        created_at: new Date().toISOString()
      }
    ];

    it('unions capabilities across online printers so user can access shop-wide capabilities', () => {
      const aggregated = aggregateShopCapabilities('shop-multi', multiPrinters);

      expect(aggregated.online_printers_count).toBe(2);
      expect(aggregated.supported_paper_sizes).toEqual(
        expect.arrayContaining(['A4', 'Legal', 'A3'])
      );
      expect(aggregated.supported_color_modes).toEqual(expect.arrayContaining(['bw', 'color']));
      expect(aggregated.duplex_supported).toBe(true);
      expect(aggregated.max_copies).toBe(100);
    });
  });

  describe('6. Offline Printers & Hardware Error States', () => {
    const offlinePrinters: DiscoveredPrinter[] = [
      {
        id: 'prn-offline',
        shop_id: 'shop-offline',
        name: 'Ricoh Aficio Offline',
        role: 'bw',
        is_default: true,
        status: 'offline',
        capabilities: {
          paper_sizes: ['A4'],
          color_modes: ['bw'],
          duplex_supported: true,
          max_copies: 100
        },
        created_at: new Date().toISOString()
      }
    ];

    it('marks compatibility false when all printers are offline', () => {
      const offlineCaps = aggregateShopCapabilities('shop-offline', offlinePrinters);
      expect(offlineCaps.online_printers_count).toBe(0);

      const result = checkSettingsCompatibility(baseSettings, offlineCaps);
      expect(result.isCompatible).toBe(false);
      expect(result.warnings.some(w => w.includes('offline'))).toBe(true);
    });
  });

  describe('7. Copy Limit Constraints', () => {
    const limitedPrinter: DiscoveredPrinter = {
      id: 'prn-limited',
      shop_id: 'shop-limited',
      name: 'Small Deskjet',
      role: 'color',
      is_default: true,
      status: 'online',
      capabilities: {
        paper_sizes: ['A4'],
        color_modes: ['bw', 'color'],
        duplex_supported: false,
        max_copies: 25
      },
      created_at: new Date().toISOString()
    };

    const limitedCaps = aggregateShopCapabilities('shop-limited', [limitedPrinter]);

    it('flags copies exceeding printer max copies', () => {
      const excessiveCopiesSettings: PrintSettings = {
        ...baseSettings,
        copies: 30
      };

      const result = checkSettingsCompatibility(excessiveCopiesSettings, limitedCaps);
      expect(result.isCompatible).toBe(false);
      const copyInc = result.incompatibilities.find(i => i.field === 'copies');
      expect(copyInc).toBeDefined();
      expect(copyInc?.reason).toContain('maximum of 25 copies');
      expect(copyInc?.suggestedValue).toBe('25');
    });
  });

  describe('8. Capabilities Service End-to-End', () => {
    it('retrieves mock shop capabilities accurately for known fixtures', async () => {
      const campusCaps =
        await defaultCapabilitiesService.getShopPrinterCapabilities('shop-8888-campus-xerox');
      expect(campusCaps.supported_color_modes).toContain('color');
      expect(campusCaps.supported_paper_sizes).toContain('A3');
      expect(campusCaps.duplex_supported).toBe(true);

      const techCaps =
        await defaultCapabilitiesService.getShopPrinterCapabilities('shop-7777-tech-xerox');
      expect(techCaps.supported_color_modes).not.toContain('color');
      expect(techCaps.supported_color_modes).toContain('bw');
      expect(techCaps.duplex_supported).toBe(true);
    });
  });
});
