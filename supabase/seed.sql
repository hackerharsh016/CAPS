-- ==============================================================================
-- CAPS Seed Data: Local development and test fixtures
-- ==============================================================================

-- 1. Create Mock Auth Users (required when testing in local Supabase)
INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
)
VALUES
    (
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'admin@caps.internal',
        crypt('AdminPassword123!', gen_salt('bf')),
        now(),
        '{"provider": "email", "providers": ["email"]}'::jsonb,
        '{"role": "admin", "name": "System Administrator", "phone": "+919876543210"}'::jsonb,
        now(),
        now()
    ),
    (
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'owner@quickprint.com',
        crypt('OwnerPassword123!', gen_salt('bf')),
        now(),
        '{"provider": "email", "providers": ["email"]}'::jsonb,
        '{"role": "shop_owner", "name": "Rajesh Sharma", "phone": "+919876543211"}'::jsonb,
        now(),
        now()
    ),
    (
        '00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'customer@student.edu',
        crypt('CustomerPassword123!', gen_salt('bf')),
        now(),
        '{"provider": "email", "providers": ["email"]}'::jsonb,
        '{"role": "customer", "name": "Aarav Patel", "phone": "+919876543212"}'::jsonb,
        now(),
        now()
    ),
    (
        '00000000-0000-0000-0000-000000000004',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'operator@quickprint.com',
        crypt('OperatorPassword123!', gen_salt('bf')),
        now(),
        '{"provider": "email", "providers": ["email"]}'::jsonb,
        '{"role": "customer", "name": "Sunil Operator", "phone": "+919876543213"}'::jsonb,
        now(),
        now()
    )
ON CONFLICT (id) DO NOTHING;

-- 2. Explicit User Profiles (guaranteeing exact roles if auth trigger was skipped)
INSERT INTO public.profiles (id, role, name, phone, email)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'admin', 'System Administrator', '+919876543210', 'admin@caps.internal'),
    ('00000000-0000-0000-0000-000000000002', 'shop_owner', 'Rajesh Sharma', '+919876543211', 'owner@quickprint.com'),
    ('00000000-0000-0000-0000-000000000003', 'customer', 'Aarav Patel', '+919876543212', 'customer@student.edu'),
    ('00000000-0000-0000-0000-000000000004', 'customer', 'Sunil Operator', '+919876543213', 'operator@quickprint.com')
ON CONFLICT (id) DO UPDATE SET
    role = EXCLUDED.role,
    name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    email = EXCLUDED.email;

-- 3. Demo Printing Outlet: Campus QuickPrint Xerox
INSERT INTO public.shops (
    id,
    owner_id,
    name,
    address,
    geo_lat,
    geo_lng,
    status,
    pricing_config,
    urgent_surcharge_config,
    auto_print_enabled
)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    '00000000-0000-0000-0000-000000000002',
    'Campus QuickPrint Xerox',
    'Shop No. 4, Student Union Complex, North Campus, Pune',
    18.5204303,
    73.8567437,
    'open',
    '{
        "A4": {
            "bw_single_paise": 200,
            "bw_double_paise": 300,
            "color_single_paise": 1000,
            "color_double_paise": 1800
        },
        "A3": {
            "bw_single_paise": 500,
            "bw_double_paise": 800,
            "color_single_paise": 2000,
            "color_double_paise": 3500
        },
        "Legal": {
            "bw_single_paise": 300,
            "bw_double_paise": 450,
            "color_single_paise": 1500,
            "color_double_paise": 2500
        },
        "binding_prices_paise": {
            "none": 0,
            "spiral": 4000,
            "staple": 500,
            "lamination": 3000
        },
        "gst_percentage": 18
    }'::jsonb,
    '{
        "type": "flat",
        "amount": 2000,
        "max_urgent_jobs_per_hour": 10
    }'::jsonb,
    false
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    pricing_config = EXCLUDED.pricing_config,
    urgent_surcharge_config = EXCLUDED.urgent_surcharge_config;

-- 4. Shop Staff Delegation
INSERT INTO public.shop_members (
    id,
    shop_id,
    user_id,
    role
)
VALUES (
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    '00000000-0000-0000-0000-000000000004',
    'operator'
)
ON CONFLICT (shop_id, user_id) DO NOTHING;

-- 5. Demo Registered Agent Device
INSERT INTO public.agent_devices (
    id,
    shop_id,
    device_fingerprint,
    device_name,
    agent_version,
    auth_token_hash,
    is_revoked,
    paired_by
)
VALUES (
    '44444444-4444-4444-4444-444444444444',
    '11111111-1111-1111-1111-111111111111',
    'win11-counter-pc-fingerprint-001',
    'Main Shop Windows 11 Counter PC',
    '0.1.0',
    'sha256_mock_device_token_hash_value',
    false,
    '00000000-0000-0000-0000-000000000002'
)
ON CONFLICT (shop_id, device_fingerprint) DO UPDATE SET
    device_name = EXCLUDED.device_name,
    agent_version = EXCLUDED.agent_version;

-- 6. Demo Active Agent Session
INSERT INTO public.agent_sessions (
    id,
    device_id,
    shop_id,
    agent_version,
    session_status
)
VALUES (
    '55555555-5555-5555-5555-555555555555',
    '44444444-4444-4444-4444-444444444444',
    '11111111-1111-1111-1111-111111111111',
    '0.1.0',
    'online'
)
ON CONFLICT (id) DO NOTHING;

-- 7. Demo Shop Physical Printers
INSERT INTO public.printers (
    id,
    shop_id,
    device_id,
    name,
    role,
    status,
    is_default,
    capabilities
)
VALUES
    (
        '66666666-6666-6666-6666-666666666661',
        '11111111-1111-1111-1111-111111111111',
        '44444444-4444-4444-4444-444444444444',
        'Canon imageRUNNER 2520 B/W',
        'bw',
        'online',
        true,
        '{
            "paper_sizes": ["a4", "a3", "legal"],
            "color_modes": ["bw"],
            "duplex_supported": true,
            "max_copies": 99
        }'::jsonb
    ),
    (
        '66666666-6666-6666-6666-666666666662',
        '11111111-1111-1111-1111-111111111111',
        '44444444-4444-4444-4444-444444444444',
        'Epson EcoTank L805 Color',
        'color',
        'online',
        false,
        '{
            "paper_sizes": ["a4", "legal"],
            "color_modes": ["bw", "color"],
            "duplex_supported": false,
            "max_copies": 50
        }'::jsonb
    )
ON CONFLICT (shop_id, name) DO UPDATE SET
    role = EXCLUDED.role,
    status = EXCLUDED.status,
    capabilities = EXCLUDED.capabilities;

-- 8. Demo Print Jobs (Queued Flexible, Queued Urgent, and Pending Payment)
INSERT INTO public.print_jobs (
    id,
    shop_id,
    customer_id,
    printer_id,
    document_storage_key,
    settings,
    priority_tier,
    price_total_paise,
    price_breakdown,
    status,
    enqueued_at
)
VALUES
    (
        '77777777-7777-7777-7777-777777777771',
        '11111111-1111-1111-1111-111111111111',
        '00000000-0000-0000-0000-000000000003',
        '66666666-6666-6666-6666-666666666661',
        'private/docs/sample_assignment_flexible.pdf',
        '{
            "paper_size": "a4",
            "color_mode": "bw",
            "duplex": "duplex_long",
            "orientation": "portrait",
            "copies": 1,
            "page_range": "all",
            "binding": "none"
        }'::jsonb,
        'flexible',
        354,
        '{
            "base_pages_paise": 300,
            "color_surcharge_paise": 0,
            "duplex_discount_paise": 0,
            "binding_fee_paise": 0,
            "urgent_surcharge_paise": 0,
            "subtotal_paise": 300,
            "gst_paise": 54,
            "total_paise": 354
        }'::jsonb,
        'queued',
        now() - INTERVAL '10 minutes'
    ),
    (
        '77777777-7777-7777-7777-777777777772',
        '11111111-1111-1111-1111-111111111111',
        '00000000-0000-0000-0000-000000000003',
        '66666666-6666-6666-6666-666666666661',
        'private/docs/sample_urgent_lab_report.pdf',
        '{
            "paper_size": "a4",
            "color_mode": "bw",
            "duplex": "simplex",
            "orientation": "portrait",
            "copies": 2,
            "page_range": "1-5",
            "binding": "staple"
        }'::jsonb,
        'urgent',
        2950,
        '{
            "base_pages_paise": 200,
            "color_surcharge_paise": 0,
            "duplex_discount_paise": 0,
            "binding_fee_paise": 500,
            "urgent_surcharge_paise": 2000,
            "subtotal_paise": 2700,
            "gst_paise": 250,
            "total_paise": 2950
        }'::jsonb,
        'queued',
        now() - INTERVAL '2 minutes'
    )
ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    price_total_paise = EXCLUDED.price_total_paise;

-- 9. Demo Payments
INSERT INTO public.payments (
    id,
    print_job_id,
    amount_paise,
    currency,
    method,
    gateway_ref,
    status
)
VALUES
    (
        '88888888-8888-8888-8888-888888888881',
        '77777777-7777-7777-7777-777777777771',
        354,
        'INR',
        'upi',
        'pay_rzp_mock_demo_001',
        'success'
    ),
    (
        '88888888-8888-8888-8888-888888888882',
        '77777777-7777-7777-7777-777777777772',
        2950,
        'INR',
        'upi',
        'pay_rzp_mock_demo_002',
        'success'
    )
ON CONFLICT (id) DO NOTHING;

-- Add a completed print job whose private document has already been purged for privacy
INSERT INTO public.print_jobs (
    id,
    shop_id,
    customer_id,
    printer_id,
    document_storage_key,
    settings,
    priority_tier,
    price_total_paise,
    price_breakdown,
    status,
    enqueued_at,
    document_expires_at
)
VALUES (
    '77777777-7777-7777-7777-777777777773',
    '11111111-1111-1111-1111-111111111111',
    '00000000-0000-0000-0000-000000000003',
    '66666666-6666-6666-6666-666666666661',
    '[PURGED]',
    '{
        "paper_size": "a4",
        "color_mode": "bw",
        "duplex": "simplex",
        "orientation": "portrait",
        "copies": 1,
        "page_range": "1",
        "binding": "none"
    }'::jsonb,
    'flexible',
    100,
    '{
        "base_pages_paise": 100,
        "color_surcharge_paise": 0,
        "duplex_discount_paise": 0,
        "binding_fee_paise": 0,
        "urgent_surcharge_paise": 0,
        "subtotal_paise": 100,
        "gst_paise": 18,
        "total_paise": 118
    }'::jsonb,
    'completed',
    now() - INTERVAL '3 hours',
    now() - INTERVAL '1 hour'
)
ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    document_storage_key = EXCLUDED.document_storage_key;

INSERT INTO public.payments (
    id,
    print_job_id,
    amount_paise,
    currency,
    method,
    gateway_ref,
    status
)
VALUES (
    '88888888-8888-8888-8888-888888888883',
    '77777777-7777-7777-7777-777777777773',
    118,
    'INR',
    'upi',
    'pay_rzp_mock_demo_003',
    'success'
)
ON CONFLICT (id) DO NOTHING;

-- 10. Demo Job Execution Attempts
INSERT INTO public.job_attempts (
    id,
    job_id,
    printer_id,
    agent_device_id,
    lease_token,
    lease_expires_at,
    spooler_job_id,
    idempotency_key,
    status
)
VALUES
    (
        '99999999-9999-9999-9999-999999999991',
        '77777777-7777-7777-7777-777777777773',
        '66666666-6666-6666-6666-666666666661',
        '44444444-4444-4444-4444-444444444444',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        now() - INTERVAL '2 hours',
        101,
        'idem_demo_attempt_completed_001',
        'completed'
    ),
    (
        '99999999-9999-9999-9999-999999999992',
        '77777777-7777-7777-7777-777777777772',
        '66666666-6666-6666-6666-666666666661',
        '44444444-4444-4444-4444-444444444444',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        now() + INTERVAL '5 minutes',
        102,
        'idem_demo_attempt_active_002',
        'printing'
    )
ON CONFLICT (job_id, idempotency_key) DO UPDATE SET
    status = EXCLUDED.status,
    spooler_job_id = EXCLUDED.spooler_job_id;

-- 11. Demo Job Events (Immutable Audit Ledger)
INSERT INTO public.job_events (
    job_id,
    attempt_id,
    actor_type,
    actor_id,
    from_status,
    to_status,
    event_name,
    metadata
)
VALUES
    (
        '77777777-7777-7777-7777-777777777773',
        NULL,
        'customer',
        '00000000-0000-0000-0000-000000000003',
        'pending_payment',
        'queued',
        'payment_confirmed',
        '{"gateway_ref": "pay_rzp_mock_demo_003", "amount_paise": 118}'::jsonb
    ),
    (
        '77777777-7777-7777-7777-777777777773',
        '99999999-9999-9999-9999-999999999991',
        'agent',
        NULL,
        'queued',
        'claimed',
        'job_claimed_by_agent',
        '{"device_id": "44444444-4444-4444-4444-444444444444", "lease_token": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}'::jsonb
    ),
    (
        '77777777-7777-7777-7777-777777777773',
        '99999999-9999-9999-9999-999999999991',
        'agent',
        NULL,
        'printing',
        'completed',
        'print_job_completed',
        '{"spooler_job_id": 101, "pages_printed": 1}'::jsonb
    );

-- 12. Demo Document Deletion Logs (Privacy Audit Ledger)
INSERT INTO public.document_deletion_logs (
    id,
    job_id,
    document_storage_key,
    deleted_by,
    reason,
    deleted_at
)
VALUES (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    '77777777-7777-7777-7777-777777777773',
    'private/docs/sample_receipt_completed.pdf',
    'agent_post_spool',
    'print_completed',
    now() - INTERVAL '2 hours'
)
ON CONFLICT (id) DO NOTHING;

-- 13. Ensure Private Document Storage Buckets Exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
    (
        'caps-private-documents',
        'caps-private-documents',
        false,
        52428800,
        ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint', 'image/jpeg', 'image/png']::text[]
    ),
    (
        'caps-documents',
        'caps-documents',
        false,
        52428800,
        ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint', 'image/jpeg', 'image/png']::text[]
    )
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

