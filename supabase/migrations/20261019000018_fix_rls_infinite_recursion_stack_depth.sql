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

-- 2. Redefine current_user_role as SECURITY DEFINER using profiles or server-controlled app_metadata
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
            WHEN (SELECT (auth.jwt() -> 'app_metadata' ->> 'role')) = 'shop_owner' THEN 'shop_owner'::public.user_role
            WHEN (SELECT (auth.jwt() -> 'app_metadata' ->> 'role')) = 'admin' THEN 'admin'::public.user_role
            ELSE 'customer'::public.user_role
        END
    );
$$;

-- 3. Redefine is_admin as SECURITY DEFINER using app_metadata or profiles table
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT (auth.jwt() -> 'app_metadata' ->> 'role')) = 'admin'
        OR (
            (SELECT auth.uid()) IS NOT NULL
            AND EXISTS (
                SELECT 1 FROM public.profiles
                WHERE id = (SELECT auth.uid()) AND role = 'admin'::public.user_role
            )
        ),
        false
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

-- 5. Fix public.shops SELECT policy to prevent recursive function calls and allow anon discovery
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

GRANT SELECT ON public.shops TO anon, authenticated;

-- 6. Fix public.shops INSERT policy: use secure app_metadata or profiles table (NEVER user_metadata)
DROP POLICY IF EXISTS "shops_insert_owner" ON public.shops;
CREATE POLICY "shops_insert_owner"
    ON public.shops
    FOR INSERT
    TO authenticated
    WITH CHECK (
        owner_id = (SELECT auth.uid())
        AND (
            (SELECT (auth.jwt() -> 'app_metadata' ->> 'role')) IN ('shop_owner', 'admin')
            OR EXISTS (
                SELECT 1 FROM public.profiles
                WHERE id = (SELECT auth.uid()) AND role IN ('shop_owner'::public.user_role, 'admin'::public.user_role)
            )
        )
    );

-- 7. Grant execution privileges to anon, authenticated & service_role
GRANT EXECUTE ON FUNCTION public.is_shop_owner_or_member(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;
