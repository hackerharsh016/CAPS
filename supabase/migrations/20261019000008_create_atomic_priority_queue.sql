-- ==============================================================================
-- CAPS Migration 008: Atomic Priority Queue Ordering & Concurrency Guards
-- Migration ID: 20261019000008_create_atomic_priority_queue.sql
-- Description: Enforces two-tier priority queue discipline (Urgent before Flexible),
--              strict FIFO ordering within tier by stable immutable enqueued_at,
--              deterministic tie-breaking by job id, non-preemption of active print jobs,
--              dynamic queue positioning, and an atomic RPC for next eligible job
--              using FOR UPDATE SKIP LOCKED.
-- ==============================================================================

-- 1. Immutability trigger: Ensure enqueued_at cannot be mutated or tampered once set
CREATE OR REPLACE FUNCTION public.enforce_enqueued_at_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Once enqueued_at is set, it cannot be modified or cleared
    IF OLD.enqueued_at IS NOT NULL AND NEW.enqueued_at IS DISTINCT FROM OLD.enqueued_at THEN
        RAISE EXCEPTION 'enqueued_at is immutable and cannot be updated once set (job_id: %, old: %, new: %)',
            OLD.id, OLD.enqueued_at, NEW.enqueued_at
            USING ERRCODE = '23514'; -- check_violation
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_enqueued_at_update ON public.print_jobs;
CREATE TRIGGER trg_prevent_enqueued_at_update
    BEFORE UPDATE ON public.print_jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_enqueued_at_immutability();

COMMENT ON FUNCTION public.enforce_enqueued_at_immutability() IS 'Guarantees that job enqueued_at timestamps remain immutable once set.';

-- 2. Composite partial index for high-throughput atomic two-tier queue queries
CREATE INDEX IF NOT EXISTS idx_print_jobs_priority_queue_order
    ON public.print_jobs (
        shop_id,
        (CASE priority_tier WHEN 'urgent' THEN 0 ELSE 1 END),
        enqueued_at ASC,
        id ASC
    )
    WHERE status IN ('queued', 'approved');

-- 3. Atomic RPC: Select next eligible job using row locking with FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.get_next_eligible_job(
    p_shop_id UUID,
    p_printer_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    shop_id UUID,
    customer_id UUID,
    printer_id UUID,
    document_storage_key TEXT,
    settings JSONB,
    priority_tier public.priority_tier,
    price_total_paise INTEGER,
    price_breakdown JSONB,
    status public.job_status,
    enqueued_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        pj.id,
        pj.shop_id,
        pj.customer_id,
        pj.printer_id,
        pj.document_storage_key,
        pj.settings,
        pj.priority_tier,
        pj.price_total_paise,
        pj.price_breakdown,
        pj.status,
        pj.enqueued_at,
        pj.created_at
    FROM public.print_jobs pj
    WHERE pj.shop_id = p_shop_id
      AND pj.status IN ('queued'::public.job_status, 'approved'::public.job_status)
      AND (p_printer_id IS NULL OR pj.printer_id IS NULL OR pj.printer_id = p_printer_id)
    ORDER BY
        (CASE pj.priority_tier WHEN 'urgent'::public.priority_tier THEN 0 ELSE 1 END),
        pj.enqueued_at ASC,
        pj.id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
END;
$$;

COMMENT ON FUNCTION public.get_next_eligible_job(UUID, UUID) IS 'Atomically selects and locks the next highest priority eligible print job for a shop, skipping locked rows to avoid dispatch contention.';

-- 4. Authorized non-preemptive two-tier queue view function
CREATE OR REPLACE FUNCTION public.get_shop_priority_queue(p_shop_id UUID)
RETURNS TABLE (
    id UUID,
    shop_id UUID,
    customer_id UUID,
    printer_id UUID,
    document_storage_key TEXT,
    settings JSONB,
    priority_tier public.priority_tier,
    price_total_paise INTEGER,
    price_breakdown JSONB,
    status public.job_status,
    enqueued_at TIMESTAMPTZ,
    queue_position BIGINT,
    is_currently_executing BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        pj.id,
        pj.shop_id,
        pj.customer_id,
        pj.printer_id,
        pj.document_storage_key,
        pj.settings,
        pj.priority_tier,
        pj.price_total_paise,
        pj.price_breakdown,
        pj.status,
        pj.enqueued_at,
        CASE
            WHEN pj.status IN ('printing'::public.job_status, 'claimed'::public.job_status, 'downloading'::public.job_status) THEN 0
            ELSE ROW_NUMBER() OVER (
                PARTITION BY pj.shop_id
                ORDER BY
                    (CASE pj.priority_tier WHEN 'urgent'::public.priority_tier THEN 0 ELSE 1 END),
                    pj.enqueued_at ASC,
                    pj.id ASC
            )
        END AS queue_position,
        (pj.status IN ('printing'::public.job_status, 'claimed'::public.job_status, 'downloading'::public.job_status)) AS is_currently_executing
    FROM public.print_jobs pj
    WHERE pj.shop_id = p_shop_id
      AND pj.status IN (
          'queued'::public.job_status,
          'approved'::public.job_status,
          'claimed'::public.job_status,
          'downloading'::public.job_status,
          'printing'::public.job_status
      )
    ORDER BY
        (CASE WHEN pj.status IN ('printing'::public.job_status, 'claimed'::public.job_status, 'downloading'::public.job_status) THEN 0 ELSE 1 END),
        (CASE pj.priority_tier WHEN 'urgent'::public.priority_tier THEN 0 ELSE 1 END),
        pj.enqueued_at ASC,
        pj.id ASC;
$$;

COMMENT ON FUNCTION public.get_shop_priority_queue(UUID) IS 'Returns the authorized non-preemptive two-tier queue for a specific print shop with dynamic 1-based positioning.';
