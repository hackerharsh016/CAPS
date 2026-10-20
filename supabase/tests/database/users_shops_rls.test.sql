-- ==============================================================================
-- CAPS pgTAP Integration & RLS Test Suite: Users, Profiles, Shops & Tenancy
-- ==============================================================================

BEGIN;

-- 1. Plan the test cases
SELECT plan(18);

-- ------------------------------------------------------------------------------
-- Schema & Table Structure Tests
-- ------------------------------------------------------------------------------

-- Test 1-3: Table Existence
SELECT has_table('public', 'profiles', 'public.profiles table must exist');
SELECT has_table('public', 'shops', 'public.shops table must exist');
SELECT has_table('public', 'shop_members', 'public.shop_members table must exist');

-- Test 4-6: Key Column Assertions
SELECT has_column('public', 'profiles', 'role', 'profiles must have role column');
SELECT has_column('public', 'shops', 'pricing_config', 'shops must have pricing_config JSONB column');
SELECT has_column('public', 'shops', 'urgent_surcharge_config', 'shops must have urgent_surcharge_config JSONB column');

-- Test 7-8: Foreign Keys
SELECT col_is_fk('public', 'shops', 'owner_id', 'shops.owner_id must be a foreign key');
SELECT col_is_fk('public', 'shop_members', 'shop_id', 'shop_members.shop_id must reference shops');

-- Test 9-11: RLS Enabled Verification
SELECT ok(
    (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'profiles'),
    'profiles table must have RLS enabled'
);
SELECT ok(
    (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shops'),
    'shops table must have RLS enabled'
);
SELECT ok(
    (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shop_members'),
    'shop_members table must have RLS enabled'
);

-- ------------------------------------------------------------------------------
-- Data Integrity & Constraint Tests
-- ------------------------------------------------------------------------------

-- Test 12: Latitude boundary check (-90 to 90)
PREPARE bad_lat_insert AS
    INSERT INTO public.shops (owner_id, name, address, geo_lat, geo_lng)
    VALUES ('00000000-0000-0000-0000-000000000002', 'Invalid Lat Shop', '123 Test St', 95.0, 73.0);
SELECT throws_ok(
    'bad_lat_insert',
    23514, -- check_violation
    NULL,
    'Inserting latitude > 90 must trigger check constraint violation'
);

-- Test 13: Longitude boundary check (-180 to 180)
PREPARE bad_lng_insert AS
    INSERT INTO public.shops (owner_id, name, address, geo_lat, geo_lng)
    VALUES ('00000000-0000-0000-0000-000000000002', 'Invalid Lng Shop', '123 Test St', 18.0, 195.0);
SELECT throws_ok(
    'bad_lng_insert',
    23514, -- check_violation
    NULL,
    'Inserting longitude > 180 must trigger check constraint violation'
);

-- ------------------------------------------------------------------------------
-- Row-Level Security (RLS) Isolation Tests
-- ------------------------------------------------------------------------------

-- Setup test users
INSERT INTO auth.users (id, email) VALUES
    ('11110000-0000-0000-0000-000000000001', 'cust_a@test.com'),
    ('11110000-0000-0000-0000-000000000002', 'cust_b@test.com'),
    ('22220000-0000-0000-0000-000000000001', 'owner_a@test.com'),
    ('22220000-0000-0000-0000-000000000002', 'owner_b@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, role, name, phone, email) VALUES
    ('11110000-0000-0000-0000-000000000001', 'customer', 'Customer A', '1234567890', 'cust_a@test.com'),
    ('11110000-0000-0000-0000-000000000002', 'customer', 'Customer B', '1234567891', 'cust_b@test.com'),
    ('22220000-0000-0000-0000-000000000001', 'shop_owner', 'Owner A', '1234567892', 'owner_a@test.com'),
    ('22220000-0000-0000-0000-000000000002', 'shop_owner', 'Owner B', '1234567893', 'owner_b@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.shops (id, owner_id, name, address, geo_lat, geo_lng, status) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22220000-0000-0000-0000-000000000001', 'Shop A', 'Address A', 18.5, 73.8, 'open'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22220000-0000-0000-0000-000000000002', 'Shop B', 'Address B', 18.6, 73.9, 'closed')
ON CONFLICT (id) DO NOTHING;

-- Test 14: Customer A cannot update Customer B's profile
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11110000-0000-0000-0000-000000000001';

UPDATE public.profiles SET name = 'Hacked Name' WHERE id = '11110000-0000-0000-0000-000000000002';
SELECT is(
    (SELECT name FROM public.profiles WHERE id = '11110000-0000-0000-0000-000000000002'),
    'Customer B',
    'Customer A must not be able to modify Customer B profile'
);

-- Test 15: Customer A cannot escalate their own role to admin
UPDATE public.profiles SET role = 'admin' WHERE id = '11110000-0000-0000-0000-000000000001';
SELECT is(
    (SELECT role FROM public.profiles WHERE id = '11110000-0000-0000-0000-000000000001'),
    'customer'::public.user_role,
    'Customer A must not be able to self-escalate role to admin'
);

-- Test 16: Customer cannot create a shop (requires shop_owner role)
PREPARE customer_shop_create AS
    INSERT INTO public.shops (owner_id, name, address, geo_lat, geo_lng)
    VALUES ('11110000-0000-0000-0000-000000000001', 'Unauthorized Shop', '123 Fake St', 18.5, 73.8);
SELECT throws_ok(
    'customer_shop_create',
    42501, -- insufficient_privilege / RLS violation
    NULL,
    'Customer cannot register a shop without shop_owner role'
);

-- Test 17: Shop Owner A cannot update Shop Owner B's shop
SET LOCAL "request.jwt.claim.sub" = '22220000-0000-0000-0000-000000000001';
UPDATE public.shops SET name = 'Shop B Defaced' WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
SELECT is(
    (SELECT name FROM public.shops WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    'Shop B',
    'Owner A must not be able to modify Owner B shop'
);

-- Test 18: Shop Owner A CAN update their own shop
UPDATE public.shops SET name = 'Shop A Updated' WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
SELECT is(
    (SELECT name FROM public.shops WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'Shop A Updated',
    'Owner A must be able to update their own shop'
);

SELECT * FROM finish();
ROLLBACK;
