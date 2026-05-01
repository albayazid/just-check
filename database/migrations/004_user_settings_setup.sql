-- ============================================================================
-- USER SETTINGS SETUP
-- Lumy Alpha - User Settings System
-- Version: 004
-- Created: 2025-01-15
-- ============================================================================

-- Create user_settings table
CREATE TABLE IF NOT EXISTS public.user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT UNIQUE NOT NULL REFERENCES public.profiles(clerk_user_id) ON DELETE CASCADE,
  settings_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for clerk_user_id lookups
CREATE INDEX IF NOT EXISTS idx_user_settings_clerk_user_id 
  ON public.user_settings(clerk_user_id);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_user_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_user_settings_updated_at();

-- Enable RLS (default-deny, service role bypasses)
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- Revoke public access on trigger function
REVOKE ALL ON FUNCTION public.update_user_settings_updated_at() FROM PUBLIC;
