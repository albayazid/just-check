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
import type { ConversationFolder } from "@/lib/chat-history";

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
