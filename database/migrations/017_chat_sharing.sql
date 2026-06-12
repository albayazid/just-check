-- Migration 017: Chat Sharing
-- Adds shared_conversations and shared_messages tables for frozen snapshot sharing,
-- plus an RPC function for share-scoped attachment resolution.

-- ============================================================================
-- SHARED CONVERSATIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.shared_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,
  source_conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  owner_clerk_user_id TEXT NOT NULL,
  title TEXT,
  owner_display_name TEXT,
  share_mode TEXT NOT NULL CHECK (share_mode IN ('entire', 'latest_thread', 'visible_thread')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  revoked_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX idx_shared_conversations_token ON public.shared_conversations(token);
CREATE INDEX idx_shared_conversations_source ON public.shared_conversations(source_conversation_id, owner_clerk_user_id);
CREATE INDEX idx_shared_conversations_active ON public.shared_conversations(token) WHERE is_active = true;

-- ============================================================================
-- SHARED MESSAGES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.shared_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_conversation_id UUID NOT NULL REFERENCES public.shared_conversations(id) ON DELETE CASCADE,
  original_message_id UUID NOT NULL,
  previous_message_id UUID,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'assistant', 'system')),
  content JSONB NOT NULL DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  attachment_ids UUID[] GENERATED ALWAYS AS (public.extract_attachment_ids(content)) STORED,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),

  CONSTRAINT unique_message_per_share UNIQUE (shared_conversation_id, original_message_id)
);

CREATE INDEX idx_shared_messages_conversation ON public.shared_messages(shared_conversation_id, created_at ASC);
CREATE INDEX idx_shared_messages_previous ON public.shared_messages(previous_message_id);
CREATE INDEX idx_shared_messages_attachments ON public.shared_messages USING GIN (attachment_ids)
  WHERE attachment_ids <> '{}';

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.shared_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_messages ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS update_shared_conversations_updated_at ON public.shared_conversations;
CREATE TRIGGER update_shared_conversations_updated_at
    BEFORE UPDATE ON public.shared_conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RPC: RESOLVE FILE FOR SHARED CONVERSATION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_file_for_shared_conversation(
  p_file_id UUID,
  p_share_token TEXT
)
RETURNS SETOF public.file_uploads
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT f.*
  FROM public.file_uploads f
  WHERE f.id = p_file_id
    AND f.deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.shared_messages sm
      JOIN public.shared_conversations sc ON sm.shared_conversation_id = sc.id
      WHERE sc.token = p_share_token
        AND sc.is_active = true
        AND (sc.expires_at IS NULL OR sc.expires_at > NOW())
        AND p_file_id = ANY(sm.attachment_ids)
    );
END;
$$;

-- Grant service_role access to the RPC function
GRANT EXECUTE ON FUNCTION public.resolve_file_for_shared_conversation(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.resolve_file_for_shared_conversation(UUID, TEXT) FROM PUBLIC;
