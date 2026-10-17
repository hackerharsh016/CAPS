# `@caps/api-client`

Typed HTTP API client for the CAPS platform with authentication propagation, error taxonomy mapping, and idempotent retry policies.

---

## Features

- **Strict Type Safety:** Strongly typed methods for health checks, quote calculations, print jobs, shop management, and print agent telemetry.
- **Authentication Propagation:** Supports static Bearer tokens or dynamic asynchronous token providers (e.g. Supabase auth sessions).
- **Comprehensive Error Taxonomy:** Maps backend error payloads into typed exception classes:
  - `ApiAuthError` (HTTP 401 / 403)
  - `ApiValidationError` (HTTP 400 / 422)
  - `ApiNotFoundError` (HTTP 404)
  - `ApiConflictError` (HTTP 409)
  - `ApiServerError` (HTTP 500..599)
  - `ApiNetworkError` (Network/DNS/Timeout)
- **Safe Idempotent Retry Policy:**
  - Automatically retries transient network errors, HTTP 429, and 502/503/504 server errors with exponential backoff and jitter.
  - Retries **only idempotent operations** (`GET`, `HEAD`, `PUT`, `DELETE` or requests with `Idempotency-Key`).
  - **Never retries non-idempotent operations** (e.g. standard `POST` without an `Idempotency-Key`) to prevent double-charging or duplicate print job submissions.
- **Secret Isolation:** Zero backend secrets (`SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`) are embedded or imported. Safe for customer web, dashboard, and cross-service use.

---

## Basic Usage

```typescript
import { createApiClient } from '@caps/api-client';

const client = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1',
  tokenProvider: async () => {
    // Return Supabase session token or null
    return (await supabase.auth.getSession()).data.session?.access_token ?? null;
  }
});

// Calculate quote
const quote = await client.quotes.getQuote({
  page_count: 10,
  copies: 2,
  color_mode: 'bw',
  binding: 'corner_staple',
  priority_tier: 'flexible'
});

// Create print job with idempotency key
const job = await client.jobs.create(
  {
    shop_id: 'shop-uuid',
    customer_id: 'customer-uuid',
    document_storage_key: 'uploads/file-123.pdf',
    settings: { ... },
    priority_tier: 'urgent'
  },
  { idempotencyKey: crypto.randomUUID() }
);
```
