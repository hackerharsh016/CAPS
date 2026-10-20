'use client';

/**
 * Custom React Hook for Live Debounced Server-Authoritative Quotes (P04-M05-F01).
 * Features:
 * - Debounced requests (default 300ms) to avoid server spam during slider/option adjustments.
 * - Strict race condition handling (request sequence tracking & AbortController).
 * - Live expiration countdown timer (15 min validity).
 * - Priority Tier switching (Flexible vs Urgent) with immediate feedback and live recalculation.
 * - Loading and stale indicators for seamless UI transitions.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { PriorityTier, QuoteResponse, QuoteStatus } from './types';
import type { PrintSettings } from '../print-settings/types';
import { QuoteService, defaultQuoteService } from './quote-service';

export interface UseLiveQuoteOptions {
  shopId: string;
  settings: PrintSettings | null;
  documentPageCount: number;
  initialPriorityTier?: PriorityTier | undefined;
  debounceMs?: number | undefined;
  quoteService?: QuoteService | undefined;
}

export interface UseLiveQuoteReturn {
  quote: QuoteResponse | null;
  priorityTier: PriorityTier;
  status: QuoteStatus;
  isLoading: boolean;
  isStale: boolean;
  isExpired: boolean;
  timeRemainingSeconds: number;
  error: string | null;
  setPriorityTier: (tier: PriorityTier) => void;
  refreshQuote: () => void;
}

export function useLiveQuote({
  shopId,
  settings,
  documentPageCount,
  initialPriorityTier = 'flexible',
  debounceMs = 300,
  quoteService = defaultQuoteService
}: UseLiveQuoteOptions): UseLiveQuoteReturn {
  const [priorityTier, setPriorityTierState] = useState<PriorityTier>(initialPriorityTier);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [status, setStatus] = useState<QuoteStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [timeRemainingSeconds, setTimeRemainingSeconds] = useState<number>(0);
  const [isExpired, setIsExpired] = useState<boolean>(false);

  // Request sequence counter and abort controller ref to prevent race conditions
  const requestSeqRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchQuote = useCallback(
    async (tier: PriorityTier) => {
      if (!shopId || !settings || documentPageCount <= 0) {
        return;
      }

      // Abort any existing in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const currentSeq = ++requestSeqRef.current;
      setStatus('loading');
      setError(null);

      try {
        const result = await quoteService.requestQuote(
          {
            shop_id: shopId,
            settings,
            priority_tier: tier,
            document_page_count: documentPageCount
          },
          controller.signal
        );

        // Strict race condition check: ignore if newer request was initiated
        if (currentSeq !== requestSeqRef.current) {
          return;
        }

        setQuote(result);
        setStatus('success');
        setIsStale(false);
        setIsExpired(false);

        // Calculate initial remaining seconds
        const expiryMs = new Date(result.expires_at).getTime();
        const diffSec = Math.max(0, Math.floor((expiryMs - Date.now()) / 1000));
        setTimeRemainingSeconds(diffSec);
      } catch (err: unknown) {
        // Ignore aborted requests
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }

        // Only commit error if this request is still the latest one
        if (currentSeq === requestSeqRef.current) {
          const msg = err instanceof Error ? err.message : 'Failed to calculate quote';
          setError(msg);
          setStatus('error');
          setIsStale(false);
        }
      }
    },
    [shopId, settings, documentPageCount, quoteService]
  );

  // Debounce quote updates whenever settings, priority, or target shop changes
  useEffect(() => {
    if (!shopId || !settings || documentPageCount <= 0) {
      setQuote(null);
      setStatus('idle');
      return;
    }

    if (quote) {
      setIsStale(true);
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchQuote(priorityTier);
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [shopId, settings, priorityTier, documentPageCount, debounceMs, fetchQuote]);

  // Expiration countdown interval
  useEffect(() => {
    if (!quote?.expires_at) return;

    const interval = setInterval(() => {
      const expiryMs = new Date(quote.expires_at).getTime();
      const diffSec = Math.max(0, Math.floor((expiryMs - Date.now()) / 1000));
      setTimeRemainingSeconds(diffSec);

      if (diffSec <= 0) {
        setIsExpired(true);
        setStatus('expired');
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [quote?.expires_at]);

  const setPriorityTier = useCallback((newTier: PriorityTier) => {
    setPriorityTierState(newTier);
  }, []);

  const refreshQuote = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    fetchQuote(priorityTier);
  }, [fetchQuote, priorityTier]);

  return {
    quote,
    priorityTier,
    status,
    isLoading: status === 'loading',
    isStale,
    isExpired,
    timeRemainingSeconds,
    error,
    setPriorityTier,
    refreshQuote
  };
}
