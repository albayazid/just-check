-- ============================================================================
-- FILE UPLOADS TRACKING TABLE
-- Lumy Alpha - Image and File Storage System
-- Version: 009
-- Created: 2025-02-12
-- ============================================================================

-- 1. CREATE FILE_UPLOADS TABLE
CREATE TABLE IF NOT EXISTS public.file_uploads (
  -- Primary key (UUID v4)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User who uploaded (for ownership and cleanup)
  user_id TEXT NOT NULL,

  -- Storage path in Supabase bucket (e.g., "user/123/chat/456/file.jpg")
  storage_path TEXT NOT NULL,

  -- Original filename from user
  original_filename TEXT NOT NULL,

  -- MIME type (image/jpeg, image/png, etc.)
  mime_type TEXT NOT NULL,

  -- File size in bytes
  file_size INTEGER NOT NULL,

  -- Metadata (optional, for future use)
  metadata JSONB DEFAULT '{}',

  -- Extracted model-readable file content/context
  extracted_data JSONB,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),

  -- Soft delete (for cleanup without losing history)
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- 2. CREATE INDEXES FOR PERFORMANCE
-- User-based queries (user's files)
CREATE INDEX IF NOT EXISTS idx_file_uploads_user_id ON public.file_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_file_uploads_user_created ON public.file_uploads(user_id, created_at DESC);

-- Active files only (not deleted)
CREATE INDEX IF NOT EXISTS idx_file_uploads_active ON public.file_uploads(user_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- 3. ENABLE ROW LEVEL SECURITY (default-deny, service role bypasses)
ALTER TABLE public.file_uploads ENABLE ROW LEVEL SECURITY;

-- 4. CREATE UPDATED_AT TRIGGER
DROP TRIGGER IF EXISTS update_file_uploads_updated_at ON public.file_uploads;
CREATE TRIGGER update_file_uploads_updated_at
    BEFORE UPDATE ON public.file_uploads
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
