import { describe, it, expect } from 'vitest';
import {
  calculatePriceBreakdown,
  estimateWaitTimeMinutes,
  generateAuthoritativeQuote,
  formatPaiseToRupees
} from '../../src/features/pricing';
import type { PrintSettings } from '../../src/features/print-settings/types';
import { DEFAULT_PRINT_SETTINGS } from '../../src/features/print-settings/validation';

describe('Pricing Calculator Engine (P04-M05-F01)', () => {
  const baseSettings: PrintSettings = {
    ...DEFAULT_PRINT_SETTINGS,
    paper_size: 'A4',
    color_mode: 'bw',
    sides: 'single',
    orientation: 'portrait',
    copies: 1,
    page_range: '1-10',
    binding: 'none'
  };

  describe('Base Pages Calculation (A4 Monochrome Simplex)', () => {
    it('calculates 10 pages at base rate (150 paise/page) = 1500 paise', () => {
      const breakdown = calculatePriceBreakdown(baseSettings, 'flexible', 10);
      expect(breakdown.base_pages_paise).toBe(1500); // 10 pages * 150 paise = ₹15.00
      expect(breakdown.color_surcharge_paise).toBe(0);
      expect(breakdown.duplex_discount_paise).toBe(0);
      expect(breakdown.binding_fee_paise).toBe(0);
      expect(breakdown.urgent_surcharge_paise).toBe(0);
      expect(breakdown.subtotal_paise).toBe(1500);
      // GST 18% of 1500 = 270 paise
      expect(breakdown.gst_paise).toBe(270);
      // Total = 1500 + 270 = 1770 paise (₹17.70)
      expect(breakdown.total_paise).toBe(1770);
    });

    it('scales linearly with multiple copies (10 pages × 3 copies = 30 pages)', () => {
      const multiCopy: PrintSettings = { ...baseSettings, copies: 3 };
      const breakdown = calculatePriceBreakdown(multiCopy, 'flexible', 10);
      expect(breakdown.base_pages_paise).toBe(4500); // 30 pages * 150 = ₹45.00
      expect(breakdown.subtotal_paise).toBe(4500);
      expect(breakdown.gst_paise).toBe(810); // 18% of 4500 = 810 paise
      expect(breakdown.total_paise).toBe(5310);
    });
  });

  describe('Color Surcharge', () => {
    it('adds color surcharge for full color printing (1000 paise - 150 base = 850 surcharge per page)', () => {
      const colorSettings: PrintSettings = { ...baseSettings, color_mode: 'color' };
      const breakdown = calculatePriceBreakdown(colorSettings, 'flexible', 10);
      expect(breakdown.base_pages_paise).toBe(1500);
      expect(breakdown.color_surcharge_paise).toBe(8500); // 10 * 850 = ₹85.00
      expect(breakdown.subtotal_paise).toBe(10000); // ₹100.00
      expect(breakdown.gst_paise).toBe(1800); // 18% of 10000 = ₹18.00
      expect(breakdown.total_paise).toBe(11800); // ₹118.00
    });
  });

  describe('Paper Size Multipliers', () => {
    it('applies 2.0x multiplier for A3 format', () => {
      const a3Settings: PrintSettings = { ...baseSettings, paper_size: 'A3' };
      const breakdown = calculatePriceBreakdown(a3Settings, 'flexible', 5);
      // A3 base rate = 150 * 2.0 = 300 paise. 5 pages = 1500 paise.
      expect(breakdown.base_pages_paise).toBe(1500);
    });

    it('applies 1.25x multiplier for Legal format', () => {
      const legalSettings: PrintSettings = { ...baseSettings, paper_size: 'Legal' };
      const breakdown = calculatePriceBreakdown(legalSettings, 'flexible', 4);
      // Legal base rate = round(150 * 1.25) = 188 paise. 4 pages = 752 paise.
      expect(breakdown.base_pages_paise).toBe(752);
    });
  });

  describe('Duplex (Double-Sided) Paper Discount', () => {
    it('applies paper savings discount on double-sided prints', () => {
      // 10 pages in duplex uses 5 sheets, saving 5 sheets
      const duplexSettings: PrintSettings = { ...baseSettings, sides: 'double' };
      const breakdown = calculatePriceBreakdown(duplexSettings, 'flexible', 10);
      // 5 sheets saved * 25 paise = 125 paise discount
      expect(breakdown.duplex_discount_paise).toBe(125);
      expect(breakdown.subtotal_paise).toBe(1500 - 125); // 1375 paise
      expect(breakdown.gst_paise).toBe(Math.round(1375 * 0.18)); // 248 paise
      expect(breakdown.total_paise).toBe(1375 + 248); // 1623 paise
    });
  });

  describe('Finishing Services Fees', () => {
    it('applies spiral binding charge (3500 paise / copy)', () => {
      const spiralSettings: PrintSettings = { ...baseSettings, binding: 'spiral' };
      const breakdown = calculatePriceBreakdown(spiralSettings, 'flexible', 10);
      expect(breakdown.binding_fee_paise).toBe(3500); // ₹35.00
      expect(breakdown.subtotal_paise).toBe(1500 + 3500); // 5000 paise
    });

    it('applies staple binding charge (1000 paise / copy)', () => {
      const stapleSettings: PrintSettings = { ...baseSettings, binding: 'staple' };
      const breakdown = calculatePriceBreakdown(stapleSettings, 'flexible', 10);
      expect(breakdown.binding_fee_paise).toBe(1000); // ₹10.00
    });

    it('applies lamination charge per printed page (2000 paise / page)', () => {
      const lamSettings: PrintSettings = { ...baseSettings, binding: 'lamination' };
      const breakdown = calculatePriceBreakdown(lamSettings, 'flexible', 3);
      // 3 pages * 2000 paise = 6000 paise (₹60.00)
      expect(breakdown.binding_fee_paise).toBe(6000);
    });
  });

  describe('Urgent Priority Queue Surcharge', () => {
    it('adds 0 paise surcharge for Flexible tier', () => {
      const breakdown = calculatePriceBreakdown(baseSettings, 'flexible', 10);
      expect(breakdown.urgent_surcharge_paise).toBe(0);
    });

    it('adds 2000 paise (₹20.00) surcharge for Urgent tier', () => {
      const breakdown = calculatePriceBreakdown(baseSettings, 'urgent', 10);
      expect(breakdown.urgent_surcharge_paise).toBe(2000);
      expect(breakdown.subtotal_paise).toBe(1500 + 2000); // 3500 paise
      expect(breakdown.gst_paise).toBe(Math.round(3500 * 0.18)); // 630 paise
      expect(breakdown.total_paise).toBe(4130); // ₹41.30
    });
  });

  describe('Queue Wait Time Estimates (ETA)', () => {
    it('computes standard wait time for Flexible tier', () => {
      // 10 pages, 1 copy, base queue load = 10 mins -> ~11 mins
      const eta = estimateWaitTimeMinutes(10, 1, 'flexible', 10);
      expect(eta).toBeGreaterThanOrEqual(5);
    });

    it('computes expedited wait time for Urgent tier', () => {
      const flexibleEta = estimateWaitTimeMinutes(20, 2, 'flexible', 15);
      const urgentEta = estimateWaitTimeMinutes(20, 2, 'urgent', 15);
      // Urgent ETA must be significantly faster than flexible ETA
      expect(urgentEta).toBeLessThan(flexibleEta);
    });
  });

  describe('Authoritative Quote Response Generation', () => {
    it('generates a full QuoteResponse conforming to frozen schema', () => {
      const quote = generateAuthoritativeQuote({
        shop_id: 'shop-test-uuid',
        settings: baseSettings,
        priority_tier: 'urgent',
        document_page_count: 10
      });

      expect(quote.quote_id).toBeDefined();
      expect(quote.shop_id).toBe('shop-test-uuid');
      expect(quote.priority_tier).toBe('urgent');
      expect(quote.page_count).toBe(10);
      expect(quote.price_breakdown.total_paise).toBeGreaterThan(0);
      expect(quote.estimated_wait_minutes).toBeGreaterThan(0);
      expect(new Date(quote.expires_at).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Currency Formatting Utility', () => {
    it('formats paise correctly into INR strings', () => {
      expect(formatPaiseToRupees(0)).toBe('₹0.00');
      expect(formatPaiseToRupees(150)).toBe('₹1.50');
      expect(formatPaiseToRupees(2000)).toBe('₹20.00');
      expect(formatPaiseToRupees(12345)).toBe('₹123.45');
    });
  });
});
