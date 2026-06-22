-- Migration 020: own-conversation fork
-- Forks one of the user's own conversations into a standalone copy. Verifies
-- ownership, creates a new conversation tagged forked_from_conversation_id, and
-- copies all non-deleted messages with new UUIDs + forked_from_message_id.
-- (Share-fork provenance lives in 019; each fork RPC sets exactly one source
-- column, so the two are mutually exclusive by construction.)

-- Provenance columns for own-conversation forks.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS forked_from_conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL;
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS forked_from_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_forked_from_conversation
  ON public.conversations(forked_from_conversation_id) WHERE forked_from_conversation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fork_conversation(
  p_source_conversation_id UUID,
  p_owner_id TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_title TEXT;
  v_new_conversation_id UUID;
BEGIN
  -- 1. Verify the source conversation is owned and not deleted
  SELECT title
    INTO v_title
    FROM public.conversations
    WHERE id = p_source_conversation_id
      AND clerk_user_id = p_owner_id
      AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  -- 2. Create the forked conversation, tagged with its source
  INSERT INTO public.conversations (clerk_user_id, title, forked_from_conversation_id)
    VALUES (
      p_owner_id,
      CASE WHEN v_title IS NOT NULL THEN 'Fork: ' || v_title ELSE 'Forked Conversation' END,
      p_source_conversation_id
    )
    RETURNING id INTO v_new_conversation_id;

  -- 3. Copy all non-deleted messages with new UUIDs + provenance
  WITH with_new_ids AS (
    SELECT
      gen_random_uuid() AS new_id,
      id AS original_id,
      previous_message_id,
      sender_type,
      content,
      metadata,
      created_at
    FROM public.messages
    WHERE conversation_id = p_source_conversation_id
      AND deleted_at IS NULL
  )
  INSERT INTO public.messages (
    id, conversation_id, previous_message_id,
    sender_type, content, metadata, created_at, forked_from_message_id
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

  -- 4. Guard against empty source
  IF NOT FOUND THEN
    DELETE FROM public.conversations WHERE id = v_new_conversation_id;
    RAISE EXCEPTION 'No messages to fork';
  END IF;

  RETURN v_new_conversation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fork_conversation(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fork_conversation(UUID, TEXT) FROM PUBLIC;
