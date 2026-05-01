-- ============================================================================
-- USER MEMORY ARRAY STORAGE
-- Lumy Alpha - Persistent AI Memory (Single Row Per User)
-- Version: 011
-- Created: 2026-04-01
-- ============================================================================

-- One row per user. The canonical memory list is stored as a string array.
CREATE TABLE IF NOT EXISTS public.user_memory (
  clerk_user_id TEXT PRIMARY KEY REFERENCES public.profiles(clerk_user_id) ON DELETE CASCADE,
  memories TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_memory_updated_at
  ON public.user_memory(updated_at DESC);

CREATE OR REPLACE FUNCTION update_user_memory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_user_memory_updated_at ON public.user_memory;
CREATE TRIGGER trigger_update_user_memory_updated_at
  BEFORE UPDATE ON public.user_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_user_memory_updated_at();

-- Enable RLS (default-deny, service role bypasses)
ALTER TABLE public.user_memory ENABLE ROW LEVEL SECURITY;

-- Revoke public access on trigger function
REVOKE ALL ON FUNCTION public.update_user_memory_updated_at() FROM PUBLIC;
