/**
 * Conversation Message Types
 *
 * Contains types for storing and retrieving chat messages within a conversation.
 * Each message represents a complete turn (user or assistant) with all its parts.
 * Messages are linked via previous_message_id to form a conversation tree.
 *
 * We store UIMessage parts directly - only filtering out streaming states before storage.
 */

import type { UIMessage } from 'ai';

// Re-export UIMessage for convenience
export type { UIMessage };

// Re-export assistant response metadata types
export type {
  AssistantResponseMetadata,
  ModelData,
  TotalUsage,
  StepUsage,
  StepData,
  CreateAssistantMetadataInput,
} from './assistant-response-metadata';

/**
 * Extract the parts type from UIMessage
 * This gives us the array type of all possible UI message parts
 */
export type UIMessageParts = UIMessage['parts'];

/**
 * Individual part type from UIMessage
 */
export type UIMessagePart = UIMessageParts[number];

// ============================================================================
// MESSAGE TYPES
// ============================================================================

/**
 * Sender role for messages
 */
export type SenderRole = 'user' | 'assistant';

/**
 * Message metadata stored in the database
 * Using AI SDK's UIMessage metadata type directly for compatibility
 */
export type MessageMetadata = UIMessage['metadata'];

/**
 * A message as stored in the database
 * Content stores UIMessage parts directly from the AI SDK
 */
export interface StoredMessage {
  /** UUID v4 - unique identifier for this message */
  id: string;
  /** UUID of the conversation this message belongs to */
  conversation_id: string;
  /** UUID of the previous message in the conversation chain (null for first message) */
  previous_message_id: string | null;
  /** Role of the sender */
  sender_type: SenderRole;
  /** Array of message parts from UIMessage - stored directly */
  content: UIMessagePart[];
  /** Optional metadata */
  metadata?: MessageMetadata;
  /** When the message was created */
  created_at?: string;
  /** When the message was last updated */
  updated_at?: string;
  /** Soft delete timestamp */
  deleted_at?: string | null;
}

/**
 * Input for creating a new message (without auto-generated fields)
 */
export interface CreateMessageInput {
  /** UUID v4 - must be generated using uuid v4 */
  id: string;
  /** UUID of the conversation */
  conversation_id: string;
  /** UUID of the previous message (null for first message) */
  previous_message_id: string | null;
  /** Role of the sender */
  sender_type: SenderRole;
  /** Array of completed message parts from UIMessage */
  content: UIMessagePart[];
  /** Optional metadata */
  metadata?: MessageMetadata;
}

/**
 * Metadata that should be sent to the client (public-facing)
 * This is a subset of AssistantResponseMetadata containing only fields
 * that are safe and necessary to expose to the frontend.
 */
export interface ClientMessageMetadata {
  /** Model information (only UI-facing model ID) */
  model_data?: {
    UIModelId: string;
  };
  /** Active chat mode for this message (null = Default). */
  mode?: string | null;
  [key: string]: unknown;
}
// ============================================================================
// FILE UPLOAD TYPES
// ============================================================================

/**
 * Represents a file that has been uploaded to storage
 * This is stored in the file_uploads table
 */
export interface UploadedFile {
  id: string;
  user_id: string;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  metadata?: Record<string, unknown>;
  extracted_data?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}
