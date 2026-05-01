-- ============================================================================
-- COMPLETE PROFILES SETUP FOR CLERK + SUPABASE
-- Lumy Alpha - All-in-one setup script
-- Version: 001
-- Created: 2025-11-18
-- ============================================================================

-- 1. CREATE PROFILES TABLE (Fixed for Clerk Auth)
-- Remove old table if exists and create new compatible version
DROP TABLE IF EXISTS public.profiles CASCADE;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  full_name TEXT,
  nickname TEXT,
  date_of_birth DATE,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  deleted_at TIMESTAMP WITH TIME ZONE,
  
  -- Constraints for required fields
  CONSTRAINT full_name_not_empty CHECK (full_name IS NULL OR LENGTH(TRIM(full_name)) >= 2),
  CONSTRAINT nickname_not_empty CHECK (nickname IS NULL OR LENGTH(TRIM(nickname)) >= 2),
  CONSTRAINT email_valid CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  CONSTRAINT avatar_url_valid CHECK (avatar_url IS NULL OR avatar_url ~* '^https?://')
);

-- 2. CREATE INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_profiles_clerk_user_id ON public.profiles(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_completion ON public.profiles(id) 
  WHERE full_name IS NOT NULL AND nickname IS NOT NULL AND date_of_birth IS NOT NULL;

-- 3. ENABLE ROW LEVEL SECURITY (default-deny)
-- Service role key bypasses RLS, so this only blocks the anon/publishable key
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4. CREATE UPDATED_AT TRIGGER FUNCTION AND TRIGGER
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc'::text, NOW());
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 5. CREATE PROFILE COMPLETION HELPER FUNCTIONS

-- Function to check if profile is complete
CREATE OR REPLACE FUNCTION is_profile_complete(profile_record public.profiles)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    profile_record.full_name IS NOT NULL 
    AND LENGTH(TRIM(profile_record.full_name)) >= 2
    AND profile_record.nickname IS NOT NULL 
    AND LENGTH(TRIM(profile_record.nickname)) >= 2
    AND profile_record.date_of_birth IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql;

-- Function to get profile completion status as JSON
CREATE OR REPLACE FUNCTION get_profile_completion_status(clerk_id TEXT)
RETURNS JSON AS $$
DECLARE
  profile_record public.profiles;
  is_complete BOOLEAN;
BEGIN
  SELECT * INTO profile_record 
  FROM public.profiles 
  WHERE clerk_user_id = clerk_id;
  
  IF profile_record IS NULL THEN
    RETURN json_build_object(
      'exists', false,
      'complete', false,
      'error', 'Profile not found'
    );
  END IF;
  
  is_complete := is_profile_complete(profile_record);
  
  RETURN json_build_object(
    'exists', true,
    'complete', is_complete,
    'profile', json_build_object(
      'full_name', profile_record.full_name,
      'nickname', profile_record.nickname,
      'date_of_birth', profile_record.date_of_birth,
      'avatar_url', profile_record.avatar_url
    )
  );
END;
$$ LANGUAGE plpgsql;

-- 6. REVOKE PUBLIC ACCESS ON HELPER FUNCTIONS
-- Prevent anon key from calling these functions
REVOKE ALL ON FUNCTION public.is_profile_complete(public.profiles) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profile_completion_status(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC;

-- 7. OPTIONAL: CREATE A TEST PROFILE (Uncomment to test)
-- INSERT INTO public.profiles (clerk_user_id, email, full_name, nickname, date_of_birth) 
-- VALUES ('test_clerk_user_id', 'test@example.com', 'Test User', 'Tester', '1990-01-01') 
-- ON CONFLICT (clerk_user_id) DO NOTHING;

-- 7. VERIFICATION QUERIES (Run these to verify setup)
-- Check table structure:
-- SELECT table_name, column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns 
-- WHERE table_name = 'profiles' 
-- ORDER BY ordinal_position;

-- Check if any profiles exist:
-- SELECT COUNT(*) as profile_count FROM public.profiles;

-- Test the completion status function:
-- SELECT get_profile_completion_status('test_clerk_user_id');

-- ============================================================================
-- SETUP COMPLETE!
-- 
-- Next steps:
-- 1. Run this entire script in Supabase SQL Editor
-- 2. Verify table was created correctly
-- 3. Test profile creation via your app
-- 4. Set up ngrok + Clerk webhooks for automatic profile creation
-- ============================================================================