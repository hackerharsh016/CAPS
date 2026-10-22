-- ==============================================================================
-- CAPS Migration 020: Fix Insecure user_metadata Reference in shops_insert_owner
-- Migration ID: 20261019000020_fix_insecure_user_metadata_rls.sql
-- Description: Resolves Supabase Database Linter critical error:
--              "Table public.shops has a row level security policy shops_insert_owner
--              that references Supabase Auth user_metadata. user_metadata is editable
--              by end users and should never be used in a security context."
--              Replaces user_metadata references with immutable app_metadata and
--              direct public.profiles table checks.
-- ==============================================================================

-- 1. Redefine public.current_user_role() without user_metadata
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

-- 2. Redefine public.is_admin() without user_metadata
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

-- 3. Replace shops_insert_owner policy to strictly use app_metadata or profiles table
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

-- 4. Ensure permissions are granted properly
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO anon, authenticated, service_role;
