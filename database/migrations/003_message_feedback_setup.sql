-- ============================================================================
-- MESSAGE FEEDBACK SETUP
-- Lumy Alpha - Message Feedback System
-- Version: 003
-- Created: 2025-01-11
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.message_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  feedback JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Unique constraint: one feedback per user per message
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_feedback_unique
  ON public.message_feedback(message_id, clerk_user_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_message_feedback_message_id
  ON public.message_feedback(message_id);
CREATE INDEX IF NOT EXISTS idx_message_feedback_clerk_user_id
  ON public.message_feedback(clerk_user_id);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_message_feedback_updated_at ON public.message_feedback;
CREATE TRIGGER update_message_feedback_updated_at
  BEFORE UPDATE ON public.message_feedback
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- TRIGGER TO UPDATE CONVERSATION TIMESTAMP WHEN FEEDBACK CHANGES
-- Function to update the parent conversation's updated_at when feedback is inserted, updated, or deleted
CREATE OR REPLACE FUNCTION update_conversation_on_feedback_change()
RETURNS TRIGGER AS $$
DECLARE
  v_conversation_id UUID;
BEGIN
  -- Get conversation_id from the messages table
  SELECT conversation_id INTO v_conversation_id
  FROM public.messages
  WHERE id = COALESCE(NEW.message_id, OLD.message_id);

  IF v_conversation_id IS NOT NULL THEN
    UPDATE public.conversations
    SET updated_at = NOW()
    WHERE id = v_conversation_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger that calls the function after feedback insert, update, or delete
DROP TRIGGER IF EXISTS update_conversation_timestamp_on_feedback ON public.message_feedback;
CREATE TRIGGER update_conversation_timestamp_on_feedback
  AFTER INSERT OR UPDATE OR DELETE ON public.message_feedback
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_on_feedback_change();

-- Enable RLS (default-deny, service role bypasses)
ALTER TABLE public.message_feedback ENABLE ROW LEVEL SECURITY;

-- Enable real-time for future use
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_feedback;

-- Revoke public access on trigger function
REVOKE ALL ON FUNCTION public.update_conversation_on_feedback_change() FROM PUBLIC;
