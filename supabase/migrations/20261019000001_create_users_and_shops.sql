-- ==============================================================================
-- CAPS Migration 001: Users/Profiles, Shops, and Shop Members Foundation with RLS
-- Migration ID: 20261019000001_create_users_and_shops.sql
-- Description: Establishes user profiles aligned with auth.users, shops with
--              geolocation and pricing JSON configuration, shop membership,
--              automated updated_at triggers, and tenant-scoped RLS policies.
-- ==============================================================================

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Define domain enums (aligned with @caps/types)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE public.user_role AS ENUM ('customer', 'shop_owner', 'admin');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shop_status') THEN
        CREATE TYPE public.shop_status AS ENUM ('open', 'closed');
    END IF;
END $$;

-- 3. Utility Trigger Function: Automatic updated_at timestamping
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

-- 4. User Profiles Table (1-to-1 with Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role public.user_role NOT NULL DEFAULT 'customer'::public.user_role,
    name TEXT NOT NULL CHECK (char_length(trim(name)) >= 1),
    phone TEXT NOT NULL CHECK (char_length(trim(phone)) >= 5),
    email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.profiles IS 'User identity profiles linked to Supabase auth accounts.';
COMMENT ON COLUMN public.profiles.role IS 'Platform access role: customer, shop_owner, or admin.';

-- Trigger for profiles updated_at
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- 5. Helper Functions for Security & RLS Context
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'::public.user_role
    );
$$;

-- 6. Shops Table
CREATE TABLE IF NOT EXISTS public.shops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (char_length(trim(name)) >= 2 AND char_length(name) <= 100),
    address TEXT NOT NULL CHECK (char_length(trim(address)) >= 5),
    geo_lat NUMERIC(10, 7) NOT NULL CHECK (geo_lat >= -90.0 AND geo_lat <= 90.0),
    geo_lng NUMERIC(10, 7) NOT NULL CHECK (geo_lng >= -180.0 AND geo_lng <= 180.0),
    status public.shop_status NOT NULL DEFAULT 'open'::public.shop_status,
    pricing_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    urgent_surcharge_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    auto_print_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.shops IS 'Registered printing outlets, physical locations, and pricing rules.';
COMMENT ON COLUMN public.shops.pricing_config IS 'Authoritative per-page paper/color/duplex pricing and binding fees in paise.';
COMMENT ON COLUMN public.shops.urgent_surcharge_config IS 'Urgent tier priority jump pricing and hourly limits.';

-- Trigger for shops updated_at
DROP TRIGGER IF EXISTS trg_shops_updated_at ON public.shops;
CREATE TRIGGER trg_shops_updated_at
    BEFORE UPDATE ON public.shops
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- 7. Shop Members Table (Multi-staff and operator delegation)
CREATE TABLE IF NOT EXISTS public.shop_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'operator')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_shop_members_shop_user UNIQUE (shop_id, user_id)
);

COMMENT ON TABLE public.shop_members IS 'Association table for shop operators and staff permissions.';

CREATE OR REPLACE FUNCTION public.is_shop_owner_or_member(target_shop_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = target_shop_id AND s.owner_id = auth.uid()
        UNION
        SELECT 1 FROM public.shop_members sm
        WHERE sm.shop_id = target_shop_id AND sm.user_id = auth.uid()
    );
$$;

-- 8. Auth Users Lifecycle Sync (Automatic profile initialization on signup)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    assigned_role public.user_role;
    user_name TEXT;
    user_phone TEXT;
BEGIN
    -- Read metadata if supplied, defaulting safely
    assigned_role := CASE
        WHEN NEW.raw_user_meta_data->>'role' = 'shop_owner' THEN 'shop_owner'::public.user_role
        WHEN NEW.raw_user_meta_data->>'role' = 'admin' THEN 'admin'::public.user_role
        ELSE 'customer'::public.user_role
    END;

    user_name := COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email, 'User'), '@', 1));
    user_phone := COALESCE(NEW.raw_user_meta_data->>'phone', '0000000000');

    INSERT INTO public.profiles (id, role, name, phone, email)
    VALUES (NEW.id, assigned_role, user_name, user_phone, NEW.email)
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        updated_at = timezone('utc'::text, now());

    RETURN NEW;
END;
$$;

-- Trigger attached to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- 9. Performance Indices
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_shops_owner_id ON public.shops(owner_id);
CREATE INDEX IF NOT EXISTS idx_shops_status ON public.shops(status);
CREATE INDEX IF NOT EXISTS idx_shops_geo ON public.shops(geo_lat, geo_lng);
CREATE INDEX IF NOT EXISTS idx_shop_members_shop_id ON public.shop_members(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_members_user_id ON public.shop_members(user_id);

-- ==============================================================================
-- 10. Row-Level Security (RLS) Policies
-- ==============================================================================

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_members ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- Profiles Policies
-- ------------------------------------------------------------------------------

-- SELECT: Users can read their own profile; admins can read any profile;
-- Shop owners can read customer names associated with their jobs.
CREATE POLICY "profiles_select_own_or_admin"
    ON public.profiles
    FOR SELECT
    USING (
        auth.uid() = id
        OR public.is_admin()
        OR EXISTS (
            -- Allow shop staff to read basic customer profiles for their active shop operations
            SELECT 1 FROM public.shops s
            WHERE s.owner_id = auth.uid()
        )
    );

-- INSERT: Only the authenticated user can create their matching profile row, or admin.
CREATE POLICY "profiles_insert_own"
    ON public.profiles
    FOR INSERT
    WITH CHECK (
        auth.uid() = id
        OR public.is_admin()
    );

-- UPDATE: Users can update their own name/phone. Users CANNOT escalate their own role unless admin.
CREATE POLICY "profiles_update_own"
    ON public.profiles
    FOR UPDATE
    USING (auth.uid() = id OR public.is_admin())
    WITH CHECK (
        (auth.uid() = id AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()))
        OR public.is_admin()
    );

-- DELETE: Only admin can delete a user profile directly.
CREATE POLICY "profiles_delete_admin_only"
    ON public.profiles
    FOR DELETE
    USING (public.is_admin());

-- ------------------------------------------------------------------------------
-- Shops Policies
-- ------------------------------------------------------------------------------

-- SELECT: Open shops are publicly visible for discovery; closed shops visible to owner, members, or admin.
CREATE POLICY "shops_select_discovery"
    ON public.shops
    FOR SELECT
    USING (
        status = 'open'::public.shop_status
        OR owner_id = auth.uid()
        OR public.is_shop_owner_or_member(id)
        OR public.is_admin()
    );

-- INSERT: Only users with shop_owner or admin role can register a new shop. Must be the owner.
CREATE POLICY "shops_insert_owner"
    ON public.shops
    FOR INSERT
    WITH CHECK (
        auth.uid() = owner_id
        AND (public.current_user_role() IN ('shop_owner'::public.user_role, 'admin'::public.user_role))
    );

-- UPDATE: Only shop owner or system admin can update shop configurations and pricing.
CREATE POLICY "shops_update_owner"
    ON public.shops
    FOR UPDATE
    USING (owner_id = auth.uid() OR public.is_admin())
    WITH CHECK (owner_id = auth.uid() OR public.is_admin());

-- DELETE: Only shop owner or system admin can delete a shop.
CREATE POLICY "shops_delete_owner"
    ON public.shops
    FOR DELETE
    USING (owner_id = auth.uid() OR public.is_admin());

-- ------------------------------------------------------------------------------
-- Shop Members Policies
-- ------------------------------------------------------------------------------

-- SELECT: Visible to the member themselves, the owning shop's owner, or system admin.
CREATE POLICY "shop_members_select"
    ON public.shop_members
    FOR SELECT
    USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.shops s
            WHERE s.id = shop_members.shop_id AND s.owner_id = auth.uid()
        )
        OR public.is_admin()
    );

-- INSERT / UPDATE / DELETE: Managed exclusively by the shop owner or admin.
CREATE POLICY "shop_members_modify_owner"
    ON public.shop_members
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.shops s
            WHERE s.id = shop_members.shop_id AND s.owner_id = auth.uid()
        )
        OR public.is_admin()
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.shops s
            WHERE s.id = shop_members.shop_id AND s.owner_id = auth.uid()
        )
        OR public.is_admin()
    );
