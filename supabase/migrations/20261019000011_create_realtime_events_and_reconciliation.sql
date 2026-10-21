-- ==============================================================================
-- CAPS Migration 011: Realtime Queue Signals, Event Outbox, and Missed-Event Reconcile
-- Migration ID: 20261019000011_create_realtime_events_and_reconciliation.sql
-- Description: Establishes tenant-filtered realtime queue signals ledger,
--              sequential event sequence numbering, agent wake signals,
--              and atomic delta synchronization RPC for reconnect reconciliation.
-- ==============================================================================

-- 1. Realtime Queue Signals Table (Append-Only Event Ledger)
CREATE TABLE IF NOT EXISTS public.queue_signals (
    id BIGSERIAL PRIMARY KEY,
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK (char_length(trim(channel)) >= 1),
    event_type TEXT NOT NULL CHECK (char_length(trim(event_type)) >= 1),
    job_id UUID REFERENCES public.print_jobs(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT chk_queue_signals_no_raw_doc CHECK (
        NOT (
            payload ? 'raw_document' OR
            payload ? 'document_data' OR
            payload ? 'file_bytes' OR
            payload ? 'pdf_content' OR
            payload ? 'service_role_key' OR
            payload ? 'password'
        )
    )
);

COMMENT ON TABLE public.queue_signals IS 'Append-only ledger of tenant-filtered queue signals and realtime wake notifications.';
COMMENT ON COLUMN public.queue_signals.channel IS 'Realtime broadcast channel (e.g. shop:<shop_id>:agent, shop:<shop_id>:queue, customer:<customer_id>).';
COMMENT ON COLUMN public.queue_signals.event_type IS 'Domain event type (AGENT_WAKE, JOB_STATUS_CHANGED, QUEUE_REORDERED, QUEUE_ETA_REFRESH).';
COMMENT ON COLUMN public.queue_signals.payload IS 'Sanitized signal payload without document binaries or service-role keys.';

-- 2. Performance Indexes for Tenant Isolation and Cursor-Based Reconciliation
CREATE INDEX IF NOT EXISTS idx_queue_signals_shop_cursor
    ON public.queue_signals (shop_id, id ASC);

CREATE INDEX IF NOT EXISTS idx_queue_signals_shop_created
    ON public.queue_signals (shop_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_queue_signals_channel
    ON public.queue_signals (channel, id ASC);

CREATE INDEX IF NOT EXISTS idx_queue_signals_job_id
    ON public.queue_signals (job_id) WHERE job_id IS NOT NULL;

-- 3. Immutability Trigger for Queue Signals
CREATE OR REPLACE FUNCTION public.prevent_queue_signals_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION 'Table queue_signals is an immutable ledger; updates and deletions are forbidden.'
        USING ERRCODE = '23505';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_queue_signals_mutation ON public.queue_signals;
CREATE TRIGGER trg_prevent_queue_signals_mutation
    BEFORE UPDATE OR DELETE ON public.queue_signals
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_queue_signals_mutation();

-- 4. Atomic Missed-Events Delta Sync Function
CREATE OR REPLACE FUNCTION public.get_missed_queue_signals(
    p_shop_id UUID,
    p_after_id BIGINT DEFAULT 0,
    p_limit INT DEFAULT 100
)
RETURNS TABLE (
    id BIGINT,
    shop_id UUID,
    channel TEXT,
    event_type TEXT,
    job_id UUID,
    customer_id UUID,
    payload JSONB,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        qs.id,
        qs.shop_id,
        qs.channel,
        qs.event_type,
        qs.job_id,
        qs.customer_id,
        qs.payload,
        qs.created_at
    FROM public.queue_signals qs
    WHERE qs.shop_id = p_shop_id
      AND qs.id > COALESCE(p_after_id, 0)
    ORDER BY qs.id ASC
    LIMIT LEAST(COALESCE(p_limit, 100), 500);
END;
$$;

-- 5. Row Level Security Policies
ALTER TABLE public.queue_signals ENABLE ROW LEVEL SECURITY;

-- Shop Owners can view events for their owned shop
DROP POLICY IF EXISTS p_queue_signals_select_owner ON public.queue_signals;
CREATE POLICY p_queue_signals_select_owner ON public.queue_signals
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.shops s
            WHERE s.id = queue_signals.shop_id
              AND s.owner_id = auth.uid()
        )
    );

-- Customers can view only signals targeting their customer channel
DROP POLICY IF EXISTS p_queue_signals_select_customer ON public.queue_signals;
CREATE POLICY p_queue_signals_select_customer ON public.queue_signals
    FOR SELECT
    USING (
        queue_signals.customer_id = auth.uid()
    );

-- Service Role / Cloud API insert access
DROP POLICY IF EXISTS p_queue_signals_insert_service ON public.queue_signals;
CREATE POLICY p_queue_signals_insert_service ON public.queue_signals
    FOR INSERT
    TO service_role
    WITH CHECK (true);
