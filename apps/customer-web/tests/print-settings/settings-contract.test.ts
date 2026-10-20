import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRINT_SETTINGS,
  VALID_PAPER_SIZES,
  VALID_COLOR_MODES,
  VALID_SIDE_MODES,
  VALID_ORIENTATIONS,
  VALID_BINDINGS,
  validatePrintSettings,
  calculateEstimatedSheets,
  parsePageRange
} from '../../src/features/print-settings/validation';
import type { PrintSettings } from '../../src/features/print-settings/types';

describe('Print Settings Contract & State Machine (P04-M04-F01)', () => {
  describe('Frozen Contract Enum Alignment', () => {
    it('defines exact frozen paper sizes [A4, A3, Legal]', () => {
      expect(VALID_PAPER_SIZES).toEqual(['A4', 'A3', 'Legal']);
    });

    it('defines exact frozen color modes [bw, color]', () => {
      expect(VALID_COLOR_MODES).toEqual(['bw', 'color']);
    });

    it('defines exact frozen side modes [single, double]', () => {
      expect(VALID_SIDE_MODES).toEqual(['single', 'double']);
    });

    it('defines exact frozen orientations [portrait, landscape]', () => {
      expect(VALID_ORIENTATIONS).toEqual(['portrait', 'landscape']);
    });

    it('defines exact frozen finishing services [none, spiral, staple, lamination]', () => {
      expect(VALID_BINDINGS).toEqual(['none', 'spiral', 'staple', 'lamination']);
    });
  });

  describe('Draft Serialization and Session Roundtrip', () => {
    it('serializes and deserializes cleanly without data loss', () => {
      const original: PrintSettings = {
        paper_size: 'Legal',
        color_mode: 'color',
        sides: 'double',
        orientation: 'landscape',
        copies: 4,
        page_range: '1-4, 6',
        binding: 'spiral'
      };

      const serialized = JSON.stringify(original);
      const parsed = JSON.parse(serialized) as PrintSettings;

      expect(parsed).toEqual(original);

      const val = validatePrintSettings(parsed, 10);
      expect(val.isValid).toBe(true);
      expect(val.calculation?.effectivePageCount).toBe(5); // 1,2,3,4,6 = 5 pages
      expect(val.calculation?.estimatedSheetCount).toBe(12); // Math.ceil(5/2) = 3 sheets * 4 copies = 12 sheets
    });

    it('safely falls back to default settings when draft contains corrupt or partial fields', () => {
      const corrupt = {
        paper_size: 'UNKNOWN_FORMAT' as unknown as import('../../src/features/print-settings/types').PaperSize,
        copies: -99
      };

      const merged = { ...DEFAULT_PRINT_SETTINGS, ...corrupt };
      const val = validatePrintSettings(merged, 10);
      expect(val.isValid).toBe(false);
      expect(val.errors.paper_size).toBeDefined();
      expect(val.errors.copies).toBeDefined();
    });
  });

  describe('Finishing Service Classification', () => {
    it('classifies none as standard loose sheets', () => {
      const val = validatePrintSettings({ ...DEFAULT_PRINT_SETTINGS, binding: 'none' }, 5);
      expect(val.isValid).toBe(true);
    });

    it('accepts finishing options (staple, spiral, lamination) as valid finishing requests', () => {
      for (const finishing of ['staple', 'spiral', 'lamination'] as const) {
        const val = validatePrintSettings({ ...DEFAULT_PRINT_SETTINGS, binding: finishing }, 5);
        expect(val.isValid).toBe(true);
      }
    });
  });

  describe('Dynamic Page & Sheet Proportionality', () => {
    it('scales sheets linearly with copies count for single-sided prints', () => {
      const pageCount = 8;
      const copiesList = [1, 2, 5, 10, 50, 100];

      for (const copies of copiesList) {
        const sheets = calculateEstimatedSheets(pageCount, 'single', copies);
        expect(sheets).toBe(pageCount * copies);
      }
    });

    it('halves sheets (rounded up) for double-sided prints', () => {
      // Odd page count: 7 pages
      const oddPages = 7;
      // 7 / 2 = 3.5 -> 4 sheets per copy
      expect(calculateEstimatedSheets(oddPages, 'double', 1)).toBe(4);
      expect(calculateEstimatedSheets(oddPages, 'double', 2)).toBe(8);
      expect(calculateEstimatedSheets(oddPages, 'double', 5)).toBe(20);

      // Even page count: 8 pages
      const evenPages = 8;
      // 8 / 2 = 4 sheets per copy
      expect(calculateEstimatedSheets(evenPages, 'double', 1)).toBe(4);
      expect(calculateEstimatedSheets(evenPages, 'double', 3)).toBe(12);
    });

    it('handles single page documents in duplex mode', () => {
      // 1 page in double-sided still consumes 1 physical sheet
      expect(calculateEstimatedSheets(1, 'double', 1)).toBe(1);
      expect(calculateEstimatedSheets(1, 'double', 10)).toBe(10);
    });
  });

  describe('Boundary Edge Cases and Error Taxonomy', () => {
    it('rejects empty object', () => {
      const result = validatePrintSettings({});
      expect(result.isValid).toBe(false);
      expect(result.errors.paper_size).toBeDefined();
      expect(result.errors.color_mode).toBeDefined();
      expect(result.errors.sides).toBeDefined();
      expect(result.errors.orientation).toBeDefined();
      expect(result.errors.copies).toBeDefined();
      expect(result.errors.page_range).toBeDefined();
      expect(result.errors.binding).toBeDefined();
    });

    it('rejects page range that evaluates to 0 valid pages', () => {
      const result = validatePrintSettings({
        ...DEFAULT_PRINT_SETTINGS,
        page_range: '   '
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.page_range).toContain('Page range is required');
    });

    it('handles document total of 1 page', () => {
      const pages = parsePageRange('1', 1);
      expect(pages).toEqual([1]);

      expect(() => parsePageRange('2', 1)).toThrow(
        'Page range references page 2 which exceeds document total of 1 page'
      );
    });
  });
});
