/**
 * Test data builders.
 *
 * Convention: every factory takes a partial overrides object and merges it onto
 * deterministic defaults. Never construct test data inline in a test — go
 * through a builder so tests stay readable and schema changes don't ripple
 * through hundreds of inline literals.
 *
 * New factories are added in the batch that first needs them.
 */
import type { ConversationFolder, StoredConversation } from "@/lib/chat-history";
import type { StoredMessage } from "@/lib/conversation-history";
import type { AssistantResponseMetadata } from "@/lib/conversation-history";

export function buildFolder(
  overrides: Partial<ConversationFolder> = {},
): ConversationFolder {
  return {
    id: "folder-1",
    clerk_user_id: "user-1",
    name: "Work",
    color: null,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

export function buildStoredConversation(
  overrides: Partial<StoredConversation> = {},
): StoredConversation {
  return {
    id: "conv-1",
    clerk_user_id: "user-1",
    title: "A conversation",
    metadata: {},
    is_temporary: false,
    pinned_at: null,
    archived_at: null,
    folder_id: null,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

/** A UIMessage-shaped object. `parts` defaults to a single text part. */
export function buildUIMessage(
  overrides: Partial<{ id: string; role: "user" | "assistant"; parts: unknown[]; metadata: Record<string, unknown> }> = {},
) {
  return {
    id: "msg-1",
    role: "user" as const,
    parts: [{ type: "text", text: "hello" }],
    metadata: {},
    ...overrides,
  };
}

export function buildStoredMessage(
  overrides: Partial<StoredMessage> = {},
): StoredMessage {
  return {
    id: "msg-1",
    conversation_id: "conv-1",
    previous_message_id: null,
    sender_type: "user",
    content: [{ type: "text", text: "hello" }] as StoredMessage["content"],
    metadata: undefined,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

export function buildAssistantResponseMetadata(
  overrides: Partial<AssistantResponseMetadata> = {},
): AssistantResponseMetadata {
  return {
    model_data: {
      UIModelId: "fast",
      internalModelId: "deepseek/deepseek-v3.2",
      provider: "openrouter",
    },
    mode: null,
    hasAttachments: false,
    finishReason: "stop",
    totalUsage: {
      totalUsedTokens: 100,
      totalInputTokens: 80,
      totalOutputTokens: 20,
    },
    stepCount: 1,
    toolCallsCount: 0,
    toolsCalled: [],
    step_data: [],
    ...overrides,
  };
}
