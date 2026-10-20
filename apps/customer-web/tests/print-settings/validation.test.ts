import { describe, it, expect } from 'vitest';
import {
  isValidPageRange,
  parsePageRange,
  calculateEstimatedSheets,
  validateCopies,
  validatePrintSettings,
  DEFAULT_PRINT_SETTINGS,
  MIN_COPIES,
  MAX_COPIES
} from '../../src/features/print-settings/validation';
import type { PrintSettings } from '../../src/features/print-settings/types';

describe('Print Settings Validation (P04-M04-F01)', () => {
  describe('Copies Validation (1-100 inclusive)', () => {
    it('accepts boundary values 1 and 100', () => {
      expect(validateCopies(1)).toEqual({ isValid: true });
      expect(validateCopies(100)).toEqual({ isValid: true });
      expect(validateCopies(50)).toEqual({ isValid: true });
    });

    it('rejects copy counts below 1', () => {
      expect(validateCopies(0).isValid).toBe(false);
      expect(validateCopies(0).error).toContain(`Copies must be at least ${MIN_COPIES}`);

      expect(validateCopies(-5).isValid).toBe(false);
      expect(validateCopies(-5).error).toContain(`Copies must be at least ${MIN_COPIES}`);
    });

    it('rejects copy counts above 100', () => {
      expect(validateCopies(101).isValid).toBe(false);
      expect(validateCopies(101).error).toContain(`Copies cannot exceed ${MAX_COPIES}`);

      expect(validateCopies(500).isValid).toBe(false);
    });

    it('rejects non-integer and invalid types', () => {
      expect(validateCopies(3.14).isValid).toBe(false);
      expect(validateCopies(3.14).error).toContain('Copies must be an integer');

      expect(validateCopies('abc').isValid).toBe(false);
      expect(validateCopies(null).isValid).toBe(false);
      expect(validateCopies(undefined).isValid).toBe(false);
      expect(validateCopies('').isValid).toBe(false);
    });
  });

  describe('Page Range Syntax Validation', () => {
    it('accepts "all" (case-insensitive)', () => {
      expect(isValidPageRange('all')).toBe(true);
      expect(isValidPageRange('ALL')).toBe(true);
      expect(isValidPageRange('  All  ')).toBe(true);
    });

    it('accepts valid single numbers and comma-separated ranges', () => {
      expect(isValidPageRange('1')).toBe(true);
      expect(isValidPageRange('12')).toBe(true);
      expect(isValidPageRange('1, 2, 3')).toBe(true);
      expect(isValidPageRange('1-5')).toBe(true);
      expect(isValidPageRange('1-5, 8, 11-14')).toBe(true);
      expect(isValidPageRange('2, 4-6, 9')).toBe(true);
    });

    it('rejects inverted ranges (start > end)', () => {
      expect(isValidPageRange('5-2')).toBe(false);
      expect(isValidPageRange('10-8')).toBe(false);
      expect(isValidPageRange('1-3, 9-4')).toBe(false);
    });

    it('rejects zero or negative page numbers', () => {
      expect(isValidPageRange('0')).toBe(false);
      expect(isValidPageRange('-1')).toBe(false);
      expect(isValidPageRange('0-5')).toBe(false);
      expect(isValidPageRange('1, 0, 3')).toBe(false);
    });

    it('rejects malformed delimiters and non-numeric characters', () => {
      expect(isValidPageRange('')).toBe(false);
      expect(isValidPageRange('   ')).toBe(false);
      expect(isValidPageRange('1--5')).toBe(false);
      expect(isValidPageRange('1-2-3')).toBe(false);
      expect(isValidPageRange('1,')).toBe(false);
      expect(isValidPageRange(',1')).toBe(false);
      expect(isValidPageRange('1,,2')).toBe(false);
      expect(isValidPageRange('1-')).toBe(false);
      expect(isValidPageRange('-5')).toBe(false);
      expect(isValidPageRange('abc')).toBe(false);
      expect(isValidPageRange('1-a')).toBe(false);
    });
  });

  describe('Page Range Parsing & Total Document Bounds', () => {
    it('expands "all" to 1..N when totalDocumentPages is provided', () => {
      const pages = parsePageRange('all', 5);
      expect(pages).toEqual([1, 2, 3, 4, 5]);
    });

    it('parses, deduplicates, and sorts custom page ranges', () => {
      const pages = parsePageRange('5, 1-3, 2, 4', 10);
      expect(pages).toEqual([1, 2, 3, 4, 5]);
    });

    it('throws error when a page exceeds totalDocumentPages', () => {
      expect(() => parsePageRange('1-12', 10)).toThrow(
        'Page range references page 11, 12 which exceeds document total of 10 pages'
      );
      expect(() => parsePageRange('15', 5)).toThrow(
        'Page range references page 15 which exceeds document total of 5 pages'
      );
    });

    it('throws error when range syntax is invalid', () => {
      expect(() => parsePageRange('5-2', 10)).toThrow(/Invalid page range/);
    });
  });

  describe('Estimated Sheet Calculation', () => {
    it('computes sheets for single-sided (simplex) printing', () => {
      // 10 pages, single-sided, 1 copy = 10 sheets
      expect(calculateEstimatedSheets(10, 'single', 1)).toBe(10);
      // 10 pages, single-sided, 3 copies = 30 sheets
      expect(calculateEstimatedSheets(10, 'single', 3)).toBe(30);
      // 1 page, single-sided, 5 copies = 5 sheets
      expect(calculateEstimatedSheets(1, 'single', 5)).toBe(5);
    });

    it('computes sheets for double-sided (duplex) printing', () => {
      // 10 pages (even), double-sided, 1 copy = 5 sheets
      expect(calculateEstimatedSheets(10, 'double', 1)).toBe(5);
      // 9 pages (odd), double-sided, 1 copy = 5 sheets (ceil(9/2))
      expect(calculateEstimatedSheets(9, 'double', 1)).toBe(5);
      // 9 pages, double-sided, 2 copies = 10 sheets (5 * 2)
      expect(calculateEstimatedSheets(9, 'double', 2)).toBe(10);
      // 1 page, double-sided, 1 copy = 1 sheet
      expect(calculateEstimatedSheets(1, 'double', 1)).toBe(1);
    });

    it('returns 0 sheets when pages or copies are 0', () => {
      expect(calculateEstimatedSheets(0, 'single', 5)).toBe(0);
      expect(calculateEstimatedSheets(5, 'single', 0)).toBe(0);
    });
  });

  describe('Full PrintSettings Object Validation', () => {
    const validSettings: PrintSettings = {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'single',
      orientation: 'portrait',
      copies: 2,
      page_range: '1-5',
      binding: 'staple'
    };

    it('validates a correct PrintSettings object successfully', () => {
      const result = validatePrintSettings(validSettings, 10);
      expect(result.isValid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
      expect(result.calculation).toBeDefined();
      expect(result.calculation?.effectivePageCount).toBe(5);
      expect(result.calculation?.resolvedPages).toEqual([1, 2, 3, 4, 5]);
      expect(result.calculation?.estimatedSheetCount).toBe(10); // 5 pages * 1-sided * 2 copies
    });

    it('computes duplex sheet count accurately in validation result', () => {
      const duplexSettings: PrintSettings = {
        ...validSettings,
        sides: 'double',
        copies: 3
      };
      const result = validatePrintSettings(duplexSettings, 10);
      expect(result.isValid).toBe(true);
      expect(result.calculation?.effectivePageCount).toBe(5);
      // 5 pages double-sided = 3 sheets per copy * 3 copies = 9 sheets
      expect(result.calculation?.estimatedSheetCount).toBe(9);
    });

    it('flags invalid enums and limits', () => {
      const invalid = {
        paper_size:
          'Tabloid' as unknown as import('../../src/features/print-settings/types').PaperSize,
        color_mode:
          'sepia' as unknown as import('../../src/features/print-settings/types').ColorMode,
        sides: 'triple' as unknown as import('../../src/features/print-settings/types').SideMode,
        orientation:
          'diagonal' as unknown as import('../../src/features/print-settings/types').Orientation,
        copies: 0,
        page_range: '5-2',
        binding:
          'gold_embossed' as unknown as import('../../src/features/print-settings/types').BindingType
      };

      const result = validatePrintSettings(invalid, 10);
      expect(result.isValid).toBe(false);
      expect(result.errors.paper_size).toContain(
        "Paper size must be one of 'A4', 'A3', or 'Legal'"
      );
      expect(result.errors.color_mode).toContain("Color mode must be either 'bw' or 'color'");
      expect(result.errors.sides).toContain("Sides mode must be either 'single' or 'double'");
      expect(result.errors.orientation).toContain(
        "Orientation must be either 'portrait' or 'landscape'"
      );
      expect(result.errors.copies).toContain('Copies must be at least 1');
      expect(result.errors.page_range).toContain('Invalid page range format');
      expect(result.errors.binding).toContain(
        "Binding must be 'none', 'spiral', 'staple', or 'lamination'"
      );
    });

    it('flags pages that exceed totalDocumentPages', () => {
      const result = validatePrintSettings(
        {
          ...DEFAULT_PRINT_SETTINGS,
          page_range: '1-15'
        },
        10
      );
      expect(result.isValid).toBe(false);
      expect(result.errors.page_range).toContain('exceeds document total of 10 pages');
    });
  });
});
