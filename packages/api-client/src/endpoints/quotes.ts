/**
 * Quotes API endpoint client definitions.
 * Harmonizes print settings between frontend sides/duplex definitions and backend quote calculation.
 */

import type { ApiClient } from '../client.js';
import type { QuoteRequest, QuoteResponse, PrintSettings } from '@caps/types';
import { normalizePrintSettings } from '@caps/types';

export { sidesToDuplex, duplexToSides } from '@caps/types';

export interface CalculateQuoteInput extends Omit<QuoteRequest, 'settings'> {
  settings: Partial<PrintSettings> & {
    duplex?: 'simplex' | 'duplex_long' | 'duplex_short' | undefined;
    sides?: 'single' | 'double' | undefined;
  };
}

/**
 * Calculates a server-authoritative quote for print settings with canonical duplex normalization.
 * Targets POST /api/v1/quotes/calculate and falls back to POST /api/v1/quotes.
 */
export async function calculateQuote(
  client: ApiClient,
  input: CalculateQuoteInput
): Promise<QuoteResponse> {
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

  try {
    return await client.post<QuoteResponse>('quotes/calculate', payload, { idempotent: true });
  } catch (err: unknown) {
    return await client.post<QuoteResponse>('quotes', payload, { idempotent: true });
  }
}

/**
 * Alias for calculateQuote.
 */
export async function createQuote(
  client: ApiClient,
  input: CalculateQuoteInput
): Promise<QuoteResponse> {
  return calculateQuote(client, input);
}
