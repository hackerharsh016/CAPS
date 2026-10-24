'use client';

/**
 * Custom React Hook for Order Review and Checkout Flow (P04-M05-F02).
 * Handles payment method selection, in-flight submission locking,
 * idempotency key management, and atomic error handling.
 */

import { useState, useRef, useCallback } from 'react';
import type { PaymentMethod, CheckoutOrderInput, CheckoutResult, CheckoutError } from './types';
import { CheckoutCustomError, CheckoutService, defaultCheckoutService } from './checkout-service';

export interface UseCheckoutOptions {
  shopId: string;
  customerId: string;
  documentId?: string | undefined;
  documentStorageKey: string;
  documentName: string;
  fileSizeBytes: number;
  settings: CheckoutOrderInput['settings'];
  priorityTier: CheckoutOrderInput['priority_tier'];
  quote: CheckoutOrderInput['quote'];
  initialPaymentMethod?: PaymentMethod | undefined;
  checkoutService?: CheckoutService | undefined;
}

export interface UseCheckoutReturn {
  paymentMethod: PaymentMethod;
  isSubmitting: boolean;
  error: CheckoutError | null;
  setPaymentMethod: (method: PaymentMethod) => void;
  submitOrder: () => Promise<CheckoutResult | null>;
  clearError: () => void;
}

export function useCheckout({
  shopId,
  customerId,
  documentId,
  documentStorageKey,
  documentName,
  fileSizeBytes,
  settings,
  priorityTier,
  quote,
  initialPaymentMethod = 'upi',
  checkoutService = defaultCheckoutService
}: UseCheckoutOptions): UseCheckoutReturn {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initialPaymentMethod);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<CheckoutError | null>(null);

  // Stable idempotency key per checkout session
  const idempotencyKeyRef = useRef<string>(
    crypto.randomUUID
      ? crypto.randomUUID()
      : `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const submitOrder = useCallback(async (): Promise<CheckoutResult | null> => {
    // 1. Double-click prevention: If already in flight, block concurrent execution
    if (isSubmitting) {
      return null;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await checkoutService.createPendingOrder({
        quote_id: quote.quote_id,
        shop_id: shopId,
        customer_id: customerId,
        document_id: documentId,
        document_storage_key: documentStorageKey,
        document_name: documentName,
        file_size_bytes: fileSizeBytes,
        settings,
        priority_tier: priorityTier,
        quote,
        payment_method: paymentMethod,
        idempotency_key: idempotencyKeyRef.current
      });

      return result;
    } catch (err: unknown) {
      if (err instanceof CheckoutCustomError) {
        setError({
          code: err.code,
          message: err.message,
          details: err.details
        });
      } else {
        const msg = err instanceof Error ? err.message : 'Failed to place order';
        setError({
          code: 'NETWORK_ERROR',
          message: msg
        });
      }
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    checkoutService,
    quote,
    shopId,
    customerId,
    documentStorageKey,
    documentName,
    fileSizeBytes,
    settings,
    priorityTier,
    paymentMethod
  ]);

  return {
    paymentMethod,
    isSubmitting,
    error,
    setPaymentMethod,
    submitOrder,
    clearError
  };
}
