/**
 * Customer Web Quote & Print Job Services.
 * Harmonizes customer print settings and coordinates quote calculation requests
 * and job creation with backend endpoints (POST /api/v1/quotes/calculate and POST /api/v1/print-jobs).
 */

import type { QuoteRequest, QuoteResponse, PrintSettings } from '@caps/types';
import { normalizePrintSettings } from '@caps/types';

export interface QuoteServiceOptions {
  baseUrl?: string | undefined;
  mockLatencyMs?: number | undefined;
}

export class QuoteService {
  private readonly baseUrl: string;

  constructor(options: QuoteServiceOptions = {}) {
    this.baseUrl =
      options.baseUrl ||
      (typeof process !== 'undefined'
        ? process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000'
        : 'http://localhost:4000');
  }

  /**
   * Calculates a quote ensuring canonical duplex and legacy sides are harmonized.
   */
  public async calculateQuote(
    req: QuoteRequest & {
      settings: Partial<PrintSettings> & {
        duplex?: 'simplex' | 'duplex_long' | 'duplex_short' | undefined;
        sides?: 'single' | 'double' | undefined;
      };
    },
    signal?: AbortSignal | undefined
  ): Promise<QuoteResponse> {
    const normalizedSettings = normalizePrintSettings(req.settings);

    const payload = {
      ...req,
      settings: {
        paper_size: normalizedSettings.paper_size,
        color_mode: normalizedSettings.color_mode,
        duplex: normalizedSettings.duplex,
        sides: normalizedSettings.sides,
        orientation: normalizedSettings.orientation,
        copies: normalizedSettings.copies,
        page_range: normalizedSettings.page_range,
        binding: normalizedSettings.binding
      }
    };

    const apiUrl = this.baseUrl.replace(/\/+$/, '');

    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    };
    if (signal) {
      init.signal = signal;
    }

    try {
      const res = await fetch(`${apiUrl}/api/v1/quotes/calculate`, init);

      if (res.ok) {
        const json = await res.json();
        return json.data || json;
      }
    } catch {
      if (signal?.aborted) {
        throw new DOMException('Quote request aborted', 'AbortError');
      }
    }

    // Fallback to /api/v1/quotes
    const fallbackInit: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    };
    if (signal) {
      fallbackInit.signal = signal;
    }

    const fallbackRes = await fetch(`${apiUrl}/api/v1/quotes`, fallbackInit);

    if (!fallbackRes.ok) {
      const errText = await fallbackRes.text().catch(() => '');
      throw new Error(`Quote calculation failed with HTTP ${fallbackRes.status}: ${errText}`);
    }

    const fallbackJson = await fallbackRes.json();
    return fallbackJson.data || fallbackJson;
  }

  /**
   * Alias for calculateQuote.
   */
  public async requestQuote(
    req: QuoteRequest & {
      settings: Partial<PrintSettings> & {
        duplex?: 'simplex' | 'duplex_long' | 'duplex_short' | undefined;
        sides?: 'single' | 'double' | undefined;
      };
    },
    signal?: AbortSignal | undefined
  ): Promise<QuoteResponse> {
    return this.calculateQuote(req, signal);
  }
}

export interface CreatePrintJobInput {
  shop_id: string;
  customer_id: string;
  printer_id?: string | undefined;
  document_storage_key: string;
  settings: Partial<PrintSettings> & {
    duplex?: 'simplex' | 'duplex_long' | 'duplex_short' | undefined;
    sides?: 'single' | 'double' | undefined;
  };
  priority_tier: 'urgent' | 'flexible';
}

export class PrintJobService {
  private readonly baseUrl: string;

  constructor(options: QuoteServiceOptions = {}) {
    this.baseUrl =
      options.baseUrl ||
      (typeof process !== 'undefined'
        ? process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000'
        : 'http://localhost:4000');
  }

  /**
   * Submits a print job ensuring canonical duplex and legacy sides are harmonized.
   */
  public async createPrintJob(
    input: CreatePrintJobInput,
    signal?: AbortSignal | undefined
  ): Promise<any> {
    const normalizedSettings = normalizePrintSettings(input.settings);

    const payload = {
      ...input,
      settings: {
        paper_size: normalizedSettings.paper_size,
        color_mode: normalizedSettings.color_mode,
        duplex: normalizedSettings.duplex,
        sides: normalizedSettings.sides,
        orientation: normalizedSettings.orientation,
        copies: normalizedSettings.copies,
        page_range: normalizedSettings.page_range,
        binding: normalizedSettings.binding
      }
    };

    const apiUrl = this.baseUrl.replace(/\/+$/, '');
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    };
    if (signal) {
      init.signal = signal;
    }

    const res = await fetch(`${apiUrl}/api/v1/print-jobs`, init);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Print job creation failed with HTTP ${res.status}: ${errText}`);
    }

    const json = await res.json();
    return json.data || json;
  }
}
