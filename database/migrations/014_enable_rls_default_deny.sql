-- ============================================================================
-- ENABLE ROW LEVEL SECURITY (DEFAULT-DENY)
-- Lumy Alpha - Security Hardening
-- Version: 014
-- Created: 2026-05-01
-- ============================================================================
--
-- ONE-TIME MIGRATION for existing database.
-- After running this, the changes are baked into migrations 001-013,
-- so this file can be deleted for fresh setups.
--
-- STRATEGY:
--   Enable RLS on every table with NO policies.
--   - Service role key: continues working normally (always bypasses RLS)
--   - Anon/publishable key: denied on every table (no policies = no access)
--
-- Also revokes public/anon execute on all functions.
-- ============================================================================

-- ============================================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================================

-- Tables with clerk_user_id
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.periodic_allowance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dodo_customer_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_attachments ENABLE ROW LEVEL SECURITY;

-- Table with user_id
ALTER TABLE public.file_uploads ENABLE ROW LEVEL SECURITY;

-- Tables with indirect ownership (via FK chain)
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_token_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signed_url_cache ENABLE ROW LEVEL SECURITY;

-- System table (no user ownership)
ALTER TABLE public.webhook_event_log ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- REVOKE PUBLIC ACCESS ON ALL FUNCTIONS
-- ============================================================================

-- RPC functions
REVOKE ALL ON FUNCTION public.get_user_subscription(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deduct_allowance(TEXT, NUMERIC) FROM PUBLIC;

-- Helper / trigger functions
REVOKE ALL ON FUNCTION public.is_profile_complete(public.profiles) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profile_completion_status(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_conversation_on_message_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_conversation_on_feedback_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_user_settings_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_signed_url_for_file() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_user_memory_updated_at() FROM PUBLIC;

-- ============================================================================
-- STORAGE BUCKET DEFAULT-DENY
-- (only runs if storage.policies table exists — skip if not yet set up)
-- ============================================================================

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
