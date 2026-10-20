-- ==============================================================================
-- CAPS Migration 012: Privacy Retention Sweeper & Unresolved Job Reconciliation
-- Migration ID: 20261019000012_create_privacy_cleanup_and_unresolved_rpc.sql
-- Description: Establishes privacy retention queries, deletion audit indexes,
--              and atomic reconciliation RPC for unresolved / requires_review jobs.
-- ==============================================================================

-- 1. Index on print_jobs document expiration for efficient privacy cleanup sweeping
CREATE INDEX IF NOT EXISTS idx_print_jobs_document_expiry
    ON public.print_jobs (document_expires_at)
    WHERE status NOT IN ('draft'::public.job_status);

-- 2. Performance indexes on document deletion logs
CREATE INDEX IF NOT EXISTS idx_document_deletion_logs_job
    ON public.document_deletion_logs (job_id);

CREATE INDEX IF NOT EXISTS idx_document_deletion_logs_deleted_at
    ON public.document_deletion_logs (deleted_at DESC);

-- 3. Atomic Query Function: Identify Expired Documents for Privacy Purging
CREATE OR REPLACE FUNCTION public.get_expired_privacy_jobs(
    p_cutoff TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    p_limit INT DEFAULT 100
)
RETURNS TABLE (
    job_id UUID,
    shop_id UUID,
    document_storage_key TEXT,
    status public.job_status,
    document_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        pj.id AS job_id,
        pj.shop_id,
        pj.document_storage_key,
        pj.status,
        pj.document_expires_at
    FROM public.print_jobs pj
    WHERE (
        pj.document_expires_at <= p_cutoff
        OR pj.status IN ('completed'::public.job_status, 'cancelled'::public.job_status)
    )
      AND NOT EXISTS (
          SELECT 1 FROM public.document_deletion_logs ddl
          WHERE ddl.job_id = pj.id
            AND ddl.document_storage_key = pj.document_storage_key
      )
    ORDER BY pj.document_expires_at ASC
    LIMIT LEAST(COALESCE(p_limit, 100), 500);
END;
$$;

-- 4. Atomic Unresolved Job Reconciliation RPC
-- Prevents uncontrolled duplicate physical printing on uncertain spooler outcomes.
CREATE OR REPLACE FUNCTION public.resolve_unresolved_job(
    p_job_id UUID,
    p_resolution TEXT, -- 'retry', 'cancel', 'mark_completed'
    p_actor_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
    job_id UUID,
    previous_status public.job_status,
    new_status public.job_status,
    resolved_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job RECORD;
    v_new_status public.job_status;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    -- 1. Lock job row
    SELECT * INTO v_job
    FROM public.print_jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Print job % not found', p_job_id
            USING ERRCODE = 'P0002';
    END IF;

    -- 2. Verify job requires review
    IF v_job.status <> 'requires_review'::public.job_status THEN
        RAISE EXCEPTION 'Job % is in status %, only requires_review jobs can be resolved',
            p_job_id, v_job.status
            USING ERRCODE = '22023';
    END IF;

    -- 3. Determine target status
    IF p_resolution = 'retry' THEN
        v_new_status := 'approved'::public.job_status;
    ELSIF p_resolution = 'cancel' THEN
        v_new_status := 'cancelled'::public.job_status;
    ELSIF p_resolution = 'mark_completed' THEN
        v_new_status := 'completed'::public.job_status;
    ELSE
        RAISE EXCEPTION 'Invalid resolution %. Must be retry, cancel, or mark_completed', p_resolution
            USING ERRCODE = '22023';
    END IF;

    -- 4. Update job record
    UPDATE public.print_jobs
    SET
        status = v_new_status,
        updated_at = v_now,
        completed_at = CASE WHEN v_new_status = 'completed' THEN v_now ELSE completed_at END
    WHERE id = p_job_id;

    -- 5. Append immutable event audit log
    INSERT INTO public.job_events (
        job_id,
        actor_type,
        actor_id,
        from_status,
        to_status,
        event_name,
        metadata
    ) VALUES (
        p_job_id,
        'owner'::public.actor_type,
        p_actor_id,
        v_job.status,
        v_new_status,
        'UNRESOLVED_JOB_RESOLVED',
        jsonb_build_object(
            'resolution', p_resolution,
            'notes', p_notes,
            'resolved_at', v_now
        )
    );

    RETURN QUERY
    SELECT
        p_job_id,
        v_job.status,
        v_new_status,
        v_now;
END;
$$;
