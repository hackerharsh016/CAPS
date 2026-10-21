-- ==============================================================================
-- CAPS Migration 016: Supabase Storage Bucket & Object Access Policies
-- Migration ID: 20261019000016_create_storage_bucket.sql
-- Description: Creates the private 'caps-private-documents' storage bucket
--              in Supabase Storage (storage.buckets) and configures RLS policies
--              on storage.objects according to the CAPS privacy lifecycle.
-- ==============================================================================

-- 1. Create the private storage bucket(s) in storage.buckets
--    Enforces private access, 50MB file size ceiling, and strict MIME allowlist.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'caps-private-documents',
    'caps-private-documents',
    false, -- strictly private; public reads are forbidden per SRS §4.4
    52428800, -- 50 MB (52,428,800 bytes)
    ARRAY[
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-powerpoint',
        'image/jpeg',
        'image/png'
    ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Also create the alias 'caps-documents' for architecture spec compatibility
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'caps-documents',
    'caps-documents',
    false,
    52428800,
    ARRAY[
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-powerpoint',
        'image/jpeg',
        'image/png'
    ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Configure Row Level Security (RLS) on storage.objects

-- A. Full access for service_role (Cloud API background workers & cleanup sweeper)
DROP POLICY IF EXISTS p_storage_objects_service_role ON storage.objects;
CREATE POLICY p_storage_objects_service_role ON storage.objects
    FOR ALL
    TO service_role
    USING (bucket_id IN ('caps-private-documents', 'caps-documents'))
    WITH CHECK (bucket_id IN ('caps-private-documents', 'caps-documents'));

-- B. Customer uploads: Authenticated users can upload to their own user directory
DROP POLICY IF EXISTS p_storage_objects_customer_upload ON storage.objects;
CREATE POLICY p_storage_objects_customer_upload ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id IN ('caps-private-documents', 'caps-documents')
        AND (
            (storage.foldername(name))[2] = auth.uid()::text
            OR (storage.foldername(name))[1] = auth.uid()::text
        )
    );

-- C. Customer reads: Authenticated users can read their own uploaded files
DROP POLICY IF EXISTS p_storage_objects_customer_select ON storage.objects;
CREATE POLICY p_storage_objects_customer_select ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id IN ('caps-private-documents', 'caps-documents')
        AND (
            (storage.foldername(name))[2] = auth.uid()::text
            OR (storage.foldername(name))[1] = auth.uid()::text
        )
    );

-- D. Customer deletes: Authenticated users can delete their own documents prior to printing
DROP POLICY IF EXISTS p_storage_objects_customer_delete ON storage.objects;
CREATE POLICY p_storage_objects_customer_delete ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id IN ('caps-private-documents', 'caps-documents')
        AND (
            (storage.foldername(name))[2] = auth.uid()::text
            OR (storage.foldername(name))[1] = auth.uid()::text
        )
    );
