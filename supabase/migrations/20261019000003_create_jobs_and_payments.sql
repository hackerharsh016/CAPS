-- ==============================================================================
-- CAPS Migration 003: Print Jobs, Payments, and Priority Queue Schema with RLS
-- Migration ID: 20261019000003_create_jobs_and_payments.sql
-- Description: Establishes print jobs with storage keys, immutable settings,
--              two-tier priority, price breakdown in paise, enqueued timestamps,
--              state machines, payment transactions, uniqueness, and RLS policies.
-- ==============================================================================

-- 1. Custom Domain Enums
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'priority_tier') THEN
        CREATE TYPE public.priority_tier AS ENUM ('urgent', 'flexible');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
        CREATE TYPE public.job_status AS ENUM (
            'pending_payment',
            'queued',
            'approved',
            'claimed',
            'downloading',
            'printing',
            'completed',
            'failed',
            'cancelled',
            'requires_review'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
        CREATE TYPE public.payment_method AS ENUM ('upi', 'card', 'wallet', 'pay_at_counter');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
        CREATE TYPE public.payment_status AS ENUM ('initiated', 'success', 'failed', 'refunded');
    END IF;
END $$;

-- 2. Print Jobs Table
-- The fundamental immutable unit of work: customer document, configuration snapshot, pricing, and queue state
CREATE TABLE IF NOT EXISTS public.print_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    printer_id UUID REFERENCES public.printers(id) ON DELETE SET NULL,
    document_storage_key TEXT NOT NULL CHECK (char_length(trim(document_storage_key)) >= 1),
    settings JSONB NOT NULL,
    priority_tier public.priority_tier NOT NULL DEFAULT 'flexible'::public.priority_tier,
    price_total_paise INTEGER NOT NULL CHECK (price_total_paise > 0),
    price_breakdown JSONB NOT NULL,
    status public.job_status NOT NULL DEFAULT 'pending_payment'::public.job_status,
    enqueued_at TIMESTAMPTZ,
    document_expires_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc'::text, now()) + INTERVAL '24 hours'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.print_jobs IS 'Print jobs representing user-configured print requests in the two-tier shop queue.';
COMMENT ON COLUMN public.print_jobs.document_storage_key IS 'Private object storage key in encrypted Supabase/S3 bucket; never a public URL.';
COMMENT ON COLUMN public.print_jobs.price_total_paise IS 'Final total payable in integer paise (1 INR = 100 paise).';
COMMENT ON COLUMN public.print_jobs.enqueued_at IS 'Timestamp when payment was verified and job entered the active FIFO queue tier.';
COMMENT ON COLUMN public.print_jobs.document_expires_at IS 'Automatic privacy deletion deadline for private document storage.';

-- Trigger for print_jobs updated_at
DROP TRIGGER IF EXISTS trg_print_jobs_updated_at ON public.print_jobs;
CREATE TRIGGER trg_print_jobs_updated_at
    BEFORE UPDATE ON public.print_jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- Trigger for automatic enqueued_at assignment on entering 'queued' state
CREATE OR REPLACE FUNCTION public.handle_job_enqueue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'queued'::public.job_status AND OLD.status != 'queued'::public.job_status AND NEW.enqueued_at IS NULL THEN
        NEW.enqueued_at = timezone('utc'::text, now());
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_print_jobs_enqueued_at ON public.print_jobs;
CREATE TRIGGER trg_print_jobs_enqueued_at
    BEFORE UPDATE ON public.print_jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_job_enqueue();

-- 3. Payments Table
-- Financial records with gateway transaction references and integer paise amounts
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    print_job_id UUID NOT NULL REFERENCES public.print_jobs(id) ON DELETE CASCADE,
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
    method public.payment_method NOT NULL,
    gateway_ref TEXT,
    status public.payment_status NOT NULL DEFAULT 'initiated'::public.payment_status,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_payments_gateway_ref UNIQUE (gateway_ref)
);

COMMENT ON TABLE public.payments IS 'Payment transactions tied to print jobs, with idempotency references for gateway webhooks.';
COMMENT ON COLUMN public.payments.gateway_ref IS 'Razorpay payment ID or order ID, uniquely indexed for webhook replay protection.';

-- Trigger for payments updated_at
DROP TRIGGER IF EXISTS trg_payments_updated_at ON public.payments;
CREATE TRIGGER trg_payments_updated_at
    BEFORE UPDATE ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- 4. Performance & Queue Ordering Indices
CREATE INDEX IF NOT EXISTS idx_print_jobs_shop_status ON public.print_jobs(shop_id, status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_customer_id ON public.print_jobs(customer_id);
CREATE INDEX IF NOT EXISTS idx_print_jobs_printer_id ON public.print_jobs(printer_id);
CREATE INDEX IF NOT EXISTS idx_print_jobs_document_expires ON public.print_jobs(document_expires_at);

-- Core Two-Tier Priority Queue Index:
-- Fast deterministic ordering: Urgent tier first (0), then Flexible tier (1), strictly ordered by FIFO enqueued_at
CREATE INDEX IF NOT EXISTS idx_print_jobs_two_tier_queue ON public.print_jobs (
    shop_id,
    (CASE priority_tier WHEN 'urgent'::public.priority_tier THEN 0 ELSE 1 END),
    enqueued_at ASC,
    id ASC
) WHERE status = 'queued'::public.job_status;

CREATE INDEX IF NOT EXISTS idx_payments_print_job_id ON public.payments(print_job_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_gateway_ref ON public.payments(gateway_ref) WHERE gateway_ref IS NOT NULL;

-- ==============================================================================
-- 5. Row-Level Security (RLS) Policies
-- ==============================================================================

ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- Print Jobs Policies
-- ------------------------------------------------------------------------------

-- SELECT:
-- 1) Customer can view their own jobs
-- 2) Shop Owner / Operator can view jobs for their shop
-- 3) Admin can view all jobs
CREATE POLICY "print_jobs_select"
    ON public.print_jobs
    FOR SELECT
    USING (
        customer_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.shops s
            WHERE s.id = print_jobs.shop_id AND (s.owner_id = auth.uid() OR public.is_shop_owner_or_member(s.id))
        )
        OR public.is_admin()
    );

-- INSERT:
-- Customers can only insert jobs for themselves, in initial 'pending_payment' status.
-- Direct insertion into 'queued' or 'approved' by client is strictly prevented!
CREATE POLICY "print_jobs_insert_customer"
    ON public.print_jobs
    FOR INSERT
    WITH CHECK (
        (customer_id = auth.uid() AND status = 'pending_payment'::public.job_status)
        OR public.is_admin()
    );

-- UPDATE:
-- 1) Customer can cancel their own job ONLY while still in 'pending_payment' or 'queued'
-- 2) Shop Owner / Operator can update jobs for their shop (e.g. approve job, mark completed/failed)
-- 3) Admin can update any job
CREATE POLICY "print_jobs_update"
    ON public.print_jobs
    FOR UPDATE
    USING (
        (customer_id = auth.uid() AND status IN ('pending_payment'::public.job_status, 'queued'::public.job_status))
        OR EXISTS (
            SELECT 1 FROM public.shops s
            WHERE s.id = print_jobs.shop_id AND (s.owner_id = auth.uid() OR public.is_shop_owner_or_member(s.id))
        )
        OR public.is_admin()
    )
    WITH CHECK (
        (customer_id = auth.uid() AND status = 'cancelled'::public.job_status)
        OR EXISTS (
            SELECT 1 FROM public.shops s
            WHERE s.id = print_jobs.shop_id AND (s.owner_id = auth.uid() OR public.is_shop_owner_or_member(s.id))
        )
        OR public.is_admin()
    );

-- DELETE:
-- Only system admin or background privacy cleaner can delete jobs
CREATE POLICY "print_jobs_delete_admin_only"
    ON public.print_jobs
    FOR DELETE
    USING (public.is_admin());

-- ------------------------------------------------------------------------------
-- Payments Policies
-- ------------------------------------------------------------------------------

-- SELECT:
-- 1) Customer can view payment records for their own jobs
-- 2) Shop Owner can view payments for their shop's jobs
-- 3) Admin can view all payments
CREATE POLICY "payments_select"
    ON public.payments
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.print_jobs pj
            WHERE pj.id = payments.print_job_id AND pj.customer_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.print_jobs pj
            JOIN public.shops s ON s.id = pj.shop_id
            WHERE pj.id = payments.print_job_id AND (s.owner_id = auth.uid() OR public.is_shop_owner_or_member(s.id))
        )
        OR public.is_admin()
    );

-- INSERT:
-- Customers can create an 'initiated' payment record for their own pending job.
-- Clients cannot directly insert a 'success' payment!
CREATE POLICY "payments_insert_customer"
    ON public.payments
    FOR INSERT
    WITH CHECK (
        (
            EXISTS (
                SELECT 1 FROM public.print_jobs pj
                WHERE pj.id = payments.print_job_id
                  AND pj.customer_id = auth.uid()
                  AND pj.status = 'pending_payment'::public.job_status
            )
            AND status = 'initiated'::public.payment_status
        )
        OR public.is_admin()
    );

-- UPDATE:
-- Only system admin or service-role (webhook processor) can update payments to 'success' or 'failed'
CREATE POLICY "payments_update_admin_only"
    ON public.payments
    FOR UPDATE
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- DELETE:
-- Payments cannot be deleted by users; admin only
CREATE POLICY "payments_delete_admin_only"
    ON public.payments
    FOR DELETE
    USING (public.is_admin());
