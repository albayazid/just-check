-- Migration 018: copy_messages_to_share RPC
-- A focused function that copies messages from a conversation into shared_messages
-- with new UUIDs and remapped previous_message_id references.
-- Tree-walking for thread modes uses recursive CTEs.
-- Zero data leaves the database — no round-trip through application memory.

-- Strip tool parts that carry the owner's private data (e.g. manageMemory, whose
-- input/output contain the user's full memory list) from a message's content
-- BEFORE it is frozen into a public share. Doing this at copy time means private
-- data is never written to shared_messages, so no read path can ever leak it.
-- Add further sensitive tool part types to the NOT IN list as needed.
CREATE OR REPLACE FUNCTION public.strip_private_share_parts(p_content jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_content) = 'array' THEN
      COALESCE(
        (SELECT jsonb_agg(part ORDER BY ord)
         FROM jsonb_array_elements(p_content) WITH ORDINALITY AS t(part, ord)
         WHERE part->>'type' NOT IN ('tool-manageMemory')),
        '[]'::jsonb
      )
    ELSE p_content
  END;
$$;

CREATE OR REPLACE FUNCTION public.copy_messages_to_share(
  p_share_id UUID,
  p_conversation_id UUID,
  p_share_mode TEXT,
  p_leaf_message_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Clear any prior snapshot first (idempotent: safe for create and resync).
  DELETE FROM public.shared_messages WHERE shared_conversation_id = p_share_id;

  IF p_share_mode = 'entire' THEN
    -- Copy all non-deleted messages, remapping IDs via CTE self-join
    WITH with_new_ids AS (
      SELECT
        gen_random_uuid() AS new_id,
        id AS original_id,
        previous_message_id,
        sender_type,
        public.strip_private_share_parts(content) AS content,
        metadata,
        created_at
      FROM public.messages
      WHERE conversation_id = p_conversation_id
        AND deleted_at IS NULL
    )
    INSERT INTO public.shared_messages (
      id, shared_conversation_id, original_message_id,
      previous_message_id, sender_type, content,
      metadata, created_at
    )
    SELECT
      w.new_id,
      p_share_id,
      w.original_id,
      prev.new_id,
      w.sender_type,
      w.content,
      w.metadata,
      w.created_at
    FROM with_new_ids w
    LEFT JOIN with_new_ids prev ON w.previous_message_id = prev.original_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 0 THEN
      -- Raise so the DELETE rolls back instead of committing an empty snapshot.
      RAISE EXCEPTION 'No messages to share';
    END IF;
    RETURN v_count;

  ELSIF p_share_mode = 'latest_thread' THEN
    -- Find the latest leaf, walk back to root via recursive CTE
    WITH RECURSIVE
    latest_leaf AS (
      SELECT m.id
      FROM public.messages m
      WHERE m.conversation_id = p_conversation_id
        AND m.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.messages child
          WHERE child.previous_message_id = m.id
            AND child.deleted_at IS NULL
        )
      ORDER BY m.created_at DESC
      LIMIT 1
    ),
    chain AS (
      SELECT m.id, m.previous_message_id, m.sender_type, m.content, m.metadata, m.created_at
      FROM public.messages m
      JOIN latest_leaf ll ON m.id = ll.id
      WHERE m.deleted_at IS NULL

      UNION ALL

      SELECT parent.id, parent.previous_message_id, parent.sender_type, parent.content, parent.metadata, parent.created_at
      FROM public.messages parent
      JOIN chain c ON parent.id = c.previous_message_id
      WHERE parent.conversation_id = p_conversation_id
        AND parent.deleted_at IS NULL
    ),
    with_new_ids AS (
      SELECT
        gen_random_uuid() AS new_id,
        id AS original_id,
        previous_message_id,
        sender_type,
        public.strip_private_share_parts(content) AS content,
        metadata,
        created_at
      FROM chain
    )
    INSERT INTO public.shared_messages (
      id, shared_conversation_id, original_message_id,
      previous_message_id, sender_type, content,
      metadata, created_at
    )
    SELECT
      w.new_id,
      p_share_id,
      w.original_id,
      prev.new_id,
      w.sender_type,
      w.content,
      w.metadata,
      w.created_at
    FROM with_new_ids w
    LEFT JOIN with_new_ids prev ON w.previous_message_id = prev.original_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 0 THEN
      -- Raise so the DELETE rolls back instead of committing an empty snapshot.
      RAISE EXCEPTION 'No messages to share';
    END IF;
    RETURN v_count;

  ELSIF p_share_mode = 'visible_thread' THEN
    -- Walk from the given leaf back to root via recursive CTE
    WITH RECURSIVE
    chain AS (
      SELECT m.id, m.previous_message_id, m.sender_type, m.content, m.metadata, m.created_at
      FROM public.messages m
      WHERE m.id = p_leaf_message_id
        AND m.conversation_id = p_conversation_id
        AND m.deleted_at IS NULL

      UNION ALL

      SELECT parent.id, parent.previous_message_id, parent.sender_type, parent.content, parent.metadata, parent.created_at
      FROM public.messages parent
      JOIN chain c ON parent.id = c.previous_message_id
      WHERE parent.conversation_id = p_conversation_id
        AND parent.deleted_at IS NULL
    ),
    with_new_ids AS (
      SELECT
        gen_random_uuid() AS new_id,
        id AS original_id,
        previous_message_id,
        sender_type,
        public.strip_private_share_parts(content) AS content,
        metadata,
        created_at
      FROM chain
    )
    INSERT INTO public.shared_messages (
      id, shared_conversation_id, original_message_id,
      previous_message_id, sender_type, content,
      metadata, created_at
    )
    SELECT
      w.new_id,
      p_share_id,
      w.original_id,
      prev.new_id,
      w.sender_type,
      w.content,
      w.metadata,
      w.created_at
    FROM with_new_ids w
    LEFT JOIN with_new_ids prev ON w.previous_message_id = prev.original_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 0 THEN
      -- Raise so the DELETE rolls back instead of committing an empty snapshot.
      RAISE EXCEPTION 'No messages to share';
    END IF;
    RETURN v_count;

  ELSE
    RAISE EXCEPTION 'Invalid share_mode: %', p_share_mode;
  END IF;
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION public.copy_messages_to_share(UUID, UUID, TEXT, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.copy_messages_to_share(UUID, UUID, TEXT, UUID) FROM PUBLIC;
