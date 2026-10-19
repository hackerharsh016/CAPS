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
