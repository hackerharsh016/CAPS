-- ==============================================================================
-- CAPS Migration 005: Priority Queue Ordering & Live ETA Functions
-- Migration ID: 20261019000005_create_queue_priority_and_eta.sql
-- Description: Establishes stored procedures and query helpers for the two-tier
--              shop queue discipline (Urgent FIFO ahead of Flexible FIFO),
--              enforcing non-preemption of currently printing jobs.
-- ==============================================================================

-- 1. Helper function: Get prioritized queue view for a shop
-- Orders currently executing jobs first (non-preempted), followed by Urgent jobs FIFO, then Flexible jobs FIFO
CREATE OR REPLACE FUNCTION public.get_shop_queue(p_shop_id UUID)
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

COMMENT ON FUNCTION public.get_shop_queue(UUID) IS 'Returns the authorized non-preemptive two-tier queue for a specific print shop.';

-- 2. Stored procedure: Recalculate dynamic queue_position columns
CREATE OR REPLACE FUNCTION public.recalculate_shop_queue_positions(p_shop_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated_count INTEGER := 0;
BEGIN
    WITH ranked_jobs AS (
        SELECT
            pj.id,
            ROW_NUMBER() OVER (
                ORDER BY
                    (CASE pj.priority_tier WHEN 'urgent'::public.priority_tier THEN 0 ELSE 1 END),
                    pj.enqueued_at ASC,
                    pj.id ASC
            ) AS new_pos
        FROM public.print_jobs pj
        WHERE pj.shop_id = p_shop_id
          AND pj.status = 'queued'::public.job_status
    )
    UPDATE public.print_jobs target
    SET queue_position = ranked_jobs.new_pos,
        updated_at = timezone('utc'::text, now())
    FROM ranked_jobs
    WHERE target.id = ranked_jobs.id
      AND (target.queue_position IS DISTINCT FROM ranked_jobs.new_pos);

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN v_updated_count;
END;
$$;

COMMENT ON FUNCTION public.recalculate_shop_queue_positions(UUID) IS 'Atomically recomputes sequential 1-based queue positions for all queued jobs in a shop.';
