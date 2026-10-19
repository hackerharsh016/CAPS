-- ==============================================================================
-- CAPS pgTAP Integration & RLS Test Suite: Print Jobs, Payments & Tenant Isolation
-- ==============================================================================

BEGIN;

-- 1. Plan the test cases
SELECT plan(20);

-- ------------------------------------------------------------------------------
-- Schema & Table Structure Tests
-- ------------------------------------------------------------------------------

-- Test 1-2: Table Existence
SELECT has_table('public', 'print_jobs', 'print_jobs table must exist');
SELECT has_table('public', 'payments', 'payments table must exist');

-- Test 3-6: Key Column Assertions
SELECT has_column('public', 'print_jobs', 'document_storage_key', 'print_jobs must have document_storage_key');
SELECT has_column('public', 'print_jobs', 'price_breakdown', 'print_jobs must have price_breakdown JSONB');
SELECT has_column('public', 'print_jobs', 'priority_tier', 'print_jobs must have priority_tier');
SELECT has_column('public', 'payments', 'gateway_ref', 'payments must have gateway_ref');

-- Test 7-9: Foreign Keys
SELECT col_is_fk('public', 'print_jobs', 'shop_id', 'print_jobs.shop_id must be a foreign key');
SELECT col_is_fk('public', 'print_jobs', 'customer_id', 'print_jobs.customer_id must be a foreign key');
SELECT col_is_fk('public', 'payments', 'print_job_id', 'payments.print_job_id must be a foreign key');

-- Test 10-11: RLS Enabled Verification
SELECT ok(
    (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'print_jobs'),
    'print_jobs table must have RLS enabled'
);
SELECT ok(
    (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'payments'),
    'payments table must have RLS enabled'
);

-- ------------------------------------------------------------------------------
-- Data Integrity, Default Values & Constraint Tests
-- ------------------------------------------------------------------------------

-- Test 12: Column defaults verification
SELECT col_default_is('public', 'print_jobs', 'priority_tier', "'flexible'::public.priority_tier", 'Default priority_tier must be flexible');
SELECT col_default_is('public', 'print_jobs', 'status', "'pending_payment'::public.job_status", 'Default job status must be pending_payment');
SELECT col_default_is('public', 'payments', 'status', "'initiated'::public.payment_status", 'Default payment status must be initiated');

-- Test 13: Positive price constraint check
PREPARE zero_price_job AS
    INSERT INTO public.print_jobs (shop_id, customer_id, document_storage_key, settings, price_total_paise, price_breakdown)
    VALUES ('33331111-0000-0000-0000-000000000001', '33330000-0000-0000-0000-000000000001', 'keys/test.pdf', '{}'::jsonb, 0, '{}'::jsonb);
SELECT throws_ok(
    'zero_price_job',
    23514, -- check_violation
    NULL,
    'Jobs with price_total_paise <= 0 must be rejected by check constraint'
);

-- ------------------------------------------------------------------------------
-- RLS Tenant Boundaries & Replay Protection Tests
-- ------------------------------------------------------------------------------

-- Setup users, shop, and jobs for testing
INSERT INTO auth.users (id, email) VALUES
    ('77770000-0000-0000-0000-000000000001', 'customer_1@test.com'),
    ('77770000-0000-0000-0000-000000000002', 'customer_2@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, role, name, phone, email) VALUES
    ('77770000-0000-0000-0000-000000000001', 'customer', 'Customer 1', '9998881111', 'customer_1@test.com'),
    ('77770000-0000-0000-0000-000000000002', 'customer', 'Customer 2', '9998882222', 'customer_2@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.print_jobs (
    id, shop_id, customer_id, document_storage_key, settings, priority_tier, price_total_paise, price_breakdown, status
) VALUES (
    '88880000-0000-0000-0000-000000000001',
    '33331111-0000-0000-0000-000000000001',
    '77770000-0000-0000-0000-000000000001',
    'documents/test-doc-1.pdf',
    '{"paper_size": "a4", "color_mode": "bw", "copies": 1}'::jsonb,
    'flexible',
    200,
    '{"base_pages_paise": 200, "total_paise": 200}'::jsonb,
    'pending_payment'
) ON CONFLICT (id) DO NOTHING;

-- Test 14: Payment uniqueness / replay protection on gateway_ref
INSERT INTO public.payments (id, print_job_id, amount_paise, method, gateway_ref, status)
VALUES ('99990000-0000-0000-0000-000000000001', '88880000-0000-0000-0000-000000000001', 200, 'upi', 'pay_razorpay_unique_123', 'initiated');

PREPARE duplicate_gateway_ref AS
    INSERT INTO public.payments (id, print_job_id, amount_paise, method, gateway_ref, status)
    VALUES ('99990000-0000-0000-0000-000000000002', '88880000-0000-0000-0000-000000000001', 200, 'upi', 'pay_razorpay_unique_123', 'initiated');
SELECT throws_ok(
    'duplicate_gateway_ref',
    23505, -- unique_violation
    NULL,
    'Duplicate payment gateway_ref must be rejected to prevent webhook replay attacks'
);

-- Test 15: Switch context to Customer 2 - must not see Customer 1 job
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '77770000-0000-0000-0000-000000000002';

SELECT is_empty(
    'SELECT * FROM public.print_jobs WHERE id = ''88880000-0000-0000-0000-000000000001''',
    'Customer 2 must not see Customer 1 print job (RLS isolation)'
);

-- Test 16: Switch context to Customer 1 - CAN see their own job
SET LOCAL "request.jwt.claim.sub" = '77770000-0000-0000-0000-000000000001';
SELECT isnt_empty(
    'SELECT * FROM public.print_jobs WHERE id = ''88880000-0000-0000-0000-000000000001''',
    'Customer 1 must see their own print job'
);

-- Test 17: Customer cannot create a job directly in 'queued' or 'completed' status
PREPARE customer_illegal_queue_insert AS
    INSERT INTO public.print_jobs (shop_id, customer_id, document_storage_key, settings, priority_tier, price_total_paise, price_breakdown, status)
    VALUES (
        '33331111-0000-0000-0000-000000000001',
        '77770000-0000-0000-0000-000000000001',
        'documents/illegal.pdf',
        '{}'::jsonb,
        'urgent',
        500,
        '{}'::jsonb,
        'queued' -- ILLEGAL: must be pending_payment
    );
SELECT throws_ok(
    'customer_illegal_queue_insert',
    42501, -- RLS violation
    NULL,
    'Customer inserting job directly into queued status without verified payment must be denied'
);

-- Test 18: Customer cannot directly insert payment with 'success' status
PREPARE customer_fake_success_payment AS
    INSERT INTO public.payments (print_job_id, amount_paise, method, gateway_ref, status)
    VALUES ('88880000-0000-0000-0000-000000000001', 200, 'upi', 'fake_pay_id_999', 'success');
SELECT throws_ok(
    'customer_fake_success_payment',
    42501, -- RLS violation
    NULL,
    'Client directly forging a payment with success status must be denied by RLS'
);

-- Test 19: Customer CAN cancel their own job while in pending_payment
UPDATE public.print_jobs SET status = 'cancelled' WHERE id = '88880000-0000-0000-0000-000000000001';
SELECT is(
    (SELECT status FROM public.print_jobs WHERE id = '88880000-0000-0000-0000-000000000001'),
    'cancelled'::public.job_status,
    'Customer must be permitted to cancel their own pending job'
);

-- Test 20: Cross-shop owner isolation: Owner Y cannot see Shop X jobs
SET LOCAL "request.jwt.claim.sub" = '33330000-0000-0000-0000-000000000002'; -- Owner Y
SELECT is_empty(
    'SELECT * FROM public.print_jobs WHERE id = ''88880000-0000-0000-0000-000000000001''',
    'Shop Owner Y must not see Shop X jobs'
);

SELECT * FROM finish();
ROLLBACK;
