-- ==============================================================================
-- CAPS Migration 019: Add idempotency_key Column to Print Jobs
-- Migration ID: 20261019000019_add_idempotency_key_to_print_jobs.sql
-- Description: Adds idempotency_key column to public.print_jobs to support
--              client-side idempotent retries and double-click protection.
-- ==============================================================================

ALTER TABLE public.print_jobs
ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE INDEX IF NOT EXISTS idx_print_jobs_idempotency_key
ON public.print_jobs (idempotency_key, customer_id)
WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.print_jobs.idempotency_key IS 'Unique client-supplied token to guarantee order creation idempotency.';
