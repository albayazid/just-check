-- ============================================================================
-- CHAT HISTORY DATABASE SETUP
-- Lumy Alpha - Chat History System
-- Version: 002
-- Created: 2025-12-20
-- ============================================================================

-- 1. CREATE CONVERSATIONS TABLE (Chat-level information)
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL, -- Direct link to Clerk for easy reference
  title TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  deleted_at TIMESTAMP WITH TIME ZONE,

  -- Constraints
  CONSTRAINT title_not_empty CHECK (title IS NULL OR LENGTH(TRIM(title)) >= 1)
);

-- 2. CREATE MESSAGES TABLE (Individual messages with branching support)
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  previous_message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'assistant', 'system')),
  content JSONB NOT NULL DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  deleted_at TIMESTAMP WITH TIME ZONE,
  
  -- Ensure messages belong to a conversation
  CONSTRAINT message_has_conversation CHECK (conversation_id IS NOT NULL)
);

-- 3. CREATE PERFORMANCE INDEXES (Essential ones only)
-- Conversations indexing
CREATE INDEX IF NOT EXISTS idx_conversations_clerk_user_id ON public.conversations(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_active ON public.conversations(id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- Messages indexing (optimized for common queries)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON public.messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_previous_message_id ON public.messages(previous_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_not_deleted ON public.messages(conversation_id, created_at DESC) 
  WHERE deleted_at IS NULL;

-- Index for previous-message relationship queries (common in threaded conversations)
CREATE INDEX IF NOT EXISTS idx_messages_previous_message_id_lookup ON public.messages(previous_message_id, created_at DESC)
WHERE deleted_at IS NULL;

-- 4. ENABLE REAL-TIME FOR FUTURE USE
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- 5. ENABLE ROW LEVEL SECURITY (default-deny)
-- Service role key bypasses RLS, so this only blocks the anon/publishable key
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 6. CREATE UPDATED_AT TRIGGERS
-- (Note: update_updated_at_column function is created in 001_complete_profiles_setup.sql)

-- Trigger for conversations
DROP TRIGGER IF EXISTS update_conversations_updated_at ON public.conversations;
CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON public.conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for messages
DROP TRIGGER IF EXISTS update_messages_updated_at ON public.messages;
CREATE TRIGGER update_messages_updated_at
    BEFORE UPDATE ON public.messages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 7. CREATE TRIGGER TO UPDATE CONVERSATION TIMESTAMP WHEN MESSAGES CHANGE
-- Function to update the parent conversation's updated_at when a message is inserted, updated, or deleted
CREATE OR REPLACE FUNCTION update_conversation_on_message_change()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.conversations
    SET updated_at = NOW()
    WHERE id = COALESCE(NEW.conversation_id, OLD.conversation_id);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger that calls the function after message insert, update, or delete
DROP TRIGGER IF EXISTS update_conversation_timestamp ON public.messages;
CREATE TRIGGER update_conversation_timestamp
    AFTER INSERT OR UPDATE OR DELETE ON public.messages
    FOR EACH ROW
    EXECUTE FUNCTION update_conversation_on_message_change();

-- 8. REVOKE PUBLIC ACCESS ON TRIGGER FUNCTION
REVOKE ALL ON FUNCTION public.update_conversation_on_message_change() FROM PUBLIC;
