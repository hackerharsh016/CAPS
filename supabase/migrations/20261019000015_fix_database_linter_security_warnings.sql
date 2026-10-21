-- ==============================================================================
-- CAPS Migration 015: Remediate Database Linter Security Warnings
--
-- Remediates:
--   1. rls_policy_always_true (Lint 0024):
--      Restricts overly permissive policies on public.documents and
--      public.queue_signals to 'service_role' so anon and authenticated users
--      cannot bypass RLS.
--
--   2. function_search_path_mutable (Lint 0011):
--      Explicitly pins search_path = public on all 14 functions where search_path
--      was omitted, mitigating search path hijacking / privilege escalation.
--
--   3. anon_security_definer_function_executable (Lint 0028) &
--      authenticated_security_definer_function_executable (Lint 0029):
--      Revokes blanket PUBLIC and anon EXECUTE privileges on SECURITY DEFINER
--      functions to prevent unauthorized exposure via PostgREST RPC.
--      Grants explicit access strictly based on architectural principle of least privilege:
--        - Trigger functions: Revoked from PUBLIC, anon, and authenticated.
--        - Backend & cleanup functions: Granted strictly to service_role and postgres.
--        - Authenticated RPC & RLS helper functions: Revoked from anon, granted to authenticated & service_role.
-- ==============================================================================

-- ==============================================================================
-- 1. Remediate Permissive RLS Policies (Lint 0024)
-- ==============================================================================

-- Restrict public.documents service policy strictly to service_role
DROP POLICY IF EXISTS p_documents_service_all ON public.documents;
CREATE POLICY p_documents_service_all ON public.documents
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Restrict public.queue_signals insert policy strictly to service_role
DROP POLICY IF EXISTS p_queue_signals_insert_service ON public.queue_signals;
CREATE POLICY p_queue_signals_insert_service ON public.queue_signals
    FOR INSERT
    TO service_role
    WITH CHECK (true);


-- ==============================================================================
-- 2. Remediate Mutable Function Search Paths (Lint 0011)
-- ==============================================================================

ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.handle_job_enqueue() SET search_path = public;
ALTER FUNCTION public.prevent_modification_of_immutable_ledger() SET search_path = public;
ALTER FUNCTION public.get_shop_queue(UUID) SET search_path = public;
ALTER FUNCTION public.recalculate_shop_queue_positions(UUID) SET search_path = public;
ALTER FUNCTION public.check_urgent_cap_and_fairness(UUID, TIMESTAMPTZ) SET search_path = public;
ALTER FUNCTION public.enforce_enqueued_at_immutability() SET search_path = public;
ALTER FUNCTION public.get_next_eligible_job(UUID, UUID) SET search_path = public;
ALTER FUNCTION public.get_shop_priority_queue(UUID) SET search_path = public;
ALTER FUNCTION public.claim_job_lease(UUID, UUID, UUID, INTEGER, TEXT) SET search_path = public;
ALTER FUNCTION public.reconcile_expired_job_leases(UUID) SET search_path = public;
ALTER FUNCTION public.generate_agent_pairing_code(UUID, UUID, INTEGER) SET search_path = public;
ALTER FUNCTION public.consume_agent_pairing_code(TEXT, TEXT, TEXT, TEXT, TEXT) SET search_path = public;
ALTER FUNCTION public.prevent_queue_signals_mutation() SET search_path = public;


-- ==============================================================================
-- 3. Remediate SECURITY DEFINER Execution Privileges (Lints 0028 & 0029)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- A. Trigger Functions (Executed solely by PostgreSQL engine, never via RPC)
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_job_enqueue() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_modification_of_immutable_ledger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_enqueued_at_immutability() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_queue_signals_mutation() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- B. Backend Services & Administrative Cleanup Functions
--    (Callable only by Fastify server / pg_cron via service_role, never by end-users)
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_expired_documents_for_cleanup(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_expired_documents_for_cleanup(INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_expired_jobs_for_cleanup(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_expired_jobs_for_cleanup(INTEGER, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_expired_privacy_jobs(TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_expired_privacy_jobs(TIMESTAMPTZ, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.log_and_clear_document_storage(UUID, public.deleted_by_type, public.deletion_reason) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_and_clear_document_storage(UUID, public.deleted_by_type, public.deletion_reason) TO service_role;

REVOKE EXECUTE ON FUNCTION public.log_and_purge_document(UUID, public.deleted_by_type, public.deletion_reason) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_and_purge_document(UUID, public.deleted_by_type, public.deletion_reason) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reconcile_expired_job_leases(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_expired_job_leases(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_job_lease(UUID, UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_job_lease(UUID, UUID, UUID, INTEGER, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.consume_agent_pairing_code(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_agent_pairing_code(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_next_eligible_job(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_eligible_job(UUID, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_missed_queue_signals(UUID, BIGINT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_missed_queue_signals(UUID, BIGINT, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_job_event(UUID, UUID, public.actor_type, UUID, public.job_status, public.job_status, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_job_event(UUID, UUID, public.actor_type, UUID, public.job_status, public.job_status, TEXT, JSONB) TO service_role;

REVOKE EXECUTE ON FUNCTION public.check_urgent_cap_and_fairness(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_urgent_cap_and_fairness(UUID, TIMESTAMPTZ) TO service_role;

REVOKE EXECUTE ON FUNCTION public.recalculate_shop_queue_positions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_shop_queue_positions(UUID) TO service_role;

-- ------------------------------------------------------------------------------
-- C. Dashboard / Client RPC Functions
--    (Callable by authenticated shop owners / operators, blocked for anonymous users)
--    Converted to SECURITY INVOKER so execution respects caller RLS policies
--    and eliminates lint 0029 (authenticated_security_definer_function_executable)
-- ------------------------------------------------------------------------------
ALTER FUNCTION public.generate_agent_pairing_code(UUID, UUID, INTEGER) SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.generate_agent_pairing_code(UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_agent_pairing_code(UUID, UUID, INTEGER) TO authenticated, service_role;

ALTER FUNCTION public.resolve_unresolved_job(UUID, TEXT, UUID, TEXT) SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.resolve_unresolved_job(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_unresolved_job(UUID, TEXT, UUID, TEXT) TO authenticated, service_role;

ALTER FUNCTION public.get_shop_queue(UUID) SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.get_shop_queue(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shop_queue(UUID) TO authenticated, service_role;

ALTER FUNCTION public.get_shop_priority_queue(UUID) SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.get_shop_priority_queue(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shop_priority_queue(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- D. RLS Predicate Security Functions
--    (Evaluated within row-level security expressions, blocked for anonymous RPC)
--    Converted to SECURITY INVOKER so evaluation runs with invoking session
--    and eliminates lint 0029 (authenticated_security_definer_function_executable)
-- ------------------------------------------------------------------------------
ALTER FUNCTION public.current_user_role() SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;

ALTER FUNCTION public.is_admin() SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

ALTER FUNCTION public.is_shop_owner_or_member(UUID) SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.is_shop_owner_or_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_shop_owner_or_member(UUID) TO authenticated, service_role;

ALTER FUNCTION public.is_device_unrevoked(UUID) SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.is_device_unrevoked(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_device_unrevoked(UUID) TO authenticated, service_role;
