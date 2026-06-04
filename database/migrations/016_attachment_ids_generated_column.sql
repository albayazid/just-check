-- ============================================================================
-- ATTACHMENT IDS GENERATED COLUMN & CONVERSATION-SCOPED ACCESS
-- Version: 016
-- Created: 2026-05-26
--
-- Adds a generated column `attachment_ids UUID[]` to messages that
-- auto-extracts attachment file IDs from JSONB content, with a GIN index
-- for fast lookups. Also adds an RPC function for conversation-scoped
-- file access (replacing user-owner-scoped access).
-- ============================================================================

-- 1. Function to extract attachment IDs from JSONB content
-- Iterates through UIMessagePart[] looking for { type: "file", url: "attachment://<uuid>" }
-- ⚠️ Do NOT modify this function after deployment. 
-- It powers a GENERATED ALWAYS AS STORED column.
-- Changing it will NOT recalculate existing rows.
CREATE OR REPLACE FUNCTION public.extract_attachment_ids(content JSONB)
RETURNS UUID[]
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
    result UUID[] := '{}';
    element JSONB;
    url_val TEXT;
    raw_id TEXT;
    parsed_uuid UUID;
BEGIN
    IF content IS NULL OR jsonb_typeof(content) <> 'array' THEN
        RETURN result;
    END IF;

    FOR element IN SELECT * FROM jsonb_array_elements(content) LOOP
        IF element->>'type' = 'file' AND element ? 'url' THEN
            url_val := element->>'url';
            IF url_val LIKE 'attachment://%' THEN
                raw_id := substring(url_val FROM 14);
                BEGIN
                    parsed_uuid := raw_id::UUID;
                    result := result || parsed_uuid;
                EXCEPTION
                    WHEN invalid_text_representation THEN
                        RAISE NOTICE 'Invalid attachment UUID in content: %', raw_id;
                END;
            END IF;
        END IF;
    END LOOP;

    RETURN result;
END;
$$;

-- 2. Generated column on messages table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'messages'
          AND column_name = 'attachment_ids'
    ) THEN
        ALTER TABLE public.messages
            ADD COLUMN attachment_ids UUID[]
            GENERATED ALWAYS AS (public.extract_attachment_ids(content)) STORED;
    END IF;
END $$;

-- 3. GIN index (partial — excludes messages with no attachments)
CREATE INDEX IF NOT EXISTS idx_messages_attachment_ids
    ON public.messages USING GIN (attachment_ids)
    WHERE attachment_ids <> '{}';

-- 4. RPC function for conversation-scoped file access
-- Checks: does user X have access to conversation Y, and does Y contain
-- a non-deleted message referencing this file?
CREATE OR REPLACE FUNCTION public.resolve_file_for_conversation(
    p_file_id UUID,
    p_clerk_user_id TEXT,
    p_conversation_id UUID
)
RETURNS SETOF public.file_uploads
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT f.*
    FROM public.file_uploads f
    WHERE f.id = p_file_id
      AND f.deleted_at IS NULL
      AND EXISTS (
          SELECT 1
          FROM public.messages m
          JOIN public.conversations c ON m.conversation_id = c.id
          WHERE c.id = p_conversation_id
            AND c.clerk_user_id = p_clerk_user_id
            AND c.deleted_at IS NULL
            AND m.deleted_at IS NULL
            AND p_file_id = ANY(m.attachment_ids)
      );
END;
$$;

-- 5. Batch validation: are all files allowed for this user in this conversation?
-- Returns true if every file is accessible (user owns it OR already in conversation).
-- Uses set-containment (NOT EXISTS) instead of count comparison to correctly handle
-- duplicate file IDs in the input array (e.g. same attachment referenced in multiple parts).
CREATE OR REPLACE FUNCTION public.validate_file_access_for_conversation(
    p_file_ids UUID[],
    p_clerk_user_id TEXT,
    p_conversation_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    IF coalesce(array_length(p_file_ids, 1), 0) = 0 THEN
        RETURN true;
    END IF;

    RETURN NOT EXISTS (
        SELECT 1
        FROM (
            SELECT DISTINCT file_id AS id
            FROM unnest(p_file_ids) AS requested_ids(file_id)
        ) AS requested
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.file_uploads f
            WHERE f.id = requested.id
              AND f.deleted_at IS NULL
              AND (
                  f.user_id = p_clerk_user_id
                  OR EXISTS (
                      SELECT 1
                      FROM public.messages m
                      JOIN public.conversations c ON m.conversation_id = c.id
                      WHERE c.id = p_conversation_id
                        AND c.clerk_user_id = p_clerk_user_id
                        AND c.deleted_at IS NULL
                        AND m.deleted_at IS NULL
                        AND f.id = ANY(m.attachment_ids)
                  )
              )
        )
    );
END;
$$;

-- Grant service_role access and revoke public access
GRANT EXECUTE ON FUNCTION public.resolve_file_for_conversation(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_file_access_for_conversation(UUID[], TEXT, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.extract_attachment_ids(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_file_for_conversation(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_file_access_for_conversation(UUID[], TEXT, UUID) FROM PUBLIC;
