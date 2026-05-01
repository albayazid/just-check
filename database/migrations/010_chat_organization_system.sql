-- ============================================================================
-- CHAT ORGANIZATION SYSTEM
-- Lumy Alpha - Pin, Archive, and Folders
-- Version: 010
-- Created: 2026-03-17
-- ============================================================================

-- 1. ADD ORGANIZATION COLUMNS TO CONVERSATIONS TABLE
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS folder_id UUID;

-- 2. CREATE CONVERSATION FOLDERS TABLE
CREATE TABLE IF NOT EXISTS public.conversation_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  deleted_at TIMESTAMP WITH TIME ZONE,

  -- Constraints
  CONSTRAINT folder_name_not_empty CHECK (LENGTH(TRIM(name)) >= 1),
  CONSTRAINT folder_name_max_length CHECK (LENGTH(name) <= 100),
  CONSTRAINT unique_folder_name_per_user UNIQUE (clerk_user_id, name)
);

-- 3. ADD FOREIGN KEY CONSTRAINT FOR FOLDER_ID
ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS fk_conversations_folder;

ALTER TABLE public.conversations
  ADD CONSTRAINT fk_conversations_folder
  FOREIGN KEY (folder_id) REFERENCES public.conversation_folders(id) ON DELETE SET NULL;

-- 4. CREATE PERFORMANCE INDEXES
-- Pinned conversations index (for fetching pinned list)
CREATE INDEX IF NOT EXISTS idx_conversations_pinned
  ON public.conversations(clerk_user_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL;

-- Archived conversations index (for fetching archived list)
CREATE INDEX IF NOT EXISTS idx_conversations_archived
  ON public.conversations(clerk_user_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;

-- Folder conversations index (for fetching conversations in a folder)
CREATE INDEX IF NOT EXISTS idx_conversations_folder
  ON public.conversations(folder_id, updated_at DESC)
  WHERE folder_id IS NOT NULL;

-- Active conversations index (non-archived, for main sidebar list)
CREATE INDEX IF NOT EXISTS idx_conversations_active_list
  ON public.conversations(clerk_user_id, updated_at DESC)
  WHERE deleted_at IS NULL AND archived_at IS NULL;

-- Folders index (for listing user's folders)
CREATE INDEX IF NOT EXISTS idx_folders_user
  ON public.conversation_folders(clerk_user_id, created_at)
  WHERE deleted_at IS NULL;

-- 5. ENABLE ROW LEVEL SECURITY (default-deny, service role bypasses)
ALTER TABLE public.conversation_folders ENABLE ROW LEVEL SECURITY;

-- 6. CREATE UPDATED_AT TRIGGER FOR FOLDERS
DROP TRIGGER IF EXISTS update_conversation_folders_updated_at ON public.conversation_folders;
CREATE TRIGGER update_conversation_folders_updated_at
    BEFORE UPDATE ON public.conversation_folders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
