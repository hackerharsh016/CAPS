-- ==============================================================================
-- CAPS Migration 013: Document Storage Metadata & Conversion Schema
-- Migration ID: 20261019000013_create_documents_schema.sql
-- Description: Establishes document metadata, conversion tracking, RLS policies,
--              and constraints for trusted office and image PDF conversion.
-- ==============================================================================

-- 1. Document Status Enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_status') THEN
        CREATE TYPE public.document_status AS ENUM (
            'upload_pending',
            'converting',
            'ready',
            'failed',
            'purged'
        );
    END IF;
END $$;

-- 2. Documents Table
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL CHECK (char_length(trim(file_name)) >= 1),
    mime_type TEXT NOT NULL CHECK (char_length(trim(mime_type)) >= 1),
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
    storage_key TEXT NOT NULL CHECK (char_length(trim(storage_key)) >= 1),
    converted_storage_key TEXT,
    status public.document_status NOT NULL DEFAULT 'upload_pending'::public.document_status,
    page_count INTEGER CHECK (page_count IS NULL OR page_count > 0),
    checksum_sha256 TEXT CHECK (checksum_sha256 IS NULL OR char_length(checksum_sha256) = 64),
    converted_checksum_sha256 TEXT CHECK (converted_checksum_sha256 IS NULL OR char_length(converted_checksum_sha256) = 64),
    conversion_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc'::text, now()) + INTERVAL '24 hours'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT chk_documents_allowed_mimes CHECK (
        mime_type IN (
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.ms-powerpoint',
            'image/jpeg',
            'image/png'
        )
    ),
    CONSTRAINT chk_documents_max_size CHECK (
        file_size_bytes <= 52428800 -- 50 MB
    )
);

COMMENT ON TABLE public.documents IS 'Private customer documents and converted normalized PDF files.';
COMMENT ON COLUMN public.documents.storage_key IS 'Encrypted object storage key for uploaded source document.';
COMMENT ON COLUMN public.documents.converted_storage_key IS 'Storage key for sandboxed normalized PDF output.';
COMMENT ON COLUMN public.documents.page_count IS 'Deterministic page count verified by conversion sandbox.';

-- 3. Indexes for Customer Isolation and Sweeper Expiration
CREATE INDEX IF NOT EXISTS idx_documents_customer_id ON public.documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON public.documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_expires_at ON public.documents(expires_at) WHERE status <> 'purged'::public.document_status;

-- 4. Updated_at Trigger
DROP TRIGGER IF EXISTS trg_documents_updated_at ON public.documents;
CREATE TRIGGER trg_documents_updated_at
    BEFORE UPDATE ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- 5. Row Level Security Policies
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Customers can select their own documents
DROP POLICY IF EXISTS p_documents_select_customer ON public.documents;
CREATE POLICY p_documents_select_customer ON public.documents
    FOR SELECT
    USING (customer_id = auth.uid());

-- Customers can insert their own documents
DROP POLICY IF EXISTS p_documents_insert_customer ON public.documents;
CREATE POLICY p_documents_insert_customer ON public.documents
    FOR INSERT
    WITH CHECK (customer_id = auth.uid());

-- Customers can update their own documents
DROP POLICY IF EXISTS p_documents_update_customer ON public.documents;
CREATE POLICY p_documents_update_customer ON public.documents
    FOR UPDATE
    USING (customer_id = auth.uid())
    WITH CHECK (customer_id = auth.uid());

-- System/Service role full access
DROP POLICY IF EXISTS p_documents_service_all ON public.documents;
CREATE POLICY p_documents_service_all ON public.documents
    FOR ALL
    USING (true)
    WITH CHECK (true);
