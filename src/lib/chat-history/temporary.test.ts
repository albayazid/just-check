import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase-client.server", () => ({
  getSupabaseAdminClient: vi.fn(),
}));

import { getSupabaseAdminClient } from "@/lib/supabase-client.server";
import { createMockSupabaseClient, pgError } from "@/test/mocks/supabase";
import { ensureConversationNotTemporary, endTemporaryConversation } from "./temporary";

function installSupabase(tables: Record<string, unknown> = {}) {
  vi.mocked(getSupabaseAdminClient).mockReturnValue(
    createMockSupabaseClient({ tables } as never) as never,
  );
}

describe("ensureConversationNotTemporary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves when the conversation exists and is not temporary", async () => {
    installSupabase({
      conversations: { data: { id: "c1", is_temporary: false }, error: null },
    });
    await expect(ensureConversationNotTemporary("c1", "user-1")).resolves.toBeUndefined();
  });

  it("REGRESSION PIN: throws 'Conversation not found' when the conversation IS temporary (deliberate information-hiding)", async () => {
    // The function deliberately uses the SAME error for "not found" and "is
    // temporary" to avoid leaking the existence of temporary conversations.
    installSupabase({
      conversations: { data: { id: "c1", is_temporary: true }, error: null },
    });
    await expect(ensureConversationNotTemporary("c1", "user-1")).rejects.toThrowError(
      "Conversation not found",
    );
  });

  it("throws 'Conversation not found' when the row is missing", async () => {
    installSupabase({
      conversations: { data: null, error: pgError("PGRST116") },
    });
    await expect(ensureConversationNotTemporary("ghost", "user-1")).rejects.toThrowError(
      "Conversation not found",
    );
  });

  it("throws 'Conversation not found' when the query errors (any error)", async () => {
    installSupabase({
      conversations: { data: null, error: pgError("XX000", "connection lost") },
    });
    // Same masked message regardless of the underlying error.
    await expect(ensureConversationNotTemporary("c1", "user-1")).rejects.toThrowError(
      "Conversation not found",
    );
  });
});

describe("endTemporaryConversation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("silently returns when the conversation does not exist (maybeSingle → null)", async () => {
    installSupabase({
      conversations: { data: null, error: null },
    });
    await expect(endTemporaryConversation("ghost", "user-1")).resolves.toBeUndefined();
  });

  it("throws when the find query errors", async () => {
    installSupabase({
      conversations: { data: null, error: pgError("XX", "find failed") },
    });
    await expect(endTemporaryConversation("c1", "user-1")).rejects.toThrowError(/Failed to load conversation/);
  });

  it("throws 'Conversation is not temporary' when targeting a non-temporary conversation", async () => {
    installSupabase({
      conversations: { data: { id: "c1", is_temporary: false }, error: null },
    });
    await expect(endTemporaryConversation("c1", "user-1")).rejects.toThrowError(
      "Conversation is not temporary",
    );
  });

  it("deletes the conversation when it is temporary", async () => {
    // maybeSingle find returns a temporary conversation; the delete chain follows.
    installSupabase({
      conversations: [
        { data: { id: "c1", is_temporary: true }, error: null },
        { data: null, error: null },
      ],
    });

    await expect(endTemporaryConversation("c1", "user-1")).resolves.toBeUndefined();

    const client = vi.mocked(getSupabaseAdminClient).mock.results[0]?.value as ReturnType<typeof createMockSupabaseClient>;
    expect(client.from("conversations").delete).toHaveBeenCalled();
  });

  it("rethrows a delete error", async () => {
    installSupabase({
      conversations: [
        { data: { id: "c1", is_temporary: true }, error: null },
        { data: null, error: pgError("XX", "delete failed") },
      ],
    });

    await expect(endTemporaryConversation("c1", "user-1")).rejects.toThrowError(
      /Failed to end temporary conversation/,
    );
  });
});
