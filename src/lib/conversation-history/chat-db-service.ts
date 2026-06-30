/**
 * Conversation Message Database Service
 *
 * Contains database operations for storing and retrieving messages within a conversation.
 * This service handles direct Supabase interactions for messages.
 */

import { getSupabaseAdminClient } from '@/lib/supabase-client.server';
import type { UIMessage } from 'ai';

import type {
  SenderRole,
  MessageMetadata,
  StoredMessage,
  CreateMessageInput,
} from './types';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Converts UIMessage role to SenderRole
 * @param role - The UIMessage role
 * @returns The corresponding SenderRole ('user' or 'assistant')
 * @throws Error if role is 'system' or invalid
 */
export function roleToSenderRole(role: UIMessage['role']): SenderRole {
  switch (role) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'system':
      // System messages are not stored as separate messages
      throw new Error('System messages cannot be stored right now');
    default:
      // This will cause a TypeScript error at compile time if role is not 'user' | 'assistant'
      const _exhaustive: never = role;
      throw new Error(`Invalid role: ${_exhaustive}`);
  }
}

// ============================================================================
// MESSAGE STORAGE FUNCTIONS
// ============================================================================

/**
 * Saves a single message to the database.
 *
 * @param input - The message data to save
 * @returns The saved message
 */
export async function saveMessage(input: CreateMessageInput): Promise<StoredMessage> {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from('messages')
    .insert({
      id: input.id,
      conversation_id: input.conversation_id,
      previous_message_id: input.previous_message_id,
      sender_type: input.sender_type,
      content: input.content,
      metadata: input.metadata || {},
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to save message: ${error.message}`);
  }

  return data as StoredMessage;
}

/**
 * Saves a conversation turn (user message + assistant response) to the database.
 * This is the main function to use when storing a complete turn.
 *
 * @param params - Parameters for saving the turn
 * @returns The saved user and assistant messages
 */
export async function saveConversationTurn(params: {
  conversationId: string;
  userMessage: UIMessage;
  assistantMessage: UIMessage;
  previousMessageId?: string | null;
}): Promise<{ userMessage: StoredMessage; assistantMessage: StoredMessage }> {
  const { conversationId, userMessage, assistantMessage, previousMessageId } = params;

  // Save user message first
  const savedUserMessage = await saveMessage({
    id: userMessage.id,
    conversation_id: conversationId,
    previous_message_id: previousMessageId || null,
    sender_type: roleToSenderRole(userMessage.role),
    content: userMessage.parts,
    metadata: userMessage.metadata,
  });

  // Save assistant message, linking to user message
  const savedAssistantMessage = await saveMessage({
    id: assistantMessage.id,
    conversation_id: conversationId,
    previous_message_id: userMessage.id,
    sender_type: roleToSenderRole(assistantMessage.role),
    content: assistantMessage.parts,
    metadata: assistantMessage.metadata,
  });

  return {
    userMessage: savedUserMessage,
    assistantMessage: savedAssistantMessage,
  };
}

/**
 * Saves only a user message to the database.
 * Use this when you need to save a user message before the assistant responds.
 *
 * @param params - Parameters for saving the user message
 * @returns The saved user message
 */
export async function saveUserMessage(params: {
  conversationId: string;
  userMessage: UIMessage;
  previousMessageId?: string | null;
}): Promise<StoredMessage> {
  const { conversationId, userMessage, previousMessageId } = params;

  return await saveMessage({
    id: userMessage.id,
    conversation_id: conversationId,
    previous_message_id: previousMessageId || null,
    sender_type: userMessage.role === 'user' ? 'user' : 'assistant',
    content: userMessage.parts,
    metadata: userMessage.metadata,
  });
}

/**
 * Saves only an assistant message to the database.
 * Use this when you need to save an assistant response after it's complete.
 *
 * @param params - Parameters for saving the assistant message
 * @returns The saved assistant message
 */
export async function saveAssistantMessage(params: {
  conversationId: string;
  assistantMessage: UIMessage;
  metadata?: MessageMetadata;
  previousMessageId?: string | null;
}): Promise<StoredMessage> {
  const { conversationId, assistantMessage, metadata, previousMessageId } = params;

  return await saveMessage({
    id: assistantMessage.id,
    conversation_id: conversationId,
    previous_message_id: previousMessageId || null,
    sender_type: roleToSenderRole(assistantMessage.role),
    content: assistantMessage.parts,
    metadata: metadata ?? assistantMessage.metadata,
  });
}

/**
 * Updates an existing message in the database.
 *
 * @param id - The ID of the message to update
 * @param updates - The updates to apply
 * @returns The updated message
 */
export async function updateMessage(
  id: string,
  updates: Partial<Pick<StoredMessage, 'content' | 'metadata' | 'sender_type'>>
): Promise<StoredMessage> {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from('messages')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update message: ${error.message}`);
  }

  return data as StoredMessage;
}

// ============================================================================
// MESSAGE RETRIEVAL FUNCTIONS
// ============================================================================

/**
 * Retrieves the last message in a conversation.
 *
 * @param conversationId - The conversation ID
 * @returns The last message or null if conversation is empty
 */
export async function getLastMessageFromDB(
  conversationId: string
): Promise<StoredMessage | null> {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null;
    }
    throw new Error(`Failed to retrieve last message: ${error.message}`);
  }

  return data as StoredMessage | null;
}

/**
 * Retrieves all messages for a conversation without ordering.
 *
 * @param conversationId - The conversation ID
 * @returns Array of messages (unordered)
 */
export async function getMessagesForConversation(
  conversationId: string
): Promise<StoredMessage[]> {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to retrieve messages: ${error.message}`);
  }

  return data as StoredMessage[];
}
