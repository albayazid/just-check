/**
 * Conversation Database Service
 *
 * Contains database operations for conversation listing.
 */

import { getSupabaseAdminClient } from '@/lib/supabase-client.server';
import type {
  ListConversationsParams,
  ListConversationsResult,
  ListConversationsWithFiltersParams,
  StoredConversation,
  PaginationCursor,
} from './types';
import { PIN_LIMIT } from './types';

const DEFAULT_LIMIT = 10;

/**
 * Lists conversations for a user with cursor-based pagination
 *
 * @param params - Parameters including clerkUserId, limit, and cursor
 * @returns Paginated result with conversations, hasMore flag, and nextCursor
 * @throws Error if database query fails
 */
export async function listConversations(
  params: ListConversationsParams
): Promise<ListConversationsResult> {
  const { clerkUserId, limit = DEFAULT_LIMIT, cursor } = params;

  const supabase = getSupabaseAdminClient();

  let query = supabase
    .from('conversations')
    .select('*', { count: 'exact' })
    .eq('clerk_user_id', clerkUserId)
    .eq('is_temporary', false)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1); // Fetch one extra to determine if there's more

  // Apply cursor filter if provided
  if (cursor) {
    try {
      const cursorData = JSON.parse(cursor) as PaginationCursor;
      query = query.or(
        `updated_at.lt."${cursorData.updated_at}",and(updated_at.eq."${cursorData.updated_at}",id.lt.${cursorData.id})`
      );
    } catch (error) {
      console.error('Invalid cursor format:', error);
      throw new Error('Invalid cursor format');
    }
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to fetch conversations: ${error.message}`);
  }

  const allConversations = (data || []) as StoredConversation[];

  // Check if we fetched more than the limit to determine hasMore
  const hasMore = allConversations.length > limit;
  const conversations = hasMore ? allConversations.slice(0, limit) : allConversations;

  // Generate next cursor from the last item if there are more
  let nextCursor: string | null = null;
  if (hasMore && conversations.length > 0) {
    const lastConversation = conversations[conversations.length - 1];
    nextCursor = JSON.stringify({
      updated_at: lastConversation.updated_at,
      id: lastConversation.id,
    } as PaginationCursor);
  }

  return {
    conversations,
    hasMore,
    nextCursor,
    totalCount: count || 0,
  };
}

/**
 * Lists conversations with organization filters (pinned, archived, folder)
 *
 * @param params - Parameters including view mode and folder filter
 * @returns Paginated result with conversations
 * @throws Error if database query fails
 */
export async function listConversationsWithFilters(
  params: ListConversationsWithFiltersParams
): Promise<ListConversationsResult> {
  const { clerkUserId, limit = DEFAULT_LIMIT, cursor, view = 'regular', folderId } = params;

  const supabase = getSupabaseAdminClient();

  let query = supabase
    .from('conversations')
    .select('*', { count: 'exact' })
    .eq('clerk_user_id', clerkUserId)
    .eq('is_temporary', false)
    .is('deleted_at', null);

  // Apply view filter
  if (view === 'pinned') {
    query = query.not('pinned_at', 'is', null).order('pinned_at', { ascending: false });
  } else if (view === 'archived') {
    query = query.not('archived_at', 'is', null).order('archived_at', { ascending: false });
  } else {
    // Regular: exclude archived and pinned conversations
    query = query
      .is('archived_at', null)
      .is('pinned_at', null)
      .order('updated_at', { ascending: false });
    if (!folderId) {
      query = query.is('folder_id', null);
    }
  }

  // Apply folder filter (explicit folder view)
  if (folderId) {
    query = query.eq('folder_id', folderId);
  }

  // Add secondary ordering by id for consistent pagination
  query = query.order('id', { ascending: false }).limit(limit + 1);

  // Apply cursor filter if provided
  if (cursor) {
    try {
      const cursorData = JSON.parse(cursor) as PaginationCursor;
      const orderField = view === 'pinned' ? 'pinned_at' : view === 'archived' ? 'archived_at' : 'updated_at';
      query = query.or(
        `${orderField}.lt."${cursorData.updated_at}",and(${orderField}.eq."${cursorData.updated_at}",id.lt.${cursorData.id})`
      );
    } catch (error) {
      console.error('Invalid cursor format:', error);
      throw new Error('Invalid cursor format');
    }
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to fetch conversations: ${error.message}`);
  }

  const allConversations = (data || []) as StoredConversation[];

  const hasMore = allConversations.length > limit;
  const conversations = hasMore ? allConversations.slice(0, limit) : allConversations;

  let nextCursor: string | null = null;
  if (hasMore && conversations.length > 0) {
    const lastConversation = conversations[conversations.length - 1];
    const orderField = view === 'pinned' ? 'pinned_at' : view === 'archived' ? 'archived_at' : 'updated_at';
    nextCursor = JSON.stringify({
      updated_at: lastConversation[orderField as keyof StoredConversation] as string,
      id: lastConversation.id,
    } as PaginationCursor);
  }

  return {
    conversations,
    hasMore,
    nextCursor,
    totalCount: count || 0,
  };
}

/**
 * Pins a conversation (sets pinned_at to NOW)
 *
 * @param conversationId - ID of the conversation to pin
 * @param clerkUserId - Owner's Clerk user ID
 * @throws Error if pin limit reached or database query fails
 */
export async function pinConversation(
  conversationId: string,
  clerkUserId: string
): Promise<void> {
  const supabase = getSupabaseAdminClient();

  // Check current pin count
  const { count, error: countError } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('clerk_user_id', clerkUserId)
    .eq('is_temporary', false)
    .not('pinned_at', 'is', null)
    .is('deleted_at', null);

  if (countError) {
    throw new Error(`Failed to check pin count: ${countError.message}`);
  }

  if ((count || 0) >= PIN_LIMIT) {
    throw new Error(`Pin limit reached (max ${PIN_LIMIT}). Unpin a conversation first.`);
  }

  const { error } = await supabase
    .from('conversations')
    .update({ pinned_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('clerk_user_id', clerkUserId)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to pin conversation: ${error.message}`);
  }
}

/**
 * Unpins a conversation (sets pinned_at to NULL)
 *
 * @param conversationId - ID of the conversation to unpin
 * @param clerkUserId - Owner's Clerk user ID
 * @throws Error if database query fails
 */
export async function unpinConversation(
  conversationId: string,
  clerkUserId: string
): Promise<void> {
  const supabase = getSupabaseAdminClient();

  const { error } = await supabase
    .from('conversations')
    .update({ pinned_at: null })
    .eq('id', conversationId)
    .eq('clerk_user_id', clerkUserId)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to unpin conversation: ${error.message}`);
  }
}

/**
 * Archives a conversation (sets archived_at to NOW, clears pinned_at)
 *
 * @param conversationId - ID of the conversation to archive
 * @param clerkUserId - Owner's Clerk user ID
 * @throws Error if database query fails
 */
export async function archiveConversation(
  conversationId: string,
  clerkUserId: string
): Promise<void> {
  const supabase = getSupabaseAdminClient();

  const { error } = await supabase
    .from('conversations')
    .update({
      archived_at: new Date().toISOString(),
      pinned_at: null,
    })
    .eq('id', conversationId)
    .eq('clerk_user_id', clerkUserId)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to archive conversation: ${error.message}`);
  }
}

/**
 * Unarchives a conversation (sets archived_at to NULL)
 *
 * @param conversationId - ID of the conversation to unarchive
 * @param clerkUserId - Owner's Clerk user ID
 * @throws Error if database query fails
 */
export async function unarchiveConversation(
  conversationId: string,
  clerkUserId: string
): Promise<void> {
  const supabase = getSupabaseAdminClient();

  const { error } = await supabase
    .from('conversations')
    .update({ archived_at: null })
    .eq('id', conversationId)
    .eq('clerk_user_id', clerkUserId)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to unarchive conversation: ${error.message}`);
  }
}

/**
 * Archives all conversations for a user (sets archived_at to NOW, clears pinned_at)
 * Only archives conversations that are not already archived and not deleted
 *
 * @param clerkUserId - Owner's Clerk user ID
 * @returns Object with count of archived conversations
 * @throws Error if database query fails
 */
export async function archiveAllConversations(clerkUserId: string): Promise<{ count: number }> {
  const supabase = getSupabaseAdminClient();

  const { count, error } = await supabase
    .from('conversations')
    .update({
      archived_at: new Date().toISOString(),
      pinned_at: null,
    })
    .eq('clerk_user_id', clerkUserId)
    .eq('is_temporary', false)
    .is('deleted_at', null)
    .is('archived_at', null);

  if (error) {
    throw new Error(`Failed to archive all conversations: ${error.message}`);
  }

  return { count: count || 0 };
}

/**
 * Soft deletes all conversations for a user (sets deleted_at to NOW)
 * Only deletes conversations that are not already deleted
 *
 * @param clerkUserId - Owner's Clerk user ID
 * @returns Object with count of deleted conversations
 * @throws Error if database query fails
 */
export async function deleteAllConversations(clerkUserId: string): Promise<{ count: number }> {
  const supabase = getSupabaseAdminClient();

  const { count, error } = await supabase
    .from('conversations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('clerk_user_id', clerkUserId)
    .eq('is_temporary', false)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to delete all conversations: ${error.message}`);
  }

  return { count: count || 0 };
}

/**
 * Gets the count of pinned conversations for a user
 *
 * @param clerkUserId - Owner's Clerk user ID
 * @returns Object with count, limit, and canPin boolean
 */
export async function getPinnedCount(clerkUserId: string): Promise<{
  count: number;
  limit: number;
  canPin: boolean;
}> {
  const supabase = getSupabaseAdminClient();

  const { count, error } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('clerk_user_id', clerkUserId)
    .eq('is_temporary', false)
    .not('pinned_at', 'is', null)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to get pinned count: ${error.message}`);
  }

  const pinnedCount = count || 0;
  return {
    count: pinnedCount,
    limit: PIN_LIMIT,
    canPin: pinnedCount < PIN_LIMIT,
  };
}

/**
 * Forks one of the user's own conversations into a standalone copy. Delegates
 * to the fork_conversation RPC (ownership check, new conversation + remapped
 * message copy, provenance tagged) — zero messages pass through Node memory.
 *
 * @returns The new conversation id.
 * @throws Error 'Conversation not found' if not owned/deleted, or 'No messages to fork'.
 */
export async function forkConversation(
  sourceConversationId: string,
  clerkUserId: string,
): Promise<{ conversationId: string }> {
  const supabase = getSupabaseAdminClient();

  const { data: conversationId, error } = await supabase.rpc('fork_conversation', {
    p_source_conversation_id: sourceConversationId,
    p_owner_id: clerkUserId,
  });

  if (error) {
    const message = error.message;
    if (message.includes('not found')) {
      throw new Error('Conversation not found');
    }
    if (message.includes('No messages')) {
      throw new Error('No messages to fork');
    }
    throw new Error(`Failed to fork conversation: ${message}`);
  }

  return { conversationId };
}
