-- ==============================================================================
-- CAPS Migration 007: FCM Lifecycle Notification Outbox and Device Tokens Schema
-- Migration ID: 20261019000007_create_notifications_schema.sql
-- Description: Establishes durable notification outbox with deduplication keys,
--              retry tracking, user FCM device token registry, and RLS policies (FR-1.9, FR-4.4).
-- ==============================================================================

-- 1. User FCM Device Tokens Table
CREATE TABLE IF NOT EXISTS public.user_fcm_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    device_token TEXT NOT NULL CHECK (char_length(trim(device_token)) > 0),
    device_type TEXT NOT NULL DEFAULT 'web' CHECK (device_type IN ('web', 'android', 'ios')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_user_fcm_tokens_user_device UNIQUE (user_id, device_token)
);

COMMENT ON TABLE public.user_fcm_tokens IS 'Registered FCM device push tokens for authenticated customer devices.';
COMMENT ON COLUMN public.user_fcm_tokens.is_active IS 'Automatically deactivated upon FCM registration-token-not-registered response.';

-- 2. Notification Outbox Table
CREATE TABLE IF NOT EXISTS public.notification_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dedupe_key TEXT NOT NULL UNIQUE,
    job_id UUID REFERENCES public.print_jobs(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('job_queued', 'job_printing', 'job_ready', 'job_failed', 'job_cancelled')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'duplicate_skipped', 'revoked')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    last_error TEXT,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.notification_outbox IS 'Durable event outbox ensuring idempotent delivery, retry tracking, and deduplication for push notifications.';
COMMENT ON COLUMN public.notification_outbox.dedupe_key IS 'Unique key format <job_id>:<event_type> preventing duplicate push dispatches upon event replays.';

-- 3. Indices
CREATE INDEX IF NOT EXISTS idx_user_fcm_tokens_user_active ON public.user_fcm_tokens(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_user_id ON public.notification_outbox(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_job_id ON public.notification_outbox(job_id);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_status ON public.notification_outbox(status);

-- 4. Row-Level Security (RLS)
ALTER TABLE public.user_fcm_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

-- Customers can view/manage their own tokens
CREATE POLICY user_fcm_tokens_owner_select ON public.user_fcm_tokens
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY user_fcm_tokens_owner_all ON public.user_fcm_tokens
    FOR ALL TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Customers can read their own notification history
CREATE POLICY notification_outbox_owner_select ON public.notification_outbox
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());
