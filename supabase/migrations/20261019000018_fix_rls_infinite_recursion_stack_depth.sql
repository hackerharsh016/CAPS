-- ==============================================================================
-- CAPS Migration 018: Fix RLS Infinite Recursion & Stack Depth Limit Exceeded
-- Migration ID: 20261019000018_fix_rls_infinite_recursion_stack_depth.sql
-- Description: Eliminates circular RLS policy evaluation between public.shops,
--              public.profiles, and helper functions (is_shop_owner_or_member,
--              current_user_role, is_admin) that caused 'stack depth limit exceeded'
--              during shop owner registration.
-- ==============================================================================

-- 1. Redefine is_shop_owner_or_member to NOT query public.shops recursively
--    Owner check is done directly on shops.owner_id in RLS, so this function
--    only needs to check public.shop_members.
CREATE OR REPLACE FUNCTION public.is_shop_owner_or_member(target_shop_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.shop_members sm
        WHERE sm.shop_id = target_shop_id AND sm.user_id = (SELECT auth.uid())
    );
$$;

-- 2. Redefine current_user_role as SECURITY DEFINER with fast in-memory JWT fallback
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())),
        CASE
            WHEN (SELECT (auth.jwt() -> 'user_metadata' ->> 'role')) = 'shop_owner' THEN 'shop_owner'::public.user_role
            WHEN (SELECT (auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin' THEN 'admin'::public.user_role
            ELSE 'customer'::public.user_role
        END
    );
$$;

-- 3. Redefine is_admin as SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT (
        (SELECT (auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin'
        OR (SELECT (auth.jwt() -> 'app_metadata' ->> 'role')) = 'admin'
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = (SELECT auth.uid()) AND role = 'admin'::public.user_role
        )
    );
$$;

-- 4. Fix public.profiles SELECT policy to avoid cross-querying public.shops
DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin"
    ON public.profiles
    FOR SELECT
    USING (
        id = (SELECT auth.uid())
        OR public.is_admin()
    );

-- Separate policy for shop owners viewing customer profiles on their jobs
DROP POLICY IF EXISTS "profiles_select_shop_staff" ON public.profiles;
CREATE POLICY "profiles_select_shop_staff"
    ON public.profiles
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.print_jobs pj
            JOIN public.shops s ON s.id = pj.shop_id
            WHERE pj.customer_id = profiles.id AND s.owner_id = (SELECT auth.uid())
        )
    );

-- 5. Fix public.shops SELECT policy to prevent recursive function calls
DROP POLICY IF EXISTS "shops_select_discovery" ON public.shops;
CREATE POLICY "shops_select_discovery"
    ON public.shops
    FOR SELECT
    USING (
        status = 'open'::public.shop_status
        OR owner_id = (SELECT auth.uid())
        OR public.is_admin()
        OR public.is_shop_owner_or_member(id)
    );

-- 6. Fix public.shops INSERT policy to use JWT metadata and non-recursive checks
DROP POLICY IF EXISTS "shops_insert_owner" ON public.shops;
CREATE POLICY "shops_insert_owner"
    ON public.shops
    FOR INSERT
    WITH CHECK (
        owner_id = (SELECT auth.uid())
        AND (
            (SELECT (auth.jwt() -> 'user_metadata' ->> 'role')) IN ('shop_owner', 'admin')
            OR (SELECT (auth.jwt() -> 'app_metadata' ->> 'role')) IN ('shop_owner', 'admin')
            OR public.current_user_role() IN ('shop_owner'::public.user_role, 'admin'::public.user_role)
        )
    );

-- 7. Grant execution privileges to authenticated & service_role
GRANT EXECUTE ON FUNCTION public.is_shop_owner_or_member(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
