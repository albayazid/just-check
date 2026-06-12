/**
 * Share Service
 *
 * Core business logic for the frozen snapshot sharing system.
 * Heavy data operations (tree-walking, ID remapping, message copying) are
 * handled by the PostgreSQL function copy_messages_to_share to avoid loading
 * all messages into Node.js memory.
 */

import { randomBytes } from 'crypto';

import { getSupabaseAdminClient } from '@/lib/supabase-client.server';
import { resolveFromStoragePath } from '@/lib/storage/file-storage-service';
import type { AssistantResponseMetadata } from '@/lib/conversation-history';
import type { ClientMessageMetadata } from '@/lib/conversation-history/types';
import type {
  ShareMode,
  CreateShareInput,
  CreateShareResult,
  ShareListItem,
  SharedMessageView,
  PublicShareView,
  StoredSharedConversation,
} from './types';

// ============================================================================
// TOKEN GENERATION
// ============================================================================

/**
 * Generates a cryptographically secure share token.
 * 16 random bytes encoded as base64url, trimmed to 21 chars (126 bits of entropy).
 */
function generateShareToken(): string {
  return randomBytes(16).toString('base64url').slice(0, 21);
}

/**
 * Filters server-side metadata to only include client-safe fields.
 * Mirrors the pattern used in the messages API route.
 */
function filterClientMetadata(meta: AssistantResponseMetadata | undefined): ClientMessageMetadata {
  if (!meta) return {};
  return {
    model_data: meta.model_data ? { UIModelId: meta.model_data.UIModelId } : undefined,
  };
}

// ============================================================================
// PUBLIC API FUNCTIONS
// ============================================================================

/**
 * Creates a frozen snapshot share of a conversation.
 *
 * JS handles: ownership validation, profile lookup, token generation, share row creation.
 * Postgres handles: copying messages with new IDs and tree-walking (via RPC).
 *
 * @returns The share token and public URL
 * @throws Error if conversation not found, not owned, or no messages
 */
export async function createShareSnapshot(params: {
  clerkUserId: string;
  input: CreateShareInput;
}): Promise<CreateShareResult> {
  const { clerkUserId, input } = params;
  const supabase = getSupabaseAdminClient();

  // 1. Verify conversation ownership and get metadata
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('id, title, is_temporary, deleted_at')
    .eq('id', input.conversationId)
    .eq('clerk_user_id', clerkUserId)
    .single();

  if (convError || !conversation) {
    throw new Error('Conversation not found');
  }

  if (conversation.deleted_at) {
    throw new Error('Conversation not found');
  }

  if (conversation.is_temporary) {
    throw new Error('Temporary conversations cannot be shared');
  }

  // 1b. For visible_thread, confirm the supplied leaf actually belongs to this
  // conversation (defense-in-depth alongside the RPC's conversation_id scoping).
  if (input.shareMode === 'visible_thread' && input.currentLeafMessageId) {
    const { data: leaf } = await supabase
      .from('messages')
      .select('id')
      .eq('id', input.currentLeafMessageId)
      .eq('conversation_id', input.conversationId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!leaf) {
      throw new Error('Leaf message not found in this conversation');
    }
  }

  // 2. Resolve owner display name if requested
  let ownerDisplayName: string | null = null;
  if (input.showOwnerName) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('nickname, full_name')
      .eq('clerk_user_id', clerkUserId)
      .single();

    if (profile) {
      ownerDisplayName = profile.nickname || profile.full_name || null;
    }
  }

  // 3. Generate token (trivial, no DB call)
  const token = generateShareToken();

  // 4. Insert shared_conversations row
  const { data: sharedConv, error: insertConvError } = await supabase
    .from('shared_conversations')
    .insert({
      token,
      source_conversation_id: input.conversationId,
      owner_clerk_user_id: clerkUserId,
      title: conversation.title,
      owner_display_name: ownerDisplayName,
      share_mode: input.shareMode,
      expires_at: input.expiresInHours
        ? new Date(Date.now() + input.expiresInHours * 3600_000).toISOString()
        : null,
    })
    .select('id')
    .single();

  if (insertConvError || !sharedConv) {
    throw new Error(`Failed to create share: ${insertConvError?.message}`);
  }

  // 5. Copy messages via Postgres RPC (zero messages in Node memory)
  const { data: messageCount, error: rpcError } = await supabase.rpc('copy_messages_to_share', {
    p_share_id: sharedConv.id,
    p_conversation_id: input.conversationId,
    p_share_mode: input.shareMode,
    p_leaf_message_id: input.shareMode === 'visible_thread' ? input.currentLeafMessageId ?? null : null,
  });

  if (rpcError) {
    try { await supabase.from('shared_conversations').delete().eq('id', sharedConv.id); } catch {}
    throw new Error(`Failed to copy messages: ${rpcError.message}`);
  }

  if (!messageCount || messageCount === 0) {
    try { await supabase.from('shared_conversations').delete().eq('id', sharedConv.id); } catch {}
    throw new Error('No messages to share');
  }

  // 6. Build public URL
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const url = `${appUrl}/share/${token}`;

  return { id: sharedConv.id, token, url };
}

/**
 * Fetches a public share by token.
 * Only returns active (non-revoked) shares.
 * Filters out all private metadata.
 */
export async function getPublicShare(token: string): Promise<PublicShareView | null> {
  const supabase = getSupabaseAdminClient();

  // 1. Fetch the shared conversation
  const { data: sharedConv, error } = await supabase
    .from('shared_conversations')
    .select('id, title, owner_display_name, share_mode, created_at, is_active, expires_at')
    .eq('token', token)
    .single();

  if (error || !sharedConv || !sharedConv.is_active) {
    return null;
  }

  if (sharedConv.expires_at && new Date(sharedConv.expires_at) < new Date()) {
    return null;
  }

  // 2. Fetch shared messages
  const { data: messages, error: msgError } = await supabase
    .from('shared_messages')
    .select('id, sender_type, content, metadata, previous_message_id, created_at')
    .eq('shared_conversation_id', sharedConv.id)
    .order('created_at', { ascending: true });

  if (msgError || !messages) {
    return null;
  }

  // 3. Build the public view (strip private metadata at the service layer)
  const publicMessages: SharedMessageView[] = messages.map((msg) => ({
    id: msg.id,
    role: msg.sender_type as 'user' | 'assistant' | 'system',
    parts: Array.isArray(msg.content) ? msg.content : [],
    metadata: filterClientMetadata(msg.metadata as AssistantResponseMetadata | undefined),
    previousMessageId: msg.previous_message_id,
    createdAt: msg.created_at,
  }));

  return {
    id: sharedConv.id,
    title: sharedConv.title,
    ownerDisplayName: sharedConv.owner_display_name,
    shareMode: sharedConv.share_mode as ShareMode,
    createdAt: sharedConv.created_at,
    messages: publicMessages,
  };
}

/**
 * Lists all shares for a conversation.
 * Only returns shares owned by the requesting user.
 */
export async function listSharesForConversation(
  conversationId: string,
  clerkUserId: string
): Promise<ShareListItem[]> {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from('shared_conversations')
    .select('id, token, share_mode, is_active, created_at, revoked_at')
    .eq('source_conversation_id', conversationId)
    .eq('owner_clerk_user_id', clerkUserId)
    .order('created_at', { ascending: false });

  if (error || !data) {
    throw new Error(`Failed to list shares: ${error?.message}`);
  }

  return (data as StoredSharedConversation[]).map((row) => ({
    id: row.id,
    token: row.token,
    shareMode: row.share_mode as ShareMode,
    isActive: row.is_active,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }));
}

/**
 * Revokes a share, making its public link stop working.
 * Only the owner can revoke.
 */
export async function revokeShare(
  shareId: string,
  clerkUserId: string
): Promise<void> {
  const supabase = getSupabaseAdminClient();

  const { error } = await supabase
    .from('shared_conversations')
    .update({
      is_active: false,
      revoked_at: new Date().toISOString(),
    })
    .eq('id', shareId)
    .eq('owner_clerk_user_id', clerkUserId)
    .eq('is_active', true);

  if (error) {
    throw new Error(`Failed to revoke share: ${error.message}`);
  }
}

/**
 * Forks a shared conversation into the authenticated user's account.
 *
 * Delegates the entire operation (validation, conversation creation, message
 * copying with UUID remapping) to the Postgres RPC `fork_shared_to_conversation`.
 * Zero messages pass through Node.js memory — all work happens inside the database.
 *
 * @returns The new conversation ID
 */
export async function forkSharedConversation(
  token: string,
  forkingUserId: string
): Promise<{ conversationId: string }> {
  const supabase = getSupabaseAdminClient();

  const { data: conversationId, error } = await supabase.rpc(
    'fork_shared_to_conversation',
    {
      p_share_token: token,
      p_forking_user_id: forkingUserId,
    }
  );

  if (error) {
    const message = error.message;
    // Map SQL RAISE EXCEPTION messages to the same JS errors the API route expects
    if (message.includes('not found') || message.includes('no longer available')) {
      throw new Error('Shared conversation not found or no longer available');
    }
    if (message.includes('expired')) {
      throw new Error('Share has expired');
    }
    if (message.includes('No messages')) {
      throw new Error('No messages to fork');
    }
    throw new Error(`Failed to fork shared conversation: ${message}`);
  }

  return { conversationId };
}

/**
 * Resolves an attachment URL for a shared conversation.
 * Validates that the file is actually referenced in the shared messages.
 *
 * @returns A signed URL for the file
 * @throws Error if file not found or not part of the share
 */
export async function resolveShareAttachment(
  fileId: string,
  shareToken: string
): Promise<string> {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .rpc('resolve_file_for_shared_conversation', {
      p_file_id: fileId,
      p_share_token: shareToken,
    })
    .single();

  if (error || !data) {
    throw new Error('File not found or access denied');
  }

  const file = data as { id: string; storage_path: string };
  return resolveFromStoragePath(file.id, file.storage_path);
}
