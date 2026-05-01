-- ============================================================================
-- SIGNED URL CACHE TABLE
-- Caches signed URLs to reduce Supabase bucket API calls
-- Version: 009
-- Created: 2025-03-11
-- ============================================================================

-- 1. CREATE SIGNED_URL_CACHE TABLE
CREATE TABLE IF NOT EXISTS public.signed_url_cache (
  -- Link to file_uploads table (CASCADE delete on hard delete)
  file_id UUID PRIMARY KEY REFERENCES public.file_uploads(id) ON DELETE CASCADE,
  
  -- The cached signed URL
  signed_url TEXT NOT NULL,
  
  -- When the signed URL expires (should match Supabase's 24h expiry)
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Track when we cached it (for debugging/cleanup)
  cached_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 2. CREATE INDEXES FOR PERFORMANCE
-- Efficient expiration cleanup queries
CREATE INDEX IF NOT EXISTS idx_signed_url_cache_expires_at 
  ON public.signed_url_cache(expires_at);

-- 3. ENABLE ROW LEVEL SECURITY (default-deny, service role bypasses)
ALTER TABLE public.signed_url_cache ENABLE ROW LEVEL SECURITY;

-- 4. CREATE HELPER FUNCTION FOR SOFT DELETE CASCADE (must be created BEFORE trigger)
CREATE OR REPLACE FUNCTION delete_signed_url_for_file() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.signed_url_cache WHERE file_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. CREATE TRIGGER FOR SOFT DELETE CASCADE
-- When a file is soft-deleted (deleted_at set), also remove cached URL
DROP TRIGGER IF EXISTS delete_signed_url_cache_on_soft_delete ON public.file_uploads;
CREATE TRIGGER delete_signed_url_cache_on_soft_delete
  AFTER UPDATE OF deleted_at ON public.file_uploads
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
  EXECUTE FUNCTION delete_signed_url_for_file();

-- 6. SET UP DAILY CLEANUP CRON JOB (pg_cron)
-- Enable pg_cron extension (requires superuser access)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant permissions
GRANT USAGE ON SCHEMA cron TO supabase_admin;

-- Schedule daily cleanup at UTC 00:00
SELECT cron.schedule(
  'cleanup-expired-signed-urls',
  '0 0 * * *',  -- Daily at midnight UTC
  $$DELETE FROM public.signed_url_cache WHERE expires_at < NOW()$$
);

-- 7. REVOKE PUBLIC ACCESS ON HELPER FUNCTION
REVOKE ALL ON FUNCTION public.delete_signed_url_for_file() FROM PUBLIC;

-- 8. STORAGE BUCKET DEFAULT-DENY
-- Ensure user-assets bucket exists and remove any default policies
-- (only runs if storage.policies table exists — skip if not yet set up)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'policies'
  ) THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('user-assets', 'user-assets', false)
    ON CONFLICT (id) DO NOTHING;

    DELETE FROM storage.policies WHERE bucket_id = 'user-assets';
  END IF;
END
$$;
