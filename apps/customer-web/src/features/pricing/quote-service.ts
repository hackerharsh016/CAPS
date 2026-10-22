/**
 * Quote Client Service for CAPS Customer Web (P04-M05-F01).
 * Communicates with backend quote endpoints (or contract-compliant local mock)
 * to request server-authoritative quotes, calculate live pricing, and check expiry.
 */

import type { QuoteRequest, QuoteResponse } from './types';
import { generateAuthoritativeQuote, ShopPricingRates } from './pricing-calculator';
import { defaultShopsService } from '../shop-discovery/shops-service';

export interface QuoteServiceConfig {
  mockLatencyMs?: number | undefined;
  simulateFailure?: boolean | undefined;
  failureMessage?: string | undefined;
}

export class QuoteService {
  private config: QuoteServiceConfig = {
    mockLatencyMs: 80,
    simulateFailure: false
  };

  /**
   * Test configuration override for simulating latency, delays, or network failures.
   */
  public configure(config: Partial<QuoteServiceConfig>) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Resets configuration back to defaults.
   */
  public resetConfig() {
    this.config = {
      mockLatencyMs: 80,
      simulateFailure: false
    };
  }

  /**
   * Requests a server-authoritative quote for print settings and priority tier.
   * Supports AbortSignal for canceling outdated requests during rapid user edits.
   */
  public async requestQuote(req: QuoteRequest, signal?: AbortSignal): Promise<QuoteResponse> {
    const latency = this.config.mockLatencyMs ?? 80;

    if (latency > 0) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => resolve(), latency);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new DOMException('Quote request aborted', 'AbortError'));
          });
        }
      });
    }

    if (signal?.aborted) {
      throw new DOMException('Quote request aborted', 'AbortError');
    }

    if (this.config.simulateFailure) {
      throw new Error(this.config.failureMessage || 'Failed to fetch quote from server');
    }

    const apiUrl =
      typeof process !== 'undefined'
        ? process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000'
        : 'http://localhost:4000';

    // Try live Cloud API authoritative quote calculation
    try {
      const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req)
      };
      if (signal) {
        init.signal = signal;
      }
      const res = await fetch(`${apiUrl}/api/v1/quotes`, init);
      if (res.ok) {
        const json = await res.json();
        const liveQuote = json.data || json;
        if (liveQuote && liveQuote.price_breakdown) {
          return liveQuote as QuoteResponse;
        }
      }
    } catch (err: unknown) {
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw new DOMException('Quote request aborted', 'AbortError');
      }
      // Offline fallback to local calculation
    }

    // Attempt to lookup real shop pricing rates from shop-discovery service
    let customRates: Partial<ShopPricingRates> | undefined;
    if (req.shop_id) {
      try {
        const shop = await defaultShopsService.getShopById(req.shop_id);
        if (shop && shop.pricing) {
          customRates = {
            bw_per_page_paise: shop.pricing.bw_per_page_paise,
            color_per_page_paise: shop.pricing.color_per_page_paise,
            duplex_discount_paise: shop.pricing.duplex_discount_paise || 25,
            spiral_binding_paise: shop.pricing.spiral_binding_paise || 3500,
            urgent_surcharge_paise: shop.pricing.urgent_surcharge_paise || 2000
          };
        }
      } catch {
        // Fall back to default rates
      }
    }

    // Generate authoritative quote adhering to frozen contract
    return generateAuthoritativeQuote(req, customRates);
  }

  /**
   * Checks whether a quote timestamp has expired.
   */
  public isQuoteExpired(expiresAt: string): boolean {
    if (!expiresAt) return true;
    const expiryTime = new Date(expiresAt).getTime();
    if (isNaN(expiryTime)) return true;
    return Date.now() >= expiryTime;
  }
}

export const defaultQuoteService = new QuoteService();
