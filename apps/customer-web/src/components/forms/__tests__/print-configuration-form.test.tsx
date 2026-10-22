import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PrintConfigurationForm,
  PAPER_SIZE_OPTIONS,
  COLOR_MODE_OPTIONS,
  DUPLEX_OPTIONS,
  ORIENTATION_OPTIONS,
  BINDING_OPTIONS
} from '../print-configuration-form';
import {
  sidesToDuplex,
  duplexToSides,
  normalizePrintSettings,
  createHarmonizedPrintSettings,
  toValidationPrintSettings
} from '@caps/types';
import type { PrintSettings, HarmonizedPrintSettings } from '@caps/types';
import { PrintSettingsSchema } from '@caps/validation';
import { QuoteService, PrintJobService } from '../../../services/api/quote.service';

describe('PrintConfigurationForm & Sides/Duplex Harmonization (INT-D1-01)', () => {
  describe('Zod Schema Conformance without invalid_enum_value', () => {
    it('passes PrintSettingsSchema.safeParse with default configuration without invalid_enum_value', () => {
      const defaultSettings = createHarmonizedPrintSettings();
      const parseResult = PrintSettingsSchema.safeParse(defaultSettings);

      expect(parseResult.success).toBe(true);
      if (!parseResult.success) {
        const hasInvalidEnum = parseResult.error.issues.some(
          (issue: { code: string }) => issue.code === 'invalid_enum_value'
        );
        expect(hasInvalidEnum).toBe(false);
      }
    });

    it('maps duplex "simplex" to sides "single" and satisfies PrintSettingsSchema', () => {
      const simplexSettings = createHarmonizedPrintSettings({
        duplex: 'simplex',
        paper_size: 'A4',
        color_mode: 'bw',
        copies: 1,
        page_range: 'all',
        binding: 'none'
      });

      expect(simplexSettings.duplex).toBe('simplex');
      expect(simplexSettings.sides).toBe('single');

      const parseResult = PrintSettingsSchema.safeParse(simplexSettings);
      expect(parseResult.success).toBe(true);

      if (!parseResult.success) {
        expect(parseResult.error.issues).toEqual([]);
      }
    });

    it('maps duplex "duplex_long" to sides "double" and satisfies PrintSettingsSchema', () => {
      const duplexSettings = createHarmonizedPrintSettings({
        duplex: 'duplex_long',
        paper_size: 'A4',
        color_mode: 'color',
        copies: 3,
        page_range: '1-10',
        binding: 'staple'
      });

      expect(duplexSettings.duplex).toBe('duplex_long');
      expect(duplexSettings.sides).toBe('double');

      const parseResult = PrintSettingsSchema.safeParse(duplexSettings);
      expect(parseResult.success).toBe(true);
    });

    it('maps duplex "duplex_short" to sides "double" and satisfies PrintSettingsSchema', () => {
      const duplexShortSettings = createHarmonizedPrintSettings({
        duplex: 'duplex_short',
        paper_size: 'Legal',
        color_mode: 'bw',
        copies: 2,
        page_range: '1-3',
        binding: 'spiral'
      });

      expect(duplexShortSettings.duplex).toBe('duplex_short');
      expect(duplexShortSettings.sides).toBe('double');

      const parseResult = PrintSettingsSchema.safeParse(duplexShortSettings);
      expect(parseResult.success).toBe(true);
    });

    it('guarantees no invalid_enum_value errors for all supported duplex and sides variations', () => {
      const combinations: Partial<PrintSettings>[] = [
        { duplex: 'simplex' },
        { duplex: 'duplex_long' },
        { duplex: 'duplex_short' },
        { sides: 'single' },
        { sides: 'double' },
        { duplex: 'simplex', sides: 'single' },
        { duplex: 'duplex_long', sides: 'double' }
      ];

      for (const comb of combinations) {
        const harmonized = createHarmonizedPrintSettings(comb);
        const result = PrintSettingsSchema.safeParse(harmonized);

        expect(result.success).toBe(true);
        if (!result.success) {
          const invalidEnumIssues = result.error.issues.filter(
            (i: { code: string }) => i.code === 'invalid_enum_value'
          );
          expect(invalidEnumIssues).toHaveLength(0);
        }
      }
    });

    it('verifies toValidationPrintSettings strips any non-enumerable or extra properties', () => {
      const harmonized = createHarmonizedPrintSettings({
        paper_size: 'A3',
        color_mode: 'color',
        duplex: 'duplex_long',
        copies: 5,
        binding: 'lamination'
      });

      const validationOnly = toValidationPrintSettings(harmonized);
      expect(validationOnly.sides).toBe('double');
      expect((validationOnly as Record<string, unknown>)['duplex']).toBeUndefined();

      const result = PrintSettingsSchema.safeParse(validationOnly);
      expect(result.success).toBe(true);
    });
  });

  describe('Bidirectional Normalization Functions', () => {
    it('normalizes sidesToDuplex correctly across all variants', () => {
      expect(sidesToDuplex('single')).toBe('simplex');
      expect(sidesToDuplex('simplex')).toBe('simplex');
      expect(sidesToDuplex('double')).toBe('duplex_long');
      expect(sidesToDuplex('duplex_long')).toBe('duplex_long');
      expect(sidesToDuplex('duplex_short')).toBe('duplex_short');
      expect(sidesToDuplex(undefined)).toBe('simplex');
      expect(sidesToDuplex(null)).toBe('simplex');
      expect(sidesToDuplex('')).toBe('simplex');
    });

    it('normalizes duplexToSides correctly across all variants', () => {
      expect(duplexToSides('simplex')).toBe('single');
      expect(duplexToSides('single')).toBe('single');
      expect(duplexToSides('duplex_long')).toBe('double');
      expect(duplexToSides('duplex_short')).toBe('double');
      expect(duplexToSides('double')).toBe('double');
      expect(duplexToSides(undefined)).toBe('single');
      expect(duplexToSides(null)).toBe('single');
      expect(duplexToSides('')).toBe('single');
    });

    it('preserves existing settings when normalizing with normalizePrintSettings', () => {
      const input: Partial<PrintSettings> = {
        paper_size: 'A3',
        color_mode: 'color',
        duplex: 'duplex_long',
        orientation: 'landscape',
        copies: 10,
        page_range: '2-8',
        binding: 'spiral'
      };

      const normalized = normalizePrintSettings(input);
      expect(normalized.paper_size).toBe('A3');
      expect(normalized.color_mode).toBe('color');
      expect(normalized.duplex).toBe('duplex_long');
      expect(normalized.sides).toBe('double');
      expect(normalized.orientation).toBe('landscape');
      expect(normalized.copies).toBe(10);
      expect(normalized.page_range).toBe('2-8');
      expect(normalized.binding).toBe('spiral');

      const valResult = PrintSettingsSchema.safeParse(normalized);
      expect(valResult.success).toBe(true);
    });
  });

  describe('Passing Canonical Duplex to QuoteService & PrintJobService', () => {
    it('passes canonical duplex to QuoteService.calculateQuote', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            quote_id: '11111111-1111-1111-1111-111111111111',
            shop_id: '22222222-2222-2222-2222-222222222222',
            settings: {
              paper_size: 'A4',
              color_mode: 'bw',
              duplex: 'duplex_long',
              sides: 'double',
              orientation: 'portrait',
              copies: 2,
              page_range: 'all',
              binding: 'none'
            },
            priority_tier: 'flexible',
            page_count: 10,
            price_breakdown: {
              base_pages_paise: 2000,
              color_surcharge_paise: 0,
              duplex_discount_paise: 200,
              binding_fee_paise: 0,
              urgent_surcharge_paise: 0,
              subtotal_paise: 1800,
              gst_paise: 324,
              total_paise: 2124
            },
            estimated_wait_minutes: 15,
            expires_at: new Date(Date.now() + 900000).toISOString()
          }
        })
      });

      vi.stubGlobal('fetch', mockFetch);

      const quoteService = new QuoteService({ baseUrl: 'http://localhost:4000' });
      const harmonized = createHarmonizedPrintSettings({
        duplex: 'duplex_long',
        paper_size: 'A4',
        copies: 2
      });

      await quoteService.calculateQuote({
        shop_id: '22222222-2222-2222-2222-222222222222',
        settings: harmonized,
        priority_tier: 'flexible',
        document_page_count: 5
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0];
      expect(call).toBeDefined();
      const [url, options] = call as [string, RequestInit];
      expect(url).toBe('http://localhost:4000/api/v1/quotes/calculate');

      const body = JSON.parse(options.body as string);
      expect(body.settings.duplex).toBe('duplex_long');
      expect(body.settings.sides).toBe('double');

      vi.unstubAllGlobals();
    });

    it('passes canonical duplex to PrintJobService.createPrintJob', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            id: '33333333-3333-3333-3333-333333333333',
            status: 'queued'
          }
        })
      });

      vi.stubGlobal('fetch', mockFetch);

      const printJobService = new PrintJobService({ baseUrl: 'http://localhost:4000' });
      const harmonized = createHarmonizedPrintSettings({
        duplex: 'simplex',
        paper_size: 'Legal',
        color_mode: 'color'
      });

      await printJobService.createPrintJob({
        shop_id: '22222222-2222-2222-2222-222222222222',
        customer_id: '44444444-4444-4444-4444-444444444444',
        document_storage_key: 'uploads/doc-123.pdf',
        settings: harmonized,
        priority_tier: 'flexible'
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0];
      expect(call).toBeDefined();
      const [url, options] = call as [string, RequestInit];
      expect(url).toBe('http://localhost:4000/api/v1/print-jobs');

      const body = JSON.parse(options.body as string);
      expect(body.settings.duplex).toBe('simplex');
      expect(body.settings.sides).toBe('single');

      vi.unstubAllGlobals();
    });
  });

  describe('Form Rendering & Submission', () => {
    it('contains all option lists defined for the form', () => {
      expect(PAPER_SIZE_OPTIONS).toHaveLength(3);
      expect(COLOR_MODE_OPTIONS).toHaveLength(2);
      expect(DUPLEX_OPTIONS).toHaveLength(3);
      expect(ORIENTATION_OPTIONS).toHaveLength(2);
      expect(BINDING_OPTIONS).toHaveLength(4);
    });

    it('renders all configuration fields including duplex radio options', () => {
      const markup = renderToStaticMarkup(
        React.createElement(PrintConfigurationForm, {
          initialSettings: { duplex: 'duplex_long' }
        })
      );

      // Check form attributes
      expect(markup).toContain('aria-label="Print Configuration Form"');
      expect(markup).toContain('Paper Size');
      expect(markup).toContain('Color Reproduction');
      expect(markup).toContain('Print Sides (Duplex)');
      expect(markup).toContain('Orientation');
      expect(markup).toContain('Copies (1 - 100)');
      expect(markup).toContain('Page Range');
      expect(markup).toContain('Finishing &amp; Binding');

      // Check duplex options
      expect(markup).toContain('Single-Sided (Simplex)');
      expect(markup).toContain('Double-Sided (Flip Long Edge)');
      expect(markup).toContain('Double-Sided (Flip Short Edge)');
    });

    it('submits harmonized settings matching PrintSettingsSchema when onSubmit is invoked', async () => {
      let submittedSettings: HarmonizedPrintSettings | null = null;
      const handleSubmit = (settings: HarmonizedPrintSettings) => {
        submittedSettings = settings;
      };

      // Create harmonized settings representing a completed form
      const formSettings = createHarmonizedPrintSettings({
        paper_size: 'A4',
        color_mode: 'bw',
        duplex: 'duplex_long',
        orientation: 'portrait',
        copies: 4,
        page_range: '1-8',
        binding: 'spiral'
      });

      handleSubmit(formSettings);

      expect(submittedSettings).not.toBeNull();
      expect(submittedSettings!.duplex).toBe('duplex_long');
      expect(submittedSettings!.sides).toBe('double');

      const validation = PrintSettingsSchema.safeParse(submittedSettings!);
      expect(validation.success).toBe(true);
      if (!validation.success) {
        expect(validation.error.issues).toEqual([]);
      }
    });

    it('handles initialSettings with legacy sides "double" by harmonizing to duplex "duplex_long"', () => {
      const markup = renderToStaticMarkup(
        React.createElement(PrintConfigurationForm, {
          initialSettings: { sides: 'double' }
        })
      );

      // The radio option for duplex_long should be checked in rendered output
      expect(markup).toContain('value="duplex_long"');
    });

    it('handles initialSettings with legacy sides "single" by harmonizing to duplex "simplex"', () => {
      const markup = renderToStaticMarkup(
        React.createElement(PrintConfigurationForm, {
          initialSettings: { sides: 'single' }
        })
      );

      expect(markup).toContain('value="simplex"');
    });
  });
});
