-- ==============================================================================
-- CAPS Migration 006: Urgent Cap and Fairness Guard Stored Functions
-- Migration ID: 20261019000006_create_urgent_cap_and_fairness.sql
-- Description: Establishes database functions to enforce hourly urgent caps,
--              queue depth limits, and starvation prevention for flexible jobs (FR-4.1d).
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.check_urgent_cap_and_fairness(
    p_shop_id UUID,
    p_now TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
)
RETURNS TABLE (
    is_allowed BOOLEAN,
    rejection_code TEXT,
    rejection_message TEXT,
    hourly_limit INTEGER,
    hourly_usage INTEGER,
    queue_limit INTEGER,
    current_queued INTEGER,
    retry_after_seconds INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_config JSONB;
    v_hourly_limit INTEGER := NULL;
    v_queue_limit INTEGER := NULL;
    v_fairness_enabled BOOLEAN := FALSE;
    v_fairness_threshold_sec INTEGER := 1800;

    v_hourly_usage INTEGER := 0;
    v_current_queued INTEGER := 0;
    v_earliest_job_time TIMESTAMPTZ := NULL;
    v_oldest_flexible_wait_sec INTEGER := 0;
    v_reset_time TIMESTAMPTZ := NULL;
    v_retry_sec INTEGER := 0;
BEGIN
    -- 1. Fetch shop urgent surcharge config
    SELECT urgent_surcharge_config INTO v_config
    FROM public.shops
    WHERE id = p_shop_id;

    IF v_config IS NULL THEN
        RETURN QUERY SELECT FALSE, 'SHOP_NOT_FOUND', 'Shop not found', NULL::INTEGER, 0, NULL::INTEGER, 0, 0;
        RETURN;
    END IF;

    -- Extract config settings
    IF v_config ? 'max_urgent_jobs_per_hour' AND (v_config->>'max_urgent_jobs_per_hour') IS NOT NULL THEN
        v_hourly_limit := (v_config->>'max_urgent_jobs_per_hour')::INTEGER;
    END IF;

    IF v_config ? 'max_urgent_jobs_in_queue' AND (v_config->>'max_urgent_jobs_in_queue') IS NOT NULL THEN
        v_queue_limit := (v_config->>'max_urgent_jobs_in_queue')::INTEGER;
    END IF;

    IF v_config ? 'fairness_guard_enabled' AND (v_config->>'fairness_guard_enabled') IS NOT NULL THEN
        v_fairness_enabled := (v_config->>'fairness_guard_enabled')::BOOLEAN;
    END IF;

    IF v_config ? 'max_flexible_wait_threshold_seconds' AND (v_config->>'max_flexible_wait_threshold_seconds') IS NOT NULL THEN
        v_fairness_threshold_sec := (v_config->>'max_flexible_wait_threshold_seconds')::INTEGER;
    END IF;

    -- 2. Count hourly usage in rolling window [p_now - 1 hour, p_now]
    SELECT
        COUNT(*)::INTEGER,
        MIN(COALESCE(enqueued_at, created_at))
    INTO
        v_hourly_usage,
        v_earliest_job_time
    FROM public.print_jobs
    WHERE shop_id = p_shop_id
      AND priority_tier = 'urgent'::public.priority_tier
      AND status IN ('queued', 'approved', 'claimed', 'downloading', 'submitted', 'printing', 'completed')
      AND COALESCE(enqueued_at, created_at) >= (p_now - INTERVAL '1 hour')
      AND COALESCE(enqueued_at, created_at) <= p_now;

    -- 3. Count current queued urgent jobs
    SELECT COUNT(*)::INTEGER INTO v_current_queued
    FROM public.print_jobs
    WHERE shop_id = p_shop_id
      AND priority_tier = 'urgent'::public.priority_tier
      AND status = 'queued'::public.job_status;

    -- 4. Check hourly cap
    IF v_hourly_limit IS NOT NULL AND v_hourly_usage >= v_hourly_limit THEN
        IF v_earliest_job_time IS NOT NULL THEN
            v_reset_time := v_earliest_job_time + INTERVAL '1 hour';
            v_retry_sec := GREATEST(1, EXTRACT(EPOCH FROM (v_reset_time - p_now))::INTEGER);
        ELSE
            v_retry_sec := 60;
        END IF;

        RETURN QUERY SELECT
            FALSE,
            'URGENT_CAP_EXCEEDED',
            format('Shop urgent order cap of %s jobs/hour reached. Resumes in %ss.', v_hourly_limit, v_retry_sec),
            v_hourly_limit,
            v_hourly_usage,
            v_queue_limit,
            v_current_queued,
            v_retry_sec;
        RETURN;
    END IF;

    -- 5. Check queue depth limit
    IF v_queue_limit IS NOT NULL AND v_current_queued >= v_queue_limit THEN
        RETURN QUERY SELECT
            FALSE,
            'URGENT_QUEUE_LIMIT_REACHED',
            format('Shop limit of %s concurrent urgent jobs in queue reached.', v_queue_limit),
            v_hourly_limit,
            v_hourly_usage,
            v_queue_limit,
            v_current_queued,
            0;
        RETURN;
    END IF;

    -- 6. Check starvation fairness guard
    IF v_fairness_enabled THEN
        SELECT COALESCE(MAX(EXTRACT(EPOCH FROM (p_now - COALESCE(enqueued_at, created_at)))::INTEGER), 0)
        INTO v_oldest_flexible_wait_sec
        FROM public.print_jobs
        WHERE shop_id = p_shop_id
          AND priority_tier = 'flexible'::public.priority_tier
          AND status = 'queued'::public.job_status;

        IF v_oldest_flexible_wait_sec >= v_fairness_threshold_sec THEN
            RETURN QUERY SELECT
                FALSE,
                'FAIRNESS_GUARD_TRIGGERED',
                format('Urgent tier is temporarily paused to ensure pending flexible orders waiting over %s minutes are printed fairly.', (v_fairness_threshold_sec / 60)::INTEGER),
                v_hourly_limit,
                v_hourly_usage,
                v_queue_limit,
                v_current_queued,
                0;
            RETURN;
        END IF;
    END IF;

    -- All checks pass
    RETURN QUERY SELECT
        TRUE,
        NULL::TEXT,
        NULL::TEXT,
        v_hourly_limit,
        v_hourly_usage,
        v_queue_limit,
        v_current_queued,
        0;
END;
$$;

COMMENT ON FUNCTION public.check_urgent_cap_and_fairness(UUID, TIMESTAMPTZ)
IS 'Atomically validates if an urgent job can be admitted according to hourly, queue depth, and fairness policies (FR-4.1d).';
