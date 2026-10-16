import { describe, it, expect } from 'vitest';
import { PrintSettingsSchema } from '../src/settings.schema.js';
import { isValidPageRange, parsePageRange } from '../src/helpers.js';

describe('PrintSettingsSchema Validation', () => {
  const validPayload = {
    paper_size: 'A4',
    color_mode: 'bw',
    sides: 'double',
    orientation: 'portrait',
    copies: 2,
    page_range: '1-10',
    binding: 'spiral'
  };

  it('accepts completely valid print settings', () => {
    const result = PrintSettingsSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paper_size).toBe('A4');
      expect(result.data.copies).toBe(2);
      expect(result.data.binding).toBe('spiral');
    }
  });

  describe('Copies boundary tests (1 to 100 copies)', () => {
    it('accepts valid copy counts at lower bound (1)', () => {
      const res = PrintSettingsSchema.safeParse({ ...validPayload, copies: 1 });
      expect(res.success).toBe(true);
    });

    it('accepts valid copy counts at upper bound (100)', () => {
      const res = PrintSettingsSchema.safeParse({ ...validPayload, copies: 100 });
      expect(res.success).toBe(true);
    });

    it('accepts intermediate copy count (50)', () => {
      const res = PrintSettingsSchema.safeParse({ ...validPayload, copies: 50 });
      expect(res.success).toBe(true);
    });

    it('rejects copy count of 0', () => {
      const res = PrintSettingsSchema.safeParse({ ...validPayload, copies: 0 });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.errors[0]?.message).toMatch(/at least 1/);
      }
    });

    it('rejects copy count exceeding 100', () => {
      const res = PrintSettingsSchema.safeParse({ ...validPayload, copies: 101 });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.errors[0]?.message).toMatch(/cannot exceed 100/);
      }
    });

    it('rejects negative copy count', () => {
      const res = PrintSettingsSchema.safeParse({ ...validPayload, copies: -5 });
      expect(res.success).toBe(false);
    });

    it('rejects non-integer floating point copies', () => {
      const res = PrintSettingsSchema.safeParse({ ...validPayload, copies: 2.5 });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.errors[0]?.message).toMatch(/integer/);
      }
    });
  });

  describe('Unknown fields rejection (strict validation)', () => {
    it('rejects payloads with unknown/injected properties', () => {
      const maliciousPayload = {
        ...validPayload,
        unknown_injected_key: 'hacker_data',
        bypass_auth: true
      };
      const res = PrintSettingsSchema.safeParse(maliciousPayload);
      expect(res.success).toBe(false);
      if (!res.success) {
        const errorMessages = res.error.errors.map(e => e.message).join(' ');
        expect(errorMessages).toMatch(/Unrecognized properties are forbidden/);
      }
    });
  });

  describe('Page range validation and parsing', () => {
    it('accepts "all" as valid page range', () => {
      expect(isValidPageRange('all')).toBe(true);
      expect(isValidPageRange('ALL')).toBe(true);
      const res = PrintSettingsSchema.safeParse({ ...validPayload, page_range: 'all' });
      expect(res.success).toBe(true);
    });

    it('accepts valid single numbers and comma-separated ranges', () => {
      expect(isValidPageRange('1')).toBe(true);
      expect(isValidPageRange('1-5')).toBe(true);
      expect(isValidPageRange('1, 3, 5-8, 12')).toBe(true);
      const res = PrintSettingsSchema.safeParse({ ...validPayload, page_range: '1, 3, 5-8' });
      expect(res.success).toBe(true);
    });

    it('rejects inverted page ranges (e.g. "5-2")', () => {
      expect(isValidPageRange('5-2')).toBe(false);
      const res = PrintSettingsSchema.safeParse({ ...validPayload, page_range: '5-2' });
      expect(res.success).toBe(false);
    });

    it('rejects zero or negative page numbers', () => {
      expect(isValidPageRange('0')).toBe(false);
      expect(isValidPageRange('0-5')).toBe(false);
      expect(isValidPageRange('-1')).toBe(false);
      expect(isValidPageRange('1-0')).toBe(false);
    });

    it('rejects malformed syntax like consecutive commas or dashes', () => {
      expect(isValidPageRange('1,,5')).toBe(false);
      expect(isValidPageRange('1--5')).toBe(false);
      expect(isValidPageRange('1-5,')).toBe(false);
      expect(isValidPageRange('abc')).toBe(false);
      expect(isValidPageRange('')).toBe(false);
    });

    it('expands page range to discrete sorted page array correctly', () => {
      expect(parsePageRange('1-3, 5, 8')).toEqual([1, 2, 3, 5, 8]);
      expect(parsePageRange('all', 4)).toEqual([1, 2, 3, 4]);
    });

    it('throws error when page range exceeds total document page count', () => {
      expect(() => parsePageRange('1-10', 5)).toThrowError(/beyond document page count/);
    });
  });

  describe('Enum constraint validations', () => {
    it('rejects invalid paper size', () => {
      const res = PrintSettingsSchema.safeParse({ ...validPayload, paper_size: 'Letter' });
      expect(res.success).toBe(false);
    });

    it('rejects invalid color mode', () => {
      const res = PrintSettingsSchema.safeParse({ ...validPayload, color_mode: 'grayscale' });
      expect(res.success).toBe(false);
    });

    it('rejects invalid sides mode', () => {
      const res = PrintSettingsSchema.safeParse({ ...validPayload, sides: 'duplex_invalid' });
      expect(res.success).toBe(false);
    });

    it('rejects invalid orientation', () => {
      const res = PrintSettingsSchema.safeParse({ ...validPayload, orientation: 'diagonal' });
      expect(res.success).toBe(false);
    });

    it('rejects invalid binding type', () => {
      const res = PrintSettingsSchema.safeParse({ ...validPayload, binding: 'hardcover' });
      expect(res.success).toBe(false);
    });
  });
});
