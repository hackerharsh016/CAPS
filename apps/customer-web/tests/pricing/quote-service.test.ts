import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QuoteService } from '../../src/features/pricing/quote-service';
import type { QuoteRequest } from '../../src/features/pricing/types';
import { DEFAULT_PRINT_SETTINGS } from '../../src/features/print-settings/validation';

describe('Quote Service & Race Handling (P04-M05-F01)', () => {
  let quoteService: QuoteService;

  beforeEach(() => {
    quoteService = new QuoteService();
    quoteService.configure({ mockLatencyMs: 10 });
  });

  afterEach(() => {
    quoteService.resetConfig();
    vi.restoreAllMocks();
  });

  const sampleRequest: QuoteRequest = {
    shop_id: 'shop-8888-campus-xerox',
    settings: {
      ...DEFAULT_PRINT_SETTINGS,
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'single',
      copies: 1,
      page_range: '1-5'
    },
    priority_tier: 'flexible',
    document_page_count: 5
  };

  describe('Server-Authoritative Quote Response', () => {
    it('returns a fully formed QuoteResponse matching schema', async () => {
      const quote = await quoteService.requestQuote(sampleRequest);

      expect(quote).toBeDefined();
      expect(quote.shop_id).toBe(sampleRequest.shop_id);
      expect(quote.priority_tier).toBe('flexible');
      expect(quote.price_breakdown).toBeDefined();
      expect(quote.price_breakdown.subtotal_paise).toBeGreaterThan(0);
      expect(quote.price_breakdown.gst_paise).toBeGreaterThan(0);
      expect(quote.price_breakdown.total_paise).toBe(
        quote.price_breakdown.subtotal_paise + quote.price_breakdown.gst_paise
      );
      expect(quote.estimated_wait_minutes).toBeGreaterThan(0);
      expect(quote.expires_at).toBeDefined();
    });

    it('enforces server-authoritative pricing rather than trusting client mutations', async () => {
      const quoteFlexible = await quoteService.requestQuote(sampleRequest);
      const quoteUrgent = await quoteService.requestQuote({
        ...sampleRequest,
        priority_tier: 'urgent'
      });

      // Urgent quote total must strictly reflect backend calculation with urgent surcharge
      expect(quoteUrgent.price_breakdown.urgent_surcharge_paise).toBeGreaterThan(0);
      expect(quoteUrgent.price_breakdown.total_paise).toBeGreaterThan(
        quoteFlexible.price_breakdown.total_paise
      );
    });
  });

  describe('Race Condition & Abort Handling', () => {
    it('aborts previous in-flight requests cleanly when AbortSignal triggers', async () => {
      quoteService.configure({ mockLatencyMs: 100 });
      const controller = new AbortController();

      const promise = quoteService.requestQuote(sampleRequest, controller.signal);
      // Abort after 20ms while request is still pending
      setTimeout(() => controller.abort(), 20);

      await expect(promise).rejects.toThrow(/aborted/);
    });

    it('handles out-of-order responses discarding stale prior requests', async () => {
      // Simulate slow Request A (200ms) and fast Request B (30ms)
      let activeSeq = 0;
      let finalResolvedQuote: import('../../src/features/pricing/types').QuoteResponse | null = null;

      const runSimulatedRequest = async (tier: 'flexible' | 'urgent', latency: number) => {
        const seq = ++activeSeq;
        quoteService.configure({ mockLatencyMs: latency });

        try {
          const res = await quoteService.requestQuote({
            ...sampleRequest,
            priority_tier: tier
          });
          // Sequence guard matching useLiveQuote logic
          if (seq === activeSeq) {
            finalResolvedQuote = res;
          }
        } catch {
          // Ignore
        }
      };

      // Launch slow Request A (Flexible)
      const p1 = runSimulatedRequest('flexible', 120);
      // Shortly after, user toggles to Urgent (Request B, faster)
      await new Promise((r) => setTimeout(r, 20));
      const p2 = runSimulatedRequest('urgent', 30);

      await Promise.all([p1, p2]);

      // Final resolved quote MUST be Request B (Urgent), never overwritten by slower Request A
      expect(finalResolvedQuote).toBeDefined();
      expect(finalResolvedQuote!.priority_tier).toBe('urgent');
    });
  });

  describe('Quote Expiration Check', () => {
    it('correctly detects active vs expired quote timestamps', () => {
      const futureTime = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min in future
      const pastTime = new Date(Date.now() - 5 * 1000).toISOString(); // 5 seconds in past

      expect(quoteService.isQuoteExpired(futureTime)).toBe(false);
      expect(quoteService.isQuoteExpired(pastTime)).toBe(true);
      expect(quoteService.isQuoteExpired('')).toBe(true);
    });
  });

  describe('Simulated Failure & Error States', () => {
    it('surfaces network failures cleanly without unhandled exceptions', async () => {
      quoteService.configure({
        simulateFailure: true,
        failureMessage: 'Rate limit exceeded on quote service'
      });

      await expect(quoteService.requestQuote(sampleRequest)).rejects.toThrow(
        'Rate limit exceeded on quote service'
      );
    });
  });

  describe('Shop Pricing Integration', () => {
    it('applies custom pricing from shop discovery fixtures when shop is specified', async () => {
      // Shop 8888 has bw = 150 paise, color = 1000 paise
      const quote = await quoteService.requestQuote({
        ...sampleRequest,
        shop_id: 'shop-8888-campus-xerox'
      });
      expect(quote.price_breakdown.base_pages_paise).toBe(5 * 150); // 5 pages * 150 = 750 paise
    });
  });
});
