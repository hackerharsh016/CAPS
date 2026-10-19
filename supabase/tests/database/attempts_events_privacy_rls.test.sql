-- ==============================================================================
-- CAPS pgTAP Integration & RLS Test Suite: Job Attempts, Events & Privacy
-- ==============================================================================

BEGIN;

-- 1. Plan the test cases
SELECT plan(22);

-- ------------------------------------------------------------------------------
-- Schema & Table Structure Tests
-- ------------------------------------------------------------------------------

-- Test 1-3: Table Existence
SELECT has_table('public', 'job_attempts', 'job_attempts table must exist');
SELECT has_table('public', 'job_events', 'job_events table must exist');
SELECT has_table('public', 'document_deletion_logs', 'document_deletion_logs table must exist');

-- Test 4-7: Key Column Assertions
SELECT has_column('public', 'job_attempts', 'lease_token', 'job_attempts must have lease_token');
SELECT has_column('public', 'job_attempts', 'idempotency_key', 'job_attempts must have idempotency_key');
SELECT has_column('public', 'job_attempts', 'spooler_job_id', 'job_attempts must have spooler_job_id');
SELECT has_column('public', 'job_events', 'metadata', 'job_events must have metadata JSONB');

-- Test 8-10: Foreign Keys
SELECT col_is_fk('public', 'job_attempts', 'job_id', 'job_attempts.job_id must be a foreign key');
SELECT col_is_fk('public', 'job_attempts', 'printer_id', 'job_attempts.printer_id must be a foreign key');
SELECT col_is_fk('public', 'job_events', 'job_id', 'job_events.job_id must be a foreign key');

-- Test 11-13: RLS Enabled Verification
SELECT ok(
    (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'job_attempts'),
    'job_attempts table must have RLS enabled'
);
SELECT ok(
    (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'job_events'),
    'job_events table must have RLS enabled'
);
SELECT ok(
    (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'document_deletion_logs'),
    'document_deletion_logs table must have RLS enabled'
);

-- ------------------------------------------------------------------------------
-- Concurrency, Idempotency & Privacy Invariants
-- ------------------------------------------------------------------------------

-- Setup test data: users, shop, printer, agent device, and job
INSERT INTO auth.users (id, email) VALUES
    ('66660000-0000-0000-0000-000000000001', 'owner_test@example.com'),
    ('66660000-0000-0000-0000-000000000002', 'cust_a@example.com'),
    ('66660000-0000-0000-0000-000000000003', 'cust_b@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, role, name, phone, email) VALUES
    ('66660000-0000-0000-0000-000000000001', 'shop_owner', 'Owner Test', '9991112222', 'owner_test@example.com'),
    ('66660000-0000-0000-0000-000000000002', 'customer', 'Customer A', '9993334444', 'cust_a@example.com'),
    ('66660000-0000-0000-0000-000000000003', 'customer', 'Customer B', '9995556666', 'cust_b@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.shops (id, owner_id, name, address, geo_lat, geo_lng, status)
VALUES (
    '55551111-0000-0000-0000-000000000001',
    '66660000-0000-0000-0000-000000000001',
    'Attempt Test Print Shop',
    '123 University Campus',
    12.9716,
    77.5946,
    'open'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.agent_devices (id, shop_id, device_fingerprint, device_name, auth_token_hash, paired_by)
VALUES (
    '55552222-0000-0000-0000-000000000001',
    '55551111-0000-0000-0000-000000000001',
    'fingerprint-test-001',
    'Test Windows PC',
    'token_hash_001',
    '66660000-0000-0000-0000-000000000001'
) ON CONFLICT (shop_id, device_fingerprint) DO NOTHING;

INSERT INTO public.printers (id, shop_id, device_id, name, role, status, is_default, capabilities)
VALUES (
    '55553333-0000-0000-0000-000000000001',
    '55551111-0000-0000-0000-000000000001',
    '55552222-0000-0000-0000-000000000001',
    'HP LaserJet Test',
    'bw',
    'online',
    true,
    '{"paper_sizes": ["a4"], "color_modes": ["bw"], "duplex_supported": true}'::jsonb
) ON CONFLICT (shop_id, name) DO NOTHING;

INSERT INTO public.print_jobs (
    id, shop_id, customer_id, printer_id, document_storage_key, settings, priority_tier, price_total_paise, price_breakdown, status, enqueued_at, document_expires_at
) VALUES (
    '55554444-0000-0000-0000-000000000001',
    '55551111-0000-0000-0000-000000000001',
    '66660000-0000-0000-0000-000000000002',
    '55553333-0000-0000-0000-000000000001',
    'keys/customer-a-doc.pdf',
    '{"paper_size": "a4", "color_mode": "bw", "copies": 1}'::jsonb,
    'urgent',
    500,
    '{"total_paise": 500}'::jsonb,
    'approved',
    now(),
    now() + INTERVAL '2 hours'
) ON CONFLICT (id) DO NOTHING;

-- Test 14: Duplicate attempt prevention with idempotency_key
INSERT INTO public.job_attempts (
    id, job_id, printer_id, agent_device_id, lease_token, lease_expires_at, idempotency_key, status
) VALUES (
    '55555555-0000-0000-0000-000000000001',
    '55554444-0000-0000-0000-000000000001',
    '55553333-0000-0000-0000-000000000001',
    '55552222-0000-0000-0000-000000000001',
    '66666666-0000-0000-0000-000000000001',
    now() + INTERVAL '5 minutes',
    'idem-key-1001',
    'leased'
);

PREPARE duplicate_idempotency_attempt AS
    INSERT INTO public.job_attempts (
        job_id, printer_id, agent_device_id, lease_token, lease_expires_at, idempotency_key, status
    ) VALUES (
        '55554444-0000-0000-0000-000000000001',
        '55553333-0000-0000-0000-000000000001',
        '55552222-0000-0000-0000-000000000001',
        gen_random_uuid(),
        now() + INTERVAL '5 minutes',
        'idem-key-1001',
        'leased'
    );
SELECT throws_ok(
    'duplicate_idempotency_attempt',
    23505, -- unique_violation
    NULL,
    'Duplicate job attempt with identical idempotency_key must be rejected'
);

-- Test 15: Concurrency - Single active lease exclusivity
PREPARE second_active_lease_attempt AS
    INSERT INTO public.job_attempts (
        job_id, printer_id, agent_device_id, lease_token, lease_expires_at, idempotency_key, status
    ) VALUES (
        '55554444-0000-0000-0000-000000000001',
        '55553333-0000-0000-0000-000000000001',
        '55552222-0000-0000-0000-000000000001',
        gen_random_uuid(),
        now() + INTERVAL '5 minutes',
        'idem-key-1002',
        'downloading'
    );
SELECT throws_ok(
    'second_active_lease_attempt',
    23505, -- unique_violation on idx_job_attempts_active_lease
    NULL,
    'Second concurrent active lease for the same job must be rejected by partial unique index'
);

-- Test 16: Zero sensitive PDF / password content in audit event metadata
PREPARE sensitive_doc_in_event AS
    INSERT INTO public.job_events (
        job_id, actor_type, to_status, event_name, metadata
    ) VALUES (
        '55554444-0000-0000-0000-000000000001',
        'agent',
        'printing',
        'print_started',
        '{"pdf_content": "JVBERi0xLjQKJ...", "page_count": 5}'::jsonb
    );
SELECT throws_ok(
    'sensitive_doc_in_event',
    23514, -- check_violation on chk_job_events_no_sensitive_doc
    NULL,
    'Job event metadata containing raw document/PDF content must be rejected by check constraint'
);

-- Test 17: Valid event insertion succeeds
SELECT lives_ok(
    $$
    INSERT INTO public.job_events (
        job_id, attempt_id, actor_type, from_status, to_status, event_name, metadata
    ) VALUES (
        '55554444-0000-0000-0000-000000000001',
        '55555555-0000-0000-0000-000000000001',
        'agent',
        'approved',
        'claimed',
        'job_claimed_by_agent',
        '{"printer_name": "HP LaserJet Test", "spooler_id": 42}'::jsonb
    )
    $$,
    'Sanitized metadata in job_events must be accepted'
);

-- Test 18: Immutability - Updates on job_events are blocked
PREPARE update_job_event AS
    UPDATE public.job_events SET event_name = 'tampered' WHERE job_id = '55554444-0000-0000-0000-000000000001';
SELECT throws_ok(
    'update_job_event',
    NULL,
    NULL,
    'Updates to immutable job_events audit ledger must raise an exception'
);

-- Test 19: Privacy - Expired documents query returns overdue jobs
-- Insert an expired completed job
INSERT INTO public.print_jobs (
    id, shop_id, customer_id, printer_id, document_storage_key, settings, priority_tier, price_total_paise, price_breakdown, status, document_expires_at
) VALUES (
    '55554444-0000-0000-0000-000000000002',
    '55551111-0000-0000-0000-000000000001',
    '66660000-0000-0000-0000-000000000002',
    '55553333-0000-0000-0000-000000000001',
    'keys/expired-old-doc.pdf',
    '{"copies": 1}'::jsonb,
    'flexible',
    200,
    '{"total_paise": 200}'::jsonb,
    'completed',
    now() - INTERVAL '1 hour'
);

SELECT results_eq(
    $$
    SELECT job_id, document_storage_key
    FROM public.get_expired_documents_for_cleanup(10)
    WHERE job_id = '55554444-0000-0000-0000-000000000002'::UUID
    $$,
    $$
    VALUES ('55554444-0000-0000-0000-000000000002'::UUID, 'keys/expired-old-doc.pdf'::TEXT)
    $$,
    'get_expired_documents_for_cleanup must identify jobs with expired document retention'
);

-- Test 20: Privacy - log_and_clear_document_storage redacts key and writes audit log
SELECT ok(
    (SELECT public.log_and_clear_document_storage(
        '55554444-0000-0000-0000-000000000002'::UUID,
        'cloud_ttl_sweeper'::public.deleted_by_type,
        'retention_expired'::public.deletion_reason
    ) IS NOT NULL),
    'log_and_clear_document_storage must successfully execute and return deletion log ID'
);

-- Test 21: Document key was redacted to [PURGED]
SELECT is(
    (SELECT document_storage_key FROM public.print_jobs WHERE id = '55554444-0000-0000-0000-000000000002'),
    '[PURGED]',
    'Document storage key must be redacted to [PURGED] in print_jobs'
);

-- Test 22: Deletion log entry was persisted in document_deletion_logs
SELECT is(
    (SELECT reason FROM public.document_deletion_logs WHERE job_id = '55554444-0000-0000-0000-000000000002'),
    'retention_expired'::public.deletion_reason,
    'Deletion audit log must record correct reason'
);

SELECT * FROM finish();
ROLLBACK;
