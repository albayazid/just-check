/**
 * Share Service — frozen-snapshot conversation sharing. One ACTIVE share per
 * conversation (DB-enforced); resync re-freezes with the same token.
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
  RefreshShareInput,
  ShareConversationView,
  SharedMessageView,
  PublicShareView,
} from './types';

type AdminClient = ReturnType<typeof getSupabaseAdminClient>;

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

/** Builds the public share URL for a token. */
function buildShareUrl(token: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${appUrl}/share/${token}`;
}

/** Owner display name for the public "Shared by" line (nickname → full_name). */
async function resolveOwnerDisplayName(
  supabase: AdminClient,
  clerkUserId: string,
): Promise<string | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('nickname, full_name')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle();
  return profile ? (profile.nickname || profile.full_name || null) : null;
}

/** Clears + re-freezes the share's snapshot via RPC; throws on error or zero rows. */
async function runCopyRpc(
  supabase: AdminClient,
  shareId: string,
  conversationId: string,
  shareMode: ShareMode,
  currentLeafMessageId?: string,
): Promise<void> {
  const { data: messageCount, error: rpcError } = await supabase.rpc('copy_messages_to_share', {
    p_share_id: shareId,
    p_conversation_id: conversationId,
    p_share_mode: shareMode,
    p_leaf_message_id: shareMode === 'visible_thread' ? currentLeafMessageId ?? null : null,
  });

  if (rpcError) {
    // The RPC raises 'No messages to share' on an empty copy; surface that cleanly.
    if (rpcError.message.includes('No messages')) {
      throw new Error('No messages to share');
    }
    throw new Error(`Failed to copy messages: ${rpcError.message}`);
  }
  if (!messageCount || messageCount === 0) {
    throw new Error('No messages to share');
  }
}

/** Guards the visible_thread leaf belongs to the conversation (defense-in-depth). */
async function assertLeafInConversation(
  supabase: AdminClient,
  conversationId: string,
  leafMessageId?: string,
): Promise<void> {
  if (!leafMessageId) return;
  const { data: leaf } = await supabase
    .from('messages')
    .select('id')
    .eq('id', leafMessageId)
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!leaf) {
    throw new Error('Leaf message not found in this conversation');
  }
}

// ============================================================================
// PUBLIC API FUNCTIONS
// ============================================================================

/**
 * Create or re-freeze the single active share for a conversation. Reuses the
 * existing share + token if present (upsert). Throws on not-found / not-owned /
 * temporary / no-messages.
 */
export async function createShareSnapshot(params: {
  clerkUserId: string;
  input: CreateShareInput;
}): Promise<CreateShareResult & { created: boolean }> {
  const { clerkUserId, input } = params;
  const supabase = getSupabaseAdminClient();

  // 1. Verify conversation ownership and state
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

  // 2. Validate visible_thread leaf + compute expiry
  if (input.shareMode === 'visible_thread') {
    await assertLeafInConversation(supabase, input.conversationId, input.currentLeafMessageId);
  }
  const expiresAt = input.expiresInHours
    ? new Date(Date.now() + input.expiresInHours * 3600_000).toISOString()
    : null;

  // 3. Reuse an existing active share if one exists (one active share per convo)
  const { data: existing } = await supabase
    .from('shared_conversations')
    .select('id, token')
    .eq('source_conversation_id', input.conversationId)
    .eq('owner_clerk_user_id', clerkUserId)
    .eq('is_active', true)
    .maybeSingle();

  if (existing) {
    await applySettingsAndCopy(supabase, {
      shareId: existing.id,
      sourceConversationId: input.conversationId,
      title: conversation.title,
      shareMode: input.shareMode,
      expiresAt,
      currentLeafMessageId: input.currentLeafMessageId,
    });
    return { id: existing.id, token: existing.token, url: buildShareUrl(existing.token), created: false };
  }

  // 4. No existing share — create a new row with a fresh token
  const token = generateShareToken();
  const { data: sharedConv, error: insertConvError } = await supabase
    .from('shared_conversations')
    .insert({
      token,
      source_conversation_id: input.conversationId,
      owner_clerk_user_id: clerkUserId,
      title: conversation.title,
      share_mode: input.shareMode,
      expires_at: expiresAt,
      synced_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (insertConvError || !sharedConv) {
    throw new Error(`Failed to create share: ${insertConvError?.message}`);
  }

  // 5. Copy messages via Postgres RPC. On failure roll back the new row.
  try {
    await runCopyRpc(supabase, sharedConv.id, input.conversationId, input.shareMode, input.currentLeafMessageId);
  } catch (err) {
    try { await supabase.from('shared_conversations').delete().eq('id', sharedConv.id); } catch {}
    throw err;
  }

  return { id: sharedConv.id, token, url: buildShareUrl(token), created: true };
}

/**
 * Applies settings to an existing share row and re-freezes its snapshot.
 * Shared by the create-reuse path and the explicit resync (Update link) action.
 * Keeps the row's id and token. Updates synced_at on success.
 */
async function applySettingsAndCopy(
  supabase: AdminClient,
  args: {
    shareId: string;
    sourceConversationId: string;
    title: string | null;
    shareMode: ShareMode;
    expiresAt: string | null;
    currentLeafMessageId?: string;
  },
): Promise<void> {
  // Copy first so an RPC failure leaves settings untouched. Not fully atomic —
  // a later UPDATE failure could leave a stale mode label until next resync.
  await runCopyRpc(supabase, args.shareId, args.sourceConversationId, args.shareMode, args.currentLeafMessageId);

  const { error: updateError } = await supabase
    .from('shared_conversations')
    .update({
      share_mode: args.shareMode,
      title: args.title,
      expires_at: args.expiresAt,
      synced_at: new Date().toISOString(),
    })
    .eq('id', args.shareId);

  if (updateError) {
    throw new Error(`Failed to update share: ${updateError.message}`);
  }
}

/**
 * Resync ("Update link") — re-freezes the active share for a conversation with
 * new settings, keeping the same token so the public URL is unchanged.
 *
 * @throws Error 'Share not found' if no active share exists for the conversation.
 */
export async function refreshShare(params: {
  conversationId: string;
  clerkUserId: string;
  input: RefreshShareInput;
}): Promise<CreateShareResult> {
  const { conversationId, clerkUserId, input } = params;
  const supabase = getSupabaseAdminClient();

  // 1. Load the active share for this conversation owned by the user
  const { data: share, error } = await supabase
    .from('shared_conversations')
    .select('id, token, expires_at')
    .eq('source_conversation_id', conversationId)
    .eq('owner_clerk_user_id', clerkUserId)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !share) {
    throw new Error('Share not found');
  }

  // 2. Validate visible_thread leaf belongs to the conversation
  if (input.shareMode === 'visible_thread') {
    await assertLeafInConversation(supabase, conversationId, input.currentLeafMessageId);
  }

  // 3. Re-read the (possibly renamed) title.
  const { data: conversation } = await supabase
    .from('conversations')
    .select('title')
    .eq('id', conversationId)
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle();

  // 4. Apply settings + re-freeze. Preserve the existing expires_at.
  await applySettingsAndCopy(supabase, {
    shareId: share.id,
    sourceConversationId: conversationId,
    title: conversation?.title ?? null,
    shareMode: input.shareMode,
    expiresAt: share.expires_at,
    currentLeafMessageId: input.currentLeafMessageId,
  });

  return { id: share.id, token: share.token, url: buildShareUrl(share.token) };
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
    .select('id, title, owner_clerk_user_id, share_mode, created_at, is_active, expires_at')
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

  // 3. Owner name is resolved live  from the profile.
  const ownerDisplayName = await resolveOwnerDisplayName(supabase, sharedConv.owner_clerk_user_id);

  // 4. Build the public view (strip private metadata at the service layer)
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
    ownerDisplayName,
    shareMode: sharedConv.share_mode as ShareMode,
    createdAt: sharedConv.created_at,
    messages: publicMessages,
  };
}

/**
 * Returns the single active share for a conversation (or null if none),
 * scoped to the requesting user.
 */
export async function getShareForConversation(
  conversationId: string,
  clerkUserId: string,
): Promise<ShareConversationView | null> {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from('shared_conversations')
    .select('id, token, share_mode, is_active, created_at, synced_at, expires_at')
    .eq('source_conversation_id', conversationId)
    .eq('owner_clerk_user_id', clerkUserId)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    token: data.token,
    shareMode: data.share_mode as ShareMode,
    isActive: data.is_active,
    createdAt: data.created_at,
    syncedAt: data.synced_at,
    expiresAt: data.expires_at,
  };
}

/**
 * Revokes the active share for a conversation, making its public link stop
 * working. Only the owner can revoke. Idempotent (only touches active rows).
 */
export async function revokeShare(
  conversationId: string,
  clerkUserId: string
): Promise<void> {
  const supabase = getSupabaseAdminClient();

  const { error } = await supabase
    .from('shared_conversations')
    .update({
      is_active: false,
      revoked_at: new Date().toISOString(),
    })
    .eq('source_conversation_id', conversationId)
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
