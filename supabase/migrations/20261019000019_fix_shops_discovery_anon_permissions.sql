-- ==============================================================================
-- CAPS Migration 019: Fix Shops Marketplace Discovery for Anon / Customers
-- Migration ID: 20261019000019_fix_shops_discovery_anon_permissions.sql
-- Description: Grants execute privileges on helper functions (is_admin,
--              is_shop_owner_or_member, current_user_role) to anon so that
--              unauthenticated customer marketplace queries do not trigger
--              PostgreSQL 42501 (permission denied for function is_admin).
-- ==============================================================================

-- 1. Grant EXECUTE on public.is_admin() to anon, authenticated, service_role
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

-- 2. Grant EXECUTE on public.is_shop_owner_or_member(UUID) to anon, authenticated, service_role
GRANT EXECUTE ON FUNCTION public.is_shop_owner_or_member(UUID) TO anon, authenticated, service_role;

-- 3. Grant EXECUTE on public.current_user_role() to anon, authenticated, service_role
GRANT EXECUTE ON FUNCTION public.current_user_role() TO anon, authenticated, service_role;

-- 4. Redefine shops_select_discovery to explicitly allow anon and authenticated to see open shops
DROP POLICY IF EXISTS "shops_select_discovery" ON public.shops;
CREATE POLICY "shops_select_discovery"
    ON public.shops
    FOR SELECT
    TO anon, authenticated
    USING (
        status = 'open'::public.shop_status
        OR (auth.uid() IS NOT NULL AND (
            owner_id = (SELECT auth.uid())
            OR public.is_admin()
            OR public.is_shop_owner_or_member(id)
        ))
    );

-- 5. Explicitly grant SELECT on public.shops to anon and authenticated
GRANT SELECT ON public.shops TO anon, authenticated;
