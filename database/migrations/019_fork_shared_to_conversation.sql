-- Migration 019: fork_shared_to_conversation RPC
-- Forks a shared conversation into the authenticated user's account: validates
-- the share, creates a new conversation (tagged forked_from_share_id), and
-- copies all shared_messages into messages (tagged forked_from_shared_message_id)
-- with new UUIDs and remapped previous_message_id. Zero data leaves the database.

-- Provenance columns for share-forks (own-conversation fork columns live in 020).
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS forked_from_share_id UUID REFERENCES public.shared_conversations(id) ON DELETE SET NULL;
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS forked_from_shared_message_id UUID REFERENCES public.shared_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_forked_from_share
  ON public.conversations(forked_from_share_id) WHERE forked_from_share_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fork_shared_to_conversation(
  p_share_token TEXT,
  p_forking_user_id TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_share_id UUID;
  v_title TEXT;
  v_new_conversation_id UUID;
BEGIN
  -- 1. Validate the share is active and not expired
  SELECT id, title
    INTO v_share_id, v_title
    FROM public.shared_conversations
    WHERE token = p_share_token
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > NOW());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shared conversation not found or no longer available';
  END IF;

  -- 2. Create a new conversation for the forking user, tagged with its share origin
  INSERT INTO public.conversations (clerk_user_id, title, forked_from_share_id)
    VALUES (
      p_forking_user_id,
      CASE WHEN v_title IS NOT NULL THEN 'Fork: ' || v_title ELSE 'Forked Conversation' END,
      v_share_id
    )
    RETURNING id INTO v_new_conversation_id;

  -- 3. Copy all shared_messages into messages with new UUIDs + provenance
  WITH with_new_ids AS (
    SELECT
      gen_random_uuid() AS new_id,
      id AS original_id,
      previous_message_id,
      sender_type,
      content,
      metadata,
      created_at
    FROM public.shared_messages
    WHERE shared_conversation_id = v_share_id
  )
  INSERT INTO public.messages (
    id, conversation_id, previous_message_id,
    sender_type, content, metadata, created_at, forked_from_shared_message_id
  )
  SELECT
    w.new_id,
    v_new_conversation_id,
    prev.new_id,
    w.sender_type,
    w.content,
    COALESCE(w.metadata, '{}'::jsonb),
    w.created_at,
    w.original_id
  FROM with_new_ids w
  LEFT JOIN with_new_ids prev ON w.previous_message_id = prev.original_id;

  -- 4. Guard against zero-message shares
  IF NOT FOUND THEN
    DELETE FROM public.conversations WHERE id = v_new_conversation_id;
    RAISE EXCEPTION 'No messages to fork';
  END IF;

  RETURN v_new_conversation_id;
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION public.fork_shared_to_conversation(TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fork_shared_to_conversation(TEXT, TEXT) FROM PUBLIC;
