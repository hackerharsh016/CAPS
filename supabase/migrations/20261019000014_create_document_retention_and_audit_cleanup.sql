-- ==============================================================================
-- CAPS Migration 014: Document Retention, Privacy Sweeper & Audit Cleanup
-- Migration ID: 20261019000014_create_document_retention_and_audit_cleanup.sql
-- Description: Establishes automated document retention sweeper procedures,
--              privacy lifecycle rules, immutable deletion audit trail linking,
--              and spooler hardware boundary disclosure.
-- ==============================================================================

-- 1. Extend document_deletion_logs to support standalone document purges
ALTER TABLE public.document_deletion_logs
    ALTER COLUMN job_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'document_deletion_logs'
          AND column_name = 'document_id'
    ) THEN
        ALTER TABLE public.document_deletion_logs
            ADD COLUMN document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_document_deletion_logs_doc_id
    ON public.document_deletion_logs(document_id)
    WHERE document_id IS NOT NULL;

-- 2. Stored Procedure: Comprehensive sweep for expired print jobs
-- Selects jobs where:
--   a) TTL expired regardless of status (failed, cancelled, stuck)
--   b) Terminal status completed/failed/cancelled past terminal retention window (default 30 min)
CREATE OR REPLACE FUNCTION public.get_expired_jobs_for_cleanup(
    p_terminal_retention_minutes INTEGER DEFAULT 30,
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    job_id UUID,
    shop_id UUID,
    customer_id UUID,
    document_storage_key TEXT,
    document_expires_at TIMESTAMPTZ,
    status public.job_status,
    reason public.deletion_reason
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
        document_expires_at,
        status,
        (CASE
            WHEN status = 'completed'::public.job_status THEN 'print_completed'::public.deletion_reason
            WHEN status = 'cancelled'::public.job_status THEN 'job_cancelled'::public.deletion_reason
            ELSE 'retention_expired'::public.deletion_reason
        END) AS reason
    FROM public.print_jobs
    WHERE document_storage_key IS NOT NULL
      AND document_storage_key != '[PURGED]'
      AND (
          -- Rule 1: Hard TTL expiry regardless of outcome
          document_expires_at <= timezone('utc'::text, now())
          OR
          -- Rule 2: Terminal status + retention window
          (
              status IN (
                  'completed'::public.job_status,
                  'failed'::public.job_status,
                  'cancelled'::public.job_status,
                  'requires_review'::public.job_status
              )
              AND updated_at + (p_terminal_retention_minutes || ' minutes')::INTERVAL <= timezone('utc'::text, now())
          )
      )
    ORDER BY document_expires_at ASC
    LIMIT p_limit;
$$;

-- 3. Stored Procedure: Sweep for standalone expired documents
DROP FUNCTION IF EXISTS public.get_expired_documents_for_cleanup(INTEGER);

CREATE OR REPLACE FUNCTION public.get_expired_documents_for_cleanup(
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    document_id UUID,
    customer_id UUID,
    storage_key TEXT,
    converted_storage_key TEXT,
    expires_at TIMESTAMPTZ,
    status public.document_status
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        id AS document_id,
        customer_id,
        storage_key,
        converted_storage_key,
        expires_at,
        status
    FROM public.documents
    WHERE status <> 'purged'::public.document_status
      AND expires_at <= timezone('utc'::text, now())
    ORDER BY expires_at ASC
    LIMIT p_limit;
$$;

-- 4. Atomic Procedure: Purge standalone document record and log audit trace
CREATE OR REPLACE FUNCTION public.log_and_purge_document(
    p_document_id UUID,
    p_deleted_by public.deleted_by_type,
    p_reason public.deletion_reason
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_storage_key TEXT;
    v_log_id UUID;
BEGIN
    SELECT storage_key INTO v_storage_key
    FROM public.documents
    WHERE id = p_document_id;

    IF v_storage_key IS NULL THEN
        RAISE EXCEPTION 'Document % not found', p_document_id;
    END IF;

    -- Update document status to purged
    UPDATE public.documents
    SET status = 'purged'::public.document_status,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_document_id;

    -- Insert permanent immutable privacy audit record
    INSERT INTO public.document_deletion_logs (
        document_id,
        document_storage_key,
        deleted_by,
        reason
    )
    VALUES (
        p_document_id,
        v_storage_key,
        p_deleted_by,
        p_reason
    )
    RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$$;

COMMENT ON FUNCTION public.get_expired_jobs_for_cleanup IS 'Finds print jobs with expired documents past terminal retention (30m) or hard TTL (24h).';
COMMENT ON FUNCTION public.get_expired_documents_for_cleanup IS 'Finds raw and converted document records past TTL requiring cloud object destruction.';
COMMENT ON FUNCTION public.log_and_purge_document IS 'Atomically marks document purged and writes immutable deletion audit record.';
