-- ==============================================================================
-- CAPS Migration 017: Add allow_pay_at_counter Column to Shops
-- Migration ID: 20261019000017_add_allow_pay_at_counter_to_shops.sql
-- Description: Adds allow_pay_at_counter boolean column to public.shops table
--              enabling shop owners to toggle cash/counter pay acceptance.
-- ==============================================================================

ALTER TABLE public.shops
ADD COLUMN IF NOT EXISTS allow_pay_at_counter BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.shops.allow_pay_at_counter IS 'Whether customers are allowed to pay cash at counter instead of online prepay.';
