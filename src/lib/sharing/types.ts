/**
 * Chat Sharing Types
 *
 * Types for the frozen snapshot sharing system.
 * Shared conversations are independent copies that don't update
 * when the original conversation changes.
 */

import type { UIMessagePart, ClientMessageMetadata } from '@/lib/conversation-history/types';

// ============================================================================
// SHARE MODE
// ============================================================================

/**
 * Which messages to include in the share
 */
export type ShareMode = 'entire' | 'latest_thread' | 'visible_thread';

// ============================================================================
// DATABASE ROW TYPES
// ============================================================================

/**
 * A shared_conversations row as stored in the database
 */
export interface StoredSharedConversation {
  id: string;
  token: string;
  source_conversation_id: string;
  owner_clerk_user_id: string;
  title: string | null;
  owner_display_name: string | null;
  share_mode: ShareMode;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  expires_at: string | null;
}

/**
 * A shared_messages row as stored in the database
 */
export interface StoredSharedMessage {
  id: string;
  shared_conversation_id: string;
  original_message_id: string;
  previous_message_id: string | null;
  sender_type: 'user' | 'assistant' | 'system';
  content: UIMessagePart[];
  metadata: Record<string, unknown>;
  attachment_ids: string[] | null;
  created_at: string;
}

// ============================================================================
// API INPUT / OUTPUT TYPES
// ============================================================================

/**
 * Input for creating a new share
 */
export interface CreateShareInput {
  conversationId: string;
  shareMode: ShareMode;
  showOwnerName: boolean;
  currentLeafMessageId?: string;
  expiresInHours?: number;
}

/**
 * Response from creating a share
 */
export interface CreateShareResult {
  id: string;
  token: string;
  url: string;
}

/**
 * A share item in the list response
 */
export interface ShareListItem {
  id: string;
  token: string;
  shareMode: ShareMode;
  isActive: boolean;
  createdAt: string;
  revokedAt: string | null;
}

/**
 * A single message in the public share view
 */
export interface SharedMessageView {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: UIMessagePart[];
  metadata: ClientMessageMetadata;
  previousMessageId: string | null;
  createdAt: string;
}

/**
 * The full public share view returned by the public API
 */
export interface PublicShareView {
  id: string;
  title: string | null;
  ownerDisplayName: string | null;
  shareMode: ShareMode;
  createdAt: string;
  messages: SharedMessageView[];
}
