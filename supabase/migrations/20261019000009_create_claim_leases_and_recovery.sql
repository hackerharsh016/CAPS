-- ==============================================================================
-- CAPS Migration 009: Exclusive Agent Claim Leases & Expired Lease Recovery
-- Migration ID: 20261019000009_create_claim_leases_and_recovery.sql
-- Description: Establishes atomic transactions for agent claim leases,
--              enforces payment and owner confirmation preconditions,
--              enforces unique active lease per job, and provides
--              reconciliation functions to recover abandoned/expired leases.
-- ==============================================================================

-- 0. Ensure print_jobs has audit claim tracking columns
ALTER TABLE public.print_jobs
    ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS claimed_by_agent_id UUID REFERENCES public.agent_devices(id) ON DELETE SET NULL;

-- 1. Atomic RPC: Claim an approved print job with an exclusive lease
CREATE OR REPLACE FUNCTION public.claim_job_lease(
    p_job_id UUID,
    p_agent_device_id UUID,
    p_printer_id UUID,
    p_lease_duration_seconds INTEGER DEFAULT 120,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS TABLE (
    attempt_id UUID,
    job_id UUID,
    printer_id UUID,
    agent_device_id UUID,
    lease_token UUID,
    lease_expires_at TIMESTAMPTZ,
    status public.attempt_status,
    is_idempotent_replay BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_job RECORD;
    v_agent RECORD;
    v_printer RECORD;
    v_existing_attempt RECORD;
    v_new_attempt_id UUID;
    v_lease_token UUID;
    v_lease_expires TIMESTAMPTZ;
    v_duration INT;
    v_idemp_key TEXT;
BEGIN
    v_duration := COALESCE(p_lease_duration_seconds, 120);
    IF v_duration < 30 THEN v_duration := 30; END IF;
    IF v_duration > 600 THEN v_duration := 600; END IF;

    -- 1. Lock and fetch print job
    SELECT * INTO v_job
    FROM public.print_jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Print job % not found', p_job_id
            USING ERRCODE = 'P0002';
    END IF;

    -- 2. Validate payment precondition
    IF v_job.status = 'pending_payment'::public.job_status THEN
        RAISE EXCEPTION 'Job % is pending payment; unpaid jobs cannot be claimed', p_job_id
            USING ERRCODE = '23514';
    END IF;

    -- 3. Validate owner approval precondition (ADR 0004)
    IF v_job.status != 'approved'::public.job_status THEN
        -- If it's already claimed, check for idempotent replay with same idempotency_key
        IF p_idempotency_key IS NOT NULL THEN
            SELECT * INTO v_existing_attempt
            FROM public.job_attempts
            WHERE job_attempts.job_id = p_job_id
              AND job_attempts.idempotency_key = p_idempotency_key;

            IF FOUND THEN
                RETURN QUERY
                SELECT
                    v_existing_attempt.id,
                    v_existing_attempt.job_id,
                    v_existing_attempt.printer_id,
                    v_existing_attempt.agent_device_id,
                    v_existing_attempt.lease_token,
                    v_existing_attempt.lease_expires_at,
                    v_existing_attempt.status,
                    true AS is_idempotent_replay;
                RETURN;
            END IF;
        END IF;

        RAISE EXCEPTION 'Job % is in status %, only approved jobs can be claimed', p_job_id, v_job.status
            USING ERRCODE = '23514';
    END IF;

    -- 4. Validate agent device
    SELECT * INTO v_agent
    FROM public.agent_devices
    WHERE id = p_agent_device_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agent device % not found', p_agent_device_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_agent.is_revoked THEN
        RAISE EXCEPTION 'Agent device % is revoked and cannot claim jobs', p_agent_device_id
            USING ERRCODE = '23514';
    END IF;

    IF v_agent.shop_id != v_job.shop_id THEN
        RAISE EXCEPTION 'Agent device shop % does not match job shop %', v_agent.shop_id, v_job.shop_id
            USING ERRCODE = '42501';
    END IF;

    -- 5. Validate printer scope
    IF p_printer_id IS NOT NULL THEN
        SELECT * INTO v_printer
        FROM public.printers
        WHERE id = p_printer_id;

        IF NOT FOUND OR v_printer.shop_id != v_job.shop_id THEN
            RAISE EXCEPTION 'Printer % is invalid or does not belong to shop %', p_printer_id, v_job.shop_id
                USING ERRCODE = '23514';
        END IF;

        IF v_printer.status IN ('offline'::public.printer_status, 'error'::public.printer_status) THEN
            RAISE EXCEPTION 'Printer % is in status %, cannot accept claims', p_printer_id, v_printer.status
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- 6. Generate attempt and lease tokens
    v_new_attempt_id := gen_random_uuid();
    v_lease_token := gen_random_uuid();
    v_lease_expires := timezone('utc'::text, now()) + (v_duration || ' seconds')::interval;
    v_idemp_key := COALESCE(p_idempotency_key, v_new_attempt_id::text);

    -- 7. Insert job attempt
    INSERT INTO public.job_attempts (
        id,
        job_id,
        printer_id,
        agent_device_id,
        lease_token,
        lease_expires_at,
        idempotency_key,
        status,
        created_at,
        updated_at
    ) VALUES (
        v_new_attempt_id,
        p_job_id,
        COALESCE(p_printer_id, v_job.printer_id),
        p_agent_device_id,
        v_lease_token,
        v_lease_expires,
        v_idemp_key,
        'leased'::public.attempt_status,
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
    );

    -- 8. Transition print job to claimed
    UPDATE public.print_jobs
    SET status = 'claimed'::public.job_status,
        claimed_at = timezone('utc'::text, now()),
        claimed_by_agent_id = p_agent_device_id,
        printer_id = COALESCE(p_printer_id, v_job.printer_id),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_job_id;

    -- 9. Log audit event
    INSERT INTO public.job_events (
        job_id,
        attempt_id,
        actor_id,
        actor_type,
        from_status,
        to_status,
        event_name,
        metadata
    ) VALUES (
        p_job_id,
        v_new_attempt_id,
        p_agent_device_id,
        'agent'::public.actor_type,
        'approved'::public.job_status,
        'claimed'::public.job_status,
        'job_claimed_by_agent',
        jsonb_build_object(
            'attempt_id', v_new_attempt_id,
            'lease_expires_at', v_lease_expires,
            'printer_id', COALESCE(p_printer_id, v_job.printer_id),
            'reason', 'Exclusive claim lease granted to agent device'
        )
    );

    RETURN QUERY
    SELECT
        v_new_attempt_id,
        p_job_id,
        COALESCE(p_printer_id, v_job.printer_id),
        p_agent_device_id,
        v_lease_token,
        v_lease_expires,
        'leased'::public.attempt_status,
        false AS is_idempotent_replay;
END;
$$;

COMMENT ON FUNCTION public.claim_job_lease IS 'Atomically acquires an exclusive execution claim lease on an approved print job for an authenticated agent.';

-- 2. Stored procedure: Reconcile expired agent claim leases and recover jobs
CREATE OR REPLACE FUNCTION public.reconcile_expired_job_leases(
    p_shop_id UUID DEFAULT NULL
)
RETURNS TABLE (
    reconciled_job_id UUID,
    reconciled_attempt_id UUID,
    previous_attempt_status public.attempt_status,
    new_job_status public.job_status,
    total_attempts_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_rec RECORD;
    v_attempts_count BIGINT;
    v_target_status public.job_status;
BEGIN
    FOR v_rec IN
        SELECT
            ja.id AS attempt_id,
            ja.job_id,
            ja.status AS attempt_status,
            pj.shop_id
        FROM public.job_attempts ja
        JOIN public.print_jobs pj ON pj.id = ja.job_id
        WHERE ja.status IN ('leased'::public.attempt_status, 'downloading'::public.attempt_status)
          AND ja.lease_expires_at < timezone('utc'::text, now())
          AND (p_shop_id IS NULL OR pj.shop_id = p_shop_id)
        FOR UPDATE OF ja, pj
    LOOP
        -- Count prior attempts for this job
        SELECT COUNT(*) INTO v_attempts_count
        FROM public.job_attempts
        WHERE job_id = v_rec.job_id;

        -- Mark expired attempt as failed
        UPDATE public.job_attempts
        SET status = 'failed'::public.attempt_status,
            error_code = 'LEASE_EXPIRED',
            error_message = 'Agent lease expired without completion',
            updated_at = timezone('utc'::text, now())
        WHERE id = v_rec.attempt_id;

        -- If fewer than 3 attempts, recover back to approved for re-claim; otherwise requires review
        IF v_attempts_count < 3 THEN
            v_target_status := 'approved'::public.job_status;
        ELSE
            v_target_status := 'requires_review'::public.job_status;
        END IF;

        UPDATE public.print_jobs
        SET status = v_target_status,
            claimed_at = NULL,
            claimed_by_agent_id = NULL,
            updated_at = timezone('utc'::text, now())
        WHERE id = v_rec.job_id;

        -- Log recovery event
        INSERT INTO public.job_events (
            job_id,
            attempt_id,
            actor_type,
            from_status,
            to_status,
            event_name,
            metadata
        ) VALUES (
            v_rec.job_id,
            v_rec.attempt_id,
            'system'::public.actor_type,
            'claimed'::public.job_status,
            v_target_status,
            'lease_expired_recovered',
            jsonb_build_object(
                'attempt_id', v_rec.attempt_id,
                'total_attempts', v_attempts_count,
                'reason', 'Lease expired; recovered by system reconciliation'
            )
        );

        reconciled_job_id := v_rec.job_id;
        reconciled_attempt_id := v_rec.attempt_id;
        previous_attempt_status := v_rec.attempt_status;
        new_job_status := v_target_status;
        total_attempts_count := v_attempts_count;
        RETURN NEXT;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION public.reconcile_expired_job_leases IS 'Finds abandoned active leases whose expiration deadline has passed, fails the attempt, and recovers the print job for retry or review.';
