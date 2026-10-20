-- ==============================================================================
-- CAPS pgTAP Integration & RLS Test Suite: Printers, Agent Devices & Revocation
-- ==============================================================================

BEGIN;

-- 1. Plan the test cases
SELECT plan(19);

-- ------------------------------------------------------------------------------
-- Schema & Table Structure Tests
-- ------------------------------------------------------------------------------

-- Test 1-4: Table Existence
SELECT has_table('public', 'agent_devices', 'agent_devices table must exist');
SELECT has_table('public', 'agent_sessions', 'agent_sessions table must exist');
SELECT has_table('public', 'agent_pairing_codes', 'agent_pairing_codes table must exist');
SELECT has_table('public', 'printers', 'printers table must exist');

-- Test 5-8: Key Column & Type Assertions
SELECT has_column('public', 'agent_devices', 'is_revoked', 'agent_devices must have is_revoked column');
SELECT has_column('public', 'agent_devices', 'device_fingerprint', 'agent_devices must have device_fingerprint');
SELECT has_column('public', 'printers', 'capabilities', 'printers must have capabilities JSONB');
SELECT has_column('public', 'printers', 'role', 'printers must have role column');

-- Test 9-10: Foreign Keys
SELECT col_is_fk('public', 'printers', 'shop_id', 'printers.shop_id must be a foreign key');
SELECT col_is_fk('public', 'agent_devices', 'shop_id', 'agent_devices.shop_id must be a foreign key');

-- Test 11-12: RLS Enabled Verification
SELECT ok(
    (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'printers'),
    'printers table must have RLS enabled'
);
SELECT ok(
    (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_devices'),
    'agent_devices table must have RLS enabled'
);

-- ------------------------------------------------------------------------------
-- Data Setup for Isolation and Revocation Tests
-- ------------------------------------------------------------------------------

-- Insert mock auth users and profiles
INSERT INTO auth.users (id, email) VALUES
    ('33330000-0000-0000-0000-000000000001', 'owner_x@test.com'),
    ('33330000-0000-0000-0000-000000000002', 'owner_y@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, role, name, phone, email) VALUES
    ('33330000-0000-0000-0000-000000000001', 'shop_owner', 'Owner X', '9998880001', 'owner_x@test.com'),
    ('33330000-0000-0000-0000-000000000002', 'shop_owner', 'Owner Y', '9998880002', 'owner_y@test.com')
ON CONFLICT (id) DO NOTHING;

-- Insert two distinct shops for tenant isolation tests
INSERT INTO public.shops (id, owner_id, name, address, geo_lat, geo_lng, status) VALUES
    ('33331111-0000-0000-0000-000000000001', '33330000-0000-0000-0000-000000000001', 'Shop X', 'Addr X', 18.5, 73.8, 'open'),
    ('33331111-0000-0000-0000-000000000002', '33330000-0000-0000-0000-000000000002', 'Shop Y', 'Addr Y', 18.6, 73.9, 'open')
ON CONFLICT (id) DO NOTHING;

-- Insert an active device and a revoked device
INSERT INTO public.agent_devices (id, shop_id, device_fingerprint, device_name, auth_token_hash, is_revoked, paired_by) VALUES
    ('44440000-0000-0000-0000-000000000001', '33331111-0000-0000-0000-000000000001', 'fp-active-1', 'Active Agent X', 'hash1', false, '33330000-0000-0000-0000-000000000001'),
    ('44440000-0000-0000-0000-000000000002', '33331111-0000-0000-0000-000000000001', 'fp-revoked-1', 'Revoked Agent X', 'hash2', true, '33330000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Insert printer for Shop X and printer for Shop Y
INSERT INTO public.printers (id, shop_id, device_id, name, role, status) VALUES
    ('55550000-0000-0000-0000-000000000001', '33331111-0000-0000-0000-000000000001', '44440000-0000-0000-0000-000000000001', 'HP LaserJet X', 'bw', 'online'),
    ('55550000-0000-0000-0000-000000000002', '33331111-0000-0000-0000-000000000002', NULL, 'Canon Color Y', 'color', 'online')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- Mandatory Test Evidence 1: Other-Shop Printer Mutations Denied
-- ------------------------------------------------------------------------------

-- Switch execution context to Owner X
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '33330000-0000-0000-0000-000000000001';

-- Test 13: Owner X attempting to update Shop Y printer must be denied
UPDATE public.printers SET name = 'Hacked Printer Name' WHERE id = '55550000-0000-0000-0000-000000000002';
SELECT is(
    (SELECT name FROM public.printers WHERE id = '55550000-0000-0000-0000-000000000002'),
    'Canon Color Y',
    'Owner X must not be able to modify Shop Y printer name'
);

-- Test 14: Owner X attempting to delete Shop Y printer must be denied
DELETE FROM public.printers WHERE id = '55550000-0000-0000-0000-000000000002';
SELECT ok(
    EXISTS (SELECT 1 FROM public.printers WHERE id = '55550000-0000-0000-0000-000000000002'),
    'Owner X must not be able to delete Shop Y printer'
);

-- Test 15: Owner X attempting to insert a printer into Shop Y must trigger RLS error
PREPARE other_shop_printer_insert AS
    INSERT INTO public.printers (shop_id, name, role)
    VALUES ('33331111-0000-0000-0000-000000000002', 'Rogue Printer', 'bw');
SELECT throws_ok(
    'other_shop_printer_insert',
    42501, -- insufficient_privilege / RLS violation
    NULL,
    'Inserting a printer into another owner shop must trigger RLS violation'
);

-- Test 16: Owner X CAN update their own printer
UPDATE public.printers SET name = 'HP LaserJet X Renamed' WHERE id = '55550000-0000-0000-0000-000000000001';
SELECT is(
    (SELECT name FROM public.printers WHERE id = '55550000-0000-0000-0000-000000000001'),
    'HP LaserJet X Renamed',
    'Owner X must be permitted to update their own shop printer'
);

-- ------------------------------------------------------------------------------
-- Mandatory Test Evidence 2: Revoked Agent Denied
-- ------------------------------------------------------------------------------

-- Test 17: Helper function correctly identifies active vs revoked devices
SELECT is(public.is_device_unrevoked('44440000-0000-0000-0000-000000000001'), true, 'Active agent must return true');
SELECT is(public.is_device_unrevoked('44440000-0000-0000-0000-000000000002'), false, 'Revoked agent must return false');

-- Test 18: Revoked agent cannot attach to a new printer
PREPARE revoked_device_printer_insert AS
    INSERT INTO public.printers (shop_id, device_id, name, role)
    VALUES ('33331111-0000-0000-0000-000000000001', '44440000-0000-0000-0000-000000000002', 'Revoked Device Printer', 'bw');
SELECT throws_ok(
    'revoked_device_printer_insert',
    42501,
    NULL,
    'Registering a printer associated with a revoked agent device must be denied by RLS'
);

-- Test 19: Revoked agent cannot create an active session
PREPARE revoked_session_insert AS
    INSERT INTO public.agent_sessions (device_id, shop_id, agent_version)
    VALUES ('44440000-0000-0000-0000-000000000002', '33331111-0000-0000-0000-000000000001', '0.1.0');
SELECT throws_ok(
    'revoked_session_insert',
    42501,
    NULL,
    'Revoked agent device cannot create a new agent session'
);

SELECT * FROM finish();
ROLLBACK;
