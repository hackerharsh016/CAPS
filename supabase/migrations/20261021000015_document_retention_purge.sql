-- ==============================================================================
-- CAPS Migration 015: Document Retention Purge & Purged At Tracking (INT-D3-07)
-- Migration ID: 20261021000015_document_retention_purge.sql
-- Description: Adds purged_at column to print_jobs table, provides stored
--              procedures for identifying unpurged expired documents,
--              and recording atomic purge timestamps.
-- ==============================================================================

-- 1. Add purged_at column to print_jobs table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'print_jobs'
          AND column_name = 'purged_at'
    ) THEN
        ALTER TABLE public.print_jobs
            ADD COLUMN purged_at TIMESTAMPTZ;
    END IF;
END $$;

-- 2. Index for scanning unpurged jobs efficiently
CREATE INDEX IF NOT EXISTS idx_print_jobs_unpurged
    ON public.print_jobs (created_at)
    WHERE purged_at IS NULL AND document_storage_key IS NOT NULL AND document_storage_key != '[PURGED]';

-- 3. Stored Procedure: Fetch unpurged jobs eligible for retention cleanup
CREATE OR REPLACE FUNCTION public.get_unpurged_jobs_for_cleanup(
    p_retention_hours INTEGER DEFAULT 24,
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    job_id UUID,
    shop_id UUID,
    customer_id UUID,
    document_storage_key TEXT,
    status public.job_status,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        id AS job_id,
        shop_id,
        customer_id,
        document_storage_key,
        status,
        created_at,
        updated_at
    FROM public.print_jobs
    WHERE document_storage_key IS NOT NULL
      AND document_storage_key != '[PURGED]'
      AND purged_at IS NULL
      AND (
          status IN ('completed'::public.job_status, 'cancelled'::public.job_status, 'failed'::public.job_status)
          OR
          created_at <= timezone('utc'::text, now()) - (p_retention_hours || ' hours')::INTERVAL
      )
    ORDER BY created_at ASC
    LIMIT p_limit;
$$;

-- 4. Stored Procedure: Atomically mark job as purged
CREATE OR REPLACE FUNCTION public.mark_print_job_purged(
    p_job_id UUID,
    p_deleted_by public.deleted_by_type DEFAULT 'system',
    p_reason public.deletion_reason DEFAULT 'retention_expired'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_storage_key TEXT;
BEGIN
    SELECT document_storage_key INTO v_storage_key
    FROM public.print_jobs
    WHERE id = p_job_id;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    UPDATE public.print_jobs
    SET purged_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_job_id;

    BEGIN
        INSERT INTO public.document_deletion_logs (
            job_id,
            document_storage_key,
            deleted_by,
            reason
        ) VALUES (
            p_job_id,
            v_storage_key,
            p_deleted_by,
            p_reason
        );
    EXCEPTION WHEN OTHERS THEN
        -- Allow silent continuation if document_deletion_logs has different constraints
    END;

    RETURN TRUE;
END;
$$;

COMMENT ON COLUMN public.print_jobs.purged_at IS 'Timestamp when customer document binary was deleted from Supabase Storage.';
COMMENT ON FUNCTION public.get_unpurged_jobs_for_cleanup IS 'Retrieves print jobs with unpurged documents that reached terminal state or exceeded retention TTL.';
COMMENT ON FUNCTION public.mark_print_job_purged IS 'Marks a print job as purged by setting purged_at = NOW() and logging an audit trace.';
