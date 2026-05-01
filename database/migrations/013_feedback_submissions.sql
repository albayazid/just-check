-- ============================================================================
-- FEEDBACK SUBMISSIONS
-- Lumy Alpha - General Feedback Page
-- Version: 013
-- Created: 2026-04-22
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.feedback_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_clerk_user_id
  ON public.feedback_submissions(clerk_user_id);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_category
  ON public.feedback_submissions(category);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_created_at
  ON public.feedback_submissions(created_at DESC);

DROP TRIGGER IF EXISTS update_feedback_submissions_updated_at ON public.feedback_submissions;
CREATE TRIGGER update_feedback_submissions_updated_at
  BEFORE UPDATE ON public.feedback_submissions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS (default-deny, service role bypasses)
ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.feedback_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id UUID NOT NULL REFERENCES public.feedback_submissions(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_feedback_attachments_feedback_id
  ON public.feedback_attachments(feedback_id);

CREATE INDEX IF NOT EXISTS idx_feedback_attachments_clerk_user_id
  ON public.feedback_attachments(clerk_user_id);

CREATE INDEX IF NOT EXISTS idx_feedback_attachments_created_at
  ON public.feedback_attachments(created_at DESC);

-- Enable RLS (default-deny, service role bypasses)
ALTER TABLE public.feedback_attachments ENABLE ROW LEVEL SECURITY;
